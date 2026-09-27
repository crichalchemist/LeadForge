// Every measured value on screen passes through here, so an absent measurement never renders as a number
// (PRODUCT.md: unknown is shown as unknown; DESIGN.md: The Planned Track Rule). A real zero stays a zero;
// only null and undefined become words.
import { STAGE_LABELS } from '../types';

export type Absence = 'not measured' | 'not recorded';

/** A composite or a term: whole numbers as they are, anything else to one decimal. */
export function formatScore(value: number | null | undefined, absent: Absence = 'not measured'): string {
  if (value === null || value === undefined || Number.isNaN(value)) return absent;
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

/** A name-match score, 0 to 1, to the two decimals the threshold (0.50) is written in. */
export function formatNameScore(value: number | null): string {
  return value === null ? 'not recorded' : value.toFixed(2);
}

export function formatDistance(metres: number | null): string {
  return metres === null ? 'not recorded' : `${formatCount(metres)} m`;
}

export function formatRating(value: number): string {
  return `${value.toFixed(1)} of 5`;
}

export function formatNiche(niche: string): string {
  const words = niche.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function formatStage(stage: string): string {
  return STAGE_LABELS[stage] ?? formatNiche(stage);
}

/** The city's licence account as one identifier: the account, then the site when there is one. */
export function formatAccountId(account: string, site: string | null): string {
  return site === null ? account : `${account}-${site}`;
}

/** The licence account as the label grid prints it, named as an account so it never reads as the licence
 *  number, which is a different identifier. */
export function formatAccount(account: string | null, site: string | null): string {
  if (account === null) return 'no licence account';
  return `Account ${formatAccountId(account, site)}`;
}

export function formatDate(iso: string | null): string {
  return iso === null ? 'not recorded' : iso.slice(0, 10);
}
