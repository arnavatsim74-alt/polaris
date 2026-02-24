import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const IF_API_KEY = Deno.env.get("IF_API_KEY") || "";
const REQUEST_TIMEOUT_MS = Number(Deno.env.get("IF_REQUEST_TIMEOUT_MS") || "8000");
const IF_LIVE_API_BASE = "https://api.infiniteflight.com/public/v2";

// ---------------------------------------------------------------------------
// IF Live API response shapes (per official docs)
// ---------------------------------------------------------------------------

interface IFLiveAPIResponse<T> {
  errorCode: number; // 0 = Ok, 1 = UserNotFound, 2 = MissingRequestParameters, etc.
  result: T;
}

interface PaginatedList<T> {
  pageIndex: number;
  totalPages: number;
  totalCount: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
  data: T[];
}

interface UserFlight {
  id: string;
  created: string;
  userId: string;
  aircraftId: string;
  liveryId: string;
  callsign: string;
  server: string;
  dayTime: number;
  nightTime: number;
  totalTime: number;
  landingCount: number;
  originAirport: string | null;       // ICAO code, CAN BE NULL per docs
  destinationAirport: string | null;  // ICAO code, CAN BE NULL per docs
  xp: number;
  worldType: number; // 0=Solo,1=Casual,2=Training,3=Expert,4=Private
  violations: unknown[];
}

interface IFUser {
  userId: string;
  discourseUser?: {
    userId: number;
    username: string;
    virtualOrganization: string;
    avatarTemplate: string;
  };
}

// ---------------------------------------------------------------------------
// Input / Output shapes
// ---------------------------------------------------------------------------

interface ValidateInput {
  pirepId?: string;
  pirep_id?: string;
  pilotId?: string;
  pilot_id?: string;
  depIcao?: string;
  dep_icao?: string;
  arrIcao?: string;
  arr_icao?: string;
  ifcIdentifier?: string;
  ifc_identifier?: string;
  discourseName?: string;
  discourse_name?: string;
  ifcUsername?: string;
  ifcCommunityId?: string;
  ifc_community_id?: string;
  latestOnly?: boolean;
  latest_only?: boolean;
}

interface ValidationResponse {
  validated: boolean;
  matchedFlights: UserFlight[];
  firstMatchedFlight: UserFlight | null;
  latestFlight?: UserFlight | null;
  reason?: string;
  details?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeIcao(value: unknown): string {
  return normalize(value).toUpperCase();
}

function isDigitsOnlyUpTo20(value: string): boolean {
  return /^\d{1,20}$/.test(value);
}

function pickFirstString(candidates: unknown[]): string {
  for (const c of candidates) {
    const v = normalize(c);
    if (v) return v;
  }
  return "";
}

function buildLiveApiUrl(path: string): URL {
  const url = new URL(`${IF_LIVE_API_BASE}${path}`);
  url.searchParams.set("apikey", IF_API_KEY);
  return url;
}

async function fetchWithTimeout(url: URL, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${IF_API_KEY}`,
        ...(init.headers ?? {}),
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Match a flight using ONLY the two canonical IF field names.
 * Both fields can be null per the official docs — treat null as no-match.
 */
function matchRoute(flight: UserFlight, depIcao: string, arrIcao: string): boolean {
  if (!flight.originAirport || !flight.destinationAirport) return false;
  return (
    normalizeIcao(flight.originAirport) === depIcao &&
    normalizeIcao(flight.destinationAirport) === arrIcao
  );
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST")
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  const baseResponse: ValidationResponse = {
    validated: false,
    matchedFlights: [],
    firstMatchedFlight: null,
  };

  try {
    if (!IF_API_KEY) {
      return Response.json(
        { ...baseResponse, reason: "IF validation service is not configured (missing IF_API_KEY)." },
        { status: 200, headers: corsHeaders },
      );
    }

    const input = (await req.json()) as ValidateInput;

    const pirepId    = pickFirstString([input.pirepId, input.pirep_id]);
    const pilotId    = pickFirstString([input.pilotId, input.pilot_id]);
    const depIcao    = normalizeIcao(pickFirstString([input.depIcao, input.dep_icao]));
    const arrIcao    = normalizeIcao(pickFirstString([input.arrIcao, input.arr_icao]));
    const latestOnly = Boolean(input.latestOnly ?? input.latest_only);
    const ifcIdentifier = pickFirstString([
      input.ifcIdentifier,
      input.ifc_identifier,
      input.discourseName,
      input.discourse_name,
      input.ifcUsername,
    ]);
    const ifcCommunityId = pickFirstString([input.ifcCommunityId, input.ifc_community_id]);

    if ((!latestOnly && (!depIcao || !arrIcao)) || (!ifcIdentifier && !ifcCommunityId)) {
      return Response.json(
        {
          ...baseResponse,
          reason: latestOnly
            ? "Missing required fields: either ifcIdentifier (or discourseName/ifcUsername) or ifcCommunityId."
            : "Missing required fields: depIcao/dep_icao, arrIcao/arr_icao, and either ifcIdentifier (or discourseName/ifcUsername) or ifcCommunityId.",
          details: { receivedKeys: Object.keys(input ?? {}) },
        },
        { status: 200, headers: corsHeaders },
      );
    }

    if (ifcCommunityId && !isDigitsOnlyUpTo20(ifcCommunityId)) {
      return Response.json(
        {
          ...baseResponse,
          reason: "Infinite Flight Community ID must contain digits only (up to 20 characters).",
          details: { ifcCommunityId },
        },
        { status: 200, headers: corsHeaders },
      );
    }

    // -----------------------------------------------------------------------
    // Step 1: Resolve IF userId
    // POST /public/v2/users  { discourseNames: ["username"] }
    // Response: { errorCode: 0, result: [{ userId, discourseUser }] }
    // -----------------------------------------------------------------------
    let resolvedUserId = "";

    if (ifcCommunityId) {
      // IFC community numeric ID == IF userId — no lookup needed.
      resolvedUserId = ifcCommunityId;
    } else {
      const usersUrl = buildLiveApiUrl("/users");
      let usersRaw: Response;

      try {
        usersRaw = await fetchWithTimeout(usersUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ discourseNames: [ifcIdentifier] }),
        });
      } catch (error) {
        const isTimeout = error instanceof DOMException && error.name === "AbortError";
        return Response.json(
          {
            ...baseResponse,
            reason: isTimeout
              ? `Users lookup timed out after ${REQUEST_TIMEOUT_MS}ms.`
              : `Users lookup failed: ${String(error)}`,
          },
          { status: 200, headers: corsHeaders },
        );
      }

      if (!usersRaw.ok) {
        return Response.json(
          {
            ...baseResponse,
            reason: `Users lookup endpoint returned HTTP ${usersRaw.status}.`,
            details: { status: usersRaw.status, ifcIdentifier },
          },
          { status: 200, headers: corsHeaders },
        );
      }

      const usersEnvelope = await usersRaw.json().catch(() => null) as IFLiveAPIResponse<IFUser[]> | null;

      if (!usersEnvelope || usersEnvelope.errorCode !== 0) {
        return Response.json(
          {
            ...baseResponse,
            reason: `IF Users API returned errorCode ${usersEnvelope?.errorCode ?? "unknown"}.`,
            details: { ifcIdentifier, errorCode: usersEnvelope?.errorCode },
          },
          { status: 200, headers: corsHeaders },
        );
      }

      const users = Array.isArray(usersEnvelope.result) ? usersEnvelope.result : [];
      resolvedUserId = users[0]?.userId ?? "";

      if (!resolvedUserId) {
        return Response.json(
          {
            ...baseResponse,
            reason: "No Infinite Flight user found for the provided IFC username.",
            details: { ifcIdentifier, usersFound: users.length },
          },
          { status: 200, headers: corsHeaders },
        );
      }
    }

    // -----------------------------------------------------------------------
    // Step 2: Fetch flight logbook — page 1 only (newest flights first)
    // GET /public/v2/users/{userId}/flights?page=1
    // Response: { errorCode: 0, result: { pageIndex, totalPages, totalCount, data: [UserFlight] } }
    // -----------------------------------------------------------------------
    const flightsUrl = buildLiveApiUrl(`/users/${encodeURIComponent(resolvedUserId)}/flights`);
    flightsUrl.searchParams.set("page", "1");

    let flightsRaw: Response;

    try {
      flightsRaw = await fetchWithTimeout(flightsUrl, { method: "GET" });
    } catch (error) {
      const isTimeout = error instanceof DOMException && error.name === "AbortError";
      return Response.json(
        {
          ...baseResponse,
          reason: isTimeout
            ? `Flights request timed out after ${REQUEST_TIMEOUT_MS}ms.`
            : `Flights request failed: ${String(error)}`,
          details: { resolvedUserId },
        },
        { status: 200, headers: corsHeaders },
      );
    }

    if (!flightsRaw.ok) {
      return Response.json(
        {
          ...baseResponse,
          reason: `Flights endpoint returned HTTP ${flightsRaw.status}.`,
          details: { status: flightsRaw.status, resolvedUserId },
        },
        { status: 200, headers: corsHeaders },
      );
    }

    const flightsEnvelope = await flightsRaw.json().catch(() => null) as IFLiveAPIResponse<PaginatedList<UserFlight>> | null;

    if (!flightsEnvelope || flightsEnvelope.errorCode !== 0) {
      return Response.json(
        {
          ...baseResponse,
          reason: `IF Flights API returned errorCode ${flightsEnvelope?.errorCode ?? "unknown"}.`,
          details: { resolvedUserId, errorCode: flightsEnvelope?.errorCode },
        },
        { status: 200, headers: corsHeaders },
      );
    }

    // Flights live at result.data — NOT at result directly
    const flights: UserFlight[] = flightsEnvelope.result?.data ?? [];

    if (flights.length === 0) {
      return Response.json(
        {
          ...baseResponse,
          reason: "No recent flight logs found for this user.",
          details: {
            resolvedUserId,
            totalCount: flightsEnvelope.result?.totalCount ?? 0,
          },
        },
        { status: 200, headers: corsHeaders },
      );
    }

    if (latestOnly) {
      return Response.json(
        {
          ...baseResponse,
          latestFlight: flights[0] ?? null,
          details: {
            pirepId,
            pilotId,
            ifcIdentifier,
            ifcCommunityId,
            resolvedUserId,
            pageChecked: 1,
            flightsOnPage: flights.length,
            totalFlights: flightsEnvelope.result?.totalCount ?? 0,
          },
        } satisfies ValidationResponse,
        { status: 200, headers: corsHeaders },
      );
    }

    // -----------------------------------------------------------------------
    // Step 3: Match originAirport / destinationAirport (ICAO, may be null)
    // -----------------------------------------------------------------------
    const matchedFlights = flights.filter((f) => matchRoute(f, depIcao, arrIcao));

    // On failure: surface what IF actually returned so mismatches are obvious
    const debugCheckedRoutes =
      matchedFlights.length === 0
        ? flights.slice(0, 10).map((f) => ({
            originAirport: f.originAirport ?? null,
            destinationAirport: f.destinationAirport ?? null,
          }))
        : undefined;

    return Response.json(
      {
        validated: matchedFlights.length > 0,
        matchedFlights,
        firstMatchedFlight: matchedFlights[0] ?? null,
        reason:
          matchedFlights.length > 0
            ? undefined
            : "No matching Infinite Flight logs found for this route.",
        details: {
          pirepId,
          pilotId,
          ifcIdentifier,
          ifcCommunityId,
          resolvedUserId,
          queriedRoute: { depIcao, arrIcao },
          pageChecked: 1,
          flightsOnPage: flights.length,
          totalFlights: flightsEnvelope.result?.totalCount ?? 0,
          ...(debugCheckedRoutes ? { debugCheckedRoutes } : {}),
        },
      } satisfies ValidationResponse,
      { status: 200, headers: corsHeaders },
    );
  } catch (error) {
    return Response.json(
      {
        ...baseResponse,
        reason: `Unexpected validation error: ${String(error)}`,
      },
      { status: 200, headers: corsHeaders },
    );
  }
});
