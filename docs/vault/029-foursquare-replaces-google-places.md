# ADR-029: Foursquare Places replaces Google Places as the enrichment source

## Status

Accepted. Supersedes ADR-004. Narrows ADR-005.

## Date

2026-09-15

## Context

Google Places is unavailable to this project indefinitely, and the reason is commercial rather
than technical: the Cloud project's billing account is broken and demands a prepayment the owner
has not made. The key itself is real and the APIs are enabled; every call returns
`REQUEST_DENIED`. No amount of code fixes that.

The pipeline's first live run (2026-09-15) therefore measured nothing. Fifty licence rows in 60619
collapsed to five businesses, all geocoded by the city and all on an NOF corridor, and every one
of them was stored with a digital deficit of 74 — the constant `computeDigitalDeficit` returns
when every enrichable signal is absent. That is 40% of the composite score carrying no
information.

Alternatives were measured rather than assumed. OpenStreetMap via Nominatim matched 0 of the 5
real businesses with `extratags=1`; Overpass failed on three mirrors across two sessions; Yelp
Fusion's free tier has ended and now costs roughly $8 per 1,000 calls. Foursquare's Places API
grants 500 Pro calls a month with no credit card.

The decisive detail came from the API schema rather than the pricing page. A Foursquare **search**
result carries the same field set as a place-details lookup — `website`, `tel`, `email`, `rating`,
`stats.total_ratings`, `social_media` — so a business is enriched in one call where Google needed
find-place *and* details. The free month is worth 500 businesses, not 250, and the per-business
subrequest cost against the Worker's 50-per-invocation free-plan cap halves.

## Decision

`api/src/scrapers/foursquare.ts` becomes discovery's enrichment source. `google-places.ts` stays
in the tree, tested, unreferenced by the pipeline: the swap is one import to reverse if the match
rate against real licence rows disappoints.

Four things follow from the source change and are not incidental to it.

**Dedup moves to `fsq_place_id`** (migration `0002`), a new column with a unique index rather than
a reuse of `google_place_id`: the two are different namespaces. SQLite cannot add a `UNIQUE` column
via `ALTER TABLE`, so the constraint is a separate index; NULLs stay distinct there, so businesses
that matched nothing do not collide. This supersedes ADR-004's choice of `google_place_id` as the
primary dedup key. The name+zip fallback survives unchanged.

**The client reads HTTP status itself and never routes through `fetchJson`.** Google signals a
denied key with HTTP 200 and a `status` field; Foursquare uses real status codes, which is easier
to read but harder to survive. `base.ts`'s `assertOk` throws on any non-2xx, and that throw would
unwind past the per-run health tally into `runDiscovery`'s per-business catch — dropping the
business *and* reporting a clean run. So 401/403 becomes `UNAUTHORIZED`, 429 `RATE_LIMITED`, 5xx
`SERVER_ERROR`, 400 `BAD_REQUEST`, and a transport failure `NETWORK_ERROR`; each increments the
tally and returns null, leaving the business stored with a null deficit. A 200 with an empty
`results` array is a genuine no-match and is scored as a measurement.

**Ratings are rescaled at ingest.** Foursquare rates 0.0–10.0 where Google rates 0.0–5.0, and
`digital_presences.google_avg_rating` is consumed as a Google rating: `computeViability` awards its
top bonus at `>= 4.0`. Stored raw, a mediocre 7.2 would max that bonus for nearly every business —
a constant dressed as a signal. The conversion is arithmetic only and claims nothing about the two
sources' distributions agreeing.

**Social presence becomes real signal.** The Google port hardcoded `has_facebook_page` and
`has_instagram` to 0, charging every business the same 12-point social penalty.
`social_media.facebook_id`/`instagram` replaces that constant with an observation.

`has_google_business_profile` keeps its meaning rather than gaining one. In the Google port it was
set true whenever details returned — "the source has a record", not "an owner-managed profile
exists", since every business Google knows has a Places record. Matched in Foursquare means the
same thing, so the deficit's 15 points still key on presence in the enrichment source.

## Consequences

### Positive
- One subrequest per business instead of two; the route's worst case drops from 41 to 21 of 50
- 500 free calls a month buys 500 businesses, enough to measure all 168 real 60619 businesses
- No URL signing: no HMAC-SHA1, no base64-padding hazard, no shared secret
- A failing source now stores the business unmeasured rather than dropping it
- Two constants removed from the deficit (social, and the 74 for unmeasured businesses)

### Negative
- Deficits from this source are not comparable with Python's, which still reads Google
- Match rate against real Chicago licence rows is **unmeasured** — it needs a key
- 500 calls/month is a hard ceiling on discovery volume without paying $15/1,000
- A second enrichment namespace now exists in `businesses`; `google_place_id` is dead but retained

### Neutral
- ADR-005's Google field masks are moot; its Socrata pagination half still stands
- `scrapers/yelp.ts` and `google-places.ts` remain inert but tested

## Alternatives Considered

1. **Foursquare's bulk open dataset** (`hf://datasets/foursquare/fsq-os-places`, Apache-2.0,
   11.5 GB) — Deferred, not rejected. Filtered to Chicago it would suit the ADR-028 bundled-asset
   pattern, cost no subrequests at ingest, and carry no monthly ceiling. It is gated behind
   accepting terms with a Hugging Face account, and its coverage could not be verified first-hand:
   the repository returns 401 even for its README. The API answers the coverage question first,
   and cheaply; if the match rate holds up, the bulk import becomes the volume play.

2. **Keep Google and fall back to Foursquare** — Rejected. Google is dead indefinitely, so the
   primary branch would be permanently dead code, and two enrichment paths would mean two sets of
   scoring semantics reachable from one pipeline.

3. **Pay Google's prepayment** — Rejected; it is the owner's call, not an architectural one, and
   $15/1,000 Foursquare calls beats Google's pricing after the free tier either way.

4. **Ship the NOF grant track on free data only** — Rejected as the sole plan, though it remains
   viable: all three of `computeNofEligibility`'s hard gates are free-data driven and it reaches
   75/100 without any Places source. Viability caps at 35/100 without reviews, so outreach scoring
   would stay parked. This is a narrowing of the product, not a fix for the data gap.
