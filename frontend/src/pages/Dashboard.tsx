import { useQuery } from '@tanstack/react-query';
import { fetchFunnel, fetchZipPerformance } from '../api/client';
import type { FunnelStage, ZipPerformance } from '../types';

export default function Dashboard() {
  const { data: funnel } = useQuery<{ stages: FunnelStage[]; total: number }>({
    queryKey: ['funnel'],
    queryFn: fetchFunnel,
  });
  const { data: zipPerf } = useQuery<{ items: ZipPerformance[] }>({
    queryKey: ['zipPerformance'],
    queryFn: fetchZipPerformance,
  });

  const totalLeads = funnel?.total ?? 0;
  const wonCount = funnel?.stages.find((s) => s.stage === 'won')?.count ?? 0;
  const engagedCount = funnel?.stages.find((s) => s.stage === 'engaged')?.count ?? 0;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Dashboard</h1>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <KpiCard label="Total Leads" value={totalLeads} />
        <KpiCard label="In Pipeline" value={totalLeads - wonCount} />
        <KpiCard label="Engaged" value={engagedCount} />
        <KpiCard label="Won" value={wonCount} color="text-green-600" />
      </div>

      {/* Funnel Overview */}
      {funnel && (
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Pipeline Funnel</h2>
          <div className="space-y-2">
            {funnel.stages.filter((s) => s.count > 0).map((s) => (
              <div key={s.stage} className="flex items-center gap-3">
                <span className="w-32 text-sm text-gray-600 capitalize">
                  {s.stage.replace('_', ' ')}
                </span>
                <div className="flex-1 bg-gray-100 rounded-full h-5">
                  <div
                    className="bg-indigo-500 h-5 rounded-full text-xs text-white flex items-center justify-center"
                    style={{ width: `${Math.max((s.count / totalLeads) * 100, 8)}%` }}
                  >
                    {s.count}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Zip Performance Table */}
      {zipPerf && zipPerf.items.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Zip Code Performance</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b">
                <th className="pb-2">Zip Code</th>
                <th className="pb-2">Leads</th>
                <th className="pb-2">Avg Score</th>
                <th className="pb-2">Contacted</th>
                <th className="pb-2">Won</th>
                <th className="pb-2">Conv %</th>
              </tr>
            </thead>
            <tbody>
              {zipPerf.items.map((z) => (
                <tr key={z.zip_code} className="border-b last:border-0">
                  <td className="py-2 font-medium">{z.zip_code}</td>
                  <td className="py-2">{z.total_leads}</td>
                  <td className="py-2">{z.avg_composite_score?.toFixed(1) ?? '--'}</td>
                  <td className="py-2">{z.contacted_count}</td>
                  <td className="py-2">{z.won_count}</td>
                  <td className="py-2">{z.conversion_rate != null ? `${z.conversion_rate}%` : '--'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function KpiCard({ label, value, color = 'text-gray-900' }: { label: string; value: number; color?: string }) {
  return (
    <div className="bg-white rounded-lg shadow p-4">
      <p className="text-sm text-gray-500">{label}</p>
      <p className={`text-3xl font-bold ${color}`}>{value}</p>
    </div>
  );
}
