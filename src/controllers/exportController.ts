// src/controllers/exportController.ts
import { Response } from 'express';
import { AuthRequest, Coordinates } from '../types';
import { AppError } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';
import { generateItineraryPDF, VacationForPDF, DayForPDF, ActivityForPDF } from '../services/pdfService';
import { GooglePlacesService } from '../services/googlePlacesService';

// ============================================================================
// HELPERS
// ============================================================================

const toCoordinates = (value: unknown): Coordinates | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  if (typeof v.lat !== 'number' || typeof v.lng !== 'number') return undefined;
  return { lat: v.lat, lng: v.lng };
};

/**
 * Fetch coordinates for activities that have no stored coordinates.
 * Strategy:
 *   1. Try getDetails by googlePlacesId (fast, one call)
 *   2. Fall back to text search by name + location (handles stale/invalid place IDs)
 * Fails silently per activity so export is never blocked.
 */
const resolveCoordinates = async (
  activities: Array<{ id: string; name: string; location: string; googlePlacesId: string | null; coordinates: unknown }>
): Promise<Map<string, Coordinates>> => {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  const coordMap = new Map<string, Coordinates>();

  if (!apiKey) return coordMap;

  const service = new GooglePlacesService(apiKey);
  const needsLookup = activities.filter((a) => !toCoordinates(a.coordinates));

  await Promise.all(
    needsLookup.map(async (a) => {
      // Strategy 1: place details by ID
      if (a.googlePlacesId) {
        try {
          const place = await service.getDetails(a.googlePlacesId);
          if (place.coordinates) {
            coordMap.set(a.id, place.coordinates);
            return;
          }
        } catch {
          // fall through to text search
        }
      }

      // Strategy 2: text search by name + location
      try {
        const query = `${a.name} ${a.location}`;
        const results = await service.searchText({ query, maxResultCount: 1 });
        if (results.length > 0 && results[0].coordinates) {
          coordMap.set(a.id, results[0].coordinates);
        }
      } catch {
        // fail silently
      }
    })
  );

  return coordMap;
};

// ============================================================================
// EXPORT VACATION AS PDF
// ============================================================================

/**
 * GET /api/vacations/:vacationId/export/pdf
 *
 * Generates and streams a PDF itinerary for the vacation.
 * Fetches missing coordinates from Places API at export time.
 */
export const exportVacationPDF = async (req: AuthRequest, res: Response) => {
  const vacationId = Array.isArray(req.params.vacationId)
    ? req.params.vacationId[0]
    : req.params.vacationId;

  if (!req.user) throw new AppError(401, 'Unauthorized');

  // Load full vacation with days, activities, homestays
  const vacation = await prisma.vacation.findUnique({
    where: { id: vacationId },
    include: {
      days: {
        orderBy: { date: 'asc' },
        include: {
          homestay: true,
          activities: {
            where: { deletedAt: null },
            orderBy: [{ time: 'asc' }, { position: 'asc' }, { createdAt: 'asc' }],
          },
        },
      },
    },
  });

  if (!vacation) throw new AppError(404, 'Vacation not found');
  if (vacation.userId !== req.user.id) throw new AppError(403, 'You do not have access to this vacation');

  // Collect all activities that need coordinate lookup
  const allActivities = vacation.days.flatMap((d) => d.activities);
  const coordMap = await resolveCoordinates(allActivities);

  // Build PDF data structure
  const days: DayForPDF[] = vacation.days.map((d) => ({
    date: d.date.toISOString().split('T')[0],
    homestayName: d.homestay?.name,
    theme: (d as any).theme ?? undefined,
    warnings: (d as any).aiWarnings ?? [],
    activities: d.activities.map((a): ActivityForPDF => ({
      name: a.name,
      type: a.type,
      location: a.location,
      time: a.time,
      duration: a.duration,
      priority: a.priority,
      source: a.source,
      notes: a.notes,
      reasoning: (a as any).reasoning ?? null,
      coordinates:
        toCoordinates(a.coordinates) ??
        coordMap.get(a.id),
    })),
  }));

  const vacationForPDF: VacationForPDF = {
    name: vacation.name,
    startDate: vacation.startDate.toISOString().split('T')[0],
    endDate: vacation.endDate.toISOString().split('T')[0],
    days,
  };

  console.log('[export] Days:', days.length, 'Activities per day:', days.map(d => d.activities.length));

  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await generateItineraryPDF(vacationForPDF);
  } catch (err) {
    console.error('[exportVacationPDF] PDF generation failed:', err);
    throw new AppError(500, 'Failed to generate PDF');
  }

  const filename = `${vacation.name.replace(/[^a-z0-9]/gi, '_')}_itinerary.pdf`;

  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Content-Length': pdfBuffer.length,
  });

  res.send(pdfBuffer);
};