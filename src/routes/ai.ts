// src/routes/ai.ts
import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { optimizeDay, applyOptimizedDay, suggestDay, applySuggestedDay, suggestVacation, applyVacationSuggestion } from '../controllers/aiController';

const router = Router({ mergeParams: true });

router.use(authMiddleware);

// Optimize (reorder existing activities for a day)
router.post('/optimize/:dayId', asyncHandler(optimizeDay));
router.post('/optimize/:dayId/apply', asyncHandler(applyOptimizedDay));

// Suggest full vacation — MUST come before /suggest/:dayId to avoid 'apply' matching as dayId
router.post('/suggest', asyncHandler(suggestVacation));
router.post('/suggest/apply', asyncHandler(applyVacationSuggestion));

// Suggest a single day
router.post('/suggest/:dayId', asyncHandler(suggestDay));
router.post('/suggest/:dayId/apply', asyncHandler(applySuggestedDay));

export default router;