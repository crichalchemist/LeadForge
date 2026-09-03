// =py llm/entity_resolution
import { stripFences, type LlmClient } from './client';

export interface BusinessRecord { name?: string | null; address?: string | null; zip_code?: string | null; phone?: string | null }

export interface EntityMatch { is_match: boolean; confidence: number; reason: string }

export const MERGE_THRESHOLD = 0.8;

const ENTITY_RESOLUTION_PROMPT = (a: BusinessRecord, b: BusinessRecord) => `Compare these two business records and determine if they are the same business.

Business A:
- Name: ${a.name ?? ''}
- Address: ${a.address ?? ''}
- Zip: ${a.zip_code ?? ''}
- Phone: ${a.phone ?? ''}

Business B:
- Name: ${b.name ?? ''}
- Address: ${b.address ?? ''}
- Zip: ${b.zip_code ?? ''}
- Phone: ${b.phone ?? ''}

Respond with ONLY a JSON object:
{"is_match": true/false, "confidence": 0.0-1.0, "reason": "brief explanation"}
`;

// =py resolve_entities: a match only counts when the model says so AND confidence >= MERGE_THRESHOLD
export async function resolveEntities(recordA: BusinessRecord, recordB: BusinessRecord, client: LlmClient): Promise<EntityMatch> {
  try {
    const response = await client.complete(ENTITY_RESOLUTION_PROMPT(recordA, recordB), { maxTokens: 200 });
    if (!response) return { is_match: false, confidence: 0, reason: 'LLM unavailable' };
    const result = JSON.parse(stripFences(response)) as Partial<EntityMatch>;
    // Python defaults a missing confidence to 0 but raises (and reports a parse error) on a non-numeric one.
    const confidence = 'confidence' in result ? result.confidence : 0;
    if (typeof confidence !== 'number' || !Number.isFinite(confidence)) throw new TypeError('confidence is not a number');
    return {
      is_match: Boolean(result.is_match) && confidence >= MERGE_THRESHOLD,
      confidence,
      reason: result.reason ?? '',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('entity_resolution_parse_failed', message);
    return { is_match: false, confidence: 0, reason: `Parse error: ${message}` };
  }
}

// =py merge_records: primary wins; secondary fills keys that are missing or null on primary
export function mergeRecords(primary: Record<string, unknown>, secondary: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...primary };
  for (const [key, value] of Object.entries(secondary)) {
    if (!(key in merged) || merged[key] == null) merged[key] = value;
  }
  return merged;
}
