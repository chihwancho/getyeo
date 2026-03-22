// routes/activities.ts
import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import {
  getActivities,
  getActivity,
  createActivity,
  updateActivity,
  deleteActivity,
  moveActivity,
} from '../controllers/activityController';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router({ mergeParams: true });

// All activity routes require authentication
router.use(authMiddleware);

// GET all activities (with optional dayId filter)
// GET /api/vacations/:vacationId/activities
// GET /api/vacations/:vacationId/activities?dayId=null (unassigned pool)
// GET /api/vacations/:vacationId/activities?dayId={dayId} (specific day)
router.get('/', asyncHandler(getActivities));

// POST create activity
// POST /api/vacations/:vacationId/activities
router.post('/', asyncHandler(createActivity));

// GET single activity
// GET /api/vacations/:vacationId/activities/:activityId
router.get('/:activityId', asyncHandler(getActivity));

// PUT update activity
// PUT /api/vacations/:vacationId/activities/:activityId
router.put('/:activityId', asyncHandler(updateActivity));

// POST move activity to different day
// POST /api/vacations/:vacationId/activities/:activityId/move
router.post('/:activityId/move', asyncHandler(moveActivity));

// DELETE activity (hard delete by default, soft delete with ?softDelete=true)
// DELETE /api/vacations/:vacationId/activities/:activityId
// DELETE /api/vacations/:vacationId/activities/:activityId?softDelete=true
router.delete('/:activityId', asyncHandler(deleteActivity));

export default router;
