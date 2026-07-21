import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { validate } from '../middleware/validate.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import {
  reviewCompanySchema,
  adminEmployeesQuerySchema,
  reviewDocumentSchema,
  onboardingMessageSchema,
} from '../validators/adminValidators.js';
import * as adminController from '../controllers/adminController.js';

const router = Router();

router.use(authenticate, requireRole('platform_admin'));

router.get('/dashboard', asyncHandler(adminController.getDashboard));
router.get(
  '/employees',
  validate(adminEmployeesQuerySchema, 'query'),
  asyncHandler(adminController.listEmployees),
);
router.get('/employees/:id', asyncHandler(adminController.getEmployee));
router.get('/companies', asyncHandler(adminController.listCompanies));
router.get('/companies/:id', asyncHandler(adminController.getCompany));
router.patch(
  '/companies/:id/review',
  validate(reviewCompanySchema),
  asyncHandler(adminController.reviewCompany),
);

// Per-document review — reject one file without voiding the whole application
router.patch(
  '/companies/:id/documents/review',
  validate(reviewDocumentSchema),
  asyncHandler(adminController.reviewCompanyDocument),
);

// Application message thread
router.get('/companies/:id/messages', asyncHandler(adminController.listCompanyMessages));
router.post(
  '/companies/:id/messages',
  validate(onboardingMessageSchema),
  asyncHandler(adminController.postCompanyMessage),
);

export default router;
