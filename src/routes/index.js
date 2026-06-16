import { Router } from 'express';
import authRoutes from './authRoutes.js';
import employeeRoutes from './employeeRoutes.js';
import enterpriseRoutes from './enterpriseRoutes.js';
import adminRoutes from './adminRoutes.js';
import companyRoutes from './companyRoutes.js';

const router = Router();

router.use('/auth', authRoutes);
router.use('/employee', employeeRoutes);
router.use('/enterprise', enterpriseRoutes);
router.use('/company', companyRoutes);
router.use('/admin', adminRoutes);
export default router;
