import { ApiError } from '../utils/ApiError.js';
import { assertCompanyApproved } from '../utils/companyApproval.js';

export async function requireCompanyApproved(req, _res, next) {
  try {
    if (!req.user?.companyId) {
      throw ApiError.forbidden('No company associated with this account');
    }
    await assertCompanyApproved(req.user.companyId);
    next();
  } catch (err) {
    next(err);
  }
}
