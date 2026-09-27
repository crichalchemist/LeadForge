import type { ReactNode } from 'react';

/** The interchange: a 14px hollow ring with a 3px stroke, where a corridor business meets the grant line.
 *  The words carry the meaning; the ring is the diagram's mark for it. */
export function InterchangeMark({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-condensed text-label uppercase text-ink-grant">
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" className="shrink-0 stroke-text">
        <circle cx="7" cy="7" r="5.5" fill="none" strokeWidth="3" />
      </svg>
      {label}
    </span>
  );
}

const BAR = { outreach: 'bg-line-outreach', grant: 'bg-line-grant' } as const;
const INK = { outreach: 'text-ink-outreach', grant: 'text-ink-grant' } as const;

/** Which pipeline a lead rides: a short 4px bar in the line's color, plus words (DESIGN.md, Chips). */
export function LineBullet({ line, children }: { line: 'outreach' | 'grant'; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 font-condensed text-label uppercase ${INK[line]}`}>
      <span aria-hidden="true" className={`h-1 w-3 rounded-full ${BAR[line]}`} />
      {children}
    </span>
  );
}
