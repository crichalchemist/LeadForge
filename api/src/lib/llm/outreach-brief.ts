// =py llm/outreach_brief
import { stripFences, type LlmClient } from './client';

export interface BriefBusiness { name: string; niche: string | null; address: string | null; zip_code: string }
export interface BriefPresence {
  google_avg_rating: number | null; google_review_count: number | null;
  has_website: boolean; has_facebook_page: boolean; has_instagram: boolean;
}
export interface BriefScores { deficitScore?: number; pressureScore?: number; priceTier?: number; nofEligible?: boolean }

export interface OutreachBrief {
  talking_points: string[];
  observations: string[];
  pitch_angle: string;
  opening_line: string;
  voicemail_script: string;
  objection_responses: Record<string, string>;
}

function facts(b: BriefBusiness, dp: BriefPresence | null, s: Required<BriefScores>): string {
  return `Business: ${b.name}
Type: ${b.niche ?? 'unknown'}
Location: ${b.address ?? 'unknown'}, Chicago, IL ${b.zip_code}
Google rating: ${dp ? dp.google_avg_rating ?? 'N/A' : 'N/A'} (${dp ? dp.google_review_count ?? 0 : 0} reviews)
Has website: ${dp ? dp.has_website : false}
Has social media: Facebook=${dp ? dp.has_facebook_page : false}, Instagram=${dp ? dp.has_instagram : false}
Digital deficit score: ${s.deficitScore}/100 (higher = more digital gaps)
Competitive pressure: ${s.pressureScore}/100
Price tier: ${s.priceTier}`;
}

const OUTREACH_BRIEF_PROMPT = (f: string) => `Generate an outreach brief for calling this small business owner about digital marketing services.

${f}

Generate a structured outreach brief. Respond with ONLY a JSON object:
{
    "talking_points": ["3-5 specific, personalized talking points"],
    "observations": ["2-3 specific observations about their digital presence gaps"],
    "pitch_angle": "The primary angle for the pitch (1-2 sentences)",
    "opening_line": "A natural, specific opening line referencing their business",
    "voicemail_script": "15-second voicemail script",
    "objection_responses": {
        "price": "response",
        "not_interested": "response",
        "already_have_agency": "response"
    }
}
`;

const NOF_OUTREACH_BRIEF_PROMPT = (f: string) => `Generate an outreach brief for calling this small business owner about the City of Chicago's Neighborhood Opportunity Fund grant program.

${f}

This business may qualify for up to $250,000 in grant funding through the NOF program. Frame this as a grant facilitation opportunity, not a marketing pitch.

Generate a structured outreach brief. Respond with ONLY a JSON object:
{
    "talking_points": [
        "3-5 specific talking points about grant eligibility and benefits"
    ],
    "observations": ["2-3 observations about why they're a good fit for the grant"],
    "pitch_angle": "The primary angle for the grant opportunity pitch (1-2 sentences)",
    "opening_line": "A natural opening line about the grant opportunity",
    "voicemail_script": "15-second voicemail script about the grant program",
    "objection_responses": {
        "too_complicated": "response",
        "dont_need_grants": "response",
        "already_applied": "response",
        "not_interested": "response"
    }
}
`;

// =py generate_outreach_brief; nofEligible picks the grant prompt (ADR 025)
export async function generateOutreachBrief(
  business: BriefBusiness, dp: BriefPresence | null, scores: BriefScores, client: LlmClient,
): Promise<OutreachBrief> {
  const s: Required<BriefScores> = {
    deficitScore: scores.deficitScore ?? 0, pressureScore: scores.pressureScore ?? 0,
    priceTier: scores.priceTier ?? 1, nofEligible: scores.nofEligible ?? false,
  };
  const template = s.nofEligible ? NOF_OUTREACH_BRIEF_PROMPT : OUTREACH_BRIEF_PROMPT;
  const response = await client.complete(template(facts(business, dp, s)), { maxTokens: 1000, temperature: 0.5 });
  if (!response) return fallbackBrief(business, s.nofEligible);
  try {
    return JSON.parse(stripFences(response)) as OutreachBrief;
  } catch (error) {
    console.warn('outreach_brief_failed', business.name, error instanceof Error ? error.message : String(error));
    return fallbackBrief(business, s.nofEligible);
  }
}

// =py _fallback_brief
function fallbackBrief(business: BriefBusiness, nofEligible: boolean): OutreachBrief {
  if (nofEligible) {
    return {
      talking_points: [
        `${business.name} may qualify for City of Chicago Neighborhood Opportunity Fund grants`,
        'Grants can cover up to $250,000 for facade improvements, equipment, and expansion',
        'We help navigate the application process and digital requirements',
      ],
      observations: [
        'Located on an eligible NOF corridor',
        'Strong candidate for grant funding based on location and business type',
      ],
      pitch_angle: 'Help secure City grant funding to grow and improve your business',
      opening_line: `Hi, I'm calling about a grant opportunity for ${business.name}`,
      voicemail_script: `Hi, this is a call about ${business.name}. The City has grant funding available for businesses on your corridor—up to $250,000. Give us a call to discuss eligibility.`,
      objection_responses: {
        too_complicated: "We handle the paperwork and guide you through every step. It's simpler than you'd think.",
        dont_need_grants: 'I understand. This is free money from the City to invest in your business. No obligation to explore.',
        already_applied: 'Great! We can help with future rounds or other funding opportunities.',
        not_interested: 'No problem. Can I follow up in a month with more details?',
      },
    };
  }
  return {
    talking_points: [`We noticed ${business.name} could benefit from increased online visibility`],
    observations: ['Limited digital presence compared to competitors'],
    pitch_angle: 'Help increase local visibility and customer discovery',
    opening_line: `Hi, I'm calling about ${business.name}`,
    voicemail_script: `Hi, this is a quick call about ${business.name}. We help local businesses like yours get found online. Give us a call back.`,
    objection_responses: {
      price: 'We have flexible plans starting at $150/month',
      not_interested: 'I understand. Would it be okay to check back in a month?',
      already_have_agency: 'Great to hear you\'re investing in marketing. We specialize in hyper-local businesses.',
    },
  };
}
