// Which source supplied each fact on a lead record, and whether an absent fact was looked for (ADR 031).
//
// One principle: a source is credited for a fact only when its recorded value equals the value the
// record displays. Discovery stores Google's value first and Overture's second (applyOvertureMatch), so
// "the source had a value" is not enough: when both found a website and they differ, the record shows
// Google's and only Google is credited. These rules live here and nowhere else; the frontend renders
// what this returns.
import { overturePresent, type OvertureMatch } from './overture';
import type { GoogleMatchRow } from '../types';

export type Source = 'license' | 'google' | 'overture';

/**
 * found: a value is displayed. none_found: a source looked and had nothing. unknown: the source that
 * could supply it was not consulted — a refused Places lookup, or a licence Overture's build never
 * covered. not_recorded: stored before migration 0005, so whether anyone looked is not known.
 */
export type FactState = 'found' | 'none_found' | 'unknown' | 'not_recorded';

export type FactKey =
  | 'name' | 'license_status' | 'website' | 'phone'
  | 'google_business_profile' | 'rating' | 'review_count' | 'facebook' | 'instagram';

export interface Fact {
  key: FactKey;
  value: string | number | boolean | null;
  sources: Source[];
  state: FactState;
}

export interface ProvenanceInput {
  business: { name: string; license_name: string | null; phone: string | null; license_status: string | null };
  presence: {
    website_url: string | null;
    has_google_business_profile: number;
    google_avg_rating: number | null;
    google_review_count: number | null;
    has_facebook_page: number;
    has_instagram: number;
  } | null;
  google: GoogleMatchRow | null;
  overture: OvertureMatch | null;
}

const GOOGLE: Source[] = ['google'];
const OVERTURE: Source[] = ['overture'];
const LICENSE: Source[] = ['license'];
const NONE: Source[] = [];

export function deriveFacts({ business, presence, google, overture }: ProvenanceInput): Fact[] {
  const googleMatched = google?.status === 'matched';
  const googleLooked = google !== null && google.status !== 'unavailable';
  const overtureMatched = overture?.matched === 1;

  // Google alone supplies the profile, the rating and the review count.
  const googleState = (present: boolean): FactState =>
    present ? 'found' : google === null ? 'not_recorded' : googleLooked ? 'none_found' : 'unknown';

  // Either source can supply a website or a phone. A refused Places lookup leaves the fact open even when
  // Overture looked, because Google could have supplied it (unavailable outranks every other status).
  // Otherwise an Overture row, matched or not, means its build looked at this licence.
  const eitherState = (present: boolean): FactState => {
    if (present) return 'found';
    if (google?.status === 'unavailable') return 'unknown';
    if (googleLooked || overture !== null) return 'none_found';
    return 'not_recorded';
  };

  // Overture alone supplies social links; Google reports none.
  const overtureState = (present: boolean): FactState =>
    present ? 'found' : overture !== null ? 'none_found' : 'unknown';

  const creditByValue = (displayed: string | null, googleValue: string | null, overtureValue: string | null): Source[] => {
    if (displayed === null) return NONE;
    const sources: Source[] = [];
    if (googleValue !== null && googleValue === displayed) sources.push('google');
    if (overtureMatched && overturePresent(overtureValue) === displayed) sources.push('overture');
    return sources;
  };

  // Details' name is not stored, so a name that differs from the licence's is credited to Google only
  // when Google matched. An operator's rename after a match reads the same way (ADR 031, consequences).
  const nameSources =
    business.license_name === null ? NONE
      : business.name === business.license_name ? LICENSE
        : googleMatched ? GOOGLE : NONE;

  const website = presence?.website_url ?? null;
  const gbp = presence ? presence.has_google_business_profile === 1 : null;
  const rating = presence?.google_avg_rating ?? null;
  const reviews = presence?.google_review_count ?? null;
  const facebook = presence ? presence.has_facebook_page === 1 : null;
  const instagram = presence ? presence.has_instagram === 1 : null;

  return [
    { key: 'name', value: business.name, sources: nameSources, state: 'found' },
    {
      key: 'license_status', value: business.license_status,
      sources: business.license_status === null ? NONE : LICENSE,
      state: business.license_status === null ? 'none_found' : 'found',
    },
    {
      key: 'website', value: website,
      sources: creditByValue(website, google?.website ?? null, overture?.website ?? null),
      state: eitherState(website !== null),
    },
    {
      key: 'phone', value: business.phone,
      sources: creditByValue(business.phone, google?.phone ?? null, overture?.phone ?? null),
      state: eitherState(business.phone !== null),
    },
    { key: 'google_business_profile', value: gbp, sources: gbp && googleMatched ? GOOGLE : NONE, state: googleState(gbp === true) },
    { key: 'rating', value: rating, sources: rating !== null && googleMatched ? GOOGLE : NONE, state: googleState(rating !== null) },
    // Zero reviews is a measurement: Google returned the place and it has none.
    { key: 'review_count', value: reviews, sources: reviews !== null && googleMatched ? GOOGLE : NONE, state: googleState(reviews !== null) },
    {
      key: 'facebook', value: facebook,
      sources: facebook && overtureMatched && overture?.has_facebook === 1 ? OVERTURE : NONE,
      state: overtureState(facebook === true),
    },
    {
      key: 'instagram', value: instagram,
      sources: instagram && overtureMatched && overture?.has_instagram === 1 ? OVERTURE : NONE,
      state: overtureState(instagram === true),
    },
  ];
}
