import { useEffect, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { fetchRankedLeads } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { formatCount, formatNiche } from '../lib/measure';
import { useMediaQuery } from '../lib/useMediaQuery';
import { NICHES, type PaginatedResponse, type RankedLead } from '../types';
import { Field, inputClass } from '../ui/Field';
import { InlineError } from '../ui/InlineError';
import { PlateLink } from '../ui/Plate';
import { RouteRow } from '../ui/RouteRow';
import { secondaryClass } from '../ui/TransferButton';
import LeadRecord from './LeadRecord';

const PAGE_SIZE = 50;
const WIDE = '(min-width: 1200px)'; // DESIGN.md, Layout: master-detail at 1200px and wider

export default function Leads() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const wide = useMediaQuery(WIDE);
  const { isAdmin } = useAuth();

  const zip = params.get('zip') ?? '';
  const niche = params.get('niche') ?? '';
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1);
  const search = params.toString() ? `?${params.toString()}` : '';

  const leads = useQuery({
    queryKey: ['rankedLeads', { zip, niche, page }],
    queryFn: (): Promise<PaginatedResponse<RankedLead>> =>
      fetchRankedLeads({ page, page_size: PAGE_SIZE, ...(zip && { zip_code: zip }), ...(niche && { niche }) }),
  });

  // Coming back from a record on a narrow screen returns focus to the row it was opened from.
  const focusRow = (location.state as { focusRow?: string } | null)?.focusRow;
  useEffect(() => {
    if (focusRow && leads.isSuccess) document.querySelector<HTMLElement>(`[data-row="${focusRow}"]`)?.focus();
  }, [focusRow, leads.isSuccess]);

  const setFilters = (next: { zip?: string; niche?: string; page?: number }) => {
    const merged = { zip, niche, page: '', ...next, ...(next.page ? { page: String(next.page) } : {}) };
    setParams(Object.fromEntries(Object.entries(merged).filter(([, value]) => value !== '')) as Record<string, string>);
  };

  if (id && !wide) return <LeadRecord key={id} back={{ to: `/leads${search}`, state: { focusRow: id } }} />;

  return (
    <div className={id ? 'wide:grid wide:grid-cols-12' : undefined}>
      <section
        aria-labelledby="leads-title"
        className={`px-6 py-8 ${id ? 'wide:col-span-5 wide:border-r wide:border-seam' : 'wide:px-10'}`}
      >
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h1 id="leads-title" className="font-condensed text-display">Leads</h1>
          {isAdmin &&
            (id ? (
              <Link to="/discovery" className={secondaryClass}>Plan a run</Link>
            ) : (
              <PlateLink to="/discovery">Plan a run</PlateLink>
            ))}
        </div>
        <Filters zip={zip} niche={niche} onApply={(next) => setFilters(next)} />
        <LeadList leads={leads} page={page} search={search} selectedId={id} filtered={zip !== '' || niche !== ''} onPage={(p) => setFilters({ page: p })} />
      </section>
      {id && (
        <div className="wide:col-span-7">
          <LeadRecord key={id} />
        </div>
      )}
    </div>
  );
}

function Filters({ zip, niche, onApply }: { zip: string; niche: string; onApply: (next: { zip: string; niche: string }) => void }) {
  const [zipText, setZipText] = useState(zip);
  useEffect(() => setZipText(zip), [zip]);

  return (
    <form
      role="search"
      aria-label="Filter leads"
      className="mt-6 flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        onApply({ zip: zipText.trim(), niche });
      }}
    >
      <Field id="filter-zip" label="Zip code" error={null}>
        <input id="filter-zip" inputMode="numeric" value={zipText} onChange={(e) => setZipText(e.target.value)} className={`${inputClass} w-32`} />
      </Field>
      <Field id="filter-niche" label="Niche" error={null}>
        <select
          id="filter-niche"
          value={niche}
          onChange={(e) => onApply({ zip: zipText.trim(), niche: e.target.value })}
          className={inputClass}
        >
          <option value="">All niches</option>
          {NICHES.map((option) => (
            <option key={option} value={option}>{formatNiche(option)}</option>
          ))}
        </select>
      </Field>
      <button type="submit" className={secondaryClass}>Filter</button>
    </form>
  );
}

interface LeadListProps {
  leads: UseQueryResult<PaginatedResponse<RankedLead>>;
  page: number;
  search: string;
  selectedId: string | undefined;
  filtered: boolean;
  onPage: (page: number) => void;
}

function LeadList({ leads, page, search, selectedId, filtered, onPage }: LeadListProps) {
  if (leads.isPending) return <ListSkeleton />;
  if (leads.isError) return <InlineError what="the leads" onRetry={() => leads.refetch()} />;

  const { items, total } = leads.data;
  if (total === 0) {
    return filtered ? (
      <p className="mt-8 text-dim">
        No leads match these filters. <Link to="/leads" className="underline">Clear the filters</Link>
      </p>
    ) : (
      <p className="mt-8 max-w-prose">
        A discovery run looks up licensed businesses for one zip code and niche and puts them here.
      </p>
    );
  }

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <>
      <p className="mt-6 text-dim">
        <span className="tabular-nums">{formatCount(total)}</span> ranked by composite score
      </p>
      <ol aria-label="Ranked leads" className="mt-2 border-y border-seam">
        {items.map((lead, i) => (
          <RouteRow
            key={lead.business_id}
            lead={lead}
            rank={(page - 1) * PAGE_SIZE + i + 1}
            to={`/leads/${lead.business_id}${search}`}
            selected={lead.business_id === selectedId}
          />
        ))}
      </ol>
      {pages > 1 && (
        <nav aria-label="Pages" className="mt-4 flex items-center gap-3">
          <button type="button" className={secondaryClass} disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
          <span className="tabular-nums text-dim">Page {page} of {pages}</span>
          <button type="button" className={secondaryClass} disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
        </nav>
      )}
    </>
  );
}

function ListSkeleton() {
  return (
    <div aria-busy="true" className="mt-6">
      <span className="sr-only">Loading leads</span>
      <ol aria-hidden="true" className="border-y border-seam">
        {[0, 1, 2, 3, 4].map((i) => (
          <li key={i} className="flex h-[52px] items-center gap-3 px-4">
            <span className="h-4 w-6 rounded-plate bg-raised" />
            <span className="h-4 flex-1 rounded-plate bg-raised" />
            <span className="h-4 w-12 rounded-plate bg-raised" />
          </li>
        ))}
      </ol>
    </div>
  );
}
