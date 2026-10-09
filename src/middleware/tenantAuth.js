const jwt = require('jsonwebtoken');
const Tenant = require('../models/Tenant');
const { jwtSecret } = require('../config/secrets');

function signStaffToken({ tenantId, accountId, username }) {
  return jwt.sign({ typ: 'staff', tid: tenantId, aid: String(accountId || ''), un: username }, jwtSecret(), {
    expiresIn: '7d',
  });
}

function signImpersonationToken({ tenantId, accountId, username }) {
  return jwt.sign({ typ: 'staff', imp: true, tid: tenantId, aid: String(accountId || ''), un: username }, jwtSecret(), {
    expiresIn: '8h',
  });
}

function signSuperAdminToken(username) {
  return jwt.sign({ typ: 'superadmin', un: username }, jwtSecret(), { expiresIn: '12h' });
}

function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

// Staff must be logged in; sets req.tenantId
async function requireTenant(req, res, next) {
  try {
    const token = bearer(req);
    if (!token) return res.status(401).json({ success: false, message: 'Login required' });
    let decoded;
    try {
      decoded = jwt.verify(token, jwtSecret());
    } catch {
      return res.status(401).json({ success: false, message: 'Session expired. Please login again.' });
    }
    if (decoded.typ !== 'staff') return res.status(401).json({ success: false, message: 'Invalid session' });
    const tenant = await Tenant.findOne({ tenantId: decoded.tid }).lean();
    if (!tenant) return res.status(401).json({ success: false, message: 'Hotel account not found' });
    if (!decoded.imp && (tenant.status === 'suspended' || tenant.status === 'canceled')) {
      return res.status(403).json({ success: false, message: `This hotel account is ${tenant.status}. Contact support.` });
    }
    req.tenantId = tenant.tenantId;
    req.tenant = tenant;
    req.auth = decoded;
    next();
  } catch (err) {
    next(err);
  }
}

function requireSuperAdmin(req, res, next) {
  const token = bearer(req);
  if (!token) return res.status(401).json({ success: false, message: 'Login required' });
  try {
    const decoded = jwt.verify(token, jwtSecret());
    if (decoded.typ !== 'superadmin') throw new Error('wrong type');
    req.superadmin = decoded;
    next();
  } catch {
    return res.status(401).json({ success: false, message: 'Login required as super admin' });
  }
}

// Public pages (booking engine, guest check-in): hotel chosen with ?hotel=<tenantId>, defaults to the default hotel
async function resolvePublicTenant(req, res, next) {
  try {
    const wanted = String(req.query.hotel || req.headers['x-hotel-id'] || '').toLowerCase().trim();
    const tenant = wanted
      ? await Tenant.findOne({ tenantId: wanted }).lean()
      : await Tenant.findOne({ isDefault: true }).lean();
    if (!tenant || tenant.status === 'suspended' || tenant.status === 'canceled') {
      return res.status(404).json({ success: false, message: 'Hotel not found' });
    }
    req.tenantId = tenant.tenantId;
    next();
  } catch (err) {
    next(err);
  }
}

// Tiny in-memory rate limiter (per IP) for login endpoints
function rateLimit({ windowMs = 60_000, max = 20 } = {}) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const ip = req.ip || 'x';
    const entry = hits.get(ip) || { count: 0, reset: now + windowMs };
    if (now > entry.reset) {
      entry.count = 0;
      entry.reset = now + windowMs;
    }
    entry.count += 1;
    hits.set(ip, entry);
    if (entry.count > max) {
      return res.status(429).json({ success: false, message: 'Too many attempts. Please wait a minute.' });
    }
    next();
  };
}

module.exports = {
  signStaffToken,
  signImpersonationToken,
  signSuperAdminToken,
  requireTenant,
  requireSuperAdmin,
  resolvePublicTenant,
  rateLimit,
};
