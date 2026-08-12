import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { validate } from '../middleware/validate.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { upload, uploadPhoto } from '../middleware/upload.js';
import { preprocessProfileBody } from '../middleware/preprocessProfileBody.js';
import {
  updateProfileSchema,
  setupProfileSchema,
  aadhaarManualSubmitSchema,
  endorseEmployeeSchema,
  createJobSchema,
  activityActionSchema,
  createVaultItemSchema,
  activityQuerySchema,
  updateSettingsSchema,
  jobVerificationRequestSchema,
  resendVerificationRequestSchema,
  suggestionsQuerySchema,
  smtpSettingsSchema,
  smtpTestSchema,
} from '../validators/employeeValidators.js';
import * as employeeController from '../controllers/employeeController.js';

const router = Router();

router.use(authenticate, requireRole('employee'));

// Profile setup — must be before /profile routes
router.post(
  '/profile/setup',
  uploadPhoto.single('photo'),
  preprocessProfileBody,
  validate(setupProfileSchema),
  asyncHandler(employeeController.setupProfile),
);

router.get('/profile', asyncHandler(employeeController.getProfile));
router.get(
  '/suggestions/companies',
  validate(suggestionsQuerySchema, 'query'),
  asyncHandler(employeeController.suggestCompanies),
);
router.get(
  '/suggestions/roles',
  validate(suggestionsQuerySchema, 'query'),
  asyncHandler(employeeController.suggestRoles),
);
router.patch(
  '/profile',
  uploadPhoto.single('photo'),
  preprocessProfileBody,
  validate(updateProfileSchema),
  asyncHandler(employeeController.updateProfile),
);

router.get('/score', asyncHandler(employeeController.getScore));
router.get('/endorsements', asyncHandler(employeeController.listEndorsements));
router.post('/endorse', validate(endorseEmployeeSchema), asyncHandler(employeeController.endorseEmployee));

router.get('/professional-id', asyncHandler(employeeController.getProfessionalId));

router.get('/verification/status', asyncHandler(employeeController.getVerificationStatus));

// Manual Aadhaar KYC: the employee uploads the card front + back and types the
// number; a platform admin reviews it before aadhaarVerified is set.
router.get('/verification/aadhaar', asyncHandler(employeeController.getAadhaarSubmission));
router.post(
  '/verification/aadhaar',
  uploadPhoto.fields([
    { name: 'frontImage', maxCount: 1 },
    { name: 'backImage', maxCount: 1 },
  ]),
  validate(aadhaarManualSubmitSchema),
  asyncHandler(employeeController.submitAadhaar),
);

// `selfie` is matched against the approved Aadhaar photo; `poses` are the
// left/right frames used for the liveness check.
router.post(
  '/verification/biometric',
  uploadPhoto.fields([
    { name: 'selfie', maxCount: 1 },
    { name: 'photo', maxCount: 1 },
    { name: 'poses', maxCount: 4 },
  ]),
  asyncHandler(employeeController.verifyBiometric),
);

router.get('/jobs', asyncHandler(employeeController.listJobs));
router.post('/jobs', validate(createJobSchema), asyncHandler(employeeController.createJob));
router.post(
  '/jobs/:id/documents',
  upload.single('document'),
  asyncHandler(employeeController.uploadJobDocument),
);
router.post(
  '/jobs/:id/verification-request',
  validate(jobVerificationRequestSchema),
  asyncHandler(employeeController.createJobVerificationRequest),
);
router.get('/jobs/:id/verification', asyncHandler(employeeController.getJobVerification));
router.get('/verification/requests', asyncHandler(employeeController.listVerificationRequests));
// Follow-up when the previous employer never responded — re-sends the SAME
// request (no duplicate), optionally to a corrected HR address.
router.post(
  '/verification-requests/:id/resend',
  validate(resendVerificationRequestSchema),
  asyncHandler(employeeController.resendJobVerificationRequest),
);
router.post('/verification-requests/:id/approve-consent', asyncHandler(employeeController.approveVerificationConsent));
router.post('/verification-requests/:id/reject-consent', asyncHandler(employeeController.rejectVerificationConsent));
router.get('/verification/tags', asyncHandler(employeeController.getVerificationTags));

router.get(
  '/activity',
  validate(activityQuerySchema, 'query'),
  asyncHandler(employeeController.listActivity),
);
router.patch(
  '/activity/:id',
  validate(activityActionSchema),
  asyncHandler(employeeController.updateActivity),
);

router.get('/invitations', asyncHandler(employeeController.listInvitations));
router.post('/invitations/:id/accept', asyncHandler(employeeController.acceptInvitation));
router.post('/invitations/:id/reject', asyncHandler(employeeController.rejectInvitation));

router.get('/access-requests', asyncHandler(employeeController.listAccessRequests));
router.post('/access-request/:id/approve', asyncHandler(employeeController.approveAccessRequest));
router.post('/access-request/:id/reject', asyncHandler(employeeController.rejectAccessRequest));

router.get('/vault', asyncHandler(employeeController.listVault));
router.post(
  '/vault',
  upload.single('document'),
  validate(createVaultItemSchema),
  asyncHandler(employeeController.createVaultItem),
);

router.get('/settings', asyncHandler(employeeController.getSettings));
router.patch(
  '/settings',
  validate(updateSettingsSchema),
  asyncHandler(employeeController.updateSettings),
);

// Employee SMTP (mailbox) settings — used to send self-initiated verification emails
router.get('/settings/smtp', asyncHandler(employeeController.getSmtpSettings));
router.put('/settings/smtp', validate(smtpSettingsSchema), asyncHandler(employeeController.updateSmtpSettings));
router.post('/settings/smtp/test', validate(smtpTestSchema), asyncHandler(employeeController.testSmtpSettings));

export default router;
