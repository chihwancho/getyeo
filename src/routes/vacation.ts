// routes/vacations.ts
import express from 'express';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import {
  createVacation,
  getVacations,
  getVacation,
  updateVacation,
  deleteVacation,
  createVacationVariant,
  getVacationVersions,
} from '../controllers/vacationController';
import homestayRoutes from './homestays';
import dayRoutes from './days';
import activityRoutes from './activities';
import aiRoutes from './ai';
import exportRoutes from './export';

const router = express.Router();

// All routes require authentication
router.use(authMiddleware);

// Vacation CRUD
router.post('/', asyncHandler(createVacation));
router.get('/', asyncHandler(getVacations));

// Nested homestays under vacation - MUST come before /:id routes
router.use('/:vacationId/homestays', homestayRoutes);

// Nested days under vacation - MUST come before /:id routes
router.use('/:vacationId/days', dayRoutes);

// Nested activities under vacation - MUST come before /:id routes
router.use('/:vacationId/activities', activityRoutes);

// Nested AI under vacation
router.use('/:vacationId/ai', aiRoutes);

// Export endpoints
router.use('/:vacationId/export', exportRoutes);

// Variants - MUST come before /:id catch-all
router.post('/:id/variants', asyncHandler(createVacationVariant));

// Versions - MUST come before /:id catch-all
router.get('/:id/versions', asyncHandler(getVacationVersions));

// Generic :id routes (LAST so they don't catch nested routes)
router.get('/:id', asyncHandler(getVacation));
router.put('/:id', asyncHandler(updateVacation));
router.delete('/:id', asyncHandler(deleteVacation));

export default router;