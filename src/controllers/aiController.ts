// src/controllers/aiController.ts
import { Response } from 'express';
import { AuthRequest } from '../types';
import { AppError } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';
import { optimizeSchedule, suggestDay as suggestDayService, suggestVacation as suggestVacationService, DaySuggestion, DayPreferences, DayContext } from '../services/aiService';
import { Activity } from '../types';
import { getPlacesService, GooglePlacesService } from '../services/googlePlacesService';
import { computeTravelTimes, ActivityWithCoords } from '../services/routesService';

// Helper — reuse the same formatter as activityController to keep responses consistent
import { Prisma } from '@prisma/client';
import { Coordinates, ActivityResponse } from '../types';

const toCoordinates = (value: Prisma.JsonValue | null | undefined): Coordinates | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as unknown as Coordinates;
};

const formatActivity = (a: Activity): ActivityResponse => ({
  id: a.id,
  dayId: a.dayId,
  vacationId: a.vacationId,
  type: a.type,
  name: a.name,
  location: a.location,
  coordinates: toCoordinates(a.coordinates),
  googlePlacesId: a.googlePlacesId,
  time: a.time,
  duration: a.duration,
  position: a.position,
  timeConstraint: a.timeConstraint,
  priority: a.priority,
  source: a.source,
  notes: a.notes,
  estimatedCost: a.estimatedCost,
  deletedAt: a.deletedAt ? a.deletedAt.toISOString() : null,
  createdAt: a.createdAt.toISOString(),
  updatedAt: a.updatedAt.toISOString(),
});


/**
 * After activities are saved, compute travel times between consecutive ordered
 * activities and persist them. Fails silently — never blocks the apply response.
 */
const populateTravelTimes = async (
  dayId: string,
  vacationId: string
): Promise<void> => {
  try {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) return;

    // Fetch ordered activities for the day
    const activities = await prisma.activity.findMany({
      where: { dayId, deletedAt: null },
      orderBy: [{ time: 'asc' }, { position: 'asc' }, { createdAt: 'asc' }],
    });

    if (activities.length < 2) return;

    const withCoords: ActivityWithCoords[] = activities.map((a) => ({
      id: a.id,
      coordinates: toCoordinates(a.coordinates) ?? null,
    }));

    const travelMap = await computeTravelTimes(withCoords, apiKey);
    if (travelMap.size === 0) return;

    // Persist travel times
    await Promise.all(
      Array.from(travelMap.entries()).map(([activityId, travelTime]) =>
        prisma.activity.update({
          where: { id: activityId },
          data: { travelTimeTo: travelTime as any },
        })
      )
    );
    console.log(`[populateTravelTimes] persisted ${travelMap.size} travel times for day ${dayId}`);
  } catch (err) {
    console.error('[populateTravelTimes] failed:', err);
  }
};

/**
 * Best-effort coordinate lookup for AI_SUGGESTED activities.
 * Claude's googlePlacesId values are often hallucinated and 404 on getDetails.
 * We use text search by name + location instead, which is reliable.
 * Also stores the real googlePlacesId from the search result on the activity.
 */
const fetchPlaceCoordinates = async (
  name: string,
  location: string
): Promise<{ coordinates: { lat: number; lng: number } | null; realPlaceId: string | null }> => {
  try {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) return { coordinates: null, realPlaceId: null };
    const service = new GooglePlacesService(apiKey);
    const results = await service.searchText({ query: `${name} ${location}`, maxResultCount: 1 });
    if (results.length > 0 && results[0].coordinates) {
      return {
        coordinates: results[0].coordinates,
        realPlaceId: results[0].googlePlacesId,
      };
    }
    return { coordinates: null, realPlaceId: null };
  } catch {
    return { coordinates: null, realPlaceId: null };
  }
};

// ============================================================================
// OPTIMIZE SCHEDULE — PREVIEW
// ============================================================================

/**
 * POST /api/vacations/:vacationId/ai/optimize/:dayId
 *
 * Returns an AI-optimized schedule preview. Does NOT write to the DB.
 * The client shows the preview to the user; if they confirm, call the
 * apply endpoint below.
 *
 * Body (all optional):
 *   minBreakMinutes  number   min buffer between activities (default 15)
 *   groupByLocation  boolean  cluster nearby activities (default true)
 */
export const optimizeDay = async (req: AuthRequest, res: Response) => {
  const vacationId = Array.isArray(req.params.vacationId)
    ? req.params.vacationId[0]
    : req.params.vacationId;

  const dayId = Array.isArray(req.params.dayId)
    ? req.params.dayId[0]
    : req.params.dayId;

  if (!req.user) throw new AppError(401, 'Unauthorized');

  const { minBreakMinutes, groupByLocation } = req.body;

  // Verify vacation ownership
  const vacation = await prisma.vacation.findUnique({ where: { id: vacationId } });
  if (!vacation) throw new AppError(404, 'Vacation not found');
  if (vacation.userId !== req.user.id) throw new AppError(403, 'You do not have access to this vacation');

  // Load the day
  const day = await prisma.day.findUnique({ where: { id: dayId } });
  if (!day) throw new AppError(404, 'Day not found');
  if (day.vacationId !== vacationId) throw new AppError(404, 'Day not found in this vacation');

  // Load activities for the day (exclude hard-deleted)
  const activities = await prisma.activity.findMany({
    where: { dayId, deletedAt: null },
    orderBy: [{ time: 'asc' }, { position: 'asc' }, { createdAt: 'asc' }],
  });

  if (activities.length === 0) {
    return res.json({
      status: 'success',
      dayId,
      date: day.date.toISOString().split('T')[0],
      scheduledActivities: [],
      currentActivities: [],
      warnings: ['No activities on this day to optimize.'],
      summary: 'No activities to schedule.',
    });
  }

  const date = day.date.toISOString().split('T')[0];
  const formattedActivities = activities.map(formatActivity);

  // Optionally load unassigned pool activities for the same vacation
  const includePool = req.body.includePool !== false; // default true
  let poolActivities: ReturnType<typeof formatActivity>[] = [];

  if (includePool) {
    const pool = await prisma.activity.findMany({
      where: { vacationId, dayId: null, deletedAt: null },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    }) as unknown as Activity[];
    poolActivities = pool.map(formatActivity);
  }

  const result = await optimizeSchedule(formattedActivities, {
    date,
    minBreakMinutes,
    groupByLocation,
    poolActivities,
  });

  // Build a map of all activities (assigned + pool) for merging
  const allActivities = [...formattedActivities, ...poolActivities];
  const activityMap = new Map(allActivities.map((a) => [a.id, a]));

  type PreviewItem = ActivityResponse & {
    suggestedTime: string | null;
    suggestedPosition: number;
    reasoning: string;
    addedFromPool: boolean;
  };

  const preview = result.scheduledActivities
    .map((s): PreviewItem | null => {
      const activity = activityMap.get(s.id);
      if (!activity) return null;
      return {
        ...activity,
        suggestedTime: s.suggestedTime,
        suggestedPosition: s.suggestedPosition,
        reasoning: s.reasoning,
        addedFromPool: s.addedFromPool,
      };
    })
    .filter((a): a is PreviewItem => a !== null);

  res.json({
    status: result.status,
    dayId,
    date,
    preview,
    addedFromPool: preview.filter((a) => a.addedFromPool).length,
    currentActivities: formattedActivities,
    poolActivitiesConsidered: poolActivities.length,
    warnings: result.warnings,
    summary: result.summary,
  });
};

// ============================================================================
// APPLY OPTIMIZED SCHEDULE
// ============================================================================

/**
 * POST /api/vacations/:vacationId/ai/optimize/:dayId/apply
 *
 * Applies a previously-previewed optimization by updating time and position
 * on each activity. Creates a vacation version snapshot beforehand so the
 * user can revert.
 *
 * Body:
 *   scheduledActivities  Array<{ id, suggestedTime, suggestedPosition }>  required
 */
export const applyOptimizedDay = async (req: AuthRequest, res: Response) => {
  const vacationId = Array.isArray(req.params.vacationId)
    ? req.params.vacationId[0]
    : req.params.vacationId;

  const dayId = Array.isArray(req.params.dayId)
    ? req.params.dayId[0]
    : req.params.dayId;

  if (!req.user) throw new AppError(401, 'Unauthorized');

  const { scheduledActivities } = req.body as {
    scheduledActivities: Array<{
      id: string;
      suggestedTime: string | null;
      suggestedPosition: number;
      addedFromPool?: boolean;
    }>;
  };

  if (!Array.isArray(scheduledActivities) || scheduledActivities.length === 0) {
    throw new AppError(400, 'scheduledActivities array is required');
  }

  // Verify vacation ownership
  const vacation = await prisma.vacation.findUnique({
    where: { id: vacationId },
    include: {
      days: { include: { activities: true } },
      homestays: true,
    },
  });
  if (!vacation) throw new AppError(404, 'Vacation not found');
  if (vacation.userId !== req.user.id) throw new AppError(403, 'You do not have access to this vacation');

  const day = await prisma.day.findUnique({ where: { id: dayId } });
  if (!day || day.vacationId !== vacationId) throw new AppError(404, 'Day not found in this vacation');

  // Snapshot current state as a new version before applying changes
  const latestVersion = await prisma.vacationVersion.findFirst({
    where: { vacationId },
    orderBy: { versionNumber: 'desc' },
  });
  const nextVersionNumber = (latestVersion?.versionNumber ?? 0) + 1;

  await prisma.vacationVersion.create({
    data: {
      vacationId,
      versionNumber: nextVersionNumber,
      reason: 'AI schedule optimization applied',
      snapshot: JSON.parse(JSON.stringify(vacation)), // deep clone for JSON storage
    },
  });

  // Apply time + position updates for each activity
  await Promise.all(
    scheduledActivities.map((s) =>
      prisma.activity.update({
        where: { id: s.id },
        data: {
          time: s.suggestedTime ?? undefined,
          position: s.suggestedPosition,
        },
      })
    )
  );

  // Return the updated activities
  const updatedActivities = await prisma.activity.findMany({
    where: { dayId, deletedAt: null },
    orderBy: [{ time: 'asc' }, { position: 'asc' }, { createdAt: 'asc' }],
  });

  // Populate travel times before responding (must await on serverless)
  await populateTravelTimes(dayId, vacationId);

  res.json({
    success: true,
    versionCreated: nextVersionNumber,
    activities: updatedActivities.map(formatActivity),
  });
};

// ============================================================================
// SUGGEST DAY — PREVIEW
// ============================================================================

/**
 * POST /api/vacations/:vacationId/ai/suggest/:dayId
 *
 * Builds a full day plan from scratch using:
 *   1. Already-assigned activities (locked)
 *   2. User's unassigned pool (high priority)
 *   3. Google Places results near the homestay (fill gaps)
 *
 * Returns a preview — nothing written to DB until apply is called.
 *
 * Body (all optional):
 *   minBreakMinutes      number   default 15
 *   groupByLocation      boolean  default true
 *   placeTypes           string[] types to search via Places (default: restaurant, tourist_attraction)
 *   searchRadiusMeters   number   Places search radius (default 2000)
 */
export const suggestDay = async (req: AuthRequest, res: Response) => {
  const vacationId = Array.isArray(req.params.vacationId)
    ? req.params.vacationId[0]
    : req.params.vacationId;
  const dayId = Array.isArray(req.params.dayId)
    ? req.params.dayId[0]
    : req.params.dayId;

  if (!req.user) throw new AppError(401, 'Unauthorized');

  const {
    minBreakMinutes,
    groupByLocation,
    placeTypes = ['restaurant', 'tourist_attraction', 'museum', 'park'],
    searchRadiusMeters = 2000,
    preferences = {} as DayPreferences,
  } = req.body;

  // Verify ownership
  const vacation = await prisma.vacation.findUnique({ where: { id: vacationId } });
  if (!vacation) throw new AppError(404, 'Vacation not found');
  if (vacation.userId !== req.user.id) throw new AppError(403, 'You do not have access to this vacation');

  // Load day with its homestay
  const day = await prisma.day.findUnique({
    where: { id: dayId },
    include: { homestay: true },
  });
  if (!day) throw new AppError(404, 'Day not found');
  if (day.vacationId !== vacationId) throw new AppError(404, 'Day not found in this vacation');

  const date = day.date.toISOString().split('T')[0];
  const homestay = day.homestay;
  const homestayCoords = homestay?.coordinates as { lat: number; lng: number } | null ?? null;

  // Load assigned activities (locked)
  const assigned = await prisma.activity.findMany({
    where: { dayId, deletedAt: null },
    orderBy: [{ time: 'asc' }, { position: 'asc' }, { createdAt: 'asc' }],
  }) as unknown as Activity[];

  // Load unassigned pool (user's wishlist)
  const pool = await prisma.activity.findMany({
    where: { vacationId, dayId: null, deletedAt: null },
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
  }) as unknown as Activity[];

  // Search Google Places near the homestay (or skip if no coordinates)
  let nearbyPlaces: Array<{
    googlePlacesId: string;
    name: string;
    type: string;
    location: string;
    rating?: number;
    openNow?: boolean;
  }> = [];

  if (homestayCoords) {
    try {
      const placesService = getPlacesService();

      // Search for each type category in parallel
      const searchResults = await Promise.all(
        placeTypes.map((type: string) =>
          placesService.searchNearby({
            lat: homestayCoords.lat,
            lng: homestayCoords.lng,
            radiusMeters: searchRadiusMeters,
            includedTypes: [type],
            maxResultCount: 5, // keep prompt manageable
          }).catch(() => []) // don't fail the whole request if one type errors
        )
      );

      // Flatten, deduplicate by googlePlacesId, exclude places already in pool or assigned
      const existingPlaceIds = new Set([
        ...assigned.map((a) => a.googlePlacesId).filter(Boolean),
        ...pool.map((a) => a.googlePlacesId).filter(Boolean),
      ]);

      const seen = new Set<string>();
      nearbyPlaces = searchResults
        .flat()
        .filter((p) => {
          if (seen.has(p.googlePlacesId) || existingPlaceIds.has(p.googlePlacesId)) return false;
          seen.add(p.googlePlacesId);
          return true;
        })
        .map((p) => ({
          googlePlacesId: p.googlePlacesId,
          name: p.name,
          type: p.type ?? 'ACTIVITY',
          location: p.address,
          rating: p.rating,
          openNow: p.openNow,
        }));
    } catch {
      // Google Places unavailable — continue without it
    }
  }

  const result = await suggestDayService({
    date,
    homestayName: homestay?.name,
    assignedActivities: assigned.map(formatActivity),
    poolActivities: pool.map(formatActivity),
    nearbyPlaces,
    minBreakMinutes,
    groupByLocation,
    preferences,
  });

  // Build lookup maps for merging
  const assignedMap = new Map(assigned.map((a) => [a.id, formatActivity(a)]));
  const poolMap = new Map(pool.map((a) => [a.id, formatActivity(a)]));

  // Enrich preview with full activity data where available.
  // Defined as a plain interface (not an intersection) to avoid the `source`
  // field conflict between DaySuggestion (SuggestionSource) and ActivityResponse
  // ('USER_ENTERED' | 'AI_SUGGESTED') which collapses intersections to never.
  interface SuggestPreviewItem {
    source: 'ASSIGNED' | 'USER_POOL' | 'GOOGLE_PLACES';
    activityId?: string;
    googlePlacesId?: string | null;
    name: string;
    type: string;
    location: string;
    suggestedTime: string | null;
    suggestedPosition: number;
    duration: number | null;
    timeConstraint: string;
    priority: string;
    reasoning: string;
    // Optional enrichment fields from existing Activity records
    id?: string;
    dayId?: string | null;
    vacationId?: string;
    time?: string | null;
    position?: number | null;
    notes?: string | null;
    coordinates?: { lat: number; lng: number };
    estimatedCost?: number | null;
    createdAt?: string;
    updatedAt?: string;
  }

  const preview: SuggestPreviewItem[] = result.suggestions.map((s): SuggestPreviewItem => {
    if (s.source === 'ASSIGNED' && s.activityId) {
      const existing = assignedMap.get(s.activityId);
      return { ...existing, ...s };
    }
    if (s.source === 'USER_POOL' && s.activityId) {
      const existing = poolMap.get(s.activityId);
      return { ...existing, ...s };
    }
    // GOOGLE_PLACES — no existing record yet
    return s;
  });

  res.json({
    status: result.status,
    dayId,
    date,
    homestay: homestay ? { id: homestay.id, name: homestay.name } : null,
    preview,
    stats: {
      assigned: preview.filter((s) => s.source === 'ASSIGNED').length,
      fromPool: preview.filter((s) => s.source === 'USER_POOL').length,
      fromPlaces: preview.filter((s) => s.source === 'GOOGLE_PLACES').length,
      placesSearched: nearbyPlaces.length,
    },
    warnings: result.warnings,
    summary: result.summary,
  });
};

// ============================================================================
// APPLY SUGGESTED DAY
// ============================================================================

/**
 * POST /api/vacations/:vacationId/ai/suggest/:dayId/apply
 *
 * Applies a suggested day plan:
 *   - ASSIGNED: update time + position
 *   - USER_POOL: update dayId + time + position
 *   - GOOGLE_PLACES: create new Activity record, then assign to day
 *
 * Creates a version snapshot before applying.
 *
 * Body:
 *   suggestions  Array<DaySuggestion>  required (from the preview response)
 */
export const applySuggestedDay = async (req: AuthRequest, res: Response) => {
  const vacationId = Array.isArray(req.params.vacationId)
    ? req.params.vacationId[0]
    : req.params.vacationId;
  const dayId = Array.isArray(req.params.dayId)
    ? req.params.dayId[0]
    : req.params.dayId;

  if (!req.user) throw new AppError(401, 'Unauthorized');

  const { suggestions, warnings = [] } = req.body as {
    suggestions: Array<{
      source: 'ASSIGNED' | 'USER_POOL' | 'GOOGLE_PLACES';
      activityId?: string;
      googlePlacesId?: string;
      name: string;
      type: string;
      location: string;
      suggestedTime: string | null;
      suggestedPosition: number;
      duration: number | null;
      timeConstraint: string;
      priority: string;
      reasoning?: string;
    }>;
    warnings?: string[];
  };

  if (!Array.isArray(suggestions) || suggestions.length === 0) {
    throw new AppError(400, 'suggestions array is required');
  }

  // Verify ownership
  const vacation = await prisma.vacation.findUnique({
    where: { id: vacationId },
    include: { days: { include: { activities: true } }, homestays: true },
  });
  if (!vacation) throw new AppError(404, 'Vacation not found');
  if (vacation.userId !== req.user.id) throw new AppError(403, 'You do not have access to this vacation');

  const day = await prisma.day.findUnique({ where: { id: dayId } });
  if (!day || day.vacationId !== vacationId) throw new AppError(404, 'Day not found in this vacation');

  // Snapshot before applying
  const latestVersion = await prisma.vacationVersion.findFirst({
    where: { vacationId },
    orderBy: { versionNumber: 'desc' },
  });
  const nextVersionNumber = (latestVersion?.versionNumber ?? 0) + 1;

  await prisma.vacationVersion.create({
    data: {
      vacationId,
      versionNumber: nextVersionNumber,
      reason: 'AI day suggestion applied',
      snapshot: JSON.parse(JSON.stringify(vacation)),
    },
  });

  // Delete existing AI_SUGGESTED activities on this day before applying new ones
  // This prevents duplicates when apply is called multiple times
  await prisma.activity.deleteMany({
    where: { dayId, source: 'AI_SUGGESTED', deletedAt: null },
  });

  // Apply each suggestion by source type
  await Promise.all(
    suggestions.map(async (s, index) => {
      const position = s.suggestedPosition ?? index + 1;
      const time = s.suggestedTime ?? undefined;

      if (s.source === 'ASSIGNED' && s.activityId) {
        return prisma.activity.update({
          where: { id: s.activityId },
          data: { time, position, reasoning: s.reasoning ?? undefined },
        });
      }

      if (s.source === 'USER_POOL' && s.activityId) {
        return prisma.activity.update({
          where: { id: s.activityId },
          data: { dayId, time, position, reasoning: s.reasoning ?? undefined },
        });
      }

      if (s.source === 'GOOGLE_PLACES') {
        const { coordinates, realPlaceId } = await fetchPlaceCoordinates(s.name, s.location);
        return prisma.activity.create({
          data: {
            vacationId,
            dayId,
            type: s.type as 'RESTAURANT' | 'SIGHTSEEING' | 'ACTIVITY' | 'TRAVEL',
            name: s.name,
            location: s.location,
            googlePlacesId: realPlaceId ?? s.googlePlacesId,
            time,
            duration: s.duration,
            position,
            timeConstraint: s.timeConstraint as 'SPECIFIC_TIME' | 'MORNING' | 'AFTERNOON' | 'EVENING' | 'ANYTIME',
            priority: s.priority as 'MUST_HAVE' | 'NICE_TO_HAVE' | 'FLEXIBLE',
            source: 'AI_SUGGESTED',
            reasoning: s.reasoning ?? undefined,
            ...(coordinates && { coordinates }),
          },
        });
      }
    })
  );

  // Save day warnings and theme
  const { warnings: bodyWarnings = [], theme: bodyTheme } = req.body;
  if (bodyWarnings.length || bodyTheme) {
    await prisma.day.update({
      where: { id: dayId },
      data: {
        ...(bodyWarnings.length && { aiWarnings: bodyWarnings }),
        ...(bodyTheme && { theme: bodyTheme }),
      },
    });
  }

  // Return the final state of the day
  const updatedActivities = await prisma.activity.findMany({
    where: { dayId, deletedAt: null },
    orderBy: [{ time: 'asc' }, { position: 'asc' }, { createdAt: 'asc' }],
  }) as unknown as Activity[];

  // Populate travel times before responding (must await on serverless)
  await populateTravelTimes(dayId, vacationId);

  res.json({
    success: true,
    versionCreated: nextVersionNumber,
    activities: updatedActivities.map(formatActivity),
  });
};

// ============================================================================
// SUGGEST FULL VACATION — PREVIEW
// ============================================================================

/**
 * POST /api/vacations/:vacationId/ai/suggest
 *
 * Plans the entire vacation in one Claude call. Returns a preview per day.
 *
 * Body (all optional):
 *   globalPreferences    DayPreferences   applies to all days
 *   dayOverrides         Array<{ dayId, preferences }>  per-day overrides
 *   includePlaces        boolean          search Google Places per homestay (default false)
 *   placeTypes           string[]         types to search (default: restaurant, tourist_attraction, museum, park)
 *   searchRadiusMeters   number           Places search radius (default 2000)
 */
export const suggestVacation = async (req: AuthRequest, res: Response) => {
  const vacationId = Array.isArray(req.params.vacationId)
    ? req.params.vacationId[0]
    : req.params.vacationId;

  if (!req.user) throw new AppError(401, 'Unauthorized');

  const {
    globalPreferences = {} as DayPreferences,
    dayOverrides = [] as Array<{ dayId: string; preferences: DayPreferences }>,
    includePlaces = false,
    placeTypes = ['restaurant', 'tourist_attraction', 'museum', 'park'],
    searchRadiusMeters = 2000,
  } = req.body;

  // Verify ownership and load full vacation
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

  if (vacation.days.length === 0) {
    throw new AppError(400, 'Vacation has no days to plan');
  }

  // Load unassigned pool
  const pool = await prisma.activity.findMany({
    where: { vacationId, dayId: null, deletedAt: null },
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
  }) as unknown as Activity[];

  // Build per-day override map
  const overrideMap = new Map<string, DayPreferences>(dayOverrides.map((o: { dayId: string; preferences: DayPreferences }) => [o.dayId, o.preferences]));

  // Pre-fetch Places per unique homestay if toggled on
  const homestayPlacesCache = new Map<string, Array<{ googlePlacesId: string; name: string; type?: string; address: string; rating?: number; openNow?: boolean }>>();

  if (includePlaces) {
    const uniqueHomestays = new Map<string, { lat: number; lng: number }>();

    vacation.days.forEach((d) => {
      if (d.homestay?.id && d.homestay.coordinates) {
        const coords = d.homestay.coordinates as { lat: number; lng: number };
        if (coords.lat && coords.lng) {
          uniqueHomestays.set(d.homestay.id, coords);
        }
      }
    });

    await Promise.all(
      [...uniqueHomestays.entries()].map(async ([homestayId, coords]) => {
        try {
          const results = await Promise.all(
            placeTypes.map((type: string) =>
              getPlacesService().searchNearby({
                lat: coords.lat,
                lng: coords.lng,
                radiusMeters: searchRadiusMeters,
                includedTypes: [type],
                maxResultCount: 4,
              }).catch(() => [])
            )
          );
          homestayPlacesCache.set(homestayId, results.flat());
        } catch {
          // fail silently per homestay
        }
      })
    );
  }

  // Build DayContext for each day
  const dayContexts: DayContext[] = vacation.days.map((d) => {
    const assigned = (d.activities as unknown as Activity[]).map(formatActivity);
    const existingPlaceIds = new Set(assigned.map((a) => a.googlePlacesId).filter(Boolean));

    let nearbyPlaces: DayContext['nearbyPlaces'] = [];
    if (includePlaces && d.homestay?.id) {
      type CachedPlace = { googlePlacesId: string; name: string; type?: string; address: string; rating?: number; openNow?: boolean };
      const cached = (homestayPlacesCache.get(d.homestay.id) ?? []) as CachedPlace[];
      const seen = new Set<string>();
      nearbyPlaces = cached
        .filter((p) => {
          if (seen.has(p.googlePlacesId) || existingPlaceIds.has(p.googlePlacesId)) return false;
          seen.add(p.googlePlacesId);
          return true;
        })
        .map((p) => ({
          googlePlacesId: p.googlePlacesId,
          name: p.name,
          type: p.type ?? 'ACTIVITY',
          location: p.address,
          rating: p.rating,
          openNow: p.openNow,
        }));
    }

    return {
      dayId: d.id,
      date: d.date.toISOString().split('T')[0],
      homestayName: d.homestay?.name,
      assignedActivities: assigned,
      nearbyPlaces,
      preferences: overrideMap.get(d.id),
    };
  });

  const result = await suggestVacationService({
    vacationName: vacation.name,
    days: dayContexts,
    poolActivities: pool.map(formatActivity),
    globalPreferences,
  });

  // Build enriched preview per day
  const assignedMap = new Map(
    vacation.days.flatMap((d) =>
      (d.activities as unknown as Activity[]).map((a) => [a.id, formatActivity(a)])
    )
  );
  const poolMap = new Map(pool.map((a) => [a.id, formatActivity(a)]));

  interface VacationPreviewItem {
    source: 'ASSIGNED' | 'USER_POOL' | 'GOOGLE_PLACES';
    activityId?: string;
    googlePlacesId?: string | null;
    name: string;
    type: string;
    location: string;
    suggestedTime: string | null;
    suggestedPosition: number;
    duration: number | null;
    timeConstraint: string;
    priority: string;
    reasoning: string;
    id?: string;
    dayId?: string | null;
    vacationId?: string;
    time?: string | null;
    position?: number | null;
    notes?: string | null;
    estimatedCost?: number | null;
    createdAt?: string;
    updatedAt?: string;
  }

  const previewDays = result.days.map((d) => ({
    dayId: d.dayId,
    date: d.date,
    warnings: d.warnings,
    suggestions: d.suggestions.map((s): VacationPreviewItem => {
      if (s.source === 'ASSIGNED' && s.activityId) {
        return { ...assignedMap.get(s.activityId), ...s };
      }
      if (s.source === 'USER_POOL' && s.activityId) {
        return { ...poolMap.get(s.activityId), ...s };
      }
      return s;
    }),
    stats: {
      assigned: d.suggestions.filter((s) => s.source === 'ASSIGNED').length,
      fromPool: d.suggestions.filter((s) => s.source === 'USER_POOL').length,
      fromPlaces: d.suggestions.filter((s) => s.source === 'GOOGLE_PLACES').length,
    },
  }));

  res.json({
    status: result.status,
    vacationId,
    totalDays: previewDays.length,
    preview: previewDays,
    poolActivitiesConsidered: pool.length,
    warnings: result.warnings,
    summary: result.summary,
  });
};

// ============================================================================
// APPLY SUGGESTED FULL VACATION
// ============================================================================

/**
 * POST /api/vacations/:vacationId/ai/suggest/apply
 *
 * Applies a full vacation plan. For each day:
 *   - ASSIGNED: update time + position
 *   - USER_POOL: assign to day + update time + position
 *   - GOOGLE_PLACES: create new Activity record
 *
 * Deduplicates pool activities used on multiple days (first occurrence wins).
 * Creates one version snapshot before applying.
 *
 * Body:
 *   days  Array<{ dayId, suggestions: DaySuggestion[] }>  required
 */
export const applyVacationSuggestion = async (req: AuthRequest, res: Response) => {
  const vacationId = Array.isArray(req.params.vacationId)
    ? req.params.vacationId[0]
    : req.params.vacationId;

  if (!req.user) throw new AppError(401, 'Unauthorized');

  const { days } = req.body as {
    days: Array<{
      dayId: string;
      warnings?: string[];
      theme?: string;
      suggestions: Array<{
        source: 'ASSIGNED' | 'USER_POOL' | 'GOOGLE_PLACES';
        activityId?: string;
        googlePlacesId?: string;
        name: string;
        type: string;
        location: string;
        suggestedTime: string | null;
        suggestedPosition: number;
        duration: number | null;
        timeConstraint: string;
        priority: string;
        reasoning?: string;
      }>;
    }>;
  };

  if (!Array.isArray(days) || days.length === 0) {
    throw new AppError(400, 'days array is required');
  }

  // Verify ownership
  const vacation = await prisma.vacation.findUnique({
    where: { id: vacationId },
    include: { days: { include: { activities: true } }, homestays: true },
  });
  if (!vacation) throw new AppError(404, 'Vacation not found');
  if (vacation.userId !== req.user.id) throw new AppError(403, 'You do not have access to this vacation');

  // Snapshot before applying
  const latestVersion = await prisma.vacationVersion.findFirst({
    where: { vacationId },
    orderBy: { versionNumber: 'desc' },
  });
  const nextVersionNumber = (latestVersion?.versionNumber ?? 0) + 1;

  await prisma.vacationVersion.create({
    data: {
      vacationId,
      versionNumber: nextVersionNumber,
      reason: 'AI full vacation suggestion applied',
      snapshot: JSON.parse(JSON.stringify(vacation)),
    },
  });

  // Track pool activities already assigned (deduplicate across days)
  const usedPoolIds = new Set<string>();

  // Apply all days in sequence (not parallel — to respect dedup order)
  const results: Activity[][] = [];

  for (const day of days) {
    const { dayId, suggestions } = day;

    // Delete existing AI_SUGGESTED activities before applying new ones
    await prisma.activity.deleteMany({
      where: { dayId, source: 'AI_SUGGESTED', deletedAt: null },
    });

    await Promise.all(
      suggestions.map(async (s, index) => {
        const position = s.suggestedPosition ?? index + 1;
        const time = s.suggestedTime ?? undefined;

        if (s.source === 'ASSIGNED' && s.activityId) {
          return prisma.activity.update({
            where: { id: s.activityId },
            data: { time, position, reasoning: (s as any).reasoning ?? undefined },
          });
        }

        if (s.source === 'USER_POOL' && s.activityId) {
          if (usedPoolIds.has(s.activityId)) return;
          usedPoolIds.add(s.activityId);
          return prisma.activity.update({
            where: { id: s.activityId },
            data: { dayId, time, position, reasoning: (s as any).reasoning ?? undefined },
          });
        }

        if (s.source === 'GOOGLE_PLACES') {
          const { coordinates, realPlaceId } = await fetchPlaceCoordinates(s.name, s.location);
          return prisma.activity.create({
            data: {
              vacationId,
              dayId,
              type: s.type as 'RESTAURANT' | 'SIGHTSEEING' | 'ACTIVITY' | 'TRAVEL',
              name: s.name,
              location: s.location,
              googlePlacesId: realPlaceId ?? s.googlePlacesId,
              time,
              duration: s.duration,
              position,
              timeConstraint: s.timeConstraint as 'SPECIFIC_TIME' | 'MORNING' | 'AFTERNOON' | 'EVENING' | 'ANYTIME',
              priority: s.priority as 'MUST_HAVE' | 'NICE_TO_HAVE' | 'FLEXIBLE',
              source: 'AI_SUGGESTED',
              reasoning: (s as any).reasoning ?? undefined,
              ...(coordinates && { coordinates }),
            },
          });
        }
      })
    );

    // Save day-level warnings and theme
    const dayData = days.find((d: any) => d.dayId === dayId);
    if (dayData?.warnings?.length || dayData?.theme) {
      await prisma.day.update({
        where: { id: dayId },
        data: {
          ...(dayData.warnings?.length && { aiWarnings: dayData.warnings }),
          ...(dayData.theme && { theme: dayData.theme }),
        },
      });
    }

    const updated = await prisma.activity.findMany({
      where: { dayId, deletedAt: null },
      orderBy: [{ time: 'asc' }, { position: 'asc' }, { createdAt: 'asc' }],
    }) as unknown as Activity[];

    // Populate travel times before responding (must await on serverless)
    await populateTravelTimes(dayId, vacationId);

    results.push(updated);
  }

  res.json({
    success: true,
    versionCreated: nextVersionNumber,
    days: results.map((activities, i) => ({
      dayId: days[i].dayId,
      activities: activities.map(formatActivity),
    })),
  });
};