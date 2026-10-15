import { writeFile } from "node:fs/promises";
import path from "node:path";

import { parseRepository } from "./parse-repository.ts";
import type { ParseResult, SkippedFile, UnresolvedImport } from "./types.ts";

/**
 * `node parser/cli.ts <directory> [--out file]`
 *
 * Prints what the parser found and, with `--out`, writes the whole result as the
 * typed data file everything downstream reads.
 */

function formatCount(value: number): string {
  return value.toString().padStart(6, " ");
}

function groupByReason(skipped: readonly SkippedFile[]): Map<string, SkippedFile[]> {
  const groups = new Map<string, SkippedFile[]>();
  for (const entry of skipped) {
    const list = groups.get(entry.reason) ?? [];
    list.push(entry);
    groups.set(entry.reason, list);
  }
  return groups;
}

function topEntries(counts: Record<string, number>, limit: number): Array<[string, number]> {
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, limit);
}

function report(result: ParseResult, writtenTo: string | undefined): string {
  const lines: string[] = [];
  const { coverage } = result;
  const folders = new Set(result.files.map((file) => file.folder));

  lines.push(`root      ${result.root}`);
  lines.push(`adapter   ${result.adapter}`);
  lines.push(`generated ${result.generatedAt}`);
  lines.push("");
  lines.push("coverage");
  lines.push(`  files found          ${formatCount(coverage.filesFound)}`);
  lines.push(`  files parsed         ${formatCount(coverage.filesParsed)}`);
  lines.push(`  files skipped        ${formatCount(coverage.filesSkipped)}`);
  lines.push(`  folders in the files ${formatCount(folders.size)}`);
  lines.push("");
  lines.push("imports");
  lines.push(`  imports seen         ${formatCount(coverage.importsSeen)}`);
  lines.push(`  internal (edges)     ${formatCount(coverage.internal)}`);
  lines.push(`  external             ${formatCount(coverage.external)}`);
  lines.push(`  excluded             ${formatCount(coverage.excluded)}`);
  lines.push(`  unresolved           ${formatCount(coverage.unresolved)}`);
  lines.push(`  re-exports found     ${formatCount(coverage.reexportsSeen)}`);
  lines.push(`  re-exports resolved  ${formatCount(coverage.reexportsResolved)}`);
  lines.push(`  duplicate imports    ${formatCount(coverage.duplicateImports)}`);

  lines.push("");
  lines.push("re-exports that did not land inside the repository");
  for (const gap of coverage.reexportGaps) {
    lines.push(
      `  ${gap.from}:${gap.line}  "${gap.specifier}"  —  ${gap.outcome}: ${gap.detail}`,
    );
  }
  if (coverage.reexportGaps.length === 0) lines.push("  none");

  lines.push("");
  lines.push("ignored directories");
  for (const directory of coverage.ignoredDirectories) {
    lines.push(`  ${directory.path.padEnd(24)} ${formatCount(directory.files)} files  ${directory.reason}`);
  }
  const ignoredTotal = coverage.ignoredDirectories.reduce(
    (total, directory) => total + directory.files,
    0,
  );
  lines.push(`  ${"total".padEnd(24)} ${formatCount(ignoredTotal)} files`);

  lines.push("");
  lines.push("skipped files, by reason");
  for (const [reason, entries] of [...groupByReason(coverage.skipped)].sort()) {
    lines.push(`  ${reason} (${entries.length})`);
    for (const entry of entries.slice(0, 200)) {
      lines.push(`    ${entry.path}  —  ${entry.detail}`);
    }
    if (entries.length > 200) lines.push(`    ...and ${entries.length - 200} more`);
  }

  const reasons = new Map<string, number>();
  for (const entry of coverage.unresolvedImports) {
    reasons.set(entry.reason, (reasons.get(entry.reason) ?? 0) + 1);
  }
  lines.push("");
  lines.push("unresolved imports, by reason");
  for (const [reason, count] of [...reasons].sort()) {
    lines.push(`  ${reason.padEnd(24)} ${formatCount(count)}`);
  }
  lines.push("");
  for (const entry of coverage.unresolvedImports.slice(0, 200) as UnresolvedImport[]) {
    lines.push(
      `  ${entry.from}:${entry.line}  ${entry.kind} "${entry.specifier}"  —  ${entry.reason}: ${entry.detail}`,
    );
  }
  if (coverage.unresolvedImports.length > 200) {
    lines.push(`  ...and ${coverage.unresolvedImports.length - 200} more`);
  }

  lines.push("");
  lines.push("excluded imports");
  for (const entry of coverage.excludedImports) {
    lines.push(`  ${entry.from}:${entry.line}  "${entry.specifier}"  —  ${entry.detail}`);
  }
  if (coverage.excludedImports.length === 0) lines.push("  none");

  lines.push("");
  lines.push("most imported into (fan-in)");
  for (const [file, count] of topEntries(result.fanIn, 10)) {
    lines.push(`  ${formatCount(count)}  ${file}`);
  }
  lines.push("");
  lines.push("most importing out (fan-out)");
  for (const [file, count] of topEntries(result.fanOut, 10)) {
    lines.push(`  ${formatCount(count)}  ${file}`);
  }

  if (writtenTo) lines.push(`\nwritten  ${writtenTo}`);
  return lines.join("\n");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let out: string | undefined;
  let directory: string | undefined;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--out") {
      const value = args[i + 1];
      if (value === undefined) throw new Error("--out needs a file path");
      out = path.resolve(value);
      i += 1;
      continue;
    }
    if (arg === "--help") {
      process.stdout.write("usage: node parser/cli.ts <directory> [--out file]\n");
      return;
    }
    if (arg !== undefined && arg.startsWith("-")) {
      throw new Error(`unknown option ${arg}`);
    }
    if (directory !== undefined) throw new Error("one directory at a time");
    directory = arg;
  }

  if (directory === undefined) {
    throw new Error("usage: node parser/cli.ts <directory> [--out file]");
  }

  const result = await parseRepository({ root: directory });
  if (out !== undefined) {
    await writeFile(out, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
  process.stdout.write(`${report(result, out)}\n`);
}

await main();