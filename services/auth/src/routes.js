'use strict';
const bcrypt = require('bcrypt');
const { z } = require('zod');
const { pool } = require('./db');
const { signAccessToken, verifyAccessToken } = require('./jwt');

const registerSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
});

const loginSchema = registerSchema;

function router() {
  const express = require('express');
  const r = express.Router();

  r.post('/register', async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
    }
    const { email, password } = parsed.data;
    const passwordHash = await bcrypt.hash(password, 12);
    try {
      const [result] = await pool().query(
        'INSERT INTO users (email, password_hash, role, token_version) VALUES (?, ?, ?, 0)',
        [email.toLowerCase(), passwordHash, 'customer'],
      );
      const userId = result.insertId;
      const token = signAccessToken({ sub: userId, role: 'customer', tv: 0 });
      return res.status(201).json({
        user: { id: userId, email: email.toLowerCase(), role: 'customer' },
        accessToken: token,
      });
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'Email already registered' });
      }
      throw e;
    }
  });

  r.post('/login', async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
    }
    const { email, password } = parsed.data;
    const [rows] = await pool().query(
      'SELECT id, email, password_hash, role, token_version FROM users WHERE email = ?',
      [email.toLowerCase()],
    );
    if (!rows.length) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    await pool().query('UPDATE users SET token_version = token_version + 1 WHERE id = ?', [user.id]);
    const [nv] = await pool().query('SELECT token_version FROM users WHERE id = ?', [user.id]);
    const tv = nv[0].token_version;
    const token = signAccessToken({ sub: user.id, role: user.role, tv });
    return res.json({
      user: { id: user.id, email: user.email, role: user.role },
      accessToken: token,
    });
  });

  r.get('/me', async (req, res) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    let payload;
    try {
      payload = verifyAccessToken(auth.slice(7));
    } catch {
      return res.status(401).json({ error: 'Invalid token' });
    }
    const [rows] = await pool().query(
      'SELECT id, email, role, token_version FROM users WHERE id = ?',
      [payload.sub],
    );
    if (!rows.length) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const u = rows[0];
    if (u.token_version !== payload.tv) {
      return res.status(401).json({ error: 'Session invalidated' });
    }
    return res.json({ id: u.id, email: u.email, role: u.role });
  });

  r.post('/logout', async (req, res) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    let payload;
    try {
      payload = verifyAccessToken(auth.slice(7));
    } catch {
      return res.status(401).json({ error: 'Invalid token' });
    }
    const [rows] = await pool().query('SELECT id, token_version FROM users WHERE id = ?', [payload.sub]);
    if (!rows.length) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const u = rows[0];
    if (u.token_version !== payload.tv) {
      return res.status(401).json({ error: 'Session invalidated' });
    }
    await pool().query('UPDATE users SET token_version = token_version + 1 WHERE id = ?', [u.id]);
    return res.status(204).send();
  });

  r.get('/internal/verify', async (req, res) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    let payload;
    try {
      payload = verifyAccessToken(auth.slice(7));
    } catch {
      return res.status(401).json({ error: 'Invalid token' });
    }
    const [rows] = await pool().query(
      'SELECT id, email, role, token_version FROM users WHERE id = ?',
      [payload.sub],
    );
    if (!rows.length) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const u = rows[0];
    if (u.token_version !== payload.tv) {
      return res.status(401).json({ error: 'Session invalidated' });
    }
    return res.json({ userId: u.id, email: u.email, role: u.role });
  });

  return r;
}

async function seedAdminIfNeeded() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    return;
  }
  const [admins] = await pool().query("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'");
  if (admins[0].c > 0) {
    return;
  }
  const passwordHash = await bcrypt.hash(password, 12);
  await pool().query(
    'INSERT INTO users (email, password_hash, role, token_version) VALUES (?, ?, ?, 0)',
    [email.toLowerCase(), passwordHash, 'admin'],
  );
  console.log('[auth] Seeded admin user from ADMIN_EMAIL');
}

module.exports = { createAuthRouter: router, seedAdminIfNeeded };
