export interface Bindings {
  DB: D1Database;
  AI: any;
  COOKIE_STORE: KVNamespace;
  ENRICHMENT_QUEUE: Queue<any>;
  OUTREACH_QUEUE: Queue<any>;
  SENTIMENT_QUEUE: Queue<any>;
  RECALIBRATION_QUEUE: Queue<any>;
  JWT_SECRET?: string;
}

export interface JwtPayload {
  sub: string;
  email: string;
  role: 'admin' | 'viewer';
  exp: number;
  iat: number;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'viewer';
  created_at: string;
}

export interface Business {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  niche: string | null;
  in_nof_corridor: number | null;
  nof_corridor_name: string | null;
  license_status: string | null;
  source: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeadScore {
  id: string;
  business_id: string;
  score_version: string;
  digital_deficit_score: number;
  viability_score: number;
  competitive_pressure_score: number;
  composite_acquisition_score: number;
  price_tier: number;
  calculated_at: string;
}

export interface DigitalPresence {
  id: string;
  business_id: string;
  has_website: number | null;
  website_url: string | null;
  google_review_count: number | null;
  google_avg_rating: number | null;
  yelp_review_count: number | null;
  yelp_rating: number | null;
  website_quality_score: number | null;
  facebook_url: string | null;
  instagram_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface CompetitiveContext {
  id: string;
  zip_code: string;
  niche: string;
  business_density: number | null;
  avg_rating: number | null;
  total_reviews: number | null;
  created_at: string;
  updated_at: string;
}

export interface PipelineItem {
  id: string;
  business_id: string;
  stage: string;
  assigned_to: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface OutreachRecord {
  id: string;
  business_id: string;
  call_id: string;
  status: string;
  duration: number;
  transcript: string | null;
  disposition: string | null;
  sentiment_score: number | null;
  called_at: string;
}

export interface GrantApplication {
  id: string;
  business_id: string;
  corridor_name: string;
  stage: string;
  amount_requested: number;
  amount_approved: number | null;
  status: string;
  created_at: string;
  updated_at: string;
}
