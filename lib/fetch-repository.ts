import { createHash } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { createWriteStream, createReadStream } from "node:fs";
import { extract } from "tar";

export interface FetchedRepository {
  /** The temporary directory where the repository was extracted. */
  root: string;
  /** The commit SHA the archive was fetched at. */
  headSha: string;
  /** The normalized owner/repo name. */
  name: string;
}

/** A trailing `.git` on the repository segment is not part of its name. */
function stripGitSuffix(segment: string): string {
  return segment.endsWith(".git") ? segment.slice(0, -4) : segment;
}

/**
 * Maps a failed GitHub response to the message this pipeline reports. Every
 * GitHub request goes through here so a 404 or 403 reads the same wherever it
 * came from — the metadata call is now the first place a missing repository can
 * fail.
 */
function describeGithubError(name: string, response: Response): string {
  if (response.status === 404) {
    return `Repository not found: ${name}`;
  }
  if (response.status === 403) {
    return `Access denied or rate limited: ${name}`;
  }
  return `Failed to fetch repository: ${response.status} ${response.statusText}`;
}

/**
 * Normalizes a GitHub repository URL to an `owner/repo` string.
 * Accepts HTTPS, SSH, and bare `owner/repo` forms.
 *
 * The repository segment is matched greedily up to the next `/`, `?` or `#`, so a
 * URL carrying `/tree/<branch>`, a query or a fragment still yields the repository.
 * A lazy match with an optional trailing group would stop at one character.
 */
export function normalizeRepositoryUrl(input: string): string {
  const trimmed = input.trim();

  if (trimmed === "") {
    throw new Error("Repository URL is empty.");
  }

  // HTTPS: https://github.com/owner/repo(.git)?(/tree/branch)?(?query)?(#fragment)?
  const httpsMatch = trimmed.match(/^https?:\/\/(?:www\.)?github\.com\/([^/?#]+)\/([^/?#]+)/i);
  if (httpsMatch) {
    return `${httpsMatch[1].toLowerCase()}/${stripGitSuffix(httpsMatch[2]).toLowerCase()}`;
  }

  // SSH: git@github.com:owner/repo(.git)?
  const sshMatch = trimmed.match(/^git@github\.com:([^/?#]+)\/([^/?#]+)/i);
  if (sshMatch) {
    return `${sshMatch[1].toLowerCase()}/${stripGitSuffix(sshMatch[2]).toLowerCase()}`;
  }

  // Bare owner/repo.
  const bareMatch = trimmed.match(/^([^/\s:]+)\/([^/\s:]+)$/);
  if (bareMatch) {
    return `${bareMatch[1].toLowerCase()}/${stripGitSuffix(bareMatch[2]).toLowerCase()}`;
  }

  throw new Error(
    `Could not parse repository URL. Expected formats: owner/repo, https://github.com/owner/repo, or git@github.com:owner/repo`,
  );
}

/**
 * Fetches a public GitHub repository as a tarball and extracts it to a temporary directory.
 * Returns the extracted root, the commit SHA (resolved from the API), and the normalized name.
 */
export async function fetchRepository(
  url: string,
  options: { token?: string } = {},
): Promise<FetchedRepository> {
  const name = normalizeRepositoryUrl(url);
  const [owner, repo] = name.split("/");

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "anatomy",
  };
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  // Resolve the default branch's commit SHA from the API. GitHub's tarball
  // redirect no longer carries the SHA, so we ask for it directly and then pin
  // the archive to it: the recorded SHA and the extracted code cannot disagree.
  const commitResponse = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/commits/HEAD`,
    { headers, redirect: "follow" },
  );

  if (!commitResponse.ok) {
    throw new Error(describeGithubError(name, commitResponse));
  }

  const commit = (await commitResponse.json()) as { sha?: unknown };
  if (typeof commit.sha !== "string" || !/^[a-f0-9]{40}$/.test(commit.sha)) {
    throw new Error(`Could not resolve commit SHA for ${name}`);
  }
  const headSha = commit.sha;

  // Fetch the tarball pinned to that SHA.
  const tarballUrl = `https://api.github.com/repos/${owner}/${repo}/tarball/${headSha}`;

  const response = await fetch(tarballUrl, { headers, redirect: "follow" });

  if (!response.ok) {
    throw new Error(describeGithubError(name, response));
  }

  // Create a temporary directory for extraction
  const tmpRoot = path.join(process.cwd(), "tmp", `repo-${createHash("sha256").update(name).digest("hex").slice(0, 12)}`);
  await rm(tmpRoot, { recursive: true, force: true });
  await mkdir(tmpRoot, { recursive: true });

  // Download the tarball to a file first, then extract it
  const tarballPath = path.join(tmpRoot, "repo.tar.gz");
  const fileStream = createWriteStream(tarballPath);

  // Convert Web ReadableStream to Node.js stream
  if (!response.body) {
    throw new Error("Empty response body");
  }

  const reader = response.body.getReader();
  const writer = fileStream;

  await new Promise<void>((resolve, reject) => {
    writer.on("finish", resolve);
    writer.on("error", reject);

    function pump(): void {
      reader.read().then(({ done, value }) => {
        if (done) {
          writer.end();
          return;
        }
        writer.write(value, (err) => {
          if (err) {
            reject(err);
            return;
          }
          pump();
        });
      }).catch(reject);
    }
    pump();
  });

  // Extract into a dedicated subdirectory. `strip: 1` removes GitHub's
  // `owner-repo-sha/` wrapper, so the repository's own files land directly in
  // `content`. The tarball stays alongside it in `tmpRoot`, which is what
  // `cleanupRepository` removes via the root's dirname.
  const contentDir = path.join(tmpRoot, "content");
  await mkdir(contentDir, { recursive: true });

  await new Promise<void>((resolve, reject) => {
    createReadStream(tarballPath)
      .pipe(extract({ cwd: contentDir, strip: 1 }))
      .on("finish", resolve)
      .on("error", reject);
  });

  return {
    root: contentDir,
    headSha,
    name,
  };
}

/**
 * Cleans up the temporary directory created by fetchRepository.
 */
export async function cleanupRepository(root: string): Promise<void> {
  const tmpRoot = path.dirname(root);
  await rm(tmpRoot, { recursive: true, force: true });
}