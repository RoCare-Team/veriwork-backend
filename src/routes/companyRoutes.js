import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { validate } from '../middleware/validate.js';
import { authenticate, requireRole, requirePermission } from '../middleware/auth.js';
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
  inviteCompanyUserSchema,
  updateCompanyUserRoleSchema,
  createCompanyUserSchema,
  resetCompanyUserPasswordSchema,
  createCompanyRoleSchema,
  updateCompanyRoleSchema,
} from '../validators/companyValidators.js';

const router = Router();

router.use(authenticate, requireRole('enterprise_admin'), requireCompanyApproved);

// 0. Roles & permissions (every signed-in company user may read their own)
router.get('/me/permissions', asyncHandler(companyController.getMyPermissions));
router.get('/roles', asyncHandler(companyController.listRoles));

// 0a. Custom roles — build a role and tick exactly what it may do
router.post(
  '/roles',
  requirePermission('company_users', 'manage'),
  validate(createCompanyRoleSchema),
  asyncHandler(companyController.createRole),
);
router.patch(
  '/roles/:roleId',
  requirePermission('company_users', 'manage'),
  validate(updateCompanyRoleSchema),
  asyncHandler(companyController.updateRole),
);
router.delete(
  '/roles/:roleId',
  requirePermission('company_users', 'manage'),
  asyncHandler(companyController.deleteRole),
);

// 0b. Company users (staff accounts + role management)
router.get('/users', requirePermission('company_users', 'view'), asyncHandler(companyController.listCompanyUsers));
router.post(
  '/users',
  requirePermission('company_users', 'manage'),
  validate(createCompanyUserSchema),
  asyncHandler(companyController.createCompanyUser),
);
router.post(
  '/users/:userId/password',
  requirePermission('company_users', 'manage'),
  validate(resetCompanyUserPasswordSchema),
  asyncHandler(companyController.resetCompanyUserPassword),
);
router.post(
  '/users/invite',
  requirePermission('company_users', 'manage'),
  validate(inviteCompanyUserSchema),
  asyncHandler(companyController.inviteCompanyUser),
);
router.post(
  '/users/invites/:inviteId/revoke',
  requirePermission('company_users', 'manage'),
  asyncHandler(companyController.revokeCompanyUserInvite),
);
router.patch(
  '/users/:userId/role',
  requirePermission('company_users', 'manage'),
  validate(updateCompanyUserRoleSchema),
  asyncHandler(companyController.updateCompanyUserRole),
);
router.delete(
  '/users/:userId',
  requirePermission('company_users', 'manage'),
  asyncHandler(companyController.removeCompanyUser),
);

// 1. Employee linking
router.post(
  '/invite-employee',
  requirePermission('team', 'manage'),
  validate(inviteEmployeeSchema),
  asyncHandler(companyController.inviteEmployee),
);
router.get('/invitations/pending', requirePermission('team', 'view'), asyncHandler(companyController.listPendingInvitations));

// 2. Workforce management
router.get('/workspace', asyncHandler(companyController.getWorkspace));
router.get('/team', requirePermission('team', 'view'), asyncHandler(companyController.getTeam));
router.get('/team/:department', requirePermission('team', 'view'), asyncHandler(companyController.getDepartmentTeam));
router.get('/platform-companies/search', asyncHandler(companyController.searchRegisteredCompanies));
router.get('/employees/search', requirePermission('team', 'manage'), asyncHandler(companyController.searchEmployees));
router.get('/employees/:employeeId', requirePermission('team', 'view'), asyncHandler(companyController.getEmployeeById));
router.get('/employees/:employeeId/profile', requirePermission('team', 'view'), asyncHandler(companyController.getEmployeeProfile));
router.get('/employees/:employeeId/documents', requirePermission('team', 'view'), asyncHandler(companyController.getEmployeeDocuments));
router.get('/employees/:employeeId/access-status', requirePermission('team', 'view'), asyncHandler(companyController.getEmployeeAccessStatus));
router.patch(
  '/employees/:employeeId/onboarding',
  requirePermission('workforce', 'manage'),
  validate(assignEmployeeOnboardingSchema),
  asyncHandler(companyController.assignEmployeeOnboarding),
);
router.post(
  '/employees/:employeeId/revoke-access',
  requirePermission('access_requests', 'manage'),
  validate(revokeAccessSchema),
  asyncHandler(companyController.revokeEmployeeAccess),
);

// 3. Access request & consent
router.get('/access-request-types', asyncHandler(companyController.listAccessRequestTypes));
router.post(
  '/access-request',
  requirePermission('access_requests', 'manage'),
  validate(companyAccessRequestSchema),
  asyncHandler(companyController.createAccessRequest),
);
router.get('/access-requests', requirePermission('access_requests', 'view'), asyncHandler(companyController.listAccessRequests));

// 4. Employment verification workflow
router.post(
  '/verification-request',
  requirePermission('verification', 'manage'),
  validate(createVerificationRequestSchema),
  asyncHandler(companyController.createVerificationRequest),
);
router.get(
  '/verification-requests/outgoing',
  requirePermission('verification', 'view'),
  asyncHandler(companyController.listOutgoingVerificationRequests),
);
router.get(
  '/verification-requests/incoming',
  requirePermission('verification', 'view'),
  asyncHandler(companyController.listIncomingVerificationRequests),
);
router.post(
  '/verification-requests/:id/approve',
  requirePermission('verification', 'manage'),
  validate(approveVerificationRequestSchema),
  asyncHandler(companyController.approveVerificationRequest),
);
router.post(
  '/verification-requests/:id/reject',
  requirePermission('verification', 'manage'),
  asyncHandler(companyController.rejectVerificationRequest),
);
router.post(
  '/verification-requests/:id/review-hr-response',
  requirePermission('verification', 'manage'),
  validate(reviewHrResponseSchema),
  asyncHandler(companyController.reviewHrResponse),
);
router.post(
  '/verification-requests/:id/confirm-document-verification',
  requirePermission('verification', 'manage'),
  asyncHandler(companyController.confirmDocumentVerification),
);
router.get(
  '/employees/:employeeId/jobs/:jobId/verification-record',
  requirePermission('verification', 'view'),
  asyncHandler(companyController.getEmployeeJobVerificationRecord),
);
router.post(
  '/verification-requests/:id/complete-email',
  requirePermission('verification', 'manage'),
  validate(emailVerificationCompleteSchema),
  asyncHandler(companyController.completeEmailVerification),
);
router.post(
  '/verification-requests/:id/resend-email',
  requirePermission('verification', 'manage'),
  asyncHandler(companyController.resendVerificationEmail),
);

// 5. SMTP settings
router.get('/settings/smtp', requirePermission('settings', 'view'), asyncHandler(companyController.getSmtpSettings));
router.put(
  '/settings/smtp',
  requirePermission('settings', 'manage'),
  validate(smtpSettingsSchema),
  asyncHandler(companyController.updateSmtpSettings),
);
router.post(
  '/settings/smtp/test',
  requirePermission('settings', 'manage'),
  validate(smtpTestSchema),
  asyncHandler(companyController.testSmtpSettings),
);

// 6. Insights & analytics
router.get('/insights', requirePermission('dashboard', 'view'), asyncHandler(companyController.getInsights));

// 7. Audit logs
router.get(
  '/audit-logs',
  requirePermission('settings', 'view'),
  validate(auditLogsQuerySchema, 'query'),
  asyncHandler(companyController.listAuditLogs),
);

export default router;
