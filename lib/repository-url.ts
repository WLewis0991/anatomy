/** Where the landing page leaves a repository while the visitor signs in. */
export const PENDING_REPOSITORY_KEY = "anatomy.pending-repository";

/** A trailing `.git` on the repository segment is not part of its name. */
function stripGitSuffix(segment: string): string {
  return segment.endsWith(".git") ? segment.slice(0, -4) : segment;
}

/**
 * Normalizes a GitHub repository URL to an `owner/repo` string.
 * Accepts HTTPS, SSH, and bare `owner/repo` forms.
 *
 * The repository segment is matched greedily up to the next `/`, `?` or `#`, so a
 * URL carrying `/tree/<branch>`, a query or a fragment still yields the repository.
 * A lazy match with an optional trailing group would stop at one character.
 *
 * Kept free of Node imports so the landing page can validate the same input the
 * API and pipeline accept.
 */
export function normalizeRepositoryUrl(input: string): string {
  const trimmed = input.trim();

  if (trimmed === "") {
    throw new Error("Repository URL is empty.");
  }

  const httpsMatch = trimmed.match(/^https?:\/\/(?:www\.)?github\.com\/([^/?#]+)\/([^/?#]+)/i);
  if (httpsMatch) {
    return `${httpsMatch[1].toLowerCase()}/${stripGitSuffix(httpsMatch[2]).toLowerCase()}`;
  }

  const sshMatch = trimmed.match(/^git@github\.com:([^/?#]+)\/([^/?#]+)/i);
  if (sshMatch) {
    return `${sshMatch[1].toLowerCase()}/${stripGitSuffix(sshMatch[2]).toLowerCase()}`;
  }

  const bareMatch = trimmed.match(/^([^/\s:]+)\/([^/\s:]+)$/);
  if (bareMatch) {
    return `${bareMatch[1].toLowerCase()}/${stripGitSuffix(bareMatch[2]).toLowerCase()}`;
  }

  throw new Error(
    "Could not parse repository URL. Expected formats: owner/repo, https://github.com/owner/repo, or git@github.com:owner/repo",
  );
}
