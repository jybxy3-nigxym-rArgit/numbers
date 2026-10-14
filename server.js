'use strict';

// Numbers Market: a small classifieds site for premium phone numbers.
// No external packages. Needs Node 22.13 or newer (built-in SQLite).

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');

const config = require('./config');
const store = require('./db');
const views = require('./views');
const { t } = require('./i18n');
const util = require('./util');
const { NETWORK_BY_KEY, CITY_BY_KEY, PATTERN_KEYS, REPORT_REASONS } = require('./data');

const scrypt = promisify(crypto.scrypt);
const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSION_MAX_AGE = 30 * 24 * 3600; // seconds

// ---- Passwords -------------------------------------------------------------

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  const [alg, saltHex, keyHex] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  const key = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

// Used when the phone is unknown, so response time does not reveal which phones have accounts.
const DUMMY_HASH = `scrypt$${'00'.repeat(16)}$${'00'.repeat(64)}`;

// ---- Cookies and sessions --------------------------------------------------

function sign(value) {
  return crypto.createHmac('sha256', store.secret).update(value).digest('base64url');
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function readSession(req) {
  const raw = parseCookies(req.headers.cookie).sid;
  if (!raw) return null;
  const [payload, sig] = raw.split('.');
  if (!payload || !sig) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(payload));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!s || typeof s !== 'object') return null;
    if (!s.iat || Date.now() / 1000 - s.iat > SESSION_MAX_AGE) return null;
    return s;
  } catch {
    return null;
  }
}

function newSession() {
  return { csrf: crypto.randomBytes(18).toString('base64url'), lang: 'ar', iat: Math.floor(Date.now() / 1000) };
}

function sessionCookie(session) {
  const payload = Buffer.from(JSON.stringify(session)).toString('base64url');
  return (
    `sid=${payload}.${sign(payload)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}` +
    (config.isProd ? '; Secure' : '')
  );
}

// ---- Request helpers -------------------------------------------------------

function clientIp(req) {
  if (config.trustedHops > 0) {
    const xff = String(req.headers['x-forwarded-for'] || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const i = xff.length - config.trustedHops;
    if (i >= 0) return xff[i];
  }
  return req.socket.remoteAddress || 'unknown';
}

function readBody(req, limit = 20000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('Body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseForm(text) {
  const out = {};
  for (const [k, v] of new URLSearchParams(text)) out[k] = v;
  return out;
}

const str = (v, max) => String(v ?? '').slice(0, max);

function safeNext(next) {
  const n = String(next || '');
  if (!n.startsWith('/') || n.startsWith('//') || /[\\\u0000-\u001f]/.test(n)) return '/';
  return n;
}

// ---- Rate limiting (in memory) ---------------------------------------------

const buckets = new Map();
function allow(key, limit, windowMs) {
  const now = Date.now();
  const arr = (buckets.get(key) || []).filter((ts) => now - ts < windowMs);
  if (arr.length >= limit) {
    buckets.set(key, arr);
    return false;
  }
  arr.push(now);
  buckets.set(key, arr);
  return true;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, arr] of buckets) {
    if (!arr.length || now - arr[arr.length - 1] > 3600 * 1000) buckets.delete(k);
  }
}, 10 * 60 * 1000).unref();

// ---- Responses -------------------------------------------------------------

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'none'; style-src 'self' https://fonts.googleapis.com; " +
    "font-src https://fonts.gstatic.com; img-src 'self' data:; form-action 'self'; " +
    "base-uri 'none'; frame-ancestors 'none'; object-src 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};
if (config.isProd) SECURITY_HEADERS['Strict-Transport-Security'] = 'max-age=15552000';

function send(ctx, status, contentType, body, headers = {}) {
  const res = ctx.res;
  if (res.headersSent) return;
  const h = { ...SECURITY_HEADERS, 'Content-Type': contentType, ...headers };
  if (ctx.dirty) h['Set-Cookie'] = sessionCookie(ctx.session);
  res.writeHead(status, h);
  res.end(body);
}

function html(ctx, status, body) {
  send(ctx, status, 'text/html; charset=utf-8', body, {
    'Cache-Control': 'private, no-cache',
    Vary: 'Cookie, Accept-Language',
  });
}

function redirect(ctx, location, status = 303) {
  send(ctx, status, 'text/plain; charset=utf-8', '', { Location: location, 'Cache-Control': 'no-store' });
}

function flash(ctx, type, key, vars) {
  ctx.session.flash = { type, key, vars };
  ctx.dirty = true;
}

function notFound(ctx) {
  html(ctx, 404, views.errorPage(ctx, 404));
}

function tooMany(ctx) {
  ctx.res.setHeader('Retry-After', '600');
  html(ctx, 429, views.errorPage(ctx, 429));
}

// ---- Context ---------------------------------------------------------------

function buildContext(req, res, url) {
  let session = readSession(req);
  let dirty = false;
  if (!session) {
    session = newSession();
    dirty = true;
  }
  if (session.lang !== 'ar' && session.lang !== 'en') {
    session.lang = 'ar';
    dirty = true;
  }

  let user = session.uid ? store.getUser(session.uid) : undefined;
  if (user && user.banned) user = undefined;
  if (session.uid && !user) {
    delete session.uid;
    dirty = true;
  }

  const ctx = {
    req,
    res,
    url,
    query: Object.fromEntries(url.searchParams),
    params: {},
    body: {},
    session,
    dirty,
    user,
    lang: session.lang,
    csrf: session.csrf,
    ip: clientIp(req),
    path: url.pathname + url.search,
    t: (key, vars) => t(session.lang, key, vars),
  };

  // The flash message is shown once, then removed from the session.
  let flashValue;
  let flashRead = false;
  Object.defineProperty(ctx, 'flash', {
    get() {
      if (!flashRead) {
        flashRead = true;
        flashValue = ctx.session.flash;
        if (flashValue) {
          delete ctx.session.flash;
          ctx.dirty = true;
        }
      }
      return flashValue;
    },
  });
  return ctx;
}

function csrfOk(ctx) {
  const a = Buffer.from(String(ctx.body._csrf || ''));
  const b = Buffer.from(String(ctx.csrf || ''));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function requireLogin(ctx) {
  if (ctx.user) return true;
  ctx.session.next = ctx.req.method === 'GET' ? ctx.path : '/post';
  ctx.dirty = true;
  redirect(ctx, '/login');
  return false;
}

function requireAdmin(ctx) {
  if (ctx.user && ctx.user.is_admin) return true;
  notFound(ctx);
  return false;
}

function logIn(ctx, userId) {
  ctx.session.uid = userId;
  ctx.session.csrf = crypto.randomBytes(18).toString('base64url'); // fresh token after login
  ctx.csrf = ctx.session.csrf;
  ctx.session.iat = Math.floor(Date.now() / 1000);
  ctx.dirty = true;
}

// ---- Routes ----------------------------------------------------------------

const routes = [];
function route(method, pattern, handler) {
  const names = [];
  const re = new RegExp(
    '^' +
      pattern.replace(/:([a-z]+)/g, (_, n) => {
        names.push(n);
        return '([^/]+)';
      }) +
      '/?$'
  );
  routes.push({ method, re, names, handler });
}

function parsePrice(raw) {
  const d = util.toWestern(raw).replace(/[,\s٬]/g, '');
  return /^\d{1,8}$/.test(d) ? Number(d) : null;
}

function parseFilters(query) {
  const qRaw = str(query.q, 30).trim();
  const startsRaw = str(query.starts, 15).trim();
  const endsRaw = str(query.ends, 15).trim();
  const minRaw = str(query.min, 12).trim();
  const maxRaw = str(query.max, 12).trim();

  let starts = util.digitsOnly(startsRaw).slice(0, 10);
  if (starts.startsWith('966')) starts = '0' + starts.slice(3);
  else if (starts.startsWith('5')) starts = '0' + starts;

  return {
    qRaw,
    q: util.digitsOnly(qRaw).slice(0, 10),
    startsRaw,
    starts: starts.slice(0, 10),
    endsRaw,
    ends: util.digitsOnly(endsRaw).slice(0, 10),
    minRaw,
    min: minRaw ? parsePrice(minRaw) : null,
    maxRaw,
    max: maxRaw ? parsePrice(maxRaw) : null,
    network: NETWORK_BY_KEY[query.network] ? query.network : '',
    city: CITY_BY_KEY[query.city] ? query.city : '',
    pattern: PATTERN_KEYS.includes(query.pattern) ? query.pattern : '',
    sort: ['price_asc', 'price_desc'].includes(query.sort) ? query.sort : 'new',
    page: Math.max(1, parseInt(query.page, 10) || 1),
  };
}

route('GET', '/', (ctx) => {
  const f = parseFilters(ctx.query);
  let { total, rows } = store.searchListings({ ...f, limit: config.pageSize, offset: (f.page - 1) * config.pageSize });
  const pages = Math.max(1, Math.ceil(total / config.pageSize));
  let page = f.page;
  if (page > pages) {
    page = pages;
    ({ rows } = store.searchListings({ ...f, limit: config.pageSize, offset: (page - 1) * config.pageSize }));
  }
  const anyFilter = !!(f.q || f.starts || f.ends || f.min != null || f.max != null || f.network || f.city || f.pattern);
  html(ctx, 200, views.homePage(ctx, { filters: f, rows, total, page, pages, siteEmpty: total === 0 && !anyFilter }));
});

route('GET', '/n/:id', (ctx) => {
  const id = Number(ctx.params.id);
  const l = Number.isInteger(id) ? store.getListing(id) : undefined;
  if (!l) return notFound(ctx);
  const canManage = !!ctx.user && (ctx.user.id === l.user_id || !!ctx.user.is_admin);
  const publicVisible = (l.status === 'active' || l.status === 'sold') && !l.seller_banned;
  if (!publicVisible && !canManage) return notFound(ctx);

  if (l.status === 'active' && !(ctx.user && ctx.user.id === l.user_id)) {
    const seen = Array.isArray(ctx.session.seen) ? ctx.session.seen : [];
    if (!seen.includes(l.id)) {
      store.bumpViews(l.id);
      l.views += 1;
      ctx.session.seen = [...seen, l.id].slice(-20);
      ctx.dirty = true;
    }
  }
  html(ctx, 200, views.listingPage(ctx, l, { canManage }));
});

route('POST', '/n/:id/report', (ctx) => {
  if (!allow(`report:${ctx.ip}`, 20, 3600 * 1000)) return tooMany(ctx);
  const id = Number(ctx.params.id);
  const l = Number.isInteger(id) ? store.getListing(id) : undefined;
  if (!l || l.status !== 'active') return notFound(ctx);
  const reason = REPORT_REASONS.includes(ctx.body.reason) ? ctx.body.reason : 'other';
  if (!(ctx.user && ctx.user.id === l.user_id)) {
    const key = ctx.user
      ? `u${ctx.user.id}`
      : 'ip' + crypto.createHash('sha256').update(ctx.ip + store.secret).digest('hex').slice(0, 16);
    const count = store.addReport(l.id, key, reason);
    if (count >= config.reportHideAt) store.setListingStatus(l.id, 'hidden');
  }
  flash(ctx, 'ok', 'reported');
  const after = store.getListing(l.id);
  redirect(ctx, after && after.status === 'active' ? `/n/${l.id}` : '/');
});

// ---- Post an ad ----

route('GET', '/post', (ctx) => {
  if (!requireLogin(ctx)) return;
  html(ctx, 200, views.postPage(ctx));
});

route('POST', '/post', (ctx) => {
  if (!requireLogin(ctx)) return;
  if (!allow(`post:${ctx.ip}`, 30, 3600 * 1000)) return tooMany(ctx);

  const b = ctx.body;
  const v = {
    number: str(b.number, 25).trim(),
    network: str(b.network, 20),
    city: str(b.city, 20),
    price: str(b.price, 15).trim(),
    contact: str(b.contact, 25).trim(),
    description: str(b.description, 1000).replace(/\r\n?/g, '\n').trim(),
  };
  const errors = {};

  const nat = util.normPhone(v.number);
  if (!nat) errors.number = 'err_number';
  if (!NETWORK_BY_KEY[v.network]) errors.network = 'err_network';
  if (!CITY_BY_KEY[v.city]) errors.city = 'err_city';

  let price = null;
  if (v.price) {
    price = parsePrice(v.price);
    if (price === null || price > 10000000) errors.price = 'err_price';
  }

  let contact = util.toIntl(ctx.user.phone);
  if (v.contact) {
    const c = util.normPhone(v.contact);
    if (c) contact = util.toIntl(c);
    else errors.contact = 'err_contact';
  }
  if ([...v.description].length > 300) errors.description = 'err_desc';

  if (nat && !errors.number) {
    const number = util.toLocal(nat);
    if (store.countActiveByUser(ctx.user.id) >= config.maxActiveAdsPerUser) {
      errors.number = { key: 'err_limit', vars: { n: config.maxActiveAdsPerUser } };
    } else if (store.numberIsListed(number)) {
      errors.number = 'err_dup';
    }
  }

  if (Object.keys(errors).length) return html(ctx, 400, views.postPage(ctx, v, errors));

  const status = config.requireApproval && !ctx.user.is_admin ? 'pending' : 'active';
  const id = store.insertListing({
    userId: ctx.user.id,
    number: util.toLocal(nat),
    network: v.network,
    city: v.city,
    price,
    contact,
    description: v.description,
    status,
  });
  flash(ctx, 'ok', status === 'pending' ? 'pending_notice' : 'published_notice');
  redirect(ctx, `/n/${id}`);
});

// ---- Accounts ----

route('GET', '/register', (ctx) => {
  if (ctx.user) return redirect(ctx, '/');
  html(ctx, 200, views.registerPage(ctx));
});

route('POST', '/register', async (ctx) => {
  if (!allow(`register:${ctx.ip}`, 8, 3600 * 1000)) return tooMany(ctx);
  const name = str(ctx.body.name, 80).replace(/\s+/g, ' ').trim();
  const phoneRaw = str(ctx.body.phone, 25).trim();
  const password = str(ctx.body.password, 200);
  const v = { name, phone: phoneRaw };
  const errors = {};

  if (name.length < 2 || name.length > 60) errors.name = 'err_name';
  const nat = util.normPhone(phoneRaw);
  if (!nat) errors.phone = 'err_phone';
  else if (store.getUserByPhone(nat)) errors.phone = 'err_phone_taken';
  if (password.length < 8) errors.password = 'err_pass';
  if (Object.keys(errors).length) return html(ctx, 400, views.registerPage(ctx, v, errors));

  const passHash = await hashPassword(password);
  if (store.getUserByPhone(nat)) return html(ctx, 400, views.registerPage(ctx, v, { phone: 'err_phone_taken' }));
  const id = store.createUser(nat, name, passHash);
  logIn(ctx, id);
  flash(ctx, 'ok', 'welcome');
  const next = ctx.session.next ? safeNext(ctx.session.next) : '/post';
  delete ctx.session.next;
  redirect(ctx, next);
});

route('GET', '/login', (ctx) => {
  if (ctx.user) return redirect(ctx, '/');
  html(ctx, 200, views.loginPage(ctx));
});

route('POST', '/login', async (ctx) => {
  const phoneRaw = str(ctx.body.phone, 25).trim();
  const password = str(ctx.body.password, 200);
  const nat = util.normPhone(phoneRaw);
  // Limits are per visitor (IP), and per phone from that same IP, so a stranger cannot lock someone else out.
  if (!allow(`login:${ctx.ip}`, 20, 15 * 60 * 1000) || (nat && !allow(`login-phone:${nat}:${ctx.ip}`, 10, 15 * 60 * 1000))) {
    return tooMany(ctx);
  }
  const user = nat ? store.getUserByPhone(nat) : undefined;
  const ok = await verifyPassword(password, user ? user.pass_hash : DUMMY_HASH);
  if (!user || !ok) return html(ctx, 401, views.loginPage(ctx, { phone: phoneRaw }, { form: 'err_login' }));
  if (user.banned) return html(ctx, 403, views.loginPage(ctx, { phone: phoneRaw }, { form: 'err_banned' }));

  logIn(ctx, user.id);
  flash(ctx, 'ok', 'welcome_back');
  const next = ctx.session.next ? safeNext(ctx.session.next) : '/';
  delete ctx.session.next;
  redirect(ctx, next);
});

route('POST', '/logout', (ctx) => {
  delete ctx.session.uid;
  ctx.session.csrf = crypto.randomBytes(18).toString('base64url');
  ctx.dirty = true;
  flash(ctx, 'ok', 'logged_out');
  redirect(ctx, '/');
});

route('GET', '/lang/:code', (ctx) => {
  const code = ctx.params.code;
  if (code === 'ar' || code === 'en') {
    ctx.session.lang = code;
    ctx.dirty = true;
  }
  redirect(ctx, safeNext(ctx.query.next), 302);
});

// ---- My ads ----

route('GET', '/my', (ctx) => {
  if (!requireLogin(ctx)) return;
  html(ctx, 200, views.myPage(ctx, store.userListings(ctx.user.id)));
});

route('POST', '/my/:id/sold', (ctx) => {
  if (!requireLogin(ctx)) return;
  store.setOwnListingStatus(Number(ctx.params.id), ctx.user.id, 'sold');
  flash(ctx, 'ok', 'updated');
  redirect(ctx, '/my');
});

route('POST', '/my/:id/delete', (ctx) => {
  if (!requireLogin(ctx)) return;
  store.deleteOwnListing(Number(ctx.params.id), ctx.user.id);
  flash(ctx, 'ok', 'deleted');
  redirect(ctx, '/my');
});

// ---- Admin ----

const ADMIN_TABS = ['stats', 'pending', 'reported', 'all', 'users'];

route('GET', '/admin', (ctx) => {
  if (!requireAdmin(ctx)) return;
  const tab = ADMIN_TABS.includes(ctx.query.tab) ? ctx.query.tab : 'stats';
  const data = {};
  if (tab === 'stats') data.stats = store.adminStats();
  else if (tab === 'users') data.users = store.adminUsers();
  else data.listings = store.adminListings(tab);
  html(ctx, 200, views.adminPage(ctx, tab, data));
});

route('POST', '/admin/l/:id/:action', (ctx) => {
  if (!requireAdmin(ctx)) return;
  const id = Number(ctx.params.id);
  const action = ctx.params.action;
  if (!store.getListing(id)) return notFound(ctx);
  if (action === 'approve') store.setListingStatus(id, 'active');
  else if (action === 'hide') store.setListingStatus(id, 'hidden');
  else if (action === 'restore') {
    store.setListingStatus(id, 'active');
    store.clearReports(id);
  } else if (action === 'delete') store.deleteListing(id);
  else return notFound(ctx);
  const tab = ADMIN_TABS.includes(ctx.body.tab) ? ctx.body.tab : 'pending';
  flash(ctx, 'ok', 'updated');
  redirect(ctx, `/admin?tab=${tab}`);
});

route('POST', '/admin/u/:id/:action', (ctx) => {
  if (!requireAdmin(ctx)) return;
  const id = Number(ctx.params.id);
  const action = ctx.params.action;
  if (!store.getUser(id) || !['ban', 'unban'].includes(action)) return notFound(ctx);
  store.setUserBanned(id, action === 'ban');
  flash(ctx, 'ok', 'updated');
  redirect(ctx, '/admin?tab=users');
});

// ---- Static pages and SEO files ----

route('GET', '/safety', (ctx) => html(ctx, 200, views.safetyPage(ctx)));

function baseUrlFor(req) {
  if (config.baseUrl) return config.baseUrl;
  const proto = config.trustedHops > 0 ? String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim() : 'http';
  const host = /^[a-z0-9.\-:]+$/i.test(req.headers.host || '') ? req.headers.host : 'localhost';
  return `${proto === 'http' ? 'http' : 'https'}://${host}`;
}

route('GET', '/robots.txt', (ctx) => {
  const base = baseUrlFor(ctx.req);
  send(
    ctx,
    200,
    'text/plain; charset=utf-8',
    `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /my\nDisallow: /post\nDisallow: /login\nDisallow: /register\nDisallow: /lang/\n\nSitemap: ${base}/sitemap.xml\n`,
    { 'Cache-Control': 'public, max-age=3600' }
  );
});

route('GET', '/sitemap.xml', (ctx) => {
  const base = baseUrlFor(ctx.req);
  const urls = [`${base}/`, `${base}/safety`];
  for (const l of store.sitemapListings()) urls.push(`${base}/n/${l.id}`);
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((u) => `  <url><loc>${util.esc(u)}</loc></url>`).join('\n') +
    '\n</urlset>\n';
  send(ctx, 200, 'application/xml; charset=utf-8', xml, { 'Cache-Control': 'public, max-age=3600' });
});

route('GET', '/healthz', (ctx) => send(ctx, 200, 'text/plain; charset=utf-8', 'ok', { 'Cache-Control': 'no-store' }));

// ---- Static files ----

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function serveStatic(req, res, pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname).replace(/^\/+/, '');
  } catch {
    return false;
  }
  if (!rel || rel.includes('\0')) return false;
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return false;
  const type = MIME[path.extname(file).toLowerCase()];
  if (!type) return false;
  let data;
  try {
    data = fs.readFileSync(file);
  } catch {
    return false;
  }
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': type,
    'Cache-Control': 'public, max-age=86400',
  });
  res.end(data);
  return true;
}

// ---- Main handler ----------------------------------------------------------

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const method = req.method;

  if ((method === 'GET' || method === 'HEAD') && serveStatic(req, res, url.pathname)) return;

  const ctx = buildContext(req, res, url);
  const wanted = method === 'HEAD' ? 'GET' : method;

  let matched = null;
  for (const r of routes) {
    if (r.method !== wanted) continue;
    const m = r.re.exec(url.pathname);
    if (m) {
      matched = r;
      ctx.params = Object.fromEntries(r.names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
      break;
    }
  }
  if (!matched) return notFound(ctx);

  if (method === 'POST') {
    const type = String(req.headers['content-type'] || '');
    if (!type.startsWith('application/x-www-form-urlencoded')) {
      res.writeHead(415, SECURITY_HEADERS);
      return res.end();
    }
    ctx.body = parseForm(await readBody(req));
    if (!csrfOk(ctx)) {
      flash(ctx, 'error', 'err_csrf');
      return redirect(ctx, '/');
    }
  }

  await matched.handler(ctx);
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    if (err && err.status === 413) {
      if (!res.headersSent) res.writeHead(413, SECURITY_HEADERS);
      return res.end();
    }
    console.error(err);
    if (res.headersSent) return res.end();
    try {
      const ctx = buildContext(req, res, new URL(req.url, 'http://localhost'));
      html(ctx, 500, views.errorPage(ctx, 500));
    } catch {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Server error');
    }
  });
});
server.requestTimeout = 30000;
server.headersTimeout = 15000;

if (require.main === module) {
  server.listen(config.port, config.host, () => {
    console.log(`Numbers Market running on http://localhost:${config.port}`);
    if (!config.adminLocal) console.log('Tip: set ADMIN_PHONE to choose the admin account.');
  });
  const stop = () => {
    server.close(() => {
      try {
        store.db.close();
      } catch {}
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

module.exports = { server };
