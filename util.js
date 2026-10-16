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

function daysSince(s) {
  const ms = Date.now() - parseDbDate(s).getTime();
  return Math.max(0, Math.floor(ms / 86400000));
}

function formatPrice(price) {
  return new Intl.NumberFormat('en-US').format(price);
}

module.exports = {
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
  formatPrice,
};
