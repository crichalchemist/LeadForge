CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer' CHECK(role IN ('admin', 'viewer')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS businesses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT,
  city TEXT,
  state TEXT,
  zip_code TEXT,
  latitude REAL,
  longitude REAL,
  phone TEXT,
  niche TEXT,
  in_nof_corridor INTEGER DEFAULT 0,
  nof_corridor_name TEXT,
  license_status TEXT,
  source TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_businesses_zip ON businesses(zip_code);
CREATE INDEX IF NOT EXISTS idx_businesses_niche ON businesses(niche);
CREATE INDEX IF NOT EXISTS idx_businesses_corridor ON businesses(in_nof_corridor);

CREATE TABLE IF NOT EXISTS digital_presence (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL UNIQUE REFERENCES businesses(id) ON DELETE CASCADE,
  has_website INTEGER DEFAULT 0,
  website_url TEXT,
  google_review_count INTEGER DEFAULT 0,
  google_avg_rating REAL,
  yelp_review_count INTEGER DEFAULT 0,
  yelp_rating REAL,
  website_quality_score INTEGER DEFAULT 0,
  facebook_url TEXT,
  instagram_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS lead_scores (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  score_version TEXT NOT NULL DEFAULT 'v1',
  digital_deficit_score REAL NOT NULL DEFAULT 0,
  viability_score REAL NOT NULL DEFAULT 0,
  competitive_pressure_score REAL NOT NULL DEFAULT 0,
  composite_acquisition_score REAL NOT NULL DEFAULT 0,
  price_tier INTEGER NOT NULL DEFAULT 3,
  calculated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_lead_scores_business ON lead_scores(business_id);
CREATE INDEX IF NOT EXISTS idx_lead_scores_composite ON lead_scores(composite_acquisition_score DESC);

CREATE TABLE IF NOT EXISTS competitive_contexts (
  id TEXT PRIMARY KEY,
  zip_code TEXT NOT NULL,
  niche TEXT NOT NULL,
  business_density INTEGER DEFAULT 0,
  avg_rating REAL,
  total_reviews INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(zip_code, niche)
);

CREATE TABLE IF NOT EXISTS outreach_records (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  call_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  duration INTEGER DEFAULT 0,
  transcript TEXT,
  disposition TEXT,
  sentiment_score REAL,
  called_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_outreach_business ON outreach_records(business_id);

CREATE TABLE IF NOT EXISTS pipeline_items (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  stage TEXT NOT NULL DEFAULT 'discovered',
  assigned_to TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pipeline_business ON pipeline_items(business_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_stage ON pipeline_items(stage);

CREATE TABLE IF NOT EXISTS nof_corridors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  boundary_description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS grant_applications (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  corridor_name TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'identified',
  amount_requested REAL NOT NULL DEFAULT 0,
  amount_approved REAL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_grants_business ON grant_applications(business_id);

CREATE TABLE IF NOT EXISTS grant_documents (
  id TEXT PRIMARY KEY,
  grant_application_id TEXT NOT NULL REFERENCES grant_applications(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  file_url TEXT,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scoring_weights (
  id TEXT PRIMARY KEY,
  weight_name TEXT NOT NULL UNIQUE,
  weight_value REAL NOT NULL,
  description TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO scoring_weights (id, weight_name, weight_value, description) VALUES
  ('w1', 'deficit_weight', 0.40, 'Digital deficit contribution to composite score'),
  ('w2', 'viability_weight', 0.35, 'Business viability contribution to composite score'),
  ('w3', 'competitive_weight', 0.25, 'Competitive pressure contribution to composite score'),
  ('w4', 'baseline_funding', 3000, 'Baseline grant funding amount'),
  ('w5', 'tier_multiplier_1', 1.0, 'Price tier 1 multiplier'),
  ('w6', 'tier_multiplier_2', 0.7, 'Price tier 2 multiplier'),
  ('w7', 'tier_multiplier_3', 0.4, 'Price tier 3 multiplier');
