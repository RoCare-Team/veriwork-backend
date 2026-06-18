import { Router } from 'express';
import authRoutes from './authRoutes.js';
import employeeRoutes from './employeeRoutes.js';
import enterpriseRoutes from './enterpriseRoutes.js';
import adminRoutes from './adminRoutes.js';
import companyRoutes from './companyRoutes.js';
import publicRoutes from './publicRoutes.js';

const router = Router();

router.use('/auth', authRoutes);
router.use('/employee', employeeRoutes);
router.use('/enterprise', enterpriseRoutes);
router.use('/company', companyRoutes);
router.use('/public', publicRoutes);
router.use('/admin', adminRoutes);
export default router;
