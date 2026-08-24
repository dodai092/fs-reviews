const test = require('node:test');
const assert = require('node:assert');
const { previousWeekRange } = require('../lib/weekRange');

test('previousWeekRange returns the Mon-Sun week before a mid-week date', () => {
  // Wednesday, 2026-08-19
  const now = new Date(2026, 7, 19, 10, 0, 0);
  const { start, end } = previousWeekRange(now);
  const startDate = new Date(start);
  const endDate = new Date(end);
  assert.strictEqual(startDate.getDay(), 1); // Monday
  assert.strictEqual(startDate.getDate(), 10); // Mon 2026-08-10
  assert.strictEqual(endDate.getDay(), 0); // Sunday
  assert.strictEqual(endDate.getDate(), 16); // Sun 2026-08-16
  assert.strictEqual(endDate.getHours(), 23);
  assert.strictEqual(endDate.getMinutes(), 59);
});

test('previousWeekRange handles a Monday correctly (previous week, not current)', () => {
  // Monday, 2026-08-24
  const now = new Date(2026, 7, 24, 6, 0, 0);
  const { start } = previousWeekRange(now);
  const startDate = new Date(start);
  assert.strictEqual(startDate.getDate(), 17); // Mon 2026-08-17, not 08-24
});
