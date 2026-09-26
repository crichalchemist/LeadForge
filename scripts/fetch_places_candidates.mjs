// Fetches the three inputs that scripts/measure_places_sources.py scores.
//
//   node scripts/fetch_places_candidates.mjs licences   <outdir>
//   node scripts/fetch_places_candidates.mjs google     <outdir>   # ~2 billable calls per business
//   node scripts/fetch_places_candidates.mjs foursquare <outdir>
//
// Keys are read from the repo's gitignored .env (GOOGLE_PLACES_API_KEY, FOURSQUARE_API_KEY);
// never from api/.dev.vars, which is tracked. Google and Foursquare append JSONL and skip businesses
// already present, so an interrupted run resumes instead of paying twice.
//
// The resume set is keyed by the city's account_number/site_number, never by name. Five of the 157
// names in 60619 are held by two or three different licence accounts, so a name-keyed resume would
// skip the duplicates and leave the output misaligned with the licence list -- the same mistake that
// once made measure_places_sources.py under-report every source at once.
import fs from 'fs';
import path from 'path';

const [mode, outdir] = process.argv.slice(2);
if (!mode || !outdir) { console.error('usage: <licences|google|foursquare> <outdir>'); process.exit(1); }
const envKey = (name) => {
  const line = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n').find((l) => l.startsWith(name + '='));
  if (!line) throw new Error(name + ' not in .env');
  return line.slice(name.length + 1).trim();
};
const bkey = (b) => `${b.account_number}/${b.site_number ?? ''}`;

// Refuses a file written before results carried `key` rather than silently re-paying for every
// lookup in it: an undefined key matches nothing, so the run would look like a fresh one.
function resumeSet(outPath) {
  if (!fs.existsSync(outPath)) return new Set();
  const recs = fs.readFileSync(outPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  if (recs.some((r) => r.key === undefined)) {
    throw new Error(`${outPath} predates licence-account keying — delete it to refetch, or it will be re-paid for silently`);
  }
  return new Set(recs.map((r) => r.key));
}
const hav = (a, b, c, d) => {
  const R = 6371000, t = Math.PI / 180, x = (c - a) * t, y = (d - b) * t;
  const h = Math.sin(x / 2) ** 2 + Math.cos(a * t) * Math.cos(c * t) * Math.sin(y / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

// Mirrors api/src/scrapers/socrata.ts: niche barbershops -> 'hair service', normalizeResult,
// dedupeLicenseRows (account_number/site_number, else name|zip; newest license_start_date wins).
async function licences() {
  const where = `zip_code='60619' AND (upper(business_activity) like upper('%hair service%'))`;
  const rows = [];
  for (let off = 0; ; off += 1000) {
    const page = await (await fetch('https://data.cityofchicago.org/resource/r5kz-chrr.json?' +
      new URLSearchParams({ $where: where, $limit: '1000', $offset: String(off) }))).json();
    rows.push(...page);
    if (page.length < 1000) break;
  }
  const latest = new Map();
  for (const r of rows) {
    const row = {
      account_number: r.account_number ?? null, site_number: r.site_number ?? null,
      latitude: r.latitude ? Number(r.latitude) : null,
      longitude: r.longitude ? Number(r.longitude) : null,
      name: r.doing_business_as_name || r.legal_name || '',
      address: r.address ?? '', zip_code: r.zip_code ?? '',
      license_issue_date: r.license_start_date ?? null,
    };
    const key = row.account_number ? `${row.account_number}/${row.site_number ?? ''}`
                                   : `${row.name.toLowerCase()}|${row.zip_code}`;
    const seen = latest.get(key);
    if (!seen || (row.license_issue_date ?? '') > (seen.license_issue_date ?? '')) latest.set(key, row);
  }
  const out = [...latest.values()];
  fs.writeFileSync(path.join(outdir, 'licences.json'), JSON.stringify(out));
  console.log(`licence_rows=${rows.length} businesses=${out.length} ` +
              `geocoded=${out.filter((b) => b.latitude && b.longitude).length}`);
}

// Legacy Places (maps.googleapis.com), the surface api/src/scrapers/google-places.ts calls, with
// its exact field lists. locationbias is a BIAS not a filter, so the distance is recorded and the
// 200 m cut is applied at scoring time -- otherwise Google quietly out-reaches the other two.
async function google() {
  const key = envKey('GOOGLE_PLACES_API_KEY');
  const H = 'https://maps.googleapis.com';
  const FIND = 'place_id,name,formatted_address,geometry';
  const DET = 'place_id,name,formatted_address,geometry/location,formatted_phone_number,' +
              'website,rating,user_ratings_total,business_status,opening_hours,reviews';
  const CAP = 400;
  let calls = 0;
  const outPath = path.join(outdir, 'google_results.jsonl');
  const biz = JSON.parse(fs.readFileSync(path.join(outdir, 'licences.json'), 'utf8'));
  const done = resumeSet(outPath);
  const fh = fs.openSync(outPath, 'a');
  const t = { m: 0, n: 0, e: 0 };
  for (const b of biz) {
    if (done.has(bkey(b))) continue;
    if (calls + 2 > CAP) { console.log('CAP REACHED'); break; }
    const rec = { key: bkey(b), name: b.name, lat: b.latitude, lon: b.longitude };
    try {
      calls++;
      const f = await (await fetch(H + '/maps/api/place/findplacefromtext/json?' + new URLSearchParams({
        input: `${b.name} ${b.address}`, inputtype: 'textquery', fields: FIND,
        locationbias: `circle:200@${b.latitude},${b.longitude}`, key }))).json();
      rec.status = f.status;
      const c = (f.candidates || [])[0];
      if (c) {
        const gl = c.geometry?.location;
        calls++;
        const d = await (await fetch(H + '/maps/api/place/details/json?' + new URLSearchParams({
          place_id: c.place_id, fields: DET, key }))).json();
        const r = d.result || {};
        rec.place = { pid: c.place_id, n: c.name, addr: c.formatted_address,
          lat: gl?.lat, lon: gl?.lng,
          dist: gl ? Math.round(hav(b.latitude, b.longitude, gl.lat, gl.lng)) : null,
          rating: r.rating ?? null, reviews: r.user_ratings_total ?? null,
          site: r.website ?? null, phone: r.formatted_phone_number ?? null,
          bstatus: r.business_status ?? null, nrev: (r.reviews || []).length };
        rec.dstatus = d.status;
        t.m++;
      } else t.n++;
    } catch (e) { rec.err = String(e).slice(0, 80); t.e++; }
    fs.writeSync(fh, JSON.stringify(rec) + '\n');
    await new Promise((r) => setTimeout(r, 120));
  }
  fs.closeSync(fh);
  console.log(`calls=${calls} matched=${t.m} no_candidate=${t.n} errors=${t.e}`);
}

// Only the fields the free Service Key entitles (e203656): rating/stats/hours/price/popularity
// return 429 with x-ratelimit-limit: 0 and fail the WHOLE request. Serial ~1/s: the burst limit
// is 150 and a breach 429s everything until it refills.
async function foursquare() {
  const key = envKey('FOURSQUARE_API_KEY');
  const F = 'fsq_place_id,name,location,latitude,longitude,website,tel,email,social_media,categories';
  const outPath = path.join(outdir, 'fsq_results.jsonl');
  const biz = JSON.parse(fs.readFileSync(path.join(outdir, 'licences.json'), 'utf8'));
  const done = resumeSet(outPath);
  const fh = fs.openSync(outPath, 'a');
  const t = { m: 0, n: 0, e: 0 };
  for (const b of biz) {
    if (done.has(bkey(b))) continue;
    const rec = { key: bkey(b), name: b.name };
    try {
      const r = await fetch('https://places-api.foursquare.com/places/search?' + new URLSearchParams({
        query: b.name, ll: `${b.latitude},${b.longitude}`, radius: '200', limit: '1', fields: F }),
        { headers: { Authorization: 'Bearer ' + key, 'X-Places-Api-Version': '2025-06-17' } });
      rec.http = r.status;
      if (r.status === 200) {
        const p = ((await r.json()).results || [])[0];
        if (p) {
          rec.place = { n: p.name, site: p.website || null, tel: p.tel || null,
            fb: !!p.social_media?.facebook_id, ig: !!p.social_media?.instagram,
            tw: !!p.social_media?.twitter };
          t.m++;
        } else t.n++;
      } else { rec.body = (await r.text()).slice(0, 60); t.e++; }
    } catch (e) { rec.err = String(e).slice(0, 60); t.e++; }
    fs.writeSync(fh, JSON.stringify(rec) + '\n');
    await new Promise((r) => setTimeout(r, 1050));
  }
  fs.closeSync(fh);
  console.log(`matched=${t.m} no_result=${t.n} errors=${t.e}`);
}

await ({ licences, google, foursquare }[mode] ?? (() => { throw new Error('unknown mode ' + mode); }))();
