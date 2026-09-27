import { Link } from 'react-router-dom';
import type { RankedLead } from '../types';
import { formatAccount, formatNiche, formatScore, formatStage } from '../lib/measure';
import { InterchangeMark, LineBullet } from './marks';
import { PlannedMark } from './PlannedMark';
import { SuspendedTick } from './SuspendedTick';

interface RouteRowProps {
  lead: RankedLead;
  rank: number;
  to: string;
  selected?: boolean;
  /** The list is the master column beside an open record. */
  besideRecord?: boolean;
}

/** A ranked lead as a station on the table's 2px route line (DESIGN.md, Route Row): the rank, the label
 *  grid (name, then niche · zip · licence account), line bullets, and the composite in tabular figures.
 *  An unmeasured composite is a suspended tick in words, never a number. Beside an open record the row is
 *  compact, its right-hand cluster moved under the label grid so the name keeps the column's full width,
 *  and every station but the open lead's dims; the text stays at full contrast for triage. data-station lets
 *  a test find a row's station. */
export function RouteRow({ lead, rank, to, selected = false, besideRecord = false }: RouteRowProps) {
  const cluster = (
    <span className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${besideRecord ? 'mt-1' : 'justify-end'}`}>
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
  );

  return (
    <li>
      <Link
        to={to}
        data-row={lead.business_id}
        aria-current={selected ? 'true' : undefined}
        className={`grid min-h-[52px] gap-x-3 px-4 py-[10px] text-data transition-colors duration-state ease-out-expo hover:bg-raised aria-[current=true]:bg-raised ${
          besideRecord ? 'grid-cols-[2rem_14px_minmax(0,1fr)] items-start' : 'grid-cols-[2rem_14px_minmax(0,1fr)_auto] items-center'
        }`}
      >
        <span className="text-right tabular-nums text-dim">{rank}</span>
        <span
          aria-hidden="true"
          className={`relative flex h-full justify-center before:absolute before:inset-y-[-10px] before:left-1/2 before:w-0.5 before:-translate-x-1/2 before:bg-edge ${
            besideRecord ? 'items-start pt-[5px]' : 'items-center'
          }`}
        >
          <span
            data-station=""
            className={`relative h-2.5 w-2.5 rounded-full ring-2 ring-ground ${besideRecord && !selected ? 'bg-dim' : 'bg-text'}`}
          />
        </span>
        {/* One line in the full-width list; beside a record the name and label grid wrap rather than cut
            off, and the account never breaks inside itself. */}
        <span className="min-w-0">
          <span className={`block text-text ${besideRecord ? 'break-words' : 'truncate'}`}>{lead.business_name}</span>
          <span className={`block font-condensed text-label uppercase text-dim ${besideRecord ? '' : 'truncate'}`}>
            {formatNiche(lead.niche)} · {lead.zip_code} ·{' '}
            <span className="whitespace-nowrap">{formatAccount(lead.account_number, lead.site_number)}</span>
          </span>
          {besideRecord && cluster}
        </span>
        {!besideRecord && cluster}
      </Link>
    </li>
  );
}
