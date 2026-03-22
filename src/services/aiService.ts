// src/services/aiService.ts
import Anthropic from '@anthropic-ai/sdk';
import { ActivityResponse } from '../types';

// ============================================================================
// TYPES
// ============================================================================

export interface ScheduledActivity {
  id: string;
  suggestedTime: string | null;
  suggestedPosition: number;
  reasoning: string;
  addedFromPool: boolean; // true if pulled from unassigned pool
}

export interface OptimizeScheduleResult {
  status: 'success' | 'partial';
  scheduledActivities: ScheduledActivity[];
  warnings: string[];
  summary: string;
}

interface ActivityForPrompt {
  id: string;
  name: string;
  type: string;
  location: string;
  timeConstraint: string;
  currentTime: string | null;
  duration: number | null;
  priority: string;
  notes: string | null;
  assigned: boolean; // false = from unassigned pool (optional to include)
}

interface ClaudeScheduleResponse {
  scheduledActivities: Array<{
    id: string;
    suggestedTime: string | null;
    suggestedPosition: number;
    reasoning: string;
  }>;
  warnings: string[];
  summary: string;
}

// ============================================================================
// SINGLETON CLIENT
// ============================================================================

let _client: Anthropic | null = null;

const getClient = (): Anthropic => {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY environment variable is not set. ' +
      'Add it to your .env file to use AI features.'
    );
  }
  _client = new Anthropic({ apiKey });
  return _client;
};

// ============================================================================
// OPTIMIZE SCHEDULE
// ============================================================================

export const optimizeSchedule = async (
  assignedActivities: ActivityResponse[],
  options: {
    date: string;
    minBreakMinutes?: number;
    groupByLocation?: boolean;
    poolActivities?: ActivityResponse[]; // unassigned pool candidates
  }
): Promise<OptimizeScheduleResult> => {
  const {
    date,
    minBreakMinutes = 15,
    groupByLocation = true,
    poolActivities = [],
  } = options;

  const schedulable = assignedActivities.filter((a) => a.deletedAt === null);
  const poolCandidates = poolActivities.filter((a) => a.deletedAt === null);

  if (schedulable.length === 0 && poolCandidates.length === 0) {
    return {
      status: 'success',
      scheduledActivities: [],
      warnings: ['No activities to schedule for this day.'],
      summary: 'No activities to schedule.',
    };
  }

  // Build the combined prompt list, flagging each as assigned vs pool
  const activitiesForPrompt: ActivityForPrompt[] = [
    ...schedulable.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      location: a.location,
      timeConstraint: a.timeConstraint,
      currentTime: a.time,
      duration: a.duration,
      priority: a.priority,
      notes: a.notes,
      assigned: true,
    })),
    ...poolCandidates.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      location: a.location,
      timeConstraint: a.timeConstraint,
      currentTime: a.time,
      duration: a.duration,
      priority: a.priority,
      notes: a.notes,
      assigned: false,
    })),
  ];

  const hasPool = poolCandidates.length > 0;

  const systemPrompt = `You are a travel itinerary optimizer. Your job is to create a practical, enjoyable daily schedule.

ACTIVITY TYPES:
- assigned: true  → Already on this day. MUST be included in the schedule.
- assigned: false → From the user's wishlist (unassigned pool). Include ONLY if they fit naturally without overcrowding the day.

RULES:
1. ALL assigned activities must appear in scheduledActivities.
2. Pool activities (assigned: false) are OPTIONAL — only include them if there is genuine time and they add value. Do not force them in.
3. Activities with timeConstraint SPECIFIC_TIME must keep their currentTime exactly.
4. MORNING: 08:00–12:00, AFTERNOON: 12:00–17:00, EVENING: 17:00–22:00, ANYTIME: fill gaps.
5. MUST_HAVE takes priority over NICE_TO_HAVE and FLEXIBLE.
6. Leave at least ${minBreakMinutes} minutes buffer between activities.
7. Default durations if null: RESTAURANT=90min, SIGHTSEEING=120min, ACTIVITY=60min, TRAVEL=30min.
8. A typical day runs 08:00–22:00. Flag anything that doesn't fit as a warning.
${groupByLocation ? '9. Group nearby locations together to minimize travel time.' : ''}
${hasPool ? '10. If pulling from the pool, prefer MUST_HAVE over NICE_TO_HAVE, and activities that complement the existing schedule geographically.' : ''}

OUTPUT FORMAT:
Respond with ONLY a valid JSON object — no markdown, no commentary:
{
  "scheduledActivities": [
    {
      "id": "<activity id>",
      "suggestedTime": "<HH:mm or null>",
      "suggestedPosition": <1-based integer>,
      "reasoning": "<one sentence>"
    }
  ],
  "warnings": ["<scheduling conflicts or concerns>"],
  "summary": "<2-3 sentence plain-English overview of the day>"
}

Only include activities you are actually scheduling. Pool activities you decide to skip should not appear in the output.`;

  const userMessage = `Please optimize the schedule for ${date}.

Activities (assigned=true are confirmed for this day, assigned=false are optional pool candidates):
${JSON.stringify(activitiesForPrompt, null, 2)}`;

  const message = await getClient().messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 2048,
    messages: [{ role: 'user', content: userMessage }],
    system: systemPrompt,
  });

  const rawText = message.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('');

  let parsed: ClaudeScheduleResponse;
  try {
    const cleaned = rawText.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`AI returned invalid JSON. Raw response: ${rawText.slice(0, 200)}`);
  }

  // Track which pool activities Claude chose to include
  const poolIds = new Set(poolCandidates.map((a) => a.id));
  const assignedIds = new Set(schedulable.map((a) => a.id));

  // Validate all assigned activities are present
  const returnedIds = new Set(parsed.scheduledActivities.map((a) => a.id));
  const missingAssigned = schedulable.filter((a) => !returnedIds.has(a.id));
  const status = missingAssigned.length > 0 ? 'partial' : 'success';
  const warnings = [...(parsed.warnings ?? [])];

  if (missingAssigned.length > 0) {
    warnings.push(
      `AI did not schedule ${missingAssigned.length} assigned activity(s) — they remain at their current times.`
    );
  }

  const scheduledActivities: ScheduledActivity[] = parsed.scheduledActivities.map((s) => ({
    ...s,
    addedFromPool: poolIds.has(s.id) && !assignedIds.has(s.id),
  }));

  return {
    status,
    scheduledActivities,
    warnings,
    summary: parsed.summary ?? '',
  };
};

// ============================================================================
// SUGGEST DAY — fill a day from scratch
// ============================================================================

export type SuggestionSource = 'ASSIGNED' | 'USER_POOL' | 'GOOGLE_PLACES';

export interface DaySuggestion {
  // For ASSIGNED and USER_POOL — existing activity id
  activityId?: string;
  // For GOOGLE_PLACES — new activity to create on apply
  googlePlacesId?: string;
  name: string;
  type: string;
  location: string;
  suggestedTime: string | null;
  suggestedPosition: number;
  duration: number | null;
  timeConstraint: string;
  priority: string;
  reasoning: string;
  source: SuggestionSource;
}

export interface SuggestDayResult {
  status: 'success' | 'partial';
  theme: string;
  suggestions: DaySuggestion[];
  warnings: string[];
  summary: string;
}

interface PlaceForPrompt {
  googlePlacesId: string;
  name: string;
  type: string;
  location: string;
  rating?: number;
  openNow?: boolean;
}

interface ClaudeDaySuggestion {
  source: SuggestionSource;
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
  reasoning: string;
}

interface ClaudeSuggestResponse {
  theme: string;
  suggestions: ClaudeDaySuggestion[];
  warnings: string[];
  summary: string;
}

export interface DayPreferences {
  pace?: 'relaxed' | 'moderate' | 'packed';
  themes?: string[];           // e.g. ['museums', 'food', 'shopping', 'outdoor']
  includeMeals?: boolean;      // whether to schedule restaurants (default true)
  cuisinePreferences?: string[]; // e.g. ['mexican', 'vegetarian']
  budget?: 'budget' | 'moderate' | 'luxury';
  startTime?: string;          // HH:mm, default '09:00'
  endTime?: string;            // HH:mm, default '22:00'
}

export const suggestDay = async (
  options: {
    date: string;
    homestayName?: string;
    assignedActivities: ActivityResponse[];   // locked — schedule around these
    poolActivities: ActivityResponse[];        // user-entered, high priority candidates
    nearbyPlaces: PlaceForPrompt[];           // Google Places results to fill gaps
    minBreakMinutes?: number;
    groupByLocation?: boolean;
    preferences?: DayPreferences;
  }
): Promise<SuggestDayResult> => {
  const {
    date,
    homestayName,
    assignedActivities,
    poolActivities,
    nearbyPlaces,
    minBreakMinutes = 15,
    groupByLocation = true,
    preferences = {},
  } = options;

  const {
    pace = 'moderate',
    themes = [],
    includeMeals = true,
    cuisinePreferences = [],
    budget = 'moderate',
    startTime = '09:00',
    endTime = '22:00',
  } = preferences;

  // Build preference context for Claude
  const paceGuide = {
    relaxed: 'Keep the day light — 3 to 4 activities max, long breaks, no rushing. Quality over quantity.',
    moderate: 'Balanced day — 4 to 6 activities with reasonable breaks.',
    packed: 'Full day — fit in as much as possible while keeping it feasible. Minimize idle time.',
  }[pace];

  const budgetGuide = {
    budget: 'Prefer free or low-cost options. Avoid luxury venues.',
    moderate: 'Mix of affordable and mid-range options.',
    luxury: 'Prefer high-end, premium experiences. Do not suggest budget alternatives.',
  }[budget];

  const themeGuide = themes.length > 0
    ? `The user wants a ${themes.join(', ')} focused day. Prioritize activities that match these themes. When choosing between GOOGLE_PLACES options, strongly prefer ones that match.`
    : '';

  const mealGuide = includeMeals
    ? `Include restaurant breaks for relevant meal periods within ${startTime}–${endTime}.${cuisinePreferences.length > 0 ? ` The user prefers: ${cuisinePreferences.join(', ')}.` : ''}`
    : 'Do NOT include any restaurants or meal stops — the user will handle meals separately.';

  const systemPrompt = `You are a travel itinerary planner. Your job is to build a complete, enjoyable day schedule.

You will receive three tiers of activities, in priority order:
1. ASSIGNED — already on this day, must be included and scheduled around. Do not remove these.
2. USER_POOL — activities the user added to their wishlist but hasn't scheduled yet. Prefer these over Google Places results when they fit.
3. GOOGLE_PLACES — nearby places found via search. Use these to fill remaining gaps.

${homestayName ? `The user's base for the day is: ${homestayName}. Assume they start and end there.` : ''}

USER PREFERENCES:
- Pace: ${paceGuide}
- Budget: ${budgetGuide}
- Day runs: ${startTime} to ${endTime}
${themeGuide ? `- Theme: ${themeGuide}` : ''}
- Meals: ${mealGuide}

RULES:
1. All ASSIGNED activities must appear in suggestions exactly as-is (same id, same type).
2. USER_POOL activities should be included if they fit — prefer MUST_HAVE over NICE_TO_HAVE.
3. GOOGLE_PLACES fill gaps only — don't include if the day is already full.
4. Respect the pace setting strictly — do not overschedule a relaxed day or underschedule a packed day.
5. MORNING: ${startTime}–12:00, AFTERNOON: 12:00–17:00, EVENING: 17:00–${endTime}, ANYTIME: best fit.
6. Leave at least ${minBreakMinutes} minutes buffer between activities.
7. Default durations if unknown: RESTAURANT=90min, SIGHTSEEING=120min, ACTIVITY=60min, TRAVEL=30min.
${groupByLocation ? '8. Group geographically close activities together to minimize travel.' : ''}

OUTPUT FORMAT — respond with ONLY valid JSON, no markdown:
{
  "theme": "<short evocative day name, e.g. 'Chapultepec Day' or 'Coyoacan & Xochimilco'>",
  "suggestions": [
    {
      "source": "ASSIGNED" | "USER_POOL" | "GOOGLE_PLACES",
      "activityId": "<id if ASSIGNED or USER_POOL, omit for GOOGLE_PLACES>",
      "googlePlacesId": "<placeId if GOOGLE_PLACES, omit otherwise>",
      "name": "<place name>",
      "type": "RESTAURANT" | "SIGHTSEEING" | "ACTIVITY" | "TRAVEL",
      "location": "<address or area>",
      "suggestedTime": "<HH:mm or null>",
      "suggestedPosition": <1-based integer>,
      "duration": <minutes or null>,
      "timeConstraint": "SPECIFIC_TIME" | "MORNING" | "AFTERNOON" | "EVENING" | "ANYTIME",
      "priority": "MUST_HAVE" | "NICE_TO_HAVE" | "FLEXIBLE",
      "reasoning": "<one sentence>"
    }
  ],
  "warnings": ["<any concerns>"],
  "summary": "<2-3 sentence overview of the day>"
}`;

  const userMessage = `Please plan ${date}${homestayName ? ` (based at ${homestayName})` : ''}.

ASSIGNED (must include, schedule around these):
${assignedActivities.length > 0 ? JSON.stringify(assignedActivities.map((a) => ({
  activityId: a.id,
  source: 'ASSIGNED',
  name: a.name,
  type: a.type,
  location: a.location,
  timeConstraint: a.timeConstraint,
  currentTime: a.time,
  duration: a.duration,
  priority: a.priority,
  notes: a.notes,
})), null, 2) : '(none)'}

USER_POOL (wishlist — prefer these if they fit):
${poolActivities.length > 0 ? JSON.stringify(poolActivities.map((a) => ({
  activityId: a.id,
  source: 'USER_POOL',
  name: a.name,
  type: a.type,
  location: a.location,
  timeConstraint: a.timeConstraint,
  duration: a.duration,
  priority: a.priority,
  notes: a.notes,
})), null, 2) : '(none)'}

GOOGLE_PLACES (fill gaps with these if needed):
${nearbyPlaces.length > 0 ? JSON.stringify(nearbyPlaces.map((p) => ({
  googlePlacesId: p.googlePlacesId,
  source: 'GOOGLE_PLACES',
  name: p.name,
  type: p.type,
  location: p.location,
  rating: p.rating,
  openNow: p.openNow,
})), null, 2) : '(none)'}`;

  const message = await getClient().messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 4096,
    messages: [{ role: 'user', content: userMessage }],
    system: systemPrompt,
  });

  const rawText = message.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('');

  let parsed: ClaudeSuggestResponse;
  try {
    const cleaned = rawText.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`AI returned invalid JSON. Raw response: ${rawText.slice(0, 300)}`);
  }

  // Validate all ASSIGNED activities are present
  const assignedIds = new Set(assignedActivities.map((a) => a.id));
  const returnedIds = new Set(
    parsed.suggestions.filter((s) => s.activityId).map((s) => s.activityId!)
  );
  const missingAssigned = assignedActivities.filter((a) => !returnedIds.has(a.id));
  const status = missingAssigned.length > 0 ? 'partial' : 'success';
  const warnings = [...(parsed.warnings ?? [])];

  if (missingAssigned.length > 0) {
    warnings.push(
      `AI did not include ${missingAssigned.length} assigned activity(s) — they will be added back on apply.`
    );
  }

  return {
    status,
    theme: parsed.theme ?? '',
    suggestions: parsed.suggestions.map((s) => ({
      activityId: s.activityId,
      googlePlacesId: s.googlePlacesId,
      name: s.name,
      type: s.type,
      location: s.location,
      suggestedTime: s.suggestedTime,
      suggestedPosition: s.suggestedPosition,
      duration: s.duration,
      timeConstraint: s.timeConstraint,
      priority: s.priority,
      reasoning: s.reasoning,
      source: s.source,
    })),
    warnings,
    summary: parsed.summary ?? '',
  };
};

// ============================================================================
// SUGGEST FULL VACATION
// ============================================================================

export interface DayContext {
  dayId: string;
  date: string;
  homestayName?: string;
  assignedActivities: ActivityResponse[];
  nearbyPlaces?: Array<{
    googlePlacesId: string;
    name: string;
    type: string;
    location: string;
    rating?: number;
    openNow?: boolean;
  }>;
  preferences?: DayPreferences; // per-day override
}

export interface VacationSuggestOptions {
  vacationName: string;
  days: DayContext[];
  poolActivities: ActivityResponse[];     // shared across all days
  globalPreferences?: DayPreferences;
}

export interface DaySuggestionPlan {
  dayId: string;
  date: string;
  theme: string;        // e.g. "Chapultepec Day", "Coyoacan & Xochimilco"
  suggestions: DaySuggestion[];
  warnings: string[];
}

export interface SuggestVacationResult {
  status: 'success' | 'partial';
  days: DaySuggestionPlan[];
  warnings: string[];  // cross-day warnings
  summary: string;     // full vacation overview
}

interface ClaudeVacationResponse {
  days: Array<{
    dayId: string;
    date: string;
    theme: string;
    suggestions: ClaudeDaySuggestionVacation[];
    warnings: string[];
  }>;
  warnings: string[];
  summary: string;
}

interface ClaudeDaySuggestionVacation {
  source: SuggestionSource;
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
  reasoning: string;
}

// Rough token estimate to avoid oversized prompts
const estimateTokens = (text: string): number => Math.ceil(text.length / 4);
const MAX_PROMPT_TOKENS = 150000;

export const suggestVacation = async (
  options: VacationSuggestOptions
): Promise<SuggestVacationResult> => {
  const { vacationName, days, poolActivities, globalPreferences = {} } = options;

  const {
    pace = 'moderate',
    themes = [],
    includeMeals = true,
    cuisinePreferences = [],
    budget = 'moderate',
    startTime = '09:00',
    endTime = '22:00',
  } = globalPreferences;

  const paceGuide = {
    relaxed: 'Keep each day light — 3 to 4 activities max, long breaks, no rushing.',
    moderate: 'Balanced days — 4 to 6 activities with reasonable breaks.',
    packed: 'Full days — fit in as much as possible while keeping it feasible.',
  }[pace];

  const budgetGuide = {
    budget: 'Prefer free or low-cost options. Avoid luxury venues.',
    moderate: 'Mix of affordable and mid-range options.',
    luxury: 'Prefer high-end, premium experiences.',
  }[budget];

  const systemPrompt = `You are a travel itinerary planner. Plan a complete multi-day vacation itinerary.

GLOBAL PREFERENCES (apply to all days unless overridden):
- Pace: ${paceGuide}
- Budget: ${budgetGuide}
- Day runs: ${startTime} to ${endTime}
${themes.length > 0 ? `- Themes: ${themes.join(', ')} — weight activity selection toward these` : ''}
- Meals: ${includeMeals ? `Include restaurants for meal periods${cuisinePreferences.length > 0 ? `. Preferred cuisines: ${cuisinePreferences.join(', ')}` : ''}` : 'No restaurants — user handles meals separately'}

ACTIVITY TIERS (in priority order):
1. ASSIGNED — already on that day, must be included. Never move to a different day.
2. USER_POOL — user's wishlist. Distribute sensibly across days — don't pile everything on day 1. Each pool activity should appear on AT MOST one day.
3. GOOGLE_PLACES — nearby places. Only include if includePlaces data is provided and the day has gaps.

CROSS-DAY RULES:
- Vary the type of activities across days — avoid museum every day, restaurant type variation, etc.
- Consider travel fatigue — don't schedule the most demanding days back to back.
- If a day has a per-day preference override, it takes priority over global preferences for that day.
- Each pool activity can only be assigned to ONE day.

OUTPUT FORMAT — respond with ONLY valid JSON, no markdown:
{
  "days": [
    {
      "dayId": "<dayId>",
      "date": "<YYYY-MM-DD>",
      "theme": "<short evocative day name, e.g. 'Chapultepec Day' or 'Centro Historico & Markets'>",
      "suggestions": [
        {
          "source": "ASSIGNED" | "USER_POOL" | "GOOGLE_PLACES",
          "activityId": "<id if ASSIGNED or USER_POOL>",
          "googlePlacesId": "<id if GOOGLE_PLACES>",
          "name": "<name>",
          "type": "RESTAURANT" | "SIGHTSEEING" | "ACTIVITY" | "TRAVEL",
          "location": "<location>",
          "suggestedTime": "<HH:mm or null>",
          "suggestedPosition": <1-based integer within this day>,
          "duration": <minutes or null>,
          "timeConstraint": "SPECIFIC_TIME" | "MORNING" | "AFTERNOON" | "EVENING" | "ANYTIME",
          "priority": "MUST_HAVE" | "NICE_TO_HAVE" | "FLEXIBLE",
          "reasoning": "<one sentence>"
        }
      ],
      "warnings": ["<day-specific warnings>"]
    }
  ],
  "warnings": ["<cross-day warnings>"],
  "summary": "<3-5 sentence overview of the full vacation plan>"
}`;

  // Build per-day context blocks
  const dayBlocks = days.map((d) => {
    const dayPrefs = d.preferences ?? {};
    const overrideLines = Object.entries(dayPrefs)
      .map(([k, v]) => `  - ${k}: ${JSON.stringify(v)}`)
      .join('\n');

    return `DAY ${d.date} (id: ${d.dayId})${d.homestayName ? ` — based at ${d.homestayName}` : ''}:
${overrideLines ? `Per-day overrides:\n${overrideLines}` : ''}
Assigned (must include):
${d.assignedActivities.length > 0
  ? JSON.stringify(d.assignedActivities.map((a) => ({
      activityId: a.id,
      source: 'ASSIGNED',
      name: a.name,
      type: a.type,
      location: a.location,
      timeConstraint: a.timeConstraint,
      currentTime: a.time,
      duration: a.duration,
      priority: a.priority,
    })), null, 2)
  : '(none — fill this day from pool and places)'}
${d.nearbyPlaces && d.nearbyPlaces.length > 0
  ? `Nearby places (GOOGLE_PLACES candidates):\n${JSON.stringify(d.nearbyPlaces, null, 2)}`
  : ''}`;
  });

  const userMessage = `Plan the full vacation: "${vacationName}"

${dayBlocks.join('\n\n---\n\n')}

---

USER_POOL (wishlist — distribute across days, each used at most once):
${poolActivities.length > 0
  ? JSON.stringify(poolActivities.map((a) => ({
      activityId: a.id,
      source: 'USER_POOL',
      name: a.name,
      type: a.type,
      location: a.location,
      timeConstraint: a.timeConstraint,
      duration: a.duration,
      priority: a.priority,
      notes: a.notes,
    })), null, 2)
  : '(none)'}`;

  // Rough token check
  const promptTokens = estimateTokens(systemPrompt + userMessage);
  if (promptTokens > MAX_PROMPT_TOKENS) {
    throw new Error(
      `Vacation is too large for a single AI call (estimated ${promptTokens} tokens). ` +
      `Try planning fewer days at once or reducing the pool size.`
    );
  }

  const message = await getClient().messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 8192,
    messages: [{ role: 'user', content: userMessage }],
    system: systemPrompt,
  });

  const rawText = message.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('');

  let parsed: ClaudeVacationResponse;
  try {
    const cleaned = rawText.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`AI returned invalid JSON. Raw response: ${rawText.slice(0, 300)}`);
  }

  // Validate all assigned activities appear in their respective days
  const warnings: string[] = [...(parsed.warnings ?? [])];
  let allAssignedPresent = true;

  const resultDays: DaySuggestionPlan[] = parsed.days.map((d) => {
    const inputDay = days.find((id) => id.dayId === d.dayId);
    const assignedIds = new Set(inputDay?.assignedActivities.map((a) => a.id) ?? []);
    const returnedIds = new Set(
      d.suggestions.filter((s) => s.activityId).map((s) => s.activityId!)
    );
    const missing = [...assignedIds].filter((id) => !returnedIds.has(id));

    if (missing.length > 0) {
      allAssignedPresent = false;
      warnings.push(`Day ${d.date}: AI missed ${missing.length} assigned activity(s).`);
    }

    return {
      dayId: d.dayId,
      date: d.date,
      theme: d.theme ?? '',
      suggestions: d.suggestions.map((s) => ({
        activityId: s.activityId,
        googlePlacesId: s.googlePlacesId,
        name: s.name,
        type: s.type,
        location: s.location,
        suggestedTime: s.suggestedTime,
        suggestedPosition: s.suggestedPosition,
        duration: s.duration,
        timeConstraint: s.timeConstraint,
        priority: s.priority,
        reasoning: s.reasoning,
        source: s.source,
      })),
      warnings: d.warnings ?? [],
    };
  });

  // Check for pool activities used more than once
  const poolUsage = new Map<string, number>();
  resultDays.forEach((d) => {
    d.suggestions
      .filter((s) => s.source === 'USER_POOL' && s.activityId)
      .forEach((s) => {
        poolUsage.set(s.activityId!, (poolUsage.get(s.activityId!) ?? 0) + 1);
      });
  });
  const duplicatePool = [...poolUsage.entries()].filter(([, count]) => count > 1);
  if (duplicatePool.length > 0) {
    warnings.push(
      `AI scheduled ${duplicatePool.length} pool activity(s) on multiple days — duplicates removed on apply.`
    );
  }

  return {
    status: allAssignedPresent ? 'success' : 'partial',
    days: resultDays,
    warnings,
    summary: parsed.summary ?? '',
  };
};