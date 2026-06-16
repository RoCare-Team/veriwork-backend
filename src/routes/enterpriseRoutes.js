import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { validate } from '../middleware/validate.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { requireCompanyApproved } from '../middleware/requireCompanyApproved.js';
import { upload } from '../middleware/upload.js';
import {
  basicInfoSchema,
  registrationSchema,
  submitOnboardingSchema,
  updateJoinRequestSchema,
  createJoinRequestSchema,
  createQrSchema,
  teamEmployeesQuerySchema,
  accessRequestsQuerySchema,
  createAccessRequestSchema,
} from '../validators/enterpriseValidators.js';
import * as enterpriseController from '../controllers/enterpriseController.js';

const router = Router();

router.use(authenticate, requireRole('enterprise_admin'));

router.get('/onboarding', asyncHandler(enterpriseController.getOnboarding));
router.patch('/onboarding/basic-info', validate(basicInfoSchema), asyncHandler(enterpriseController.updateBasicInfo));
router.patch('/onboarding/registration', validate(registrationSchema), asyncHandler(enterpriseController.updateRegistration));
router.post(
  '/onboarding/documents/:docType',
  upload.single('document'),
  asyncHandler(enterpriseController.uploadDocument),
);
router.post('/onboarding/submit', validate(submitOnboardingSchema), asyncHandler(enterpriseController.submitOnboarding));

router.use(requireCompanyApproved);

router.get('/dashboard', asyncHandler(enterpriseController.getDashboard));
router.get('/workforce', asyncHandler(enterpriseController.getWorkforce));

router.get('/team/departments', asyncHandler(enterpriseController.getDepartments));
router.get(
  '/team/employees',
  validate(teamEmployeesQuerySchema, 'query'),
  asyncHandler(enterpriseController.listTeamEmployees),
);
router.get('/team/employees/:id', asyncHandler(enterpriseController.getTeamEmployee));

router.get(
  '/access-requests',
  validate(accessRequestsQuerySchema, 'query'),
  asyncHandler(enterpriseController.listAccessRequests),
);
router.post(
  '/access-requests',
  validate(createAccessRequestSchema),
  asyncHandler(enterpriseController.createAccessRequest),
);
router.get('/access-requests/:id', asyncHandler(enterpriseController.getAccessRequest));

router.get('/insights', asyncHandler(enterpriseController.getInsights));

router.get('/join-requests', asyncHandler(enterpriseController.listJoinRequests));
router.post('/join-requests', validate(createJoinRequestSchema), asyncHandler(enterpriseController.createJoinRequest));
router.patch(
  '/join-requests/:id',
  validate(updateJoinRequestSchema),
  asyncHandler(enterpriseController.updateJoinRequest),
);

router.get('/qr-onboarding', asyncHandler(enterpriseController.listQrCodes));
router.post('/qr-onboarding', validate(createQrSchema), asyncHandler(enterpriseController.createQrCode));

export default router;
