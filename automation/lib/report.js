const nodemailer = require('nodemailer');

function buildReportText(results) {
  return results
    .map((r) => {
      if (r.status === 'success') return `${r.id}: ${r.count} reviews sent`;
      if (r.status === 'needsReauth') return `${r.id}: needs re-login`;
      return `${r.id}: error - ${r.message}`;
    })
    .join('\n');
}

async function sendReport({ secrets, subject, text }) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: secrets.gmailUser, pass: secrets.gmailAppPassword },
  });
  await transporter.sendMail({
    from: secrets.gmailUser,
    to: secrets.reportTo,
    subject,
    text,
  });
}

module.exports = { buildReportText, sendReport };
