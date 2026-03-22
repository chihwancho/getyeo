// src/routes/export.ts
import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { exportVacationPDF } from '../controllers/exportController';

const router = Router({ mergeParams: true });

router.use(authMiddleware);

// GET /api/vacations/:vacationId/export/pdf
router.get('/pdf', asyncHandler(exportVacationPDF));

export default router;