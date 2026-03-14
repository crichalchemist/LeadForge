import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { fetchGrant, fetchGrantFinancials } from '../api/client';
import { NOF_STAGE_LABELS, NOF_STAGE_COLORS } from '../types';
import type { GrantApplication, GrantFinancials, GrantDocument } from '../types';

const DOC_STATUS_COLORS: Record<string, string> = {
  missing: 'bg-red-100 text-red-700',
  requested: 'bg-yellow-100 text-yellow-700',
  received: 'bg-blue-100 text-blue-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
};

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
}

function formatDocType(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function GrantDetail() {
  const { id } = useParams<{ id: string }>();

  const { data: grant, isLoading } = useQuery<GrantApplication>({
    queryKey: ['grant', id],
    queryFn: () => fetchGrant(id!),
    enabled: !!id,
  });

  const { data: financials } = useQuery<GrantFinancials>({
    queryKey: ['grantFinancials', id],
    queryFn: () => fetchGrantFinancials(id!),
    enabled: !!id && !!grant?.total_project_cost,
  });

  if (isLoading) {
    return <p className="text-gray-500">Loading...</p>;
  }

  if (!grant) {
    return <p className="text-red-500">Grant not found.</p>;
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Grant Detail</h1>
        {grant.corridor_name && (
          <span
            className={`px-2 py-0.5 rounded text-xs font-medium ${
              grant.is_priority_corridor
                ? 'bg-green-100 text-green-700'
                : 'bg-blue-100 text-blue-700'
            }`}
          >
            {grant.corridor_name}
          </span>
        )}
        <span
          className={`px-2 py-0.5 rounded text-xs font-medium ${
            NOF_STAGE_COLORS[grant.status] || 'bg-gray-100'
          } text-gray-700`}
        >
          {NOF_STAGE_LABELS[grant.status] || grant.status}
        </span>
        {grant.assigned_to && (
          <span className="text-sm text-gray-500">Assigned to: {grant.assigned_to}</span>
        )}
      </div>

      {/* Financials Panel */}
      {financials && (
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Financials</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            <FinancialItem label="Total Project Cost" value={financials.total_project_cost} />
            <FinancialItem label="Base Grant" value={financials.base_grant} />
            <FinancialItem label="TAF Eligible" value={financials.taf_eligible} />
            <FinancialItem label="Owner Contribution" value={financials.owner_contribution} />
            <FinancialItem label="Min Financing" value={financials.owner_min_financing} />
            <FinancialItem label="Exterior Work Min" value={financials.exterior_work_minimum} />
          </div>
        </div>
      )}

      {/* Documents Checklist */}
      {grant.documents && grant.documents.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Documents Checklist</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b">
                <th className="pb-2">Document Type</th>
                <th className="pb-2">Status</th>
                <th className="pb-2">Received Date</th>
                <th className="pb-2">Notes</th>
              </tr>
            </thead>
            <tbody>
              {grant.documents.map((doc: GrantDocument) => (
                <tr key={doc.id} className="border-b last:border-0">
                  <td className="py-2 font-medium">{formatDocType(doc.document_type)}</td>
                  <td className="py-2">
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-medium ${
                        DOC_STATUS_COLORS[doc.status] || 'bg-gray-100 text-gray-700'
                      }`}
                    >
                      {doc.status}
                    </span>
                  </td>
                  <td className="py-2 text-gray-600">{doc.received_date ?? '--'}</td>
                  <td className="py-2 text-gray-600">{doc.notes ?? '--'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FinancialItem({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-lg font-semibold text-gray-900">{formatCurrency(value)}</p>
    </div>
  );
}
