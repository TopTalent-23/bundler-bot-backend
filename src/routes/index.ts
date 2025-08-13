import { Router } from 'express';
import authRoutes from './auth.route';
import userRoutes from './user.route';
import launchRoutes from './launch.route';

const router = Router();

// Mount routes with prefixes
router.use('/auth', authRoutes);   // /api/users
router.use('/users', userRoutes);   // /api/users
router.use('/launch', launchRoutes);      // /api/launch

export default router;