// Ground truth comes from the City's own eligibility lookup app, which the NOF programme site
// links: the same two ArcGIS layers this asset is generated from.
import { describe, expect, it } from 'vitest';
import { CORRIDOR_SOURCE, locateCorridor } from '../src/lib/corridors';

describe('locateCorridor', () => {
  it('places known NOF corridor intersections on a priority corridor', () => {
    expect(locateCorridor(41.7509, -87.644)).toMatchObject({ corridor_type: 'priority', is_priority: true });
    expect(locateCorridor(41.7797, -87.606)).toMatchObject({ corridor_type: 'priority', is_priority: true });
  });

  it('places a licensed barbershop from the live Socrata data on a corridor', () => {
    // The coordinates the city publishes for account 478849, used in the discovery fixtures
    const match = locateCorridor(41.7514067334, -87.6043524136);
    expect(match).not.toBeNull();
    expect(match?.corridor_name).toMatch(/^(Priority|Eligible) corridor \d+$/);
  });

  it('rejects downtown and the lake, neither of which is an NOF corridor', () => {
    expect(locateCorridor(41.8789, -87.6359)).toBeNull(); // Willis Tower
    expect(locateCorridor(41.8, -87.55)).toBeNull(); // Lake Michigan
  });

  it('returns null when a business has no coordinates', () => {
    expect(locateCorridor(null, null)).toBeNull();
    expect(locateCorridor(41.7509, null)).toBeNull();
    expect(locateCorridor(null, -87.644)).toBeNull();
  });

  it('rejects points far outside Chicago', () => {
    expect(locateCorridor(40.7128, -74.006)).toBeNull(); // New York
    expect(locateCorridor(0, 0)).toBeNull();
  });

  it('bundles both layers', () => {
    expect(CORRIDOR_SOURCE.ring_count).toBe(45);
    expect(CORRIDOR_SOURCE.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
