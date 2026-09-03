import type { NofStage, PipelineStage } from '../lib/stages';

/** Body of a SENTIMENT_QUEUE message; produced by routes/webhooks.ts, consumed by tasks/sentiment.ts. */
export interface SentimentMessage { outreach_id: string }

export interface Bindings {
  DB: D1Database;
  AI: Ai;
  COOKIE_STORE: KVNamespace;
  ENRICHMENT_QUEUE: Queue;
  OUTREACH_QUEUE: Queue;
  SENTIMENT_QUEUE: Queue<SentimentMessage>;
  RECALIBRATION_QUEUE: Queue;
  JWT_SECRET?: string;
  RETELL_API_KEY?: string;
  CORS_ORIGINS?: string;
}

export interface AuthUser {
  id: string;
  email: string;
  full_name: string;
  role: 'admin' | 'viewer';
  is_active: boolean;
}

export type AppEnv = { Bindings: Bindings; Variables: { user: AuthUser } };

export interface JwtPayload {
  sub: string;
  role: 'admin' | 'viewer';
  type: 'access' | 'refresh';
  iat: number;
  exp: number;
}

export interface UserRow {
  id: string; email: string; password_hash: string; full_name: string;
  role: 'admin' | 'viewer'; is_active: number; last_login_at: string | null;
  created_at: string; updated_at: string;
}

export interface BusinessRow {
  id: string; name: string; address: string | null; zip_code: string; phone: string | null;
  email: string | null; owner_name: string | null; niche: string;
  license_number: string | null; license_status: string | null;
  license_issue_date: string | null; incorporation_date: string | null;
  employee_count_est: number | null; estimated_monthly_revenue: number | null;
  google_place_id: string | null; thumbtack_hires: number | null;
  nextdoor_recommendations: number | null; ig_location_tag_count: number | null;
  ig_hashtag_mention_count: number | null; fb_checkin_count: number | null;
  fb_ugc_tag_count: number | null; total_customer_ugc: number | null;
  latitude: number | null; longitude: number | null;
  in_nof_corridor: number; nof_corridor_name: string | null;
  created_at: string; updated_at: string;
}

export interface DigitalPresenceRow {
  id: string; business_id: string; has_website: number; website_url: string | null;
  website_quality_score: number | null; has_ssl: number | null; domain_registration_date: string | null;
  has_google_business_profile: number; gbp_completeness_score: number | null;
  google_review_count: number | null; google_avg_rating: number | null; review_velocity_30d: number | null;
  has_facebook_page: number; has_instagram: number; fb_last_post_days_ago: number | null;
  ig_follower_count: number | null; ig_post_frequency: number | null;
  has_google_ads: number; has_meta_ads: number; yelp_review_count: number | null; yelp_rating: number | null;
  created_at: string; updated_at: string;
}

export interface LeadScoreRow {
  id: string; business_id: string; score_version: number;
  digital_deficit_score: number | null; viability_score: number | null;
  competitive_pressure_score: number | null; composite_acquisition_score: number | null;
  nof_eligibility_score: number | null; price_tier: number | null; sentiment_adjustment: number | null;
  created_at: string; updated_at: string;
}

export interface OutreachRecordRow {
  id: string; business_id: string; status: PipelineStage; retell_call_id: string | null;
  first_contact_date: string | null; last_contact_date: string | null; contact_method: string | null;
  call_transcript: string | null; call_sentiment_score: number | null; call_disposition: string | null;
  call_attempts: number; meeting_scheduled: number; meeting_type: string | null;
  meeting_datetime: string | null; follow_up_count: number; assigned_to: string | null;
  notes: string | null; proposal_amount: number | null; contract_amount: number | null;
  lost_reason: string | null; created_at: string; updated_at: string;
}

export interface GrantApplicationRow {
  id: string; business_id: string; status: NofStage;
  applied_date: string | null; finalist_date: string | null; cal_issued_date: string | null;
  completion_date: string | null; alumnus_date: string | null;
  total_project_cost: number | null; base_grant_amount: number | null; acquisition_cost: number | null;
  acquisition_coverage_pct: number | null; taf_amount: number | null; owner_contribution: number | null;
  financing_amount: number | null; financing_verified: number;
  corridor_name: string | null; corridor_type: string | null; is_priority_corridor: number;
  gc_bid_amount: number | null; project_description: string | null; exterior_work_pct: number | null;
  has_site_control: number; site_control_type: string | null;
  assigned_to: string | null; ta_provider: string | null; notes: string | null; lost_reason: string | null;
  created_at: string; updated_at: string;
}

export interface GrantDocumentRow {
  id: string; grant_application_id: string; document_type: string; is_mandatory: number;
  status: string; notes: string | null; received_date: string | null; reviewed_date: string | null;
  created_at: string; updated_at: string;
}

// Consumed only by lib/scoring.ts (frozen; re-ported in Phase 3).
export type DigitalPresence = DigitalPresenceRow & { facebook_url?: string | null; instagram_url?: string | null };
