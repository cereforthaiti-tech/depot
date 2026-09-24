// db.js — Zero-dependency JSON-file persistence layer.
// No npm packages required (works with plain Node.js, e.g. on Termux/Android
// or on a small VPS) — same philosophy as LeadStock ERP / local-app.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const FILES = {
  platformUsers: 'platform_users.json',   // Platform Owner + Super Admin(s)
  businesses: 'businesses.json',          // one row per Business (tenant)
  businessUsers: 'business_users.json',   // Business Admin / Manager / Business User
  roles: 'roles.json',                    // permission sets, per business
  plans: 'plans.json',                    // subscription plans (global, defined by Platform Owner)
  subscriptions: 'subscriptions.json',    // business -> plan + status
  depots: 'depots.json',                  // warehouses/branches, per business
  auditLog: 'audit_log.json',
};

function filePath(name) {
  return path.join(DATA_DIR, FILES[name]);
}

function load(name) {
  const p = filePath(name);
  if (!fs.existsSync(p)) return [];
  try {
    const raw = fs.readFileSync(p, 'utf8').trim();
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error(`[db] Failed to read ${name}, starting empty. Error:`, e.message);
    return [];
  }
}

function save(name, rows) {
  const p = filePath(name);
  // write to temp file then rename — avoids corrupting data on crash mid-write
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(rows, null, 2), 'utf8');
  fs.renameSync(tmp, p);
}

function id() {
  return crypto.randomUUID();
}

function now() {
  return new Date().toISOString();
}

function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(check, 'hex'), Buffer.from(hash, 'hex'));
}

// --- generic CRUD helpers, scoped by collection name ---
function all(name) {
  return load(name);
}

function findById(name, rowId) {
  return load(name).find(r => r.id === rowId) || null;
}

function insert(name, row) {
  const rows = load(name);
  const record = { id: id(), createdAt: now(), updatedAt: now(), ...row };
  rows.push(record);
  save(name, rows);
  return record;
}

function update(name, rowId, patch) {
  const rows = load(name);
  const idx = rows.findIndex(r => r.id === rowId);
  if (idx === -1) return null;
  rows[idx] = { ...rows[idx], ...patch, updatedAt: now() };
  save(name, rows);
  return rows[idx];
}

function remove(name, rowId) {
  const rows = load(name);
  const next = rows.filter(r => r.id !== rowId);
  save(name, next);
  return rows.length !== next.length;
}

function audit(entry) {
  const rows = load('auditLog');
  rows.push({ id: id(), at: now(), ...entry });
  save('auditLog', rows);
}

module.exports = {
  FILES, load, save, id, now,
  hashPassword, verifyPassword,
  all, findById, insert, update, remove, audit,
};
