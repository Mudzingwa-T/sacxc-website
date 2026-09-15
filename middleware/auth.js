const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL || 'tfmudzingwa@tech24group.com';

function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    // Force a password change on first login before anything else is reachable.
    if (req.session.user.must_change_password) {
      var p = req.path || '';
      if (p.indexOf('/password') !== 0 && p.indexOf('/change-password') !== 0 && p.indexOf('/logout') !== 0) {
        return res.redirect('/sacxc-cms/password');
      }
    }
    return next();
  }
  req.session.error = 'Please log in to access the admin panel.';
  res.redirect('/sacxc-cms/login');
}

// SuperAdmin role gate (SACXC operations chief)
function requireSuperAdmin(req, res, next) {
  if (req.session.user && req.session.user.role === 'superadmin') return next();
  req.session.error = 'Super Admin access required.';
  res.redirect('/sacxc-cms');
}

// SUPERADMIN gate — the Tech24 Group super administrator can perform sensitive operations.
function requireDeveloperEmail(req, res, next) {
  if (req.session.user && req.session.user.email === SUPER_ADMIN_EMAIL) return next();
  req.session.error = 'This action requires the developer account (' + SUPER_ADMIN_EMAIL + ').';
  res.redirect('/sacxc-cms');
}

// Returns true if the current user IS the developer. Used for conditional UI.
function isDeveloper(req) {
  return !!(req.session && req.session.user && req.session.user.email === SUPER_ADMIN_EMAIL);
}

function requireAdmin(req, res, next) {
  const allowed = ['superadmin', 'admin'];
  if (req.session.user && allowed.includes(req.session.user.role)) return next();
  req.session.error = 'Admin access required.';
  res.redirect('/sacxc-cms');
}

function requireEditor(req, res, next) {
  const allowed = ['superadmin', 'admin', 'editor'];
  if (req.session.user && allowed.includes(req.session.user.role)) return next();
  req.session.error = 'Editor access required.';
  res.redirect('/sacxc-cms');
}

module.exports = { requireAuth, requireSuperAdmin, requireDeveloperEmail, requireAdmin, requireEditor, isDeveloper, SUPER_ADMIN_EMAIL };
