import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { fetchFunnel, fetchScoreDistribution, fetchZipPerformance } from '../api/client';
import type { FunnelStage, ScoreBucket, ZipPerformance } from '../types';
import { STAGE_LABELS } from '../types';

export default function Reports() {
  const { data: funnel } = useQuery<{ stages: FunnelStage[]; total: number }>({
    queryKey: ['funnel'],
    queryFn: fetchFunnel,
  });
  const { data: distribution } = useQuery<{
    buckets: ScoreBucket[];
    total: number;
    mean: number | null;
    median: number | null;
  }>({
    queryKey: ['scoreDistribution'],
    queryFn: fetchScoreDistribution,
  });
  const { data: zipPerf } = useQuery<{ items: ZipPerformance[] }>({
    queryKey: ['zipPerformance'],
    queryFn: fetchZipPerformance,
  });

  const funnelData = funnel?.stages
    .filter((s) => s.count > 0)
    .map((s) => ({ name: STAGE_LABELS[s.stage] || s.stage, count: s.count })) ?? [];

  const distData = distribution?.buckets.map((b) => ({
    name: `${b.range_min}-${b.range_max}`,
    count: b.count,
  })) ?? [];

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Reports</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Conversion Funnel */}
        <div className="bg-white rounded-lg shadow p-5">
          <h2 className="text-lg font-semibold mb-4">Conversion Funnel</h2>
          {funnelData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={funnelData} layout="vertical" margin={{ left: 80 }}>
                <XAxis type="number" />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="count" fill="#6366f1" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-gray-400 text-sm">No pipeline data yet</p>
          )}
        </div>

        {/* Score Distribution */}
        <div className="bg-white rounded-lg shadow p-5">
          <h2 className="text-lg font-semibold mb-4">Score Distribution</h2>
          {distribution && distribution.total > 0 ? (
            <>
              <div className="flex gap-4 mb-3 text-sm text-gray-500">
                <span>Mean: <strong>{distribution.mean?.toFixed(1)}</strong></span>
                <span>Median: <strong>{distribution.median?.toFixed(1)}</strong></span>
                <span>Total: <strong>{distribution.total}</strong></span>
              </div>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={distData}>
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="count" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </>
          ) : (
            <p className="text-gray-400 text-sm">No scores yet</p>
          )}
        </div>
      </div>

      {/* Zip Performance Table */}
      {zipPerf && zipPerf.items.length > 0 && (
        <div className="bg-white rounded-lg shadow p-5 mt-6">
          <h2 className="text-lg font-semibold mb-4">Zip Code Performance</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b">
                <th className="pb-2">Zip</th>
                <th className="pb-2">Leads</th>
                <th className="pb-2">Avg Score</th>
                <th className="pb-2">Contacted</th>
                <th className="pb-2">Engaged</th>
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
                  <td className="py-2">{z.engaged_count}</td>
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
