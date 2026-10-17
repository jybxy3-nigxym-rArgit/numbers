'use strict';

// All database queries, written once for both back ends:
//   Node:                 db.js   (built-in SQLite)
//   Cloudflare Workers:   d1.js   (D1)
// A "driver" only needs four async methods: all, first, run, batch.
//   all(sql, params)    -> array of rows
//   first(sql, params)  -> one row or null
//   run(sql, params)    -> { changes, lastId }
//   batch([{sql, params}]) -> [{ rows, changes, lastId }] (all or nothing)

const config = require('./config');
const { patternTags, parseDbDate } = require('./util');
const { UNDER_PRICES } = require('./data');
const { randomToken } = require('./webcrypto');

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    phone       TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    pass_hash   TEXT NOT NULL,
    is_admin    INTEGER NOT NULL DEFAULT 0,
    banned      INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS listings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    number      TEXT NOT NULL,
    network     TEXT NOT NULL,
    city        TEXT NOT NULL,
    price       INTEGER,
    contact     TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'active',
    views       INTEGER NOT NULL DEFAULT 0,
    pats        TEXT NOT NULL DEFAULT ' ',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  'CREATE INDEX IF NOT EXISTS idx_listings_status_created ON listings(status, created_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_listings_user ON listings(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_listings_number ON listings(number)',
  `CREATE TABLE IF NOT EXISTS reports (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_id   INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    reporter_key TEXT NOT NULL,
    reason       TEXT NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (listing_id, reporter_key)
  )`,
  `CREATE TABLE IF NOT EXISTS user_devices (
    user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind      TEXT NOT NULL,
    val       TEXT NOT NULL,
    last_seen TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, kind, val)
  )`,
  `CREATE TABLE IF NOT EXISTS banned_devices (
    kind       TEXT NOT NULL,
    val        TEXT NOT NULL,
    user_id    INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (kind, val)
  )`,
  `CREATE TABLE IF NOT EXISTS audit_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id   INTEGER NOT NULL,
    actor_name TEXT NOT NULL,
    action     TEXT NOT NULL,
    target     TEXT NOT NULL DEFAULT '',
    detail     TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS blocked_phones (
    phone      TEXT PRIMARY KEY,
    by_id      INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS deleted_numbers (
    number     TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    deleted_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  'CREATE TABLE IF NOT EXISTS views_daily (day TEXT PRIMARY KEY, views INTEGER NOT NULL DEFAULT 0)',
  'CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS rate_events (k TEXT NOT NULL, ts INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS idx_rate_k ON rate_events(k, ts)',
];

const LISTING_SELECT = `
  SELECT l.*, u.name AS seller, u.banned AS seller_banned, u.suspended AS seller_suspended,
         u.is_admin AS seller_is_admin, u.role AS seller_role, u.verified AS seller_verified
  FROM listings l JOIN users u ON u.id = l.user_id`;

// Ads of banned or suspended members stay out of every public list.
const VISIBLE_SELLER = 'l.user_id NOT IN (SELECT id FROM users WHERE banned = 1 OR suspended > 0)';

const REPORT_COUNT_SQL = '(SELECT COUNT(*) FROM reports r WHERE r.listing_id = l.id)';

const DAY_MS = 86400000;

function createStore(d) {
  let secretCache = null;
  // Counts for the landing pages change slowly: keep them for a minute, and drop them when this server writes an ad.
  let countsCache = null;
  const dropCounts = () => {
    countsCache = null;
  };

  // Creates the tables if they are missing and promotes the admin phone. Runs once per process.
  // The check is idempotent. Each request runs its own copy until one finishes: a promise created by one request is never
  // awaited by another, because Cloudflare Workers can leave such a request hanging.
  let isReady = false;
  async function ready() {
    if (isReady) return;
    await d.batch(SCHEMA.map((sql) => ({ sql, params: [] })));
    // Columns added after the first release: add them to databases that already exist.
    const cols = (await d.all('PRAGMA table_info(listings)')).map((c) => c.name);
    const ucols = (await d.all('PRAGMA table_info(users)')).map((c) => c.name);
    const addCol = (table, col, ddl) => d.run(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`).catch(() => {});
    if (!ucols.includes('role')) await addCol('users', 'role', "TEXT NOT NULL DEFAULT 'user'");
    if (!ucols.includes('suspended')) await addCol('users', 'suspended', 'INTEGER NOT NULL DEFAULT 0');
    if (!ucols.includes('verified')) await addCol('users', 'verified', 'INTEGER NOT NULL DEFAULT 0');
    if (!ucols.includes('note')) await addCol('users', 'note', "TEXT NOT NULL DEFAULT ''");
    if (!cols.includes('hidden_by')) await addCol('listings', 'hidden_by', 'INTEGER NOT NULL DEFAULT 0');
    if (!cols.includes('renewed_at')) await addCol('listings', 'renewed_at', "TEXT NOT NULL DEFAULT ''");
    if (!cols.includes('price_type')) await addCol('listings', 'price_type', "TEXT NOT NULL DEFAULT ''");
    if (!cols.includes('auto_until')) await addCol('listings', 'auto_until', "TEXT NOT NULL DEFAULT ''");
    if (!cols.includes('featured')) await addCol('listings', 'featured', 'INTEGER NOT NULL DEFAULT 0');
    if (!cols.includes('pinned')) await addCol('listings', 'pinned', 'INTEGER NOT NULL DEFAULT 0');
    if (config.adminNational) {
      await d.run('UPDATE users SET is_admin = 1 WHERE phone = ?', [config.adminNational]);
    }
    isReady = true;
  }

  // Secret used to sign session cookies. Set SESSION_SECRET, or one is generated and kept in the database.
  // Look of the number plates, chosen by the admin: classic (default), light or pro.
  const PLATE_STYLES = ['classic', 'light', 'pro', 'xmin', 'min', 'elite'];
  let plateCache = null;
  async function getPlateStyle() {
    if (plateCache && Date.now() - plateCache.at < 60000) return plateCache.v;
    const r = await d.first("SELECT v FROM meta WHERE k = 'plate_style'");
    const v = r && PLATE_STYLES.includes(r.v) ? r.v : 'classic';
    plateCache = { v, at: Date.now() };
    return v;
  }
  async function setPlateStyle(v) {
    if (!PLATE_STYLES.includes(v)) return false;
    await d.run("INSERT INTO meta (k, v) VALUES ('plate_style', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", [v]);
    plateCache = { v, at: Date.now() };
    return true;
  }

  async function getSecret() {
    if (config.sessionSecret) return config.sessionSecret;
    if (secretCache) return secretCache;
    await ready();
    let row = await d.first("SELECT v FROM meta WHERE k = 'session_secret'");
    if (!row) {
      await d.run("INSERT OR IGNORE INTO meta (k, v) VALUES ('session_secret', ?)", [randomToken(32)]);
      row = await d.first("SELECT v FROM meta WHERE k = 'session_secret'");
    }
    secretCache = row.v;
    return secretCache;
  }

  // ---- Rate limiting (kept in the database so it works across servers) ----

  async function allow(key, limit, windowMs) {
    await ready();
    const now = Date.now();
    const rs = await d.batch([
      { sql: 'DELETE FROM rate_events WHERE k = ? AND ts < ?', params: [key, now - windowMs] },
      { sql: 'SELECT COUNT(*) AS c FROM rate_events WHERE k = ?', params: [key] },
    ]);
    if (rs[1].rows[0].c >= limit) return false;
    await d.run('INSERT INTO rate_events (k, ts) VALUES (?, ?)', [key, now]);
    if (Math.random() < 0.02) await d.run('DELETE FROM rate_events WHERE ts < ?', [now - 24 * 3600 * 1000]);
    return true;
  }

  // ---- Users ----

  const getUser = async (id) => (id ? d.first('SELECT * FROM users WHERE id = ?', [id]) : null);
  const getUserByPhone = (phone) => d.first('SELECT * FROM users WHERE phone = ?', [phone]);
  async function createUser(phone, name, passHash) {
    const isAdmin = config.adminNational && phone === config.adminNational ? 1 : 0;
    const r = await d.run('INSERT INTO users (phone, name, pass_hash, is_admin) VALUES (?, ?, ?, ?)', [
      phone,
      name,
      passHash,
      isAdmin,
    ]);
    return r.lastId;
  }

  async function setUserPassword(id, passHash) {
    await d.run('UPDATE users SET pass_hash = ? WHERE id = ?', [passHash, id]);
  }

  const setUserRole = (id, role) => d.run('UPDATE users SET role = ? WHERE id = ? AND is_admin = 0', [role, id]);
  // Suspension is temporary and reversible: the member cannot sign in and his ads leave the public pages, nothing is deleted.
  const suspendUser = (id, by) => {
    dropCounts();
    return d.run('UPDATE users SET suspended = ? WHERE id = ? AND is_admin = 0', [by, id]);
  };
  const unsuspendUser = (id) => {
    dropCounts();
    return d.run('UPDATE users SET suspended = 0 WHERE id = ?', [id]);
  };
  // A newly verified advertiser gets one month of automatic refreshing on his live ads.
  const setVerified = (id, on) =>
    d.batch([
      { sql: 'UPDATE users SET verified = ? WHERE id = ?', params: [on ? 1 : 0, id] },
      ...(on
        ? [{ sql: `UPDATE listings SET auto_until = datetime('now','+${config.autoMonthDays} days') WHERE user_id = ? AND status = 'active'`, params: [id] }]
        : []),
    ]);
  const setUserNote = (id, note) => d.run('UPDATE users SET note = ? WHERE id = ?', [note, id]);
  const suspendedUsers = () =>
    d.all(
      `SELECT u.*, s.name AS suspended_by_name FROM users u LEFT JOIN users s ON s.id = u.suspended
       WHERE u.suspended > 0 AND u.banned = 0 ORDER BY u.id DESC LIMIT 300`
    );
  const setUserName = (id, name) => d.run('UPDATE users SET name = ? WHERE id = ?', [name, id]);

  // ---- Devices: a random id kept in the person's browser (the internet address is not saved) ----

  async function recordDevice(userId, dev) {
    if (!dev) return;
    await d.run(
      `INSERT INTO user_devices (user_id, kind, val) VALUES (?, 'dev', ?)
       ON CONFLICT (user_id, kind, val) DO UPDATE SET last_seen = datetime('now')`,
      [userId, dev]
    );
  }

  async function isDeviceBanned(dev) {
    return !!(await d.first(
      "SELECT 1 AS x FROM banned_devices WHERE kind = 'dev' AND val = ? LIMIT 1",
      [dev || '']
    ));
  }

  // ---- Listings ----

  const getListing = (id) => d.first(`${LISTING_SELECT} WHERE l.id = ?`, [id]);

  async function searchListings(f) {
    const where = ["l.status = 'active'", VISIBLE_SELLER];
    const params = [];
    if (f.userId) {
      where.push('l.user_id = ?');
      params.push(f.userId);
    }
    if (f.network) {
      where.push('l.network = ?');
      params.push(f.network);
    }
    if (f.city) {
      where.push('l.city = ?');
      params.push(f.city);
    }
    if (f.min != null) {
      where.push('l.price IS NOT NULL AND l.price >= ?');
      params.push(f.min);
    }
    if (f.max != null) {
      where.push('l.price IS NOT NULL AND l.price <= ?');
      params.push(f.max);
    }
    // q, starts and ends hold digits only, so LIKE wildcards cannot appear in them.
    if (f.q) {
      where.push('l.number LIKE ?');
      params.push('%' + f.q + '%');
    }
    if (f.starts) {
      where.push('l.number LIKE ?');
      params.push(f.starts + '%');
    }
    if (f.ends) {
      where.push('l.number LIKE ?');
      params.push('%' + f.ends);
    }
    if (f.pattern) {
      where.push('instr(l.pats, ?) > 0');
      params.push(` ${f.pattern} `);
    }
    const w = where.join(' AND ');
    const order =
      f.sort === 'price_asc'
        ? '(l.price IS NULL), l.price ASC, l.id DESC'
        : f.sort === 'price_desc'
          ? '(l.price IS NULL), l.price DESC, l.id DESC'
          : 'l.created_at DESC, l.id DESC';
    const pinnedFirst = f.pinFirst === false ? '' : 'l.pinned DESC, l.featured DESC, ';

    const [count, list] = await d.batch([
      { sql: `SELECT COUNT(*) AS c FROM listings l WHERE ${w}`, params },
      {
        sql: `${LISTING_SELECT} WHERE ${w} ORDER BY ${pinnedFirst}${order} LIMIT ? OFFSET ?`,
        params: [...params, f.limit, f.offset],
      },
    ]);
    return { total: count.rows[0].c, rows: list.rows };
  }

  // Numbers close to this one: same network first, then the same last four digits, then the same city.
  async function similarListings(l, limit = 6) {
    return d.all(
      `${LISTING_SELECT} WHERE l.status = 'active' AND ${VISIBLE_SELLER} AND l.id != ? AND l.network = ?
       ORDER BY (substr(l.number, -4) = ?) DESC, (substr(l.number, -3) = ?) DESC, (l.city = ?) DESC, l.pinned DESC, l.created_at DESC, l.id DESC LIMIT ?`,
      [l.id, l.network, String(l.number).slice(-4), String(l.number).slice(-3), l.city, limit]
    );
  }

  async function countActiveByUser(userId) {
    const r = await d.first("SELECT COUNT(*) AS c FROM listings WHERE user_id = ? AND status IN ('active','pending')", [
      userId,
    ]);
    return r.c;
  }

  async function numberIsListed(number) {
    return !!(await d.first("SELECT 1 AS x FROM listings WHERE number = ? AND status IN ('active','pending') LIMIT 1", [
      number,
    ]));
  }

  // A hidden number (by staff, reports or its own owner) stays reserved: it cannot simply be posted again. Store-sync hides (-1) do not count.
  async function numberIsHeld(number) {
    return !!(await d.first(
      "SELECT 1 AS x FROM listings WHERE number = ? AND status = 'hidden' AND hidden_by <> -1 LIMIT 1",
      [number]
    ));
  }

  async function insertListing(l) {
    const r = await d.run(
      `INSERT INTO listings (user_id, number, network, city, price, contact, description, status, pats, price_type, auto_until)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${l.auto ? `datetime('now','+${config.autoMonthDays} days')` : "''"})`,
      [l.userId, l.number, l.network, l.city, l.price ?? null, l.contact, l.description, l.status, patternTags(l.number), l.priceType || '']
    );
    dropCounts();
    return r.lastId;
  }

  async function updateListing(l) {
    return (
      await d.run(
        'UPDATE listings SET network = ?, city = ?, price = ?, contact = ?, description = ?, status = ?, price_type = ? WHERE id = ? AND user_id = ?',
        [l.network, l.city, l.price ?? null, l.contact, l.description, l.status, l.priceType || '', l.id, l.userId]
      )
    ).changes;
  }

  const userListings = (userId) =>
    d.all(`${LISTING_SELECT} WHERE l.user_id = ? ORDER BY l.created_at DESC, l.id DESC`, [userId]);

  // `by` is the moderator who hid the ad (0 when anyone else did), so the senior staff can review it.
  async function setListingStatus(id, status, by = 0) {
    dropCounts();
    return (await d.run('UPDATE listings SET status = ?, hidden_by = ? WHERE id = ?', [status, status === 'hidden' ? by : 0, id]))
      .changes;
  }
  async function setOwnListingStatus(id, userId, status) {
    dropCounts();
    return (
      await d.run("UPDATE listings SET status = ?, pinned = 0 WHERE id = ? AND user_id = ? AND status = 'active'", [
        status,
        id,
        userId,
      ])
    ).changes;
  }
  async function deleteListing(id) {
    dropCounts();
    return (await d.run('DELETE FROM listings WHERE id = ?', [id])).changes;
  }
  // A sold ad stays as a record: its owner cannot delete it (the admin still can).
  // The number is remembered, so the same number cannot be posted again for a few days (penalty for delete-and-repost).
  async function deleteOwnListing(id, userId) {
    const l = await d.first("SELECT number FROM listings WHERE id = ? AND user_id = ? AND status != 'sold'", [id, userId]);
    if (!l) return 0;
    dropCounts();
    const rs = await d.batch([
      { sql: 'DELETE FROM listings WHERE id = ? AND user_id = ?', params: [id, userId] },
      {
        sql: "INSERT OR REPLACE INTO deleted_numbers (number, user_id, deleted_at) VALUES (?, ?, datetime('now'))",
        params: [l.number, userId],
      },
    ]);
    return rs[0].changes;
  }
  // Days left before this number may be posted again (0 = free to post).
  async function penaltyDaysLeft(number) {
    const r = await d.first('SELECT deleted_at FROM deleted_numbers WHERE number = ?', [number]);
    if (!r) return 0;
    const left = config.repostPenaltyDays * DAY_MS - (Date.now() - parseDbDate(r.deleted_at).getTime());
    return left > 0 ? Math.ceil(left / DAY_MS) : 0;
  }
  // Move an ad back to the top. Allowed again every `renewDays` days; returns { ok } or { ok:false, daysLeft }.
  async function renewListing(id, userId) {
    const l = await d.first("SELECT created_at, renewed_at FROM listings WHERE id = ? AND user_id = ? AND status = 'active'", [id, userId]);
    if (!l) return { ok: false, daysLeft: 0, missing: true };
    const last = parseDbDate(l.renewed_at || l.created_at).getTime();
    const left = config.renewDays * DAY_MS - (Date.now() - last);
    if (left > 0) return { ok: false, daysLeft: Math.ceil(left / DAY_MS) };
    await d.run("UPDATE listings SET created_at = datetime('now'), renewed_at = datetime('now') WHERE id = ?", [id]);
    return { ok: true };
  }
  async function setPinned(id, pinned) {
    return (await d.run('UPDATE listings SET pinned = ? WHERE id = ?', [pinned ? 1 : 0, id])).changes;
  }
  async function setFeatured(id, on) {
    return (await d.run('UPDATE listings SET featured = ? WHERE id = ?', [on ? 1 : 0, id])).changes;
  }
  async function bumpViews(id) {
    await d.batch([
      { sql: 'UPDATE listings SET views = views + 1 WHERE id = ?', params: [id] },
      {
        sql: "INSERT INTO views_daily (day, views) VALUES (date('now'), 1) ON CONFLICT (day) DO UPDATE SET views = views + 1",
        params: [],
      },
    ]);
  }

  // Verified advertiser switches the automatic refresh on again for one more month.
  async function setAutoRenew(id, userId) {
    return (
      await d.run(
        `UPDATE listings SET auto_until = datetime('now','+${config.autoMonthDays} days') WHERE id = ? AND user_id = ? AND status = 'active'`,
        [id, userId]
      )
    ).changes;
  }

  // ---- Upkeep (runs from the scheduled job, and now and then from visits) ----

  // Live ads of verified advertisers go back to the top every few days while their month lasts.
  async function autoRenew() {
    const r = await d.run(
      `UPDATE listings SET created_at = datetime('now'), renewed_at = datetime('now')
       WHERE status = 'active' AND auto_until > datetime('now')
         AND COALESCE(NULLIF(renewed_at, ''), created_at) <= datetime('now', '-${Number(config.autoRenewDays)} days')
         AND user_id IN (SELECT id FROM users WHERE verified = 1 AND banned = 0 AND suspended = 0)`
    );
    if (r.changes) dropCounts();
    return r.changes;
  }

  // The Salla store (souq3rb.com) link: one product -> the matching ad of the admin account.
  // Available -> listed (or listed again); sold out, hidden or deleted -> hidden.
  async function applyStoreProduct(item) {
    const admin = await d.first('SELECT id, phone FROM users WHERE is_admin = 1 ORDER BY id LIMIT 1');
    if (!admin) return 'no_admin';
    const ex = await d.first("SELECT id, status, hidden_by, price FROM listings WHERE number = ? AND user_id = ? ORDER BY id DESC LIMIT 1", [item.number, admin.id]);
    dropCounts();
    if (!item.available) {
      if (ex && (ex.status === 'active' || ex.status === 'pending')) {
        await d.run("UPDATE listings SET status = 'hidden', hidden_by = -1, pinned = 0 WHERE id = ?", [ex.id]);
        return 'hidden';
      }
      return 'none';
    }
    if (ex) {
      if (ex.status === 'hidden' && ex.hidden_by === -1) {
        await d.run("UPDATE listings SET status = 'active', price = ?, created_at = datetime('now') WHERE id = ?", [item.price, ex.id]);
        return 'shown';
      }
      if (ex.status === 'active' && item.price && item.price !== ex.price) {
        await d.run('UPDATE listings SET price = ? WHERE id = ?', [item.price, ex.id]);
        return 'updated';
      }
      return 'none';
    }
    if (await d.first("SELECT 1 AS x FROM listings WHERE number = ? AND status IN ('active','pending') LIMIT 1", [item.number])) return 'taken';
    await d.run(
      `INSERT INTO listings (user_id, number, network, city, price, contact, description, status, pats)
       VALUES (?, ?, ?, ?, ?, ?, '', 'active', ?)`,
      [admin.id, item.number, item.network, item.city, item.price, '966' + admin.phone, patternTags(item.number)]
    );
    return 'added';
  }

  // Whole-list sync: `items` = every number available in the store right now.
  // Missing ones are added (or shown again), prices updated, and the admin's other live ads are hidden.
  async function syncStoreList(items) {
    const admin = await d.first('SELECT id FROM users WHERE is_admin = 1 ORDER BY id LIMIT 1');
    if (!admin) return null;
    const have = new Set(items.map((x) => x.number));
    const res = { added: 0, shown: 0, updated: 0, hidden: 0, taken: 0 };
    for (const it of items) {
      const r = await applyStoreProduct({ ...it, available: true });
      if (r in res) res[r]++;
    }
    const live = await d.all("SELECT id, number FROM listings WHERE user_id = ? AND status IN ('active','pending')", [admin.id]);
    for (const l of live) {
      if (have.has(l.number)) continue;
      await d.run("UPDATE listings SET status = 'hidden', hidden_by = -1, pinned = 0 WHERE id = ?", [l.id]);
      res.hidden++;
    }
    dropCounts();
    return res;
  }

  // An ad nobody refreshed for a whole year is removed (sold ads stay as records).
  async function purgeStale() {
    const r = await d.run(
      `DELETE FROM listings WHERE status = 'active'
         AND COALESCE(NULLIF(renewed_at, ''), created_at) <= datetime('now', '-${Number(config.staleDays)} days')`
    );
    await d.run("DELETE FROM deleted_numbers WHERE deleted_at < datetime('now', '-30 days')");
    if (r.changes) dropCounts();
    return r.changes;
  }

  async function maintenance() {
    await ready();
    const renewed = await autoRenew();
    const removed = await purgeStale();
    return { renewed, removed };
  }

  // ---- Reports ----

  async function addReport(listingId, reporterKey, reason) {
    const rs = await d.batch([
      {
        sql: 'INSERT OR IGNORE INTO reports (listing_id, reporter_key, reason) VALUES (?, ?, ?)',
        params: [listingId, reporterKey, reason],
      },
      { sql: 'SELECT COUNT(*) AS c FROM reports WHERE listing_id = ?', params: [listingId] },
    ]);
    return rs[1].rows[0].c;
  }
  async function clearReports(listingId) {
    await d.run('DELETE FROM reports WHERE listing_id = ?', [listingId]);
  }

  // ---- Admin ----

  // `q` searches by number (digits) or by advertiser name (text). Pages keep the admin screens light.
  const likeSafe = (x) => String(x).replace(/[%_\\]/g, ' ').trim();
  async function adminListings(tab, { q = '', limit = 40, offset = 0 } = {}) {
    const where = ['1=1'];
    const params = [];
    if (tab === 'pending') where.push("l.status = 'pending'");
    else if (tab === 'reported') where.push(`((l.status = 'hidden' AND l.hidden_by >= 0) OR ${REPORT_COUNT_SQL} > 0)`);
    else if (tab === 'review') where.push("(l.status = 'hidden' AND l.hidden_by > 0)");
    const digits = String(q).replace(/\D/g, '');
    if (digits.length >= 2 && digits.length === String(q).trim().replace(/[\s-]/g, '').length) {
      where.push('(l.number LIKE ? OR u.phone LIKE ?)');
      params.push('%' + digits + '%', '%' + digits + '%');
    } else if (likeSafe(q)) {
      where.push('u.name LIKE ?');
      params.push('%' + likeSafe(q) + '%');
    }
    const w = where.join(' AND ');
    const rs = await d.batch([
      { sql: `SELECT COUNT(*) AS c FROM listings l JOIN users u ON u.id = l.user_id WHERE ${w}`, params },
      {
        sql: `SELECT l.*, u.name AS seller, u.phone AS seller_phone, u.banned AS seller_banned, u.suspended AS seller_suspended,
                     u.is_admin AS seller_is_admin, u.role AS seller_role, u.verified AS seller_verified, ${REPORT_COUNT_SQL} AS report_count
              FROM listings l JOIN users u ON u.id = l.user_id
              WHERE ${w}
              ORDER BY l.pinned DESC, l.featured DESC, l.created_at DESC, l.id DESC LIMIT ? OFFSET ?`,
        params: [...params, limit, offset],
      },
    ]);
    return { total: rs[0].rows[0].c, rows: rs[1].rows };
  }

  async function adminUsers({ q = '', limit = 40, offset = 0 } = {}) {
    const where = ['1=1'];
    const params = [];
    const digits = String(q).replace(/\D/g, '');
    if (digits.length >= 2 && digits.length === String(q).trim().replace(/[\s-]/g, '').length) {
      where.push('u.phone LIKE ?');
      params.push('%' + digits.replace(/^0/, '') + '%');
    } else if (likeSafe(q)) {
      where.push('u.name LIKE ?');
      params.push('%' + likeSafe(q) + '%');
    }
    const w = where.join(' AND ');
    const rs = await d.batch([
      { sql: `SELECT COUNT(*) AS c FROM users u WHERE ${w}`, params },
      {
        sql: `SELECT u.*, (SELECT COUNT(*) FROM listings l WHERE l.user_id = u.id) AS ads,
                     (SELECT COUNT(*) FROM banned_devices b WHERE b.user_id = u.id) AS banned_devices
              FROM users u WHERE ${w}
              ORDER BY COALESCE((SELECT MAX(last_seen) FROM user_devices x WHERE x.user_id = u.id), u.created_at) DESC, u.id DESC LIMIT ? OFFSET ?`,
        params: [...params, limit, offset],
      },
    ]);
    return { total: rs[0].rows[0].c, rows: rs[1].rows };
  }

  async function adminStats() {
    const one = (sql) => ({ sql, params: [] });
    const rs = await d.batch([
      one("SELECT COUNT(*) AS c FROM listings WHERE status = 'active'"),
      one("SELECT COUNT(*) AS c FROM listings WHERE status = 'pending'"),
      one('SELECT COUNT(*) AS c FROM users'),
      one(`SELECT COUNT(*) AS c FROM reports r JOIN listings l ON l.id = r.listing_id WHERE l.status IN ('active','pending')`),
      one("SELECT COUNT(*) AS c FROM listings WHERE status = 'sold'"),
      one("SELECT COUNT(*) AS c FROM users WHERE created_at >= datetime('now','-1 day')"),
      one("SELECT COUNT(*) AS c FROM users WHERE created_at >= datetime('now','-7 day')"),
      one("SELECT COUNT(*) AS c FROM listings WHERE created_at >= datetime('now','-1 day')"),
      one("SELECT COUNT(*) AS c FROM listings WHERE created_at >= datetime('now','-7 day')"),
      one('SELECT COALESCE(SUM(views),0) AS c FROM listings'),
      one("SELECT COALESCE(SUM(views),0) AS c FROM views_daily WHERE day = date('now')"),
      one("SELECT COALESCE(SUM(views),0) AS c FROM views_daily WHERE day >= date('now','-6 day')"),
      one("SELECT id, number, views FROM listings WHERE status = 'active' AND views > 0 ORDER BY views DESC, id DESC LIMIT 5"),
      one("SELECT city AS k, COUNT(*) AS c FROM listings WHERE status = 'active' GROUP BY city ORDER BY c DESC LIMIT 5"),
      one("SELECT network AS k, COUNT(*) AS c FROM listings WHERE status = 'active' GROUP BY network ORDER BY c DESC"),
    ]);
    const c = (i) => rs[i].rows[0].c;
    return {
      active: c(0),
      pending: c(1),
      users: c(2),
      reports: c(3),
      sold: c(4),
      users1: c(5),
      users7: c(6),
      ads1: c(7),
      ads7: c(8),
      viewsAll: c(9),
      viewsToday: c(10),
      views7: c(11),
      top: rs[12].rows,
      cities: rs[13].rows,
      networks: rs[14].rows,
    };
  }

  // Small numbers for the "needs your attention" badge in the header (staff only).
  async function adminAlerts() {
    const r = await d.first(`SELECT
      (SELECT COUNT(*) FROM listings WHERE status = 'pending') AS pending,
      (SELECT COUNT(*) FROM listings WHERE status = 'hidden' AND hidden_by > 0) AS review,
      (SELECT COUNT(*) FROM users WHERE suspended > 0 AND banned = 0) AS suspended,
      (SELECT COUNT(*) FROM reports r JOIN listings l ON l.id = r.listing_id WHERE l.status IN ('active','pending')) AS reports`);
    return r;
  }

  // Banning a user also bans every browser he used (the internet address is not used at all); unbanning lifts it.
  async function setUserBanned(id, banned) {
    dropCounts();
    const stmts = [{ sql: 'UPDATE users SET banned = ? WHERE id = ? AND is_admin = 0', params: [banned ? 1 : 0, id] }];
    if (banned) {
      stmts.push({
        sql: "UPDATE listings SET status = 'hidden' WHERE user_id = ? AND status IN ('active','pending') AND (SELECT is_admin FROM users WHERE id = ?) = 0",
        params: [id, id],
      });
      stmts.push({
        sql: `INSERT OR IGNORE INTO banned_devices (kind, val, user_id)
              SELECT kind, val, user_id FROM user_devices
              WHERE kind = 'dev' AND user_id = ? AND (SELECT is_admin FROM users WHERE id = ?) = 0`,
        params: [id, id],
      });
    } else {
      stmts.push({ sql: 'DELETE FROM banned_devices WHERE user_id = ?', params: [id] });
    }
    await d.batch(stmts);
  }

  const sitemapListings = () =>
    d.all(`SELECT id, created_at FROM listings l WHERE status = 'active' AND ${VISIBLE_SELLER} ORDER BY id DESC LIMIT 5000`);

  // How many live ads each network, city and price ceiling has (for landing pages, links and the sitemap).
  async function landingCounts() {
    if (countsCache && Date.now() - countsCache.at < 60000) return countsCache.value;
    const unders = UNDER_PRICES.map((n) => `SUM(CASE WHEN price IS NOT NULL AND price <= ${Number(n)} THEN 1 ELSE 0 END) AS u${Number(n)}`).join(', ');
    const rs = await d.batch([
      { sql: `SELECT network AS k, COUNT(*) AS c FROM listings l WHERE status = 'active' AND ${VISIBLE_SELLER} GROUP BY network`, params: [] },
      { sql: `SELECT city AS k, COUNT(*) AS c FROM listings l WHERE status = 'active' AND ${VISIBLE_SELLER} GROUP BY city`, params: [] },
      { sql: `SELECT ${unders} FROM listings l WHERE status = 'active' AND ${VISIBLE_SELLER}`, params: [] },
      { sql: `SELECT network || '/' || city AS k, COUNT(*) AS c FROM listings l WHERE status = 'active' AND ${VISIBLE_SELLER} GROUP BY network, city`, params: [] },
      { sql: `SELECT COUNT(*) AS c, MAX(COALESCE(NULLIF(renewed_at, ''), created_at)) AS latest FROM listings l WHERE status = 'active' AND ${VISIBLE_SELLER}`, params: [] },
    ]);
    const toMap = (rows) => Object.fromEntries(rows.map((r) => [r.k, r.c]));
    const u = rs[2].rows[0] || {};
    const value = {
      network: toMap(rs[0].rows),
      city: toMap(rs[1].rows),
      under: Object.fromEntries(UNDER_PRICES.map((n) => [n, Number(u['u' + n] || 0)])),
      combo: toMap(rs[3].rows),
      total: Number((rs[4].rows[0] || {}).c || 0),
      latest: (rs[4].rows[0] || {}).latest || '',
    };
    countsCache = { at: Date.now(), value };
    return value;
  }

  // ---- Staff tools: audit log, blocked phones, exports ----

  const logAction = (actorId, actorName, action, target = '', detail = '') =>
    d.run('INSERT INTO audit_log (actor_id, actor_name, action, target, detail) VALUES (?, ?, ?, ?, ?)', [
      actorId,
      actorName,
      action,
      String(target).slice(0, 120),
      String(detail).slice(0, 300),
    ]);
  const auditLog = () => d.all('SELECT * FROM audit_log ORDER BY id DESC LIMIT 200');

  const isPhoneBlocked = async (nat) => !!(await d.first('SELECT 1 AS x FROM blocked_phones WHERE phone = ?', [nat]));
  const blockPhone = (nat, by) => d.run('INSERT OR IGNORE INTO blocked_phones (phone, by_id) VALUES (?, ?)', [nat, by]);
  const unblockPhone = (nat) => d.run('DELETE FROM blocked_phones WHERE phone = ?', [nat]);
  const blockedPhones = () =>
    d.all(
      `SELECT b.phone, b.created_at, u.name AS by_name FROM blocked_phones b LEFT JOIN users u ON u.id = b.by_id
       ORDER BY b.created_at DESC LIMIT 500`
    );

  const exportUsers = () =>
    d.all(
      `SELECT u.id, u.name, u.phone, u.role, u.is_admin, u.verified, u.banned, u.suspended, u.created_at,
              (SELECT COUNT(*) FROM listings l WHERE l.user_id = u.id) AS ads
       FROM users u ORDER BY u.id LIMIT 50000`
    );
  const exportListings = () =>
    d.all(
      `SELECT l.id, l.number, l.network, l.city, l.price, l.price_type, l.status, l.views, l.pinned, l.featured,
              l.created_at, u.name AS seller, u.phone AS seller_phone
       FROM listings l JOIN users u ON u.id = l.user_id ORDER BY l.id LIMIT 50000`
    );

  // Bulk add for the admin: skips numbers that are already live. Returns { added, skipped }.
  async function importListings(userId, contact, items, { penalty = false, auto = false, skipHidden = false } = {}) {
    dropCounts();
    const uniq = [];
    const seen = new Set();
    for (const it of items) {
      if (seen.has(it.number)) continue;
      seen.add(it.number);
      uniq.push(it);
    }
    const taken = new Set();
    for (let i = 0; i < uniq.length; i += 80) {
      const chunk = uniq.slice(i, i + 80);
      const rows = await d.all(
        `SELECT number FROM listings WHERE status IN ('active','pending') AND number IN (${chunk.map(() => '?').join(',')})`,
        chunk.map((x) => x.number)
      );
      for (const r of rows) taken.add(r.number);
    }
    if (penalty) {
      for (const x of uniq) if (!taken.has(x.number) && (await penaltyDaysLeft(x.number)) > 0) taken.add(x.number);
    }
    // Numbers that are hidden stay hidden (staff, reports, or the owner): this only adds new ones.
    if (skipHidden) {
      for (let i = 0; i < uniq.length; i += 80) {
        const chunk = uniq.slice(i, i + 80);
        const rows = await d.all(
          `SELECT number FROM listings WHERE status = 'hidden' AND number IN (${chunk.map(() => '?').join(',')})`,
          chunk.map((x) => x.number)
        );
        for (const r of rows) taken.add(r.number);
      }
    }
    const fresh = uniq.filter((x) => !taken.has(x.number));
    for (let i = 0; i < fresh.length; i += 50) {
      await d.batch(
        fresh.slice(i, i + 50).map((x) => ({
          sql: `INSERT INTO listings (user_id, number, network, city, price, contact, description, status, pats, auto_until)
                VALUES (?, ?, ?, ?, ?, ?, '', 'active', ?, ${auto ? `datetime('now','+${config.autoMonthDays} days')` : "''"})`,
          params: [userId, x.number, x.network, x.city, x.price ?? null, contact, patternTags(x.number)],
        }))
      );
    }
    return { added: fresh.length, skipped: items.length - fresh.length };
  }

  return {
    ready,
    getSecret,
    getPlateStyle,
    setPlateStyle,
    allow,
    getUser,
    getUserByPhone,
    createUser,
    setUserPassword,
    setUserName,
    setUserRole,
    suspendUser,
    unsuspendUser,
    suspendedUsers,
    getListing,
    searchListings,
    similarListings,
    countActiveByUser,
    numberIsListed,
    numberIsHeld,
    insertListing,
    applyStoreProduct,
    syncStoreList,
    updateListing,
    userListings,
    setListingStatus,
    setOwnListingStatus,
    deleteListing,
    deleteOwnListing,
    bumpViews,
    addReport,
    clearReports,
    adminListings,
    adminUsers,
    adminStats,
    setUserBanned,
    recordDevice,
    isDeviceBanned,
    sitemapListings,
    landingCounts,
    importListings,
    setPinned,
    setAutoRenew,
    autoRenew,
    purgeStale,
    maintenance,
    setFeatured,
    setVerified,
    setUserNote,
    penaltyDaysLeft,
    renewListing,
    adminAlerts,
    logAction,
    auditLog,
    isPhoneBlocked,
    blockPhone,
    unblockPhone,
    blockedPhones,
    exportUsers,
    exportListings,
  };
}

module.exports = { createStore };
