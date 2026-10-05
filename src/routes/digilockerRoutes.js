import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import * as digilockerController from '../controllers/digilockerController.js';

const router = Router();

// Public — must match the Redirect URL registered on API Setu exactly:
// https://pagerlook.com/api/digilocker/callback
router.get('/callback', asyncHandler(digilockerController.callback));

router.use(authenticate, requireRole('employee'));

router.post('/connect', asyncHandler(digilockerController.connect));
router.get('/connection', asyncHandler(digilockerController.getConnection));
router.get('/documents', asyncHandler(digilockerController.getDocuments));
router.delete('/connection', asyncHandler(digilockerController.disconnect));

export default router;
