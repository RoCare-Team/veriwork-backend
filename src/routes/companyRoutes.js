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
  approveVerificationRequestSchema,
  reviewHrResponseSchema,
  emailVerificationCompleteSchema,
  assignEmployeeOnboardingSchema,
  inviteEmployeeSchema,
  revokeAccessSchema,
  smtpSettingsSchema,
  smtpTestSchema,
} from '../validators/companyValidators.js';

const router = Router();

router.use(authenticate, requireRole('enterprise_admin'), requireCompanyApproved);

// 1. Employee linking
router.post('/invite-employee', validate(inviteEmployeeSchema), asyncHandler(companyController.inviteEmployee));
router.get('/invitations/pending', asyncHandler(companyController.listPendingInvitations));

// 2. Workforce management
router.get('/workspace', asyncHandler(companyController.getWorkspace));
router.get('/team', asyncHandler(companyController.getTeam));
router.get('/team/:department', asyncHandler(companyController.getDepartmentTeam));
router.get('/platform-companies/search', asyncHandler(companyController.searchRegisteredCompanies));
router.get('/employees/search', asyncHandler(companyController.searchEmployees));
router.get('/employees/:employeeId', asyncHandler(companyController.getEmployeeById));
router.get('/employees/:employeeId/profile', asyncHandler(companyController.getEmployeeProfile));
router.get('/employees/:employeeId/documents', asyncHandler(companyController.getEmployeeDocuments));
router.get('/employees/:employeeId/access-status', asyncHandler(companyController.getEmployeeAccessStatus));
router.patch(
  '/employees/:employeeId/onboarding',
  validate(assignEmployeeOnboardingSchema),
  asyncHandler(companyController.assignEmployeeOnboarding),
);
router.post(
  '/employees/:employeeId/revoke-access',
  validate(revokeAccessSchema),
  asyncHandler(companyController.revokeEmployeeAccess),
);

// 3. Access request & consent
router.get('/access-request-types', asyncHandler(companyController.listAccessRequestTypes));
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
router.post(
  '/verification-requests/:id/approve',
  validate(approveVerificationRequestSchema),
  asyncHandler(companyController.approveVerificationRequest),
);
router.post('/verification-requests/:id/reject', asyncHandler(companyController.rejectVerificationRequest));
router.post(
  '/verification-requests/:id/review-hr-response',
  validate(reviewHrResponseSchema),
  asyncHandler(companyController.reviewHrResponse),
);
router.post(
  '/verification-requests/:id/confirm-document-verification',
  asyncHandler(companyController.confirmDocumentVerification),
);
router.get(
  '/employees/:employeeId/jobs/:jobId/verification-record',
  asyncHandler(companyController.getEmployeeJobVerificationRecord),
);
router.post(
  '/verification-requests/:id/complete-email',
  validate(emailVerificationCompleteSchema),
  asyncHandler(companyController.completeEmailVerification),
);
router.post(
  '/verification-requests/:id/resend-email',
  asyncHandler(companyController.resendVerificationEmail),
);

// 5. SMTP settings
router.get('/settings/smtp', asyncHandler(companyController.getSmtpSettings));
router.put('/settings/smtp', validate(smtpSettingsSchema), asyncHandler(companyController.updateSmtpSettings));
router.post('/settings/smtp/test', validate(smtpTestSchema), asyncHandler(companyController.testSmtpSettings));

// 6. Insights & analytics
router.get('/insights', asyncHandler(companyController.getInsights));

// 6. Audit logs
router.get('/audit-logs', validate(auditLogsQuerySchema, 'query'), asyncHandler(companyController.listAuditLogs));

export default router;
