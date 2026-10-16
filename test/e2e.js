'use strict';

// End-to-end checks: starts the server on a temporary database and drives it over HTTP.
// Run with:  npm test

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log('  ok   ' + name);
  else {
    failures++;
    console.log('  FAIL ' + name + (extra !== undefined ? '\n         ' + String(extra).slice(0, 300) : ''));
  }
}

async function startServer(port, env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nm-test-'));
  const child = spawn(
    process.execPath,
    ['--disable-warning=ExperimentalWarning', path.join(__dirname, process.env.TARGET === 'worker' ? 'worker-sim.js' : '../server.js')],
    {
      env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dir, ADMIN_PHONE: '0500000001', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  let log = '';
  child.stderr.on('data', (d) => (log += d));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start: ' + log)), 8000);
    child.stdout.on('data', (d) => {
      if (String(d).includes('running')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on('exit', () => reject(new Error('server exited: ' + log)));
  });
  return {
    base: `http://127.0.0.1:${port}`,
    stop() {
      child.kill('SIGTERM');
      fs.rmSync(dir, { recursive: true, force: true });
    },
    log: () => log,
  };
}

class HttpClient {
  constructor(base) {
    this.base = base;
    this.jar = {};
    this.auth = false;
  }
  async req(method, p, form) {
    const headers = {};
    const cookie = Object.entries(this.jar)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
    if (cookie) headers.cookie = cookie;
    let body;
    if (form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(form).toString();
    }
    const res = await fetch(this.base + p, { method, headers, body, redirect: 'manual' });
    for (const sc of res.headers.getSetCookie()) {
      const [pair] = sc.split(';');
      const i = pair.indexOf('=');
      this.jar[pair.slice(0, i)] = pair.slice(i + 1);
    }
    const text = await res.text();
    return { status: res.status, headers: res.headers, text, location: res.headers.get('location') };
  }
  get(p) {
    return this.req('GET', p);
  }
  async csrf() {
    const r = await this.get(this.auth ? '/post' : '/login');
    const m = /name="_csrf" value="([^"]+)"/.exec(r.text);
    return m && m[1];
  }
  async post(p, form = {}) {
    const _csrf = await this.csrf();
    return this.req('POST', p, { _csrf, ...form });
  }
}

async function newClient(base) {
  const c = new HttpClient(base);
  await c.req('GET', '/lang/en?next=/');
  return c;
}

async function register(c, name, phone, password = 'secret-pass-1') {
  const _csrf = await (async () => {
    const r = await c.get('/register');
    return /name="_csrf" value="([^"]+)"/.exec(r.text)[1];
  })();
  const r = await c.req('POST', '/register', { _csrf, name, phone, password });
  if (r.status === 303) c.auth = true;
  return r;
}

const AD = { number: '0555777888', network: 'stc', city: 'riyadh', price: '15,000', contact: '', description: 'Gold number' };

async function main() {
  const port = 3100 + Math.floor(Math.random() * 500);
  const srv = await startServer(port);
  const base = srv.base;

  try {
    console.log('\nPages and language');
    const anon = new HttpClient(base); // a brand-new visitor: no language chosen yet
    let r = await anon.get('/');
    check('home loads', r.status === 200);
    check('default language is Arabic and RTL', r.text.includes('dir="rtl"') && r.text.includes('سوق الأرقام'));
    check('empty site message shown', r.text.includes('ما فيه إعلانات للحين'));
    check('CSP header set', (r.headers.get('content-security-policy') || '').includes("script-src 'none'"));
    check('no external scripts in page', !/<script/i.test(r.text));
    r = await anon.get('/lang/en?next=/');
    check('language switch redirects', r.status === 302 && r.location === '/');
    r = await anon.get('/');
    check('English page is LTR', r.text.includes('dir="ltr"') && r.text.includes('Numbers Market'));
    r = await anon.get('/lang/en?next=//evil.example');
    check('open redirect blocked', r.location === '/');
    check('404 page', (await anon.get('/nope')).status === 404);
    check('healthz', (await anon.get('/healthz')).text === 'ok');
    const css = await anon.get('/style.css');
    check('stylesheet served', css.status === 200 && (css.headers.get('content-type') || '').includes('text/css'));
    check('path traversal blocked', (await anon.get('/..%2f..%2fserver.js')).status === 404);
    check('/post asks anonymous users to log in', (await anon.get('/post')).location === '/login');

    console.log('\nAccounts');
    const a = await newClient(base);
    r = await register(a, 'Ahmed', '0555000111', 'short');
    check('short password rejected', r.status === 400 && r.text.includes('Use at least 8 characters'));
    r = await register(a, 'Ahmed', '12345', 'secret-pass-1');
    check('bad phone rejected', r.status === 400 && r.text.includes('Enter a Saudi mobile number'));
    r = await register(a, 'Ahmed', '0555000111');
    check('register works and goes to post page', r.status === 303 && r.location === '/post', r.status);
    r = await a.get('/post');
    check('post page opens after register', r.status === 200 && r.text.includes('Post an ad'));
    const dupAcc = await register(await newClient(base), 'Other', '+966 55 500 0111');
    check('same phone in other format is a duplicate', dupAcc.status === 400 && dupAcc.text.includes('already has an account'));

    console.log('\nPosting and searching');
    r = await a.post('/post', { ...AD, number: '123' });
    check('invalid number rejected', r.status === 400 && r.text.includes('Enter a Saudi mobile number'));
    r = await a.post('/post', { ...AD, network: '' });
    check('missing network rejected', r.status === 400 && r.text.includes('Choose a network'));
    r = await a.post('/post', { ...AD, price: '99999999999' });
    check('absurd price rejected', r.status === 400);
    r = await a.post('/post', { ...AD, description: 'x'.repeat(301) });
    check('long description rejected', r.status === 400);
    r = await a.post('/post', AD);
    check('ad published', r.status === 303 && r.location === '/n/1', r.status + ' ' + r.location);
    r = await a.get('/n/1');
    check('flash shown once', r.text.includes('Your ad is live'));
    check('digits highlighted', r.text.includes('class="hit"'));
    check('shows price', r.text.includes('15,000'));
    r = await a.get('/n/1');
    check('flash gone on reload', !r.text.includes('Your ad is live'));
    r = await a.post('/post', AD);
    check('duplicate number rejected', r.status === 400 && r.text.includes('already has an active ad'));
    r = await a.post('/post', { ...AD, number: '966 55 500 9999 ', description: '<script>alert(1)</script>', price: '' });
    check('second ad with other number format and no price', r.status === 303 && r.location === '/n/2');
    r = await anon.get('/n/2');
    check('script in description is escaped', !r.text.includes('<script>alert') && r.text.includes('&lt;script&gt;'));
    check('"ask for price" shown', r.text.includes('Ask for price'));
    check('WhatsApp link uses account number', r.text.includes('https://wa.me/966555000111'));

    const search = async (q) => (await anon.get('/?' + q)).text;
    check('search by digits finds ad', (await search('q=777')).includes('/n/1'));
    check('search with Arabic digits', (await search('q=' + encodeURIComponent('٧٧٧'))).includes('/n/1'));
    check('search with no match', (await search('q=000')).includes('No numbers match'));
    check('triple pattern', (await search('pattern=triple')).includes('/n/1'));
    check('quad pattern excludes', !(await search('pattern=quad')).includes('/n/1'));
    check('ends with', (await search('ends=888')).includes('/n/1'));
    check('starts with, typed without leading zero', (await search('starts=555')).includes('/n/1'));
    check('network filter', !(await search('network=zain')).includes('/n/1'));
    check('city filter', (await search('city=riyadh')).includes('/n/1'));
    check('min price filter excludes', !(await search('min=20000')).includes('/n/1'));
    check('max price filter includes', (await search('max=20000')).includes('/n/1'));
    check('price sort puts priced ads first', (await search('sort=price_asc')).indexOf('/n/1') < (await search('sort=price_asc')).indexOf('/n/2'));
    check('junk filters do not crash', (await anon.get('/?min=abc&page=-4&sort=zz&pattern=x&network=%00')).status === 200);

    console.log('\nSecurity');
    r = await a.req('POST', '/post', { ...AD, number: '0555111222' });
    check('POST without CSRF token is refused', r.status === 303 && r.location === '/');
    r = await a.get('/n/3');
    check('refused post created nothing', r.status === 404);
    r = await anon.req('POST', '/logout', {});
    check('logout without token refused', r.status === 303);
    const bad = await newClient(base);
    for (let i = 0; i < 10; i++) r = await bad.post('/login', { phone: '0555000998', password: 'wrong-' + i });
    r = await bad.post('/login', { phone: '0555000998', password: 'wrong-final' });
    check('login attempts are rate limited', r.status === 429, r.status);

    console.log('\nLogin and logout');
    const a2 = await newClient(base);
    r = await a2.post('/login', { phone: '0555000999', password: 'whatever-1' });
    check('unknown phone gives the same error', r.status === 401 && r.text.includes('Phone number or password is wrong'));
    r = await a2.post('/login', { phone: '0555000111', password: 'secret-pass-1' });
    check('login works', r.status === 303);
    a2.auth = true;
    r = await a2.get('/my');
    check('my ads lists both ads', r.status === 200 && r.text.includes('/n/1') && r.text.includes('/n/2'));
    r = await a2.post('/logout');
    a2.auth = false;
    r = await a2.get('/my');
    check('logout works', r.location === '/login');

    console.log('\nReports');
    const b = await newClient(base);
    const c = await newClient(base);
    const d = await newClient(base);
    await register(b, 'Bader', '0555000222');
    await register(c, 'Cala', '0555000333');
    await register(d, 'Dana', '0555000444');
    r = await anon.post('/n/1/report', { reason: 'scam' });
    check('anonymous report accepted', r.status === 303);
    r = await anon.post('/n/1/report', { reason: 'scam' });
    check('same visitor cannot report twice', (await a.get('/n/1')).status === 200);
    await b.post('/n/1/report', { reason: 'scam' });
    check('ad still live after 2 reports', (await anon.get('/n/1')).status === 200);
    await c.post('/n/1/report', { reason: 'spam' });
    check('ad hidden after 3 different reporters', (await anon.get('/n/1')).status === 404);
    r = await a.get('/n/1');
    check('owner can still see hidden ad', r.status === 200 && r.text.includes('Only you and the site admin'));
    check('hidden ad missing from search', !(await search('q=777')).includes('/n/1'));
    await d.post('/n/2/report', { reason: 'other' });
    r = await a.post('/n/2/report', { reason: 'scam' });
    check('seller reporting own ad is ignored', (await anon.get('/n/2')).status === 200);

    console.log('\nAdmin');
    check('non-admin cannot open admin', (await b.get('/admin')).status === 404);
    const admin = await newClient(base);
    r = await register(admin, 'Owner', '0500000001');
    check('admin registers', r.status === 303);
    r = await admin.get('/admin?tab=reported');
    check('admin sees reported ad', r.status === 200 && r.text.includes('0555 777 888'));
    r = await admin.post('/admin/l/1/restore', { tab: 'reported' });
    check('admin restores ad', r.status === 303 && (await anon.get('/n/1')).status === 200);
    r = await admin.get('/admin?tab=users');
    check('admin sees users', r.text.includes('Ahmed') && r.text.includes('0555000111'));
    r = await admin.post('/admin/u/1/ban', { tab: 'users' });
    const bannedClient = await newClient(base);
    const banned = await bannedClient.post('/login', { phone: '0555000111', password: 'secret-pass-1' });
    check('banned user cannot log in and ads are hidden', banned.status === 403 && (await anon.get('/n/1')).status === 404);
    await admin.post('/admin/u/1/unban', { tab: 'users' });
    r = await admin.post('/admin/l/2/delete', { tab: 'all' });
    check('admin deletes ad', (await anon.get('/n/2')).status === 404);

    console.log('\nMy ads actions');
    const a3 = await newClient(base);
    await a3.post('/login', { phone: '0555000111', password: 'secret-pass-1' });
    a3.auth = true;
    await a3.post('/my/1/sold');
    r = await anon.get('/n/1');
    check('sold ad shows sold notice and no WhatsApp button', r.text.includes('This number is sold') && !r.text.includes('wa.me'));
    r = await a3.post('/my/1/delete');
    check('owner deletes ad', (await anon.get('/n/1')).status === 404);
    r = await b.post('/my/1/delete');
    check('deleting a missing ad is harmless', r.status === 303);

    console.log('\nSEO files');
    await a3.post('/post', { ...AD, number: '0599123456' });
    r = await anon.get('/sitemap.xml');
    check('sitemap lists ads', r.status === 200 && r.text.includes('/n/3') && r.text.includes('<urlset'));
    r = await anon.get('/robots.txt');
    check('robots hides admin', r.text.includes('Disallow: /admin') && r.text.includes('Sitemap:'));
    r = await anon.get('/n/3');
    check('listing page has a title and description', /<title>0599 123 456/.test(r.text) && r.text.includes('name="description"'));
  } finally {
    srv.stop();
  }

  console.log('\nApproval mode (REQUIRE_APPROVAL=true)');
  const srv2 = await startServer(port + 1, { REQUIRE_APPROVAL: 'true' });
  try {
    const u = await newClient(srv2.base);
    const anon2 = await newClient(srv2.base);
    await register(u, 'Sami', '0555000777');
    let r = await u.post('/post', AD);
    check('ad waits for review', r.status === 303);
    r = await u.get('/n/1');
    check('owner sees review notice', r.text.includes('waiting for review') || r.text.includes('In review'));
    check('public cannot see pending ad', (await anon2.get('/n/1')).status === 404);
    const ad = await newClient(srv2.base);
    await register(ad, 'Owner', '0500000001');
    r = await ad.get('/admin?tab=pending');
    check('admin sees pending ad', r.text.includes('0555 777 888'));
    await ad.post('/admin/l/1/approve', { tab: 'pending' });
    check('approved ad is public', (await anon2.get('/n/1')).status === 200);
  } finally {
    srv2.stop();
  }

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
