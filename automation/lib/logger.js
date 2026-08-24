const fs = require('node:fs');
const path = require('node:path');

function createLogger({ dir = path.join(__dirname, '..', 'logs') } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${new Date().toISOString().slice(0, 10)}.log`);

  function log(line) {
    const stamped = `[${new Date().toISOString()}] ${line}\n`;
    fs.appendFileSync(filePath, stamped);
  }

  return { log, filePath };
}

module.exports = { createLogger };
