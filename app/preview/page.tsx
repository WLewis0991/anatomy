import { readFile } from "node:fs/promises";
import path from "node:path";
import { PreviewClient } from "./preview-client";
import { assertParseResult } from "@/parser/result";
import { foldDirectories } from "@/parser/folding";

export const instant = false;

export default async function PreviewPage() {
  const dataPath = path.join(process.cwd(), "data", "typeorm.json");
  const raw = await readFile(dataPath, "utf8");
  const result = assertParseResult(JSON.parse(raw) as unknown);

  // The repository's own shape picks the depth. The parser's shape is the contract
  // and is not reshaped here beyond folding directories together.
  const fold = foldDirectories(result.files, {
    rootLabel: result.root.split("/").pop() ?? "root",
  });

  return (
    <PreviewClient result={result} repositoryName="typeorm — packages/typeorm/src" fold={fold} />
  );
}