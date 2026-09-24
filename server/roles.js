// roles.js — Role hierarchy for Leads Business Platform
//
// LEADS BUSINESS PLATFORM
// │
// ├── Platform Owner      (platform scope — full control, 1 per platform)
// ├── Super Admin         (platform scope — manages businesses/subscriptions/security)
// │
// └── Businesses          (tenant scope — data isolated per business)
//      ├── Business Admin (full control within their own business)
//      ├── Manager        (operational control within assigned depot/branch or module)
//      └── Business User  (limited, permission-based access)

const PLATFORM_ROLES = {
  PLATFORM_OWNER: 'platform_owner',
  SUPER_ADMIN: 'super_admin',
};

const BUSINESS_ROLES = {
  BUSINESS_ADMIN: 'business_admin',
  MANAGER: 'manager',
  BUSINESS_USER: 'business_user',
};

// Platform-level permissions (control the SaaS itself)
const PLATFORM_PERMISSIONS = [
  'platform.businesses.view',
  'platform.businesses.suspend',
  'platform.businesses.delete',
  'platform.subscriptions.manage',
  'platform.plans.manage',
  'platform.admins.manage',       // create/remove Super Admins (Platform Owner only)
  'platform.security.audit',
];

// Business-level permission catalogue. Modules a business can activate;
// each module exposes view/create/edit/delete-style permissions.
const BUSINESS_MODULES = {
  stock: ['stock.view', 'stock.create', 'stock.edit', 'stock.delete', 'stock.adjust'],
  sales: ['sales.view', 'sales.create', 'sales.edit', 'sales.cancel'],
  clients: ['clients.view', 'clients.create', 'clients.edit', 'clients.delete'],
  invoices: ['invoices.view', 'invoices.create', 'invoices.edit', 'invoices.void'],
  caisse: ['caisse.view', 'caisse.deposit', 'caisse.withdraw', 'caisse.close'],
  depenses: ['depenses.view', 'depenses.create', 'depenses.approve'],
  reports: ['reports.view', 'reports.export'],
  depots: ['depots.view', 'depots.create', 'depots.edit'],
  users: ['users.view', 'users.create', 'users.edit', 'users.deactivate', 'users.permissions'],
};

function allBusinessPermissions() {
  return Object.values(BUSINESS_MODULES).flat();
}

// Default permission sets per business role. Business Admin can override
// per-user permissions individually (see business_users.json `permissions`).
const DEFAULT_BUSINESS_PERMISSIONS = {
  [BUSINESS_ROLES.BUSINESS_ADMIN]: allBusinessPermissions(),
  [BUSINESS_ROLES.MANAGER]: [
    'stock.view', 'stock.create', 'stock.edit', 'stock.adjust',
    'sales.view', 'sales.create', 'sales.edit',
    'clients.view', 'clients.create', 'clients.edit',
    'invoices.view', 'invoices.create',
    'caisse.view', 'caisse.deposit', 'caisse.withdraw',
    'depenses.view', 'depenses.create',
    'reports.view',
    'depots.view',
  ],
  [BUSINESS_ROLES.BUSINESS_USER]: [
    'stock.view',
    'sales.view', 'sales.create',
    'clients.view', 'clients.create',
    'invoices.view', 'invoices.create',
  ],
};

function hasPermission(businessUser, permission) {
  if (businessUser.role === BUSINESS_ROLES.BUSINESS_ADMIN) return true;
  const perms = businessUser.permissions || DEFAULT_BUSINESS_PERMISSIONS[businessUser.role] || [];
  return perms.includes(permission);
}

module.exports = {
  PLATFORM_ROLES,
  BUSINESS_ROLES,
  PLATFORM_PERMISSIONS,
  BUSINESS_MODULES,
  DEFAULT_BUSINESS_PERMISSIONS,
  allBusinessPermissions,
  hasPermission,
};
