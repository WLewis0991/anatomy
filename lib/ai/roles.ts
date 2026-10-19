import "server-only";

import {
  CLASSIFIABLE_ROLES,
  EXPLANATION_MODEL,
  ensureTracingEnv,
  type ClassifiableRole,
} from "./config";
import { traceable } from "langsmith/traceable";

import { createSupabaseClient } from "@/lib/supabase";
import { getAiClient } from "./client";

/**
 * Roles for files no adapter could identify.
 *
 * The answer is restricted to the non-structural roles. Page, route and
 * controller are deliberately not in the vocabulary: those decide the route
 * table and the entry-point colouring, and convention owns them.
 *
 * The existing `file_roles` row is the cache. A row written by the same model for
 * the same content is returned without a model call, inside the traced function.
 */

ensureTracingEnv();

export interface RoleCandidate {
  fileId: string;
  path: string;
  hash: string | null;
}

export interface AssignRolesInput {
  organizationId: string;
  analysisId: string;
  candidates: readonly RoleCandidate[];
}

interface StoredRole {
  file_id: string;
  role: string;
  source: string;
  model: string | null;
  subject_hash: string | null;
}

const BATCH_SIZE = 40;

const ROLE_SET = new Set<string>(CLASSIFIABLE_ROLES);

const ROLE_SYSTEM = `You classify source files for a dependency-map tool.

Choose exactly one role for each file from this list:
service, repository, model, util, config, component, hook.

Never answer page, route, controller, or any other word. If the path does not
support a confident answer, choose util.

Answer with JSON only, in this shape:
{"roles":[{"path":"src/example.ts","role":"util"}]}`;

function parseRoles(content: string): Map<string, ClassifiableRole> {
  const roles = new Map<string, ClassifiableRole>();
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start === -1 || end <= start) return roles;

  let parsed: unknown;
  try {
    parsed = JSON.parse(content.slice(start, end + 1)) as unknown;
  } catch {
    return roles;
  }

  if (typeof parsed !== "object" || parsed === null || !("roles" in parsed)) {
    return roles;
  }

  const list = (parsed as { roles?: unknown }).roles;
  if (!Array.isArray(list)) return roles;

  for (const entry of list) {
    if (typeof entry !== "object" || entry === null) continue;
    const path = (entry as { path?: unknown }).path;
    const role = (entry as { role?: unknown }).role;
    if (typeof path !== "string" || typeof role !== "string") continue;
    const normalised = role.trim().toLowerCase();
    if (ROLE_SET.has(normalised)) {
      roles.set(path, normalised as ClassifiableRole);
    }
  }

  return roles;
}

export const assignUnidentifiedRoles = traceable(
  async (input: AssignRolesInput): Promise<{ assigned: number; cached: number }> => {
    if (input.candidates.length === 0) return { assigned: 0, cached: 0 };

    const supabase = createSupabaseClient();
    const ids = input.candidates.map((candidate) => candidate.fileId);
    const stored: StoredRole[] = [];

    for (let index = 0; index < ids.length; index += 200) {
      const { data, error } = await supabase
        .from("file_roles")
        .select("file_id, role, source, model, subject_hash")
        .in("file_id", ids.slice(index, index + 200));

      if (error) throw new Error(`Failed to read role cache: ${error.message}`);
      stored.push(...(data ?? []));
    }

    const human = new Set(
      stored.filter((row) => row.source === "human").map((row) => row.file_id),
    );
    const valid = new Map(
      stored
        .filter((row) => row.model === EXPLANATION_MODEL)
        .map((row) => [row.file_id, row]),
    );

    const missing = input.candidates.filter((candidate) => {
      // A person's label is not a cache entry and is never replaced by a model.
      if (human.has(candidate.fileId)) return false;
      const cached = valid.get(candidate.fileId);
      if (cached === undefined) return true;
      return cached.subject_hash !== (candidate.hash ?? candidate.path);
    });

    if (missing.length === 0) {
      return { assigned: 0, cached: stored.length };
    }

    let assigned = 0;

    for (let index = 0; index < missing.length; index += BATCH_SIZE) {
      const batch = missing.slice(index, index + BATCH_SIZE);

      const response = await getAiClient().chat.completions.create(
        {
          model: EXPLANATION_MODEL,
          temperature: 0,
          max_tokens: 600,
          messages: [
            { role: "system", content: ROLE_SYSTEM },
            {
              role: "user",
              content: [
                "Classify these paths. Only use the allowed role words.",
                ...batch.map((candidate) => `- ${candidate.path}`),
              ].join("\n"),
            },
          ],
        },
      );

      const roles = parseRoles(response.choices[0]?.message.content ?? "");
      const rows = batch.flatMap((candidate) => {
        const role = roles.get(candidate.path);
        if (role === undefined) return [];
        return [{
          organization_id: input.organizationId,
          file_id: candidate.fileId,
          role,
          source: "ai",
          model: EXPLANATION_MODEL,
          subject_hash: candidate.hash ?? candidate.path,
        }];
      });

      if (rows.length === 0) continue;

      const { error } = await supabase.from("file_roles").upsert(rows, {
        onConflict: "organization_id,file_id",
      });

      if (error) throw new Error(`Failed to store roles: ${error.message}`);
      assigned += rows.length;
    }

    return { assigned, cached: stored.length };
  },
  {
    name: "classify-roles",
    run_type: "chain",
    tags: ["roles"],
    processOutputs: (output) => ({
      assigned: output.assigned,
      cached: output.cached,
    }),
  },
);
