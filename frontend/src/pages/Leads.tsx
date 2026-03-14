import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { fetchRankedLeads } from '../api/client';
import Badge from '../components/common/Badge';
import type { PaginatedResponse, RankedLead } from '../types';

export default function Leads() {
  const [page, setPage] = useState(1);
  const [zipFilter, setZipFilter] = useState('');
  const [nicheFilter, setNicheFilter] = useState('');

  const params: Record<string, string | number> = { page, page_size: 20 };
  if (zipFilter) params.zip_code = zipFilter;
  if (nicheFilter) params.niche = nicheFilter;

  const { data, isLoading } = useQuery<PaginatedResponse<RankedLead>>({
    queryKey: ['rankedLeads', params],
    queryFn: () => fetchRankedLeads(params),
  });

  const totalPages = data ? Math.ceil(data.total / data.page_size) : 0;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Leads</h1>

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <input
          type="text"
          placeholder="Filter by zip..."
          value={zipFilter}
          onChange={(e) => { setZipFilter(e.target.value); setPage(1); }}
          className="px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:ring-indigo-500 focus:border-indigo-500"
        />
        <select
          value={nicheFilter}
          onChange={(e) => { setNicheFilter(e.target.value); setPage(1); }}
          className="px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:ring-indigo-500 focus:border-indigo-500"
        >
          <option value="">All Niches</option>
          {['barbershops', 'nail_salons', 'tire_shops', 'beauty_shops', 'bars', 'towing',
            'lawn_services', 'smoke_shops', 'veterinarians', 'mobile_mechanics',
            'beauty_supply', 'meat_markets', 'security_services', 'septic_services', 'used_auto_parts',
          ].map((n) => (
            <option key={n} value={n}>{n.replace('_', ' ')}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr className="text-left text-gray-500">
              <th className="px-4 py-3">Business</th>
              <th className="px-4 py-3">Zip</th>
              <th className="px-4 py-3">Niche</th>
              <th className="px-4 py-3">Score</th>
              <th className="px-4 py-3">Tier</th>
              <th className="px-4 py-3">Stage</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Loading...</td></tr>
            )}
            {data?.items.map((lead) => (
              <tr key={lead.business_id} className="border-t hover:bg-gray-50">
                <td className="px-4 py-3">
                  <Link to={`/leads/${lead.business_id}`} className="text-indigo-600 hover:underline font-medium">
                    {lead.business_name}
                  </Link>
                </td>
                <td className="px-4 py-3">{lead.zip_code}</td>
                <td className="px-4 py-3 capitalize">{lead.niche.replace('_', ' ')}</td>
                <td className="px-4 py-3 font-medium">
                  {lead.composite_acquisition_score?.toFixed(1) ?? '--'}
                </td>
                <td className="px-4 py-3">
                  {lead.price_tier && (
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      lead.price_tier === 1 ? 'bg-green-100 text-green-700' :
                      lead.price_tier === 2 ? 'bg-yellow-100 text-yellow-700' :
                      'bg-red-100 text-red-700'
                    }`}>
                      Tier {lead.price_tier}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {lead.pipeline_stage && <Badge stage={lead.pipeline_stage} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-between items-center mt-4 text-sm">
          <span className="text-gray-500">
            Page {page} of {totalPages} ({data?.total} leads)
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1 border rounded disabled:opacity-50"
            >
              Prev
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1 border rounded disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
