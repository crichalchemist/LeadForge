import type { ReactNode } from 'react';

type Tone = 'neutral' | 'outreach' | 'grant';
const STROKE: Record<Tone, string> = { neutral: 'stroke-edge', outreach: 'stroke-line-outreach', grant: 'stroke-line-grant' };

/** The Planned Track Rule: a version-1 score, a value never measured, or a feature not running yet is drawn
 *  dashed (6/4) and named in words, never as a solid mark or a zero. A line's tone is used only on its own
 *  line's track. */
export function PlannedMark({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  return (
    <span className="inline-flex items-center gap-2 text-dim">
      <svg width="24" height="4" viewBox="0 0 24 4" aria-hidden="true" className="shrink-0">
        <line x1="0" y1="2" x2="24" y2="2" strokeWidth="2" strokeDasharray="6 4" className={STROKE[tone]} />
      </svg>
      <span>{children}</span>
    </span>
  );
}
