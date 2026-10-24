// Numbers Market on Cloudflare Workers (free plan). The whole site lives in app.js;
// this file only connects Cloudflare's request/env to it. Database: D1 (binding "DB").
// Static files (style.css, favicon) come from ./public through the "assets" setting.

import config from './config.js';
import app from './app.js';
import d1 from './d1.js';

export default {
  // Cloudflare cron (see wrangler.jsonc, every hour): refresh verified advertisers' ads, one old owner ad, and remove year-old ads.
  async scheduled(event, env, execCtx) {
    config.apply(env);
    const store = d1.storeFor(env.DB);
    execCtx.waitUntil(store.maintenance());
    execCtx.waitUntil(app.weekly(store).catch(() => {}));
  },

  async fetch(request, env, execCtx) {
    config.apply(env);
    const store = d1.storeFor(env.DB);
    return app.handle(request, {
      store,
      ip: request.headers.get('cf-connecting-ip') || 'unknown',
      waitUntil: execCtx && execCtx.waitUntil ? (p) => execCtx.waitUntil(p) : undefined,
    });
  },
};
