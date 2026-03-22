import express from 'express';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import {
  createHomestay,
  getHomestays,
  getHomestay,
  updateHomestay,
  deleteHomestay,
} from '../controllers/homestayController';

const router = express.Router({ mergeParams: true });

// All routes require authentication
router.use(authMiddleware);

// Homestay CRUD
router.post('/', asyncHandler(createHomestay));
router.get('/', asyncHandler(getHomestays));
router.get('/:homestayId', asyncHandler(getHomestay));
router.put('/:homestayId', asyncHandler(updateHomestay));
router.delete('/:homestayId', asyncHandler(deleteHomestay));

export default router;