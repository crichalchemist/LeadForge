-- Mirrors src/leadforge/db/models/*.py. See spec §D1 schema for mapping rules.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'viewer')),
  is_active INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE businesses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT,
  zip_code TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  owner_name TEXT,
  niche TEXT NOT NULL CHECK (niche IN (
    'septic_services', 'used_auto_parts', 'meat_markets', 'bars', 'nail_salons',
    'beauty_shops', 'smoke_shops', 'beauty_supply', 'mobile_mechanics', 'tire_shops',
    'lawn_services', 'towing', 'barbershops', 'veterinarians', 'security_services')),
  license_number TEXT,
  license_status TEXT CHECK (license_status IN ('active', 'expired', 'revoked', 'unknown')),
  license_issue_date TEXT,
  incorporation_date TEXT,
  employee_count_est INTEGER,
  estimated_monthly_revenue REAL,
  google_place_id TEXT UNIQUE,
  thumbtack_hires INTEGER,
  nextdoor_recommendations INTEGER,
  ig_location_tag_count INTEGER,
  ig_hashtag_mention_count INTEGER,
  fb_checkin_count INTEGER,
  fb_ugc_tag_count INTEGER,
  total_customer_ugc INTEGER,
  latitude REAL,
  longitude REAL,
  in_nof_corridor INTEGER NOT NULL DEFAULT 0,
  nof_corridor_name TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_businesses_zip ON businesses(zip_code);
CREATE INDEX idx_businesses_niche ON businesses(niche);
CREATE INDEX idx_businesses_corridor ON businesses(in_nof_corridor);

CREATE TABLE digital_presences (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL UNIQUE REFERENCES businesses(id) ON DELETE CASCADE,
  has_website INTEGER NOT NULL DEFAULT 0,
  website_url TEXT,
  website_quality_score REAL,
  has_ssl INTEGER,
  domain_registration_date TEXT,
  has_google_business_profile INTEGER NOT NULL DEFAULT 0,
  gbp_completeness_score REAL,
  google_review_count INTEGER DEFAULT 0,
  google_avg_rating REAL,
  review_velocity_30d REAL,
  has_facebook_page INTEGER NOT NULL DEFAULT 0,
  has_instagram INTEGER NOT NULL DEFAULT 0,
  fb_last_post_days_ago INTEGER,
  ig_follower_count INTEGER,
  ig_post_frequency REAL,
  has_google_ads INTEGER NOT NULL DEFAULT 0,
  has_meta_ads INTEGER NOT NULL DEFAULT 0,
  yelp_review_count INTEGER,
  yelp_rating REAL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE lead_scores (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  score_version INTEGER NOT NULL DEFAULT 1,
  digital_deficit_score REAL,
  viability_score REAL,
  competitive_pressure_score REAL,
  composite_acquisition_score REAL,
  nof_eligibility_score REAL,
  price_tier INTEGER,
  sentiment_adjustment REAL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE (business_id, score_version)
);
CREATE INDEX idx_lead_scores_business ON lead_scores(business_id);

CREATE TABLE competitive_contexts (
  id TEXT PRIMARY KEY,
  zip_code TEXT NOT NULL,
  niche TEXT NOT NULL,
  competitor_count INTEGER NOT NULL DEFAULT 0,
  avg_digital_score REAL,
  competitor_ads_active_count INTEGER NOT NULL DEFAULT 0,
  avg_rating REAL,
  median_household_income REAL,
  population_density REAL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE (zip_code, niche)
);
CREATE INDEX idx_competitive_contexts_zip ON competitive_contexts(zip_code);

CREATE TABLE outreach_records (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'scored' CHECK (status IN (
    'scored', 'queued', 'contacted', 'voicemail', 'engaged', 'meeting_scheduled',
    'proposal_sent', 'negotiating', 'won', 'lost', 'disqualified', 'nurture')),
  retell_call_id TEXT,
  first_contact_date TEXT,
  last_contact_date TEXT,
  contact_method TEXT,
  call_transcript TEXT,
  call_sentiment_score REAL,
  call_disposition TEXT CHECK (call_disposition IN ('answered', 'voicemail', 'no_answer', 'wrong_number')),
  call_attempts INTEGER NOT NULL DEFAULT 0,
  meeting_scheduled INTEGER NOT NULL DEFAULT 0,
  meeting_type TEXT CHECK (meeting_type IN ('virtual', 'in_person')),
  meeting_datetime TEXT,
  follow_up_count INTEGER NOT NULL DEFAULT 0,
  assigned_to TEXT,
  notes TEXT,
  proposal_amount REAL,
  contract_amount REAL,
  lost_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_outreach_business ON outreach_records(business_id);
CREATE INDEX idx_outreach_retell_call ON outreach_records(retell_call_id);

CREATE TABLE grant_applications (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'eligibility_assessed' CHECK (status IN (
    'eligibility_assessed', 'intake', 'applied', 'pipeline', 'finalist',
    'stage_1_legal', 'stage_2_docs', 'stage_3_financing', 'stage_3_construction',
    'stage_4_closing', 'stage_5_complete', 'alumnus', 'removed')),
  applied_date TEXT,
  finalist_date TEXT,
  cal_issued_date TEXT,
  completion_date TEXT,
  alumnus_date TEXT,
  total_project_cost REAL,
  base_grant_amount REAL,
  acquisition_cost REAL,
  acquisition_coverage_pct REAL,
  taf_amount REAL,
  owner_contribution REAL,
  financing_amount REAL,
  financing_verified INTEGER NOT NULL DEFAULT 0,
  corridor_name TEXT,
  corridor_type TEXT,
  is_priority_corridor INTEGER NOT NULL DEFAULT 0,
  gc_bid_amount REAL,
  project_description TEXT,
  exterior_work_pct REAL,
  has_site_control INTEGER NOT NULL DEFAULT 0,
  site_control_type TEXT,
  assigned_to TEXT,
  ta_provider TEXT,
  notes TEXT,
  lost_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_grants_business ON grant_applications(business_id);

CREATE TABLE grant_documents (
  id TEXT PRIMARY KEY,
  grant_application_id TEXT NOT NULL REFERENCES grant_applications(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL CHECK (document_type IN (
    'site_control', 'gc_bid', 'bank_statement', 'architectural_drawings', 'business_plan',
    'strategic_plan', 'economic_disclosure', 'scofflaw_clearance', 'permit', 'insurance',
    'construction_timeline', 'completion_survey', 'waivers_of_lien', 'certificate_of_occupancy')),
  is_mandatory INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'missing',
  notes TEXT,
  received_date TEXT,
  reviewed_date TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_grant_documents_grant ON grant_documents(grant_application_id);

CREATE TABLE nof_corridors (
  id TEXT PRIMARY KEY,
  corridor_name TEXT NOT NULL,
  corridor_type TEXT NOT NULL CHECK (corridor_type IN ('eligible', 'priority')),
  source_updated_at TEXT,
  fetched_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
