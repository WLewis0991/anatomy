"use client";

import { Fragment, useMemo, type ReactNode } from "react";

/**
 * The explanation renderer.
 *
 * The prompt permits exactly inline code, bold and bullets. Rendering only those
 * is deliberate: forbidding formatting does not make a model stop producing it,
 * it makes the pane print the markers. Anything outside the permitted three is
 * removed rather than shown as punctuation.
 *
 * Every repository path in the prose is a button that moves the map, including
 * paths inside inline code and bold.
 */

interface ExplanationTextProps {
  body: string;
  paths: ReadonlySet<string>;
  onSelectPath: (path: string) => void;
}

type Block =
  | { type: "paragraph"; text: string }
  | { type: "bullets"; items: string[] };

export function ExplanationText({ body, paths, onSelectPath }: ExplanationTextProps) {
  const blocks = useMemo(() => parseBlocks(body), [body]);

  return (
    <div className="space-y-2 text-sm leading-relaxed text-fg">
      {blocks.map((block, blockIndex) =>
        block.type === "paragraph" ? (
          <p key={blockIndex}>{renderInline(block.text, `p${blockIndex}`, paths, onSelectPath)}</p>
        ) : (
          <ul key={blockIndex} className="list-disc space-y-1 pl-4">
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>
                {renderInline(item, `b${blockIndex}-${itemIndex}`, paths, onSelectPath)}
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}

function parseBlocks(body: string): Block[] {
  const blocks: Block[] = [];
  let current: Block | null = null;

  for (const raw of body.split("\n")) {
    const line = raw.trimEnd();
    if (line.trim() === "") {
      current = null;
      continue;
    }

    const bullet = line.match(/^\s*-\s+(.*)$/);
    if (bullet) {
      if (current?.type !== "bullets") {
        current = { type: "bullets", items: [] };
        blocks.push(current);
      }
      current.items.push(bullet[1] ?? "");
      continue;
    }

    if (current?.type !== "paragraph") {
      current = { type: "paragraph", text: "" };
      blocks.push(current);
    }
    const next = line.trim();
    current.text = current.text === "" ? next : `${current.text} ${next}`;
  }

  return blocks;
}

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`)/g;

function renderInline(
  text: string,
  keyPrefix: string,
  paths: ReadonlySet<string>,
  onSelectPath: (path: string) => void,
): ReactNode[] {
  const parts = text.split(INLINE);

  return parts.map((part, index) => {
    const key = `${keyPrefix}-${index}`;

    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={key}>{linkPaths(plain(part.slice(2, -2)), `${key}-s`, paths, onSelectPath)}</strong>;
    }

    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code key={key} className="rounded-[2px] bg-surface-2 px-1 font-mono text-xs text-fg">
          {linkPaths(part.slice(1, -1), `${key}-c`, paths, onSelectPath)}
        </code>
      );
    }

    return <Fragment key={key}>{linkPaths(plain(part), key, paths, onSelectPath)}</Fragment>;
  });
}

/**
 * Markers that reached the renderer unmatched are removed. A literal asterisk
 * left in prose is the failure the acceptance check names, and there is no
 * meaning worth preserving in a stray one.
 */
function plain(text: string): string {
  return text.replace(/[`*#]/g, "");
}

/** Splits on whitespace and links a whole token when it is an exact path. */
function linkPaths(
  text: string,
  keyPrefix: string,
  paths: ReadonlySet<string>,
  onSelectPath: (path: string) => void,
): ReactNode[] {
  if (paths.size === 0 || text === "") return [text];

  return text.split(/(\s+)/).map((token, index) => {
    if (token.trim() === "") return token;

    const match = token.match(/^([("'\[]*)(.*?)([)"'\].,;:!?]*)$/);
    const core = match?.[2] ?? token;
    if (!paths.has(core)) return token;

    return (
      <Fragment key={`${keyPrefix}-${index}`}>
        {match?.[1]}
        <button
          type="button"
          className="rounded-[2px] font-mono text-xs text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
          onClick={() => onSelectPath(core)}
        >
          {core}
        </button>
        {match?.[3]}
      </Fragment>
    );
  });
}
