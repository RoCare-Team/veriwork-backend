import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { validate } from '../middleware/validate.js';
import * as publicController from '../controllers/publicController.js';
import { publicVerificationRespondSchema } from '../validators/publicValidators.js';

const router = Router();

router.get('/profile/:slug', asyncHandler(publicController.getPublicProfile));
router.get('/employee-invitation/:token', asyncHandler(publicController.getEmployeeInvitation));
router.get('/employment-verification/:token', asyncHandler(publicController.getEmploymentVerification));
router.post(
  '/employment-verification/:token',
  validate(publicVerificationRespondSchema),
  asyncHandler(publicController.respondEmploymentVerification),
);

export default router;
