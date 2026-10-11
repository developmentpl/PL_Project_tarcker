'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite'); // built-in, no native build needed

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'tracker.db'));
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// Simple transaction helper (node:sqlite has no db.transaction()).
function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
db.exec(`
CREATE TABLE IF NOT EXISTS categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS statuses (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id  INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  is_completed INTEGER NOT NULL DEFAULT 0,   -- marks a project as "completed"
  is_reopen    INTEGER NOT NULL DEFAULT 0,   -- valid target when pulling a project back
  UNIQUE (category_id, name)
);

CREATE TABLE IF NOT EXISTS projects (
  id             TEXT PRIMARY KEY,           -- backend generated UUID
  category_id    INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  project_number TEXT,
  project_name   TEXT NOT NULL,
  project_date   TEXT NOT NULL,              -- ISO date (start date)
  company_name   TEXT,
  client_name    TEXT,
  project_owner  TEXT,
  description    TEXT,
  status_id      INTEGER NOT NULL REFERENCES statuses(id) ON DELETE RESTRICT,
  status_since   TEXT NOT NULL DEFAULT (datetime('now')),  -- when current status began
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS status_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status_id  INTEGER NOT NULL REFERENCES statuses(id) ON DELETE CASCADE,
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS people (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sub_owner_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  person_id  INTEGER REFERENCES people(id) ON DELETE SET NULL,
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS activity_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         TEXT NOT NULL DEFAULT (datetime('now')),
  action     TEXT NOT NULL,           -- created | updated | deleted | status | transfer | login | reorder
  entity     TEXT NOT NULL,           -- project | category | status | person | auth
  entity_id  TEXT,
  name       TEXT,                    -- human label (e.g. project name)
  detail     TEXT
);
CREATE INDEX IF NOT EXISTS idx_activity_ts ON activity_log(ts);
`);

// ---------------------------------------------------------------------------
// Migrations for databases created by earlier versions
// ---------------------------------------------------------------------------
function columnExists(table, col) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
}
if (!columnExists('projects', 'owner_id')) {
  db.exec('ALTER TABLE projects ADD COLUMN owner_id INTEGER');
}
if (!columnExists('projects', 'sub_owner_id')) {
  db.exec('ALTER TABLE projects ADD COLUMN sub_owner_id INTEGER');
}

// ---------------------------------------------------------------------------
// Seed defaults (only when DB is empty)
// ---------------------------------------------------------------------------
const DEFAULT_CATEGORIES = ['VR', 'LMS', 'ARS', 'Custom'];

// name, is_completed, is_reopen
const DEFAULT_STATUSES = [
  ['Requirement received', 0, 0],
  ['Requirement explained', 0, 0],
  ['Project started', 0, 0],
  ['Project paused', 0, 0],
  ['In-process corrections', 0, 1],
  ['Updates received from client', 0, 1],
  ['Installation completed', 0, 0],
  ['Project completed', 1, 0],
];

function seedStatusesForCategory(categoryId) {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO statuses (category_id, name, sort_order, is_completed, is_reopen)
     VALUES (?, ?, ?, ?, ?)`
  );
  DEFAULT_STATUSES.forEach(([name, isCompleted, isReopen], i) => {
    insert.run(Number(categoryId), name, i, isCompleted, isReopen);
  });
}

const categoryCount = db.prepare('SELECT COUNT(*) AS c FROM categories').get().c;
if (categoryCount === 0) {
  const insertCat = db.prepare('INSERT INTO categories (name, sort_order) VALUES (?, ?)');
  tx(() => {
    DEFAULT_CATEGORIES.forEach((name, i) => {
      const info = insertCat.run(name, i);
      seedStatusesForCategory(Number(info.lastInsertRowid));
    });
  });
}

// Backfill people + owner_id from any legacy free-text project_owner values.
(function backfillPeople() {
  const legacy = db
    .prepare(`SELECT DISTINCT TRIM(project_owner) AS name FROM projects
              WHERE project_owner IS NOT NULL AND TRIM(project_owner) <> ''`)
    .all();
  const insPerson = db.prepare('INSERT OR IGNORE INTO people (name, sort_order) VALUES (?, 0)');
  const findPerson = db.prepare('SELECT id FROM people WHERE name = ?');
  legacy.forEach(({ name }) => insPerson.run(name));
  // Link owner_id for rows that still have none
  const toLink = db.prepare(`SELECT id, TRIM(project_owner) AS name FROM projects
    WHERE owner_id IS NULL AND project_owner IS NOT NULL AND TRIM(project_owner) <> ''`).all();
  const setOwner = db.prepare('UPDATE projects SET owner_id=? WHERE id=?');
  toLink.forEach(({ id, name }) => {
    const p = findPerson.get(name);
    if (p) setOwner.run(p.id, id);
  });
})();

module.exports = { db, tx, crypto, seedStatusesForCategory, DEFAULT_STATUSES };
