import "server-only";

import { createHash } from "node:crypto";

import {
  EXPLANATION_MODEL,
  MAX_SOURCE_CHARS,
  ensureTracingEnv,
  tracingConfigured,
} from "./config";
import { traceable } from "langsmith/traceable";

import { createSupabaseClient } from "@/lib/supabase";
import { fetchRepositoryFile } from "@/lib/fetch-repository";
import { getAiClient } from "./client";
import type { ExplanationView } from "./types";

/**
 * Explanations are cached in the database, and the cache read is the first thing
 * the traced function does. A hit therefore appears in LangSmith as a run with a
 * recorded output and no model child, which is what makes "the cache works" a
 * fact rather than an assumption.
 *
 * The model is never asked to walk the graph. Every neighbour handed to it was
 * read from the edges the parser resolved, and the prompt explicitly forbids
 * adding one.
 */

ensureTracingEnv();

/** Traceable wrappers schedule their runs only once LangSmith has a key. */
export function aiTracingEnabled(): boolean {
  return tracingConfigured();
}

const EXPLANATION_SYSTEM = `You explain code to a developer opening a repository they did not write.

Write two or three short paragraphs. Add bullets only if they genuinely help.
The subject is the file or folder named in the request. Explain what it does and
how it relates to the neighbours supplied. Every neighbour path given to you is
real and complete; there may be no others.

Rules:
- Only name repository paths that appear in the supplied lists. Never invent a path.
- Never claim a file imports or is imported by another unless the supplied edges say so.
- Do not walk the graph or speculate about files further away.
- Do not give scores, grades, severities or recommendations.
- Do not use headings, code fences, tables or numbered lists.

Formatting is limited to inline code (single backticks), bold (**text**) and
bullets starting with "- ". Use repository-relative paths exactly as given.`;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** The parser stores 16 hex characters, so a computed fallback matches it. */
function contentHash(value: string): string {
  return sha256(value).slice(0, 16);
}

function truncateSource(source: string): string {
  if (source.length <= MAX_SOURCE_CHARS) return source;
  const head = source.slice(0, Math.floor(MAX_SOURCE_CHARS * 0.7));
  const tail = source.slice(-Math.floor(MAX_SOURCE_CHARS * 0.25));
  return `${head}\n\n[... truncated ...]\n\n${tail}`;
}

/** The subject's content hash. Null file hashes fall back to their path, so an
 * old row still caches deterministically rather than being recomputed forever. */
export function folderHash(files: readonly { path: string; hash: string | null }[]): string {
  const lines = files
    .map((file) => `${file.path}\0${file.hash ?? ""}`)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return sha256(lines.join("\n"));
}

interface StoredExplanation {
  body: string;
  subject_hash: string | null;
  model: string | null;
  head_sha: string | null;
}

function usable(stored: StoredExplanation | null, hash: string): stored is StoredExplanation {
  return (
    stored !== null &&
    stored.subject_hash === hash &&
    stored.model === EXPLANATION_MODEL
  );
}

async function loadPaths(ids: readonly string[]): Promise<Map<string, string>> {
  const supabase = createSupabaseClient();
  const paths = new Map<string, string>();
  const CHUNK = 200;

  for (let index = 0; index < ids.length; index += CHUNK) {
    const { data, error } = await supabase
      .from("files")
      .select("id, path")
      .in("id", ids.slice(index, index + CHUNK));

    if (error) throw new Error(`Failed to read neighbour paths: ${error.message}`);
    for (const file of data ?? []) paths.set(file.id, file.path);
  }

  return paths;
}

export interface ExplainFileInput {
  analysisId: string;
  organizationId: string;
  repositoryName: string;
  repositoryUrl: string;
  headSha: string | null;
  adapter: string | null;
  fileId: string;
  path: string;
  /** The hash stored at parse time. Null on rows analysed before hashes existed. */
  hash: string | null;
}

export const explainFile = traceable(
  async (input: ExplainFileInput): Promise<ExplanationView> => {
    const supabase = createSupabaseClient();

    let source: string | null = null;
    let subjectHash = input.hash?.trim() ?? "";

    // A row parsed before hashes were stored has nothing to key on. Reading the
    // file at the analysed commit is what lets the cache be exact rather than
    // keyed on the path alone.
    if (subjectHash === "") {
      source = await fetchRepositoryFile(
        input.repositoryName,
        input.headSha ?? "HEAD",
        input.path,
      );
      subjectHash = contentHash(source);
    }

    const { data: stored, error: cacheError } = await supabase
      .from("explanations")
      .select("body, subject_hash, model, head_sha")
      .eq("file_id", input.fileId)
      .maybeSingle();

    if (cacheError) {
      throw new Error(`Failed to read the explanation cache: ${cacheError.message}`);
    }

    if (usable(stored, subjectHash)) {
      return {
        kind: "file",
        path: input.path,
        body: stored.body,
        cached: true,
        model: stored.model ?? EXPLANATION_MODEL,
        subjectHash,
        headSha: stored.head_sha,
      };
    }

    // From here the answer has to be written, so everything the model is allowed
    // to see is loaded now: the imports this file resolved, the files importing
    // it, and the source at the analysed commit.
    const [outgoing, incoming, roleResult] = await Promise.all([
      supabase
        .from("edges")
        .select("to_file_id, specifier, kind")
        .eq("analysis_id", input.analysisId)
        .eq("from_file_id", input.fileId),
      supabase
        .from("edges")
        .select("from_file_id, specifier, kind")
        .eq("analysis_id", input.analysisId)
        .eq("to_file_id", input.fileId),
      supabase
        .from("file_roles")
        .select("role")
        .eq("file_id", input.fileId)
        .maybeSingle(),
    ]);

    if (outgoing.error) throw new Error(`Failed to read imports: ${outgoing.error.message}`);
    if (incoming.error) throw new Error(`Failed to read dependents: ${incoming.error.message}`);
    if (roleResult.error) throw new Error(`Failed to read role: ${roleResult.error.message}`);

    const neighbourIds = [
      ...new Set([
        ...(outgoing.data ?? []).map((edge) => edge.to_file_id),
        ...(incoming.data ?? []).map((edge) => edge.from_file_id),
      ]),
    ];

    const pathById = await loadPaths(neighbourIds);

    if (source === null) {
      source = await fetchRepositoryFile(
        input.repositoryName,
        input.headSha ?? "HEAD",
        input.path,
      );
    }

    const outgoingLines = (outgoing.data ?? [])
      .map((edge) => {
        const path = pathById.get(edge.to_file_id);
        return path === undefined
          ? null
          : `- ${path} (${edge.kind}, "${edge.specifier}")`;
      })
      .filter((line): line is string => line !== null);

    const incomingLines = (incoming.data ?? [])
      .map((edge) => {
        const path = pathById.get(edge.from_file_id);
        return path === undefined
          ? null
          : `- ${path} (${edge.kind}, "${edge.specifier}")`;
      })
      .filter((line): line is string => line !== null);

    const user = [
      `Repository: ${input.repositoryName}`,
      `Framework adapter: ${input.adapter ?? "none"}`,
      `File: ${input.path}`,
      roleResult.data?.role ? `Role: ${roleResult.data.role}` : null,
      "",
      "This file imports:",
      outgoingLines.length === 0 ? "(nothing inside the repository)" : outgoingLines.join("\n"),
      "",
      "Files importing this file:",
      incomingLines.length === 0 ? "(nothing inside the repository)" : incomingLines.join("\n"),
      "",
      "Source at the analysed commit:",
      truncateSource(source),
    ]
      .filter((line): line is string => line !== null)
      .join("\n");

    const response = await getAiClient().chat.completions.create(
      {
        model: EXPLANATION_MODEL,
        temperature: 0.2,
        max_tokens: 700,
        messages: [
          { role: "system", content: EXPLANATION_SYSTEM },
          { role: "user", content: user },
        ],
      },
    );

    const body = normaliseExplanation(response.choices[0]?.message.content ?? "");
    if (body === "") {
      throw new Error("The model returned no explanation.");
    }

    const { error: writeError } = await supabase.from("explanations").upsert(
      {
        organization_id: input.organizationId,
        file_id: input.fileId,
        body,
        subject_hash: subjectHash,
        model: EXPLANATION_MODEL,
        head_sha: input.headSha,
        created_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,file_id" },
    );

    if (writeError) {
      throw new Error(`Failed to store the explanation: ${writeError.message}`);
    }

    return {
      kind: "file",
      path: input.path,
      body,
      cached: false,
      model: EXPLANATION_MODEL,
      subjectHash,
      headSha: input.headSha,
    };
  },
  {
    name: "explain-file",
    run_type: "chain",
    tags: ["explanation"],
    processOutputs: (output) => ({
      cached: output.cached,
      model: output.model,
      subject_hash: output.subjectHash,
    }),
  },
);

export interface ExplainFolderInput {
  analysisId: string;
  organizationId: string;
  repositoryName: string;
  repositoryUrl: string;
  headSha: string | null;
  adapter: string | null;
  folderPath: string;
}

const PAGE_SIZE = 1000;

interface AnalysisFile {
  id: string;
  path: string;
  hash: string | null;
}

/** Every file in the analysis, paged because PostgREST caps a response. */
async function loadFiles(analysisId: string): Promise<AnalysisFile[]> {
  const supabase = createSupabaseClient();
  const files: AnalysisFile[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("files")
      .select("id, path, hash")
      .eq("analysis_id", analysisId)
      .order("path", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw new Error(`Failed to read files: ${error.message}`);

    files.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }

  return files;
}

export const explainFolder = traceable(
  async (input: ExplainFolderInput): Promise<ExplanationView> => {
    const supabase = createSupabaseClient();
    const files = await loadFiles(input.analysisId);

    const prefix = input.folderPath === "" ? "" : `${input.folderPath}/`;
    const held = files.filter((file) => file.path.startsWith(prefix));
    const subjectHash = folderHash(held);

    const { data: stored, error: cacheError } = await supabase
      .from("folder_explanations")
      .select("body, subject_hash, model, head_sha")
      .eq("analysis_id", input.analysisId)
      .eq("folder_path", input.folderPath)
      .maybeSingle();

    if (cacheError) {
      throw new Error(`Failed to read the folder explanation cache: ${cacheError.message}`);
    }

    if (usable(stored, subjectHash)) {
      return {
        kind: "folder",
        path: input.folderPath,
        body: stored.body,
        cached: true,
        model: stored.model ?? EXPLANATION_MODEL,
        subjectHash,
        headSha: stored.head_sha,
      };
    }

    const heldIds = held.map((file) => file.id);
    const pathById = new Map(files.map((file) => [file.id, file.path]));

    // Inbound edges only. An edge entirely inside the folder is structure, not a
    // reason the folder is depended on, so it is counted separately.
    const inbound = new Map<string, number>();
    let internal = 0;
    const CHUNK = 200;

    for (let index = 0; index < heldIds.length; index += CHUNK) {
      const { data, error } = await supabase
        .from("edges")
        .select("from_file_id, to_file_id")
        .eq("analysis_id", input.analysisId)
        .in("to_file_id", heldIds.slice(index, index + CHUNK));

      if (error) throw new Error(`Failed to read folder dependents: ${error.message}`);

      for (const edge of data ?? []) {
        const from = pathById.get(edge.from_file_id);
        if (from === undefined) continue;
        if (from.startsWith(prefix)) {
          internal += 1;
        } else {
          inbound.set(from, (inbound.get(from) ?? 0) + 1);
        }
      }
    }

    const dependents = [...inbound.entries()].sort(
      (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1),
    );
    const totalInbound = dependents.reduce((total, [, count]) => total + count, 0);

    const contents = held
      .slice(0, 200)
      .map((file) => `- ${file.path}`)
      .join("\n");

    const user = [
      `Repository: ${input.repositoryName}`,
      `Framework adapter: ${input.adapter ?? "none"}`,
      `Folder: ${input.folderPath === "" ? "(repository root)" : input.folderPath}`,
      `Files in this folder and beneath it: ${held.length}`,
      "",
      "What it contains:",
      contents === "" ? "(no files)" : contents,
      held.length > 200 ? `- ${held.length - 200} more files not listed` : null,
      "",
      `Files outside the folder that import into it: ${dependents.length}`,
      `Imports into the folder from outside: ${totalInbound}`,
      dependents.length === 0
        ? "(nothing outside imports into it)"
        : dependents
            .slice(0, 40)
            .map(([path, count]) => `- ${path} (${count} import${count === 1 ? "" : "s"})`)
            .join("\n"),
      internal > 0
        ? `Imports that stay inside the folder: ${internal}`
        : null,
      "",
      "Explain what this folder is for and why the rest of the repository points at it. Do not summarise one file as if it were the folder.",
    ]
      .filter((line): line is string => line !== null)
      .join("\n");

    const response = await getAiClient().chat.completions.create(
      {
        model: EXPLANATION_MODEL,
        temperature: 0.2,
        max_tokens: 700,
        messages: [
          { role: "system", content: EXPLANATION_SYSTEM },
          { role: "user", content: user },
        ],
      },
    );

    const body = normaliseExplanation(response.choices[0]?.message.content ?? "");
    if (body === "") {
      throw new Error("The model returned no explanation.");
    }

    const { error: writeError } = await supabase.from("folder_explanations").upsert(
      {
        organization_id: input.organizationId,
        analysis_id: input.analysisId,
        folder_path: input.folderPath,
        body,
        subject_hash: subjectHash,
        model: EXPLANATION_MODEL,
        head_sha: input.headSha,
        created_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,analysis_id,folder_path" },
    );

    if (writeError) {
      throw new Error(`Failed to store the folder explanation: ${writeError.message}`);
    }

    return {
      kind: "folder",
      path: input.folderPath,
      body,
      cached: false,
      model: EXPLANATION_MODEL,
      subjectHash,
      headSha: input.headSha,
    };
  },
  {
    name: "explain-folder",
    run_type: "chain",
    tags: ["explanation"],
    processOutputs: (output) => ({
      cached: output.cached,
      model: output.model,
      subject_hash: output.subjectHash,
    }),
  },
);

/**
 * The prompt permits three pieces of formatting. Models still occasionally reach
 * for a heading or a fence, so the stored body is normalised before rendering:
 * fences become plain text and heading markers are removed. A renderer should
 * never have to guess what a model meant.
 */
export function normaliseExplanation(body: string): string {
  const withoutFences = body
    .replace(/\r\n/g, "\n")
    .replace(/```[a-zA-Z0-9_-]*\n?/g, "");

  return withoutFences
    .split("\n")
    .map((line) => {
      const heading = line.match(/^\s*#{1,6}\s*(.*)$/);
      if (heading) return heading[1] ?? "";
      // A star bullet is the same bullet; normalising it keeps the renderer from
      // printing a literal asterisk at the start of a line.
      return line.replace(/^(\s*)\*\s+/, "$1- ");
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
