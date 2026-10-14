import type { ReactNode } from "react";

/**
 * Hand-rolled because there is no icon package here and one is not worth asking
 * for. Every glyph is drawn on the same 16-unit grid with the same stroke, so the
 * set reads as one hand rather than as a font that happened to be installed.
 *
 * Size is fixed per icon rather than passed in: nothing on this screen needs the
 * same mark at two sizes, and a `className` that could restate the size is a way
 * for two icons to disagree. Colour is whatever `currentColor` is.
 */
function Glyph({ children, size }: { children: ReactNode; size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      className="shrink-0"
    >
      {children}
    </svg>
  );
}

/** The product's subject: a pair of braces. Brand, nav, and the empty state. */
export function BracesIcon({ size = 12 }: { size?: number }) {
  return (
    <Glyph size={size}>
      <path d="M6.5 3.5c-1.4 0-2 .8-2 2v.9c0 1-.5 1.6-1.5 1.6 1 0 1.5.6 1.5 1.6v.9c0 1.2.6 2 2 2" />
      <path d="M9.5 3.5c1.4 0 2 .8 2 2v.9c0 1 .5 1.6 1.5 1.6-1 0-1.5.6-1.5 1.6v.9c0 1.2-.6 2-2 2" />
    </Glyph>
  );
}

/* The four states the schema allows, told apart by shape alone. A ring is waiting
   and a broken ring is mid-work; a tick and a cross need no hue to be read, which
   matters because green and amber here already mean edge direction. */
export function PendingIcon() {
  return (
    <Glyph size={12}>
      <circle cx="8" cy="8" r="4.75" />
    </Glyph>
  );
}

export function RunningIcon() {
  return (
    <Glyph size={12}>
      <path d="M8 3.25a4.75 4.75 0 1 1-3.6 7.9" />
    </Glyph>
  );
}

export function SucceededIcon() {
  return (
    <Glyph size={12}>
      <path d="m3.5 8.5 3 3 6-7" />
    </Glyph>
  );
}

export function FailedIcon() {
  return (
    <Glyph size={12}>
      <path d="m4.75 4.75 6.5 6.5M11.25 4.75l-6.5 6.5" />
    </Glyph>
  );
}

export function MembersIcon() {
  return (
    <Glyph size={12}>
      <circle cx="6.25" cy="6" r="2.5" />
      <path d="M2 13.5a4.25 4.25 0 0 1 8.5 0" />
      <path d="M11 3.9a2.5 2.5 0 0 1 0 4.9M12.6 13.5a4.25 4.25 0 0 0-1.3-3" />
    </Glyph>
  );
}

export function InfoIcon() {
  return (
    <Glyph size={12}>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 7.5V11" />
      <path d="M8 5.1h.01" />
    </Glyph>
  );
}

/* The appearance control's three states. They are labelled for a screen reader
   and named in the source; the icon is the visible half of that name. */
export function SystemIcon() {
  return (
    <Glyph size={14}>
      <rect x="1.75" y="3" width="12.5" height="7.75" rx="1" />
      <path d="M5.5 13.75h5M8 10.75v3" />
    </Glyph>
  );
}

export function LightIcon() {
  return (
    <Glyph size={14}>
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5v1.75M8 12.75v1.75M1.5 8h1.75M12.75 8h1.75M3.4 3.4l1.25 1.25M11.35 11.35l1.25 1.25M12.6 3.4l-1.25 1.25M4.65 11.35L3.4 12.6" />
    </Glyph>
  );
}

export function DarkIcon() {
  return (
    <Glyph size={14}>
      <path d="M13.25 9.75A5.75 5.75 0 0 1 6.25 2.75a5.75 5.75 0 1 0 7 7Z" />
    </Glyph>
  );
}