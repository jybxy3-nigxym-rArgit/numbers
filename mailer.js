'use strict';

// Sends email through Resend's HTTP API (works the same on Node and on Cloudflare Workers).
// Tests set config.mailHook to capture messages instead of sending them.

const config = require('./config');

const mailEnabled = () => !!(config.mailHook || config.resendKey);

async function sendMail({ to, subject, text }) {
  if (config.mailHook) {
    await config.mailHook({ to, subject, text });
    return true;
  }
  if (!config.resendKey) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: config.mailFrom, to: [to], subject, text }),
    });
    if (!res.ok) console.error('Resend error', res.status, await res.text());
    return res.ok;
  } catch (err) {
    console.error('Resend failed', err);
    return false;
  }
}

module.exports = { sendMail, mailEnabled };
