import type { ParsedFile } from "./types.ts";

/**
 * Folding. A directory tree goes in, a smaller directory tree comes out, and the
 * threshold that got it there is reported rather than guessed.
 *
 * This is a pure function over a file list. It reads no filesystem and imports
 * no framework, so it runs from a plain script alongside the rest of the parser.
 */

/** A folder after folding. Paths are repository-relative, "" at the root. */
export interface FoldNode {
  path: string;
  /** Shortest name still unique among its siblings. */
  label: string;
  /** Files held directly by this node, ordered by path. */
  files: ParsedFile[];
  children: FoldNode[];
  /** Files in this node and everything beneath it. */
  fileCount: number;
}

export interface FoldPass {
  threshold: number;
  nodeCount: number;
}

export interface FoldResult {
  root: FoldNode;
  /** The threshold that landed the node count under the target. */
  threshold: number;
  nodeCount: number;
  /** Every threshold tried, in order, so a failed search explains itself. */
  passes: FoldPass[];
}

/**
 * "Roughly two dozen" is the count the spec keeps asking for, so it is a constant
 * rather than a number buried in a loop.
 */
const TARGET_NODES = 24;

/**
 * Nothing below this threshold, so a pass either collapses far too much or stops
 * making progress. Going past it raises an error rather than quietly returning a
 * tree the caller did not ask for.
 */
const MAX_THRESHOLD = 64;

function buildTree(files: readonly ParsedFile[], rootLabel: string): FoldNode {
  const root: FoldNode = {
    path: "",
    label: rootLabel,
    files: [],
    children: [],
    fileCount: 0,
  };
  const byPath = new Map<string, FoldNode>([["", root]]);

  const ordered = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  for (const file of ordered) {
    const segments = file.folder === "." ? [] : file.folder.split("/");
    let current = root;
    let path = "";
    for (const segment of segments) {
      path = path === "" ? segment : `${path}/${segment}`;
      let child = byPath.get(path);
      if (child === undefined) {
        child = { path, label: segment, files: [], children: [], fileCount: 0 };
        byPath.set(path, child);
        current.children.push(child);
      }
      current = child;
    }
    current.files.push(file);
  }

  sortTree(root);
  recount(root);
  return root;
}

function sortTree(node: FoldNode): void {
  node.files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  node.children.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const child of node.children) sortTree(child);
}

function recount(node: FoldNode): number {
  let total = node.files.length;
  for (const child of node.children) total += recount(child);
  node.fileCount = total;
  return total;
}

function cloneTree(node: FoldNode): FoldNode {
  return {
    path: node.path,
    label: node.label,
    files: [...node.files],
    children: node.children.map(cloneTree),
    fileCount: node.fileCount,
  };
}

function depthOf(node: FoldNode): number {
  if (node.children.length === 0) return 0;
  return 1 + Math.max(...node.children.map(depthOf));
}

function collectAtDepth(node: FoldNode, depth: number, out: FoldNode[]): void {
  if (depth === 0) {
    out.push(node);
    return;
  }
  for (const child of node.children) collectAtDepth(child, depth - 1, out);
}

function removeChild(parent: FoldNode, path: string): FoldNode | null {
  const index = parent.children.findIndex((child) => child.path === path);
  if (index === -1) return null;
  const [removed] = parent.children.splice(index, 1);
  return removed ?? null;
}

/**
 * One pass of the rule: deepest directory upward, any directory holding fewer
 * than the threshold merges into its parent.
 *
 * Levels are handled one at a time and each level is read from the tree as the
 * previous level left it, so no merge can change what another merge at the same
 * depth sees.
 */
function foldAtThreshold(tree: FoldNode, threshold: number): FoldNode {
  const root = cloneTree(tree);
  const deepest = depthOf(root);

  // The root has nowhere to merge upward into, so level 0 is never considered.
  for (let level = deepest; level >= 1; level -= 1) {
    const candidates: FoldNode[] = [];
    collectAtDepth(root, level, candidates);
    for (const node of candidates) {
      if (node.fileCount >= threshold) continue;
      const parent = parentOf(root, node.path);
      if (parent === null) continue;
      const removed = removeChild(parent, node.path);
      if (removed === null) continue;
      parent.files.push(...removed.files);
      parent.children.push(...removed.children);
    }
    sortTree(root);
    recount(root);
  }

  return root;
}

/** The node one step above `path`, or null when `path` is the root. */
function parentOf(root: FoldNode, path: string): FoldNode | null {
  if (path === "") return null;
  const segments = path.split("/");
  let current = root;
  // Children are keyed by their full repository-relative path, so the prefix has
  // to be rebuilt as the walk descends rather than compared a segment at a time.
  let prefix = "";
  for (let i = 0; i < segments.length - 1; i += 1) {
    prefix = prefix === "" ? segments[i] : `${prefix}/${segments[i]}`;
    const next = current.children.find((child) => child.path === prefix);
    if (next === undefined) return null;
    current = next;
  }
  return current;
}

/**
 * The shortest prefix of each name that still tells it apart from its siblings.
 * Collisions are counted against the full sibling names, so the answer does not
 * depend on the order the siblings happen to be relabelled in.
 */
function relabel(node: FoldNode): void {
  const names = node.children.map((child) => child.path.split("/").pop() ?? child.path);
  node.children.forEach((child, index) => {
    const name = names[index] ?? child.path;
    let label = name;
    for (let length = 1; length <= name.length; length += 1) {
      const prefix = name.slice(0, length);
      const collides = names.some((other, otherIndex) => otherIndex !== index && other.startsWith(prefix));
      if (!collides) {
        label = prefix;
        break;
      }
    }
    child.label = label;
  });
  for (const child of node.children) relabel(child);
}

export interface FoldOptions {
  /** Name to show for the repository root, taken from the parse result. */
  rootLabel: string;
  targetNodes?: number;
}

/**
 * Fold until the node count lands under the target, raising the threshold one
 * step at a time. Throws rather than returning the closest attempt.
 */
export function foldDirectories(
  files: readonly ParsedFile[],
  options: FoldOptions,
): FoldResult {
  const target = options.targetNodes ?? TARGET_NODES;
  const tree = buildTree(files, options.rootLabel);
  const passes: FoldPass[] = [];

  for (let threshold = 2; threshold <= MAX_THRESHOLD; threshold += 1) {
    const folded = foldAtThreshold(tree, threshold);
    const nodeCount = countNodes(folded);
    passes.push({ threshold, nodeCount });
    if (nodeCount <= target) {
      relabel(folded);
      return { root: folded, threshold, nodeCount, passes };
    }
  }

  const tried = passes.map((pass) => `t=${pass.threshold} n=${pass.nodeCount}`).join(", ");
  throw new Error(
    `folding did not reach ${target} nodes under ${MAX_THRESHOLD}: ${tried}`,
  );
}

export function countNodes(node: FoldNode): number {
  let total = 1;
  for (const child of node.children) total += countNodes(child);
  return total;
}

/** Every file in the tree, each one listed under the node that holds it. */
export function filesInTree(node: FoldNode): ParsedFile[] {
  const out = [...node.files];
  for (const child of node.children) out.push(...filesInTree(child));
  return out;
}

/**
 * The folded node holding a file, or null when the tree holds no such file.
 *
 * A file's own `folder` cannot be used for this: folding merges directories, so the
 * folder a file was written in is often not the node that holds it afterwards.
 */
export function folderHoldingFile(root: FoldNode, filePath: string): FoldNode | null {
  if (root.files.some((file) => file.path === filePath)) return root;
  for (const child of root.children) {
    const found = folderHoldingFile(child, filePath);
    if (found !== null) return found;
  }
  return null;
}