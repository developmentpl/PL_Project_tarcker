'use strict';
// Optional: populate sample data for a quick demo. Run: node seed.js
// Note: appends rows; run only on a fresh/empty database to avoid duplicates.
const { db, tx, crypto } = require('./db');

const cats = db.prepare('SELECT * FROM categories').all();
const catByName = Object.fromEntries(cats.map((c) => [c.name, c]));

// People
const PEOPLE = ['Yash', 'Amit', 'Neha', 'Priya', 'Sandeep'];
const insPerson = db.prepare('INSERT OR IGNORE INTO people (name, sort_order) VALUES (?, ?)');
PEOPLE.forEach((n, i) => insPerson.run(n, i));
const personId = (name) => { const r = db.prepare('SELECT id FROM people WHERE name=?').get(name); return r ? r.id : null; };

function statusId(catId, name) {
  const r = db.prepare('SELECT id FROM statuses WHERE category_id=? AND name=?').get(catId, name);
  return r ? r.id : null;
}

// [category, number, name, daysAgoStart, status, company, client, owner, subOwner, transferAfterDays->newSub]
const sample = [
  ['VR', 'PRJ-101', 'Industrial Safety VR Module', 190, 'Project paused', 'Acme Mfg', 'Rakesh S', 'Yash', 'Amit', [90, 'Neha']],
  ['LMS', 'PRJ-102', 'Corporate LMS Rollout', 140, 'In-process corrections', 'Globex', 'Priya N', 'Amit', 'Priya', null],
  ['ARS', 'PRJ-103', 'Audience Response System v2', 95, 'Project started', 'Initech', 'Sandra', 'Yash', 'Sandeep', null],
  ['Custom', 'PRJ-104', 'Custom Kiosk App', 60, 'Requirement explained', 'Umbrella', 'John D', 'Neha', 'Neha', null],
  ['VR', 'PRJ-105', 'Fire Drill VR Sim', 45, 'Updates received from client', 'Stark Ind', 'Pepper P', 'Amit', 'Yash', null],
  ['LMS', 'PRJ-106', 'Compliance Training Portal', 30, 'Project completed', 'Wayne Ent', 'Lucius F', 'Yash', 'Priya', null],
  ['ARS', 'PRJ-107', 'Live Polling Tablet Fleet', 12, 'Requirement received', 'Hooli', 'Gavin B', 'Neha', 'Sandeep', null],
  ['Custom', 'PRJ-108', 'Warehouse Scanner Tool', 220, 'Installation completed', 'Cyberdyne', 'Miles D', 'Amit', 'Amit', [140, 'Yash']],
];

const insertP = db.prepare(`INSERT INTO projects
  (id, category_id, project_number, project_name, project_date, company_name, client_name,
   project_owner, owner_id, sub_owner_id, description, status_id, status_since, created_at, updated_at)
  VALUES (?, ?, ?, ?, date('now', ?), ?, ?, ?, ?, ?, ?, ?, datetime('now', ?), datetime('now'), datetime('now'))`);
const insertSH = db.prepare("INSERT INTO status_history (project_id, status_id, changed_at) VALUES (?, ?, datetime('now'))");
const insertSub = db.prepare("INSERT INTO sub_owner_history (project_id, person_id, changed_at) VALUES (?, ?, datetime('now', ?))");

tx(() => {
  sample.forEach(([cat, num, name, daysAgo, status, company, client, owner, sub, transfer]) => {
    const c = catByName[cat]; if (!c) return;
    const id = crypto.randomUUID();
    const sid = statusId(c.id, status);
    const ownerId = personId(owner);
    const subId = personId(sub);
    const statusSince = `-${Math.floor(daysAgo / 3)} days`;
    insertP.run(id, c.id, num, name, `-${daysAgo} days`, company, client, owner, ownerId, subId,
      `${name} — auto-generated sample record.`, sid, statusSince);
    insertSH.run(id, sid);
    // initial sub-owner assignment at project start
    if (subId) insertSub.run(id, subId, `-${daysAgo} days`);
    // optional mid-task transfer
    if (transfer) {
      const [afterDays, newSub] = transfer;
      const newId = personId(newSub);
      if (newId) {
        insertSub.run(id, newId, `-${daysAgo - afterDays} days`);
        db.prepare('UPDATE projects SET sub_owner_id=? WHERE id=?').run(newId, id);
      }
    }
  });
});
console.log(`Seeded ${sample.length} sample projects with owners, sub-owners and handover history.`);
