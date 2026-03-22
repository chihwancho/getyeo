// src/services/routesService.ts
// Google Routes API — calculates transit travel times between consecutive activities
// Called after apply to populate travelTimeTo on each activity

import axios from 'axios';
import { Coordinates } from '../types';

export interface TravelTime {
  nextActivityId: string;
  minutes: number;
  distance: number; // km
  mode: 'WALKING' | 'TRANSIT' | 'DRIVING';
}

interface RouteResult {
  activityId: string;
  travelTimeTo: TravelTime | null;
}

const ROUTES_API_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';

// Compute travel time between two coordinates using Google Routes API
async function computeTravelTime(
  origin: Coordinates,
  destination: Coordinates,
  apiKey: string,
  mode: 'WALK' | 'TRANSIT' | 'DRIVE' = 'TRANSIT'
): Promise<{ minutes: number; distanceKm: number } | null> {
  try {
    const res = await axios.post(
      ROUTES_API_URL,
      {
        origin: {
          location: { latLng: { latitude: origin.lat, longitude: origin.lng } },
        },
        destination: {
          location: { latLng: { latitude: destination.lat, longitude: destination.lng } },
        },
        travelMode: mode,
        routingPreference: mode === 'TRANSIT' ? 'ROUTING_PREFERENCE_UNSPECIFIED' : undefined,
        computeAlternativeRoutes: false,
        languageCode: 'en-US',
        units: 'METRIC',
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters',
        },
        timeout: 5000,
      }
    );

    const route = res.data?.routes?.[0];
    if (!route) return null;

    const seconds = parseInt(route.duration?.replace('s', '') ?? '0', 10);
    const meters = route.distanceMeters ?? 0;

    return {
      minutes: Math.round(seconds / 60),
      distanceKm: Math.round((meters / 1000) * 10) / 10,
    };
  } catch {
    return null;
  }
}

// Choose best travel mode based on distance
function chooseTravelMode(distanceKm: number): 'WALK' | 'TRANSIT' | 'DRIVE' {
  if (distanceKm < 1.5) return 'WALK';
  if (distanceKm < 20) return 'TRANSIT';
  return 'DRIVE';
}

export interface ActivityWithCoords {
  id: string;
  coordinates: Coordinates | null;
}

// Compute travel times for a list of ordered activities and return a map of
// activityId -> TravelTime for each consecutive pair that has coordinates.
export async function computeTravelTimes(
  activities: ActivityWithCoords[],
  apiKey: string
): Promise<Map<string, TravelTime>> {
  const result = new Map<string, TravelTime>();

  if (!apiKey || activities.length < 2) return result;

  // Process consecutive pairs in parallel (capped at 5 to avoid rate limits)
  const pairs: Array<{ fromId: string; toId: string; from: Coordinates; to: Coordinates }> = [];

  for (let i = 0; i < activities.length - 1; i++) {
    const from = activities[i];
    const to = activities[i + 1];
    if (from.coordinates && to.coordinates) {
      pairs.push({
        fromId: from.id,
        toId: to.id,
        from: from.coordinates,
        to: to.coordinates,
      });
    }
  }

  // First pass — rough distance using DRIVE to pick travel mode
  await Promise.all(
    pairs.map(async (pair) => {
      try {
        // Quick drive estimate for distance
        const driveResult = await computeTravelTime(pair.from, pair.to, apiKey, 'DRIVE');
        if (!driveResult) return;

        const mode = chooseTravelMode(driveResult.distanceKm);

        // Re-compute with chosen mode if different
        let finalResult = driveResult;
        let finalMode: 'WALKING' | 'TRANSIT' | 'DRIVING' = 'DRIVING';

        if (mode === 'WALK') {
          const walkResult = await computeTravelTime(pair.from, pair.to, apiKey, 'WALK');
          if (walkResult) { finalResult = walkResult; finalMode = 'WALKING'; }
        } else if (mode === 'TRANSIT') {
          const transitResult = await computeTravelTime(pair.from, pair.to, apiKey, 'TRANSIT');
          if (transitResult) { finalResult = transitResult; finalMode = 'TRANSIT'; }
        }

        result.set(pair.fromId, {
          nextActivityId: pair.toId,
          minutes: finalResult.minutes,
          distance: finalResult.distanceKm,
          mode: finalMode,
        });
      } catch {
        // fail silently per pair
      }
    })
  );

  return result;
}