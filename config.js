'use strict';

const { normPhone, toLocal } = require('./util');

// One settings object, filled from environment variables.
// Node: read from process.env when the file loads.
// Cloudflare Workers: call config.apply(env) at the start of each request.

const config = {};

function apply(env = {}) {
  const adminNational = env.ADMIN_PHONE ? normPhone(env.ADMIN_PHONE) : null;
  const isProd = env.NODE_ENV === 'production';
  Object.assign(config, {
    isProd,
    port: Number(env.PORT) || 3000,
    host: env.HOST || '0.0.0.0',
    dataDir: env.DATA_DIR || (typeof __dirname !== 'undefined' ? __dirname + '/data' : './data'),
    baseUrl: (env.BASE_URL || '').replace(/\/+$/, ''),

    // How many reverse proxies sit in front of the Node server (Caddy, Render...).
    // Used to read the real visitor IP from X-Forwarded-For. Not used on Cloudflare Workers.
    trustedHops: env.TRUSTED_HOPS !== undefined ? Number(env.TRUSTED_HOPS) : isProd ? 1 : 0,

    // Admin account: the user who registers with this phone becomes admin.
    adminNational,
    adminLocal: adminNational ? toLocal(adminNational) : null,

    // true  = new ads wait for admin approval
    // false = new ads go live immediately (reports and the admin panel still apply)
    requireApproval: /^(1|true|yes)$/i.test(env.REQUIRE_APPROVAL || ''),

    reportHideAt: Number(env.REPORT_HIDE_AT) || 3,
    maxActiveAdsPerUser: Number(env.MAX_ADS_PER_USER) || 20,
    postPerHour: Number(env.POST_PER_HOUR) || 30,
    registerPerHour: Number(env.REGISTER_PER_HOUR) || 8,
    maxAdsPerDay: Number(env.MAX_ADS_PER_DAY) || 10,
    pageSize: 24,
    renewDays: env.RENEW_DAYS !== undefined && env.RENEW_DAYS !== '' ? Number(env.RENEW_DAYS) : 3, // an ad can be moved back to the top once in this many days
    sallaSecret: env.SALLA_WEBHOOK_SECRET || '', // shared secret of the Salla store webhook (empty = link off)
    staleDays: env.STALE_DAYS !== undefined && env.STALE_DAYS !== '' ? Number(env.STALE_DAYS) : 365, // an ad nobody refreshed for this long is removed
    autoRenewDays: env.AUTO_RENEW_DAYS !== undefined && env.AUTO_RENEW_DAYS !== '' ? Number(env.AUTO_RENEW_DAYS) : 3, // verified advertisers: refreshed this often by itself
    autoMonthDays: 30, // ... for this many days, then it can be switched on again
    repostPenaltyDays: env.REPOST_PENALTY_DAYS !== undefined && env.REPOST_PENALTY_DAYS !== '' ? Number(env.REPOST_PENALTY_DAYS) : 5, // wait before a deleted number can be posted again

    // Free WhatsApp alerts to the owner through CallMeBot (optional): set CALLMEBOT_KEY, and CALLMEBOT_PHONE if it is not the admin phone.
    // Google Tag Manager container (public pages only). Empty = off.
    gtmId: /^GTM-[A-Z0-9]+$/.test(env.GTM_ID || '') ? env.GTM_ID : '',

    callmebotKey: env.CALLMEBOT_KEY || '',
    callmebotPhone: (env.CALLMEBOT_PHONE || (adminNational ? '966' + adminNational : '')).replace(/\D/g, ''),
    callmebotUrl: env.CALLMEBOT_URL || 'https://api.callmebot.com/whatsapp.php',

    // Password hashing cost. Higher is safer but uses more CPU (Cloudflare's free plan gives 10 ms per request).
    pbkdf2Iterations: Math.min(100000, Number(env.PBKDF2_ITERATIONS) || 30000),

    sessionSecret: env.SESSION_SECRET || '',
    assetVersion: env.ASSET_V || '14',
  });
  return config;
}

apply(typeof process !== 'undefined' && process.env ? process.env : {});
config.apply = apply;

module.exports = config;
