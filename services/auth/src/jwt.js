'use strict';
const jwt = require('jsonwebtoken');

function secret() {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 16) {
    throw new Error('JWT_SECRET must be set and at least 16 characters');
  }
  return s;
}

function signAccessToken(payload) {
  return jwt.sign(payload, secret(), { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
}

function verifyAccessToken(token) {
  return jwt.verify(token, secret());
}

module.exports = { signAccessToken, verifyAccessToken, secret };
