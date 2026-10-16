'use strict';

// Numbers Market: the whole site, written against the standard Request / Response objects,
// so the same code runs on Node (server.js) and on Cloudflare Workers (worker.mjs).

const config = require('./config');
const views = require('./views');
const { t } = require('./i18n');
const util = require('./util');
const wc = require('./webcrypto');
const { sendMail, mailEnabled } = require('./mailer');
const { NETWORK_BY_KEY, CITY_BY_KEY, PATTERN_KEYS, REPORT_REASONS } = require('./data');

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

function securityHeaders(secure) {
  const h = {
    'Content-Security-Policy':
      "default-src 'self'; script-src 'none'; style-src 'self' https://fonts.googleapis.com; " +
      "font-src https://fonts.gstatic.com; img-src 'self' data:; form-action 'self'; " +
      "base-uri 'none'; frame-ancestors 'none'; object-src 'none'",
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
    ...extra,
  };
  ctx.t = (key, vars) => t(ctx.lang, key, vars);
  return ctx;
}

async function buildContext(request, url, ip, store) {
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
  if (user && user.banned) user = undefined;
  if (session.uid && !user) {
    delete session.uid;
    dirty = true;
  }

  const ctx = makeCtx(request, url, {
    store,
    secret,
    session,
    dirty,
    user: user || undefined,
    lang: session.lang,
    csrf: session.csrf,
    ip,
  });

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

function requireAdmin(ctx) {
  if (ctx.user && ctx.user.is_admin) return true;
  notFound(ctx);
  return false;
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

function normEmail(raw) {
  const e = String(raw || '').trim().toLowerCase();
  return e.length <= 120 && /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(e) ? e : null;
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

route('GET', '/', async (ctx) => {
  const f = parseFilters(ctx.query);
  const size = config.pageSize;
  let { total, rows } = await ctx.store.searchListings({ ...f, limit: size, offset: (f.page - 1) * size });
  const pages = Math.max(1, Math.ceil(total / size));
  let page = f.page;
  if (page > pages) {
    page = pages;
    ({ rows } = await ctx.store.searchListings({ ...f, limit: size, offset: (page - 1) * size }));
  }
  const anyFilter = !!(f.q || f.starts || f.ends || f.min != null || f.max != null || f.network || f.city || f.pattern);
  html(ctx, 200, views.homePage(ctx, { filters: f, rows, total, page, pages, siteEmpty: total === 0 && !anyFilter }));
});

route('GET', '/n/:id', async (ctx) => {
  const id = Number(ctx.params.id);
  const l = Number.isInteger(id) ? await ctx.store.getListing(id) : undefined;
  if (!l) return notFound(ctx);
  const canManage = !!ctx.user && (ctx.user.id === l.user_id || !!ctx.user.is_admin);
  const publicVisible = (l.status === 'active' || l.status === 'sold') && !l.seller_banned;
  if (!publicVisible && !canManage) return notFound(ctx);

  if (l.status === 'active' && !(ctx.user && ctx.user.id === l.user_id)) {
    const seen = Array.isArray(ctx.session.seen) ? ctx.session.seen : [];
    if (!seen.includes(l.id)) {
      await ctx.store.bumpViews(l.id);
      l.views += 1;
      ctx.session.seen = [...seen, l.id].slice(-20);
      ctx.dirty = true;
    }
  }
  html(ctx, 200, views.listingPage(ctx, l, { canManage }));
});

route('POST', '/n/:id/report', async (ctx) => {
  if (!(await ctx.store.allow(`report:${ctx.ip}`, 20, 3600 * 1000))) return tooMany(ctx);
  const id = Number(ctx.params.id);
  const l = Number.isInteger(id) ? await ctx.store.getListing(id) : undefined;
  if (!l || l.status !== 'active') return notFound(ctx);
  const reason = REPORT_REASONS.includes(ctx.body.reason) ? ctx.body.reason : 'other';
  if (!(ctx.user && ctx.user.id === l.user_id)) {
    const key = ctx.user ? `u${ctx.user.id}` : 'ip' + (await wc.sha256Hex(ctx.ip + ctx.secret)).slice(0, 16);
    const count = await ctx.store.addReport(l.id, key, reason);
    if (count >= config.reportHideAt) await ctx.store.setListingStatus(l.id, 'hidden');
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
  };
  const errors = {};
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
  return { v, errors, price, contact };
}


route('GET', '/post', (ctx) => {
  if (!requireLogin(ctx)) return;
  html(ctx, 200, views.postPage(ctx));
});

route('POST', '/post', async (ctx) => {
  if (!requireLogin(ctx)) return;
  if (!(await ctx.store.allow(`post:${ctx.ip}`, 30, 3600 * 1000))) return tooMany(ctx);

  const { v, errors, price, contact } = readAdFields(ctx);
  v.number = str(ctx.body.number, 25).trim();

  const nat = util.normPhone(v.number);
  if (!nat) errors.number = 'err_number';

  if (nat && !errors.number) {
    const number = util.toLocal(nat);
    if ((await ctx.store.countActiveByUser(ctx.user.id)) >= config.maxActiveAdsPerUser) {
      errors.number = { key: 'err_limit', vars: { n: config.maxActiveAdsPerUser } };
    } else if (await ctx.store.numberIsListed(number)) {
      errors.number = 'err_dup';
    }
  }

  // At most N new numbers per advertiser in any 24 hours. Deleted ads still count, so delete-and-repost does not get around it.
  if (!Object.keys(errors).length && !(await ctx.store.allow(`ads-day:${ctx.user.id}`, config.maxAdsPerDay, 24 * 3600 * 1000))) {
    errors.number = { key: 'err_daily', vars: { n: config.maxAdsPerDay } };
  }

  if (Object.keys(errors).length) return html(ctx, 400, views.postPage(ctx, v, errors));

  const status = config.requireApproval && !ctx.user.is_admin ? 'pending' : 'active';
  const id = await ctx.store.insertListing({
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

// ---- Edit an ad (owner only) ----

async function ownListing(ctx) {
  const id = Number(ctx.params.id);
  const l = Number.isInteger(id) ? await ctx.store.getListing(id) : undefined;
  return l && l.user_id === ctx.user.id ? l : null;
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
  };
  html(ctx, 200, views.editPage(ctx, l, v));
});

route('POST', '/n/:id/edit', async (ctx) => {
  if (!requireLogin(ctx)) return;
  if (!(await ctx.store.allow(`edit:${ctx.ip}`, 60, 3600 * 1000))) return tooMany(ctx);
  const l = await ownListing(ctx);
  if (!l) return notFound(ctx);

  const { v, errors, price, contact } = readAdFields(ctx);
  if (Object.keys(errors).length) return html(ctx, 400, views.editPage(ctx, l, v, errors));

  // With approval mode on, a changed live ad goes back to review so contact details cannot be swapped after approval.
  const status = config.requireApproval && !ctx.user.is_admin && l.status === 'active' ? 'pending' : l.status;
  await ctx.store.updateListing({
    id: l.id,
    userId: ctx.user.id,
    network: v.network,
    city: v.city,
    price,
    contact,
    description: v.description,
    status,
  });
  flash(ctx, 'ok', status === 'pending' ? 'pending_notice' : 'updated');
  redirect(ctx, `/n/${l.id}`);
});

// ---- Accounts ----

route('GET', '/register', (ctx) => {
  if (ctx.user) return redirect(ctx, '/');
  html(ctx, 200, views.registerPage(ctx));
});

route('POST', '/register', async (ctx) => {
  if (!(await ctx.store.allow(`register:${ctx.ip}`, config.registerPerHour, 3600 * 1000))) return tooMany(ctx);
  const name = str(ctx.body.name, 80).replace(/\s+/g, ' ').trim();
  const phoneRaw = str(ctx.body.phone, 25).trim();
  const password = str(ctx.body.password, 200);
  const emailRaw = str(ctx.body.email, 150).trim();
  const email = normEmail(emailRaw);
  const v = { name, phone: phoneRaw, email: emailRaw };
  const errors = {};

  if (name.length < 2 || name.length > 60) errors.name = 'err_name';
  if (!email) errors.email = 'err_email';
  else if (await ctx.store.getUserByEmail(email)) errors.email = 'err_email_taken';
  const nat = util.normPhone(phoneRaw);
  if (!nat) errors.phone = 'err_phone';
  else if (await ctx.store.getUserByPhone(nat)) errors.phone = 'err_phone_taken';
  if (password.length < 8) errors.password = 'err_pass';
  if (Object.keys(errors).length) return html(ctx, 400, views.registerPage(ctx, v, errors));

  const passHash = await wc.hashPassword(password, config.pbkdf2Iterations);
  let id;
  try {
    id = await ctx.store.createUser(nat, name, passHash, email);
  } catch {
    // Someone registered the same phone or email at the same moment.
    const taken = (await ctx.store.getUserByEmail(email)) ? { email: 'err_email_taken' } : { phone: 'err_phone_taken' };
    return html(ctx, 400, views.registerPage(ctx, v, taken));
  }
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
  const idRaw = str(ctx.body.phone, 150).trim();
  const password = str(ctx.body.password, 200);
  // People can log in with the mobile number or the email.
  const email = idRaw.includes('@') ? normEmail(idRaw) : null;
  const nat = email ? null : util.normPhone(idRaw);
  const who = email || nat;
  // Limits are per visitor (IP), and per account from that same IP, so a stranger cannot lock someone else out.
  if (!(await ctx.store.allow(`login:${ctx.ip}`, 20, 15 * 60 * 1000))) return tooMany(ctx);
  if (who && !(await ctx.store.allow(`login-phone:${who}:${ctx.ip}`, 10, 15 * 60 * 1000))) return tooMany(ctx);

  const user = email ? await ctx.store.getUserByEmail(email) : nat ? await ctx.store.getUserByPhone(nat) : undefined;
  const ok = await wc.verifyPassword(password, user ? user.pass_hash : dummyHash(), config.pbkdf2Iterations);
  if (!user || !ok) return html(ctx, 401, views.loginPage(ctx, { phone: idRaw }, { form: 'err_login' }));
  if (user.banned) return html(ctx, 403, views.loginPage(ctx, { phone: idRaw }, { form: 'err_banned' }));

  logIn(ctx, user.id);
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

// ---- Forgot password (by email) ----

route('GET', '/forgot', (ctx) => {
  if (ctx.user) return redirect(ctx, '/password');
  html(ctx, 200, views.forgotPage(ctx));
});

route('POST', '/forgot', async (ctx) => {
  if (!mailEnabled()) return html(ctx, 200, views.forgotPage(ctx));
  if (!(await ctx.store.allow(`forgot:${ctx.ip}`, 5, 3600 * 1000))) return tooMany(ctx);
  const email = normEmail(str(ctx.body.email, 150));
  // The answer is always the same, so nobody can use this form to find out who has an account.
  if (email && (await ctx.store.allow(`forgot-email:${email}`, 3, 3600 * 1000))) {
    const user = await ctx.store.getUserByEmail(email);
    if (user && !user.banned) {
      const token = wc.randomToken(32);
      await ctx.store.createResetToken(user.id, await wc.sha256Hex(token), Date.now() + 3600 * 1000);
      await sendMail({
        to: email,
        subject: t(ctx.lang, 'mail_subject'),
        text: t(ctx.lang, 'mail_body', { name: user.name, link: `${ctx.base}/reset/${token}` }),
      });
    }
  }
  html(ctx, 200, views.forgotPage(ctx, { sent: true }));
});

async function resetUser(ctx) {
  return ctx.store.findResetToken(await wc.sha256Hex(String(ctx.params.token)));
}

route('GET', '/reset/:token', async (ctx) => {
  const user = await resetUser(ctx);
  html(ctx, user ? 200 : 400, views.resetPage(ctx, ctx.params.token, { bad: !user }));
});

route('POST', '/reset/:token', async (ctx) => {
  if (!(await ctx.store.allow(`reset-try:${ctx.ip}`, 20, 3600 * 1000))) return tooMany(ctx);
  const user = await resetUser(ctx);
  if (!user || user.banned) return html(ctx, 400, views.resetPage(ctx, ctx.params.token, { bad: true }));
  const password = str(ctx.body.password, 200);
  if (password.length < 8) return html(ctx, 400, views.resetPage(ctx, ctx.params.token, { errors: { password: 'err_pass' } }));
  await ctx.store.setUserPassword(user.id, await wc.hashPassword(password, config.pbkdf2Iterations));
  await ctx.store.deleteResetTokens(user.id);
  flash(ctx, 'ok', 'pw_changed');
  redirect(ctx, '/login');
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

route('POST', '/my/:id/sold', async (ctx) => {
  if (!requireLogin(ctx)) return;
  await ctx.store.setOwnListingStatus(Number(ctx.params.id), ctx.user.id, 'sold');
  flash(ctx, 'ok', 'updated');
  redirect(ctx, ctx.body.next ? safeNext(ctx.body.next) : '/my');
});

route('POST', '/my/:id/delete', async (ctx) => {
  if (!requireLogin(ctx)) return;
  await ctx.store.deleteOwnListing(Number(ctx.params.id), ctx.user.id);
  flash(ctx, 'ok', 'deleted');
  redirect(ctx, ctx.body.next ? safeNext(ctx.body.next) : '/my');
});

// ---- Admin ----

const ADMIN_TABS = ['stats', 'pending', 'reported', 'all', 'users'];

route('GET', '/admin', async (ctx) => {
  if (!requireAdmin(ctx)) return;
  const tab = ADMIN_TABS.includes(ctx.query.tab) ? ctx.query.tab : 'stats';
  const data = {};
  if (tab === 'stats') data.stats = await ctx.store.adminStats();
  else if (tab === 'users') data.users = await ctx.store.adminUsers();
  else data.listings = await ctx.store.adminListings(tab);
  html(ctx, 200, views.adminPage(ctx, tab, data));
});

route('POST', '/admin/l/:id/:action', async (ctx) => {
  if (!requireAdmin(ctx)) return;
  const id = Number(ctx.params.id);
  const action = ctx.params.action;
  if (!(await ctx.store.getListing(id))) return notFound(ctx);
  if (action === 'approve') await ctx.store.setListingStatus(id, 'active');
  else if (action === 'hide') await ctx.store.setListingStatus(id, 'hidden');
  else if (action === 'restore') {
    await ctx.store.setListingStatus(id, 'active');
    await ctx.store.clearReports(id);
  } else if (action === 'delete') await ctx.store.deleteListing(id);
  else return notFound(ctx);
  const tab = ADMIN_TABS.includes(ctx.body.tab) ? ctx.body.tab : 'pending';
  flash(ctx, 'ok', 'updated');
  redirect(ctx, `/admin?tab=${tab}`);
});

// The admin gives a user a temporary password (shown once, nothing is stored in clear text).
route('POST', '/admin/u/:id/reset', async (ctx) => {
  if (!requireAdmin(ctx)) return;
  if (!(await ctx.store.allow(`reset:${ctx.user.id}`, 30, 3600 * 1000))) return tooMany(ctx);
  const user = await ctx.store.getUser(Number(ctx.params.id));
  if (!user || user.is_admin) return notFound(ctx);
  const pass = wc.randomPassword(10);
  await ctx.store.setUserPassword(user.id, await wc.hashPassword(pass, config.pbkdf2Iterations));
  html(ctx, 200, views.adminResetPage(ctx, user, pass), { 'Cache-Control': 'no-store' });
});

route('POST', '/admin/u/:id/:action', async (ctx) => {
  if (!requireAdmin(ctx)) return;
  const id = Number(ctx.params.id);
  const action = ctx.params.action;
  if (!['ban', 'unban'].includes(action) || !(await ctx.store.getUser(id))) return notFound(ctx);
  await ctx.store.setUserBanned(id, action === 'ban');
  flash(ctx, 'ok', 'updated');
  redirect(ctx, '/admin?tab=users');
});

// ---- Static pages and SEO files ----

route('GET', '/safety', (ctx) => html(ctx, 200, views.safetyPage(ctx)));

route('GET', '/robots.txt', (ctx) => {
  send(
    ctx,
    200,
    'text/plain; charset=utf-8',
    `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /my\nDisallow: /post\nDisallow: /login\nDisallow: /register\nDisallow: /lang/\n\nSitemap: ${ctx.base}/sitemap.xml\n`,
    { 'Cache-Control': 'public, max-age=3600' }
  );
});

route('GET', '/sitemap.xml', async (ctx) => {
  const urls = [`${ctx.base}/`, `${ctx.base}/safety`];
  for (const l of await ctx.store.sitemapListings()) urls.push(`${ctx.base}/n/${l.id}`);
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((u) => `  <url><loc>${util.esc(u)}</loc></url>`).join('\n') +
    '\n</urlset>\n';
  send(ctx, 200, 'application/xml; charset=utf-8', xml, { 'Cache-Control': 'public, max-age=3600' });
});

route('GET', '/healthz', async (ctx) => {
  await ctx.store.ready(); // also proves the database answers
  send(ctx, 200, 'text/plain; charset=utf-8', 'ok', { 'Cache-Control': 'no-store' });
});

// ---- Main handler ----------------------------------------------------------

function toResponse(request, out, setCookie, secure) {
  const headers = new Headers({ ...securityHeaders(secure), ...out.headers });
  if (setCookie) headers.append('Set-Cookie', setCookie);
  const noBody = request.method === 'HEAD' || out.status === 204 || out.status === 304;
  return new Response(noBody ? null : out.body, { status: out.status, headers });
}

async function fail(request, url, status) {
  const ctx = makeCtx(request, url, { lang: 'ar', csrf: '', ip: '', flash: undefined, session: {} });
  html(ctx, status, views.errorPage(ctx, status));
  return toResponse(request, ctx.out, '', ctx.secure);
}

// store: the database (see store.js). ip: the visitor's address, worked out by the caller.
async function handle(request, { store, ip }) {
  const url = new URL(request.url);
  const method = request.method;
  const wanted = method === 'HEAD' ? 'GET' : method;

  try {
    const ctx = await buildContext(request, url, ip, store);

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
    return toResponse(request, ctx.out, cookie, ctx.secure);
  } catch (err) {
    console.error(err);
    try {
      return await fail(request, url, 500);
    } catch {
      return new Response('Server error', { status: 500, headers: { 'Content-Type': 'text/plain' } });
    }
  }
}

module.exports = { handle };
