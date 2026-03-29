'use strict';
const { z } = require('zod');
const { pool } = require('./db');
const { verifyBearer, requireAuth, requireInternalKey } = require('./session');

const slugify = (s) =>
  String(s)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const categoryCreate = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(255).optional(),
  sortOrder: z.number().int().optional(),
});

const courseCreate = z.object({
  categoryId: z.coerce.number().int().positive(),
  title: z.string().min(1).max(500),
  slug: z.string().min(1).max(500).optional(),
  description: z.string().max(20000).optional(),
  courseType: z.enum(['video', 'pdf', 'book']),
  priceCents: z.number().int().nonnegative(),
  currency: z.string().length(3).optional(),
  published: z.boolean().optional(),
  previewSummary: z.string().max(20000).optional(),
});

function createCatalogRouter(express) {
  const r = express.Router();

  r.get('/categories', async (_req, res) => {
    const [rows] = await pool().query(
      'SELECT id, name, slug, sort_order AS sortOrder FROM categories ORDER BY sort_order ASC, id ASC',
    );
    res.json({ categories: rows });
  });

  r.get('/courses', async (req, res) => {
    const categoryId = req.query.categoryId ? Number(req.query.categoryId) : null;
    let sql =
      'SELECT id, category_id AS categoryId, title, slug, course_type AS courseType, price_cents AS priceCents, currency, preview_summary AS previewSummary FROM courses WHERE published = 1';
    const params = [];
    if (categoryId) {
      sql += ' AND category_id = ?';
      params.push(categoryId);
    }
    sql += ' ORDER BY id DESC';
    const [rows] = await pool().query(sql, params);
    res.json({ courses: rows });
  });

  r.get('/courses/:idOrSlug', async (req, res) => {
    const p = req.params.idOrSlug;
    const byId = /^\d+$/.test(p);
    const [rows] = await pool().query(
      byId
        ? 'SELECT id, category_id AS categoryId, title, slug, description, course_type AS courseType, price_cents AS priceCents, currency, published, preview_summary AS previewSummary FROM courses WHERE id = ?'
        : 'SELECT id, category_id AS categoryId, title, slug, description, course_type AS courseType, price_cents AS priceCents, currency, published, preview_summary AS previewSummary FROM courses WHERE slug = ?',
      [byId ? Number(p) : p],
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Not found' });
    }
    const row = rows[0];
    if (!row.published) {
      const u = await verifyBearer(req);
      if (!u || u.role !== 'admin') {
        return res.status(404).json({ error: 'Not found' });
      }
    }
    delete row.published;
    res.json({ course: row });
  });

  r.get('/internal/courses/:id', requireInternalKey, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'Invalid id' });
    }
    const [rows] = await pool().query(
      'SELECT id, category_id AS categoryId, title, slug, course_type AS courseType, price_cents AS priceCents, currency, published FROM courses WHERE id = ?',
      [id],
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.json({ course: rows[0] });
  });

  const admin = express.Router();
  admin.use(requireAuth('admin'));

  admin.post('/categories', async (req, res) => {
    const parsed = categoryCreate.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
    }
    const { name, sortOrder = 0 } = parsed.data;
    const slug = parsed.data.slug || slugify(name);
    try {
      const [result] = await pool().query(
        'INSERT INTO categories (name, slug, sort_order) VALUES (?, ?, ?)',
        [name, slug, sortOrder],
      );
      res.status(201).json({ category: { id: result.insertId, name, slug, sortOrder } });
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'Slug already exists' });
      }
      throw e;
    }
  });

  admin.patch('/categories/:id', async (req, res) => {
    const id = Number(req.params.id);
    const body = z
      .object({
        name: z.string().min(1).max(255).optional(),
        slug: z.string().min(1).max(255).optional(),
        sortOrder: z.number().int().optional(),
      })
      .safeParse(req.body);
    if (!body.success) {
      return res.status(400).json({ error: 'Invalid body', details: body.error.flatten() });
    }
    const fields = [];
    const vals = [];
    if (body.data.name != null) {
      fields.push('name = ?');
      vals.push(body.data.name);
    }
    if (body.data.slug != null) {
      fields.push('slug = ?');
      vals.push(body.data.slug);
    }
    if (body.data.sortOrder != null) {
      fields.push('sort_order = ?');
      vals.push(body.data.sortOrder);
    }
    if (!fields.length) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    vals.push(id);
    await pool().query(`UPDATE categories SET ${fields.join(', ')} WHERE id = ?`, vals);
    const [rows] = await pool().query(
      'SELECT id, name, slug, sort_order AS sortOrder FROM categories WHERE id = ?',
      [id],
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.json({ category: rows[0] });
  });

  admin.delete('/categories/:id', async (req, res) => {
    const id = Number(req.params.id);
    try {
      const [r2] = await pool().query('DELETE FROM categories WHERE id = ?', [id]);
      if (r2.affectedRows === 0) {
        return res.status(404).json({ error: 'Not found' });
      }
      res.status(204).send();
    } catch (e) {
      if (e.code === 'ER_ROW_IS_REFERENCED_2') {
        return res.status(409).json({ error: 'Category has courses' });
      }
      throw e;
    }
  });

  admin.post('/courses', async (req, res) => {
    const parsed = courseCreate.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
    }
    const d = parsed.data;
    const slug = d.slug || slugify(d.title);
    const currency = d.currency || 'USD';
    try {
      const [result] = await pool().query(
        `INSERT INTO courses (category_id, title, slug, description, course_type, price_cents, currency, published, preview_summary)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          d.categoryId,
          d.title,
          slug,
          d.description ?? null,
          d.courseType,
          d.priceCents,
          currency,
          d.published ? 1 : 0,
          d.previewSummary ?? null,
        ],
      );
      res.status(201).json({
        course: {
          id: result.insertId,
          categoryId: d.categoryId,
          title: d.title,
          slug,
          courseType: d.courseType,
          priceCents: d.priceCents,
          currency,
          published: Boolean(d.published),
        },
      });
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'Slug already exists' });
      }
      if (e.code === 'ER_NO_REFERENCED_ROW_2') {
        return res.status(400).json({ error: 'Invalid category' });
      }
      throw e;
    }
  });

  admin.patch('/courses/:id', async (req, res) => {
    const id = Number(req.params.id);
    const body = z
      .object({
        categoryId: z.number().int().positive().optional(),
        title: z.string().min(1).max(500).optional(),
        slug: z.string().min(1).max(500).optional(),
        description: z.string().max(20000).optional(),
        courseType: z.enum(['video', 'pdf', 'book']).optional(),
        priceCents: z.number().int().nonnegative().optional(),
        currency: z.string().length(3).optional(),
        published: z.boolean().optional(),
        previewSummary: z.string().max(20000).optional(),
      })
      .safeParse(req.body);
    if (!body.success) {
      return res.status(400).json({ error: 'Invalid body', details: body.error.flatten() });
    }
    const b = body.data;
    const fields = [];
    const vals = [];
    const map = [
      ['category_id', b.categoryId],
      ['title', b.title],
      ['slug', b.slug],
      ['description', b.description],
      ['course_type', b.courseType],
      ['price_cents', b.priceCents],
      ['currency', b.currency],
      ['published', b.published === undefined ? undefined : b.published ? 1 : 0],
      ['preview_summary', b.previewSummary],
    ];
    for (const [col, val] of map) {
      if (val !== undefined) {
        fields.push(`${col} = ?`);
        vals.push(val);
      }
    }
    if (!fields.length) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    vals.push(id);
    const [u] = await pool().query(`UPDATE courses SET ${fields.join(', ')} WHERE id = ?`, vals);
    if (u.affectedRows === 0) {
      return res.status(404).json({ error: 'Not found' });
    }
    const [rows] = await pool().query('SELECT * FROM courses WHERE id = ?', [id]);
    const row = rows[0];
    res.json({
      course: {
        id: row.id,
        categoryId: row.category_id,
        title: row.title,
        slug: row.slug,
        description: row.description,
        courseType: row.course_type,
        priceCents: row.price_cents,
        currency: row.currency,
        published: Boolean(row.published),
        previewSummary: row.preview_summary,
      },
    });
  });

  admin.delete('/courses/:id', async (req, res) => {
    const id = Number(req.params.id);
    const [r2] = await pool().query('DELETE FROM courses WHERE id = ?', [id]);
    if (r2.affectedRows === 0) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.status(204).send();
  });

  r.use('/admin', admin);
  return r;
}

module.exports = { createCatalogRouter };
