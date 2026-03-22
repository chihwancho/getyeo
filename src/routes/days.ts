// routes/days.ts
import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import {
  getDays,
  getDay,
  createDay,
  updateDay,
  deleteDay,
} from '../controllers/dayController';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router({ mergeParams: true });

// All day routes require authentication
router.use(authMiddleware);

// ============================================================================
// DAY ROUTES
// ============================================================================

// GET all days for a vacation
router.get('/', asyncHandler(getDays));

// POST create a day (rarely used, days are auto-generated)
router.post('/', asyncHandler(createDay));

// GET single day
router.get('/:dayId', asyncHandler(getDay));

// PUT update day
router.put('/:dayId', asyncHandler(updateDay));

// DELETE day (moves activities to unassigned pool)
router.delete('/:dayId', asyncHandler(deleteDay));

export default router;