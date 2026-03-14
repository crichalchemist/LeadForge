import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchBusiness, fetchOutreachHistory } from '../api/client';
import ScoreGauge from '../components/common/ScoreGauge';
import Badge from '../components/common/Badge';
import type { Business, OutreachRecord } from '../types';

export default function LeadDetail() {
  const { id } = useParams<{ id: string }>();

  const { data: biz, isLoading } = useQuery<Business>({
    queryKey: ['business', id],
    queryFn: () => fetchBusiness(id!),
    enabled: !!id,
  });

  const { data: outreachData } = useQuery<{ items: OutreachRecord[] }>({
    queryKey: ['outreach', id],
    queryFn: () => fetchOutreachHistory(id!),
    enabled: !!id,
  });

  if (isLoading) return <p className="text-gray-500">Loading...</p>;
  if (!biz) return <p className="text-red-500">Business not found.</p>;

  const latestScore = biz.lead_scores[0]; // Already sorted desc by version
  const dp = biz.digital_presence;
  const outreach = outreachData?.items ?? [];

  return (
    <div className="max-w-5xl">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{biz.name}</h1>
        <div className="flex gap-3 mt-1 text-sm text-gray-500">
          <span>{biz.zip_code}</span>
          <span className="capitalize">{biz.niche.replace('_', ' ')}</span>
          {biz.phone && <span>{biz.phone}</span>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Score Breakdown */}
        <div className="lg:col-span-1 bg-white rounded-lg shadow p-5">
          <h2 className="text-lg font-semibold mb-4">Score Breakdown</h2>
          {latestScore ? (
            <div className="space-y-4">
              <div className="text-center mb-4">
                <span className="text-4xl font-bold text-indigo-600">
                  {latestScore.composite_acquisition_score?.toFixed(1) ?? '--'}
                </span>
                <p className="text-xs text-gray-500 mt-1">Composite Score (v{latestScore.score_version})</p>
                {latestScore.price_tier && (
                  <span className={`mt-2 inline-block px-3 py-1 rounded-full text-sm font-medium ${
                    latestScore.price_tier === 1 ? 'bg-green-100 text-green-700' :
                    latestScore.price_tier === 2 ? 'bg-yellow-100 text-yellow-700' :
                    'bg-red-100 text-red-700'
                  }`}>
                    Tier {latestScore.price_tier}
                  </span>
                )}
              </div>
              <ScoreGauge label="Digital Deficit" value={latestScore.digital_deficit_score} />
              <ScoreGauge label="Viability" value={latestScore.viability_score} />
              <ScoreGauge label="Competitive Pressure" value={latestScore.competitive_pressure_score} />
              {latestScore.sentiment_adjustment && (
                <p className="text-xs text-gray-500">
                  Sentiment adj: {latestScore.sentiment_adjustment > 0 ? '+' : ''}
                  {(latestScore.sentiment_adjustment * 100).toFixed(0)}%
                </p>
              )}
            </div>
          ) : (
            <p className="text-gray-400 text-sm">No scores yet</p>
          )}
        </div>

        {/* Business Details */}
        <div className="lg:col-span-2 space-y-6">
          {/* Info */}
          <div className="bg-white rounded-lg shadow p-5">
            <h2 className="text-lg font-semibold mb-3">Business Info</h2>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <Detail label="Address" value={biz.address} />
              <Detail label="Email" value={biz.email} />
              <Detail label="Owner" value={biz.owner_name} />
              <Detail label="License" value={biz.license_status} />
              <Detail label="Employees" value={biz.employee_count_est?.toString()} />
              <Detail label="Est. Revenue" value={biz.estimated_monthly_revenue ? `$${biz.estimated_monthly_revenue.toLocaleString()}/mo` : null} />
            </dl>
          </div>

          {/* Digital Presence */}
          {dp && (
            <div className="bg-white rounded-lg shadow p-5">
              <h2 className="text-lg font-semibold mb-3">Digital Presence</h2>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <PresenceItem label="Website" present={dp.has_website} detail={dp.website_url} />
                <PresenceItem label="Google Business" present={dp.has_google_business_profile}
                  detail={dp.google_review_count ? `${dp.google_review_count} reviews, ${dp.google_avg_rating}★` : undefined} />
                <PresenceItem label="Facebook" present={dp.has_facebook_page} />
                <PresenceItem label="Instagram" present={dp.has_instagram}
                  detail={dp.ig_follower_count ? `${dp.ig_follower_count} followers` : undefined} />
                <PresenceItem label="Google Ads" present={dp.has_google_ads} />
                <PresenceItem label="Meta Ads" present={dp.has_meta_ads} />
              </div>
            </div>
          )}

          {/* Outreach History */}
          <div className="bg-white rounded-lg shadow p-5">
            <h2 className="text-lg font-semibold mb-3">Outreach History</h2>
            {outreach.length === 0 ? (
              <p className="text-gray-400 text-sm">No outreach records</p>
            ) : (
              <div className="space-y-3">
                {outreach.map((o) => (
                  <div key={o.id} className="border rounded-md p-3 text-sm">
                    <div className="flex items-center justify-between mb-1">
                      <Badge stage={o.status} />
                      <span className="text-xs text-gray-400">
                        {o.last_contact_date ? new Date(o.last_contact_date).toLocaleDateString() : 'No contact'}
                      </span>
                    </div>
                    {o.call_disposition && (
                      <p className="text-gray-600">Disposition: {o.call_disposition}</p>
                    )}
                    {o.call_transcript && (
                      <details className="mt-2">
                        <summary className="text-indigo-600 cursor-pointer text-xs">View Transcript</summary>
                        <pre className="mt-1 text-xs text-gray-600 whitespace-pre-wrap bg-gray-50 p-2 rounded max-h-48 overflow-auto">
                          {o.call_transcript}
                        </pre>
                      </details>
                    )}
                    {o.notes && <p className="text-gray-500 mt-1 text-xs">Notes: {o.notes}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <>
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-gray-900">{value || '--'}</dd>
    </>
  );
}

function PresenceItem({ label, present, detail }: { label: string; present: boolean; detail?: string | null }) {
  return (
    <div className={`p-2 rounded ${present ? 'bg-green-50' : 'bg-red-50'}`}>
      <p className="font-medium">{present ? '✓' : '✗'} {label}</p>
      {detail && <p className="text-xs text-gray-500 truncate">{detail}</p>}
    </div>
  );
}
