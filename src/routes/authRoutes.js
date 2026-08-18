import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/auth.js';
import {
  phoneSchema,
  otpVerifySchema,
  employeeGoogleSchema,
  enterpriseLoginSchema,
  platformAdminLoginSchema,
  enterpriseRegisterSchema,
  refreshTokenSchema,
  logoutSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from '../validators/authValidators.js';
import * as authController from '../controllers/authController.js';

const router = Router();

/**
 * @swagger
 * /auth/employee/otp/send:
 *   post:
 *     tags: [Auth]
 *     summary: Send OTP to employee phone
 *     description: >
 *       Returns { phone, otpLength, resendInSeconds, expiresInMinutes, message }.
 *       429 when the resend cooldown or the hourly cap is hit — `details.retryAfterSeconds`
 *       says how long to wait.
 */
router.post('/employee/otp/send', validate(phoneSchema), asyncHandler(authController.sendEmployeeOtp));

/**
 * @swagger
 * /auth/employee/otp/verify:
 *   post:
 *     tags: [Auth]
 *     summary: Verify OTP and login/register employee
 *     description: >
 *       The code is 4-8 digits (the SMS gateway sends 4). 400 for a wrong or
 *       expired code, 429 once the attempt cap is reached — a fresh code is
 *       then required.
 */
router.post('/employee/otp/verify', validate(otpVerifySchema), asyncHandler(authController.verifyEmployeeOtp));
router.post('/employee/google', validate(employeeGoogleSchema), asyncHandler(authController.employeeGoogleLogin));

router.post('/enterprise/login', validate(enterpriseLoginSchema), asyncHandler(authController.enterpriseLogin));
router.post('/admin/login', validate(platformAdminLoginSchema), asyncHandler(authController.platformAdminLogin));
router.post('/enterprise/register', validate(enterpriseRegisterSchema), asyncHandler(authController.enterpriseRegister));
router.post('/forgot-password', validate(forgotPasswordSchema), asyncHandler(authController.forgotPassword));
router.post('/reset-password', validate(resetPasswordSchema), asyncHandler(authController.resetPassword));
router.post('/refresh', validate(refreshTokenSchema), asyncHandler(authController.refresh));
router.post('/logout', validate(logoutSchema), asyncHandler(authController.logout));
router.post(
  '/change-password',
  authenticate,
  validate(changePasswordSchema),
  asyncHandler(authController.changePassword),
);

export default router;
