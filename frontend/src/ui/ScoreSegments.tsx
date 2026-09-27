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
 *  has evidence behind it in version 1, so only it carries source bullets. */
export function ScoreSegments({ score, deficitSources }: { score: LeadScore; deficitSources: Source[] }) {
  return (
    <ol aria-label="Composite terms" className="flex gap-1">
      {TERMS.map((term) => {
        const value = score[term.key];
        const measured = value !== null;
        return (
          <li key={term.key} style={{ flexGrow: term.weight, flexBasis: 0 }} className="min-w-0">
            <svg width="100%" height="4" aria-hidden="true" className="block">
              <line
                x1="0" y1="2" x2="100%" y2="2" strokeWidth="4"
                strokeDasharray={measured ? undefined : '6 4'}
                className={measured ? 'stroke-text' : 'stroke-edge'}
              />
            </svg>
            <p className="mt-2 font-condensed text-label uppercase text-dim">{term.label} · {term.weight}%</p>
            <p className="mt-1 flex items-center gap-2 text-data tabular-nums">
              {measured ? formatScore(value) : <PlannedMark>not measured</PlannedMark>}
              {measured && term.key === 'digital_deficit_score' && <SourceBullets sources={deficitSources} />}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
