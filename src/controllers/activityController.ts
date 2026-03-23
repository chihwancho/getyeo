// controllers/activityController.ts
import { Response } from 'express';
import { AuthRequest, ActivityInput, ActivityResponse, Coordinates, Activity } from '../types';
import { AppError } from '../middleware/errorHandler';
import { Prisma } from '@prisma/client';
import { GooglePlacesService } from '../services/googlePlacesService';
import { prisma } from '../lib/prisma';

// ============================================================================
// HELPER: ACTIVITY SORT ORDER
// ============================================================================

/**
 * Standard sort order for activities:
 * 1. time (ascending) - activities with times come first
 * 2. position (ascending) - manual order for activities without times
 * 3. createdAt (ascending) - fallback to creation order
 * 
 * NOTE: After updating the Prisma schema with new fields (position, deletedAt),
 * run `npx prisma generate` to regenerate the client types. If TypeScript still
 * shows errors after regenerating, restart the TS server.
 */
const ACTIVITY_SORT_ORDER = [
  { time: 'asc' as const },
  { position: 'asc' as const },
  { createdAt: 'asc' as const },
];

// ============================================================================
// HELPER: PRISMA NULL/UNDEFINED CONVERSION
// ============================================================================

/**
 * Prisma's create/update expect undefined for optional fields, not null.
 * This helper converts null → undefined for optional string fields.
 */
const toUndefined = (value: string | null | undefined): string | undefined => {
  return value === null ? undefined : value;
};

/**
 * Hard-deleted activities have `deletedAt` set to a non-null Date.
 */
const isActivityHardDeleted = (activity: Activity): boolean => {
  return activity.deletedAt !== null;
};

/**
 * Safely cast a Prisma JsonValue to Coordinates.
 * Prisma stores Json fields as JsonValue (which includes null), but our
 * domain type is Coordinates | undefined. We cast only when the value is a
 * non-null object — anything else (null, primitives) becomes undefined.
 */
const toCoordinates = (value: Prisma.JsonValue | null | undefined): Coordinates | undefined => {
  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as unknown as Coordinates;
};

/**
 * Safely cast a Prisma JsonValue to a plain record for metadata / travelTimeTo.
 */
const toRecord = (value: Prisma.JsonValue | null | undefined): Record<string, unknown> | undefined => {
  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
};


/**
 * Best-effort coordinate lookup for a googlePlacesId.
 * Returns null silently on any failure — never blocks the main operation.
 */
const fetchPlaceCoordinates = async (
  googlePlacesId: string
): Promise<{ lat: number; lng: number } | null> => {
  try {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) return null;
    const service = new GooglePlacesService(apiKey);
    // Try getDetails first (for valid IDs stored from real searches)
    try {
      const place = await service.getDetails(googlePlacesId);
      if (place.coordinates) return place.coordinates;
    } catch {
      // fall through — ID may be invalid
    }
    return null;
  } catch {
    return null;
  }
};

// ============================================================================
// HELPER: FORMAT ACTIVITY RESPONSE
// ============================================================================

const formatActivityResponse = (activity: Activity): ActivityResponse => {
  return {
    id: activity.id,
    dayId: activity.dayId,
    vacationId: activity.vacationId,
    type: activity.type,
    name: activity.name,
    location: activity.location,
    coordinates: toCoordinates(activity.coordinates),
    googlePlacesId: activity.googlePlacesId,
    time: activity.time,
    duration: activity.duration,
    position: activity.position,
    timeConstraint: activity.timeConstraint,
    priority: activity.priority,
    source: activity.source,
    notes: activity.notes,
    estimatedCost: activity.estimatedCost,
    travelTimeTo: toRecord(activity.travelTimeTo),
    metadata: toRecord(activity.metadata),
    deletedAt: activity.deletedAt ? activity.deletedAt.toISOString() : null,
    createdAt: activity.createdAt.toISOString(),
    updatedAt: activity.updatedAt.toISOString(),
  };
};

// ============================================================================
// GET ACTIVITIES (with optional dayId filter for unassigned pool)
// ============================================================================

/**
 * GET /api/vacations/:vacationId/activities
 * 
 * Query params:
 * - dayId=null : Get unassigned activities (in pool, not on any day)
 * - dayId={id} : Get activities for a specific day
 * - omit dayId : Get all activities for vacation (excluding hard-deleted)
 */
export const getActivities = async (req: AuthRequest, res: Response) => {
  try {
    const vacationId = Array.isArray(req.params.vacationId)
      ? req.params.vacationId[0]
      : req.params.vacationId;

    if (!req.user) {
      throw new AppError(401, 'Unauthorized');
    }

    // Verify vacation exists and user owns it
    const vacation = await prisma.vacation.findUnique({
      where: { id: vacationId },
    });

    if (!vacation) {
      throw new AppError(404, 'Vacation not found');
    }

    if (vacation.userId !== req.user.id) {
      throw new AppError(403, 'You do not have access to this vacation');
    }

    // Build where clause
    let whereClause: Prisma.ActivityWhereInput = {
      vacationId,
      deletedAt: null, // Exclude hard-deleted activities
    };

    // Filter by dayId if provided (including unassigned pool: dayId=null)
    if (req.query.dayId !== undefined) {
      const dayIdParam = req.query.dayId as string;
      if (dayIdParam === 'null') {
        whereClause.dayId = null; // Unassigned pool
      } else {
        whereClause.dayId = dayIdParam;
      }
    }

    // Fetch activities with sorting
    const activities = await prisma.activity.findMany({
      where: whereClause,
      orderBy: ACTIVITY_SORT_ORDER,
    });

    res.json(activities.map(formatActivityResponse));
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(500, 'Failed to fetch activities', { error });
  }
};

// ============================================================================
// GET SINGLE ACTIVITY
// ============================================================================

export const getActivity = async (req: AuthRequest, res: Response) => {
  try {
    const vacationId = Array.isArray(req.params.vacationId)
      ? req.params.vacationId[0]
      : req.params.vacationId;
    const activityId = Array.isArray(req.params.activityId)
      ? req.params.activityId[0]
      : req.params.activityId;

    if (!req.user) {
      throw new AppError(401, 'Unauthorized');
    }

    // Verify vacation exists and user owns it
    const vacation = await prisma.vacation.findUnique({
      where: { id: vacationId },
    });

    if (!vacation) {
      throw new AppError(404, 'Vacation not found');
    }

    if (vacation.userId !== req.user.id) {
      throw new AppError(403, 'You do not have access to this vacation');
    }

    // Get activity
    const activity = await prisma.activity.findUnique({
      where: { id: activityId },
    });

    if (!activity) {
      throw new AppError(404, 'Activity not found');
    }

    // Verify activity belongs to this vacation
    if (activity.vacationId !== vacationId) {
      throw new AppError(404, 'Activity not found in this vacation');
    }

    // Don't return hard-deleted activities
    if (isActivityHardDeleted(activity)) {
      throw new AppError(404, 'Activity not found');
    }

    res.json(formatActivityResponse(activity));
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(500, 'Failed to fetch activity', { error });
  }
};

// ============================================================================
// CREATE ACTIVITY
// ============================================================================

export const createActivity = async (req: AuthRequest, res: Response) => {
  try {
    const vacationId = Array.isArray(req.params.vacationId)
      ? req.params.vacationId[0]
      : req.params.vacationId;

    const {
      type,
      name,
      location,
      dayId,
      time,
      duration,
      position,
      priority,
      timeConstraint,
      notes,
      googlePlacesId,
    } = req.body as ActivityInput;

    if (!req.user) {
      throw new AppError(401, 'Unauthorized');
    }

    // Validate required fields
    if (!type || !name || !location || !priority || !timeConstraint) {
      throw new AppError(
        400,
        'type, name, location, priority, and timeConstraint are required'
      );
    }

    // Verify vacation exists and user owns it
    const vacation = await prisma.vacation.findUnique({
      where: { id: vacationId },
    });

    if (!vacation) {
      throw new AppError(404, 'Vacation not found');
    }

    if (vacation.userId !== req.user.id) {
      throw new AppError(403, 'You do not have access to this vacation');
    }

    // If dayId is provided, verify it belongs to this vacation
    if (dayId) {
      const day = await prisma.day.findUnique({
        where: { id: dayId },
      });

      if (!day || day.vacationId !== vacationId) {
        throw new AppError(400, 'Day not found in this vacation');
      }
    }

    // Validate time format if provided (HH:mm)
    if (time && !/^\d{2}:\d{2}$/.test(time)) {
      throw new AppError(400, 'Time must be in HH:mm format');
    }

    // Fetch coordinates if googlePlacesId provided (best-effort, fail silently)
    const coordinates = googlePlacesId
      ? await fetchPlaceCoordinates(googlePlacesId)
      : null;

    // Create activity (unchecked input so nullable dayId is typed as string | null)
    const activity = await prisma.activity.create({
      data: {
        vacationId,
        dayId: dayId ?? null,
        type,
        name,
        location,
        time: toUndefined(time),
        duration,
        position,
        priority,
        timeConstraint,
        notes: toUndefined(notes),
        googlePlacesId: toUndefined(googlePlacesId),
        source: 'USER_ENTERED',
        ...(coordinates && { coordinates }),
      } as Prisma.ActivityUncheckedCreateInput,
    });

    res.status(201).json(formatActivityResponse(activity));
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(500, 'Failed to create activity', { error });
  }
};

// ============================================================================
// UPDATE ACTIVITY
// ============================================================================

export const updateActivity = async (req: AuthRequest, res: Response) => {
  try {
    const vacationId = Array.isArray(req.params.vacationId)
      ? req.params.vacationId[0]
      : req.params.vacationId;
    const activityId = Array.isArray(req.params.activityId)
      ? req.params.activityId[0]
      : req.params.activityId;

    const {
      type,
      name,
      location,
      dayId,
      time,
      duration,
      position,
      priority,
      timeConstraint,
      notes,
      googlePlacesId,
    } = req.body;

    if (!req.user) {
      throw new AppError(401, 'Unauthorized');
    }

    // Verify vacation exists and user owns it
    const vacation = await prisma.vacation.findUnique({
      where: { id: vacationId },
    });

    if (!vacation) {
      throw new AppError(404, 'Vacation not found');
    }

    if (vacation.userId !== req.user.id) {
      throw new AppError(403, 'You do not have access to this vacation');
    }

    // Get activity
    const activity = await prisma.activity.findUnique({
      where: { id: activityId },
    });

    if (!activity || activity.vacationId !== vacationId) {
      throw new AppError(404, 'Activity not found in this vacation');
    }

    // Don't allow updating hard-deleted activities
    if (isActivityHardDeleted(activity)) {
      throw new AppError(404, 'Activity not found');
    }

    // If dayId is being changed, verify new day belongs to this vacation
    if (dayId !== undefined && dayId !== null) {
      const day = await prisma.day.findUnique({
        where: { id: dayId },
      });

      if (!day || day.vacationId !== vacationId) {
        throw new AppError(400, 'Day not found in this vacation');
      }
    }

    // Validate time format if provided
    if (time && !/^\d{2}:\d{2}$/.test(time)) {
      throw new AppError(400, 'Time must be in HH:mm format');
    }

    // Build update data (only include provided fields)
    const updateData: Prisma.ActivityUncheckedUpdateInput = {};
    if (type !== undefined) updateData.type = type;
    if (name !== undefined) updateData.name = name;
    if (location !== undefined) updateData.location = location;
    if (dayId !== undefined) updateData.dayId = dayId; // Can be null to move to unassigned pool
    if (time !== undefined) updateData.time = time;
    if (duration !== undefined) updateData.duration = duration;
    if (position !== undefined) updateData.position = position;
    if (priority !== undefined) updateData.priority = priority;
    if (timeConstraint !== undefined) updateData.timeConstraint = timeConstraint;
    if (notes !== undefined) updateData.notes = notes;
    if (googlePlacesId !== undefined) updateData.googlePlacesId = googlePlacesId;

    // Re-fetch coordinates if googlePlacesId is being set or changed
    if (googlePlacesId) {
      const coordinates = await fetchPlaceCoordinates(googlePlacesId);
      if (coordinates) updateData.coordinates = coordinates;
    }

    // Update activity
    const updatedActivity = await prisma.activity.update({
      where: { id: activityId },
      data: updateData,
    });

    res.json(formatActivityResponse(updatedActivity));
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(500, 'Failed to update activity', { error });
  }
};

// ============================================================================
// DELETE ACTIVITY (Hard Delete - sets deletedAt)
// ============================================================================

/**
 * Hard delete an activity - sets deletedAt timestamp.
 * This signals to the AI that the activity type is rejected.
 * 
 * Query params:
 * - softDelete=true : Move to unassigned pool instead (dayId → null, keep in DB)
 */
export const deleteActivity = async (req: AuthRequest, res: Response) => {
  try {
    const vacationId = Array.isArray(req.params.vacationId)
      ? req.params.vacationId[0]
      : req.params.vacationId;
    const activityId = Array.isArray(req.params.activityId)
      ? req.params.activityId[0]
      : req.params.activityId;

    const softDelete = req.query.softDelete === 'true';

    if (!req.user) {
      throw new AppError(401, 'Unauthorized');
    }

    // Verify vacation exists and user owns it
    const vacation = await prisma.vacation.findUnique({
      where: { id: vacationId },
    });

    if (!vacation) {
      throw new AppError(404, 'Vacation not found');
    }

    if (vacation.userId !== req.user.id) {
      throw new AppError(403, 'You do not have access to this vacation');
    }

    // Get activity
    const activity = await prisma.activity.findUnique({
      where: { id: activityId },
    });

    if (!activity || activity.vacationId !== vacationId) {
      throw new AppError(404, 'Activity not found in this vacation');
    }

    if (softDelete) {
      // Soft delete: move to unassigned pool
      await prisma.activity.update({
        where: { id: activityId },
        data: { dayId: null },
      });
    } else {
      // Hard delete: set deletedAt (AI feedback signal)
      await prisma.activity.update({
        where: { id: activityId },
        data: { deletedAt: new Date() },
      });
    }

    res.json({ success: true });
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(500, 'Failed to delete activity', { error });
  }
};

// ============================================================================
// MOVE ACTIVITY TO DAY (Alternative to full update)
// ============================================================================

/**
 * Convenience endpoint to move an activity to a different day or unassigned pool.
 * 
 * POST /api/vacations/:vacationId/activities/:activityId/move
 * Body: { dayId: string | null }
 */
export const moveActivity = async (req: AuthRequest, res: Response) => {
  try {
    const vacationId = Array.isArray(req.params.vacationId)
      ? req.params.vacationId[0]
      : req.params.vacationId;
    const activityId = Array.isArray(req.params.activityId)
      ? req.params.activityId[0]
      : req.params.activityId;

    const { dayId } = req.body;

    if (!req.user) {
      throw new AppError(401, 'Unauthorized');
    }

    // Verify vacation exists and user owns it
    const vacation = await prisma.vacation.findUnique({
      where: { id: vacationId },
    });

    if (!vacation) {
      throw new AppError(404, 'Vacation not found');
    }

    if (vacation.userId !== req.user.id) {
      throw new AppError(403, 'You do not have access to this vacation');
    }

    // Get activity
    const activity = await prisma.activity.findUnique({
      where: { id: activityId },
    });

    if (!activity || activity.vacationId !== vacationId) {
      throw new AppError(404, 'Activity not found in this vacation');
    }

    if (isActivityHardDeleted(activity)) {
      throw new AppError(404, 'Activity not found');
    }

    // If moving to a specific day, verify it belongs to this vacation
    if (dayId !== null && dayId !== undefined) {
      const day = await prisma.day.findUnique({
        where: { id: dayId },
      });

      if (!day || day.vacationId !== vacationId) {
        throw new AppError(400, 'Day not found in this vacation');
      }
    }

    // Move activity
    const updatedActivity = await prisma.activity.update({
      where: { id: activityId },
      data: { dayId: dayId === undefined ? undefined : (dayId ?? null) },
    });

    res.json(formatActivityResponse(updatedActivity));
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(500, 'Failed to move activity', { error });
  }
};