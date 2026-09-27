import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchBusiness, fetchProvenance, fetchTransitions, startOutreach, transitionStage } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { statusOf } from '../lib/http';
import {
  formatAccount, formatCount, formatDate, formatDistance, formatNameScore, formatNiche, formatRating, formatScore, formatStage,
} from '../lib/measure';
import type { Business, Fact, FactKey, GoogleMatch, GoogleMatchStatus, LeadScore, PipelineStage, Provenance, Source } from '../types';
import { InlineError } from '../ui/InlineError';
import { PlannedMark } from '../ui/PlannedMark';
import { ScoreSegments } from '../ui/ScoreSegments';
import { SOURCE_NAME, SourceBullets } from '../ui/SourceBullets';
import { StripMap } from '../ui/StripMap';
import { SuspendedTick } from '../ui/SuspendedTick';

const FACT_LABEL: Record<FactKey, string> = {
  name: 'Name', license_status: 'Licence status', website: 'Website', phone: 'Phone',
  google_business_profile: 'Google business profile', rating: 'Google rating', review_count: 'Google reviews',
  facebook: 'Facebook', instagram: 'Instagram',
};
// One row per provenance fact (spec, Lead record), the name first, so the displayed name carries its source.
const EVIDENCE_ORDER: FactKey[] = [
  'name', 'website', 'phone', 'google_business_profile', 'rating', 'review_count', 'facebook', 'instagram', 'license_status',
];
// The facts computeDigitalDeficit reads, so their sources are the deficit term's sources.
const DEFICIT_KEYS: FactKey[] = ['website', 'google_business_profile', 'review_count', 'facebook', 'instagram'];

const GOOGLE_VERDICT: Record<GoogleMatchStatus, string> = {
  matched: 'Matched',
  rejected_distance: 'Rejected: more than 200 m from the licence address',
  rejected_name: 'Rejected: the name did not match the licence (below 0.50)',
  no_candidate: 'No matching place returned',
  unavailable: 'Lookup unavailable',
};

export default function LeadRecord({ back }: { back?: { to: string; state?: unknown } } = {}) {
  const { id = '' } = useParams();
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();

  const business = useQuery({ queryKey: ['business', id], queryFn: (): Promise<Business> => fetchBusiness(id) });
  const provenance = useQuery({ queryKey: ['provenance', id], queryFn: () => fetchProvenance(id) });
  // The rules change only with a deploy, so one fetch serves the session.
  const transitions = useQuery({ queryKey: ['transitions'], queryFn: fetchTransitions, staleTime: Infinity });

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['business', id] }),
      queryClient.invalidateQueries({ queryKey: ['rankedLeads'] }),
    ]);
  const start = useMutation({ mutationFn: () => startOutreach(id), onSettled: refresh });
  const transfer = useMutation({
    mutationFn: ({ outreachId, to }: { outreachId: string; to: PipelineStage }) => transitionStage(outreachId, to),
    onSettled: refresh,
  });

  if (business.isPending) return <RecordSkeleton back={back} />;
  if (business.isError) {
    return statusOf(business.error) === 404 ? (
      <div className="px-6 py-8 wide:px-10">
        <h1 className="font-condensed text-headline">This lead isn’t in the system</h1>
        <p className="mt-2 text-dim">It may have been removed after the list was loaded.</p>
        <Link to={back?.to ?? '/leads'} state={back?.state} className="mt-4 inline-block underline">Back to leads</Link>
      </div>
    ) : (
      <div className="px-6 py-8 wide:px-10">
        {back && (
          <Link to={back.to} state={back.state} className="font-condensed text-label uppercase text-dim underline">
            Back to leads
          </Link>
        )}
        <InlineError what="this lead" onRetry={() => business.refetch()} />
      </div>
    );
  }

  const record = business.data;
  const outreach = record.outreach_records[0] ?? null;
  const stage = (outreach?.status ?? null) as PipelineStage | null;
  const allowed = stage && transitions.data ? (transitions.data[stage] ?? []) : [];
  const score = record.lead_scores[0] ?? null;
  const facts = provenance.data?.facts ?? [];
  const license = provenance.data?.license ?? null;
  const actionError = start.error ?? transfer.error;

  return (
    <article aria-labelledby="record-title" className="px-6 py-8 wide:px-10">
      {back && (
        <Link to={back.to} state={back.state} className="font-condensed text-label uppercase text-dim underline">
          Back to leads
        </Link>
      )}
      <header>
        <h1 id="record-title" className="font-condensed text-headline">{record.name}</h1>
        <p className="mt-1 font-condensed text-label uppercase text-dim">
          {formatNiche(record.niche)} · {record.zip_code}
          {license && ` · ${formatAccount(license.account_number, license.site_number)}`}
        </p>
        {license?.license_name && license.license_name !== record.name && (
          <p className="mt-2 flex items-center gap-2 text-dim">
            Licensed as {license.license_name} <SourceBullets sources={['license']} />
          </p>
        )}
      </header>

      <div className="mt-8">
        <StripMap
          stage={stage}
          allowed={allowed}
          corridorName={record.in_nof_corridor ? (record.nof_corridor_name ?? 'NOF corridor') : null}
          canAct={isAdmin}
          busy={start.isPending || transfer.isPending}
          onStart={() => start.mutate()}
          onTransfer={(to) => outreach && transfer.mutate({ outreachId: outreach.id, to })}
        />
        {actionError && (
          <p role="alert" className="mt-3 text-error">{actionMessage(actionError, stage, allowed)}</p>
        )}
      </div>

      <section aria-labelledby="score-title" className="mt-10">
        <h2 id="score-title" className="font-condensed text-title uppercase">Score</h2>
        <CompositeLine score={score} provenance={provenance.data ?? null} />
        {score && score.composite_acquisition_score !== null && (
          <div className="mt-4 max-w-2xl">
            <ScoreSegments score={score} deficitSources={unionSources(facts, DEFICIT_KEYS)} />
          </div>
        )}
      </section>

      <section aria-labelledby="evidence-title" className="mt-10">
        <h2 id="evidence-title" className="font-condensed text-title uppercase">Evidence</h2>
        {provenance.isPending ? (
          <RowsSkeleton />
        ) : provenance.isError ? (
          <InlineError what="the evidence" onRetry={() => provenance.refetch()} />
        ) : (
          <EvidenceList facts={facts} />
        )}
      </section>

      {provenance.data && (
        <section aria-labelledby="sources-title" className="mt-10">
          <h2 id="sources-title" className="font-condensed text-title uppercase">Sources</h2>
          <SourcesPanel provenance={provenance.data} />
        </section>
      )}

      <section aria-labelledby="planned-title" className="mt-10">
        <h2 id="planned-title" className="font-condensed text-title uppercase">Planned</h2>
        <ul className="mt-3 space-y-2">
          <li><PlannedMark>Outreach briefs: not running yet</PlannedMark></li>
          <li><PlannedMark>AI calls: not running yet</PlannedMark></li>
        </ul>
      </section>
    </article>
  );
}

function actionMessage(error: unknown, stage: PipelineStage | null, allowed: PipelineStage[]): string {
  switch (statusOf(error)) {
    case 403:
      return 'Only an admin can do this.';
    case 409:
      return 'This lead was already on the outreach line; its station is shown above.';
    case 422:
      return `That move isn’t allowed from ${stage ? formatStage(stage) : 'here'}. Allowed: ${allowed.map(formatStage).join(', ') || 'none'}.`;
    default:
      return 'The change didn’t go through. Try again.';
  }
}

function unionSources(facts: Fact[], keys: FactKey[]): Source[] {
  const sources = new Set<Source>();
  for (const f of facts) if (keys.includes(f.key) && f.state === 'found') f.sources.forEach((s) => sources.add(s));
  return [...sources];
}

function CompositeLine({ score, provenance }: { score: LeadScore | null; provenance: Provenance | null }) {
  const composite = score?.composite_acquisition_score ?? null;
  if (composite === null) {
    // Discovery stores a null deficit only when a Places lookup was refused (ADR 031); a business stored
    // before migration 0005 has no Google row to say why.
    const reason =
      provenance === null ? 'not measured'
        : provenance.google?.status === 'unavailable' ? 'Places was unavailable during discovery'
          : provenance.google === null ? 'not recorded'
            : 'not measured';
    return (
      <p className="mt-3 flex flex-wrap items-center gap-3">
        <span className="font-condensed text-label uppercase text-dim">Composite</span>
        <SuspendedTick label={reason} />
      </p>
    );
  }
  return (
    <p className="mt-3 flex flex-wrap items-center gap-3">
      <span className="font-condensed text-label uppercase text-dim">Composite</span>
      <span className="text-data tabular-nums">{formatScore(composite)}</span>
      <span className="text-dim">version {score!.score_version}</span>
      {score!.score_version === 1 && <PlannedMark>v1 · preliminary</PlannedMark>}
    </p>
  );
}

function EvidenceList({ facts }: { facts: Fact[] }) {
  const byKey = new Map(facts.map((f) => [f.key, f]));
  return (
    <dl className="mt-3 divide-y divide-seam border-y border-seam">
      {EVIDENCE_ORDER.map((key) => {
        const fact = byKey.get(key);
        if (!fact) return null;
        const detail = detailLine(fact);
        return (
          <div key={key} className="grid gap-1 py-3 rail:grid-cols-[14rem_minmax(0,1fr)]">
            <dt className="font-condensed text-label uppercase text-dim">{FACT_LABEL[key]}</dt>
            <dd>
              <span className="flex flex-wrap items-center gap-2">
                {factValue(fact)}
                {fact.state === 'found' && <SourceBullets sources={fact.sources} />}
              </span>
              {detail && <span className="mt-1 block text-dim">{detail}</span>}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function factValue(fact: Fact): ReactNode {
  if (fact.state === 'none_found') return <span className="text-dim">none found</span>;
  if (fact.state === 'unknown') return <SuspendedTick label="unknown" />;
  if (fact.state === 'not_recorded') return <span className="text-dim">not recorded</span>;
  const { key, value } = fact;
  if (key === 'website' && typeof value === 'string') {
    return <a href={value} target="_blank" rel="noopener noreferrer" className="break-all underline">{value}</a>;
  }
  if (key === 'rating' && typeof value === 'number') return <span className="tabular-nums">{formatRating(value)}</span>;
  if (key === 'review_count' && typeof value === 'number') return <span className="tabular-nums">{formatCount(value)}</span>;
  if (key === 'google_business_profile') return 'Listed on Google';
  if (key === 'facebook' || key === 'instagram') return 'Linked';
  return String(value);
}

function detailLine(fact: Fact): string | null {
  if (fact.state === 'unknown') {
    return fact.key === 'facebook' || fact.key === 'instagram'
      ? 'The Overture build has not covered this licence.'
      : 'Places was unavailable when this business was discovered.';
  }
  if (fact.state === 'not_recorded') return 'Stored before sources were recorded.';
  if (fact.state === 'found' && fact.sources.length === 0) return 'Source not recorded.';
  return null;
}

function SourcesPanel({ provenance }: { provenance: Provenance }) {
  const { license, google, overture } = provenance;
  return (
    <div className="mt-3 grid gap-6 rail:grid-cols-3">
      <SourceBlock
        source="license"
        rows={[
          ['Account', formatAccount(license.account_number, license.site_number)],
          ['Licence number', license.license_number ?? 'not recorded'],
          ['Status', license.license_status ?? 'not recorded'],
          ['Issued', formatDate(license.license_issue_date)],
        ]}
      />
      <SourceBlock source="google" rows={google ? googleRows(google) : null} empty="Not recorded: stored before sources were recorded." />
      <SourceBlock
        source="overture"
        rows={
          overture
            ? [
                ['Match', overture.matched === 1 ? 'Matched' : 'No match'],
                ['Matched name', overture.matched_name ?? 'none'],
                ['Name score', formatNameScore(overture.score)],
                ['Distance', formatDistance(overture.distance_m)],
                ['Build', formatDate(overture.built_at)],
              ]
            : null
        }
        empty="Not covered by the Overture build."
      />
    </div>
  );
}

function googleRows(google: GoogleMatch): [string, string][] {
  return [
    ['Verdict', GOOGLE_VERDICT[google.status]],
    ['Matched name', google.matched_name ?? 'none'],
    ['Name score', formatNameScore(google.score)],
    ['Distance', formatDistance(google.distance_m)],
  ];
}

function SourceBlock({ source, rows, empty }: { source: Source; rows: [string, string][] | null; empty?: string }) {
  return (
    <div>
      <h3 className="flex items-center gap-2 font-condensed text-label uppercase">
        <span aria-hidden="true"><SourceBullets sources={[source]} /></span>
        {SOURCE_NAME[source]}
      </h3>
      {rows ? (
        <dl className="mt-2 space-y-1">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-3">
              <dt className="text-dim">{label}</dt>
              <dd className="text-right tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-2 text-dim">{empty}</p>
      )}
    </div>
  );
}

function RecordSkeleton({ back }: { back?: { to: string; state?: unknown } }) {
  return (
    <div aria-busy="true" className="px-6 py-8 wide:px-10">
      {back && (
        <Link to={back.to} state={back.state} className="font-condensed text-label uppercase text-dim underline">
          Back to leads
        </Link>
      )}
      <span className="sr-only">Loading the lead</span>
      <div aria-hidden="true" className="space-y-3">
        <div className="h-7 w-72 max-w-full rounded-plate bg-raised" />
        <div className="h-4 w-56 max-w-full rounded-plate bg-raised" />
        <div className="mt-8 h-40 w-full max-w-md rounded-region bg-raised" />
      </div>
    </div>
  );
}

function RowsSkeleton() {
  return (
    <div aria-busy="true" className="mt-3">
      <span className="sr-only">Loading the evidence</span>
      <div aria-hidden="true" className="space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-5 rounded-plate bg-raised" />
        ))}
      </div>
    </div>
  );
}
