const test = require('node:test');
const assert = require('node:assert');
const { buildReportText } = require('../lib/report');

test('buildReportText lists a success line with count', () => {
  const text = buildReportText([{ id: 'tripadvisor', status: 'success', count: 12 }]);
  assert.match(text, /tripadvisor: 12 reviews sent/);
});

test('buildReportText flags a platform needing re-login', () => {
  const text = buildReportText([{ id: 'guruwalk', status: 'needsReauth' }]);
  assert.match(text, /guruwalk: needs re-login/);
});

test('buildReportText includes the error message for a failed platform', () => {
  const text = buildReportText([{ id: 'airbnb', status: 'error', message: 'selector not found' }]);
  assert.match(text, /airbnb: error - selector not found/);
});

test('buildReportText reports a platform with no reviews this period', () => {
  const text = buildReportText([{ id: 'freetour', status: 'noReviews' }]);
  assert.match(text, /freetour: no reviews this period/);
});

test('buildReportText handles a mixed run', () => {
  const text = buildReportText([
    { id: 'tripadvisor', status: 'success', count: 12 },
    { id: 'guruwalk', status: 'needsReauth' },
  ]);
  assert.match(text, /tripadvisor: 12 reviews sent/);
  assert.match(text, /guruwalk: needs re-login/);
});
