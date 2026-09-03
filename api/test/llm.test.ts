import { describe, expect, it } from 'vitest';
import { FAST_MODEL, fastClient, qualityClient, stripFences, type LlmClient } from '../src/lib/llm/client';
import { mergeRecords, resolveEntities } from '../src/lib/llm/entity-resolution';
import { generateOutreachBrief } from '../src/lib/llm/outreach-brief';
import { analyzeSentiment } from '../src/lib/llm/sentiment';

// Stand-in for the LLM, like Python's AsyncMock(complete=...). Records prompts so tests can assert on them.
function fakeClient(reply: string | null): LlmClient & { prompts: string[] } {
  const prompts: string[] = [];
  return { prompts, async complete(prompt) { prompts.push(prompt); return reply; } };
}

describe('stripFences', () => {
  it('strips a ```json fence so fenced model output still parses', () => {
    expect(stripFences('```json\n{"a": 1}\n```')).toBe('{"a": 1}');
  });
  it('strips a bare fence', () => {
    expect(stripFences('```\n{"a": 1}\n```')).toBe('{"a": 1}');
  });
  it('trims unfenced text', () => {
    expect(stripFences('  {"a": 1}\n')).toBe('{"a": 1}');
  });
});

describe('workersAiClient', () => {
  function fakeAi(handler: (model: string, inputs: unknown) => unknown): Ai {
    return { run: async (model: string, inputs: unknown) => handler(model, inputs) } as unknown as Ai;
  }

  it('sends the prompt as a single user message with the tier defaults', async () => {
    let seen: { model: string; inputs: any } | null = null;
    const client = fastClient(fakeAi((model, inputs) => { seen = { model, inputs }; return { response: 'hello' }; }));
    expect(await client.complete('hi')).toBe('hello');
    expect(seen!.model).toBe(FAST_MODEL);
    expect(seen!.inputs.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(seen!.inputs.max_tokens).toBe(500);
    expect(seen!.inputs.temperature).toBe(0.1);
  });
  it('lets callers override max_tokens and temperature', async () => {
    let seen: any = null;
    const client = qualityClient(fakeAi((_m, inputs) => { seen = inputs; return { response: 'x' }; }));
    await client.complete('hi', { maxTokens: 1000, temperature: 0.5 });
    expect(seen.max_tokens).toBe(1000);
    expect(seen.temperature).toBe(0.5);
  });
  it('returns null instead of throwing when Workers AI fails, so callers fall back', async () => {
    const client = fastClient(fakeAi(() => { throw new Error('AI unavailable'); }));
    expect(await client.complete('hi')).toBeNull();
  });
  it('returns null when the model returns no response text', async () => {
    const client = fastClient(fakeAi(() => ({})));
    expect(await client.complete('hi')).toBeNull();
  });
});

describe('resolveEntities', () => {
  const recordA = { name: "John's Barbershop", address: '123 Main St', zip_code: '60619', phone: '773-555-1234' };

  it('test_matching_records', async () => {
    const client = fakeClient('{"is_match": true, "confidence": 0.95, "reason": "Same name and address"}');
    const recordB = { name: 'Johns Barber Shop', address: '123 Main Street', zip_code: '60619', phone: '773-555-1234' };
    const result = await resolveEntities(recordA, recordB, client);
    expect(result.is_match).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    expect(client.prompts[0]).toContain("Name: John's Barbershop");
    expect(client.prompts[0]).toContain('Name: Johns Barber Shop');
  });
  it('test_non_matching_records', async () => {
    const client = fakeClient('{"is_match": false, "confidence": 0.2, "reason": "Different businesses"}');
    const recordB = { name: 'Fresh Cuts Salon', address: '456 Oak Ave', zip_code: '60619', phone: '773-555-9999' };
    const result = await resolveEntities(recordA, recordB, client);
    expect(result.is_match).toBe(false);
  });
  it('test_llm_unavailable_returns_no_match', async () => {
    const result = await resolveEntities({}, {}, fakeClient(null));
    expect(result.is_match).toBe(false);
    expect(result.confidence).toBe(0);
  });
  it('a claimed match below the 0.8 merge threshold does not merge', async () => {
    const result = await resolveEntities(recordA, recordA, fakeClient('{"is_match": true, "confidence": 0.7}'));
    expect(result.is_match).toBe(false);
    expect(result.confidence).toBe(0.7);
  });
  it('accepts a fenced JSON reply', async () => {
    const result = await resolveEntities(recordA, recordA, fakeClient('```json\n{"is_match": true, "confidence": 0.9, "reason": "ok"}\n```'));
    expect(result.is_match).toBe(true);
  });
  it('unparseable output is reported as no match, never thrown', async () => {
    const result = await resolveEntities(recordA, recordA, fakeClient('not json'));
    expect(result.is_match).toBe(false);
    expect(result.confidence).toBe(0);
    expect(result.reason).toMatch(/^Parse error/);
  });
  it('test_merge_records_prefers_primary', () => {
    const primary = { name: "John's Barbershop", phone: '773-555-1234', email: null };
    const secondary = { name: 'Johns Barber Shop', phone: '773-555-9999', email: 'john@barber.com' };
    const merged = mergeRecords(primary, secondary);
    expect(merged.name).toBe("John's Barbershop");
    expect(merged.phone).toBe('773-555-1234');
    expect(merged.email).toBe('john@barber.com');
  });
  it('test_merge_records_fills_none_values', () => {
    const primary = { name: 'Test', website: null, rating: null };
    const secondary = { website: 'http://test.com', rating: 4.5, extra: 'data' };
    const merged = mergeRecords(primary, secondary);
    expect(merged.website).toBe('http://test.com');
    expect(merged.rating).toBe(4.5);
    expect(merged.extra).toBe('data');
  });
});

describe('generateOutreachBrief', () => {
  const business = { name: "Rosa's Nails", niche: 'nail_salons', address: '4500 S Ashland Ave', zip_code: '60609' };
  const dp = { google_avg_rating: 4.2, google_review_count: 37, has_website: false, has_facebook_page: true, has_instagram: false };
  const modelBrief = {
    talking_points: ['a', 'b', 'c'], observations: ['x'], pitch_angle: 'angle', opening_line: 'hi',
    voicemail_script: 'vm', objection_responses: { price: 'p', not_interested: 'n', already_have_agency: 'a' },
  };

  it('returns the parsed brief and feeds business, presence and scores into the prompt', async () => {
    const client = fakeClient(JSON.stringify(modelBrief));
    const brief = await generateOutreachBrief(business, dp, { deficitScore: 72, pressureScore: 40, priceTier: 2 }, client);
    expect(brief).toEqual(modelBrief);
    const prompt = client.prompts[0];
    expect(prompt).toContain("Business: Rosa's Nails");
    expect(prompt).toContain('Type: nail_salons');
    expect(prompt).toContain('4500 S Ashland Ave, Chicago, IL 60609');
    expect(prompt).toContain('Google rating: 4.2 (37 reviews)');
    expect(prompt).toContain('Digital deficit score: 72/100');
    expect(prompt).toContain('Price tier: 2');
    expect(prompt).not.toContain('Neighborhood Opportunity Fund');
  });
  it('uses the grant prompt when the business is NOF eligible (ADR 025)', async () => {
    const client = fakeClient(JSON.stringify(modelBrief));
    await generateOutreachBrief(business, null, { nofEligible: true }, client);
    expect(client.prompts[0]).toContain('Neighborhood Opportunity Fund');
    expect(client.prompts[0]).toContain('Google rating: N/A (0 reviews)');
  });
  it('falls back to the marketing brief when the model is unavailable', async () => {
    const brief = await generateOutreachBrief(business, dp, {}, fakeClient(null));
    expect(brief.opening_line).toBe("Hi, I'm calling about Rosa's Nails");
    expect(brief.objection_responses).toHaveProperty('price');
  });
  it('falls back to the grant brief on unparseable output when NOF eligible', async () => {
    const brief = await generateOutreachBrief(business, dp, { nofEligible: true }, fakeClient('nope'));
    expect(brief.opening_line).toBe("Hi, I'm calling about a grant opportunity for Rosa's Nails");
    expect(brief.objection_responses).toHaveProperty('too_complicated');
  });
});

describe('analyzeSentiment', () => {
  const full = {
    sentiment_score: 0.6, sentiment_label: 'interested', objections: ['price'], interest_signals: ['asked for pricing'],
    purchase_intent: 'medium', recommended_action: 'scheduled', summary: 'Owner wants a follow-up.',
  };

  it('returns the parsed analysis for a transcript', async () => {
    const client = fakeClient(JSON.stringify(full));
    const result = await analyzeSentiment('Agent: hi. Owner: tell me more.', client);
    expect(result).toEqual(full);
    expect(client.prompts[0]).toContain('Owner: tell me more.');
  });
  it('an empty transcript is neutral and never calls the model', async () => {
    const client = fakeClient(JSON.stringify(full));
    const result = await analyzeSentiment('   ', client);
    expect(result.sentiment_score).toBe(0);
    expect(result.sentiment_label).toBe('neutral');
    expect(result.recommended_action).toBe('deprioritize');
    expect(client.prompts).toHaveLength(0);
  });
  it('clamps the score into [-1, 1] so the ADR 014 multiplier stays bounded', async () => {
    const hi = await analyzeSentiment('t', fakeClient('{"sentiment_score": 7}'));
    expect(hi.sentiment_score).toBe(1);
    const lo = await analyzeSentiment('t', fakeClient('```json\n{"sentiment_score": -3}\n```'));
    expect(lo.sentiment_score).toBe(-1);
  });
  it('model unavailable or unparseable output yields the neutral default', async () => {
    const unavailable = await analyzeSentiment('t', fakeClient(null));
    expect(unavailable.summary).toBe('Sentiment analysis unavailable');
    const garbage = await analyzeSentiment('t', fakeClient('<html>'));
    expect(garbage.sentiment_score).toBe(0);
    expect(garbage.purchase_intent).toBe('none');
  });
});
