import crypto from 'node:crypto';
import { hmac } from './utils.js';

function timingSafeEqualText(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

export function createUserToken(secret, userId, accessVersion = 1) {
  const payload = `${userId}.${accessVersion}`;
  return `${payload}.${hmac(secret, payload)}`;
}

export function verifyUserToken(secret, token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const [userId, versionText, signature] = parts;
  const payload = `${userId}.${versionText}`;
  const expected = hmac(secret, payload);
  if (!timingSafeEqualText(signature, expected)) return null;
  const accessVersion = Number.parseInt(versionText, 10);
  if (!Number.isInteger(accessVersion)) return null;
  return { userId, accessVersion };
}

function compactUserReference(userId) {
  const match = String(userId).match(/^user_([0-9a-f]{32})$/i);
  if (!match) return null;
  return Buffer.from(match[1], 'hex').toString('base64url');
}

function expandUserReference(reference) {
  try {
    const bytes = Buffer.from(String(reference), 'base64url');
    if (bytes.length !== 16) return null;
    return `user_${bytes.toString('hex')}`;
  } catch {
    return null;
  }
}

export function createBindingToken(secret, userId, channel, expiresAt) {
  const userReference = compactUserReference(userId);
  if (!userReference) throw new Error('Binding tokens require a standard Knowledge Pilot user ID');

  // Telegram deep-link start parameters are limited to 64 characters and may
  // contain only A-Z, a-z, 0-9, underscore, and hyphen. This fixed-width token
  // is 52 characters, URL-safe, signed, and includes an expiry timestamp.
  const expiresAtSeconds = Math.floor(Number(expiresAt) / 1000);
  const expiry = expiresAtSeconds.toString(36).padStart(8, '0');
  const payload = `${userId}.${channel}.${expiry}`;
  const signature = hmac(secret, payload).slice(0, 20);
  return `t1${userReference}${expiry}${signature}`;
}

export function verifyBindingToken(secret, token, expectedChannel) {
  const value = String(token || '');

  if (value.startsWith('t1') && value.length === 52 && /^[A-Za-z0-9_-]+$/.test(value)) {
    const userReference = value.slice(2, 24);
    const expiry = value.slice(24, 32);
    const signature = value.slice(32, 52);
    const userId = expandUserReference(userReference);
    const expiresAtSeconds = Number.parseInt(expiry, 36);
    if (!userId || !Number.isFinite(expiresAtSeconds)) return null;
    const payload = `${userId}.${expectedChannel}.${expiry}`;
    const expected = hmac(secret, payload).slice(0, 20);
    if (!timingSafeEqualText(signature, expected)) return null;
    const expiresAt = expiresAtSeconds * 1000;
    if (Date.now() > expiresAt) return null;
    return { userId, channel: expectedChannel, expiresAt };
  }

  // Backward compatibility for links generated before version 1.0.2.
  const [encoded, signature] = value.split('.');
  if (!encoded || !signature) return null;
  let payload;
  try { payload = Buffer.from(encoded, 'base64url').toString('utf8'); } catch { return null; }
  const expected = hmac(secret, payload).slice(0, 22);
  if (!timingSafeEqualText(signature, expected)) return null;
  const [userId, channel, expiresAtText] = payload.split('.');
  const expiresAt = Number(expiresAtText);
  if (channel !== expectedChannel || !Number.isFinite(expiresAt) || Date.now() > expiresAt) return null;
  return { userId, channel, expiresAt };
}

export function parseCookies(header = '') {
  return Object.fromEntries(String(header).split(';').map((part) => {
    const index = part.indexOf('=');
    if (index < 0) return [part.trim(), ''];
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }).filter(([key]) => key));
}

export function cookie(name, value, { maxAge = 60 * 60 * 24 * 30, secure = true, httpOnly = true, sameSite = 'Lax', path = '/' } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, `Max-Age=${maxAge}`, `SameSite=${sameSite}`];
  if (secure) parts.push('Secure');
  if (httpOnly) parts.push('HttpOnly');
  return parts.join('; ');
}

export function adminTokenMatches(expected, provided) {
  return timingSafeEqualText(expected, provided || '');
}
