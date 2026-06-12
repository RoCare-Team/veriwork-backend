import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { validate } from '../middleware/validate.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { reviewCompanySchema } from '../validators/adminValidators.js';
import * as adminController from '../controllers/adminController.js';

const router = Router();

router.use(authenticate, requireRole('platform_admin'));

router.get('/dashboard', asyncHandler(adminController.getDashboard));
router.get('/companies', asyncHandler(adminController.listCompanies));
router.get('/companies/:id', asyncHandler(adminController.getCompany));
router.patch(
  '/companies/:id/review',
  validate(reviewCompanySchema),
  asyncHandler(adminController.reviewCompany),
);

export default router;
