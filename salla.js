'use strict';

// Link with the Salla store (souq3rb.com): Salla calls /webhook/salla when a product changes.
// Product available -> the number is listed here; sold out / hidden / deleted -> hidden here.

const { normPhone, toLocal, toWestern } = require('./util');
const { CITIES } = require('./data');
const wc = require('./webcrypto');

const NET_RULES = [
  ['mobily', /موبايلي|mobily|فرندي/i],
  ['zain', /زين|zain/i],
  ['virgin', /فيرجن|virgin/i],
  ['lebara', /ليبارا|lebara/i],
  ['salam', /سلام|salam/i],
  ['stc', /سوا|جوي|stc|اس تي سي/i],
];

// Regions the store uses in its product links -> our city list.
const REGION_ALIASES = [
  ['الحدود الشمالية', 'arar'], ['الحدود-الشمالية', 'arar'], ['الشرقية', 'dammam'], ['القصيم', 'buraydah'], ['عسير', 'abha'],
  ['مكة', 'makkah'], ['المدينة', 'madinah'], ['الجوف', 'sakaka'], ['جازان', 'jazan'], ['نجران', 'najran'], ['الباحة', 'baha'],
  ['حائل', 'hail'], ['تبوك', 'tabuk'],
];

function cityOf(text) {
  const s = String(text || '');
  for (const c of CITIES) if (c.key !== 'other' && s.includes(c.ar)) return c.key;
  for (const [w, k] of REGION_ALIASES) if (s.includes(w)) return k;
  return 'other';
}

function networkOf(text) {
  for (const [k, re] of NET_RULES) if (re.test(text)) return k;
  return 'stc';
}

// Salla product object -> { number, price, network, city, available } or null if the name has no number.
function fromProduct(p) {
  if (!p || typeof p !== 'object') return null;
  const name = toWestern(String(p.name || ''));
  const m = name.match(/(?:\+?966[\s-]*|0)?5(?:[\s-]*\d){8}/);
  if (!m) return null;
  const nat = normPhone(m[0].replace(/[\s-]/g, ''));
  if (!nat) return null;
  let url = String(p.url || (p.urls && p.urls.customer) || '');
  try {
    url = decodeURIComponent(url);
  } catch {
    /* keep raw */
  }
  const amount = p.price && typeof p.price === 'object' ? p.price.amount : p.price;
  const price = Number.isFinite(Number(amount)) && Number(amount) > 0 ? Math.round(Number(amount)) : null;
  const qty = Number(p.quantity);
  const stocked = p.unlimited_quantity === true || (Number.isFinite(qty) && qty > 0);
  const status = p.status === undefined || p.status === null ? 'sale' : String(p.status);
  return {
    number: toLocal(nat),
    price,
    network: networkOf(name),
    city: cityOf(url + ' ' + name),
    available: status === 'sale' && stocked && p.is_available !== false,
  };
}

// The request is accepted if it carries the shared secret (as Salla's signature, or as a token header).
async function verify(request, rawBody, secret) {
  if (!secret) return false;
  const h = (n) => String(request.headers.get(n) || '').trim();
  const sig = h('x-salla-signature');
  if (sig) {
    const hex = await wc.hmacHex(secret, rawBody);
    if (wc.safeEqual(sig.toLowerCase().replace(/^sha256=/, ''), hex)) return true;
  }
  for (const v of [h('authorization'), h('x-salla-token'), h('x-webhook-token'), h('x-token')]) {
    if (v && (wc.safeEqual(v, secret) || wc.safeEqual(v, 'Bearer ' + secret))) return true;
  }
  return false;
}

// Returns a Response. Never throws on bad input.
async function handleWebhook(request, store, secret) {
  const raw = await request.text();
  if (raw.length > 400000) return new Response('too large', { status: 413 });
  if (!(await verify(request, raw, secret))) return new Response('unauthorized', { status: 401 });
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response('bad json', { status: 400 });
  }
  const event = String(payload.event || '');
  if (!event.startsWith('product.')) return new Response('ignored', { status: 200 });
  const list = Array.isArray(payload.data) ? payload.data : [payload.data];
  let done = 0;
  for (const p of list) {
    const item = fromProduct(p);
    if (!item) continue;
    if (event === 'product.deleted') item.available = false;
    await store.applyStoreProduct(item);
    done++;
  }
  return new Response(JSON.stringify({ ok: true, done }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

module.exports = { fromProduct, handleWebhook, verify };
