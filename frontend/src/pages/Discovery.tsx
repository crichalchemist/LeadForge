import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { runDiscovery } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { statusOf } from '../lib/http';
import { formatCount, formatNiche, formatScore } from '../lib/measure';
import { NICHES, type DiscoveryRunResult, type Niche } from '../types';
import { Field, inputClass } from '../ui/Field';
import { Plate } from '../ui/Plate';

// api/src/routes/discovery.ts caps a run at 20 businesses (the Worker's 50-subrequest budget), and each
// business costs up to two Places calls: Find Place, then Details only for a corroborated candidate.
const MAX_LIMIT = 20;
const PLACES_PER_DAY = 1000;

type FieldName = 'zip_code' | 'niche' | 'limit';
const FIX: Record<FieldName, string> = {
  zip_code: 'Enter a zip code of 5 to 10 characters, such as 60619.',
  niche: 'Choose a niche from the list.',
  limit: `Choose a number from 1 to ${MAX_LIMIT}.`,
};

/** The fields a 422 names, read from the Worker's zod issue paths. */
function rejectedFields(error: unknown): FieldName[] {
  const detail = (error as { response?: { data?: { detail?: { path?: unknown[] }[] } } }).response?.data?.detail;
  if (!Array.isArray(detail)) return [];
  return detail
    .map((issue) => issue.path?.[0])
    .filter((field): field is FieldName => field === 'zip_code' || field === 'niche' || field === 'limit');
}

export default function Discovery() {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [zip, setZip] = useState('');
  const [niche, setNiche] = useState<Niche>('barbershops');
  const [limitText, setLimitText] = useState('10');

  const limit = Number.parseInt(limitText, 10);
  const validLimit = limit >= 1 && limit <= MAX_LIMIT ? limit : null;

  const run = useMutation({
    mutationFn: runDiscovery,
    // A run adds businesses, so the ranking is stale the moment it returns.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['rankedLeads'] }),
  });
  const status = run.isError ? statusOf(run.error) : null;
  const rejected = status === 422 ? rejectedFields(run.error) : [];
  const fieldError = (field: FieldName) => (rejected.includes(field) ? FIX[field] : null);

  function submit(event: FormEvent) {
    event.preventDefault();
    run.mutate({ zip_code: zip.trim(), niche, limit: validLimit ?? limit });
  }

  return (
    <div className="px-6 py-8 wide:px-10">
      <h1 className="font-condensed text-display">Discovery</h1>
      <p className="mt-3 max-w-prose text-body">
        A run searches the city’s business licences for one zip code and niche, looks each new business up on
        Google Places, and ranks it on Leads. Businesses already stored are skipped before any lookup, so running
        the same search again costs nothing for them.
      </p>

      {isAdmin ? (
        <form onSubmit={submit} noValidate className="mt-8 max-w-md space-y-5">
          <Field id="zip" label="Zip code" error={fieldError('zip_code')}>
            <input
              id="zip" inputMode="numeric" autoComplete="postal-code" value={zip} onChange={(e) => setZip(e.target.value)}
              aria-invalid={fieldError('zip_code') ? true : undefined} aria-describedby={fieldError('zip_code') ? 'zip-error' : undefined}
              className={`${inputClass} w-40`}
            />
          </Field>
          <Field id="niche" label="Niche" error={fieldError('niche')}>
            <select
              id="niche" value={niche} onChange={(e) => setNiche(e.target.value as Niche)}
              aria-invalid={fieldError('niche') ? true : undefined} aria-describedby={fieldError('niche') ? 'niche-error' : undefined}
              className={`${inputClass} w-full`}
            >
              {NICHES.map((option) => (
                <option key={option} value={option}>{formatNiche(option)}</option>
              ))}
            </select>
          </Field>
          <Field id="limit" label="Businesses to look up" error={fieldError('limit')}>
            <input
              id="limit" type="number" min={1} max={MAX_LIMIT} value={limitText} onChange={(e) => setLimitText(e.target.value)}
              aria-invalid={fieldError('limit') ? true : undefined} aria-describedby={fieldError('limit') ? 'limit-error' : undefined}
              className={`${inputClass} w-24 tabular-nums`}
            />
          </Field>

          <p className="flex flex-wrap items-center gap-3">
            {validLimit === null ? (
              <span className="text-dim">Choose from 1 to {MAX_LIMIT} businesses to see the Places cost.</span>
            ) : (
              <span className="rounded-plate bg-service-plate px-2 py-1 font-condensed text-label uppercase text-on-service-plate">
                Up to {formatCount(2 * validLimit)} Places calls
              </span>
            )}
            <span className="text-dim">Places allows {formatCount(PLACES_PER_DAY)} a day.</span>
          </p>

          <Plate type="submit" disabled={run.isPending || zip.trim() === ''}>
            {run.isPending ? 'Running…' : 'Run discovery'}
          </Plate>
        </form>
      ) : (
        <p className="mt-8 text-dim">Runs are admin-only.</p>
      )}

      <div aria-live="polite">
        {run.isPending && <ReportSkeleton />}
        {run.isError && (status !== 422 || rejected.length === 0) && (
          <p role="alert" className="mt-8 max-w-prose text-error">
            {status === 403
              ? 'Only an admin can do this.'
              : status === 422
                ? 'The Worker refused these settings. Check the zip code, niche and number of businesses.'
                : 'The run stopped. Businesses already stored are skipped next time, so a retry only spends Places calls on the rest.'}
          </p>
        )}
        {run.data && <ServiceReport result={run.data} />}
      </div>
    </div>
  );
}

function ReportSkeleton() {
  return (
    <div aria-busy="true" className="mt-10">
      <span className="sr-only">Running discovery</span>
      <div aria-hidden="true" className="space-y-3">
        <div className="h-5 w-48 rounded-plate bg-raised" />
        <div className="h-12 w-full max-w-md rounded-plate bg-raised" />
        <div className="h-24 w-full max-w-xl rounded-plate bg-raised" />
      </div>
    </div>
  );
}

function ServiceReport({ result }: { result: DiscoveryRunResult }) {
  const counts: [string, number][] = [
    ['Created', result.created],
    ['Already known', result.skipped_known],
    ['Failed', result.failed],
  ];
  const unanswered = result.places.unavailable;

  return (
    <section aria-labelledby="report-title" className="mt-10">
      <h2 id="report-title" className="font-condensed text-title uppercase">Service report</h2>
      <p className="mt-1 text-dim">
        {formatNiche(result.niche)} in {result.zip_code}, up to {result.limit} businesses.
      </p>
      <dl className="mt-4 grid max-w-md grid-cols-3 gap-4">
        {counts.map(([label, value]) => (
          <div key={label}>
            <dt className="font-condensed text-label uppercase text-dim">{label}</dt>
            <dd className="text-data tabular-nums">{formatCount(value)}</dd>
          </div>
        ))}
      </dl>
      {unanswered > 0 && (
        <p role="status" className="mt-4 inline-block rounded-plate bg-service-plate px-2 py-1 text-on-service-plate">
          {unanswered} {unanswered === 1 ? 'lookup' : 'lookups'} went unanswered ({result.places.last_status}); those businesses are stored unmeasured.
        </p>
      )}
      {result.businesses.length > 0 && (
        <ol className="mt-6 max-w-xl divide-y divide-seam border-y border-seam">
          {result.businesses.map((business) => (
            <li key={business.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <Link to={`/leads/${business.id}`} className="text-text underline">{business.name}</Link>
              <span className="text-data tabular-nums text-dim">
                Deficit {formatScore(business.digital_deficit_score)}
                {business.nof_corridor && ` · ${business.nof_corridor}`}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
