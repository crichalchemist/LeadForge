export interface Business {
  id: string;
  name: string;
  address: string | null;
  zip_code: string;
  phone: string | null;
  email: string | null;
  owner_name: string | null;
  niche: string;
  license_number: string | null;
  license_status: string | null;
  license_issue_date: string | null;
  incorporation_date: string | null;
  employee_count_est: number | null;
  estimated_monthly_revenue: number | null;
  google_place_id: string | null;
  thumbtack_hires: number | null;
  nextdoor_recommendations: number | null;
  total_customer_ugc: number | null;
  created_at: string;
  updated_at: string;
  digital_presence: DigitalPresence | null;
  lead_scores: LeadScore[];
  outreach_records: OutreachRecord[];
}

export interface BusinessListItem {
  id: string;
  name: string;
  address: string | null;
  zip_code: string;
  phone: string | null;
  niche: string;
  license_status: string | null;
  created_at: string;
  composite_acquisition_score: number | null;
  price_tier: number | null;
  pipeline_stage: string | null;
}

export interface RankedLead {
  business_id: string;
  business_name: string;
  zip_code: string;
  niche: string;
  composite_acquisition_score: number | null;
  price_tier: number | null;
  pipeline_stage: string | null;
}

export interface DigitalPresence {
  has_website: boolean;
  website_url: string | null;
  website_quality_score: number | null;
  has_google_business_profile: boolean;
  gbp_completeness_score: number | null;
  google_review_count: number | null;
  google_avg_rating: number | null;
  has_facebook_page: boolean;
  has_instagram: boolean;
  ig_follower_count: number | null;
  has_google_ads: boolean;
  has_meta_ads: boolean;
  yelp_review_count: number | null;
  yelp_rating: number | null;
}

export interface LeadScore {
  id: string;
  score_version: number;
  digital_deficit_score: number | null;
  viability_score: number | null;
  competitive_pressure_score: number | null;
  composite_acquisition_score: number | null;
  price_tier: number | null;
  sentiment_adjustment: number | null;
}

export interface OutreachRecord {
  id: string;
  business_id: string;
  status: string;
  retell_call_id: string | null;
  first_contact_date: string | null;
  last_contact_date: string | null;
  contact_method: string | null;
  call_transcript: string | null;
  call_sentiment_score: number | null;
  call_disposition: string | null;
  call_attempts: number;
  meeting_scheduled: boolean;
  meeting_type: string | null;
  meeting_datetime: string | null;
  follow_up_count: number;
  assigned_to: string | null;
  notes: string | null;
  proposal_amount: number | null;
  contract_amount: number | null;
  lost_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface PipelineColumn {
  stage: string;
  count: number;
  cards: PipelineCard[];
}

export interface PipelineCard {
  outreach_id: string;
  business_id: string;
  business_name: string;
  zip_code: string;
  niche: string | null;
  call_attempts: number;
  last_contact: string | null;
}

export interface FunnelStage {
  stage: string;
  count: number;
}

export interface ScoreBucket {
  range_min: number;
  range_max: number;
  count: number;
}

export interface ZipPerformance {
  zip_code: string;
  total_leads: number;
  avg_composite_score: number | null;
  contacted_count: number;
  engaged_count: number;
  won_count: number;
  conversion_rate: number | null;
}

export const PIPELINE_STAGES = [
  'scored', 'queued', 'contacted', 'voicemail', 'engaged',
  'meeting_scheduled', 'proposal_sent', 'negotiating',
  'won', 'lost', 'disqualified', 'nurture',
] as const;

export const STAGE_LABELS: Record<string, string> = {
  scored: 'Scored',
  queued: 'Queued',
  contacted: 'Contacted',
  voicemail: 'Voicemail',
  engaged: 'Engaged',
  meeting_scheduled: 'Meeting',
  proposal_sent: 'Proposal',
  negotiating: 'Negotiating',
  won: 'Won',
  lost: 'Lost',
  disqualified: 'Disqualified',
  nurture: 'Nurture',
};

export const STAGE_COLORS: Record<string, string> = {
  scored: 'bg-gray-100',
  queued: 'bg-blue-100',
  contacted: 'bg-yellow-100',
  voicemail: 'bg-orange-100',
  engaged: 'bg-purple-100',
  meeting_scheduled: 'bg-indigo-100',
  proposal_sent: 'bg-cyan-100',
  negotiating: 'bg-pink-100',
  won: 'bg-green-100',
  lost: 'bg-red-100',
  disqualified: 'bg-red-50',
  nurture: 'bg-amber-100',
};

// NOF Grant types
export interface GrantApplication {
  id: string;
  business_id: string;
  status: string;
  applied_date: string | null;
  finalist_date: string | null;
  cal_issued_date: string | null;
  completion_date: string | null;
  alumnus_date: string | null;
  total_project_cost: number | null;
  base_grant_amount: number | null;
  acquisition_cost: number | null;
  acquisition_coverage_pct: number | null;
  taf_amount: number | null;
  owner_contribution: number | null;
  financing_amount: number | null;
  financing_verified: boolean;
  corridor_name: string | null;
  corridor_type: string | null;
  is_priority_corridor: boolean;
  gc_bid_amount: number | null;
  project_description: string | null;
  exterior_work_pct: number | null;
  has_site_control: boolean;
  site_control_type: string | null;
  assigned_to: string | null;
  ta_provider: string | null;
  notes: string | null;
  lost_reason: string | null;
  created_at: string;
  updated_at: string;
  documents?: GrantDocument[];
}

export interface GrantDocument {
  id: string;
  grant_application_id: string;
  document_type: string;
  is_mandatory: boolean;
  status: string;
  notes: string | null;
  received_date: string | null;
  reviewed_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface GrantFinancials {
  total_project_cost: number;
  acquisition_cost: number;
  base_grant: number;
  taf_eligible: number;
  owner_contribution: number;
  owner_min_financing: number;
  exterior_work_minimum: number;
}

export interface GrantBoardColumn {
  stage: string;
  count: number;
  cards: GrantBoardCard[];
}

export interface GrantBoardCard {
  grant_id: string;
  business_id: string;
  business_name: string;
  corridor_name: string | null;
  estimated_grant: number | null;
  days_in_stage: number;
}

export const NOF_STAGES = [
  'eligibility_assessed', 'intake', 'applied', 'pipeline',
  'finalist', 'stage_1_legal', 'stage_2_docs', 'stage_3_financing',
  'stage_3_construction', 'stage_4_closing', 'stage_5_complete',
  'alumnus', 'removed',
] as const;

export const NOF_STAGE_LABELS: Record<string, string> = {
  eligibility_assessed: 'Eligibility',
  intake: 'Intake',
  applied: 'Applied',
  pipeline: 'Pipeline',
  finalist: 'Finalist',
  stage_1_legal: 'Legal',
  stage_2_docs: 'Documents',
  stage_3_financing: 'Financing',
  stage_3_construction: 'Construction',
  stage_4_closing: 'Closing',
  stage_5_complete: 'Complete',
  alumnus: 'Alumnus',
  removed: 'Removed',
};

export const NOF_STAGE_COLORS: Record<string, string> = {
  eligibility_assessed: 'bg-blue-100',
  intake: 'bg-blue-200',
  applied: 'bg-yellow-100',
  pipeline: 'bg-yellow-200',
  finalist: 'bg-purple-100',
  stage_1_legal: 'bg-indigo-100',
  stage_2_docs: 'bg-indigo-200',
  stage_3_financing: 'bg-cyan-100',
  stage_3_construction: 'bg-cyan-200',
  stage_4_closing: 'bg-orange-100',
  stage_5_complete: 'bg-green-100',
  alumnus: 'bg-green-200',
  removed: 'bg-red-100',
};
