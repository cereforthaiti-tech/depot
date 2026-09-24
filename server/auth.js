// auth.js — Minimal stateless auth tokens (HMAC-signed), zero dependencies.
// Not a full JWT implementation, but the same idea: base64(payload) + signature.

const crypto = require('crypto');

const SECRET = process.env.PLATFORM_SECRET || 'change-me-in-production-env-var';
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12h

function sign(payloadObj) {
  const payload = { ...payloadObj, exp: Date.now() + TOKEN_TTL_MS };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verify(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (sig !== expected) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload.exp || Date.now() > payload.exp) return null;
  return payload;
}

function tokenFromRequest(req) {
  const header = req.headers['authorization'] || '';
  const match = header.match(/^Bearer (.+)$/);
  return match ? match[1] : null;
}

module.exports = { sign, verify, tokenFromRequest };
