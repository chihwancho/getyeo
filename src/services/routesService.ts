// src/services/routesService.ts
import axios from 'axios';
import { Coordinates } from '../types';

export interface TravelTime {
  nextActivityId: string;
  minutes: number;
  distance: number; // km
  mode: 'WALKING' | 'TRANSIT' | 'DRIVING';
}

export interface ActivityWithCoords {
  id: string;
  coordinates: Coordinates | null;
}

const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';

async function computeRoute(
  origin: Coordinates,
  destination: Coordinates,
  apiKey: string,
  mode: 'WALK' | 'DRIVE'
): Promise<{ minutes: number; distanceKm: number } | null> {
  try {
    const res = await axios.post(
      ROUTES_URL,
      {
        origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
        destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
        travelMode: mode,
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
        timeout: 6000,
      }
    );

    const route = res.data?.routes?.[0];
    if (!route) return null;

    const seconds = parseInt((route.duration ?? '0s').replace('s', ''), 10);
    const meters = route.distanceMeters ?? 0;

    return {
      minutes: Math.round(seconds / 60),
      distanceKm: Math.round((meters / 1000) * 10) / 10,
    };
  } catch (err: any) {
    console.error('[routesService] computeRoute failed:', err?.response?.data ?? err?.message);
    return null;
  }
}

export async function computeTravelTimes(
  activities: ActivityWithCoords[],
  apiKey: string
): Promise<Map<string, TravelTime>> {
  const result = new Map<string, TravelTime>();
  if (!apiKey || activities.length < 2) return result;

  const pairs = [];
  for (let i = 0; i < activities.length - 1; i++) {
    const from = activities[i];
    const to = activities[i + 1];
    if (from.coordinates && to.coordinates) {
      pairs.push({ fromId: from.id, toId: to.id, from: from.coordinates, to: to.coordinates });
    }
  }

  await Promise.all(
    pairs.map(async (pair) => {
      try {
        // Try walking first — if under ~25 min it's walkable
        const walk = await computeRoute(pair.from, pair.to, apiKey, 'WALK');
        if (walk && walk.minutes <= 25) {
          result.set(pair.fromId, {
            nextActivityId: pair.toId,
            minutes: walk.minutes,
            distance: walk.distanceKm,
            mode: 'WALKING',
          });
          return;
        }

        // Fall back to driving for time estimate (transit not supported without departure time)
        const drive = await computeRoute(pair.from, pair.to, apiKey, 'DRIVE');
        if (drive) {
          // Heuristic: transit is roughly 1.5x driving time in most cities
          const mode = drive.distanceKm < 30 ? 'TRANSIT' : 'DRIVING';
          const minutes = mode === 'TRANSIT' ? Math.round(drive.minutes * 1.5) : drive.minutes;
          result.set(pair.fromId, {
            nextActivityId: pair.toId,
            minutes,
            distance: drive.distanceKm,
            mode,
          });
        }
      } catch (err: any) {
        console.error('[routesService] pair failed:', err?.message);
      }
    })
  );

  console.log(`[routesService] computed ${result.size}/${pairs.length} travel times`);
  return result;
}