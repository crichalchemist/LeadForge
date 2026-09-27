import { Link } from 'react-router-dom';
import type { RankedLead } from '../types';
import { formatAccount, formatNiche, formatScore, formatStage } from '../lib/measure';
import { InterchangeMark, LineBullet } from './marks';
import { PlannedMark } from './PlannedMark';
import { SuspendedTick } from './SuspendedTick';

/** A ranked lead as a station on the table's 2px route line (DESIGN.md, Route Row): the rank, the label
 *  grid (name, then niche · zip · licence account), line bullets, and the composite in tabular figures.
 *  An unmeasured composite is a suspended tick in words, never a number. */
export function RouteRow({ lead, rank, to, selected = false }: { lead: RankedLead; rank: number; to: string; selected?: boolean }) {
  return (
    <li>
      <Link
        to={to}
        data-row={lead.business_id}
        aria-current={selected ? 'true' : undefined}
        className="grid min-h-[52px] grid-cols-[2rem_14px_minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-[10px] text-data transition-colors duration-state ease-out-expo hover:bg-raised aria-[current=true]:bg-raised"
      >
        <span className="text-right tabular-nums text-dim">{rank}</span>
        <span
          aria-hidden="true"
          className="relative flex h-full items-center justify-center before:absolute before:inset-y-[-10px] before:left-1/2 before:w-0.5 before:-translate-x-1/2 before:bg-edge"
        >
          <span className="relative h-2.5 w-2.5 rounded-full bg-text ring-2 ring-ground" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-text">{lead.business_name}</span>
          <span className="block truncate font-condensed text-label uppercase text-dim">
            {formatNiche(lead.niche)} · {lead.zip_code} · {formatAccount(lead.account_number, lead.site_number)}
          </span>
        </span>
        <span className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
          {lead.in_nof_corridor && <InterchangeMark label="NOF corridor" />}
          {lead.pipeline_stage && <LineBullet line="outreach">{formatStage(lead.pipeline_stage)}</LineBullet>}
          {lead.composite_acquisition_score === null ? (
            <SuspendedTick label="not measured" />
          ) : (
            <span className="flex items-center gap-2">
              <span className="tabular-nums text-text">{formatScore(lead.composite_acquisition_score)}</span>
              {lead.score_version === 1 && <PlannedMark>v1 · preliminary</PlannedMark>}
            </span>
          )}
        </span>
      </Link>
    </li>
  );
}
