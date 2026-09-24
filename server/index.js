// index.js — Leads Business Platform API server.
// Pure Node.js (http module only) — no npm install required. Runs anywhere
// Node runs: a small VPS, shared hosting with Node support, or Termux.
//
//   node server/index.js
//
// Data is stored as JSON files under server/data/ (swap db.js for a real
// database later without changing route logic).

const http = require('http');
const url = require('url');
const db = require('./db');
const auth = require('./auth');
const roles = require('./roles');

const PORT = process.env.PORT || 4000;

// ---------- tiny helpers ----------

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 5 * 1024 * 1024) req.destroy(); // 5MB guard
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('invalid_json'));
      }
    });
    req.on('error', reject);
  });
}

function requirePlatformAuth(req) {
  const token = auth.tokenFromRequest(req);
  const payload = auth.verify(token);
  if (!payload || payload.scope !== 'platform') return null;
  const user = db.findById('platformUsers', payload.sub);
  if (!user || user.status !== 'active') return null;
  return user;
}

function requireBusinessAuth(req) {
  const token = auth.tokenFromRequest(req);
  const payload = auth.verify(token);
  if (!payload || payload.scope !== 'business') return null;
  const user = db.findById('businessUsers', payload.sub);
  if (!user || user.status !== 'active') return null;
  return user;
}

function isSubscriptionActive(businessId) {
  const sub = db.all('subscriptions').find(s => s.businessId === businessId);
  if (!sub) return false;
  return sub.status === 'active' || sub.status === 'trialing';
}

// ---------- route table ----------
// key: "METHOD /path/with/:params"
const routes = [];
function route(method, pattern, handler) {
  const paramNames = [];
  const regex = new RegExp(
    '^' +
      pattern
        .split('/')
        .map(seg => {
          if (seg.startsWith(':')) {
            paramNames.push(seg.slice(1));
            return '([^/]+)';
          }
          return seg;
        })
        .join('/') +
      '$'
  );
  routes.push({ method, regex, paramNames, handler });
}

function matchRoute(method, pathname) {
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.regex.exec(pathname);
    if (!m) continue;
    const params = {};
    r.paramNames.forEach((name, i) => (params[name] = decodeURIComponent(m[i + 1])));
    return { handler: r.handler, params };
  }
  return null;
}

// ================= PLATFORM ROUTES =================
// Platform Owner / Super Admin — control the SaaS itself.

// One-time bootstrap: creates the first Platform Owner. Refuses if one exists.
route('POST', '/api/platform/bootstrap', async (req, res) => {
  const existing = db.all('platformUsers').find(u => u.role === roles.PLATFORM_ROLES.PLATFORM_OWNER);
  if (existing) return sendJSON(res, 409, { error: 'platform_owner_already_exists' });
  const { name, email, password } = req.body;
  if (!name || !email || !password) return sendJSON(res, 400, { error: 'missing_fields' });
  const { salt, hash } = db.hashPassword(password);
  const owner = db.insert('platformUsers', {
    name, email, role: roles.PLATFORM_ROLES.PLATFORM_OWNER, status: 'active', salt, hash,
  });
  db.audit({ type: 'platform_bootstrap', actor: owner.id });
  sendJSON(res, 201, { id: owner.id, name: owner.name, email: owner.email, role: owner.role });
});

route('POST', '/api/platform/login', async (req, res) => {
  const { email, password } = req.body;
  const user = db.all('platformUsers').find(u => u.email === email);
  if (!user || !db.verifyPassword(password, user.salt, user.hash)) {
    return sendJSON(res, 401, { error: 'invalid_credentials' });
  }
  if (user.status !== 'active') return sendJSON(res, 403, { error: 'account_disabled' });
  const token = auth.sign({ sub: user.id, scope: 'platform', role: user.role });
  sendJSON(res, 200, { token, user: { id: user.id, name: user.name, role: user.role } });
});

// Platform Owner only: create/remove Super Admins.
route('POST', '/api/platform/admins', async (req, res) => {
  const actor = requirePlatformAuth(req);
  if (!actor || actor.role !== roles.PLATFORM_ROLES.PLATFORM_OWNER) {
    return sendJSON(res, 403, { error: 'forbidden' });
  }
  const { name, email, password } = req.body;
  if (!name || !email || !password) return sendJSON(res, 400, { error: 'missing_fields' });
  const { salt, hash } = db.hashPassword(password);
  const admin = db.insert('platformUsers', {
    name, email, role: roles.PLATFORM_ROLES.SUPER_ADMIN, status: 'active', salt, hash,
  });
  db.audit({ type: 'super_admin_created', actor: actor.id, target: admin.id });
  sendJSON(res, 201, { id: admin.id, name: admin.name, email: admin.email, role: admin.role });
});

// List all businesses on the platform (Platform Owner / Super Admin).
route('GET', '/api/platform/businesses', async (req, res) => {
  const actor = requirePlatformAuth(req);
  if (!actor) return sendJSON(res, 403, { error: 'forbidden' });
  const businesses = db.all('businesses').map(b => ({
    ...b,
    subscription: db.all('subscriptions').find(s => s.businessId === b.id) || null,
  }));
  sendJSON(res, 200, { businesses });
});

route('POST', '/api/platform/businesses/:id/suspend', async (req, res, params) => {
  const actor = requirePlatformAuth(req);
  if (!actor) return sendJSON(res, 403, { error: 'forbidden' });
  const business = db.update('businesses', params.id, { status: 'suspended' });
  if (!business) return sendJSON(res, 404, { error: 'not_found' });
  db.audit({ type: 'business_suspended', actor: actor.id, target: business.id });
  sendJSON(res, 200, { business });
});

route('POST', '/api/platform/businesses/:id/reactivate', async (req, res, params) => {
  const actor = requirePlatformAuth(req);
  if (!actor) return sendJSON(res, 403, { error: 'forbidden' });
  const business = db.update('businesses', params.id, { status: 'active' });
  if (!business) return sendJSON(res, 404, { error: 'not_found' });
  db.audit({ type: 'business_reactivated', actor: actor.id, target: business.id });
  sendJSON(res, 200, { business });
});

// Subscription plans (global catalogue, managed by Platform Owner/Super Admin).
route('GET', '/api/platform/plans', async (req, res) => {
  sendJSON(res, 200, { plans: db.all('plans') });
});

route('POST', '/api/platform/plans', async (req, res) => {
  const actor = requirePlatformAuth(req);
  if (!actor) return sendJSON(res, 403, { error: 'forbidden' });
  const { name, priceHTG, billingCycle, maxUsers, maxDepots, modules } = req.body;
  if (!name || priceHTG == null) return sendJSON(res, 400, { error: 'missing_fields' });
  const plan = db.insert('plans', {
    name, priceHTG, billingCycle: billingCycle || 'monthly',
    maxUsers: maxUsers ?? null, maxDepots: maxDepots ?? null,
    modules: modules || Object.keys(roles.BUSINESS_MODULES),
  });
  sendJSON(res, 201, { plan });
});

route('POST', '/api/platform/businesses/:id/subscription', async (req, res, params) => {
  const actor = requirePlatformAuth(req);
  if (!actor) return sendJSON(res, 403, { error: 'forbidden' });
  const { planId, status } = req.body;
  const plan = db.findById('plans', planId);
  if (!plan) return sendJSON(res, 404, { error: 'plan_not_found' });
  const existing = db.all('subscriptions').find(s => s.businessId === params.id);
  let sub;
  if (existing) {
    sub = db.update('subscriptions', existing.id, { planId, status: status || 'active' });
  } else {
    sub = db.insert('subscriptions', { businessId: params.id, planId, status: status || 'active' });
  }
  db.audit({ type: 'subscription_set', actor: actor.id, target: params.id, planId, status: sub.status });
  sendJSON(res, 200, { subscription: sub });
});

// ================= BUSINESS (TENANT) ROUTES =================
// Any entrepreneur signs up, creates their own business, becomes its
// Business Admin, and their data is isolated from every other business.

route('POST', '/api/businesses/signup', async (req, res) => {
  const { businessName, businessType, ownerName, email, password } = req.body;
  if (!businessName || !ownerName || !email || !password) {
    return sendJSON(res, 400, { error: 'missing_fields' });
  }
  if (db.all('businessUsers').some(u => u.email === email)) {
    return sendJSON(res, 409, { error: 'email_already_used' });
  }
  const business = db.insert('businesses', {
    name: businessName,
    type: businessType || 'general',
    status: 'active',
    activeModules: Object.keys(roles.BUSINESS_MODULES), // all enabled by default at signup
  });
  const { salt, hash } = db.hashPassword(password);
  const admin = db.insert('businessUsers', {
    businessId: business.id,
    name: ownerName,
    email,
    role: roles.BUSINESS_ROLES.BUSINESS_ADMIN,
    status: 'active',
    salt, hash,
  });
  // default depot so the business can operate immediately
  db.insert('depots', { businessId: business.id, name: 'Depo Prensipal', isMain: true });
  // free trial subscription — Platform Owner/Super Admin can change the plan later
  db.insert('subscriptions', { businessId: business.id, planId: null, status: 'trialing' });
  db.audit({ type: 'business_created', actor: admin.id, target: business.id });

  const token = auth.sign({ sub: admin.id, scope: 'business', role: admin.role, businessId: business.id });
  sendJSON(res, 201, {
    token,
    business: { id: business.id, name: business.name, type: business.type },
    user: { id: admin.id, name: admin.name, role: admin.role },
  });
});

route('POST', '/api/businesses/login', async (req, res) => {
  const { email, password } = req.body;
  const user = db.all('businessUsers').find(u => u.email === email);
  if (!user || !db.verifyPassword(password, user.salt, user.hash)) {
    return sendJSON(res, 401, { error: 'invalid_credentials' });
  }
  if (user.status !== 'active') return sendJSON(res, 403, { error: 'account_disabled' });
  const business = db.findById('businesses', user.businessId);
  if (!business || business.status !== 'active') {
    return sendJSON(res, 403, { error: 'business_suspended' });
  }
  const token = auth.sign({ sub: user.id, scope: 'business', role: user.role, businessId: user.businessId });
  sendJSON(res, 200, {
    token,
    business: { id: business.id, name: business.name, activeModules: business.activeModules },
    user: { id: user.id, name: user.name, role: user.role, permissions: user.permissions || roles.DEFAULT_BUSINESS_PERMISSIONS[user.role] },
  });
});

// Business Admin creates Managers / Business Users within their own business.
route('POST', '/api/businesses/:id/users', async (req, res, params) => {
  const actor = requireBusinessAuth(req);
  if (!actor || actor.businessId !== params.id) return sendJSON(res, 403, { error: 'forbidden' });
  if (!roles.hasPermission(actor, 'users.create')) return sendJSON(res, 403, { error: 'forbidden' });
  const { name, email, password, role: newRole, permissions } = req.body;
  if (!name || !email || !password || !newRole) return sendJSON(res, 400, { error: 'missing_fields' });
  if (![roles.BUSINESS_ROLES.MANAGER, roles.BUSINESS_ROLES.BUSINESS_USER].includes(newRole)) {
    return sendJSON(res, 400, { error: 'invalid_role' });
  }
  if (db.all('businessUsers').some(u => u.email === email)) {
    return sendJSON(res, 409, { error: 'email_already_used' });
  }
  const { salt, hash } = db.hashPassword(password);
  const user = db.insert('businessUsers', {
    businessId: params.id, name, email, role: newRole, status: 'active',
    permissions: permissions || null, // null = inherit role defaults
    salt, hash,
  });
  db.audit({ type: 'business_user_created', actor: actor.id, target: user.id, businessId: params.id });
  sendJSON(res, 201, { id: user.id, name: user.name, email: user.email, role: user.role });
});

route('GET', '/api/businesses/:id/users', async (req, res, params) => {
  const actor = requireBusinessAuth(req);
  if (!actor || actor.businessId !== params.id) return sendJSON(res, 403, { error: 'forbidden' });
  if (!roles.hasPermission(actor, 'users.view')) return sendJSON(res, 403, { error: 'forbidden' });
  const users = db.all('businessUsers')
    .filter(u => u.businessId === params.id)
    .map(u => ({ id: u.id, name: u.name, email: u.email, role: u.role, status: u.status, permissions: u.permissions }));
  sendJSON(res, 200, { users });
});

route('PATCH', '/api/businesses/:id/users/:userId/permissions', async (req, res, params) => {
  const actor = requireBusinessAuth(req);
  if (!actor || actor.businessId !== params.id) return sendJSON(res, 403, { error: 'forbidden' });
  if (!roles.hasPermission(actor, 'users.permissions')) return sendJSON(res, 403, { error: 'forbidden' });
  const target = db.findById('businessUsers', params.userId);
  if (!target || target.businessId !== params.id) return sendJSON(res, 404, { error: 'not_found' });
  const { permissions } = req.body;
  const updated = db.update('businessUsers', target.id, { permissions });
  db.audit({ type: 'permissions_updated', actor: actor.id, target: target.id, businessId: params.id });
  sendJSON(res, 200, { user: { id: updated.id, permissions: updated.permissions } });
});

// Depots / branches — a business can operate several, each with its own stock.
route('GET', '/api/businesses/:id/depots', async (req, res, params) => {
  const actor = requireBusinessAuth(req);
  if (!actor || actor.businessId !== params.id) return sendJSON(res, 403, { error: 'forbidden' });
  sendJSON(res, 200, { depots: db.all('depots').filter(d => d.businessId === params.id) });
});

route('POST', '/api/businesses/:id/depots', async (req, res, params) => {
  const actor = requireBusinessAuth(req);
  if (!actor || actor.businessId !== params.id) return sendJSON(res, 403, { error: 'forbidden' });
  if (!roles.hasPermission(actor, 'depots.create')) return sendJSON(res, 403, { error: 'forbidden' });
  const { name } = req.body;
  if (!name) return sendJSON(res, 400, { error: 'missing_fields' });
  const depot = db.insert('depots', { businessId: params.id, name, isMain: false });
  sendJSON(res, 201, { depot });
});

// Minimal stock module stub — proves the module-gating + permission model end
// to end. Extend with sales/clients/invoices/caisse/depenses the same way.
route('GET', '/api/businesses/:id/stock/products', async (req, res, params) => {
  const actor = requireBusinessAuth(req);
  if (!actor || actor.businessId !== params.id) return sendJSON(res, 403, { error: 'forbidden' });
  if (!isSubscriptionActive(params.id)) return sendJSON(res, 402, { error: 'subscription_inactive' });
  if (!roles.hasPermission(actor, 'stock.view')) return sendJSON(res, 403, { error: 'forbidden' });
  // TODO: wire up a real `products` collection in db.js (FILES.products) once
  // the stock module is built out — same pattern as depots/businessUsers above.
  sendJSON(res, 200, { products: [] });
});

// ---------- server bootstrap ----------

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname.replace(/\/+$/, '') || '/';

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    });
    return res.end(); // 204 must have no body — sendJSON() would have attached one
  }

  const match = matchRoute(req.method, pathname);
  if (!match) return sendJSON(res, 404, { error: 'route_not_found' });

  try {
    req.body = ['POST', 'PATCH', 'PUT'].includes(req.method) ? await readBody(req) : {};
  } catch {
    return sendJSON(res, 400, { error: 'invalid_json_body' });
  }

  try {
    await match.handler(req, res, match.params);
  } catch (err) {
    console.error('[server] handler error:', err);
    sendJSON(res, 500, { error: 'internal_error' });
  }
});

server.listen(PORT, () => {
  console.log(`Leads Business Platform API running on http://localhost:${PORT}`);
});
