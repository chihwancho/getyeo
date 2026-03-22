// src/services/googlePlacesService.ts
//
// Google Places API (New) — https://places.googleapis.com/v1/places
//
// All four operations:
//   searchNearby  — lat/lng + radius + optional type filter
//   searchText    — free-text query, optional location bias
//   getDetails    — single place by googlePlacesId
//   autocomplete  — partial input, returns predictions with placeIds
//
// Field masking controls both what is returned AND what we're billed for.
// We request only what GooglePlace needs (Essentials + Basic tier fields).
// See: https://developers.google.com/maps/documentation/places/web-service/usage-and-billing

import axios, { AxiosInstance } from 'axios';
import { GooglePlace } from '../types';

// ============================================================================
// CONSTANTS
// ============================================================================

const PLACES_BASE_URL = 'https://places.googleapis.com/v1';

// Field mask for search results (Essentials + Basic tier)
const SEARCH_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.types',
  'places.rating',
  'places.currentOpeningHours.openNow',
  'places.primaryType',
].join(',');

// Field mask for place details (single request, can afford more fields)
const DETAILS_FIELD_MASK = [
  'id',
  'displayName',
  'formattedAddress',
  'location',
  'types',
  'rating',
  'currentOpeningHours.openNow',
  'currentOpeningHours.weekdayDescriptions',
  'primaryType',
  'photos',
  'editorialSummary',
  'priceLevel',
  'websiteUri',
  'nationalPhoneNumber',
].join(',');

// ============================================================================
// TYPES — raw Google API shapes
// ============================================================================

interface GooglePlaceRaw {
  id: string;
  displayName?: { text: string; languageCode?: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  types?: string[];
  primaryType?: string;
  rating?: number;
  currentOpeningHours?: { openNow?: boolean; weekdayDescriptions?: string[] };
  photos?: Array<{ name: string }>;
  editorialSummary?: { text: string };
  priceLevel?: string;
  websiteUri?: string;
  nationalPhoneNumber?: string;
}

interface AutocompletePredictionRaw {
  placePrediction?: {
    placeId: string;
    text: { text: string };
    structuredFormat?: {
      mainText: { text: string };
      secondaryText?: { text: string };
    };
    types?: string[];
  };
}

export interface AutocompletePrediction {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
  types: string[];
}

export interface NearbySearchParams {
  lat: number;
  lng: number;
  radiusMeters?: number;       // default 1000
  includedTypes?: string[];    // e.g. ['restaurant', 'cafe']
  maxResultCount?: number;     // default 20, max 20
}

export interface TextSearchParams {
  query: string;
  lat?: number;
  lng?: number;
  radiusMeters?: number;       // bias radius when lat/lng provided
  includedType?: string;       // single type filter
  maxResultCount?: number;
}

export interface AutocompleteParams {
  input: string;
  lat?: number;
  lng?: number;
  radiusMeters?: number;
  includedPrimaryTypes?: string[];
  sessionToken?: string;
}

// ============================================================================
// HELPERS
// ============================================================================

const mapPlace = (raw: GooglePlaceRaw): GooglePlace => ({
  googlePlacesId: raw.id,
  name: raw.displayName?.text ?? '(unknown)',
  address: raw.formattedAddress ?? '',
  coordinates: {
    lat: raw.location?.latitude ?? 0,
    lng: raw.location?.longitude ?? 0,
  },
  type: raw.primaryType ?? raw.types?.[0],
  rating: raw.rating,
  openNow: raw.currentOpeningHours?.openNow,
  photos: raw.photos?.map((p) => p.name),
});

// ============================================================================
// SERVICE CLASS
// ============================================================================

export class GooglePlacesService {
  private client: AxiosInstance;

  constructor(apiKey: string) {
    this.client = axios.create({
      baseURL: PLACES_BASE_URL,
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
      },
    });
  }

  // --------------------------------------------------------------------------
  // NEARBY SEARCH
  // --------------------------------------------------------------------------

  /**
   * Find places within a radius of a lat/lng point.
   * POST https://places.googleapis.com/v1/places:searchNearby
   */
  async searchNearby(params: NearbySearchParams): Promise<GooglePlace[]> {
    const { lat, lng, radiusMeters = 1000, includedTypes, maxResultCount = 20 } = params;

    const body: Record<string, unknown> = {
      locationRestriction: {
        circle: {
          center: { latitude: lat, longitude: lng },
          radius: radiusMeters,
        },
      },
      maxResultCount,
    };

    if (includedTypes && includedTypes.length > 0) {
      body.includedTypes = includedTypes;
    }

    const res = await this.client.post<{ places?: GooglePlaceRaw[] }>(
      '/places:searchNearby',
      body,
      { headers: { 'X-Goog-FieldMask': SEARCH_FIELD_MASK } }
    );

    return (res.data.places ?? []).map(mapPlace);
  }

  // --------------------------------------------------------------------------
  // TEXT SEARCH
  // --------------------------------------------------------------------------

  /**
   * Search for places using a free-text query.
   * POST https://places.googleapis.com/v1/places:searchText
   */
  async searchText(params: TextSearchParams): Promise<GooglePlace[]> {
    const { query, lat, lng, radiusMeters = 5000, includedType, maxResultCount = 20 } = params;

    const body: Record<string, unknown> = { textQuery: query, maxResultCount };

    if (lat !== undefined && lng !== undefined) {
      body.locationBias = {
        circle: {
          center: { latitude: lat, longitude: lng },
          radius: radiusMeters,
        },
      };
    }

    if (includedType) {
      body.includedType = includedType;
    }

    const res = await this.client.post<{ places?: GooglePlaceRaw[] }>(
      '/places:searchText',
      body,
      { headers: { 'X-Goog-FieldMask': SEARCH_FIELD_MASK } }
    );

    return (res.data.places ?? []).map(mapPlace);
  }

  // --------------------------------------------------------------------------
  // PLACE DETAILS
  // --------------------------------------------------------------------------

  /**
   * Fetch full details for a single place by its Place ID.
   * GET https://places.googleapis.com/v1/places/{placeId}
   */
  async getDetails(googlePlacesId: string): Promise<GooglePlace> {
    const res = await this.client.get<GooglePlaceRaw>(
      `/places/${googlePlacesId}`,
      { headers: { 'X-Goog-FieldMask': DETAILS_FIELD_MASK } }
    );

    return mapPlace(res.data);
  }

  // --------------------------------------------------------------------------
  // AUTOCOMPLETE
  // --------------------------------------------------------------------------

  /**
   * Return place predictions for a partial text input.
   * Pass sessionToken to group autocomplete + detail calls into one billing session.
   * POST https://places.googleapis.com/v1/places:autocomplete
   */
  async autocomplete(params: AutocompleteParams): Promise<AutocompletePrediction[]> {
    const { input, lat, lng, radiusMeters = 50000, includedPrimaryTypes, sessionToken } = params;

    const body: Record<string, unknown> = { input };

    if (lat !== undefined && lng !== undefined) {
      body.locationBias = {
        circle: {
          center: { latitude: lat, longitude: lng },
          radius: radiusMeters,
        },
      };
    }

    if (includedPrimaryTypes && includedPrimaryTypes.length > 0) {
      body.includedPrimaryTypes = includedPrimaryTypes;
    }

    if (sessionToken) {
      body.sessionToken = sessionToken;
    }

    const res = await this.client.post<{ suggestions?: AutocompletePredictionRaw[] }>(
      '/places:autocomplete',
      body
    );

    return (res.data.suggestions ?? [])
      .filter((s) => s.placePrediction)
      .map((s) => {
        const p = s.placePrediction!;
        return {
          placeId: p.placeId,
          description: p.text.text,
          mainText: p.structuredFormat?.mainText.text ?? p.text.text,
          secondaryText: p.structuredFormat?.secondaryText?.text ?? '',
          types: p.types ?? [],
        };
      });
  }
}

// ============================================================================
// SINGLETON FACTORY
// ============================================================================

let _instance: GooglePlacesService | null = null;

/**
 * Returns a singleton GooglePlacesService.
 * Throws clearly if GOOGLE_PLACES_API_KEY is not set.
 */
export const getPlacesService = (): GooglePlacesService => {
  if (_instance) return _instance;

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GOOGLE_PLACES_API_KEY environment variable is not set. ' +
      'Add it to your .env file to use Places features.'
    );
  }

  _instance = new GooglePlacesService(apiKey);
  return _instance;
};