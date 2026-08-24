// automation/test/config.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadConfig } = require('../lib/config');

function makeTempConfigDir({ platforms, secrets }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 're-config-test-'));
  fs.writeFileSync(path.join(dir, 'platforms.json'), JSON.stringify(platforms));
  fs.writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify(secrets));
  return dir;
}

test('loadConfig throws when platforms.json is missing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 're-config-test-'));
  assert.throws(() => loadConfig({ dir }), /Missing.*platforms\.json/);
});

test('loadConfig throws when a platform URL is still a placeholder', () => {
  const dir = makeTempConfigDir({
    platforms: [{ id: 'airbnb', url: 'https://x/REPLACE_WITH_REAL_REVIEWS_URL' }],
    secrets: { gmailAppPassword: 'realpassword123' },
  });
  assert.throws(() => loadConfig({ dir }), /still has a placeholder URL/);
});

test('loadConfig returns platforms and secrets when both are filled in', () => {
  const dir = makeTempConfigDir({
    platforms: [{ id: 'tripadvisor', url: 'https://real.example/reviews' }],
    secrets: { gmailAppPassword: 'realpassword123' },
  });
  const { platforms, secrets } = loadConfig({ dir });
  assert.strictEqual(platforms.length, 1);
  assert.strictEqual(platforms[0].id, 'tripadvisor');
  assert.strictEqual(secrets.gmailAppPassword, 'realpassword123');
});
