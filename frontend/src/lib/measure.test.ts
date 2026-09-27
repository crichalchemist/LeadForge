import { describe, expect, it } from 'vitest';
import { formatAccount, formatNameScore, formatNiche, formatScore } from './measure';

describe('measured values', () => {
  it('renders an absent score as words, never as zero', () => {
    expect(formatScore(null)).toBe('not measured');
    expect(formatScore(undefined, 'not recorded')).toBe('not recorded');
  });

  it('keeps a real zero a zero', () => {
    expect(formatScore(0)).toBe('0');
  });

  it('writes whole scores as they are and fractional ones to one decimal', () => {
    expect(formatScore(64)).toBe('64');
    expect(formatScore(48.25)).toBe('48.3');
  });

  it('labels the account as an account, never as a licence', () => {
    expect(formatAccount('478849', '1')).toBe('Account 478849-1');
    expect(formatAccount('478849', null)).toBe('Account 478849');
    expect(formatAccount(null, null)).toBe('no licence account');
  });

  it('never shows a rejected name score as the 0.50 threshold it fell below', () => {
    expect(formatNameScore(0.4996)).toBe('0.49');
    expect(formatNameScore(0.49999999999999994)).toBe('0.49');
    expect(formatNameScore(0.5)).toBe('0.50');
  });

  it('writes a name score to two decimals as stored, without binary drift or exponents', () => {
    expect(formatNameScore(0.57)).toBe('0.57');
    expect(formatNameScore(1)).toBe('1.00');
    expect(formatNameScore(0)).toBe('0.00');
    expect(formatNameScore(1e-7)).toBe('0.00');
    expect(formatNameScore(null)).toBe('not recorded');
  });

  it('turns a niche key into words', () => {
    expect(formatNiche('beauty_supply')).toBe('Beauty supply');
  });
});
