import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { verifyAccessToken } from '../services/tokenService.js';
import { MODULE_LABELS } from '../utils/permissions.js';
import { userHasPermission } from '../services/rolePermissionService.js';

export async function authenticate(req, _res, next) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw ApiError.unauthorized('Missing or invalid authorization header');
    }

    const token = header.slice(7);
    const payload = verifyAccessToken(token);
    const user = await User.findById(payload.sub);

    if (!user || !user.isActive) {
      throw ApiError.unauthorized('User not found or inactive');
    }

    req.user = user;
    req.auth = payload;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(ApiError.forbidden('Insufficient permissions'));
    }
    return next();
  };
}

/**
 * Guard a company route by module permission, e.g.
 *   requirePermission('team', 'manage')
 * `view` is implied by `manage`, so state the minimum the route needs.
 */
export function requirePermission(module, level = 'view') {
  return async (req, _res, next) => {
    try {
      // Async: a custom role's permissions live in the DB, not in code.
      const allowed = await userHasPermission(req.user, module, level);
      if (!allowed) {
        const label = MODULE_LABELS[module] || module.replace(/_/g, ' ');
        return next(
          ApiError.forbidden(
            `Your role does not have permission to ${level === 'manage' ? 'manage' : 'view'} ${label}.`,
          ),
        );
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}
