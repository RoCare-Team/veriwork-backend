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
  employerDeletionConfirmSchema,
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
/**
 * @swagger
 * /auth/delete-account/employee/send-otp:
 *   post:
 *     tags: [Auth]
 *     summary: Send an account-deletion OTP to an employee's mobile number
 *     description: >
 *       No login needed (Play Store account deletion). Body { phone }.
 *       404 when no employee is registered with that number; same 429
 *       throttling as the login OTP.
 * /auth/delete-account/employee/confirm:
 *   post:
 *     tags: [Auth]
 *     summary: Verify the SMS OTP and permanently delete the employee account
 *     description: Body { phone, code }. Irreversible.
 * /auth/delete-account/employer/send-otp:
 *   post:
 *     tags: [Auth]
 *     summary: Email an account-deletion OTP to an employer's work email
 *     description: >
 *       Body { email }. 6-digit code, valid 10 minutes, one send per minute.
 * /auth/delete-account/employer/confirm:
 *   post:
 *     tags: [Auth]
 *     summary: Verify the email OTP and permanently delete the employer account
 *     description: >
 *       Body { email, code }. The company owner deletes the whole company and
 *       all its team logins (`companyDeleted: true`); any other team member
 *       deletes only their own login. Irreversible.
 */
router.post(
  '/delete-account/employee/send-otp',
  validate(phoneSchema),
  asyncHandler(authController.sendEmployeeDeletionOtp),
);
router.post(
  '/delete-account/employee/confirm',
  validate(otpVerifySchema),
  asyncHandler(authController.confirmEmployeeDeletion),
);
router.post(
  '/delete-account/employer/send-otp',
  validate(forgotPasswordSchema),
  asyncHandler(authController.sendEmployerDeletionOtp),
);
router.post(
  '/delete-account/employer/confirm',
  validate(employerDeletionConfirmSchema),
  asyncHandler(authController.confirmEmployerDeletion),
);

router.post(
  '/change-password',
  authenticate,
  validate(changePasswordSchema),
  asyncHandler(authController.changePassword),
);

export default router;
