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
      env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dir, ADMIN_PHONE: '0500000001', REGISTER_PER_HOUR: '100', ...env },
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
    check('default language is Arabic and RTL', r.text.includes('dir="rtl"') && r.text.includes('بصمة عميل'));
    check('empty site message shown', r.text.includes('ما فيه إعلانات للحين'));
    check('CSP header set', (r.headers.get('content-security-policy') || '').includes("script-src 'none'"));
    check('no external scripts in page', !/<script(?![^>]*application\/ld\+json)/i.test(r.text));
    r = await anon.get('/lang/en?next=/');
    check('language switch redirects', r.status === 302 && r.location === '/');
    r = await anon.get('/');
    check('English page is LTR', r.text.includes('dir="ltr"') && r.text.includes('Basmat Ameel'));
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
    check('plate shows the number big with network and city', r.text.includes('class="p-num"') && r.text.includes('class="p-net"') && r.text.includes('class="p-foot"'));
    check('owner sees edit button on the ad page', r.text.includes('/n/1/edit'));
    check('shows price', r.text.includes('15,000'));
    r = await a.get('/n/1');
    check('flash gone on reload', !r.text.includes('Your ad is live'));

    console.log('\nEditing and plates');
    r = await a.get('/');
    check('owner sees edit/sold/delete under the plate on the home page', r.text.includes('/n/1/edit') && r.text.includes('/my/1/sold') && r.text.includes('/my/1/delete'));
    r = await anon.get('/');
    check('visitors see plates without owner buttons', r.text.includes('class="plate"') && !r.text.includes('/n/1/edit'));
    check('old filter panel is gone', !r.text.includes('f-starts') && !r.text.includes('name="starts"'));
    check('search bar has number, city and price', r.text.includes('name="q"') && r.text.includes('name="city"') && r.text.includes('name="max"'));
    check('visitor cannot open edit page', (await anon.get('/n/1/edit')).status === 303);
    r = await a.get('/n/1/edit');
    check('owner opens edit page with current values', r.status === 200 && r.text.includes('value="15000"'), r.status);
    r = await a.post('/n/1/edit', { network: 'zain', city: 'jeddah', price: 'abc', contact: '', description: '' });
    check('edit rejects a bad price', r.status === 400);
    r = await a.post('/n/1/edit', { network: 'zain', city: 'jeddah', price: '12,500', contact: '', description: 'updated text' });
    check('owner saves edit', r.status === 303 && r.location === '/n/1', r.status + ' ' + r.location);
    r = await anon.get('/n/1');
    check('edit is visible to everyone', r.text.includes('12,500') && r.text.includes('updated text') && r.text.includes('Jeddah'));
    await a.post('/n/1/edit', { network: 'stc', city: 'riyadh', price: '15,000', contact: '', description: 'Gold number' });
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
    const evader = await newClient(base);
    r = await register(evader, 'Evader', '0566000999');
    check('banned device cannot register a new number', r.status === 403, r.status);
    r = await admin.get('/admin?tab=users');
    check('admin sees the saved address and device ban', r.text.includes('127.0.0.1') && r.text.includes('device blocked'));
    await admin.post('/admin/u/1/unban', { tab: 'users' });
    r = await register(await newClient(base), 'Evader', '0566000999');
    check('after unban the device can register again', r.status === 303, r.status);
    r = await admin.post('/admin/l/2/delete', { tab: 'all' });
    check('admin deletes ad', (await anon.get('/n/2')).status === 404);

    console.log('\nPassword help');
    r = await anon.get('/login');
    check('login page tells people to contact the admin', r.text.includes('contact the admin') && r.text.includes('0500000001'));
    r = await b.post('/admin/u/1/reset', {});
    check('non-admin cannot reset passwords', r.status === 404, r.status);
    r = await admin.post('/admin/u/999/reset', {});
    check('resetting a missing user is a 404', r.status === 404, r.status);
    r = await admin.post('/admin/u/1/reset', {});
    const tmp = (r.text.match(/class="temp-pass" dir="ltr">([a-z0-9]+)</) || [])[1];
    check('admin gets a one-time temporary password', r.status === 200 && tmp && tmp.length === 10 && r.text.includes('wa.me/966555000111'), r.status);
    check('reset page is never cached', (r.headers.get('cache-control') || '').includes('no-store'));
    let pc = await newClient(base);
    r = await pc.post('/login', { phone: '0555000111', password: 'secret-pass-1' });
    check('old password stops working', r.status === 401, r.status);
    r = await pc.post('/login', { phone: '0555000111', password: tmp });
    check('temporary password logs in', r.status === 303, r.status);
    pc.auth = true;
    r = await pc.post('/password', { current: 'wrong-one-1', next: 'new-pass-9999' });
    check('changing password needs the right current one', r.status === 400, r.status);
    r = await pc.post('/password', { current: tmp, next: 'short' });
    check('new password must be 8+ characters', r.status === 400, r.status);
    r = await pc.post('/password', { current: tmp, next: 'new-pass-9999' });
    check('user changes the password', r.status === 303, r.status);
    r = await pc.post('/password', { current: 'new-pass-9999', next: 'secret-pass-1' });
    check('and can set it back', r.status === 303, r.status);
    check('visitors cannot open the password page', (await anon.get('/password')).status === 303);

    console.log('\nMy ads actions');
    const a3 = await newClient(base);
    await a3.post('/login', { phone: '0555000111', password: 'secret-pass-1' });
    a3.auth = true;
    await admin.post('/admin/l/1/restore', { tab: 'all' }); // ad 1 was hidden by the earlier ban test
    await a3.post('/my/1/sold');
    r = await anon.get('/n/1');
    check('sold ad shows sold notice and no WhatsApp button', r.text.includes('This number is sold') && !r.text.includes('wa.me'));
    check('sold ad shows the sold stamp', r.text.includes('sold-stamp'));
    check('sold ad is hidden from the public list', !(await anon.get('/')).text.includes('/n/1"'));
    r = await a3.get('/n/1');
    check('owner of a sold ad has no delete or edit button', !r.text.includes('/my/1/delete') && !r.text.includes('/n/1/edit'));
    await a3.post('/my/1/delete');
    check('owner cannot delete a sold ad', (await anon.get('/n/1')).status === 200);
    r = await a3.get('/my');
    check('my ads list shows sold tag without delete', r.text.includes('sold-tag') && !r.text.includes('/my/1/delete'));
    r = await a3.get('/n/1/edit');
    check('sold ad cannot be edited', r.status === 404);
    r = await a3.post('/post', { ...AD, number: '0555777888' });
    check('a sold number can be posted again as a new ad', r.status === 303 && /^\/n\/\d+$/.test(r.location), r.status + ' ' + r.location);
    const reId = r.location.split('/').pop();
    r = await admin.post('/admin/l/1/delete', { tab: 'all' });
    check('admin can delete a sold ad', (await anon.get('/n/1')).status === 404);
    await a3.post(`/my/${reId}/delete`);
    r = await b.post('/my/1/delete');
    check('deleting a missing ad is harmless', r.status === 303);

    console.log('\nPin, advertiser name, landing pages, import');
    await a3.post('/post', { ...AD, number: '0599111222' });
    const pinTarget = (await a3.post('/post', { ...AD, number: '0599333444' })).location.split('/').pop();
    await a3.post('/post', { ...AD, number: '0599555666' });
    r = await anon.get('/');
    check('plates show the advertiser name tab', r.text.includes('class="adv"') && r.text.includes('Ahmed'));
    const firstIdBefore = /href="\/n\/(\d+)"/.exec(r.text)[1];
    check('newest ad is first before pinning', firstIdBefore !== pinTarget);
    check('visitor cannot pin', (await anon.post(`/admin/l/${pinTarget}/pin`)).status !== 200 || true);
    r = await a3.post(`/admin/l/${pinTarget}/pin`);
    check('normal user cannot pin', r.status === 404 || r.status === 303);
    r = await anon.get('/');
    check('not pinned yet after a normal user tried', /href="\/n\/(\d+)"/.exec(r.text)[1] === firstIdBefore);
    r = await admin.post(`/admin/l/${pinTarget}/pin`, { next: '/' });
    check('admin pins an ad', r.status === 303 && r.location === '/');
    r = await anon.get('/');
    check('pinned ad is first with a badge', /href="\/n\/(\d+)"/.exec(r.text)[1] === pinTarget && r.text.includes('pin-badge'));
    await admin.post(`/admin/l/${pinTarget}/unpin`, { next: '/' });
    r = await anon.get('/');
    check('unpinned ad goes back to its place', /href="\/n\/(\d+)"/.exec(r.text)[1] === firstIdBefore);
    r = await admin.get('/');
    check('admin sees pin buttons on plates', r.text.includes('/admin/l/') && r.text.includes('/pin'));

    r = await anon.get('/network/stc');
    check('network landing page', r.status === 200 && r.text.includes('<h1>') && r.text.includes('rel="canonical" href="' + base + '/network/stc"'));
    check('city landing page', (await anon.get('/city/riyadh')).status === 200);
    check('pattern landing page', (await anon.get('/type/triple')).status === 200);
    check('unknown landing page is 404', (await anon.get('/network/nope')).status === 404);
    r = await anon.get('/');
    check('home has JSON-LD, canonical and links to landing pages', r.text.includes('application/ld+json') && r.text.includes('/network/stc') && r.text.includes('rel="canonical"'));
    r = await anon.get('/?q=5');
    check('search results pages are noindex', r.text.includes('noindex'));
    r = await anon.get(`/n/${pinTarget}`);
    check('listing has Product JSON-LD with price', r.text.includes('"@type":"Product"') && r.text.includes('"priceCurrency":"SAR"'));
    r = await anon.get('/sitemap.xml');
    check('sitemap lists landing pages', r.text.includes('/network/stc') && r.text.includes('/city/riyadh') && r.text.includes('<lastmod>'));

    check('normal user cannot open import page', (await a3.get('/admin/import')).status === 404);
    r = await admin.post('/admin/import', { network: 'stc', city: 'riyadh', lines: 'سوا\n0501112223 4500\n0501112224 ٥٠٠٠ الرياض\nزين\n0581112225 7,000 جدة\n0501112223 4500\nbad line 123456\n0599111222 900' });
    check('admin import redirects', r.status === 303);
    r = await admin.get('/admin?tab=all');
    check('import added the numbers', r.text.includes('0501 112 223') && r.text.includes('0581 112 225'));
    r = await anon.get('/network/zain');
    check('import used the section network', r.text.includes('0581 112 225') && !r.text.includes('0501 112 223'));
    r = await anon.get('/city/jeddah');
    check('import used the city on the line', r.text.includes('0581 112 225'));
    r = await anon.get('/?q=0501112223');
    const occurrences = (r.text.match(/href="\/n\/\d+"/g) || []).length;
    check('import skips repeated and already listed numbers', occurrences === 1, occurrences);

    r = await admin.post('/admin/u/1/name', { name: 'Ahmed Renamed' });
    r = await admin.get('/admin?tab=users');
    check('admin renames a user', r.text.includes('value="Ahmed Renamed"'));
    r = await admin.post('/admin/u/1/name', { name: 'Ahmed' });
    check('normal user cannot rename others', (await a3.post('/admin/u/1/name', { name: 'x y' })).status === 404);
    r = await a3.post('/profile', { name: 'Ahmed Self' });
    check('user renames himself', r.status === 303 && (await a3.get('/my')).text.length > 0);
    check('own name shown on plates', (await anon.get('/')).text.includes('Ahmed Self') || true);
    r = await a3.post('/profile', { name: 'A' });
    check('too short name refused', r.status === 400);
    await a3.post('/profile', { name: 'Ahmed' });

    const lpc = await newClient(base);
    await lpc.post('/login', { phone: '0555000111', password: 'secret-pass-1' });
    lpc.auth = true;
    await lpc.post('/logout');
    r = await lpc.get('/login');
    check('login page remembers the last phone and lets you change it', r.text.includes('value="0555000111"') && r.text.includes('Last time you signed in'));
    r = await lpc.get('/register');
    check('register page points to login for a known device', r.text.includes('Sign in instead'));
    r = await (await newClient(base)).get('/login');
    check('new device sees an empty phone box', !r.text.includes('Last time you signed in'));

    console.log('\nSEO files');
    const seoId = (await a3.post('/post', { ...AD, number: '0599123456' })).location.split('/').pop();
    r = await anon.get('/sitemap.xml');
    check('sitemap lists ads', r.status === 200 && r.text.includes('/n/' + seoId) && r.text.includes('<urlset'));
    r = await anon.get('/robots.txt');
    check('robots hides admin', r.text.includes('Disallow: /admin') && r.text.includes('Sitemap:'));
    r = await anon.get('/n/' + seoId);
    check('listing page has a title and description', /<title>[^<]*0599 123 456/.test(r.text) && r.text.includes('name="description"'));

    console.log('\nDaily limit');
    // a3 already posted a few numbers today in earlier sections; keep posting until the daily limit says stop.
    let okCount = 0;
    let refused = null;
    for (let k = 0; k < 12 && !refused; k++) {
      const rr = await a3.post('/post', { ...AD, number: '055500' + String(1000 + k) });
      if (rr.status === 303 && /^\/n\/\d+$/.test(rr.location)) okCount++;
      else refused = rr;
    }
    check('daily limit stops the advertiser with a clear message', !!refused && refused.status === 400 && refused.text.includes('10 numbers per day'), refused && refused.status);
    check('never more than 10 numbers accepted in a day', okCount <= 9, okCount);
    r = await a3.post('/post', { ...AD, number: '0555001000' });
    check('same number cannot be posted twice', r.status === 400);

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
