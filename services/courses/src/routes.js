'use strict';
const { z } = require('zod');
const { pool } = require('./db');
const { verifyBearer, requireAuth, requireInternalKey } = require('./session');
const { signDownloadPayload, verifyDownloadToken } = require('./downloadToken');

const assetCreate = z.object({
  kind: z.enum(['preview', 'full']),
  assetType: z.enum(['video', 'pdf', 'book']),
  storageKey: z.string().min(1).max(1024),
  mime: z.string().max(255).optional(),
});

function publicBase() {
  return process.env.COURSES_PUBLIC_URL || 'http://127.0.0.1:3004';
}

function ttlSeconds() {
  return Number(process.env.DOWNLOAD_TOKEN_TTL_SEC) || 900;
}

async function hasEntitlement(userId, courseId) {
  const [rows] = await pool().query(
    'SELECT 1 AS ok FROM entitlements WHERE user_id = ? AND course_id = ?',
    [userId, courseId],
  );
  return rows.length > 0;
}

function createCoursesRouter(express) {
  const r = express.Router();

  r.get('/preview/:courseId', async (req, res) => {
    const courseId = Number(req.params.courseId);
    if (!Number.isFinite(courseId)) {
      return res.status(400).json({ error: 'Invalid course id' });
    }
    const [rows] = await pool().query(
      `SELECT id, asset_type AS assetType, storage_key AS storageKey, mime
       FROM course_assets WHERE course_id = ? AND kind = 'preview' ORDER BY id ASC`,
      [courseId],
    );
    res.json({ courseId, assets: rows });
  });

  r.get('/access/:courseId', async (req, res) => {
    const courseId = Number(req.params.courseId);
    if (!Number.isFinite(courseId)) {
      return res.status(400).json({ error: 'Invalid course id' });
    }
    const u = await verifyBearer(req);
    if (!u || u.role !== 'customer') {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const ok = await hasEntitlement(u.userId, courseId);
    if (!ok) {
      return res.status(403).json({ error: 'No access' });
    }
    const [rows] = await pool().query(
      `SELECT id, asset_type AS assetType, storage_key AS storageKey, mime
       FROM course_assets WHERE course_id = ? AND kind = 'full' ORDER BY id ASC`,
      [courseId],
    );
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds();
    const base = publicBase().replace(/\/$/, '');
    const assets = rows.map((row) => {
      const token = signDownloadPayload({
        aid: row.id,
        cid: courseId,
        uid: u.userId,
        exp,
      });
      return {
        id: row.id,
        assetType: row.assetType,
        mime: row.mime,
        downloadUrl: `${base}/download?token=${encodeURIComponent(token)}`,
        expiresAt: new Date(exp * 1000).toISOString(),
      };
    });
    res.json({ courseId, assets });
  });

  r.get('/download', async (req, res, next) => {
    try {
      const token = req.query.token;
      if (!token || typeof token !== 'string') {
        return res.status(400).json({ error: 'Missing token' });
      }
      const payload = verifyDownloadToken(token);
      if (!payload || !payload.aid || !payload.cid || !payload.uid) {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }
      const [rows] = await pool().query(
        `SELECT ca.storage_key AS storageKey, ca.mime, ca.asset_type AS assetType, ca.kind, ca.course_id AS courseId
         FROM course_assets ca WHERE ca.id = ? AND ca.course_id = ?`,
        [payload.aid, payload.cid],
      );
      if (!rows.length) {
        return res.status(404).json({ error: 'Not found' });
      }
      const row = rows[0];
      if (row.kind === 'full') {
        const [ent] = await pool().query(
          'SELECT 1 FROM entitlements WHERE user_id = ? AND course_id = ?',
          [payload.uid, payload.cid],
        );
        if (!ent.length) {
          return res.status(403).json({ error: 'No access' });
        }
      }
      res.json({
        storageKey: row.storageKey,
        mime: row.mime,
        assetType: row.assetType,
        courseId: row.courseId,
      });
    } catch (e) {
      next(e);
    }
  });

  const admin = express.Router();
  admin.use(requireAuth('admin'));
  admin.post('/courses/:courseId/assets', async (req, res) => {
    const courseId = Number(req.params.courseId);
    if (!Number.isFinite(courseId)) {
      return res.status(400).json({ error: 'Invalid course id' });
    }
    const parsed = assetCreate.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
    }
    const d = parsed.data;
    const [result] = await pool().query(
      'INSERT INTO course_assets (course_id, kind, asset_type, storage_key, mime) VALUES (?, ?, ?, ?, ?)',
      [courseId, d.kind, d.assetType, d.storageKey, d.mime ?? null],
    );
    res.status(201).json({
      asset: {
        id: result.insertId,
        courseId,
        kind: d.kind,
        assetType: d.assetType,
        storageKey: d.storageKey,
        mime: d.mime ?? null,
      },
    });
  });

  admin.delete('/assets/:id', async (req, res) => {
    const id = Number(req.params.id);
    const [r2] = await pool().query('DELETE FROM course_assets WHERE id = ?', [id]);
    if (r2.affectedRows === 0) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.status(204).send();
  });

  r.use('/admin', admin);

  r.post('/internal/entitlements', requireInternalKey, async (req, res) => {
    const parsed = z
      .object({
        userId: z.coerce.number().int().positive(),
        courseId: z.coerce.number().int().positive(),
        orderId: z.coerce.number().int().positive().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
    }
    const { userId, courseId, orderId } = parsed.data;
    await pool().query(
      `INSERT INTO entitlements (user_id, course_id, order_id) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE order_id = VALUES(order_id), granted_at = CURRENT_TIMESTAMP`,
      [userId, courseId, orderId ?? null],
    );
    res.status(201).json({ ok: true });
  });

  return r;
}

module.exports = { createCoursesRouter };
