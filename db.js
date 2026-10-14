'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');
const { matchesPattern } = require('./util');

fs.mkdirSync(config.dataDir, { recursive: true });

const db = new DatabaseSync(path.join(config.dataDir, 'site.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  phone       TEXT NOT NULL UNIQUE,          -- 9-digit national number, e.g. 555123456
  name        TEXT NOT NULL,
  pass_hash   TEXT NOT NULL,
  is_admin    INTEGER NOT NULL DEFAULT 0,
  banned      INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS listings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  number      TEXT NOT NULL,                 -- number for sale, e.g. 0555123456
  network     TEXT NOT NULL,
  city        TEXT NOT NULL,
  price       INTEGER,                       -- SAR, NULL = ask for price
  contact     TEXT NOT NULL,                 -- WhatsApp number, e.g. 966555123456
  description TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'active', -- active | pending | sold | hidden
  views       INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_listings_status_created ON listings(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_listings_user ON listings(user_id);
CREATE INDEX IF NOT EXISTS idx_listings_number ON listings(number);

CREATE TABLE IF NOT EXISTS reports (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id   INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  reporter_key TEXT NOT NULL,
  reason       TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (listing_id, reporter_key)
);
`);

db.function('matches_pattern', { deterministic: true }, (number, key) =>
  matchesPattern(number, key) ? 1 : 0
);

// A secret for signing session cookies. Kept in the data folder so logins survive restarts.
function loadSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const file = path.join(config.dataDir, 'session-secret');
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    const secret = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(file, secret, { mode: 0o600 });
    return secret;
  }
}
const secret = loadSecret();

if (config.adminNational) {
  db.prepare('UPDATE users SET is_admin = 1 WHERE phone = ?').run(config.adminNational);
}

// ---- Users -----------------------------------------------------------------

const q = {
  userById: db.prepare('SELECT * FROM users WHERE id = ?'),
  userByPhone: db.prepare('SELECT * FROM users WHERE phone = ?'),
  insertUser: db.prepare('INSERT INTO users (phone, name, pass_hash, is_admin) VALUES (?, ?, ?, ?)'),
};

function getUser(id) {
  return id ? q.userById.get(id) : undefined;
}
function getUserByPhone(phone) {
  return q.userByPhone.get(phone);
}
function createUser(phone, name, passHash) {
  const isAdmin = config.adminNational && phone === config.adminNational ? 1 : 0;
  const r = q.insertUser.run(phone, name, passHash, isAdmin);
  return Number(r.lastInsertRowid);
}

// ---- Listings --------------------------------------------------------------

const LISTING_SELECT = `
  SELECT l.*, u.name AS seller, u.banned AS seller_banned
  FROM listings l JOIN users u ON u.id = l.user_id`;

function getListing(id) {
  return db.prepare(`${LISTING_SELECT} WHERE l.id = ?`).get(id);
}

function searchListings(f) {
  const where = ["l.status = 'active'"];
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
    where.push('matches_pattern(l.number, ?) = 1');
    params.push(f.pattern);
  }
  const w = where.join(' AND ');
  const order =
    f.sort === 'price_asc'
      ? '(l.price IS NULL), l.price ASC, l.id DESC'
      : f.sort === 'price_desc'
        ? '(l.price IS NULL), l.price DESC, l.id DESC'
        : 'l.created_at DESC, l.id DESC';

  const total = db.prepare(`SELECT COUNT(*) AS c FROM listings l WHERE ${w}`).get(...params).c;
  const rows = db
    .prepare(`${LISTING_SELECT} WHERE ${w} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...params, f.limit, f.offset);
  return { total, rows };
}

function countActiveByUser(userId) {
  return db
    .prepare("SELECT COUNT(*) AS c FROM listings WHERE user_id = ? AND status IN ('active','pending')")
    .get(userId).c;
}

function numberIsListed(number) {
  return !!db
    .prepare("SELECT 1 FROM listings WHERE number = ? AND status IN ('active','pending') LIMIT 1")
    .get(number);
}

function insertListing(l) {
  const r = db
    .prepare(
      `INSERT INTO listings (user_id, number, network, city, price, contact, description, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(l.userId, l.number, l.network, l.city, l.price, l.contact, l.description, l.status);
  return Number(r.lastInsertRowid);
}

function userListings(userId) {
  return db
    .prepare(`${LISTING_SELECT} WHERE l.user_id = ? ORDER BY l.created_at DESC, l.id DESC`)
    .all(userId);
}

function setListingStatus(id, status) {
  return db.prepare('UPDATE listings SET status = ? WHERE id = ?').run(status, id).changes;
}
function setOwnListingStatus(id, userId, status) {
  return db
    .prepare('UPDATE listings SET status = ? WHERE id = ? AND user_id = ?')
    .run(status, id, userId).changes;
}
function deleteListing(id) {
  return db.prepare('DELETE FROM listings WHERE id = ?').run(id).changes;
}
function deleteOwnListing(id, userId) {
  return db.prepare('DELETE FROM listings WHERE id = ? AND user_id = ?').run(id, userId).changes;
}
function bumpViews(id) {
  db.prepare('UPDATE listings SET views = views + 1 WHERE id = ?').run(id);
}

// ---- Reports ---------------------------------------------------------------

function addReport(listingId, reporterKey, reason) {
  db.prepare(
    'INSERT OR IGNORE INTO reports (listing_id, reporter_key, reason) VALUES (?, ?, ?)'
  ).run(listingId, reporterKey, reason);
  return db.prepare('SELECT COUNT(*) AS c FROM reports WHERE listing_id = ?').get(listingId).c;
}
function clearReports(listingId) {
  db.prepare('DELETE FROM reports WHERE listing_id = ?').run(listingId);
}

// ---- Admin -----------------------------------------------------------------

const REPORT_COUNT_SQL = '(SELECT COUNT(*) FROM reports r WHERE r.listing_id = l.id)';

function adminListings(tab) {
  let where = '1=1';
  if (tab === 'pending') where = "l.status = 'pending'";
  else if (tab === 'reported') where = `(l.status = 'hidden' OR ${REPORT_COUNT_SQL} > 0)`;
  return db
    .prepare(
      `SELECT l.*, u.name AS seller, u.phone AS seller_phone, u.banned AS seller_banned,
              ${REPORT_COUNT_SQL} AS report_count
       FROM listings l JOIN users u ON u.id = l.user_id
       WHERE ${where}
       ORDER BY l.created_at DESC, l.id DESC LIMIT 300`
    )
    .all();
}

function adminUsers() {
  return db
    .prepare(
      `SELECT u.*, (SELECT COUNT(*) FROM listings l WHERE l.user_id = u.id) AS ads
       FROM users u ORDER BY u.created_at DESC, u.id DESC LIMIT 300`
    )
    .all();
}

function adminStats() {
  return {
    active: db.prepare("SELECT COUNT(*) AS c FROM listings WHERE status = 'active'").get().c,
    pending: db.prepare("SELECT COUNT(*) AS c FROM listings WHERE status = 'pending'").get().c,
    users: db.prepare('SELECT COUNT(*) AS c FROM users').get().c,
    reports: db
      .prepare(
        `SELECT COUNT(*) AS c FROM reports r JOIN listings l ON l.id = r.listing_id
         WHERE l.status IN ('active','pending')`
      )
      .get().c,
  };
}

function setUserBanned(id, banned) {
  db.prepare('UPDATE users SET banned = ? WHERE id = ? AND is_admin = 0').run(banned ? 1 : 0, id);
  if (banned) {
    db.prepare(
      "UPDATE listings SET status = 'hidden' WHERE user_id = ? AND status IN ('active','pending')"
    ).run(id);
  }
}

function sitemapListings() {
  return db
    .prepare("SELECT id, created_at FROM listings WHERE status = 'active' ORDER BY id DESC LIMIT 5000")
    .all();
}

module.exports = {
  db,
  secret,
  getUser,
  getUserByPhone,
  createUser,
  getListing,
  searchListings,
  countActiveByUser,
  numberIsListed,
  insertListing,
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
  sitemapListings,
};
