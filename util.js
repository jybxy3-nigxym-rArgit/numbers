'use strict';

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Turn Arabic-Indic and Persian digits into 0-9.
function toWestern(s) {
  return String(s ?? '')
    .replace(/[٠-٩]/g, (c) => AR_DIGITS.indexOf(c))
    .replace(/[۰-۹]/g, (c) => FA_DIGITS.indexOf(c));
}

function digitsOnly(s) {
  return toWestern(s).replace(/\D/g, '');
}

// Accepts 0555123456, 555123456, 966555123456, +966 55 512 3456, 00966..., Arabic digits.
// Returns the 9-digit national number ("555123456") or null.
function normPhone(input) {
  let d = digitsOnly(input);
  if (d.startsWith('00966')) d = d.slice(5);
  else if (d.startsWith('966')) d = d.slice(3);
  if (d.startsWith('0')) d = d.slice(1);
  return /^5\d{8}$/.test(d) ? d : null;
}

const toLocal = (national) => '0' + national; // 0555123456
const toIntl = (national) => '966' + national; // 966555123456
const intlToLocal = (intl) => '0' + String(intl).slice(3);

// ---- Number patterns -------------------------------------------------------

const RE = {
  triple: /(\d)\1{2}/,
  quad: /(\d)\1{3}/,
  ends_same: /(\d)\1{2}$/,
  mirror: /(\d)(\d)\2\1$/,
  pairs: /(\d)\1(\d)\2$|(\d)(\d)\3\4$/,
};

function hasSequence(n, len = 4) {
  for (let i = 0; i + len <= n.length; i++) {
    let up = true;
    let down = true;
    for (let j = 1; j < len; j++) {
      const prev = Number(n[i + j - 1]);
      const cur = Number(n[i + j]);
      if (cur !== prev + 1) up = false;
      if (cur !== prev - 1) down = false;
    }
    if (up || down) return true;
  }
  return false;
}

function matchesPattern(number, key) {
  const n = String(number);
  if (key === 'sequence') return hasSequence(n);
  const re = RE[key];
  return re ? re.test(n) : false;
}

const PATTERN_LIST = ['triple', 'quad', 'ends_same', 'mirror', 'sequence', 'pairs'];

// Stored with each ad so searches can filter in plain SQL, e.g. " triple quad ".
function patternTags(number) {
  return ' ' + PATTERN_LIST.filter((k) => matchesPattern(number, k)).join(' ') + ' ';
}

// Which digit positions to highlight: runs of 3+ same digits and 4+ sequences.
function hitMask(number) {
  const n = String(number);
  const mask = new Array(n.length).fill(false);
  for (const m of n.matchAll(/(\d)\1{2,}/g)) {
    for (let i = m.index; i < m.index + m[0].length; i++) mask[i] = true;
  }
  for (let i = 0; i + 4 <= n.length; i++) {
    if (hasSequence(n.slice(i, i + 4))) {
      for (let k = i; k < i + 4; k++) mask[k] = true;
    }
  }
  return mask;
}

// "0555123456" -> <b><span>0</span>...</b> grouped 4-3-3, runs wrapped in .hit
function plateDigits(number) {
  const n = String(number);
  const mask = hitMask(n);
  let idx = 0;
  let out = '';
  for (const size of [4, 3, 3]) {
    let group = '';
    for (let k = 0; k < size && idx < n.length; k++, idx++) {
      group += `<span${mask[idx] ? ' class="hit"' : ''}>${esc(n[idx])}</span>`;
    }
    out += `<b>${group}</b>`;
  }
  return out;
}

function formatNumberPlain(number) {
  const n = String(number);
  return `${n.slice(0, 4)} ${n.slice(4, 7)} ${n.slice(7)}`;
}

// ---- Time and money --------------------------------------------------------

function parseDbDate(s) {
  return new Date(String(s).replace(' ', 'T') + 'Z');
}

// Saudi time (UTC+3) as "2026-10-31 9:05 م" / "9:05 PM", from a database timestamp (UTC).
function riyadhStamp(s, lang) {
  const d = new Date(parseDbDate(s).getTime() + 3 * 3600 * 1000);
  if (isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  const h = d.getUTCHours();
  const suffix = h < 12 ? (lang === 'ar' ? 'ص' : 'AM') : lang === 'ar' ? 'م' : 'PM';
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${h % 12 || 12}:${p(d.getUTCMinutes())} ${suffix}`;
}

function daysSince(s) {
  const ms = Date.now() - parseDbDate(s).getTime();
  return Math.max(0, Math.floor(ms / 86400000));
}

function formatPrice(price) {
  return new Intl.NumberFormat('en-US').format(price);
}

// Ad details must not send buyers elsewhere: no links, websites, social accounts or @handles.
const OUTSIDE_RE = new RegExp(
  [
    'https?:|ftp:|www\\.|[a-z0-9-]+\\.(?:com|net|org|sa|co|io|me|ly|app|link|store|shop|info|xyz|cc|tv|ae|kw|bh|qa|eg|ws|site|online|page)\\b',
    '@\\w',
    'snap|سناب|insta|انستا|إنستا|انستقرام|twitter|تويتر|tiktok|تيك ?توك|telegram|تلقرام|تلجرام|تليجرام|تيليجرام|t\\.me|facebook|فيسبوك|فيس بوك|youtube|يوتيوب|linkedin|haraj|حراج|wa\\.me|رابط|لينك|link|موقع|website',
  ].join('|'),
  'iu'
);
const hasOutsideContact = (text) => OUTSIDE_RE.test(toWestern(String(text ?? '')));

// Staff levels: 3 = site owner (the admin phone), 2 = general moderator (مشرف عام), 1 = moderator (مشرف), 0 = everyone else.
const rankOf = (u) => (!u ? 0 : u.is_admin ? 3 : u.role === 'super' ? 2 : u.role === 'mod' ? 1 : 0);
// A staff member can act on himself or on someone of a lower level, never on his equals or above.
const canActOn = (actor, target) => !!actor && !!target && (actor.id === target.id || rankOf(actor) > rankOf(target));

// Numbers that need a staff look before they go live.
// 'review' = one digit fills 7 or more of the 9 digits after the leading 0 (like 0555555593): waits for any staff member.
// 'hold'   = a two-digit pair repeats 7+ times in a row (like 0585858587): hidden until the owner checks it.
function numberRisk(number) {
  const d = String(number || '');
  if (!/^05\d{8}$/.test(d)) return '';
  const counts = {};
  for (const ch of d.slice(1)) counts[ch] = (counts[ch] || 0) + 1;
  if (Math.max(...Object.values(counts)) >= 7) return 'review';
  let run = 2;
  for (let i = 2; i < d.length; i++) {
    run = d[i] === d[i - 2] && d[i] !== d[i - 1] ? run + 1 : 2;
    if (run >= 7) return 'hold';
  }
  return '';
}

module.exports = {
  numberRisk,
  hasOutsideContact,
  rankOf,
  canActOn,
  esc,
  toWestern,
  digitsOnly,
  normPhone,
  toLocal,
  toIntl,
  intlToLocal,
  matchesPattern,
  patternTags,
  hasSequence,
  hitMask,
  plateDigits,
  formatNumberPlain,
  parseDbDate,
  daysSince,
  riyadhStamp,
  formatPrice,
};
