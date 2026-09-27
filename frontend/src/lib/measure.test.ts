import { describe, expect, it } from 'vitest';
import { formatAccount, formatNiche, formatScore } from './measure';

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

  it('turns a niche key into words', () => {
    expect(formatNiche('beauty_supply')).toBe('Beauty supply');
  });
});
