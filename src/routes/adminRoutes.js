import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { validate } from '../middleware/validate.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import {
  reviewCompanySchema,
  adminEmployeesQuerySchema,
  reviewDocumentSchema,
  onboardingMessageSchema,
  aadhaarRequestsQuerySchema,
  reviewAadhaarSchema,
  adminVerificationRequestsQuerySchema,
  adminResendVerificationSchema,
  adminDemoRequestsQuerySchema,
  updateDemoRequestSchema,
  setEmployeeStatusSchema,
  deleteEmployeeSchema,
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

// Removing an employee comes in two strengths. Deactivating flips isActive,
// which blocks login straight away and is undone by sending isActive:true.
// DELETE is the irreversible purge and needs the employee's name or PagerLook
// ID echoed back in `confirm`.
router.patch(
  '/employees/:id/status',
  validate(setEmployeeStatusSchema),
  asyncHandler(adminController.setEmployeeStatus),
);
router.delete(
  '/employees/:id',
  validate(deleteEmployeeSchema),
  asyncHandler(adminController.deleteEmployee),
);

// Employment verification support desk — every request, whoever started it,
// plus a resend that can fix or extend the HR contact list.
router.get(
  '/verification-requests',
  validate(adminVerificationRequestsQuerySchema, 'query'),
  asyncHandler(adminController.listVerificationRequests),
);
router.post(
  '/verification-requests/:id/resend',
  validate(adminResendVerificationSchema),
  asyncHandler(adminController.resendVerificationRequest),
);

// Manual Aadhaar KYC review queue
router.get(
  '/aadhaar-requests',
  validate(aadhaarRequestsQuerySchema, 'query'),
  asyncHandler(adminController.listAadhaarRequests),
);
router.get('/aadhaar-requests/:id', asyncHandler(adminController.getAadhaarRequest));
router.patch(
  '/aadhaar-requests/:id/review',
  validate(reviewAadhaarSchema),
  asyncHandler(adminController.reviewAadhaarRequest),
);
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

// Demo requests filed from the public site
router.get(
  '/demo-requests',
  validate(adminDemoRequestsQuerySchema, 'query'),
  asyncHandler(adminController.listDemoRequests),
);
router.patch(
  '/demo-requests/:id',
  validate(updateDemoRequestSchema),
  asyncHandler(adminController.updateDemoRequest),
);

export default router;
