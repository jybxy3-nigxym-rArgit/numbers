'use strict';

const path = require('path');
const { normPhone, toLocal } = require('./util');

const env = process.env;
const isProd = env.NODE_ENV === 'production';

const adminNational = env.ADMIN_PHONE ? normPhone(env.ADMIN_PHONE) : null;

module.exports = {
  isProd,
  port: Number(env.PORT) || 3000,
  host: env.HOST || '0.0.0.0',
  dataDir: env.DATA_DIR || path.join(__dirname, 'data'),
  baseUrl: (env.BASE_URL || '').replace(/\/+$/, ''),

  // How many reverse proxies sit in front of the app (Render, Cloudflare...).
  // Used to read the real visitor IP from X-Forwarded-For.
  trustedHops: env.TRUSTED_HOPS !== undefined ? Number(env.TRUSTED_HOPS) : isProd ? 1 : 0,

  // Admin account: the user who registers with this phone becomes admin.
  adminNational,
  adminLocal: adminNational ? toLocal(adminNational) : null,

  // true  = new ads wait for admin approval
  // false = new ads go live immediately (reports and the admin panel still apply)
  requireApproval: /^(1|true|yes)$/i.test(env.REQUIRE_APPROVAL || ''),

  reportHideAt: Number(env.REPORT_HIDE_AT) || 3,
  maxActiveAdsPerUser: Number(env.MAX_ADS_PER_USER) || 20,
  pageSize: 24,
};
