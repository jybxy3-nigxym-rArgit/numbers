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
const { patternTags } = require('./util');
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
  'CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS rate_events (k TEXT NOT NULL, ts INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS idx_rate_k ON rate_events(k, ts)',
];

const LISTING_SELECT = `
  SELECT l.*, u.name AS seller, u.banned AS seller_banned, u.suspended AS seller_suspended,
         u.is_admin AS seller_is_admin, u.role AS seller_role
  FROM listings l JOIN users u ON u.id = l.user_id`;

// Ads of banned or suspended members stay out of every public list.
const VISIBLE_SELLER = 'l.user_id NOT IN (SELECT id FROM users WHERE banned = 1 OR suspended > 0)';

const REPORT_COUNT_SQL = '(SELECT COUNT(*) FROM reports r WHERE r.listing_id = l.id)';

function createStore(d) {
  let readyPromise = null;
  let secretCache = null;

  // Creates the tables if they are missing and promotes the admin phone. Runs once per process.
  function ready() {
    if (!readyPromise) {
      readyPromise = (async () => {
        await d.batch(SCHEMA.map((sql) => ({ sql, params: [] })));
        // Columns added after the first release: add them to databases that already exist.
        const cols = (await d.all('PRAGMA table_info(listings)')).map((c) => c.name);
        const ucols = (await d.all('PRAGMA table_info(users)')).map((c) => c.name);
        if (!ucols.includes('role')) {
          await d.run("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'").catch(() => {});
        }
        if (!ucols.includes('suspended')) {
          await d.run('ALTER TABLE users ADD COLUMN suspended INTEGER NOT NULL DEFAULT 0').catch(() => {});
        }
        if (!cols.includes('hidden_by')) {
          await d.run('ALTER TABLE listings ADD COLUMN hidden_by INTEGER NOT NULL DEFAULT 0').catch(() => {});
        }
        if (!cols.includes('pinned')) {
          await d.run('ALTER TABLE listings ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0').catch(() => {});
        }
        if (config.adminNational) {
          await d.run('UPDATE users SET is_admin = 1 WHERE phone = ?', [config.adminNational]);
        }
      })().catch((err) => {
        readyPromise = null; // try again on the next request
        throw err;
      });
    }
    return readyPromise;
  }

  // Secret used to sign session cookies. Set SESSION_SECRET, or one is generated and kept in the database.
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
  const suspendUser = (id, by) => d.run('UPDATE users SET suspended = ? WHERE id = ? AND is_admin = 0', [by, id]);
  const unsuspendUser = (id) => d.run('UPDATE users SET suspended = 0 WHERE id = ?', [id]);
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
    const pinnedFirst = f.pinFirst === false ? '' : 'l.pinned DESC, ';

    const [count, list] = await d.batch([
      { sql: `SELECT COUNT(*) AS c FROM listings l WHERE ${w}`, params },
      {
        sql: `${LISTING_SELECT} WHERE ${w} ORDER BY ${pinnedFirst}${order} LIMIT ? OFFSET ?`,
        params: [...params, f.limit, f.offset],
      },
    ]);
    return { total: count.rows[0].c, rows: list.rows };
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

  async function insertListing(l) {
    const r = await d.run(
      `INSERT INTO listings (user_id, number, network, city, price, contact, description, status, pats)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [l.userId, l.number, l.network, l.city, l.price ?? null, l.contact, l.description, l.status, patternTags(l.number)]
    );
    return r.lastId;
  }

  async function updateListing(l) {
    return (
      await d.run(
        'UPDATE listings SET network = ?, city = ?, price = ?, contact = ?, description = ?, status = ? WHERE id = ? AND user_id = ?',
        [l.network, l.city, l.price ?? null, l.contact, l.description, l.status, l.id, l.userId]
      )
    ).changes;
  }

  const userListings = (userId) =>
    d.all(`${LISTING_SELECT} WHERE l.user_id = ? ORDER BY l.created_at DESC, l.id DESC`, [userId]);

  // `by` is the moderator who hid the ad (0 when anyone else did), so the senior staff can review it.
  async function setListingStatus(id, status, by = 0) {
    return (await d.run('UPDATE listings SET status = ?, hidden_by = ? WHERE id = ?', [status, status === 'hidden' ? by : 0, id]))
      .changes;
  }
  async function setOwnListingStatus(id, userId, status) {
    return (
      await d.run("UPDATE listings SET status = ?, pinned = 0 WHERE id = ? AND user_id = ? AND status = 'active'", [
        status,
        id,
        userId,
      ])
    ).changes;
  }
  async function deleteListing(id) {
    return (await d.run('DELETE FROM listings WHERE id = ?', [id])).changes;
  }
  // A sold ad stays as a record: its owner cannot delete it (the admin still can).
  async function deleteOwnListing(id, userId) {
    return (await d.run("DELETE FROM listings WHERE id = ? AND user_id = ? AND status != 'sold'", [id, userId])).changes;
  }
  async function setPinned(id, pinned) {
    return (await d.run('UPDATE listings SET pinned = ? WHERE id = ?', [pinned ? 1 : 0, id])).changes;
  }
  async function bumpViews(id) {
    await d.run('UPDATE listings SET views = views + 1 WHERE id = ?', [id]);
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

  function adminListings(tab) {
    let where = '1=1';
    if (tab === 'pending') where = "l.status = 'pending'";
    else if (tab === 'reported') where = `(l.status = 'hidden' OR ${REPORT_COUNT_SQL} > 0)`;
    else if (tab === 'review') where = "(l.status = 'hidden' AND l.hidden_by > 0)";
    return d.all(
      `SELECT l.*, u.name AS seller, u.phone AS seller_phone, u.banned AS seller_banned, u.suspended AS seller_suspended,
              u.is_admin AS seller_is_admin, u.role AS seller_role, ${REPORT_COUNT_SQL} AS report_count
       FROM listings l JOIN users u ON u.id = l.user_id
       WHERE ${where}
       ORDER BY l.created_at DESC, l.id DESC LIMIT 300`
    );
  }

  const adminUsers = () =>
    d.all(
      `SELECT u.*, (SELECT COUNT(*) FROM listings l WHERE l.user_id = u.id) AS ads,
              (SELECT COUNT(*) FROM banned_devices b WHERE b.user_id = u.id) AS banned_devices
       FROM users u ORDER BY u.created_at DESC, u.id DESC LIMIT 300`
    );

  async function adminStats() {
    const rs = await d.batch([
      { sql: "SELECT COUNT(*) AS c FROM listings WHERE status = 'active'", params: [] },
      { sql: "SELECT COUNT(*) AS c FROM listings WHERE status = 'pending'", params: [] },
      { sql: 'SELECT COUNT(*) AS c FROM users', params: [] },
      {
        sql: `SELECT COUNT(*) AS c FROM reports r JOIN listings l ON l.id = r.listing_id
              WHERE l.status IN ('active','pending')`,
        params: [],
      },
    ]);
    return { active: rs[0].rows[0].c, pending: rs[1].rows[0].c, users: rs[2].rows[0].c, reports: rs[3].rows[0].c };
  }

  // Banning a user also bans every browser he used (the internet address is not used at all); unbanning lifts it.
  async function setUserBanned(id, banned) {
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

  // How many live ads each network and city has (for landing pages, links and the sitemap).
  async function landingCounts() {
    const rs = await d.batch([
      { sql: `SELECT network AS k, COUNT(*) AS c FROM listings l WHERE status = 'active' AND ${VISIBLE_SELLER} GROUP BY network`, params: [] },
      { sql: `SELECT city AS k, COUNT(*) AS c FROM listings l WHERE status = 'active' AND ${VISIBLE_SELLER} GROUP BY city`, params: [] },
    ]);
    const toMap = (rows) => Object.fromEntries(rows.map((r) => [r.k, r.c]));
    return { network: toMap(rs[0].rows), city: toMap(rs[1].rows) };
  }

  // Bulk add for the admin: skips numbers that are already live. Returns { added, skipped }.
  async function importListings(userId, contact, items) {
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
    const fresh = uniq.filter((x) => !taken.has(x.number));
    for (let i = 0; i < fresh.length; i += 50) {
      await d.batch(
        fresh.slice(i, i + 50).map((x) => ({
          sql: `INSERT INTO listings (user_id, number, network, city, price, contact, description, status, pats)
                VALUES (?, ?, ?, ?, ?, ?, '', 'active', ?)`,
          params: [userId, x.number, x.network, x.city, x.price ?? null, contact, patternTags(x.number)],
        }))
      );
    }
    return { added: fresh.length, skipped: items.length - fresh.length };
  }

  return {
    ready,
    getSecret,
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
    countActiveByUser,
    numberIsListed,
    insertListing,
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
  };
}

module.exports = { createStore };
