// types/index.ts
import { Request } from 'express';
import { Activity as PrismaActivity, Prisma } from '@prisma/client';

// ============================================================================
// PRISMA TYPE AUGMENTATION
// ============================================================================
//
// `position` and `deletedAt` exist in schema.prisma but the generated Prisma
// client is stale (needs `npx prisma generate`). These intersections add the
// missing fields so TypeScript is happy until you can regenerate.
// Remove this entire block after running `npx prisma generate`.
//

export type Activity = PrismaActivity & {
  position: number | null;
  deletedAt: Date | null;
};

export type ActivityWhereInput = Prisma.ActivityWhereInput & {
  deletedAt?: Date | null;
};

export type ActivityUncheckedCreateInput = Prisma.ActivityUncheckedCreateInput & {
  position?: number | null;
  deletedAt?: Date | null;
};

export type ActivityUncheckedUpdateInput = Prisma.ActivityUncheckedUpdateInput & {
  position?: number | null;
  deletedAt?: Date | null;
  dayId?: string | null | Prisma.NullableStringFieldUpdateOperationsInput;
};

// ============================================================================
// AUTH & USER
// ============================================================================

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
  };
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
}

export interface AuthResponse {
  token: string;
  userId: string;
  email: string;
}

// ============================================================================
// COORDINATES & TRAVEL
// ============================================================================

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface TravelTime {
  nextActivityId: string;
  minutes: number;
  distance: number;
  mode: 'WALKING' | 'TRANSIT' | 'DRIVING';
}

// ============================================================================
// GOOGLE PLACES
// ============================================================================

export interface GooglePlace {
  googlePlacesId: string;
  name: string;
  address: string;
  coordinates: Coordinates;
  type?: string;
  rating?: number;
  openNow?: boolean;
  photos?: string[];
}

// ============================================================================
// ACTIVITIES
// ============================================================================

export interface ActivityInput {
  type: 'RESTAURANT' | 'SIGHTSEEING' | 'ACTIVITY' | 'TRAVEL';
  name: string;
  location: string;
  dayId?: string | null; // nullable for unassigned pool
  time?: string; // HH:mm format
  duration?: number; // minutes
  position?: number; // manual sort order
  priority: 'MUST_HAVE' | 'NICE_TO_HAVE' | 'FLEXIBLE';
  timeConstraint: 'SPECIFIC_TIME' | 'MORNING' | 'AFTERNOON' | 'EVENING' | 'ANYTIME';
  notes?: string;
  googlePlacesId?: string;
}

export interface ActivityResponse {
  id: string;
  dayId: string | null; // nullable for unassigned pool
  vacationId: string;
  type: 'RESTAURANT' | 'SIGHTSEEING' | 'ACTIVITY' | 'TRAVEL';
  name: string;
  location: string;
  coordinates?: Coordinates;
  googlePlacesId: string | null;
  time: string | null;
  duration: number | null;
  position: number | null;
  timeConstraint: 'SPECIFIC_TIME' | 'MORNING' | 'AFTERNOON' | 'EVENING' | 'ANYTIME';
  priority: 'MUST_HAVE' | 'NICE_TO_HAVE' | 'FLEXIBLE';
  source: 'USER_ENTERED' | 'AI_SUGGESTED';
  notes: string | null;
  estimatedCost: number | null;
  metadata?: Record<string, any>;
  deletedAt: string | null; // null = active, non-null = hard-deleted
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// HOMESTAYS
// ============================================================================

export interface HomestayInput {
  name: string;
  address: string;
  checkInDate: string; // ISO date
  checkOutDate: string; // ISO date
  notes?: string;
}

export interface HomestayResponse {
  id: string;
  vacationId: string;
  name: string;
  address: string;
  coordinates?: Coordinates;
  checkInDate: string;
  checkOutDate: string;
  notes: string | null; // Prisma returns null, not undefined
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// DAYS
// ============================================================================

export interface DayInput {
  date: string; // ISO date
  homestayId?: string;
  notes?: string;
}

export interface DayResponse {
  id: string;
  vacationId: string;
  date: string; // ISO date
  homestayId: string | null; // Prisma returns null
  notes: string | null; // Prisma returns null
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// VACATIONS
// ============================================================================

export interface VacationInput {
  name: string;
  startDate: string; // ISO date
  endDate: string; // ISO date
}

export interface VacationResponse extends VacationInput {
  id: string;
  userId: string;
  version: number;
  parentVacationId?: string;
  variant?: string;
  homestays: HomestayResponse[];
  days: DayResponse[];
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// AI OPERATIONS
// ============================================================================

export interface SuggestActivitiesInput {
  dayId?: string;
  preferences?: {
    cuisineTypes?: string[];
    activityTypes?: string[];
    budgetPerMeal?: number;
  };
  constraints?: {
    mustHaves?: string[]; // activity IDs
    timeGap?: number; // minutes available
  };
}

export interface ActivitySuggestion {
  type: 'RESTAURANT' | 'SIGHTSEEING' | 'ACTIVITY' | 'TRAVEL';
  name: string;
  location: string;
  suggestedTime?: string;
  duration: number;
  reason: string;
  googlePlacesId?: string;
  rating?: number;
  openNow?: boolean;
}

export interface SuggestActivitiesResponse {
  status: 'success' | 'partial' | 'no_results';
  suggestions: ActivitySuggestion[];
  warnings: string[];
  metadata: {
    searchRadius: number;
    suggestedRadius?: number;
    resultsCount: number;
    budgetExceeded?: boolean;
  };
}

export interface OptimizeScheduleInput {
  dayId?: string;
  considerTravelTime: boolean;
  preferences?: {
    minBreakTime?: number; // minutes
    groupByLocation?: boolean;
  };
}

export interface OptimizeScheduleResponse {
  status: 'success';
  activities: ActivityResponse[];
  warnings: Array<{
    type: 'packed' | 'budget' | 'logistics';
    message: string;
  }>;
  summary: {
    totalActivityTime: number;
    totalTravelTime: number;
    totalRestTime: number;
    estimatedCost: number;
    feasible: boolean;
  };
}

export interface ApplyAISuggestionsInput {
  activities: Array<{
    activityId?: string;
    dayId: string;
  } & Partial<ActivityInput>>;
  createVersion: boolean;
  baseVersion: number;
}

// ============================================================================
// VERSIONING
// ============================================================================

export interface VacationVersionResponse {
  versionNumber: number;
  createdAt: string;
  reason?: string;
  snapshot: VacationResponse;
}

// ============================================================================
// ERROR RESPONSE
// ============================================================================

export interface ErrorResponse {
  error: string;
  message: string;
  details?: Record<string, any>;
}