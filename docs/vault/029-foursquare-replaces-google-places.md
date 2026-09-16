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

---

## Correction (2026-09-16) — measured against a live key

The Decision above stands, but two claims in its Context and Consequences were wrong. They were
taken from the published field list without a key to test against. Recorded here rather than
edited away, because the gap between what the docs list and what a plan entitles is the whole
lesson.

### Wrong claim 1: "everything the deficit takes from Google"

The response carries what your **plan entitles**, and the free Service Key does not entitle the
review and rating fields. Requesting them does not omit them — it fails the entire request with
HTTP 429 and `x-ratelimit-limit: 0`, which is an allowance the plan never had rather than an
exhausted quota. Measured field by field:

| Entitled (HTTP 200) | Denied (HTTP 429, `limit: 0`) |
|---|---|
| `fsq_place_id`, `name`, `location`, `latitude`, `longitude` | `rating` |
| `website`, `tel`, `email` | `stats` (and so `stats.total_ratings`) |
| `social_media`, `categories` | `hours`, `price`, `popularity` |

So `SEARCH_FIELDS` is an entitlement boundary, not a preference: adding one denied field silently
breaks every lookup. The deficit keeps its website (30), source-presence (15) and social (12)
terms and loses the review terms (10/5); `computeViability` loses its whole rating/review/velocity
block. A business the source has no record of therefore scores **64, not 74**.

### Wrong claim 2: the match rate would be the thing to measure, and 89% is it

Measured over all 157 licensed `hair service` businesses in 60619, one lookup each, using the
city's geocode (157/157 geocoded) with a 200 m radius and `limit=1`:

| | |
|---|---|
| Matched something | 140 / 157 (89.2%) |
| **Name-corroborated** | **~76 / 157 (~48%)** |
| Matched the wrong nearby business | ~60 of the 140 matches |
| Website present among matches | 46 / 140 (32.9%) |
| Phone present | 100 / 140 (71.4%) |
| Facebook or Instagram present | 14 / 140 (10.0%) |

The 89% is a *geo* match rate and is not the useful number. `limit=1` returns the nearest place
whatever its name, so `ACHOTI SALON LLC` matched `Billbusters, Ledford, Wu & Borge` — a law firm,
whose website would be imported as the salon's. **A false match is worse than no match**, because
it flips the deficit's largest term the wrong way on fabricated evidence.

Resulting deficit distribution: 5 distinct values spanning 7–64, with 59% of businesses in a
single bucket (49). Better than one constant; not by as much as this ADR assumed.

### What has not been tried

The matching was not tuned before measuring, and two untested changes likely dominate any
string-similarity threshold: `limit=10` with a `fsq_category_ids` filter (`categories` is
entitled) so the best *plausible* candidate can be chosen rather than the nearest one, and a
tighter radius than 200 m, which in a commercial corridor spans many storefronts. Threshold
tuning on 157 rows was started and abandoned: every band examined was roughly half wrong, and
each confound fixed (possessive `'s`, sector vocabulary) revealed the next.

### Standing question

Whether to stay on the API or switch to the bulk Open Source Places dataset is **reopened**. The
bulk route has no entitlement tiering, carries the denied fields, and makes matching an offline
problem where ten algorithms can be tried in a minute instead of one per 157 calls. It remains
gated: as of 2026-09-16 the repository lists but its contents return
`Access to dataset foursquare/fsq-os-places is restricted and you are not in the authorized list`.
