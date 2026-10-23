'use strict';

// Numbers Market: the whole site, written against the standard Request / Response objects,
// so the same code runs on Node (server.js) and on Cloudflare Workers (worker.mjs).

const config = require('./config');
const views = require('./views');
const { t, dict } = require('./i18n');
const util = require('./util');
const wc = require('./webcrypto');
const notifier = require('./notify');
const content = require('./content');
const { NETWORK_BY_KEY, CITY_BY_KEY, PATTERN_KEYS, REPORT_REASONS, UNDER_PRICES, PRICE_TYPES } = require('./data');

const SESSION_MAX_AGE = 30 * 24 * 3600; // seconds
const MAX_BODY = 20000;

// Used when the phone is unknown, so response time does not reveal which phones have accounts.
const dummyHash = () => `pbkdf2$${config.pbkdf2Iterations}$${'A'.repeat(22)}$${'A'.repeat(43)}`;

// ---- Cookies and sessions --------------------------------------------------

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

async function readSession(request, secret) {
  const raw = parseCookies(request.headers.get('cookie')).sid;
  if (!raw) return null;
  const [payload, sig] = raw.split('.');
  if (!payload || !sig) return null;
  if (!wc.safeEqual(sig, await wc.hmac(secret, payload))) return null;
  try {
    const s = JSON.parse(wc.b64uToText(payload));
    if (!s || typeof s !== 'object') return null;
    if (!s.iat || Date.now() / 1000 - s.iat > SESSION_MAX_AGE) return null;
    return s;
  } catch {
    return null;
  }
}

const newSession = () => ({ csrf: wc.randomToken(18), lang: 'ar', iat: Math.floor(Date.now() / 1000) });

async function sessionCookie(ctx) {
  const payload = wc.textToB64u(JSON.stringify(ctx.session));
  return (
    `sid=${payload}.${await wc.hmac(ctx.secret, payload)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}` +
    (ctx.secure ? '; Secure' : '')
  );
}

// ---- Small helpers ---------------------------------------------------------

const str = (v, max) => String(v ?? '').slice(0, max);

function safeNext(next) {
  const n = String(next || '');
  if (!n.startsWith('/') || n.startsWith('//') || /[\\\u0000-\u001f]/.test(n)) return '/';
  return n;
}

// Pages carry no inline scripts. Scripts may only come from this site's own files (the home page's live search);
// public pages with Google Tag Manager also allow Google's host plus this one request's nonce.
function securityHeaders(secure, gtmNonce) {
  const csp = gtmNonce
    ? `default-src 'self'; script-src 'self' 'nonce-${gtmNonce}' https://www.googletagmanager.com; ` +
      "style-src 'self'; font-src 'self'; " +
      "img-src 'self' data: https://*.google-analytics.com https://*.googletagmanager.com https://www.google.com; " +
      "connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com; " +
      "frame-src https://www.googletagmanager.com; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'"
    : "default-src 'self'; script-src 'self'; style-src 'self'; " +
      "font-src 'self'; img-src 'self' data:; form-action 'self'; " +
      "base-uri 'none'; frame-ancestors 'none'; object-src 'none'";
  const h = {
    'Content-Security-Policy': csp,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  };
  if (secure) h['Strict-Transport-Security'] = 'max-age=15552000';
  return h;
}

// ---- Responses (handlers fill ctx.out; handle() turns it into a Response) --

function send(ctx, status, contentType, body, headers = {}) {
  if (ctx.out) return;
  ctx.out = { status, body, headers: { 'Content-Type': contentType, ...headers } };
}

function html(ctx, status, body, headers = {}) {
  send(ctx, status, 'text/html; charset=utf-8', body, {
    'Cache-Control': 'private, no-cache',
    Vary: 'Cookie, Accept-Language',
    ...headers,
  });
}

function redirect(ctx, location, status = 303) {
  send(ctx, status, 'text/plain; charset=utf-8', '', { Location: location, 'Cache-Control': 'no-store' });
}

function flash(ctx, type, key, vars) {
  ctx.session.flash = { type, key, vars };
  ctx.dirty = true;
}

// Work that may finish after the page is sent (a WhatsApp alert); never lets an error reach the visitor.
function later(ctx, promise) {
  const p = Promise.resolve(promise).catch((err) => console.error('background task failed', err && err.message));
  if (ctx.waitUntil) ctx.waitUntil(p);
}

// Free WhatsApp alert to the owner (needs CALLMEBOT_KEY). Capped per hour so a flood cannot hammer the service.
function notify(ctx, text) {
  if (!notifier.enabled()) return;
  later(
    ctx,
    (async () => {
      if (!(await ctx.store.allow('notify', 120, 3600 * 1000))) return;
      await notifier.send(text);
    })()
  );
}

// Every staff action is written to the log (who, what, on whom).
const audit = (ctx, action, target, detail) => ctx.store.logAction(ctx.user.id, ctx.user.name, action, target, detail);

const ar = (key, vars) => t('ar', key, vars);

const notFound = (ctx) => html(ctx, 404, views.errorPage(ctx, 404));
const tooMany = (ctx) => html(ctx, 429, views.errorPage(ctx, 429), { 'Retry-After': '600' });

// ---- Context ---------------------------------------------------------------

function makeCtx(request, url, extra) {
  const ctx = {
    request,
    url,
    query: Object.fromEntries(url.searchParams),
    params: {},
    body: {},
    out: null,
    dirty: false,
    user: undefined,
    secure: url.protocol === 'https:',
    base: config.baseUrl || url.origin,
    path: url.pathname + url.search,
    extraCookies: [],
    nonce: wc.randomToken(12).replace(/[^A-Za-z0-9]/g, 'a'),
    gtmNonce: '',
    ...extra,
  };
  ctx.t = (key, vars) => t(ctx.lang, key, vars);
  return ctx;
}

async function buildContext(request, url, ip, store, waitUntil) {
  const secret = await store.getSecret();
  let session = await readSession(request, secret);
  let dirty = false;
  if (!session) {
    session = newSession();
    dirty = true;
  }
  if (session.lang !== 'ar' && session.lang !== 'en') {
    session.lang = 'ar';
    dirty = true;
  }

  let user = session.uid ? await store.getUser(session.uid) : undefined;
  if (user && (user.banned || user.suspended)) user = undefined;
  if (session.uid && !user) {
    delete session.uid;
    dirty = true;
  }

  const cookies = parseCookies(request.headers.get('cookie'));
  const lp = cookies.lp;
  const ctx = makeCtx(request, url, {
    lastPhone: /^5\d{8}$/.test(lp || '') ? lp : '',
    device: /^[A-Za-z0-9_-]{16,40}$/.test(cookies.did || '') ? cookies.did : '',
    store,
    secret,
    session,
    dirty,
    user: user || undefined,
    lang: session.lang,
    csrf: session.csrf,
    ip,
    waitUntil,
    theme: cookies.theme === 'dark' ? 'dark' : 'light',
    ack: cookies.ack === '1',
    plateStyle: await store.getPlateStyle(),
  });
  if (user && util.rankOf(user) >= 1) {
    const a = await store.adminAlerts();
    ctx.alertsRatings = a.ratings;
    ctx.alerts = (util.rankOf(user) >= 2 ? a.pending + a.review + a.reports : a.pending + a.reports) + a.ratings;
  }

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

const csrfOk = (ctx) => !!ctx.csrf && wc.safeEqual(ctx.body._csrf || '', ctx.csrf);

function requireLogin(ctx) {
  if (ctx.user) return true;
  ctx.session.next = ctx.request.method === 'GET' ? ctx.path : '/post';
  ctx.dirty = true;
  redirect(ctx, '/login');
  return false;
}

// minRank: 1 = any staff, 2 = general moderator or owner, 3 = owner only.
function requireStaff(ctx, minRank = 1) {
  if (util.rankOf(ctx.user) >= minRank) return true;
  notFound(ctx);
  return false;
}
const requireAdmin = (ctx) => requireStaff(ctx, 2);

// Remember the phone in this browser only, so the login form can fill it in next time.
function rememberPhone(ctx, nat) {
  ctx.extraCookies.push(
    `lp=${nat}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${365 * 24 * 3600}` + (ctx.secure ? '; Secure' : '')
  );
}

// Every browser gets a random id the first time it opens the login or register page.
function ensureDevice(ctx) {
  if (ctx.device) return;
  ctx.device = wc.randomToken(18);
  ctx.extraCookies.push(
    `did=${ctx.device}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${2 * 365 * 24 * 3600}` + (ctx.secure ? '; Secure' : '')
  );
}

function logIn(ctx, userId) {
  ctx.session.uid = userId;
  ctx.session.csrf = wc.randomToken(18); // fresh token after login
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

async function renderHome(ctx, f, landing) {
  // Now and then a visit also runs the upkeep, in case the scheduled job is not set up.
  if (Math.random() < 0.03) later(ctx, ctx.store.maintenance());
  const size = config.pageSize;
  let { total, rows } = await ctx.store.searchListings({ ...f, limit: size, offset: (f.page - 1) * size });
  const pages = Math.max(1, Math.ceil(total / size));
  let page = f.page;
  if (page > pages) {
    page = pages;
    ({ rows } = await ctx.store.searchListings({ ...f, limit: size, offset: (page - 1) * size }));
  }
  if (ctx.user) ctx.liked = await ctx.store.likedAmong(ctx.user.id, rows.map((r) => r.id));
  const anyFilter = !!(f.q || f.starts || f.ends || f.min != null || f.max != null || f.network || f.city || f.pattern);
  const counts = await ctx.store.landingCounts();
  html(
    ctx,
    200,
    views.homePage(ctx, {
      filters: f,
      rows,
      total,
      page,
      pages,
      siteEmpty: total === 0 && !anyFilter && !landing,
      landing,
      counts,
    })
  );
}

route('GET', '/', async (ctx) => renderHome(ctx, parseFilters(ctx.query), null));

// Landing pages with their own address, so Google can list "STC numbers", "numbers in Riyadh" and so on.
route('GET', '/network/:key', async (ctx) => {
  if (!NETWORK_BY_KEY[ctx.params.key]) return notFound(ctx);
  const f = { ...parseFilters(ctx.query), network: ctx.params.key, city: '', q: '', qRaw: '', maxRaw: '', max: null };
  await renderHome(ctx, f, { type: 'network', key: ctx.params.key });
});
route('GET', '/network/:net/:city', async (ctx) => {
  const { net, city } = ctx.params;
  if (!NETWORK_BY_KEY[net] || !CITY_BY_KEY[city] || city === 'other') return notFound(ctx);
  const f = { ...parseFilters(ctx.query), network: net, city, q: '', qRaw: '', maxRaw: '', max: null };
  await renderHome(ctx, f, { type: 'netcity', key: `${net}/${city}` });
});
route('GET', '/city/:key', async (ctx) => {
  if (!CITY_BY_KEY[ctx.params.key]) return notFound(ctx);
  const f = { ...parseFilters(ctx.query), city: ctx.params.key, network: '', q: '', qRaw: '', maxRaw: '', max: null };
  await renderHome(ctx, f, { type: 'city', key: ctx.params.key });
});
// Newest ads first, no pinned ads on top. Google sees fresh content here.
route('GET', '/new', async (ctx) => {
  const f = { ...parseFilters(ctx.query), pinFirst: false, network: '', city: '', q: '', qRaw: '', maxRaw: '', max: null };
  await renderHome(ctx, f, { type: 'new', key: 'new' });
});
// A member's public page: every live ad of one advertiser. Not indexed by Google.
route('GET', '/u/:id', async (ctx) => {
  const id = /^\d{1,9}$/.test(ctx.params.id) ? Number(ctx.params.id) : 0;
  const u = id ? await ctx.store.getUser(id) : null;
  if (!u || u.banned || u.suspended > 0) return notFound(ctx);
  const f = { ...parseFilters(ctx.query), userId: id, network: '', city: '', q: '', qRaw: '', maxRaw: '', max: null };
  const sum = await ctx.store.ratingSummary(id);
  const rating = {
    n: sum.n,
    avg: sum.avg,
    list: await ctx.store.approvedRatings(id),
    mine: ctx.user ? await ctx.store.myRating(id, ctx.user.id) : null,
    canRate: !!ctx.user && ctx.user.id !== id,
  };
  await renderHome(ctx, f, { type: 'seller', key: String(id), name: u.name, rating });
});

// A member rates a seller (1-5 stars and a short comment). It waits for staff approval before anyone sees it.
route('POST', '/u/:id/rate', async (ctx) => {
  if (!requireLogin(ctx)) return;
  const id = /^\d{1,9}$/.test(ctx.params.id) ? Number(ctx.params.id) : 0;
  const u = id ? await ctx.store.getUser(id) : null;
  if (!u || u.banned || u.suspended > 0) return notFound(ctx);
  const back = `/u/${id}`;
  if (u.id === ctx.user.id) return notFound(ctx);
  if (!(await ctx.store.allow(`rate:${ctx.user.id}`, 20, 24 * 3600 * 1000))) return tooMany(ctx);
  const stars = Number(ctx.body.stars);
  const comment = str(ctx.body.comment, 200).replace(/\s+/g, ' ').trim();
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    flash(ctx, 'error', 'err_stars');
    return redirect(ctx, back);
  }
  if (comment && (util.hasOutsideContact(comment) || /\d(?:[\s.-]?\d){7,}/.test(util.toWestern(comment)))) {
    flash(ctx, 'error', 'err_rating_contact');
    return redirect(ctx, back);
  }
  await ctx.store.saveRating(id, ctx.user.id, stars, comment);
  notify(ctx, ar('wa_alert_rating', { seller: u.name, name: ctx.user.name, stars, url: `${ctx.base}/admin?tab=ratings` }));
  flash(ctx, 'ok', 'rating_pending');
  redirect(ctx, back);
});

// Like / unlike an ad (members only).
route('POST', '/n/:id/like', async (ctx) => {
  if (!requireLogin(ctx)) return;
  const id = Number(ctx.params.id);
  const l = Number.isInteger(id) ? await ctx.store.getListing(id) : undefined;
  if (!l || l.status !== 'active' || l.seller_banned || l.seller_suspended) return notFound(ctx);
  if (!(await ctx.store.allow(`like:${ctx.user.id}`, 200, 3600 * 1000))) return tooMany(ctx);
  await ctx.store.toggleLike(l.id, ctx.user.id);
  redirect(ctx, ctx.body.next ? safeNext(ctx.body.next) : `/n/${l.id}`);
});
route('GET', '/price/:key', async (ctx) => {
  const price = /^\d{1,8}$/.test(ctx.params.key) ? Number(ctx.params.key) : null;
  if (price === null) return notFound(ctx);
  const f = { ...parseFilters(ctx.query), min: price, max: price, minRaw: '', maxRaw: '', network: '', city: '', q: '', qRaw: '' };
  await renderHome(ctx, f, { type: 'price', key: String(price) });
});
route('GET', '/type/:key', async (ctx) => {
  if (!PATTERN_KEYS.includes(ctx.params.key)) return notFound(ctx);
  const f = { ...parseFilters(ctx.query), pattern: ctx.params.key, city: '', network: '', q: '', qRaw: '', maxRaw: '', max: null };
  await renderHome(ctx, f, { type: 'type', key: ctx.params.key });
});

// "Numbers under 500 riyals" and similar: indexed pages for the most searched price ceilings.
route('GET', '/under/:key', async (ctx) => {
  const n = Number(ctx.params.key);
  if (!UNDER_PRICES.includes(n)) return notFound(ctx);
  const f = { ...parseFilters(ctx.query), max: n, maxRaw: '', min: null, minRaw: '', network: '', city: '', q: '', qRaw: '' };
  await renderHome(ctx, f, { type: 'under', key: String(n) });
});

// Night / day mode: remembered in a cookie (no scripts needed).
route('GET', '/theme/:mode', (ctx) => {
  const mode = ctx.params.mode === 'dark' ? 'dark' : 'light';
  ctx.extraCookies.push(`theme=${mode}; Path=/; SameSite=Lax; Max-Age=${365 * 24 * 3600}` + (ctx.secure ? '; Secure' : ''));
  redirect(ctx, safeNext(ctx.query.next), 302);
});

// Notice for new visitors: remembered for 30 days once they press "Got it".
route('GET', '/ack', (ctx) => {
  ctx.extraCookies.push(`ack=1; Path=/; SameSite=Lax; Max-Age=${30 * 24 * 3600}` + (ctx.secure ? '; Secure' : ''));
  redirect(ctx, safeNext(ctx.query.next), 302);
});

// ---- Information pages (they also bring visitors from Google) ----

route('GET', '/about', (ctx) => html(ctx, 200, views.aboutPage(ctx)));
route('GET', '/contact', (ctx) => html(ctx, 200, views.contactPage(ctx)));
route('GET', '/faq', (ctx) => html(ctx, 200, views.faqPage(ctx, content.FAQ)));
route('GET', '/articles', (ctx) => html(ctx, 200, views.articlesPage(ctx, content.ARTICLES)));
route('GET', '/articles/:slug', async (ctx) => {
  const a = content.ARTICLE_BY_SLUG[ctx.params.slug];
  if (!a) return notFound(ctx);
  // The newest live numbers under the article, so readers (and Google) get from the guide to real ads.
  const latest = (await ctx.store.searchListings({ sort: 'new', limit: 6, offset: 0 })).rows;
  html(ctx, 200, views.articlePage(ctx, a, content.ARTICLES, latest));
});

route('GET', '/n/:id', async (ctx) => {
  const id = Number(ctx.params.id);
  const l = Number.isInteger(id) ? await ctx.store.getListing(id) : undefined;
  if (!l) return notFound(ctx);
  const canManage = !!ctx.user && (ctx.user.id === l.user_id || util.rankOf(ctx.user) >= 1);
  const publicVisible = (l.status === 'active' || l.status === 'sold') && !l.seller_banned && !l.seller_suspended;
  if (!publicVisible && !canManage) return notFound(ctx);

  const isBot = /bot|crawl|spider|slurp|preview|facebookexternalhit|curl|wget|python|node-fetch|go-http/i.test(
    ctx.request.headers.get('user-agent') || ''
  );
  if (l.status === 'active' && !isBot && !(ctx.user && ctx.user.id === l.user_id)) {
    const seen = Array.isArray(ctx.session.seen) ? ctx.session.seen : [];
    if (!seen.includes(l.id)) {
      await ctx.store.bumpViews(l.id);
      l.views += 1;
      ctx.session.seen = [...seen, l.id].slice(-20);
      ctx.dirty = true;
    }
  }
  const similar = publicVisible ? await ctx.store.similarListings(l, 6) : [];
  if (ctx.user) ctx.liked = await ctx.store.likedAmong(ctx.user.id, [l.id, ...similar.map((x) => x.id)]);
  html(ctx, 200, views.listingPage(ctx, l, { canManage, similar }));
});

route('POST', '/n/:id/report', async (ctx) => {
  if (!(await ctx.store.allow(`report:${ctx.ip}`, 20, 3600 * 1000))) return tooMany(ctx);
  const id = Number(ctx.params.id);
  const l = Number.isInteger(id) ? await ctx.store.getListing(id) : undefined;
  if (!l || l.status !== 'active') return notFound(ctx);
  const reason = REPORT_REASONS.includes(ctx.body.reason) ? ctx.body.reason : 'other';
  if (!(ctx.user && ctx.user.id === l.user_id)) {
    const key = ctx.user ? `u${ctx.user.id}` : 'ip' + (await wc.sha256Hex(ctx.ip + ctx.secret)).slice(0, 16);
    // One person can send only a few reports a day, so reports cannot be used to attack other advertisers.
    if (!(await ctx.store.allow(`report-day:${key}`, 5, 24 * 3600 * 1000))) {
      flash(ctx, 'error', 'err_report_limit');
      return redirect(ctx, `/n/${l.id}`);
    }
    const count = await ctx.store.addReport(l.id, key, reason);
    if (count >= config.reportHideAt) await ctx.store.setListingStatus(l.id, 'hidden');
    notify(ctx, ar('wa_alert_report', { number: l.number, reason: ctx.t('r_' + reason), n: count, url: `${ctx.base}/admin?tab=reported` }));
  }
  flash(ctx, 'ok', 'reported');
  const after = await ctx.store.getListing(l.id);
  redirect(ctx, after && after.status === 'active' ? `/n/${l.id}` : '/');
});

// ---- Post an ad ----

// Reads and checks the fields shared by "post" and "edit" (everything except the number).
function readAdFields(ctx) {
  const b = ctx.body;
  const v = {
    network: str(b.network, 20),
    city: str(b.city, 20),
    price: str(b.price, 15).trim(),
    contact: str(b.contact, 25).trim(),
    description: str(b.description, 1000).replace(/\r\n?/g, '\n').trim(),
    priceType: PRICE_TYPES.includes(b.price_type) ? b.price_type : '',
  };
  const errors = {};
  if (!NETWORK_BY_KEY[v.network]) errors.network = 'err_network';
  if (!CITY_BY_KEY[v.city]) errors.city = 'err_city';

  let price = null;
  if (v.price) {
    price = parsePrice(v.price);
    if (price === null || price > 10000000) errors.price = 'err_price';
    // A price that looks like a typo or a trick must be confirmed once before it goes live.
    else if ((price < 100 || price > 3000000) && b.price_ok !== '1') {
      errors.price = { key: 'warn_price', vars: { price: util.formatPrice(price) } };
    }
  }
  if (!price) v.priceType = '';

  let contact = util.toIntl(ctx.user.phone);
  if (v.contact) {
    const c = util.normPhone(v.contact);
    if (c) contact = util.toIntl(c);
    else errors.contact = 'err_contact';
  }
  if ([...v.description].length > 300) errors.description = 'err_desc';
  else if (!ctx.user.is_admin && util.hasOutsideContact(v.description)) errors.description = 'err_desc_links';
  return { v, errors, price, contact };
}

// A blocked phone cannot be an ad's number or contact.
async function checkBlocked(ctx, errors, contact) {
  if (!errors.contact && contact && (await ctx.store.isPhoneBlocked(contact.slice(3)))) errors.contact = 'err_blocked_number';
}


route('GET', '/post', (ctx) => {
  if (!requireLogin(ctx)) return;
  html(ctx, 200, views.postPage(ctx));
});

// Where a new ad starts: normal numbers go live; special-looking ones wait for staff (members only; staff are trusted).
function statusForNew(user, number, price) {
  if (util.rankOf(user) >= 1) return 'active';
  if (price != null && price >= config.highPrice) return 'pending';
  const risk = util.numberRisk(number);
  if (risk === 'hold') return 'hidden';
  if (risk === 'review' || config.requireApproval) return 'pending';
  return 'active';
}

route('POST', '/post', async (ctx) => {
  if (!requireLogin(ctx)) return;
  if (!(await ctx.store.allow(`post:${ctx.ip}`, config.postPerHour, 3600 * 1000))) return tooMany(ctx);

  const { v, errors, price, contact } = readAdFields(ctx);
  v.number = str(ctx.body.number, 25).trim();

  const nat = util.normPhone(v.number);
  if (!nat) errors.number = 'err_number';

  if (nat && !errors.number) {
    const number = util.toLocal(nat);
    if ((await ctx.store.countActiveByUser(ctx.user.id)) >= adLimit(ctx.user)) {
      errors.number = { key: 'err_limit', vars: { n: adLimit(ctx.user) } };
    } else if (await ctx.store.numberIsListed(number)) {
      errors.number = 'err_dup';
    } else if (util.rankOf(ctx.user) < 1 && (await ctx.store.numberIsHeld(number))) {
      errors.number = 'err_held';
    } else if (await ctx.store.isPhoneBlocked(nat)) {
      errors.number = 'err_blocked_number';
    } else {
      // The same number cannot come back right after its owner deleted it.
      const left = await ctx.store.penaltyDaysLeft(number);
      if (left > 0) errors.number = { key: 'err_penalty', vars: { n: left } };
    }
  }
  await checkBlocked(ctx, errors, contact);

  // At most N new numbers per advertiser in any 24 hours. Deleted ads still count, so delete-and-repost does not get around it.
  if (!Object.keys(errors).length && !(await ctx.store.allow(`ads-day:${ctx.user.id}`, config.maxAdsPerDay, 24 * 3600 * 1000))) {
    errors.number = { key: 'err_daily', vars: { n: config.maxAdsPerDay } };
  }

  if (Object.keys(errors).length) return html(ctx, 400, views.postPage(ctx, v, errors));

  const status = statusForNew(ctx.user, util.toLocal(nat), price);
  const id = await ctx.store.insertListing({
    userId: ctx.user.id,
    number: util.toLocal(nat),
    network: v.network,
    city: v.city,
    price,
    contact,
    description: v.description,
    priceType: v.priceType,
    auto: !!ctx.user.verified,
    status,
  });
  if (!ctx.user.is_admin) {
    notify(ctx, ar('wa_alert_ad', { number: util.toLocal(nat), name: ctx.user.name, state: status === 'pending' ? ar('wa_pending') : status === 'hidden' ? ar('wa_held') : '', url: `${ctx.base}/n/${id}` }));
  }
  flash(ctx, 'ok', status === 'pending' ? 'pending_notice' : status === 'hidden' ? 'held_notice' : 'published_notice');
  redirect(ctx, `/n/${id}`);
});

// ---- Edit an ad (owner only) ----

async function ownListing(ctx) {
  const id = Number(ctx.params.id);
  const l = Number.isInteger(id) ? await ctx.store.getListing(id) : undefined;
  return l && l.user_id === ctx.user.id && l.status !== 'sold' ? l : null;
}

route('GET', '/n/:id/edit', async (ctx) => {
  if (!requireLogin(ctx)) return;
  const l = await ownListing(ctx);
  if (!l) return notFound(ctx);
  const v = {
    network: l.network,
    city: l.city,
    price: l.price == null ? '' : String(l.price),
    contact: util.intlToLocal(l.contact),
    description: l.description,
    priceType: l.price_type,
    priceOk: l.price != null && (l.price < 100 || l.price > 3000000) ? '1' : '',
  };
  html(ctx, 200, views.editPage(ctx, l, v));
});

route('POST', '/n/:id/edit', async (ctx) => {
  if (!requireLogin(ctx)) return;
  if (!(await ctx.store.allow(`edit:${ctx.ip}`, 60, 3600 * 1000))) return tooMany(ctx);
  const l = await ownListing(ctx);
  if (!l) return notFound(ctx);

  const { v, errors, price, contact } = readAdFields(ctx);
  await checkBlocked(ctx, errors, contact);
  if (Object.keys(errors).length) return html(ctx, 400, views.editPage(ctx, l, v, errors));

  // With approval mode on, a changed live ad goes back to review so contact details cannot be swapped after approval.
  const highRaise = util.rankOf(ctx.user) < 1 && price != null && price >= config.highPrice && price !== l.price;
  const status = (config.requireApproval || highRaise) && !ctx.user.is_admin && l.status === 'active' ? 'pending' : l.status;
  await ctx.store.updateListing({
    id: l.id,
    userId: ctx.user.id,
    network: v.network,
    city: v.city,
    price,
    contact,
    description: v.description,
    priceType: v.priceType,
    status,
  });
  flash(ctx, 'ok', status === 'pending' ? 'pending_notice' : 'updated');
  redirect(ctx, `/n/${l.id}`);
});

// ---- Accounts ----

route('GET', '/register', (ctx) => {
  ensureDevice(ctx);
  if (ctx.user) return redirect(ctx, '/');
  html(ctx, 200, views.registerPage(ctx));
});

route('POST', '/register', async (ctx) => {
  if (!(await ctx.store.allow(`register:${ctx.ip}`, config.registerPerHour, 3600 * 1000))) return tooMany(ctx);
  const name = str(ctx.body.name, 80).replace(/\s+/g, ' ').trim();
  const phoneRaw = str(ctx.body.phone, 25).trim();
  const password = str(ctx.body.password, 200);
  const v = { name, phone: phoneRaw };
  const errors = {};

  if (name.length < 2 || name.length > 60) errors.name = 'err_name';
  const nat = util.normPhone(phoneRaw);
  if (!nat) errors.phone = 'err_phone';
  else if (await ctx.store.getUserByPhone(nat)) errors.phone = 'err_phone_taken';
  else if (await ctx.store.isPhoneBlocked(nat)) errors.phone = 'err_banned';
  if (password.length < 8) errors.password = 'err_pass';
  if (Object.keys(errors).length) return html(ctx, 400, views.registerPage(ctx, v, errors));

  ensureDevice(ctx);
  if (await ctx.store.isDeviceBanned(ctx.device)) {
    return html(ctx, 403, views.registerPage(ctx, v, { phone: 'err_banned' }));
  }

  const passHash = await wc.hashPassword(password, config.pbkdf2Iterations);
  let id;
  try {
    id = await ctx.store.createUser(nat, name, passHash);
  } catch {
    // Someone registered the same phone at the same moment.
    return html(ctx, 400, views.registerPage(ctx, v, { phone: 'err_phone_taken' }));
  }
  await ctx.store.recordDevice(id, ctx.device);
  logIn(ctx, id);
  rememberPhone(ctx, nat);
  notify(ctx, ar('wa_alert_register', { name, phone: util.toLocal(nat), url: `${ctx.base}/admin?tab=users` }));
  flash(ctx, 'ok', 'welcome');
  const next = ctx.session.next ? safeNext(ctx.session.next) : '/post';
  delete ctx.session.next;
  redirect(ctx, next);
});

route('GET', '/login', (ctx) => {
  if (ctx.user) return redirect(ctx, '/');
  ensureDevice(ctx);
  html(ctx, 200, views.loginPage(ctx));
});

route('POST', '/login', async (ctx) => {
  const phoneRaw = str(ctx.body.phone, 25).trim();
  const password = str(ctx.body.password, 200);
  const nat = util.normPhone(phoneRaw);
  // Limits are per visitor (IP), and per phone from that same IP, so a stranger cannot lock someone else out.
  if (!(await ctx.store.allow(`login:${ctx.ip}`, 20, 15 * 60 * 1000))) return tooMany(ctx);
  if (nat && !(await ctx.store.allow(`login-phone:${nat}:${ctx.ip}`, 10, 15 * 60 * 1000))) return tooMany(ctx);

  ensureDevice(ctx);
  if (await ctx.store.isDeviceBanned(ctx.device)) {
    return html(ctx, 403, views.loginPage(ctx, { phone: phoneRaw }, { form: 'err_banned' }));
  }

  if (nat && (await ctx.store.isPhoneBlocked(nat))) {
    return html(ctx, 403, views.loginPage(ctx, { phone: phoneRaw }, { form: 'err_banned' }));
  }

  const user = nat ? await ctx.store.getUserByPhone(nat) : undefined;
  const ok = await wc.verifyPassword(password, user ? user.pass_hash : dummyHash(), config.pbkdf2Iterations);
  if (!user || !ok) return html(ctx, 401, views.loginPage(ctx, { phone: phoneRaw }, { form: 'err_login' }));
  if (user.banned) return html(ctx, 403, views.loginPage(ctx, { phone: phoneRaw }, { form: 'err_banned' }));
  if (user.suspended) return html(ctx, 403, views.loginPage(ctx, { phone: phoneRaw }, { form: 'err_suspended' }));

  await ctx.store.recordDevice(user.id, ctx.device);
  logIn(ctx, user.id);
  rememberPhone(ctx, nat);
  if (!user.is_admin) notify(ctx, ar('wa_alert_login', { name: user.name, phone: util.toLocal(nat) }));
  flash(ctx, 'ok', 'welcome_back');
  const next = ctx.session.next ? safeNext(ctx.session.next) : '/';
  delete ctx.session.next;
  redirect(ctx, next);
});

route('POST', '/logout', (ctx) => {
  delete ctx.session.uid;
  ctx.session.csrf = wc.randomToken(18);
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

// ---- Change own password ----

route('GET', '/password', (ctx) => {
  if (!requireLogin(ctx)) return;
  html(ctx, 200, views.passwordPage(ctx));
});

route('POST', '/password', async (ctx) => {
  if (!requireLogin(ctx)) return;
  if (!(await ctx.store.allow(`pw:${ctx.ip}`, 10, 15 * 60 * 1000))) return tooMany(ctx);
  const current = str(ctx.body.current, 200);
  const next = str(ctx.body.next, 200);
  const errors = {};
  if (!(await wc.verifyPassword(current, ctx.user.pass_hash, config.pbkdf2Iterations))) errors.current = 'err_pass_current';
  if (next.length < 8) errors.next = 'err_pass';
  if (Object.keys(errors).length) return html(ctx, 400, views.passwordPage(ctx, errors));
  await ctx.store.setUserPassword(ctx.user.id, await wc.hashPassword(next, config.pbkdf2Iterations));
  flash(ctx, 'ok', 'pw_changed');
  redirect(ctx, '/my');
});

// ---- My ads ----

route('GET', '/my', async (ctx) => {
  if (!requireLogin(ctx)) return;
  html(ctx, 200, views.myPage(ctx, await ctx.store.userListings(ctx.user.id)));
});

// Before anything that cannot be undone, ask "are you sure?" on a page of its own (the site uses no scripts).
// The first POST shows the question with the same fields hidden; the second POST carries confirm=1.
// With `ask`, staff also pick a reason, which feeds the ready-made message to the member.
function needConfirm(ctx, what, { back = '/', ask = false } = {}) {
  if (ctx.body.confirm === '1') return false;
  const fields = Object.entries(ctx.body).filter(([k]) => k !== '_csrf' && k !== 'confirm' && k !== 'reason');
  html(ctx, 200, views.confirmPage(ctx, { action: ctx.url.pathname, fields, what, back, ask }));
  return true;
}

route('POST', '/my/:id/sold', async (ctx) => {
  if (!requireLogin(ctx)) return;
  if (needConfirm(ctx, 'sold', { back: ctx.body.next ? safeNext(ctx.body.next) : '/my' })) return;
  await ctx.store.setOwnListingStatus(Number(ctx.params.id), ctx.user.id, 'sold');
  flash(ctx, 'ok', 'updated');
  redirect(ctx, ctx.body.next ? safeNext(ctx.body.next) : '/my');
});

route('POST', '/my/:id/delete', async (ctx) => {
  if (!requireLogin(ctx)) return;
  if (needConfirm(ctx, 'delete_own', { back: '/my' })) return;
  await ctx.store.deleteOwnListing(Number(ctx.params.id), ctx.user.id);
  flash(ctx, 'ok', 'deleted');
  redirect(ctx, ctx.body.next ? safeNext(ctx.body.next) : '/my');
});

// Move an ad back to the top: once every few days.
route('POST', '/my/:id/renew', async (ctx) => {
  if (!requireLogin(ctx)) return;
  const r = await ctx.store.renewListing(Number(ctx.params.id), ctx.user.id);
  if (r.ok) flash(ctx, 'ok', 'renewed');
  else if (r.missing) flash(ctx, 'error', 'err_renew_state');
  else flash(ctx, 'error', 'err_renew_wait', { n: r.daysLeft });
  redirect(ctx, '/my');
});

// Verified advertisers: switch the automatic refresh on for one more month.
route('POST', '/my/:id/auto', async (ctx) => {
  if (!requireLogin(ctx)) return;
  if (!ctx.user.verified) return notFound(ctx);
  const ok = await ctx.store.setAutoRenew(Number(ctx.params.id), ctx.user.id);
  flash(ctx, ok ? 'ok' : 'error', ok ? 'auto_enabled' : 'err_renew_state');
  redirect(ctx, '/my');
});

// Verified advertisers add up to 5 numbers at a time (same free-text format as the admin import).
const BULK_MAX = 5;
route('GET', '/my/bulk', (ctx) => {
  if (!requireLogin(ctx)) return;
  if (!ctx.user.verified && util.rankOf(ctx.user) < 2) return notFound(ctx);
  html(ctx, 200, views.bulkPage(ctx, { max: BULK_MAX }));
});
route('POST', '/my/bulk', async (ctx) => {
  if (!requireLogin(ctx)) return;
  if (!ctx.user.verified && util.rankOf(ctx.user) < 2) return notFound(ctx);
  if (!(await ctx.store.allow(`bulk:${ctx.user.id}`, 12, 3600 * 1000))) return tooMany(ctx);
  const network = NETWORK_BY_KEY[ctx.body.network] ? ctx.body.network : 'stc';
  const city = CITY_BY_KEY[ctx.body.city] ? ctx.body.city : 'riyadh';
  const parsed = parseImport(str(ctx.body.lines, 2000), network, city);
  const room = Math.max(0, adLimit(ctx.user) - (await ctx.store.countActiveByUser(ctx.user.id)));
  const items = [];
  for (const it of parsed.items) {
    if (items.some((x) => x.number === it.number)) continue;
    if (await ctx.store.isPhoneBlocked(it.number.slice(1))) continue;
    items.push(it);
  }
  const take = items.slice(0, Math.min(BULK_MAX, room));
  if (!take.length) {
    flash(ctx, 'error', room ? 'import_none' : 'err_limit_bulk', { n: adLimit(ctx.user) });
    return redirect(ctx, '/my/bulk');
  }
  const r = await ctx.store.importListings(ctx.user.id, util.toIntl(ctx.user.phone), take, { penalty: true, auto: !!ctx.user.verified, statusOf: (n) => statusForNew(ctx.user, n) });
  const extra = parsed.items.length - r.added;
  flash(ctx, 'ok', 'bulk_done', { added: r.added, skipped: Math.max(0, extra) });
  redirect(ctx, '/my');
});

// All prices in one go.
route('GET', '/my/prices', async (ctx) => {
  if (!requireLogin(ctx)) return;
  const rows = (await ctx.store.userListings(ctx.user.id)).filter((l) => l.status !== 'sold');
  html(ctx, 200, views.pricesPage(ctx, rows));
});
route('POST', '/my/prices', async (ctx) => {
  if (!requireLogin(ctx)) return;
  if (!(await ctx.store.allow(`prices:${ctx.user.id}`, 20, 3600 * 1000))) return tooMany(ctx);
  const rows = (await ctx.store.userListings(ctx.user.id)).filter((l) => l.status !== 'sold');
  const items = [];
  for (const l of rows) {
    const raw = str(ctx.body['p_' + l.id], 12).trim();
    if (raw === '' || raw === undefined) continue;
    const price = parsePrice(raw);
    if (price == null || price > 10000000) continue;
    if (price === l.price) continue;
    items.push({ id: l.id, price, hold: util.rankOf(ctx.user) < 1 && price >= config.highPrice });
  }
  const n = items.length ? await ctx.store.setPrices(ctx.user.id, items) : 0;
  flash(ctx, 'ok', 'prices_done', { n });
  redirect(ctx, '/my');
});

// ---- Admin ----

const TABS_SENIOR = ['stats', 'pending', 'review', 'reported', 'all', 'sold', 'ratings', 'users', 'blocked', 'log'];
const TABS_MOD = ['pending', 'reported', 'all', 'sold', 'ratings', 'users'];
const adminTabs = (ctx) => (util.rankOf(ctx.user) >= 2 ? TABS_SENIOR : TABS_MOD);
const ADMIN_PAGE = 30; // rows per admin screen (keeps the page quick on the free plan)
const ADMIN_PAGE_LOG = 50;
// Filters of the log table, read from the address bar. Searching also matches the action names as the reader sees them.
const logFilters = (ctx) => {
  const q = str(ctx.query.q, 60).trim();
  const date = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '');
  const sort = ['when', 'by', 'action', 'target', 'detail'].includes(ctx.query.sort) ? ctx.query.sort : 'when';
  const needle = q.toLowerCase();
  const actionKeys = q
    ? Object.keys(dict[ctx.lang] || {}).filter((k) => k.startsWith('log_') && String(dict[ctx.lang][k]).toLowerCase().includes(needle)).map((k) => k.slice(4))
    : [];
  return { q, actionKeys, actor: str(ctx.query.actor, 80), action: str(ctx.query.action, 40), from: date(ctx.query.from), to: date(ctx.query.to), sort, dir: ctx.query.dir === 'asc' ? 'asc' : 'desc' };
};
const WHY = ['rules', 'fake', 'price', 'sold', 'other'];

// Active-ad ceiling per account: owner unlimited; otherwise a hand-set limit, else general moderator 150, moderator 80, verified member 80, plain member 20.
const adLimit = (user) => {
  const r = util.rankOf(user);
  if (r >= 3) return Infinity;
  if (user.ad_limit > 0) return user.ad_limit; // set by hand by the owner or a general moderator
  return r === 2 ? 150 : r === 1 || user.verified ? 80 : 20;
};

route('GET', '/admin', async (ctx) => {
  if (!requireStaff(ctx, 1)) return;
  const tabs = adminTabs(ctx);
  const tab = tabs.includes(ctx.query.tab) ? ctx.query.tab : tabs[0];
  const data = {};
  const q = str(ctx.query.q, 40).trim();
  const page = Math.max(1, parseInt(ctx.query.page, 10) || 1);
  const opts = { q, limit: ADMIN_PAGE, offset: (page - 1) * ADMIN_PAGE };
  Object.assign(data, { q, page });
  if (tab === 'stats') data.stats = await ctx.store.adminStats();
  else if (tab === 'users') {
    const r = await ctx.store.adminUsers(opts);
    data.users = r.rows;
    data.total = r.total;
  } else if (tab === 'ratings') data.ratings = await ctx.store.adminRatings();
  else if (tab === 'blocked') data.blocked = await ctx.store.blockedPhones();
  else if (tab === 'log') {
    const f = logFilters(ctx);
    const r = await ctx.store.auditSearch({ ...f, limit: ADMIN_PAGE_LOG, offset: (page - 1) * ADMIN_PAGE_LOG });
    data.log = r.rows;
    data.total = r.total;
    data.f = f;
    data.facets = await ctx.store.auditFacets();
    data.pageSize = ADMIN_PAGE_LOG;
  }
  else {
    const r = await ctx.store.adminListings(tab, opts);
    data.listings = r.rows;
    data.total = r.total;
    if (tab === 'review') data.suspended = await ctx.store.suspendedUsers();
  }
  data.pages = Math.max(1, Math.ceil((data.total || 0) / (data.pageSize || ADMIN_PAGE)));
  html(ctx, 200, views.adminPage(ctx, tab, data));
});

const sellerOf = (l) => ({ id: l.user_id, is_admin: l.seller_is_admin, role: l.seller_role });
const reasonOf = (ctx) => (WHY.includes(ctx.body.reason) ? ctx.body.reason : '');

route('POST', '/admin/l/:id/:action', async (ctx) => {
  if (!requireStaff(ctx, 1)) return;
  const id = Number(ctx.params.id);
  const action = ctx.params.action;
  const l = Number.isInteger(id) ? await ctx.store.getListing(id) : undefined;
  if (!l) return notFound(ctx);
  const rank = util.rankOf(ctx.user);
  // Moderators may only hide an ad (and take back their own hiding). Nobody touches the ads of someone above them.
  const modOk = action === 'hide' || action === 'approve';
  if (rank < 2 && !modOk) return notFound(ctx);
  // A hidden ad stays hidden: only the owner can bring it back (not even a general moderator), and approve is for pending ads only.
  if (action === 'restore' && rank < 3) return notFound(ctx);
  if (action === 'approve' && l.status !== 'pending') return notFound(ctx);
  // Putting a sold number back on sale is for the owner and general moderators.
  if (action === 'resell' && (rank < 2 || l.status !== 'sold')) return notFound(ctx);
  if (!util.canActOn(ctx.user, sellerOf(l))) return notFound(ctx);

  if ((action === 'pin' || action === 'feature') && l.status !== 'active') {
    flash(ctx, 'error', 'err_pin_live');
    return redirect(ctx, ctx.body.next ? safeNext(ctx.body.next) : '/admin?tab=all');
  }
  const tabs = adminTabs(ctx);
  const tab = tabs.includes(ctx.body.tab) ? ctx.body.tab : tabs[0];
  const back = ctx.body.next ? safeNext(ctx.body.next) : `/admin?tab=${tab}`;
  if (action === 'hide' && needConfirm(ctx, 'hide', { back, ask: true })) return;
  if (action === 'delete' && needConfirm(ctx, 'delete_admin', { back })) return;

  let msg = 'updated';
  if (action === 'approve') await ctx.store.setListingStatus(id, 'active');
  else if (action === 'hide') await ctx.store.setListingStatus(id, 'hidden', rank === 1 ? ctx.user.id : 0);
  else if (action === 'resell') {
    if (await ctx.store.numberIsListed(l.number)) {
      flash(ctx, 'error', 'err_dup');
      return redirect(ctx, back);
    }
    const seller = (await ctx.store.getUser(l.user_id)) || sellerOf(l);
    if ((await ctx.store.countActiveByUser(l.user_id)) >= adLimit(seller)) {
      flash(ctx, 'error', 'err_resell_limit', { n: adLimit(seller) });
      return redirect(ctx, back);
    }
    await ctx.store.setListingStatus(id, 'active');
  } else if (action === 'restore') {
    await ctx.store.setListingStatus(id, 'active');
    await ctx.store.clearReports(id);
  } else if (action === 'delete') await ctx.store.deleteListing(id);
  else if (action === 'pin' || action === 'unpin') {
    const r = await ctx.store.setPinned(id, action === 'pin', config.pinDays, config.pinMax);
    if (r === -1) {
      flash(ctx, 'error', 'err_pin_full', { n: config.pinMax });
      return redirect(ctx, back);
    }
    msg = action === 'pin' ? 'pinned' : 'unpinned';
  } else if (action === 'feature' || action === 'unfeature') {
    await ctx.store.setFeatured(id, action === 'feature');
    msg = action === 'feature' ? 'featured_on' : 'featured_off';
  } else return notFound(ctx);

  const reason = action === 'hide' ? reasonOf(ctx) : '';
  await audit(ctx, 'ad_' + action, `${l.number} (#${l.id})`, reason ? 'why_' + reason : '');
  flash(ctx, 'ok', msg);
  if (reason && l.user_id !== ctx.user.id) {
    const to = `/admin/notify?${new URLSearchParams({ u: l.user_id, a: 'hide', r: reason, n: l.number, back })}`;
    return redirect(ctx, to);
  }
  redirect(ctx, back);
});

// Staff accept or reject a rating. Only accepted ratings show on the seller page.
route('POST', '/admin/rating/:id/:action', async (ctx) => {
  if (!requireStaff(ctx, 1)) return;
  const action = ctx.params.action;
  if (action !== 'approve' && action !== 'reject' && action !== 'delete') return notFound(ctx);
  const r = Number.isInteger(Number(ctx.params.id)) ? await ctx.store.getRating(Number(ctx.params.id)) : null;
  if (!r) return notFound(ctx);
  if (action === 'delete') {
    if (!requireStaff(ctx, 3)) return;
    if (needConfirm(ctx, 'rating_delete', { back: '/admin?tab=ratings' })) return;
    await ctx.store.deleteRating(r.id);
    await audit(ctx, 'rating_delete', `#${r.id}`, `${r.stars}`);
    flash(ctx, 'ok', 'updated');
    return redirect(ctx, '/admin?tab=ratings');
  }
  await ctx.store.setRatingStatus(r.id, action === 'approve' ? 'approved' : 'rejected');
  await audit(ctx, 'rating_' + action, `#${r.id}`, `${r.stars}`);
  flash(ctx, 'ok', 'updated');
  redirect(ctx, '/admin?tab=ratings');
});

const cleanName = (raw) => str(raw, 80).replace(/\s+/g, ' ').trim();
const nameOk = (n) => n.length >= 2 && n.length <= 60;

// The owner and general moderators can rename members (not their equals or above); each can rename himself.
route('POST', '/admin/u/:id/name', async (ctx) => {
  if (!requireStaff(ctx, 2)) return;
  const user = await ctx.store.getUser(Number(ctx.params.id));
  if (!user || !util.canActOn(ctx.user, user)) return notFound(ctx);
  const name = cleanName(ctx.body.name);
  if (!nameOk(name)) flash(ctx, 'error', 'err_name');
  else {
    await ctx.store.setUserName(user.id, name);
    await audit(ctx, 'user_name', `${user.name} (#${user.id})`, name);
    flash(ctx, 'ok', 'updated');
  }
  redirect(ctx, '/admin?tab=users');
});

route('GET', '/admin/u/:id', async (ctx) => {
  if (!requireStaff(ctx, 1)) return;
  const id = Number(ctx.params.id);
  const u = Number.isInteger(id) ? await ctx.store.getUser(id) : undefined;
  if (!u) return notFound(ctx);
  html(ctx, 200, views.adminUserPage(ctx, u));
});

// Everyone can change their own name.
route('GET', '/profile', async (ctx) => {
  if (!requireLogin(ctx)) return;
  html(ctx, 200, views.profilePage(ctx, { name: ctx.user.name }, {}, await ctx.store.countActiveByUser(ctx.user.id)));
});
route('POST', '/profile', async (ctx) => {
  if (!requireLogin(ctx)) return;
  const name = cleanName(ctx.body.name);
  if (!nameOk(name)) return html(ctx, 400, views.profilePage(ctx, { name }, { name: 'err_name' }, await ctx.store.countActiveByUser(ctx.user.id)));
  await ctx.store.setUserName(ctx.user.id, name);
  flash(ctx, 'ok', 'updated');
  redirect(ctx, '/profile');
});

// The admin gives a user a temporary password (shown once, nothing is stored in clear text).
route('POST', '/admin/u/:id/reset', async (ctx) => {
  if (!requireStaff(ctx, 2)) return;
  if (!(await ctx.store.allow(`reset:${ctx.user.id}`, 30, 3600 * 1000))) return tooMany(ctx);
  const user = await ctx.store.getUser(Number(ctx.params.id));
  if (!user || util.rankOf(ctx.user) <= util.rankOf(user)) return notFound(ctx);
  if (needConfirm(ctx, 'reset', { back: `/admin/u/${user.id}` })) return;
  const pass = wc.randomPassword(10);
  await ctx.store.setUserPassword(user.id, await wc.hashPassword(pass, config.pbkdf2Iterations));
  await audit(ctx, 'user_reset', `${user.name} (#${user.id})`);
  html(ctx, 200, views.adminResetPage(ctx, user, pass), { 'Cache-Control': 'no-store' });
});

// The owner sets any role. A general moderator can only make a member a moderator, or take that role away.
route('POST', '/admin/u/:id/role', async (ctx) => {
  if (!requireStaff(ctx, 2)) return;
  const rank = util.rankOf(ctx.user);
  const user = await ctx.store.getUser(Number(ctx.params.id));
  const allowed = rank >= 3 ? ['user', 'mod', 'super'] : ['user', 'mod'];
  const role = allowed.includes(ctx.body.role) ? ctx.body.role : null;
  if (!user || user.is_admin || !role || user.id === ctx.user.id) return notFound(ctx);
  if (rank < 3 && util.rankOf(user) >= rank) return notFound(ctx);
  await ctx.store.setUserRole(user.id, role);
  await audit(ctx, 'user_role', `${user.name} (#${user.id})`, role);
  flash(ctx, 'ok', 'updated');
  redirect(ctx, `/admin/u/${user.id}`);
});

// Internal note about a member: only staff see it.
// The owner and general moderators can give one account its own ad limit (empty = back to the automatic one).
route('POST', '/admin/u/:id/limit', async (ctx) => {
  if (!requireStaff(ctx, 2)) return;
  const user = await ctx.store.getUser(Number(ctx.params.id));
  if (!user || user.is_admin || !util.canActOn(ctx.user, user) || user.id === ctx.user.id) return notFound(ctx);
  const raw = str(ctx.body.limit, 6).trim();
  const n = raw === '' ? 0 : parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 0 || n > 5000) {
    flash(ctx, 'error', 'err_limit_value');
    return redirect(ctx, `/admin/u/${user.id}`);
  }
  await ctx.store.setAdLimit(user.id, n);
  await audit(ctx, 'user_limit', `${user.name} (#${user.id})`, n ? String(n) : 'auto');
  flash(ctx, 'ok', 'updated');
  redirect(ctx, `/admin/u/${user.id}`);
});

route('POST', '/admin/u/:id/note', async (ctx) => {
  if (!requireStaff(ctx, 1)) return;
  const user = await ctx.store.getUser(Number(ctx.params.id));
  if (!user || !util.canActOn(ctx.user, user)) return notFound(ctx);
  const note = str(ctx.body.note, 300).replace(/\s+/g, ' ').trim();
  await ctx.store.setUserNote(user.id, note);
  await audit(ctx, 'user_note', `${user.name} (#${user.id})`, note);
  flash(ctx, 'ok', 'updated');
  redirect(ctx, `/admin/u/${user.id}`);
});

route('POST', '/admin/u/:id/:action', async (ctx) => {
  if (!requireStaff(ctx, 1)) return;
  const id = Number(ctx.params.id);
  const action = ctx.params.action;
  const user = Number.isInteger(id) ? await ctx.store.getUser(id) : undefined;
  if (!user || id === ctx.user.id) return notFound(ctx);
  const rank = util.rankOf(ctx.user);
  const back = `/admin/u/${user.id}`;
  if (!util.canActOn(ctx.user, user)) return notFound(ctx);

  let reason = '';
  if (action === 'suspend') {
    if (needConfirm(ctx, 'suspend', { back, ask: true })) return;
    await ctx.store.suspendUser(user.id, ctx.user.id);
    reason = reasonOf(ctx);
  } else if (action === 'unsuspend') {
    // A moderator can only undo his own suspension; the rest is for the general moderators and the owner.
    if (rank < 2 && user.suspended !== ctx.user.id) return notFound(ctx);
    await ctx.store.unsuspendUser(user.id);
  } else if (action === 'ban' || action === 'unban') {
    if (rank < 2) return notFound(ctx);
    if (action === 'ban' && needConfirm(ctx, 'ban', { back, ask: true })) return;
    await ctx.store.setUserBanned(user.id, action === 'ban');
    if (action === 'ban') reason = reasonOf(ctx);
  } else if (action === 'verify' || action === 'unverify') {
    if (rank < 2) return notFound(ctx);
    await ctx.store.setVerified(user.id, action === 'verify');
  } else return notFound(ctx);
  await audit(ctx, 'user_' + action, `${user.name} (#${user.id})`, reason ? 'why_' + reason : '');
  flash(ctx, 'ok', 'updated');
  if (reason) {
    return redirect(ctx, `/admin/notify?${new URLSearchParams({ u: user.id, a: action, r: reason, back })}`);
  }
  redirect(ctx, back);
});

// A ready-made WhatsApp message to the member, with the reason, after a hide / suspend / ban.
route('GET', '/admin/notify', async (ctx) => {
  if (!requireStaff(ctx, 1)) return;
  const user = await ctx.store.getUser(Number(ctx.query.u));
  const action = ['hide', 'suspend', 'ban'].includes(ctx.query.a) ? ctx.query.a : '';
  const reason = WHY.includes(ctx.query.r) ? ctx.query.r : 'other';
  if (!user || !action || !util.canActOn(ctx.user, user)) return notFound(ctx);
  const number = /^05\d{8}$/.test(ctx.query.n || '') ? ctx.query.n : '';
  const text = ctx.t('msg_' + action, { name: user.name, reason: ctx.t('why_' + reason), number });
  html(ctx, 200, views.notifyPage(ctx, { user, text, back: safeNext(ctx.query.back || '/admin') }));
});

// Phones that can never register, log in or be used in an ad.
route('POST', '/admin/block', async (ctx) => {
  if (!requireStaff(ctx, 2)) return;
  const nat = util.normPhone(str(ctx.body.phone, 25));
  if (!nat || nat === config.adminNational) {
    flash(ctx, 'error', 'err_phone');
    return redirect(ctx, '/admin?tab=blocked');
  }
  await ctx.store.blockPhone(nat, ctx.user.id);
  await audit(ctx, 'phone_block', util.toLocal(nat));
  flash(ctx, 'ok', 'updated');
  redirect(ctx, '/admin?tab=blocked');
});
route('POST', '/admin/unblock/:phone', async (ctx) => {
  if (!requireStaff(ctx, 2)) return;
  const nat = util.normPhone(ctx.params.phone);
  if (nat) {
    await ctx.store.unblockPhone(nat);
    await audit(ctx, 'phone_unblock', util.toLocal(nat));
  }
  flash(ctx, 'ok', 'updated');
  redirect(ctx, '/admin?tab=blocked');
});

// Spreadsheet files (open in Excel). Cells that start with = + - @ get a quote in front so a formula cannot run.
const csvCell = (v) => {
  let x = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(x)) x = "'" + x;
  return /[",\n\r]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x;
};
const toCsv = (cols, rows) => '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\r\n') + '\r\n';

// A member's own sold numbers, for tracking their results.
route('GET', '/my/sold.csv', async (ctx) => {
  if (!requireLogin(ctx)) return;
  const rows = await ctx.store.exportSold(ctx.user.id);
  send(ctx, 200, 'text/csv; charset=utf-8', toCsv(['number', 'network', 'city', 'price', 'views', 'created_at', 'sold_at'], rows), {
    'Content-Disposition': `attachment; filename="sold-${new Date().toISOString().slice(0, 10)}.csv"`,
    'Cache-Control': 'no-store',
  });
});

route('GET', '/admin/export/:what', async (ctx) => {
  if (!requireStaff(ctx, 2)) return;
  const day = new Date().toISOString().slice(0, 10);
  let body;
  if (ctx.params.what === 'users.csv') {
    const rows = (await ctx.store.exportUsers()).map((u) => ({ ...u, phone: '0' + u.phone }));
    body = toCsv(['id', 'name', 'phone', 'role', 'is_admin', 'verified', 'banned', 'suspended', 'ads', 'created_at'], rows);
  } else if (ctx.params.what === 'numbers.csv') {
    const rows = (await ctx.store.exportListings()).map((l) => ({ ...l, seller_phone: '0' + l.seller_phone }));
    body = toCsv(['id', 'number', 'network', 'city', 'price', 'price_type', 'status', 'views', 'pinned', 'featured', 'seller', 'seller_phone', 'created_at'], rows);
  } else if (ctx.params.what === 'sold.csv') {
    const rows = (await ctx.store.exportSold()).map((l) => ({ ...l, seller_phone: '0' + l.seller_phone }));
    body = toCsv(['number', 'network', 'city', 'price', 'views', 'seller', 'seller_phone', 'created_at', 'sold_at'], rows);
  } else if (ctx.params.what === 'backup.json') {
    if (!requireStaff(ctx, 3)) return;
    await audit(ctx, 'export', 'backup.json');
    return send(ctx, 200, 'application/json; charset=utf-8', JSON.stringify(await ctx.store.exportBackup()), {
      'Content-Disposition': `attachment; filename="backup-${day}.json"`,
      'Cache-Control': 'no-store',
    });
  } else if (ctx.params.what === 'log.csv') {
    if (!requireStaff(ctx, 3)) return;
    const r = await ctx.store.auditSearch({ ...logFilters(ctx), all: true });
    body = toCsv(['when', 'by', 'action', 'target', 'detail'], r.rows.map((x) => ({ when: x.created_at, by: x.actor_name, action: ctx.t('log_' + x.action), target: x.target, detail: /^why_/.test(x.detail) ? ctx.t(x.detail) : x.detail })));
  } else return notFound(ctx);
  await audit(ctx, 'export', ctx.params.what);
  send(ctx, 200, 'text/csv; charset=utf-8', body, {
    'Content-Disposition': `attachment; filename="${ctx.params.what.replace('.csv', '')}-${day}.csv"`,
    'Cache-Control': 'no-store',
  });
});

// ---- Admin: add many numbers at once ----

const NET_WORDS = {
  stc: 'stc', 'اس تي سي': 'stc', 'سوا': 'stc', 'جوي': 'stc', sawa: 'stc', jawy: 'stc', joi: 'stc',
  mobily: 'mobily', 'موبايلي': 'mobily', 'فرندي': 'mobily', friendi: 'mobily',
  zain: 'zain', 'زين': 'zain',
  virgin: 'virgin', 'فيرجن': 'virgin', 'فيرجن موبايل': 'virgin',
  lebara: 'lebara', 'ليبارا': 'lebara',
  salam: 'salam', 'سلام': 'salam',
};
const CITY_WORDS = {};
for (const c of Object.values(CITY_BY_KEY)) {
  CITY_WORDS[c.ar] = c.key;
  CITY_WORDS[c.en.toLowerCase()] = c.key;
}
const wordKey = (text, table) => {
  const w = text.trim().toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ');
  return table[w] || null;
};

// One line = one number. Free order: 0555123456 5000 stc الرياض. A line with only a network or city name
// (like the dividers on other sites) sets the network or city for the lines under it.
function parseImport(text, defNetwork, defCity) {
  const items = [];
  let bad = 0;
  let network = defNetwork;
  let city = defCity;
  for (const raw of String(text).split(/\r?\n/).slice(0, 400)) {
    const line = util.toWestern(raw).trim();
    if (!line) continue;
    const m = line.match(/(?:\+?966[\s-]*|0)?5(?:[\s-]*\d){8}/);
    if (!m) {
      const n = wordKey(line, NET_WORDS);
      const c = wordKey(line, CITY_WORDS);
      if (n) network = n;
      else if (c) city = c;
      else if (/\d{4,}/.test(line)) bad++;
      continue;
    }
    const nat = util.normPhone(m[0].replace(/[\s-]/g, ''));
    if (!nat) {
      bad++;
      continue;
    }
    const rest = (line.slice(0, m.index) + ' ' + line.slice(m.index + m[0].length)).trim();
    const pm = rest.match(/\d[\d,.\u066c]*/);
    let price = null;
    if (pm) {
      price = parsePrice(pm[0].replace(/\./g, ''));
      if (price !== null && price > 10000000) price = null;
    }
    let net = network;
    let cty = city;
    for (const word of rest.replace(/[\d,.\u066c]+/g, ' ').split(/[\s|/\-،:؛]+/)) {
      if (!word) continue;
      if (NET_WORDS[word.toLowerCase()]) net = NET_WORDS[word.toLowerCase()];
      else if (CITY_WORDS[word.toLowerCase()]) cty = CITY_WORDS[word.toLowerCase()];
    }
    items.push({ number: util.toLocal(nat), price, network: net, city: cty });
  }
  return { items, bad };
}

route('GET', '/admin/import', (ctx) => {
  if (!requireAdmin(ctx)) return;
  html(ctx, 200, views.importPage(ctx, {}));
});

route('POST', '/admin/import', async (ctx) => {
  if (!requireAdmin(ctx)) return;
  const network = NETWORK_BY_KEY[ctx.body.network] ? ctx.body.network : 'stc';
  const city = CITY_BY_KEY[ctx.body.city] ? ctx.body.city : 'riyadh';
  const { items, bad } = parseImport(str(ctx.body.lines, 19000), network, city);
  if (!items.length) {
    flash(ctx, 'error', 'import_none');
    return redirect(ctx, '/admin/import');
  }
  const r = await ctx.store.importListings(ctx.user.id, util.toIntl(ctx.user.phone), items);
  await audit(ctx, 'import', `${r.added}`, `${r.skipped}`);
  flash(ctx, 'ok', 'import_done', { added: r.added, skipped: r.skipped, bad });
  redirect(ctx, '/admin?tab=all');
});

// Sync with the store: paste every number available in the store; the rest of the admin's ads are hidden.
route('GET', '/admin/sync', (ctx) => {
  if (!requireAdmin(ctx)) return;
  html(ctx, 200, views.syncPage(ctx));
});

route('POST', '/admin/sync', async (ctx) => {
  if (!requireAdmin(ctx)) return;
  const network = NETWORK_BY_KEY[ctx.body.network] ? ctx.body.network : 'stc';
  const city = CITY_BY_KEY[ctx.body.city] ? ctx.body.city : 'riyadh';
  const { items, bad } = parseImport(str(ctx.body.lines, 19000), network, city);
  if (!items.length) {
    flash(ctx, 'error', 'import_none');
    return redirect(ctx, '/admin/sync');
  }
  const r = await ctx.store.importListings(ctx.user.id, util.toIntl(ctx.user.phone), items, { penalty: true, skipHidden: true });
  await audit(ctx, 'import', `${r.added}`, `${r.skipped}`);
  flash(ctx, 'ok', 'import_done', { added: r.added, skipped: r.skipped, bad });
  redirect(ctx, '/admin?tab=all');
});

// The look of the number plates: the admin picks one of three and every page follows.
route('GET', '/admin/design', async (ctx) => {
  if (!requireAdmin(ctx)) return;
  html(ctx, 200, views.designPage(ctx));
});
route('POST', '/admin/design', async (ctx) => {
  if (!requireAdmin(ctx)) return;
  const v = str(ctx.body.style, 12);
  if (!(await ctx.store.setPlateStyle(v))) return redirect(ctx, '/admin/design');
  await audit(ctx, 'design', v, '');
  flash(ctx, 'ok', 'design_done');
  redirect(ctx, '/admin/design');
});

// ---- Static pages and SEO files ----


route('GET', '/robots.txt', (ctx) => {
  send(
    ctx,
    200,
    'text/plain; charset=utf-8',
    `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /my\nDisallow: /password\nDisallow: /post\nDisallow: /login\nDisallow: /register\nDisallow: /lang/\nDisallow: /theme/\nDisallow: /ack\nDisallow: /webhook/\n\nSitemap: ${ctx.base}/sitemap.xml\n`,
    { 'Cache-Control': 'public, max-age=3600' }
  );
});

route('GET', '/sitemap.xml', async (ctx) => {
  await ctx.store.maintenance();
  const urls = [{ loc: `${ctx.base}/` }];
  const counts = await ctx.store.landingCounts();
  for (const k of Object.keys(NETWORK_BY_KEY)) if (counts.network[k]) urls.push({ loc: `${ctx.base}/network/${k}` });
  for (const k of Object.keys(CITY_BY_KEY)) if (counts.city[k]) urls.push({ loc: `${ctx.base}/city/${k}` });
  for (const n of Object.keys(NETWORK_BY_KEY)) for (const c of Object.keys(CITY_BY_KEY)) if (c !== 'other' && counts.combo[`${n}/${c}`]) urls.push({ loc: `${ctx.base}/network/${n}/${c}` });
  // Only type pages that have ads: an empty one is marked noindex, and Google complains about noindex pages in a sitemap.
  for (const k of PATTERN_KEYS) {
    const r = await ctx.store.searchListings({ pattern: k, sort: 'new', limit: 1, offset: 0 });
    if (r.total > 0) urls.push({ loc: `${ctx.base}/type/${k}` });
  }
  for (const n of UNDER_PRICES) if (counts.under[n]) urls.push({ loc: `${ctx.base}/under/${n}` });
  for (const p of ['/new', '/faq', '/articles', '/about', '/contact']) urls.push({ loc: ctx.base + p });
  for (const a of content.ARTICLES) urls.push({ loc: `${ctx.base}/articles/${a.slug}`, lastmod: a.date });
  for (const l of await ctx.store.sitemapListings()) {
    urls.push({ loc: `${ctx.base}/n/${l.id}`, lastmod: String(l.created_at).slice(0, 10) });
  }
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls
      .map((u) => `  <url><loc>${util.esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`)
      .join('\n') +
    '\n</urlset>\n';
  send(ctx, 200, 'application/xml; charset=utf-8', xml, { 'Cache-Control': 'public, max-age=3600' });
});

route('GET', '/healthz', async (ctx) => {
  await ctx.store.ready(); // also proves the database answers
  send(ctx, 200, 'text/plain; charset=utf-8', 'ok', { 'Cache-Control': 'no-store' });
});

// ---- Main handler ----------------------------------------------------------

function toResponse(request, out, setCookie, secure, extraCookies = [], gtmNonce = '') {
  const headers = new Headers({ ...securityHeaders(secure, gtmNonce), ...out.headers });
  if (setCookie) headers.append('Set-Cookie', setCookie);
  for (const c of extraCookies) headers.append('Set-Cookie', c);
  const noBody = request.method === 'HEAD' || out.status === 204 || out.status === 304;
  return new Response(noBody ? null : out.body, { status: out.status, headers });
}

async function fail(request, url, status) {
  const ctx = makeCtx(request, url, { lang: 'ar', csrf: '', ip: '', flash: undefined, session: {} });
  html(ctx, status, views.errorPage(ctx, status));
  return toResponse(request, ctx.out, '', ctx.secure);
}

// store: the database (see store.js). ip: the visitor's address, worked out by the caller.
async function handle(request, { store, ip, waitUntil }) {
  const url = new URL(request.url);
  const method = request.method;
  const wanted = method === 'HEAD' ? 'GET' : method;

  if (method === 'POST' && url.pathname === '/webhook/salla') {
    try {
      await store.ready();
      return await require('./salla').handleWebhook(request, store, config.sallaSecret);
    } catch (err) {
      console.error(err);
      return new Response('error', { status: 500 });
    }
  }

  try {
    const ctx = await buildContext(request, url, ip, store, waitUntil);

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
    if (!matched) notFound(ctx);
    else {
      let rejected = false;
      if (wanted === 'POST') {
        const type = String(request.headers.get('content-type') || '');
        if (!type.startsWith('application/x-www-form-urlencoded')) {
          return new Response(null, { status: 415, headers: securityHeaders(ctx.secure) });
        }
        if (Number(request.headers.get('content-length') || 0) > MAX_BODY) {
          return new Response(null, { status: 413, headers: securityHeaders(ctx.secure) });
        }
        const text = await request.text();
        if (text.length > MAX_BODY) return new Response(null, { status: 413, headers: securityHeaders(ctx.secure) });
        ctx.body = Object.fromEntries(new URLSearchParams(text));
        if (!csrfOk(ctx)) {
          flash(ctx, 'error', 'err_csrf');
          redirect(ctx, '/');
          rejected = true;
        }
      }
      if (!rejected) await matched.handler(ctx);
    }

    const cookie = ctx.dirty ? await sessionCookie(ctx) : '';
    return toResponse(request, ctx.out, cookie, ctx.secure, ctx.extraCookies, ctx.gtmNonce);
  } catch (err) {
    console.error(err);
    try {
      return await fail(request, url, 500);
    } catch {
      return new Response('Server error', { status: 500, headers: { 'Content-Type': 'text/plain' } });
    }
  }
}

// Called by the scheduled job: a WhatsApp summary once a full week has passed.
async function weekly(store) {
  if (!notifier.enabled()) return false;
  const s = await store.weeklyReportText();
  if (!s) return false;
  return notifier.send(ar('wa_weekly', { users: s.users7, ads: s.ads7, views: s.views7, active: s.active, total: s.users }));
}

module.exports = { handle, weekly };
