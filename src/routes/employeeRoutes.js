import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { validate } from '../middleware/validate.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';
import {
  updateProfileSchema,
  aadhaarVerifySchema,
  createJobSchema,
  activityActionSchema,
  createVaultItemSchema,
} from '../validators/employeeValidators.js';
import * as employeeController from '../controllers/employeeController.js';

const router = Router();

router.use(authenticate, requireRole('employee'));

router.get('/profile', asyncHandler(employeeController.getProfile));
router.patch('/profile', validate(updateProfileSchema), asyncHandler(employeeController.updateProfile));

router.get('/score', asyncHandler(employeeController.getScore));

router.get('/verification/status', asyncHandler(employeeController.getVerificationStatus));
router.post('/verification/aadhaar', validate(aadhaarVerifySchema), asyncHandler(employeeController.verifyAadhaar));
router.post(
  '/verification/biometric',
  upload.single('photo'),
  asyncHandler(employeeController.verifyBiometric),
);

router.get('/jobs', asyncHandler(employeeController.listJobs));
router.post('/jobs', validate(createJobSchema), asyncHandler(employeeController.createJob));
router.post(
  '/jobs/:id/documents',
  upload.single('document'),
  asyncHandler(employeeController.uploadJobDocument),
);

router.get('/activity', asyncHandler(employeeController.listActivity));
router.patch(
  '/activity/:id',
  validate(activityActionSchema),
  asyncHandler(employeeController.updateActivity),
);

router.get('/vault', asyncHandler(employeeController.listVault));
router.post(
  '/vault',
  upload.single('document'),
  validate(createVaultItemSchema),
  asyncHandler(employeeController.createVaultItem),
);

router.get('/settings', asyncHandler(employeeController.getSettings));

export default router;
