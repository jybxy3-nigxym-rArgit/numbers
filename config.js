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
    registerPerHour: Number(env.REGISTER_PER_HOUR) || 8,
    maxAdsPerDay: Number(env.MAX_ADS_PER_DAY) || 10,
    pageSize: 24,

    // Password hashing cost. Higher is safer but uses more CPU (Cloudflare's free plan gives 10 ms per request).
    pbkdf2Iterations: Math.min(100000, Number(env.PBKDF2_ITERATIONS) || 30000),

    // Password-reset emails go through Resend (resend.com). Without a key the site still works,
    // and the login page tells people to contact the admin instead.
    resendKey: env.RESEND_API_KEY || '',
    mailFrom: env.MAIL_FROM || 'Basmat Ameel <no-reply@basmatameel.com>',

    sessionSecret: env.SESSION_SECRET || '',
    assetVersion: env.ASSET_V || '1',
  });
  return config;
}

apply(typeof process !== 'undefined' && process.env ? process.env : {});
config.apply = apply;

module.exports = config;
