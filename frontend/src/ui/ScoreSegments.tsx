import type { LeadScore, Source } from '../types';
import { formatScore } from '../lib/measure';
import { PlannedMark } from './PlannedMark';
import { SourceBullets } from './SourceBullets';

const TERMS = [
  { key: 'digital_deficit_score', label: 'Digital deficit', weight: 40 },
  { key: 'viability_score', label: 'Viability', weight: 35 },
  { key: 'competitive_pressure_score', label: 'Competitive pressure', weight: 25 },
] as const;

/** The composite as one line in three segments sized by weight: 40% deficit, 35% viability, 25% pressure
 *  (DESIGN.md, Score Segments). A missing term is dashed and named, never drawn as zero. Only the deficit
 *  has evidence behind it in version 1, so only it carries source bullets. The line stays proportional at
 *  every width. Each term sits under its own segment only from the rail breakpoint up to wide, where the
 *  record has the full working width; on a phone and in the seven-column record beside the list, the terms
 *  are listed as rows under the line, so none breaks mid-phrase. */
export function ScoreSegments({ score, deficitSources }: { score: LeadScore; deficitSources: Source[] }) {
  return (
    <div>
      <div aria-hidden="true" className="flex gap-1">
        {TERMS.map((term) => {
          const measured = score[term.key] !== null;
          return (
            <span key={term.key} style={{ flexGrow: term.weight, flexBasis: 0 }} className="min-w-0">
              <svg width="100%" height="4" className="block">
                <line
                  x1="0" y1="2" x2="100%" y2="2" strokeWidth="4"
                  strokeDasharray={measured ? undefined : '6 4'}
                  className={measured ? 'stroke-text' : 'stroke-edge'}
                />
              </svg>
            </span>
          );
        })}
      </div>
      <ol aria-label="Composite terms" className="mt-2 space-y-2 rail:max-wide:flex rail:max-wide:gap-1 rail:max-wide:space-y-0">
        {TERMS.map((term) => {
          const value = score[term.key];
          const measured = value !== null;
          return (
            <li
              key={term.key}
              style={{ flexGrow: term.weight, flexBasis: 0 }}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rail:max-wide:block rail:max-wide:min-w-0"
            >
              <p className="whitespace-nowrap font-condensed text-label uppercase text-dim rail:max-wide:whitespace-normal">
                {term.label} · {term.weight}%
              </p>
              <p className="flex items-center gap-2 whitespace-nowrap text-data tabular-nums rail:max-wide:mt-1 rail:max-wide:whitespace-normal">
                {measured ? formatScore(value) : <PlannedMark>not measured</PlannedMark>}
                {measured && term.key === 'digital_deficit_score' && <SourceBullets sources={deficitSources} />}
              </p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
