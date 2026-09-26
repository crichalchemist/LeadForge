// Differential test against the reference scorer that produced ADR 030's measurements. The vectors
// in fixtures/name-match-vectors.json were produced by scripts/gen_name_match_vectors.py over the
// 102 real Google candidates measured within 200 m of a licensed 60619 business, plus the
// adversarial pairs earlier versions of this scorer got wrong.
//
// A drifted port would not fail any other test: it would quietly change which businesses get
// enriched and which get charged for a Places Details call. So every vector is pinned exactly.
import { describe, expect, it } from 'vitest';
import {
  NAME_MATCH_THRESHOLD,
  nameCorroborates,
  nameMatchScore,
  tokenizeName,
} from '../src/lib/name-match';
import vectors from './fixtures/name-match-vectors.json';

interface Vector {
  licence: string;
  candidate: string;
  score: number;
}

describe('name corroboration matches the reference scorer', () => {
  it.each(vectors as Vector[])('$licence -> $candidate', ({ licence, candidate, score }) => {
    expect(nameMatchScore(licence, candidate)).toBeCloseTo(score, 9);
  });

  it('reproduces the corroborated count ADR 030 reports for Google', () => {
    // 77 of the 102 measured in-band candidates. The two hand-written true matches in the fixture
    // (Brazzaville, Sangene's) are the only other vectors above threshold, so the total is 79.
    const above = (vectors as Vector[]).filter((v) => v.score >= NAME_MATCH_THRESHOLD);
    expect(above).toHaveLength(79);
    expect((vectors as Vector[]).every((v) => nameCorroborates(v.licence, v.candidate) === v.score >= NAME_MATCH_THRESHOLD)).toBe(true);
  });
});

describe('a nearest-place answer is not accepted as the business', () => {
  it('rejects a same-sector name that shares only its sector words', () => {
    // The failure this scorer exists to prevent: importing another salon's website as this one's,
    // which flips the digital deficit's 30-point website term on fabricated evidence.
    expect(nameCorroborates('CONSTANCE AFRICAN HAIR BRAIDING', 'Marseillais African Hair Braiding')).toBe(false);
    expect(nameCorroborates('CHICAGO NINE SOCIAL CLUB', 'Rulers Original Social Club')).toBe(false);
  });

  it('rejects an unrelated business at the same address', () => {
    expect(nameCorroborates('ACHOTI SALON LLC', 'Goldberg Weisman Cairo Law Offices')).toBe(false);
  });

  it('accepts a truncated form of the same distinctive name', () => {
    // Bigram overlap alone scores this pair at 0.50; the prefix rule is what keeps it.
    expect(nameCorroborates('BRAZZAVILLE HAIR BRAIDING', 'Brazza Hair Braiding')).toBe(true);
  });

  it('accepts a possessive spelled either way', () => {
    expect(nameCorroborates("SANGENE'S STYLING SALON", 'Sangenes Styling Salon')).toBe(true);
    expect(nameCorroborates("SANGENE'S STYLING SALON", "Sangene's Styling Salon")).toBe(true);
  });

  it('treats a name of only sector and suffix words as uncorroborated rather than a match', () => {
    // Every token is dropped, so there is no distinctive evidence either way. Scoring this 1.0
    // would make "LLC" corroborate any candidate at all.
    expect(nameMatchScore('LLC INC THE', 'LLC INC THE')).toBe(0);
    expect(nameMatchScore('', 'Something')).toBe(0);
  });

  it('is asymmetric: extra words in the candidate cost nothing', () => {
    // The licence name is the authority. A POI carrying a longer trading name is still the business.
    expect(nameCorroborates('AMIBE HAIR BRAIDING LLC', 'Amibe Hair Braiding and Beauty Supply')).toBe(true);
  });
});

describe('tokenization', () => {
  it('drops licence suffixes, short tokens and punctuation', () => {
    expect(tokenizeName('A & B Salon, LLC.')).toEqual(['salon']);
  });

  it('folds a trailing s only on longer tokens', () => {
    expect(tokenizeName('Angles Cuts')).toEqual(['angle', 'cuts']);
  });
});
