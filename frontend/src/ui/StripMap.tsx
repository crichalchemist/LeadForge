import type { CSSProperties, ReactNode } from 'react';
import './StripMap.css';
import type { PipelineStage } from '../types';
import { formatStage } from '../lib/measure';
import { Plate } from './Plate';
import { PlannedMark } from './PlannedMark';
import { TransferButton } from './TransferButton';

/** The main outreach route in order. Voicemail branches off Contacted; lost, disqualified and nurture can
 *  follow from several stations, and the record does not store which. */
export const MAIN_ROUTE: PipelineStage[] = [
  'scored', 'queued', 'contacted', 'engaged', 'meeting_scheduled', 'proposal_sent', 'negotiating', 'won',
];
const BRANCH_FROM: Partial<Record<PipelineStage, PipelineStage>> = { voicemail: 'contacted' };

type StationState = 'passed' | 'current' | 'ahead' | 'planned';
const STATE_WORDS: Record<StationState, string> = {
  passed: 'passed', current: 'current station', ahead: 'ahead', planned: 'planned',
};

interface StripMapProps {
  stage: PipelineStage | null;
  allowed: PipelineStage[];
  corridorName: string | null;
  canAct: boolean;
  busy: boolean;
  onStart: () => void;
  onTransfer: (to: PipelineStage) => void;
  /** A message about the route itself, such as a failed request, shown inside the Route region. */
  notice?: ReactNode;
}

/** A lead's route across both lines (DESIGN.md, Strip Map): grant first, where a corridor business meets
 *  it at the interchange; then the outreach line. Without an outreach record the whole route is planned
 *  track, dashed with hollow stations and never traced, because nothing has travelled yet. With one, past
 *  stations are solid, the current one ringed, those ahead hollow, and the grant line dims so the traced
 *  route leads. */
export function StripMap({ stage, allowed, corridorName, canAct, busy, onStart, onTransfer, notice }: StripMapProps) {
  const interchange = corridorName && <GrantInterchange corridorName={corridorName} onLine={stage !== null} />;

  return (
    <section aria-labelledby="route-title">
      <h2 id="route-title" className="font-condensed text-title uppercase">Route</h2>

      <div className="mt-4">
        {stage === null ? (
          <PlannedLine interchange={interchange} canAct={canAct} busy={busy} onStart={onStart} />
        ) : (
          <>
            {interchange}
            <OutreachLine stage={stage} allowed={allowed} canAct={canAct} busy={busy} onTransfer={onTransfer} />
          </>
        )}
      </div>
      {notice}
    </section>
  );
}

/** The interchange ring sits on the outreach line's axis, and the grant line leaves it at a right angle.
 *  Grant work does not run yet, so the grant line is planned track; while the lead rides the outreach
 *  line it takes the dim role. */
function GrantInterchange({ corridorName, onLine }: { corridorName: string; onLine: boolean }) {
  return (
    <div className={`strip-map__interchange${onLine ? ' strip-map__interchange--on-line' : ''}`}>
      <span className="strip-map__ring" aria-hidden="true" />
      <svg width="26" height="4" viewBox="0 0 26 4" aria-hidden="true" className="mt-1.5 shrink-0">
        <line
          x1="0" y1="2" x2="26" y2="2" strokeWidth="4" strokeDasharray="6 4"
          className={onLine ? 'stroke-dim' : 'stroke-line-grant'}
        />
      </svg>
      <span className="min-w-0">
        <span className={`block font-condensed text-label uppercase ${onLine ? 'text-dim' : 'text-ink-grant'}`}>
          NOF corridor
        </span>
        <span className="block text-dim">Grant line: not started · {corridorName}</span>
      </span>
    </div>
  );
}

/** The outreach route before the lead is on it: the same stations at the same spacing as OutreachLine, drawn
 *  as planned track. No trace runs here: the trace draws solid line up to a current station, and an unstarted
 *  lead has none. */
function PlannedLine({ interchange, canAct, busy, onStart }: {
  interchange: ReactNode; canAct: boolean; busy: boolean; onStart: () => void;
}) {
  return (
    <>
      <div className="strip-map__planned">
        <svg aria-hidden="true" className="strip-map__planned-track">
          <line x1="2" y1="0" x2="2" y2="100%" strokeWidth="4" strokeDasharray="6 4" className="stroke-line-outreach" />
        </svg>
        {interchange}
        <ol aria-label="Outreach line, planned" className="strip-map__planned-line">
          {MAIN_ROUTE.map((station) => (
            <Station key={station} station={station} state="planned" />
          ))}
        </ol>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <PlannedMark tone="outreach">Not on the outreach line yet</PlannedMark>
        {canAct && (
          <Plate onClick={onStart} disabled={busy}>
            {busy ? 'Starting…' : 'Start outreach'}
          </Plate>
        )}
      </div>
    </>
  );
}

function OutreachLine({ stage, allowed, canAct, busy, onTransfer }: Omit<StripMapProps, 'corridorName' | 'onStart'> & { stage: PipelineStage }) {
  const onMain = MAIN_ROUTE.indexOf(stage);
  const branchFrom = BRANCH_FROM[stage];
  // How far along the main route the lead is known to have travelled.
  const reached = onMain >= 0 ? onMain : branchFrom ? MAIN_ROUTE.indexOf(branchFrom) : -1;
  const travelled = { '--travelled': reached < 0 ? 0 : reached / (MAIN_ROUTE.length - 1) } as CSSProperties;

  return (
    <div>
      <ol aria-label="Outreach line" className="strip-map__line" style={travelled}>
        {MAIN_ROUTE.map((station, i) => (
          <Station key={station} station={station} state={station === stage ? 'current' : i <= reached ? 'passed' : 'ahead'} />
        ))}
      </ol>
      {onMain < 0 && (
        <>
          <p className="mt-4 font-condensed text-label uppercase text-dim">Off the main line</p>
          <ol aria-label="Off the main line" className="strip-map__branch">
            <Station station={stage} state="current" />
          </ol>
        </>
      )}
      {canAct && allowed.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {allowed.map((to) => (
            <TransferButton key={to} to={formatStage(to)} disabled={busy} onClick={() => onTransfer(to)} />
          ))}
        </div>
      )}
    </div>
  );
}

function Station({ station, state }: { station: PipelineStage; state: StationState }) {
  return (
    <li className={`strip-map__station strip-map__station--${state}`}>
      <span className="strip-map__tick" aria-hidden="true" />
      <span className={`font-condensed text-label uppercase ${state === 'current' ? 'text-text' : 'text-dim'}`}>
        {formatStage(station)}
      </span>
      {state === 'current' ? (
        <span className="font-condensed text-label uppercase text-dim">· current</span>
      ) : (
        <span className="sr-only">, {STATE_WORDS[state]}</span>
      )}
    </li>
  );
}
