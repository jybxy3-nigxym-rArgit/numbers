'use strict';

// Free WhatsApp alert to the site owner through the CallMeBot service (https://www.callmebot.com).
// It only sends messages to the owner's own number, after he activated it once. Without CALLMEBOT_KEY nothing is sent.

const config = require('./config');

const enabled = () => !!(config.callmebotKey && config.callmebotPhone);

async function send(text) {
  if (!enabled()) return false;
  const url = new URL(config.callmebotUrl);
  url.searchParams.set('phone', '+' + config.callmebotPhone);
  url.searchParams.set('text', String(text).slice(0, 900));
  url.searchParams.set('apikey', config.callmebotKey);
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  return res.ok;
}

module.exports = { enabled, send };
