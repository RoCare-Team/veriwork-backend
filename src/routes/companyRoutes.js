import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { validate } from '../middleware/validate.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { requireCompanyApproved } from '../middleware/requireCompanyApproved.js';
import * as companyController from '../controllers/companyController.js';
import {
  auditLogsQuerySchema,
  companyAccessRequestSchema,
  createVerificationRequestSchema,
  emailVerificationCompleteSchema,
  inviteEmployeeSchema,
} from '../validators/companyValidators.js';

const router = Router();

router.use(authenticate, requireRole('enterprise_admin'), requireCompanyApproved);

// 1. Employee linking
router.post('/invite-employee', validate(inviteEmployeeSchema), asyncHandler(companyController.inviteEmployee));

// 2. Workforce management
router.get('/team', asyncHandler(companyController.getTeam));
router.get('/team/:department', asyncHandler(companyController.getDepartmentTeam));
router.get('/employees/:employeeId/profile', asyncHandler(companyController.getEmployeeProfile));

// 3. Access request & consent
router.post('/access-request', validate(companyAccessRequestSchema), asyncHandler(companyController.createAccessRequest));
router.get('/access-requests', asyncHandler(companyController.listAccessRequests));

// 4. Employment verification workflow
router.post(
  '/verification-request',
  validate(createVerificationRequestSchema),
  asyncHandler(companyController.createVerificationRequest),
);
router.get('/verification-requests/outgoing', asyncHandler(companyController.listOutgoingVerificationRequests));
router.get('/verification-requests/incoming', asyncHandler(companyController.listIncomingVerificationRequests));
router.post('/verification-requests/:id/approve', asyncHandler(companyController.approveVerificationRequest));
router.post('/verification-requests/:id/reject', asyncHandler(companyController.rejectVerificationRequest));
router.post(
  '/verification-requests/:id/complete-email',
  validate(emailVerificationCompleteSchema),
  asyncHandler(companyController.completeEmailVerification),
);

// 5. Insights & analytics
router.get('/insights', asyncHandler(companyController.getInsights));

// 6. Audit logs
router.get('/audit-logs', validate(auditLogsQuerySchema, 'query'), asyncHandler(companyController.listAuditLogs));

export default router;
