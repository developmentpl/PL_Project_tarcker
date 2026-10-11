'use strict';

const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { db, tx, crypto, seedStatusesForCategory } = require('./db');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'Admin@123';

// ===========================================================================
// Auth (simple in-memory token; guards write requests)
// ===========================================================================
const tokens = new Set();
function isWrite(m) { return m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE'; }

// ---------------------------------------------------------------------------
// Activity log
// ---------------------------------------------------------------------------
const _logStmt = db.prepare('INSERT INTO activity_log (action, entity, entity_id, name, detail) VALUES (?, ?, ?, ?, ?)');
function logEvent(action, entity, entityId, name, detail) {
  try { _logStmt.run(action, entity, entityId != null ? String(entityId) : null, name || null, detail || null); }
  catch (e) { console.error('log error', e); }
}

// ===========================================================================
// SQL helpers
// ===========================================================================
function uuid() { return crypto.randomUUID(); }
const DAYS_SQL = (col) => `CAST(julianday('now') - julianday(${col}) AS INTEGER)`;

function projectRowSelect() {
  return `
    SELECT
      p.id, p.category_id, p.project_number, p.project_name, p.project_date,
      p.company_name, p.client_name, p.project_owner, p.description,
      p.owner_id, p.sub_owner_id, p.status_id, p.status_since, p.created_at, p.updated_at,
      c.name AS category_name,
      s.name AS status_name, s.is_completed, s.is_reopen, s.sort_order AS status_order,
      o.name  AS owner_name,
      so.name AS sub_owner_name,
      MAX(0, ${DAYS_SQL('p.project_date')})   AS days_from_start,
      MAX(0, ${DAYS_SQL('p.status_since')})   AS days_in_status,
      CASE WHEN s.is_completed=1
           THEN MAX(0, CAST(julianday(p.status_since) - julianday(p.project_date) AS INTEGER))
           ELSE NULL END                       AS days_to_complete
    FROM projects p
    JOIN categories c ON c.id = p.category_id
    JOIN statuses   s ON s.id = p.status_id
    LEFT JOIN people o  ON o.id  = p.owner_id
    LEFT JOIN people so ON so.id = p.sub_owner_id
  `;
}
function getProjectRow(id) {
  return db.prepare(projectRowSelect() + ' WHERE p.id=? GROUP BY p.id').get(id);
}

// ===========================================================================
// Router
// ===========================================================================
const routes = [];
function route(method, pattern, handler, opts = {}) {
  const keys = [];
  const rx = new RegExp('^' + pattern.replace(/:[^/]+/g, (m) => { keys.push(m.slice(1)); return '([^/]+)'; }) + '$');
  routes.push({ method, rx, keys, handler, open: !!opts.open });
}
class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
function fail(code, msg) { throw new HttpError(code, msg); }

// ---------------------------------------------------------------------------
// Auth routes
// ---------------------------------------------------------------------------
route('POST', '/api/login', (req, params, body) => {
  if (body.username === ADMIN_USER && body.password === ADMIN_PASS) {
    const token = uuid();
    tokens.add(token);
    logEvent('login', 'auth', null, ADMIN_USER, 'Admin logged in');
    return { token, username: ADMIN_USER };
  }
  fail(401, 'Invalid username or password');
}, { open: true });

// Lightweight session check so the client can detect a stale token
route('GET', '/api/session', (req, params, body, query, token) =>
  ({ admin: !!(token && tokens.has(token)), username: token && tokens.has(token) ? ADMIN_USER : null }),
  { open: true });

route('POST', '/api/logout', (req, params, body, query, token) => {
  if (token) tokens.delete(token);
  return { ok: true };
});

// ===========================================================================
// People (owners / sub-owners)
// ===========================================================================
route('GET', '/api/people', () =>
  db.prepare('SELECT * FROM people ORDER BY sort_order, name').all(), { open: true });

route('POST', '/api/people', (req, params, body) => {
  const name = (body.name || '').trim();
  if (!name) fail(400, 'Name is required');
  try {
    const order = db.prepare('SELECT COALESCE(MAX(sort_order),-1)+1 AS n FROM people').get().n;
    const info = db.prepare('INSERT INTO people (name, sort_order) VALUES (?, ?)').run(name, order);
    logEvent('created', 'person', Number(info.lastInsertRowid), name, 'Person added');
    return db.prepare('SELECT * FROM people WHERE id=?').get(Number(info.lastInsertRowid));
  } catch (e) {
    if (String(e).includes('UNIQUE')) fail(409, 'That person already exists');
    throw e;
  }
});

route('PUT', '/api/people/:id', (req, params, body) => {
  const name = (body.name || '').trim();
  if (!name) fail(400, 'Name is required');
  try {
    const info = db.prepare('UPDATE people SET name=? WHERE id=?').run(name, Number(params.id));
    if (!info.changes) fail(404, 'Person not found');
    return db.prepare('SELECT * FROM people WHERE id=?').get(Number(params.id));
  } catch (e) {
    if (e instanceof HttpError) throw e;
    if (String(e).includes('UNIQUE')) fail(409, 'That person already exists');
    throw e;
  }
});

route('DELETE', '/api/people/:id', (req, params) => {
  const pid = Number(params.id);
  const used = db.prepare('SELECT COUNT(*) AS c FROM projects WHERE owner_id=? OR sub_owner_id=?').get(pid, pid).c;
  if (used > 0) fail(409, `Cannot delete: assigned to ${used} project(s)`);
  const per = db.prepare('SELECT name FROM people WHERE id=?').get(pid);
  const info = db.prepare('DELETE FROM people WHERE id=?').run(pid);
  if (!info.changes) fail(404, 'Person not found');
  logEvent('deleted', 'person', params.id, per ? per.name : null, 'Person removed');
  return { ok: true };
});

// ===========================================================================
// Categories
// ===========================================================================
route('GET', '/api/categories', () =>
  db.prepare('SELECT * FROM categories ORDER BY sort_order, name').all(), { open: true });

route('POST', '/api/categories', (req, params, body) => {
  const name = (body.name || '').trim();
  if (!name) fail(400, 'Category name is required');
  try {
    const order = db.prepare('SELECT COALESCE(MAX(sort_order),-1)+1 AS n FROM categories').get().n;
    const info = db.prepare('INSERT INTO categories (name, sort_order) VALUES (?, ?)').run(name, order);
    seedStatusesForCategory(Number(info.lastInsertRowid));
    logEvent('created', 'category', Number(info.lastInsertRowid), name, 'Category added');
    return db.prepare('SELECT * FROM categories WHERE id=?').get(Number(info.lastInsertRowid));
  } catch (e) {
    if (String(e).includes('UNIQUE')) fail(409, 'Category already exists');
    throw e;
  }
});

route('PUT', '/api/categories/:id', (req, params, body) => {
  const name = (body.name || '').trim();
  if (!name) fail(400, 'Category name is required');
  try {
    const info = db.prepare('UPDATE categories SET name=? WHERE id=?').run(name, Number(params.id));
    if (!info.changes) fail(404, 'Category not found');
    return db.prepare('SELECT * FROM categories WHERE id=?').get(Number(params.id));
  } catch (e) {
    if (e instanceof HttpError) throw e;
    if (String(e).includes('UNIQUE')) fail(409, 'Category already exists');
    throw e;
  }
});

route('DELETE', '/api/categories/:id', (req, params) => {
  const used = db.prepare('SELECT COUNT(*) AS c FROM projects WHERE category_id=?').get(Number(params.id)).c;
  if (used > 0) fail(409, `Cannot delete: ${used} project(s) use this category`);
  const cat = db.prepare('SELECT name FROM categories WHERE id=?').get(Number(params.id));
  const info = db.prepare('DELETE FROM categories WHERE id=?').run(Number(params.id));
  if (!info.changes) fail(404, 'Category not found');
  logEvent('deleted', 'category', params.id, cat ? cat.name : null, 'Category removed');
  return { ok: true };
});

// ===========================================================================
// Statuses
// ===========================================================================
route('GET', '/api/statuses', (req, params, body, query) => {
  const catId = query.get('category_id');
  if (catId) return db.prepare('SELECT * FROM statuses WHERE category_id=? ORDER BY sort_order, id').all(Number(catId));
  return db.prepare('SELECT * FROM statuses ORDER BY category_id, sort_order, id').all();
}, { open: true });

route('POST', '/api/statuses', (req, params, body) => {
  const category_id = Number(body.category_id);
  const name = (body.name || '').trim();
  const is_completed = body.is_completed ? 1 : 0;
  const is_reopen = body.is_reopen ? 1 : 0;
  if (!category_id || !name) fail(400, 'category_id and name are required');
  try {
    const order = db.prepare('SELECT COALESCE(MAX(sort_order),-1)+1 AS n FROM statuses WHERE category_id=?').get(category_id).n;
    const info = db.prepare(
      `INSERT INTO statuses (category_id, name, sort_order, is_completed, is_reopen) VALUES (?, ?, ?, ?, ?)`
    ).run(category_id, name, order, is_completed, is_reopen);
    logEvent('created', 'status', Number(info.lastInsertRowid), name, 'Status added');
    return db.prepare('SELECT * FROM statuses WHERE id=?').get(Number(info.lastInsertRowid));
  } catch (e) {
    if (String(e).includes('UNIQUE')) fail(409, 'Status already exists in this category');
    throw e;
  }
});

route('PUT', '/api/statuses/:id', (req, params, body) => {
  const existing = db.prepare('SELECT * FROM statuses WHERE id=?').get(Number(params.id));
  if (!existing) fail(404, 'Status not found');
  const name = body.name != null ? String(body.name).trim() : existing.name;
  const is_completed = body.is_completed != null ? (body.is_completed ? 1 : 0) : existing.is_completed;
  const is_reopen = body.is_reopen != null ? (body.is_reopen ? 1 : 0) : existing.is_reopen;
  if (!name) fail(400, 'Status name is required');
  try {
    db.prepare('UPDATE statuses SET name=?, is_completed=?, is_reopen=? WHERE id=?')
      .run(name, is_completed, is_reopen, Number(params.id));
    return db.prepare('SELECT * FROM statuses WHERE id=?').get(Number(params.id));
  } catch (e) {
    if (String(e).includes('UNIQUE')) fail(409, 'Status already exists in this category');
    throw e;
  }
});

// Reorder statuses within a category: body.order = [statusId,...] in desired sequence
route('POST', '/api/statuses/reorder', (req, params, body) => {
  const order = Array.isArray(body.order) ? body.order : [];
  if (!order.length) fail(400, 'order array is required');
  const upd = db.prepare('UPDATE statuses SET sort_order=? WHERE id=?');
  tx(() => order.forEach((id, i) => upd.run(i, Number(id))));
  logEvent('reorder', 'status', null, null, 'Status sequence changed');
  return { ok: true };
});

route('DELETE', '/api/statuses/:id', (req, params) => {
  const used = db.prepare('SELECT COUNT(*) AS c FROM projects WHERE status_id=?').get(Number(params.id)).c;
  if (used > 0) fail(409, `Cannot delete: ${used} project(s) currently use this status`);
  const st = db.prepare('SELECT name FROM statuses WHERE id=?').get(Number(params.id));
  const info = db.prepare('DELETE FROM statuses WHERE id=?').run(Number(params.id));
  if (!info.changes) fail(404, 'Status not found');
  logEvent('deleted', 'status', params.id, st ? st.name : null, 'Status deleted');
  return { ok: true };
});

// ===========================================================================
// Projects
// ===========================================================================
const SORTS = {
  age_desc: 'days_from_start DESC, p.project_date ASC',
  age_asc: 'days_from_start ASC, p.project_date DESC',
  name: 'p.project_name COLLATE NOCASE ASC',
  status_days_desc: 'days_in_status DESC',
  recent: 'p.created_at DESC',
  complete_days_desc: 'days_to_complete DESC',
};
route('GET', '/api/projects', (req, params, body, query) => {
  const category_id = query.get('category_id');
  const status_id = query.get('status_id');
  const sub_owner_id = query.get('sub_owner_id');
  const search = query.get('search');
  const searchIn = query.get('search_in') || 'all';
  const completed = query.get('completed') || '0';
  const sort = SORTS[query.get('sort')] || SORTS.age_desc;
  const limit = query.get('limit');   // omit or 'all' => no limit
  const offset = Number(query.get('offset') || 0);

  const where = [];
  const p = [];
  if (category_id) { where.push('p.category_id = ?'); p.push(Number(category_id)); }
  if (status_id)   { where.push('p.status_id = ?');   p.push(Number(status_id)); }
  if (sub_owner_id){ where.push('p.sub_owner_id = ?'); p.push(Number(sub_owner_id)); }
  if (completed === '1')      where.push('s.is_completed = 1');
  else if (completed === '0') where.push('s.is_completed = 0');
  if (search) {
    const like = `%${search}%`;
    const fields = { name: 'p.project_name', number: 'p.project_number', company: 'p.company_name', client: 'p.client_name' };
    if (fields[searchIn]) { where.push(`${fields[searchIn]} LIKE ?`); p.push(like); }
    else { where.push('(p.project_name LIKE ? OR p.project_number LIKE ? OR p.company_name LIKE ? OR p.client_name LIKE ?)'); p.push(like, like, like, like); }
  }
  const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';

  const total = db.prepare(`SELECT COUNT(*) AS c FROM projects p
    JOIN categories c ON c.id=p.category_id JOIN statuses s ON s.id=p.status_id ${whereSql}`).get(...p).c;

  let sql = projectRowSelect() + whereSql + ` GROUP BY p.id ORDER BY ${sort}`;
  const dataParams = [...p];
  if (limit && limit !== 'all') { sql += ' LIMIT ? OFFSET ?'; dataParams.push(Number(limit), offset); }
  const items = db.prepare(sql).all(...dataParams);
  return { items, total, offset, limit: (limit && limit !== 'all') ? Number(limit) : null };
}, { open: true });

// Full activity log (admin only)
route('GET', '/api/logs', (req, params, body, query, token) => {
  if (!(token && tokens.has(token))) fail(401, 'Admin login required');
  const search = query.get('search');
  const action = query.get('action');
  const limit = Number(query.get('limit') || 100);
  const offset = Number(query.get('offset') || 0);
  const where = []; const p = [];
  if (action) { where.push('action = ?'); p.push(action); }
  if (search) { where.push('(name LIKE ? OR detail LIKE ? OR entity LIKE ?)'); const l = `%${search}%`; p.push(l, l, l); }
  const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS c FROM activity_log${whereSql}`).get(...p).c;
  const items = db.prepare(`SELECT * FROM activity_log${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...p, limit, offset);
  return { items, total };
}, { open: true });

route('GET', '/api/projects/:id', (req, params) => {
  const row = getProjectRow(params.id);
  if (!row) fail(404, 'Project not found');
  const statusHistory = db.prepare(
    `SELECT h.id, h.status_id, h.changed_at, s.name AS status_name
     FROM status_history h JOIN statuses s ON s.id = h.status_id
     WHERE h.project_id=? ORDER BY h.changed_at ASC, h.id ASC`
  ).all(params.id);
  const subHistoryRaw = db.prepare(
    `SELECT h.id, h.person_id, h.changed_at, pe.name AS person_name
     FROM sub_owner_history h LEFT JOIN people pe ON pe.id = h.person_id
     WHERE h.project_id=? ORDER BY h.changed_at ASC, h.id ASC`
  ).all(params.id);
  return { ...row, statusHistory: [...statusHistory].reverse(), subOwnerTimeline: buildSubOwnerTimeline(subHistoryRaw, statusHistory) };
}, { open: true });

// Build [{person_id, person_name, from, to, seconds, statuses:[names]}] intervals.
function buildSubOwnerTimeline(subHist, statusHist) {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const out = [];
  for (let i = 0; i < subHist.length; i++) {
    const from = subHist[i].changed_at;
    const to = i + 1 < subHist.length ? subHist[i + 1].changed_at : now;
    const seconds = Math.max(0, (Date.parse(to.replace(' ', 'T') + 'Z') - Date.parse(from.replace(' ', 'T') + 'Z')) / 1000);
    // status active at 'from' + any status changes within [from, to)
    const names = new Set();
    let activeAtStart = null;
    statusHist.forEach((s) => {
      if (s.changed_at <= from) activeAtStart = s.status_name;
      if (s.changed_at >= from && s.changed_at < to) names.add(s.status_name);
    });
    if (activeAtStart) names.add(activeAtStart);
    out.push({
      person_id: subHist[i].person_id, person_name: subHist[i].person_name || 'Unassigned',
      from, to: i + 1 < subHist.length ? to : null, seconds: Math.round(seconds), statuses: [...names],
    });
  }
  return out;
}

function validateProjectBody(b) {
  const errors = [];
  if (!b.category_id) errors.push('Project category is required');
  if (!b.project_name || !String(b.project_name).trim()) errors.push('Project name is required');
  if (!b.project_date) errors.push('Project date is required');
  if (!b.status_id) errors.push('Status is required');
  return errors;
}
function personName(id) {
  if (!id) return null;
  const r = db.prepare('SELECT name FROM people WHERE id=?').get(Number(id));
  return r ? r.name : null;
}

route('POST', '/api/projects', (req, params, b) => {
  const errors = validateProjectBody(b);
  if (errors.length) fail(400, errors.join('; '));
  const status = db.prepare('SELECT * FROM statuses WHERE id=? AND category_id=?').get(Number(b.status_id), Number(b.category_id));
  if (!status) fail(400, 'Selected status does not belong to the selected category');

  const id = uuid();
  const ownerId = b.owner_id ? Number(b.owner_id) : null;
  const subOwnerId = b.sub_owner_id ? Number(b.sub_owner_id) : null;
  tx(() => {
    db.prepare(
      `INSERT INTO projects
        (id, category_id, project_number, project_name, project_date,
         company_name, client_name, project_owner, owner_id, sub_owner_id,
         description, status_id, status_since)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    ).run(
      id, Number(b.category_id), b.project_number || null, String(b.project_name).trim(),
      b.project_date, b.company_name || null, b.client_name || null,
      personName(ownerId), ownerId, subOwnerId,
      b.description || null, Number(b.status_id)
    );
    db.prepare('INSERT INTO status_history (project_id, status_id) VALUES (?, ?)').run(id, Number(b.status_id));
    if (subOwnerId) db.prepare('INSERT INTO sub_owner_history (project_id, person_id) VALUES (?, ?)').run(id, subOwnerId);
  });
  const row = getProjectRow(id);
  logEvent('created', 'project', id, row.project_name, `Created in ${row.category_name} · status “${row.status_name}”`);
  return row;
});

route('PUT', '/api/projects/:id', (req, params, b) => {
  const existing = db.prepare('SELECT * FROM projects WHERE id=?').get(params.id);
  if (!existing) fail(404, 'Project not found');
  const errors = validateProjectBody(b);
  if (errors.length) fail(400, errors.join('; '));
  const status = db.prepare('SELECT * FROM statuses WHERE id=? AND category_id=?').get(Number(b.status_id), Number(b.category_id));
  if (!status) fail(400, 'Selected status does not belong to the selected category');

  const statusChanged = Number(b.status_id) !== Number(existing.status_id);
  const ownerId = b.owner_id ? Number(b.owner_id) : null;
  const subOwnerId = b.sub_owner_id ? Number(b.sub_owner_id) : null;
  const subChanged = Number(subOwnerId || 0) !== Number(existing.sub_owner_id || 0);
  const changedAt = b.changed_at || null; // optional custom time for status change

  tx(() => {
    db.prepare(
      `UPDATE projects SET
        category_id=?, project_number=?, project_name=?, project_date=?,
        company_name=?, client_name=?, project_owner=?, owner_id=?, sub_owner_id=?, description=?, status_id=?,
        status_since = CASE WHEN ?=1 THEN COALESCE(?, datetime('now')) ELSE status_since END,
        updated_at = datetime('now')
       WHERE id=?`
    ).run(
      Number(b.category_id), b.project_number || null, String(b.project_name).trim(), b.project_date,
      b.company_name || null, b.client_name || null, personName(ownerId), ownerId, subOwnerId,
      b.description || null, Number(b.status_id), statusChanged ? 1 : 0, changedAt, params.id
    );
    if (statusChanged) {
      db.prepare(`INSERT INTO status_history (project_id, status_id, changed_at) VALUES (?, ?, COALESCE(?, datetime('now')))`)
        .run(params.id, Number(b.status_id), changedAt);
    }
    if (subChanged) {
      db.prepare(`INSERT INTO sub_owner_history (project_id, person_id, changed_at) VALUES (?, ?, COALESCE(?, datetime('now')))`)
        .run(params.id, subOwnerId, changedAt);
    }
  });
  const row = getProjectRow(params.id);
  const notes = ['Edited details'];
  if (statusChanged) notes.push(`status → “${row.status_name}”`);
  if (subChanged) notes.push(`sub-owner → ${row.sub_owner_name || 'Unassigned'}`);
  logEvent('updated', 'project', params.id, row.project_name, notes.join('; '));
  return row;
});

// Change status only (with optional date/time)
route('PATCH', '/api/projects/:id/status', (req, params, b) => {
  const existing = db.prepare('SELECT * FROM projects WHERE id=?').get(params.id);
  if (!existing) fail(404, 'Project not found');
  const status_id = Number(b.status_id);
  if (!status_id) fail(400, 'status_id is required');
  const status = db.prepare('SELECT * FROM statuses WHERE id=? AND category_id=?').get(status_id, existing.category_id);
  if (!status) fail(400, 'Status does not belong to the project category');
  const changedAt = b.changed_at || null;
  if (status_id !== Number(existing.status_id)) {
    tx(() => {
      db.prepare("UPDATE projects SET status_id=?, status_since=COALESCE(?, datetime('now')), updated_at=datetime('now') WHERE id=?")
        .run(status_id, changedAt, params.id);
      db.prepare(`INSERT INTO status_history (project_id, status_id, changed_at) VALUES (?, ?, COALESCE(?, datetime('now')))`)
        .run(params.id, status_id, changedAt);
    });
    const row = getProjectRow(params.id);
    logEvent('status', 'project', params.id, row.project_name, `Status → “${row.status_name}”`);
  }
  return getProjectRow(params.id);
});

// Transfer sub-owner (with optional date/time to capture handover moment)
route('PATCH', '/api/projects/:id/subowner', (req, params, b) => {
  const existing = db.prepare('SELECT * FROM projects WHERE id=?').get(params.id);
  if (!existing) fail(404, 'Project not found');
  const newId = b.sub_owner_id ? Number(b.sub_owner_id) : null;
  const changedAt = b.changed_at || null;
  if (Number(newId || 0) !== Number(existing.sub_owner_id || 0)) {
    tx(() => {
      db.prepare('UPDATE projects SET sub_owner_id=?, updated_at=datetime(\'now\') WHERE id=?').run(newId, params.id);
      db.prepare(`INSERT INTO sub_owner_history (project_id, person_id, changed_at) VALUES (?, ?, COALESCE(?, datetime('now')))`)
        .run(params.id, newId, changedAt);
    });
    const row = getProjectRow(params.id);
    logEvent('transfer', 'project', params.id, row.project_name, `Sub-owner → ${row.sub_owner_name || 'Unassigned'}`);
  }
  return getProjectRow(params.id);
});

route('DELETE', '/api/projects/:id', (req, params) => {
  const existing = db.prepare('SELECT project_name FROM projects WHERE id=?').get(params.id);
  const info = db.prepare('DELETE FROM projects WHERE id=?').run(params.id);
  if (!info.changes) fail(404, 'Project not found');
  logEvent('deleted', 'project', params.id, existing ? existing.project_name : null, 'Project deleted');
  return { ok: true };
});

// ===========================================================================
// Stats
// ===========================================================================
route('GET', '/api/stats', () => {
  const byCategory = db.prepare(`
    SELECT c.id AS category_id, c.name AS category_name,
           COUNT(p.id) AS total,
           SUM(CASE WHEN s.is_completed=1 THEN 1 ELSE 0 END) AS completed,
           SUM(CASE WHEN s.is_completed=0 THEN 1 ELSE 0 END) AS active
    FROM categories c
    LEFT JOIN projects p ON p.category_id = c.id
    LEFT JOIN statuses s ON s.id = p.status_id
    GROUP BY c.id ORDER BY c.sort_order, c.name`).all();

  const byStatus = db.prepare(`
    SELECT c.name AS category_name, s.name AS status_name, COUNT(p.id) AS total
    FROM projects p JOIN categories c ON c.id = p.category_id JOIN statuses s ON s.id = p.status_id
    GROUP BY c.name, s.name ORDER BY c.name, s.sort_order`).all();

  const avgDays = db.prepare(`
    SELECT c.name AS category_name,
           ROUND(AVG(MAX(0, ${DAYS_SQL('p.project_date')})),1) AS avg_days
    FROM projects p JOIN categories c ON c.id = p.category_id JOIN statuses s ON s.id = p.status_id
    WHERE s.is_completed = 0 GROUP BY c.name ORDER BY c.name`).all();

  // Active project count per sub-owner (current assignment)
  const bySubOwner = db.prepare(`
    SELECT pe.name AS person_name, COUNT(p.id) AS total,
           SUM(CASE WHEN s.is_completed=0 THEN 1 ELSE 0 END) AS active
    FROM projects p JOIN people pe ON pe.id = p.sub_owner_id JOIN statuses s ON s.id = p.status_id
    GROUP BY pe.id ORDER BY total DESC`).all();

  return { byCategory, byStatus, avgDays, bySubOwner };
}, { open: true });

// ===========================================================================
// Static + request handling
// ===========================================================================
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};
function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, html) => {
        if (e2) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}
function sendJson(res, code, obj) {
  const s = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(s);
}
function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 2e6) req.destroy(); });
    req.on('end', () => { if (!data) return resolve({}); try { resolve(JSON.parse(data)); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  if (!pathname.startsWith('/api/')) return serveStatic(req, res, pathname);

  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const body = isWrite(req.method) ? await readBody(req) : {};

  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = r.rx.exec(pathname);
    if (!m) continue;
    // Guard writes (except open routes like /api/login) behind admin token
    if (isWrite(req.method) && !r.open && !(token && tokens.has(token))) {
      return sendJson(res, 401, { error: 'Admin login required' });
    }
    const params = {};
    r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
    try {
      const result = r.handler(req, params, body, url.searchParams, token);
      return sendJson(res, req.method === 'POST' ? 201 : 200, result);
    } catch (e) {
      if (e instanceof HttpError) return sendJson(res, e.code, { error: e.message });
      console.error(e);
      return sendJson(res, 500, { error: String(e.message || e) });
    }
  }
  sendJson(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`\n  Dev Project Tracker running:  http://localhost:${PORT}`);
  console.log(`  Admin login → user: ${ADMIN_USER}\n`);
});
