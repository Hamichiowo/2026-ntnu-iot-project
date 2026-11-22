import { describe, expect, it } from 'bun:test';
import { apr1 } from '../src/auth/session';

describe('Authentication security', () => {
  it('matches Apache APR1 htpasswd output', () => {
    expect(apr1('adminpassword', 'testsalt')).toBe('$apr1$testsalt$whrPRbusxE1/eicd7bmek.');
  });

  it('uses only the first eight salt characters', () => {
    expect(apr1('adminpassword', '$apr1$testsalt-extra$ignored'))
      .toBe('$apr1$testsalt$whrPRbusxE1/eicd7bmek.');
  });
});
