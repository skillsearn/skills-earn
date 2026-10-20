import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isWindowOpen, nextWindowStart, normalizeMobile, toCamel, toCsv, withdrawalQuote, WithdrawalSettings } from './util';

const base: WithdrawalSettings = {
  mode: 'weekly', weeklyDay: 1, monthlyDay: 5, windowDays: 1, minAmount: 500,
  chargeBps: 500, processingEnabled: true, manualPayoutConfirmation: true,
};

test('withdrawal quote matches spec examples', () => {
  assert.deepEqual(withdrawalQuote(1000, 500), { gross: 1000, chargeBps: 500, charge: 50, net: 950 });
  assert.deepEqual(withdrawalQuote(5000, 500), { gross: 5000, chargeBps: 500, charge: 250, net: 4750 });
  assert.deepEqual(withdrawalQuote(10000, 500), { gross: 10000, chargeBps: 500, charge: 500, net: 9500 });
  assert.deepEqual(withdrawalQuote(333.33, 500), { gross: 333.33, chargeBps: 500, charge: 16.67, net: 316.66 });
});

test('mobile normalisation', () => {
  assert.equal(normalizeMobile('9876543210'), '+919876543210');
  assert.equal(normalizeMobile('+91 98765-43210'), '+919876543210');
  assert.equal(normalizeMobile('09876543210'), '+919876543210');
  assert.equal(normalizeMobile('12345'), null);
  assert.equal(normalizeMobile('5876543210'), null);
});

test('weekly window uses IST weekday', () => {
  // Monday 2026-10-19 00:30 IST = Sunday 2026-10-18 19:00 UTC
  assert.equal(isWindowOpen(base, new Date('2026-10-18T19:00:00Z')), true);
  // Sunday 23:00 IST
  assert.equal(isWindowOpen(base, new Date('2026-10-18T17:30:00Z')), false);
  assert.equal(nextWindowStart(base, new Date('2026-10-16T06:00:00Z')), '2026-10-19');
});

test('monthly window with multiple days', () => {
  const s = { ...base, mode: 'monthly' as const, monthlyDay: 5, windowDays: 3 };
  assert.equal(isWindowOpen(s, new Date('2026-10-07T06:00:00Z')), true);
  assert.equal(isWindowOpen(s, new Date('2026-10-08T06:00:00Z')), false);
  assert.equal(nextWindowStart(s, new Date('2026-10-08T06:00:00Z')), '2026-11-05');
});

test('toCamel and csv', () => {
  assert.deepEqual(toCamel({ user_code: 'SE1', nested_obj: [{ full_name: 'A' }] }), { userCode: 'SE1', nestedObj: [{ fullName: 'A' }] });
  const csv = toCsv([{ a: '=HYPERLINK()', b: 'x,y', c: -5 }], [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }, { key: 'c', label: 'C' }]);
  assert.equal(csv, "﻿A,B,C\n'=HYPERLINK(),\"x,y\",-5");
});
