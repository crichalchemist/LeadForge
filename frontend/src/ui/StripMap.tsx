import type { CSSProperties } from 'react';
import './StripMap.css';
import type { PipelineStage } from '../types';
import { formatStage } from '../lib/measure';
import { InterchangeMark } from './marks';
import { Plate } from './Plate';
import { PlannedMark } from './PlannedMark';
import { TransferButton } from './TransferButton';

/** The main outreach route in order. Voicemail branches off Contacted; lost, disqualified and nurture can
 *  follow from several stations, and the record does not store which. */
export const MAIN_ROUTE: PipelineStage[] = [
  'scored', 'queued', 'contacted', 'engaged', 'meeting_scheduled', 'proposal_sent', 'negotiating', 'won',
];
const BRANCH_FROM: Partial<Record<PipelineStage, PipelineStage>> = { voicemail: 'contacted' };

type StationState = 'passed' | 'current' | 'ahead';
const STATE_WORDS: Record<StationState, string> = { passed: 'passed', current: 'current station', ahead: 'ahead' };

interface StripMapProps {
  stage: PipelineStage | null;
  allowed: PipelineStage[];
  corridorName: string | null;
  canAct: boolean;
  busy: boolean;
  onStart: () => void;
  onTransfer: (to: PipelineStage) => void;
}

/** A lead's route across both lines (DESIGN.md, Strip Map): grant first, where a corridor business meets
 *  it; then the outreach line with past stations solid, the current one ringed, and those ahead hollow. */
export function StripMap({ stage, allowed, corridorName, canAct, busy, onStart, onTransfer }: StripMapProps) {
  return (
    <section aria-labelledby="route-title">
      <h2 id="route-title" className="font-condensed text-title uppercase">Route</h2>

      {corridorName && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <InterchangeMark label="NOF corridor" />
          <PlannedMark tone="grant">Grant line: not started · {corridorName}</PlannedMark>
        </div>
      )}

      {stage === null ? (
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <PlannedMark tone="outreach">Not on the outreach line yet</PlannedMark>
          {canAct && (
            <Plate onClick={onStart} disabled={busy}>
              {busy ? 'Starting…' : 'Start outreach'}
            </Plate>
          )}
        </div>
      ) : (
        <OutreachLine stage={stage} allowed={allowed} canAct={canAct} busy={busy} onTransfer={onTransfer} />
      )}
    </section>
  );
}

function OutreachLine({ stage, allowed, canAct, busy, onTransfer }: Omit<StripMapProps, 'corridorName' | 'onStart'> & { stage: PipelineStage }) {
  const onMain = MAIN_ROUTE.indexOf(stage);
  const branchFrom = BRANCH_FROM[stage];
  // How far along the main route the lead is known to have travelled.
  const reached = onMain >= 0 ? onMain : branchFrom ? MAIN_ROUTE.indexOf(branchFrom) : -1;
  const travelled = { '--travelled': reached < 0 ? 0 : reached / (MAIN_ROUTE.length - 1) } as CSSProperties;

  return (
    <div className="mt-4">
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
