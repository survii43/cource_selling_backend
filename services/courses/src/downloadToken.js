'use strict';
const crypto = require('crypto');

function signingSecret() {
  const s = process.env.ACCESS_SIGNING_SECRET || process.env.JWT_SECRET;
  if (!s || s.length < 16) {
    throw new Error('ACCESS_SIGNING_SECRET or JWT_SECRET must be at least 16 characters');
  }
  return s;
}

function signDownloadPayload(payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', signingSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyDownloadToken(token) {
  const s = String(token);
  const dot = s.indexOf('.');
  if (dot <= 0) {
    return null;
  }
  const body = s.slice(0, dot);
  const sig = s.slice(dot + 1);
  const expected = crypto.createHmac('sha256', signingSecret()).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return null;
  }
  try {
    const json = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (json.exp && Date.now() / 1000 > json.exp) {
      return null;
    }
    return json;
  } catch {
    return null;
  }
}

module.exports = { signDownloadPayload, verifyDownloadToken };
