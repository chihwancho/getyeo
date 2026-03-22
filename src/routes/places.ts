// src/routes/places.ts
import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import {
  searchNearby,
  searchText,
  getPlaceDetails,
  autocomplete,
} from '../controllers/placesController';

const router = Router();

// All Places routes require authentication — we don't want unauthenticated
// clients burning our Google Places quota.
router.use(authMiddleware);

// POST /api/places/nearby
router.post('/nearby', asyncHandler(searchNearby));

// POST /api/places/search
router.post('/search', asyncHandler(searchText));

// POST /api/places/autocomplete
router.post('/autocomplete', asyncHandler(autocomplete));

// GET /api/places/:placeId  — MUST come after named routes
router.get('/:placeId', asyncHandler(getPlaceDetails));

export default router;