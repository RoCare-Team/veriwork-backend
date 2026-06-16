import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { validate } from '../middleware/validate.js';
import {
  phoneSchema,
  otpVerifySchema,
  employeeGoogleSchema,
  enterpriseLoginSchema,
  platformAdminLoginSchema,
  enterpriseRegisterSchema,
  refreshTokenSchema,
  logoutSchema,
} from '../validators/authValidators.js';
import * as authController from '../controllers/authController.js';

const router = Router();

/**
 * @swagger
 * /auth/employee/otp/send:
 *   post:
 *     tags: [Auth]
 *     summary: Send OTP to employee phone
 */
router.post('/employee/otp/send', validate(phoneSchema), asyncHandler(authController.sendEmployeeOtp));

/**
 * @swagger
 * /auth/employee/otp/verify:
 *   post:
 *     tags: [Auth]
 *     summary: Verify OTP and login/register employee
 */
router.post('/employee/otp/verify', validate(otpVerifySchema), asyncHandler(authController.verifyEmployeeOtp));
router.post('/employee/google', validate(employeeGoogleSchema), asyncHandler(authController.employeeGoogleLogin));

router.post('/enterprise/login', validate(enterpriseLoginSchema), asyncHandler(authController.enterpriseLogin));
router.post('/admin/login', validate(platformAdminLoginSchema), asyncHandler(authController.platformAdminLogin));
router.post('/enterprise/register', validate(enterpriseRegisterSchema), asyncHandler(authController.enterpriseRegister));
router.post('/refresh', validate(refreshTokenSchema), asyncHandler(authController.refresh));
router.post('/logout', validate(logoutSchema), asyncHandler(authController.logout));

export default router;
