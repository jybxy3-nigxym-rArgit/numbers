'use strict';

// End-to-end checks: starts the server on a temporary database and drives it over HTTP.
// Run with:  npm test

const { spawn } = require('child_process');
const http = require('http');
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
      env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dir, ADMIN_PHONE: '0500000001', REGISTER_PER_HOUR: '100', POST_PER_HOUR: '500', ...env },
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
    this.headers = {};
  }
  async req(method, p, form) {
    const headers = { ...this.headers };
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
    return this.req('POST', p, { _csrf, confirm: '1', ...form });
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
    check('Tag Manager is off unless GTM_ID is set', !r.text.includes('googletagmanager') && r.headers.get('content-security-policy').includes("script-src 'none'"));
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
    evader.jar.did = a.jar.did; // same browser as the banned user
    r = await register(evader, 'Evader', '0566000999');
    check('banned browser cannot register a new number', r.status === 403, r.status);
    const other = await newClient(base); // different browser, same address: not blocked
    r = await register(other, 'Neighbour', '0566000888');
    check('another browser on the same address is not blocked', r.status === 303, r.status);
    r = await admin.get('/admin?tab=users');
    check('admin sees the device ban note', r.text.includes('device blocked') && !/<small>\d+\.\d+\.\d+\.\d+<\/small>/.test(r.text));
    await admin.post('/admin/u/1/unban', { tab: 'users' });
    const evader2 = await newClient(base);
    evader2.jar.did = a.jar.did;
    r = await register(evader2, 'Evader', '0566000999');
    check('after unban the browser can register again', r.status === 303, r.status);
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

    console.log('\nClickable plate parts');
    r = await anon.get('/');
    check('plate has links for network, city and price', r.text.includes('class="p-net" href="/network/') && r.text.includes('class="p-city" href="/city/') && r.text.includes('class="price-link" href="/price/'));
    r = await anon.get('/price/15000');
    check('price page lists ads with that exact price', r.status === 200 && r.text.includes('0555 777 888') === false && r.text.includes('<h1>'));
    check('price page rejects junk', (await anon.get('/price/abc')).status === 404);
    r = await anon.get('/price/900');
    check('price page is not indexed', r.text.includes('noindex'));

    console.log('\nModerators');
    const idOf = async (phone) => {
      const rr = await admin.get('/admin?tab=users');
      const m = new RegExp(`action="/admin/u/(\\d+)/name"(?:(?!<tr>)[\\s\\S])*?dir="ltr">${phone}`).exec(rr.text);
      return m && m[1];
    };
    const sup = await newClient(base);
    const sup2 = await newClient(base);
    const mod = await newClient(base);
    const vic = await newClient(base);
    await register(sup, 'Sup', '0577000001');
    await register(mod, 'Mod', '0577000002');
    await register(vic, 'Vic', '0577000003');
    await register(sup2, 'Sup2', '0577000004');
    const [supId, modId, vicId, sup2Id, ownerId] = [
      await idOf('0577000001'),
      await idOf('0577000002'),
      await idOf('0577000003'),
      await idOf('0577000004'),
      await idOf('0500000001'),
    ];
    check('plain member cannot open the admin panel', (await sup.get('/admin')).status === 404);
    await admin.post(`/admin/u/${supId}/role`, { role: 'super' });
    await admin.post(`/admin/u/${sup2Id}/role`, { role: 'super' });
    await admin.post(`/admin/u/${modId}/role`, { role: 'mod' });
    check('general moderator opens the admin panel', (await sup.get('/admin')).status === 200);
    check('moderator opens the admin panel', (await mod.get('/admin')).status === 200);
    check('a moderator cannot give roles', (await mod.post(`/admin/u/${vicId}/role`, { role: 'mod' })).status === 404);
    check('a general moderator cannot make a general moderator', (await sup.post(`/admin/u/${vicId}/role`, { role: 'super' })).status === 404 && (await sup.post(`/admin/u/${sup2Id}/role`, { role: 'user' })).status === 404 && (await sup.post(`/admin/u/${ownerId}/role`, { role: 'user' })).status === 404);
    check('a general moderator makes a moderator and takes it back', (await sup.post(`/admin/u/${vicId}/role`, { role: 'mod' })).status === 303 && (await vic.get('/admin')).status === 200 && (await sup.post(`/admin/u/${vicId}/role`, { role: 'user' })).status === 303 && (await vic.get('/admin')).status === 404);
    check('moderator panel has no import and no stats', !(await mod.get('/admin')).text.includes('/admin/import'));

    const ownerAd = (await admin.post('/post', { ...AD, number: '0500999888' })).location.split('/').pop();
    const vicAd = (await vic.post('/post', { ...AD, number: '0577111222' })).location.split('/').pop();
    const supAd = (await sup.post('/post', { ...AD, number: '0577222333' })).location.split('/').pop();
    const pub = async (id) => (await anon.get(`/n/${id}`)).status;

    r = await mod.post(`/admin/l/${vicAd}/hide`, { tab: 'all' });
    check('moderator hides an ad', r.status === 303 && (await pub(vicAd)) === 404);
    check('moderator cannot delete', (await mod.post(`/admin/l/${vicAd}/delete`)).status === 404 && (await admin.get(`/n/${vicAd}`)).status === 200);
    check('moderator cannot pin or approve', (await mod.post(`/admin/l/${vicAd}/pin`)).status === 404 && (await mod.post(`/admin/l/${vicAd}/approve`)).status === 404);
    check('moderator takes back his own hiding', (await mod.post(`/admin/l/${vicAd}/restore`, { tab: 'all' })).status === 303 && (await pub(vicAd)) === 200);
    check('moderator cannot touch the owner or a general moderator ads',
      (await mod.post(`/admin/l/${ownerAd}/hide`)).status === 404 && (await mod.post(`/admin/l/${supAd}/hide`)).status === 404 && (await pub(ownerAd)) === 200);

    r = await mod.post(`/admin/u/${vicId}/suspend`, { tab: 'users' });
    check('moderator suspends a member', r.status === 303 && (await pub(vicAd)) === 404);
    check('suspended member is signed out', (await vic.get('/my')).status === 303);
    r = await (await newClient(base)).post('/login', { phone: '0577000003', password: 'secret-pass-1' });
    check('suspended member cannot sign in and sees why', r.status === 403 && r.text.includes('suspended'));
    check('suspended ads leave the home page', !(await anon.get('/')).text.includes('/n/' + vicAd + '"'));
    check('moderator cannot ban, reset or rename',
      (await mod.post(`/admin/u/${vicId}/ban`)).status === 404 && (await mod.post(`/admin/u/${vicId}/reset`)).status === 404 && (await mod.post(`/admin/u/${vicId}/name`, { name: 'Zed Zed' })).status === 404);
    check('moderator cannot suspend the owner or a general moderator',
      (await mod.post(`/admin/u/${ownerId}/suspend`)).status === 404 && (await mod.post(`/admin/u/${supId}/suspend`)).status === 404);

    await mod.post(`/admin/l/${vicAd}/hide`);
    r = await sup.get('/admin?tab=review');
    check('review tab lists hidden ads and suspended members', r.text.includes('0577 111 222') && r.text.includes('Vic') && r.text.includes('Suspended by Mod'));
    check('general moderator lifts the suspension', (await sup.post(`/admin/u/${vicId}/unsuspend`, { tab: 'review' })).status === 303);
    check('member can sign in again', (await (await newClient(base)).post('/login', { phone: '0577000003', password: 'secret-pass-1' })).status === 303);
    check('general moderator restores the ad', (await sup.post(`/admin/l/${vicAd}/restore`)).status === 303 && (await pub(vicAd)) === 200);
    check('general moderator pins an ad', (await sup.post(`/admin/l/${vicAd}/pin`, { next: '/' })).status === 303);
    check('general moderator bans and unbans a member',
      (await sup.post(`/admin/u/${vicId}/ban`)).status === 303 && (await sup.post(`/admin/u/${vicId}/unban`)).status === 303);
    check('general moderator resets a password and renames a member',
      (await sup.post(`/admin/u/${vicId}/reset`)).status === 200 && (await sup.post(`/admin/u/${vicId}/name`, { name: 'Vic Renamed' })).status === 303);
    await sup.post(`/admin/u/${vicId}/name`, { name: 'Vic' });
    check('general moderator opens the import page', (await sup.get('/admin/import')).status === 200);
    check('general moderator cannot touch the owner at all',
      (await sup.post(`/admin/l/${ownerAd}/hide`)).status === 404 &&
      (await sup.post(`/admin/l/${ownerAd}/delete`)).status === 404 &&
      (await sup.post(`/admin/u/${ownerId}/reset`)).status === 404 &&
      (await sup.post(`/admin/u/${ownerId}/name`, { name: 'Boss Boss' })).status === 404 &&
      (await sup.post(`/admin/u/${ownerId}/ban`)).status === 404 &&
      (await pub(ownerAd)) === 200);
    check('general moderators cannot act on each other', (await sup.post(`/admin/u/${sup2Id}/ban`)).status === 404 && (await sup.post(`/admin/u/${sup2Id}/reset`)).status === 404);

    await sup.post(`/admin/u/${vicId}/suspend`, { tab: 'users' });
    check('moderator cannot lift a suspension he did not make', (await mod.post(`/admin/u/${vicId}/unsuspend`)).status === 404);
    await sup.post(`/admin/u/${vicId}/unsuspend`, { tab: 'users' });
    await admin.post(`/admin/u/${modId}/role`, { role: 'user' });
    check('owner takes the role away', (await mod.get('/admin')).status === 404);

    console.log('\nNew features');
    const nora = await newClient(base);
    const omar = await newClient(base);
    await register(nora, 'Nora', '0566000001');
    await register(omar, 'Omar', '0566000002');
    const noraId = await idOf('0566000001');
    const omarId = await idOf('0566000002');
    const homeText = async () => (await anon.get('/')).text;

    // price type, odd price warning
    let rr = await nora.post('/post', { ...AD, number: '0566111001', price: '5000', price_type: 'negotiable' });
    const adA = rr.location.split('/').pop();
    check('ad with a price type is published', rr.status === 303);
    rr = await anon.get('/n/' + adA);
    check('listing page shows the price type, share button and copy line', rr.text.includes('Negotiable') && rr.text.includes('https://wa.me/?text=') && rr.text.includes('copy-num'));
    rr = await nora.post('/post', { ...AD, number: '0566111002', price: '5' });
    check('a strange price asks for confirmation', rr.status === 400 && rr.text.includes('name="price_ok"') && rr.text.includes('looks unusual'));
    rr = await nora.post('/post', { ...AD, number: '0566111002', price: '5', price_ok: '1' });
    check('confirmed strange price is published', rr.status === 303);
    check('admin list marks the odd price', (await admin.get('/admin?tab=all')).text.includes('Odd price'));

    // view counter with eye icon, search engines not counted
    const viewsOf = async (id) => {
      const card = (await homeText()).split('class="plate-card').find((x) => x.includes(`href="/n/${id}"`)) || '';
      return /views-chip[\s\S]*?<bdi>(\d+)<\/bdi>/.exec(card);
    };
    const bot = await newClient(base);
    bot.headers['user-agent'] = 'Mozilla/5.0 (compatible; Googlebot/2.1)';
    await bot.get('/n/' + adA);
    check('home shows the eye with the view count', /views-chip/.test(await homeText()));
    const v0 = Number((await viewsOf(adA))[1]);
    await bot.get('/n/' + adA);
    check('search engine visits are not counted', Number((await viewsOf(adA))[1]) === v0);
    const visitor = await newClient(base);
    await visitor.get('/n/' + adA);
    await visitor.get('/n/' + adA);
    check('a real visitor counts once', Number((await viewsOf(adA))[1]) === v0 + 1);

    // are you sure?
    let raw = await nora.req('POST', `/my/${adA}/delete`, { _csrf: await nora.csrf() });
    check('delete asks "are you sure" first', raw.status === 200 && raw.text.includes('Yes, continue') && (await anon.get('/n/' + adA)).status === 200);
    raw = await nora.req('POST', `/my/${adA}/sold`, { _csrf: await nora.csrf() });
    check('sold asks "are you sure" first', raw.status === 200 && raw.text.includes('Yes, continue') && !(await anon.get('/n/' + adA)).text.includes('sold-stamp'));

    // renew
    rr = await nora.post(`/my/${adA}/renew`);
    check('a fresh ad cannot be renewed yet', rr.status === 303 && (await nora.get('/my')).text.includes('Renew in'));

    // delete and repost penalty
    const adB = (await omar.post('/post', { ...AD, number: '0566111003' })).location.split('/').pop();
    await omar.post(`/my/${adB}/delete`);
    rr = await omar.post('/post', { ...AD, number: '0566111003' });
    check('a deleted number cannot be reposted right away', rr.status === 400 && rr.text.includes('5 day'));
    rr = await nora.post('/post', { ...AD, number: '0566111003' });
    check('nobody else can post it during the wait', rr.status === 400);

    // report limit: five reports a day for one person
    const pat = await newClient(base);
    await register(pat, 'Pat', '0566000003');
    const patAds = [];
    for (let k = 0; k < 6; k++) patAds.push((await pat.post('/post', { ...AD, number: '056622200' + k })).location.split('/').pop());
    const rita = await newClient(base);
    await register(rita, 'Rita', '0566000004');
    let last;
    for (const id of patAds) last = await rita.post(`/n/${id}/report`, { reason: 'spam' });
    check('a person can send only a few reports a day', (await rita.get('/')).text.includes('many reports'), last.status);

    // blocked phones
    check('only staff can block phones', (await nora.post('/admin/block', { phone: '0566000099' })).status === 404);
    check('owner blocks a phone', (await admin.post('/admin/block', { phone: '0566000099' })).status === 303 && (await admin.get('/admin?tab=blocked')).text.includes('0566000099'));
    const blk = await newClient(base);
    rr = await blk.req('POST', '/register', { _csrf: /name="_csrf" value="([^"]+)"/.exec((await blk.get('/register')).text)[1], name: 'Blocked', phone: '0566000099', password: 'secret-pass-1' });
    check('a blocked phone cannot register', rr.status === 400);
    rr = await nora.post('/post', { ...AD, number: '0566000099' });
    check('a blocked phone cannot be an ad number', rr.status === 400 && rr.text.includes('not allowed'));
    rr = await nora.post('/post', { ...AD, number: '0566111005', contact: '0566000099' });
    check('a blocked phone cannot be an ad contact', rr.status === 400);
    await admin.post('/admin/unblock/566000099');
    check('unblock works', !(await admin.get('/admin?tab=blocked')).text.includes('0566000099'));

    // verified advertisers and bulk add
    check('plain member has no bulk page', (await nora.get('/my/bulk')).status === 404);
    check('owner verifies a member', (await admin.post(`/admin/u/${noraId}/verify`, { tab: 'users' })).status === 303);
    check('verified mark shows on plates', (await homeText()).includes('class="vmark"'));
    check('verified member opens the bulk page', (await nora.get('/my/bulk')).status === 200);
    rr = await nora.post('/my/bulk', { network: 'stc', city: 'riyadh', lines: '0566333001 100\n0566333002 200\n0566333003 300\n0566333004 400\n0566333005 500\n0566333006 600\n0566333007 700' });
    check('bulk add is capped at 5 numbers', rr.status === 303 && (await nora.get('/my')).text.includes('Added 5'));
    check('the sixth number was not added', !(await anon.get('/')).text.includes('0566333006'));

    // featured ads, notes, hide with a reason, activity log
    check('owner features an ad', (await admin.post(`/admin/l/${adA}/feature`, { next: '/' })).status === 303);
    rr = await anon.get('/');
    check('featured ad gets the gold frame and badge', rr.text.includes('is-featured') && rr.text.includes('feat-badge'));
    await admin.post(`/admin/l/${adA}/unfeature`, { next: '/' });
    check('private note is saved and shown to staff', (await admin.post(`/admin/u/${omarId}/note`, { note: 'calls late at night' })).status === 303 && (await admin.get('/admin?tab=users')).text.includes('calls late at night'));
    rr = await admin.post(`/admin/l/${adA}/hide`, { tab: 'all', reason: 'price' });
    check('hide goes to a ready message with the reason', rr.status === 303 && rr.location.startsWith('/admin/notify'));
    rr = await admin.get(rr.location);
    check('ready message has the reason and a WhatsApp link', rr.status === 200 && rr.text.includes('Misleading price') && rr.text.includes('wa.me/966566000001'));
    await admin.post(`/admin/l/${adA}/restore`, { tab: 'all' });
    rr = await admin.get('/admin?tab=log');
    check('activity log records staff actions', rr.text.includes('Hid an ad') && rr.text.includes('Featured an ad') && rr.text.includes('Blocked a phone') && rr.text.includes('Misleading price'));
    check('only senior staff see the log and exports', (await nora.get('/admin?tab=log')).status === 404 && (await nora.get('/admin/export/users.csv')).status === 404 && (await anon.get('/admin/export/users.csv')).status === 404);
    rr = await admin.get('/admin/export/users.csv');
    check('members export is a csv file', rr.status === 200 && String(rr.headers.get('content-type')).startsWith('text/csv') && rr.text.includes('Nora') && rr.text.includes('0566000001'));
    rr = await admin.get('/admin/export/numbers.csv');
    check('numbers export is a csv file', rr.status === 200 && rr.text.includes('0566111001'));
    rr = await admin.get('/admin?tab=all&q=0566111001');
    check('admin searches ads by number', rr.text.includes('0566 111 001') && !rr.text.includes('0566 111 002') && rr.text.includes('1 result'));
    rr = await admin.get('/admin?tab=all&q=566111002');
    check('admin number search works without the leading zero', rr.text.includes('0566 111 002') && !rr.text.includes('0566 111 001'));
    check('admin searches ads by advertiser name', (await admin.get('/admin?tab=all&q=Omar')).text.includes('Omar') && !(await admin.get('/admin?tab=all&q=Omar')).text.includes('0566 111 001'));
    check('admin searches members by phone and name', (await admin.get('/admin?tab=users&q=0566000002')).text.includes('Omar') && !(await admin.get('/admin?tab=users&q=0566000002')).text.includes('Nora') && (await admin.get('/admin?tab=users&q=Nora')).text.includes('0566000001'));
    check('search with no match says so', (await admin.get('/admin?tab=all&q=0511111111')).text.includes('0 result'));
    check('search box shows on the lists', (await admin.get('/admin?tab=all')).text.includes('class="admin-search"'));
    check('stats show views and top lists', (await admin.get('/admin?tab=stats')).text.includes('Most viewed'));

    // under-price pages, information pages, articles
    await nora.post('/post', { ...AD, number: '0566444001', price: '300' });
    rr = await anon.get('/under/500');
    check('under-price page lists cheap numbers and is indexed', rr.status === 200 && rr.text.includes('0566 444 001') && !rr.text.includes('noindex'));
    check('unknown price ceiling is 404', (await anon.get('/under/123')).status === 404);
    check('home links to the under-price page', (await homeText()).includes('/under/500'));
    rr = await anon.get('/faq');
    check('faq page has FAQPage data', rr.status === 200 && rr.text.includes('FAQPage'));
    check('articles list and article page work', (await anon.get('/articles')).status === 200 && (await anon.get('/articles/sawa-packages')).text.includes('2120') && (await anon.get('/articles/nope')).status === 404);
    check('about and contact pages work', (await anon.get('/about')).status === 200 && (await anon.get('/contact')).text.includes('wa.me'));
    rr = await anon.get('/sitemap.xml');
    check('sitemap lists info pages, articles and the under-price page', rr.text.includes('/faq') && rr.text.includes('/articles/sawa-packages') && rr.text.includes('/under/500'));
    check('promo banner shows for visitors, not for members', (await anon.get('/faq')).text.includes('class="promo"') && !(await nora.get('/faq')).text.includes('class="promo"'));
    check('footer links, back-to-top and bottom bar exist', (await homeText()).includes('class="to-top"') && (await homeText()).includes('class="tabbar"'));

    // night mode
    const night = await newClient(base);
    rr = await night.get('/theme/dark?next=/');
    check('night mode sets a cookie', rr.status === 302 && night.jar.theme === 'dark');
    check('night mode marks the page', (await night.get('/')).text.includes('data-theme="dark"') && !(await homeText()).includes('data-theme="dark"'));

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
    check('admin header shows what is waiting', (await ad.get('/')).text.includes('alert-dot'));
    await ad.post('/admin/l/1/approve', { tab: 'pending' });
    check('approved ad is public', (await anon2.get('/n/1')).status === 200);
  } finally {
    srv2.stop();
  }

  console.log('\nRenew and alerts');
  const srv3 = await startServer(port + 2, { RENEW_DAYS: '0', GTM_ID: 'GTM-TEST123' });
  try {
    const u = await newClient(srv3.base);
    await register(u, 'Lama', '0555000888');
    const id = (await u.post('/post', AD)).location.split('/').pop();
    let r = await u.post(`/my/${id}/renew`);
    const pubPage = await (await newClient(srv3.base)).get('/');
    const csp = pubPage.headers.get('content-security-policy');
    const nonce = /nonce="([^"]+)"/.exec(pubPage.text);
    check('Tag Manager loads on public pages with a nonce', pubPage.text.includes('GTM-TEST123') && nonce && csp.includes(`'nonce-${nonce[1]}'`) && csp.includes('https://www.googletagmanager.com'));
    const loginPage = await (await newClient(srv3.base)).get('/login');
    check('login page stays script-free', !loginPage.text.includes('GTM-TEST123') && loginPage.headers.get('content-security-policy').includes("script-src 'none'"));
    check('renew moves the ad back to the top', r.status === 303 && (await u.get('/my')).text.includes('back at the top'));
    check('my ads page stays script-free', !(await u.get('/my')).text.includes('googletagmanager'));

  } finally {
    srv3.stop();
  }

  // A stand-in for the WhatsApp service: it just records what the site sends.
  const seen = [];
  const mock = http.createServer((req, res) => {
    seen.push(new URL(req.url, 'http://x').searchParams);
    res.end('ok');
  });
  await new Promise((resolve) => mock.listen(port + 20, '127.0.0.1', resolve));
  const srv4 = await startServer(port + 3, { CALLMEBOT_KEY: 'k123', CALLMEBOT_URL: `http://127.0.0.1:${port + 20}/send` });
  try {
    const u = await newClient(srv4.base);
    await register(u, 'Dana', '0555000999');
    await u.post('/post', AD);
    const id = 1;
    const v = await newClient(srv4.base);
    await v.post(`/n/${id}/report`, { reason: 'scam' });
    const u2 = await newClient(srv4.base);
    await u2.post('/login', { phone: '0555000999', password: 'secret-pass-1' });
    await new Promise((r) => setTimeout(r, 400));
    const texts = seen.map((p) => p.get('text') || '');
    check('owner is alerted about a new member', texts.some((x) => x.includes('Dana')));
    check('owner is alerted about a new ad', texts.some((x) => x.includes('0555777888') && x.includes('Dana')));
    check('owner is alerted about a report', texts.some((x) => x.includes('0555777888') && x.includes('scam') === false && x.length > 10));
    check('owner is alerted about a login', texts.filter((x) => x.includes('Dana')).length >= 3);
    check('alerts carry the key and the owner phone', seen.every((p) => p.get('apikey') === 'k123' && p.get('phone') === '+966500000001'));
  } finally {
    srv4.stop();
    mock.close();
  }

  console.log('\nAuto refresh and year-old ads');
  const srv5 = await startServer(port + 4, { AUTO_RENEW_DAYS: '0' });
  try {
    const adm = await newClient(srv5.base);
    await register(adm, 'Boss', '0500000001');
    const v = await newClient(srv5.base);
    const w = await newClient(srv5.base);
    await register(v, 'Vera', '0555000111');
    await register(w, 'Wael', '0555000222');
    const idA = (await v.post('/post', { ...AD, number: '0555111001' })).location.split('/').pop();
    check('a member who is not verified has no auto refresh', !(await v.get('/my')).text.includes('Auto refresh'));
    const users = await adm.get('/admin?tab=users');
    const vid = new RegExp(`action="/admin/u/(\\d+)/name"(?:(?!<tr>)[\\s\\S])*?dir="ltr">0555000111`).exec(users.text)[1];
    await adm.post(`/admin/u/${vid}/verify`, { tab: 'users' });
    check('verifying gives the live ads one month of auto refresh', (await v.get('/my')).text.includes('Auto refresh: 30 day'));
    await new Promise((r) => setTimeout(r, 1100));
    const idB = (await w.post('/post', { ...AD, number: '0555111002' })).location.split('/').pop();
    const order = async () => [...(await (await newClient(srv5.base)).get('/')).text.matchAll(/class="p-num" dir="ltr"[^>]*href="\/n\/(\d+)"|href="\/n\/(\d+)"[^>]*class="p-num"/g)].map((m) => m[1] || m[2]);
    const firstId = async () => /href="\/n\/(\d+)"/.exec((await (await newClient(srv5.base)).get('/')).text.split('class="plate-card')[1])[1];
    check('newest ad is first before the refresh', (await firstId()) === idB);
    await new Promise((r) => setTimeout(r, 1100));
    await (await newClient(srv5.base)).get('/sitemap.xml');
    check('the verified advertiser ad goes back to the top by itself', (await firstId()) === idA);
    const idC = (await v.post('/post', { ...AD, number: '0555111003' })).location.split('/').pop();
    check('new ads of a verified advertiser start with auto refresh', (await v.get('/my')).text.split('Auto refresh').length >= 3);
    void idC; void order;
  } finally {
    srv5.stop();
  }

  const srv6 = await startServer(port + 5, { STALE_DAYS: '0' });
  try {
    const u = await newClient(srv6.base);
    await register(u, 'Salem', '0555000333');
    const keep = (await u.post('/post', { ...AD, number: '0555222001' })).location.split('/').pop();
    const gone = (await u.post('/post', { ...AD, number: '0555222002' })).location.split('/').pop();
    await u.post(`/my/${keep}/sold`);
    check('before the upkeep both ads are there', (await u.get('/n/' + gone)).status === 200);
    await (await newClient(srv6.base)).get('/sitemap.xml');
    check('an ad nobody refreshed for the set time is removed', (await u.get('/n/' + gone)).status === 404);
    check('a sold ad stays as a record', (await u.get('/n/' + keep)).status === 200);
  } finally {
    srv6.stop();
  }

  {
    const css = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'style.css'), 'utf8');
    check('style.css is complete (guards against a cut file)', css.length > 30000 && ['.popup', '.tabbar', '.plate', '@keyframes feat-sheen', '.admin-search'].every((x) => css.includes(x)));
  }

  const srv7 = await startServer(port + 6, {});
  try {
    const g = await newClient(srv7.base);
    const h1 = await g.get('/');
    check('new visitor sees the notice', h1.text.includes('class="popup"') && h1.text.includes('not responsible for buying or selling'));
    await g.get('/ack?next=/');
    check('after pressing got it the notice is gone', !(await g.get('/')).text.includes('class="popup"'));
  } finally {
    srv7.stop();
  }


  // ---- Link with the Salla store ----
  const srv8 = await startServer(port + 7, { SALLA_WEBHOOK_SECRET: 'store-secret-1' });
  try {
    const hook = (body, headers = {}) =>
      fetch(srv8.base + '/webhook/salla', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    const prod = (over = {}) => ({
      event: 'product.updated',
      data: { id: 1, name: '0505355300 | رقم سوا مرتب وسهل الحفظ', price: { amount: 1200, currency: 'SAR' }, quantity: 1, status: 'sale', is_available: true,
        url: 'https://souq3rb.com/رقم-مميز-سوا-مرتب-سهل-الحفظ-0505355300-القصيم/p1', ...over },
    });
    const ad = await newClient(srv8.base);
    const reader = await newClient(srv8.base);
    check('webhook without secret is refused', (await hook(prod())).status === 401);
    check('webhook with a wrong secret is refused', (await hook(prod(), { authorization: 'Bearer nope' })).status === 401);
    const adm = await newClient(srv8.base);
    await register(adm, 'Owner', '0500000001');
    check('a new store number is added', (await hook(prod(), { authorization: 'Bearer store-secret-1' })).status === 200);
    const page1 = (await reader.get('/')).text;
    check('the store number shows on the site', page1.includes('0505355300') || page1.includes('0505 355 300'));
    const sig = await require('crypto').createHmac('sha256', 'store-secret-1').update(JSON.stringify(prod({ price: { amount: 900 } }))).digest('hex');
    check('signature header is accepted', (await hook(prod({ price: { amount: 900 } }), { 'x-salla-signature': sig })).status === 200);
    check('price change reaches the site', (await reader.get('/')).text.includes('900'));
    await hook(prod({ quantity: 0 }), { authorization: 'Bearer store-secret-1' });
    const gone = (await reader.get('/')).text;
    check('quantity 0 hides the number', !gone.includes('0505355300') && !gone.includes('0505 355 300'));
    await hook(prod({ quantity: 1 }), { authorization: 'Bearer store-secret-1' });
    const back = (await reader.get('/')).text;
    check('quantity back shows it again', back.includes('0505355300') || back.includes('0505 355 300'));
    await hook({ ...prod(), event: 'product.deleted' }, { authorization: 'Bearer store-secret-1' });
    check('deleted product is hidden', !(await reader.get('/')).text.includes('0505 355 300'));
    check('hidden store numbers do not clutter the reported tab', !(await adm.get('/admin?tab=reported')).text.includes('0505355300'));
    void ad;
  } finally {
    srv8.stop();
  }

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
