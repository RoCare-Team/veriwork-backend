import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as publicController from '../controllers/publicController.js';

const router = Router();

router.get('/employee-invitation/:token', asyncHandler(publicController.getEmployeeInvitation));

export default router;
