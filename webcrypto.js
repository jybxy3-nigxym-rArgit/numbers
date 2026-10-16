'use strict';

// Crypto helpers built on Web Crypto only, so the same code runs on Node and on Cloudflare Workers.

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

function toB64u(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64u(str) {
  const b64 = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const textToB64u = (text) => toB64u(enc.encode(text));
const b64uToText = (b64) => dec.decode(fromB64u(b64));

function randomToken(bytes = 18) {
  return toB64u(globalThis.crypto.getRandomValues(new Uint8Array(bytes)));
}

// A short password people can read out loud: no 0/O, 1/l/I confusion.
function randomPassword(length = 10) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  while (out.length < length) {
    for (const b of globalThis.crypto.getRandomValues(new Uint8Array(32))) {
      if (b < 248 && out.length < length) out += alphabet[b % alphabet.length]; // 248 = 31 * 8, so no bias
    }
  }
  return out;
}

// Constant-time comparison of two strings.
function safeEqual(a, b) {
  a = String(a);
  b = String(b);
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

const hmacKeys = new Map();
async function hmacKey(secret) {
  let k = hmacKeys.get(secret);
  if (!k) {
    k = await subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    hmacKeys.set(secret, k);
  }
  return k;
}

async function hmac(secret, value) {
  const sig = await subtle.sign('HMAC', await hmacKey(secret), enc.encode(value));
  return toB64u(new Uint8Array(sig));
}

async function sha256Hex(text) {
  const d = new Uint8Array(await subtle.digest('SHA-256', enc.encode(text)));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---- Passwords: PBKDF2-SHA256. The iteration count is stored in the hash, so it can be raised later. ----

async function pbkdf2(password, salt, iterations, bytes = 32) {
  const key = await subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, bytes * 8);
  return new Uint8Array(bits);
}

async function hashPassword(password, iterations) {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const key = await pbkdf2(password, salt, iterations);
  return `pbkdf2$${iterations}$${toB64u(salt)}$${toB64u(key)}`;
}

async function verifyPassword(password, stored, fallbackIterations) {
  const [alg, iterStr, saltB64, keyB64] = String(stored).split('$');
  if (alg !== 'pbkdf2' || !saltB64 || !keyB64) return false;
  const iterations = Math.min(100000, Math.max(1000, parseInt(iterStr, 10) || fallbackIterations));
  const expected = fromB64u(keyB64);
  const key = await pbkdf2(password, fromB64u(saltB64), iterations, expected.length);
  return safeEqual(toB64u(key), keyB64);
}

module.exports = {
  toB64u,
  fromB64u,
  textToB64u,
  b64uToText,
  randomToken,
  randomPassword,
  safeEqual,
  hmac,
  sha256Hex,
  hashPassword,
  verifyPassword,
};
