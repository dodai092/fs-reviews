const fs = require('node:fs');
const path = require('node:path');

function loadConfig({ dir = __dirname + '/..' } = {}) {
  const platformsPath = path.join(dir, 'platforms.json');
  const secretsPath = path.join(dir, 'secrets.json');

  if (!fs.existsSync(platformsPath)) {
    throw new Error(
      `Missing ${platformsPath} — copy platforms.example.json to platforms.json and fill in real reviews-page URLs.`
    );
  }
  if (!fs.existsSync(secretsPath)) {
    throw new Error(
      `Missing ${secretsPath} — copy secrets.example.json to secrets.json and fill in real Gmail credentials.`
    );
  }

  const platforms = JSON.parse(fs.readFileSync(platformsPath, 'utf8'));
  const secrets = JSON.parse(fs.readFileSync(secretsPath, 'utf8'));

  for (const p of platforms) {
    if (!p.url || p.url.includes('REPLACE_WITH_REAL')) {
      throw new Error(`platforms.json: "${p.id}" still has a placeholder URL — fill in the real reviews-page URL.`);
    }
  }
  if (!secrets.gmailAppPassword || secrets.gmailAppPassword.includes('REPLACE_WITH_REAL')) {
    throw new Error('secrets.json: gmailAppPassword is still a placeholder.');
  }

  return { platforms, secrets };
}

module.exports = { loadConfig };
