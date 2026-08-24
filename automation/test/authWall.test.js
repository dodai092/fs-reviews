// automation/test/authWall.test.js
const test = require('node:test');
const assert = require('node:assert');
const { isAuthWall } = require('../lib/authWall');

const platform = {
  authWallUrlContains: ['/login', '/signin'],
  authWallSelectors: ['input[type=password]'],
};

test('detects an auth wall by URL', () => {
  const result = isAuthWall(
    { url: 'https://www.freetour.com/login?next=/reviews', hasSelector: () => false },
    platform
  );
  assert.strictEqual(result, true);
});

test('detects an auth wall by selector presence', () => {
  const result = isAuthWall(
    { url: 'https://www.freetour.com/reviews', hasSelector: (sel) => sel === 'input[type=password]' },
    platform
  );
  assert.strictEqual(result, true);
});

test('returns false on a normal reviews page', () => {
  const result = isAuthWall(
    { url: 'https://www.freetour.com/reviews', hasSelector: () => false },
    platform
  );
  assert.strictEqual(result, false);
});

test('returns false when platform has no login (empty selector/url lists)', () => {
  const noLoginPlatform = { authWallUrlContains: [], authWallSelectors: [] };
  const result = isAuthWall(
    { url: 'https://www.tripadvisor.com/anything', hasSelector: () => true },
    noLoginPlatform
  );
  assert.strictEqual(result, false);
});
