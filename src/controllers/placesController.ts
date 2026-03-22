// src/controllers/placesController.ts
import { Request, Response } from 'express';
import { AppError } from '../middleware/errorHandler';
import { getPlacesService } from '../services/googlePlacesService';

// ============================================================================
// NEARBY SEARCH
// ============================================================================

/**
 * POST /api/places/nearby
 *
 * Body:
 *   lat            number   required
 *   lng            number   required
 *   radiusMeters   number   optional (default 1000, max 50000)
 *   includedTypes  string[] optional  e.g. ["restaurant", "cafe"]
 *   maxResults     number   optional (default 20, max 20)
 */
export const searchNearby = async (req: Request, res: Response) => {
  const { lat, lng, radiusMeters, includedTypes, maxResults } = req.body;

  if (lat === undefined || lng === undefined) {
    throw new AppError(400, 'lat and lng are required');
  }

  if (typeof lat !== 'number' || typeof lng !== 'number') {
    throw new AppError(400, 'lat and lng must be numbers');
  }

  if (radiusMeters !== undefined && (typeof radiusMeters !== 'number' || radiusMeters <= 0 || radiusMeters > 50000)) {
    throw new AppError(400, 'radiusMeters must be a number between 1 and 50000');
  }

  const places = await getPlacesService().searchNearby({
    lat,
    lng,
    radiusMeters,
    includedTypes,
    maxResultCount: maxResults,
  });

  res.json({ places, count: places.length });
};

// ============================================================================
// TEXT SEARCH
// ============================================================================

/**
 * POST /api/places/search
 *
 * Body:
 *   query          string   required  e.g. "tacos near Roma Norte, Mexico City"
 *   lat            number   optional  location bias
 *   lng            number   optional  location bias
 *   radiusMeters   number   optional  bias radius (default 5000)
 *   includedType   string   optional  single type filter e.g. "restaurant"
 *   maxResults     number   optional  (default 20)
 */
export const searchText = async (req: Request, res: Response) => {
  const { query, lat, lng, radiusMeters, includedType, maxResults } = req.body;

  if (!query || typeof query !== 'string' || query.trim() === '') {
    throw new AppError(400, 'query is required and must be a non-empty string');
  }

  if ((lat !== undefined) !== (lng !== undefined)) {
    throw new AppError(400, 'lat and lng must both be provided together, or neither');
  }

  const places = await getPlacesService().searchText({
    query: query.trim(),
    lat,
    lng,
    radiusMeters,
    includedType,
    maxResultCount: maxResults,
  });

  res.json({ places, count: places.length });
};

// ============================================================================
// PLACE DETAILS
// ============================================================================

/**
 * GET /api/places/:placeId
 *
 * Returns full details for a single place.
 * Use after autocomplete to resolve the selected prediction.
 */
export const getPlaceDetails = async (req: Request, res: Response) => {
  const placeId = Array.isArray(req.params.placeId)
    ? req.params.placeId[0]
    : req.params.placeId;

  if (!placeId) {
    throw new AppError(400, 'placeId is required');
  }

  const place = await getPlacesService().getDetails(placeId);
  res.json(place);
};

// ============================================================================
// AUTOCOMPLETE
// ============================================================================

/**
 * POST /api/places/autocomplete
 *
 * Body:
 *   input                string   required  partial text input from user
 *   lat                  number   optional  location bias
 *   lng                  number   optional  location bias
 *   radiusMeters         number   optional  bias radius (default 50000)
 *   includedPrimaryTypes string[] optional  e.g. ["restaurant"]
 *   sessionToken         string   optional  UUID for billing session grouping
 *
 * IMPORTANT: Generate a fresh sessionToken (UUID v4) at the start of each
 * autocomplete session and pass it with every keystroke request. When the
 * user selects a prediction, pass the same token to GET /api/places/:placeId
 * so the autocomplete + detail calls are billed as one session.
 */
export const autocomplete = async (req: Request, res: Response) => {
  const { input, lat, lng, radiusMeters, includedPrimaryTypes, sessionToken } = req.body;

  if (!input || typeof input !== 'string' || input.trim() === '') {
    throw new AppError(400, 'input is required and must be a non-empty string');
  }

  if ((lat !== undefined) !== (lng !== undefined)) {
    throw new AppError(400, 'lat and lng must both be provided together, or neither');
  }

  const predictions = await getPlacesService().autocomplete({
    input: input.trim(),
    lat,
    lng,
    radiusMeters,
    includedPrimaryTypes,
    sessionToken,
  });

  res.json({ predictions, count: predictions.length });
};