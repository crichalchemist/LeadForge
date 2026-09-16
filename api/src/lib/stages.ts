export const PIPELINE_STAGES = [
  'scored', 'queued', 'contacted', 'voicemail', 'engaged', 'meeting_scheduled',
  'proposal_sent', 'negotiating', 'won', 'lost', 'disqualified', 'nurture',
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

// =py src/leadforge/api/routes/pipeline.py VALID_TRANSITIONS
export const VALID_TRANSITIONS: Record<PipelineStage, readonly PipelineStage[]> = {
  scored: ['queued', 'disqualified'],
  queued: ['contacted', 'disqualified'],
  contacted: ['voicemail', 'engaged', 'disqualified', 'nurture'],
  voicemail: ['contacted', 'engaged', 'disqualified', 'nurture'],
  engaged: ['meeting_scheduled', 'lost', 'disqualified', 'nurture'],
  meeting_scheduled: ['proposal_sent', 'lost', 'disqualified', 'nurture'],
  proposal_sent: ['negotiating', 'lost', 'disqualified'],
  negotiating: ['won', 'lost', 'disqualified'],
  won: [],
  lost: ['nurture'],
  disqualified: [],
  nurture: ['queued'],
};

export const NOF_STAGES = [
  'eligibility_assessed', 'intake', 'applied', 'pipeline', 'finalist',
  'stage_1_legal', 'stage_2_docs', 'stage_3_financing', 'stage_3_construction',
  'stage_4_closing', 'stage_5_complete', 'alumnus', 'removed',
] as const;
export type NofStage = (typeof NOF_STAGES)[number];

// =py src/leadforge/api/routes/grants.py VALID_NOF_TRANSITIONS
export const VALID_NOF_TRANSITIONS: Record<NofStage, readonly NofStage[]> = {
  eligibility_assessed: ['intake', 'removed'],
  intake: ['applied', 'removed'],
  applied: ['pipeline', 'removed'],
  pipeline: ['finalist', 'removed'],
  finalist: ['stage_1_legal', 'removed'],
  stage_1_legal: ['stage_2_docs', 'removed'],
  stage_2_docs: ['stage_3_financing', 'removed'],
  stage_3_financing: ['stage_3_construction', 'removed'],
  stage_3_construction: ['stage_4_closing', 'removed'],
  stage_4_closing: ['stage_5_complete', 'removed'],
  stage_5_complete: ['alumnus', 'removed'],
  alumnus: [],
  removed: [],
};

// =py src/leadforge/api/routes/grants.py BOARD_GROUPS — column order for the grant board
export const BOARD_GROUPS: readonly NofStage[] = [
  'eligibility_assessed', 'intake', 'applied', 'pipeline',
  'finalist', 'stage_1_legal', 'stage_2_docs', 'stage_3_financing',
  'stage_3_construction', 'stage_4_closing', 'stage_5_complete',
  'alumnus', 'removed',
];

export const NICHES = [
  'septic_services', 'used_auto_parts', 'meat_markets', 'bars', 'nail_salons',
  'beauty_shops', 'smoke_shops', 'beauty_supply', 'mobile_mechanics', 'tire_shops',
  'lawn_services', 'towing', 'barbershops', 'veterinarians', 'security_services',
] as const;
