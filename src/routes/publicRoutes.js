import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { validate } from '../middleware/validate.js';
import { upload } from '../middleware/upload.js';
import * as publicController from '../controllers/publicController.js';
import {
  publicProfileAccessRequestSchema,
  publicVerificationRespondSchema,
  acceptCompanyUserInviteSchema,
  qrJoinRequestSchema,
} from '../validators/publicValidators.js';

const router = Router();

// QR onboarding — a scanned candidate lands here and submits a join request
router.get('/qr/:code', asyncHandler(publicController.getQrJoinInfo));
router.post('/qr/:code/join', validate(qrJoinRequestSchema), asyncHandler(publicController.submitQrJoinRequest));

// Company staff invite — accept + set password (no auth: the token is the proof)
router.get('/company-invite/:token', asyncHandler(publicController.getCompanyUserInvite));
router.post(
  '/company-invite/:token/accept',
  validate(acceptCompanyUserInviteSchema),
  asyncHandler(publicController.acceptCompanyUserInvite),
);

router.get('/profile/:slug', asyncHandler(publicController.getPublicProfile));
router.post(
  '/profile/:slug/request-access',
  validate(publicProfileAccessRequestSchema),
  asyncHandler(publicController.requestPublicProfileAccess),
);
router.get('/employee-invitation/:token', asyncHandler(publicController.getEmployeeInvitation));
router.get('/employment-verification/:token', asyncHandler(publicController.getEmploymentVerification));
router.post(
  '/employment-verification/:token/document',
  upload.single('document'),
  asyncHandler(publicController.uploadEmploymentVerificationDocument),
);
router.post(
  '/employment-verification/:token',
  validate(publicVerificationRespondSchema),
  asyncHandler(publicController.respondEmploymentVerification),
);

export default router;
