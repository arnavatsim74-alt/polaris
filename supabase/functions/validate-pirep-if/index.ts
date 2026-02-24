import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const IF_API_KEY = Deno.env.get("IF_API_KEY") || "";
const REQUEST_TIMEOUT_MS = Number(Deno.env.get("IF_REQUEST_TIMEOUT_MS") || "8000");
const MAX_RECENT_LOGS = 10;

const IF_LIVE_API_BASE = "https://api.infiniteflight.com/public/v2";

interface ValidateInput {
  pirepId: string;
  pilotId: string;
  depIcao: string;
  arrIcao: string;
  ifcIdentifier: string;
}

interface ValidationResponse {
  validated: boolean;
  matchedFlights: Record<string, unknown>[];
  firstMatchedFlight: Record<string, unknown> | null;
  reason?: string;
  details?: Record<string, unknown>;
}

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeAirport(value: unknown): string {
  return normalize(value).toUpperCase();
}

function parseJsonRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
}

function getStatsUserId(statsPayload: Record<string, unknown>): string {
  const candidates: unknown[] = [
    statsPayload.userId,
    statsPayload.user_id,
    statsPayload.id,
    (statsPayload.result as Record<string, unknown> | undefined)?.userId,
    (statsPayload.result as Record<string, unknown> | undefined)?.user_id,
    (statsPayload.result as Record<string, unknown> | undefined)?.id,
  ];

  const found = candidates.find((value) => typeof value === "string" || typeof value === "number");
  return found === undefined ? "" : normalize(found);
}

function getFlightsArray(payload: Record<string, unknown>): Record<string, unknown>[] {
  const candidates: unknown[] = [
    payload.result,
    payload.flights,
    payload.logs,
    payload.data,
    payload.results,
    (payload.result as Record<string, unknown> | undefined)?.flights,
    (payload.result as Record<string, unknown> | undefined)?.logs,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object");
    }
  }

  return [];
}

function matchRoute(
  flight: Record<string, unknown>,
  depIcao: string,
  arrIcao: string,
): boolean {
  const originAirport = normalizeAirport(
    flight.dep_icao ?? flight.depIcao ?? flight.originAirport ?? flight.origin,
  );
  const destinationAirport = normalizeAirport(
    flight.arr_icao ?? flight.arrIcao ?? flight.destinationAirport ?? flight.destination,
  );

  return originAirport === depIcao && destinationAirport === arrIcao;
}

async function fetchJsonWithTimeout(url: URL): Promise<{ response: Response; payload: Record<string, unknown> }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });

    const payload = parseJsonRecord(await response.json().catch(() => ({})));
    return { response, payload };
  } finally {
    clearTimeout(timeout);
  }
}

function buildLiveApiUrl(path: string, query: Record<string, string> = {}): URL {
  const url = new URL(`${IF_LIVE_API_BASE}${path}`);
  url.searchParams.set("apikey", IF_API_KEY);

  Object.entries(query).forEach(([key, value]) => {
    const trimmed = normalize(value);
    if (trimmed) url.searchParams.set(key, trimmed);
  });

  return url;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

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
    const pirepId = normalize(input.pirepId);
    const pilotId = normalize(input.pilotId);
    const depIcao = normalizeAirport(input.depIcao);
    const arrIcao = normalizeAirport(input.arrIcao);
    const ifcIdentifier = normalize(input.ifcIdentifier);

    if (!pirepId || !pilotId || !depIcao || !arrIcao || !ifcIdentifier) {
      return Response.json(
        { ...baseResponse, reason: "Missing required fields: pirepId, pilotId, depIcao, arrIcao, ifcIdentifier." },
        { status: 200, headers: corsHeaders },
      );
    }

    // IF guide endpoint: /users/{discourseNameOrUserId}/stats
    const userStatsUrl = buildLiveApiUrl(`/users/${encodeURIComponent(ifcIdentifier)}/stats`);

    let statsRes: Response;
    let statsPayload: Record<string, unknown>;

    try {
      ({ response: statsRes, payload: statsPayload } = await fetchJsonWithTimeout(userStatsUrl));
    } catch (error) {
      const isTimeout = error instanceof DOMException && error.name === "AbortError";
      return Response.json(
        { ...baseResponse, reason: isTimeout ? `User stats request timed out after ${REQUEST_TIMEOUT_MS}ms.` : `User stats request failed: ${String(error)}` },
        { status: 200, headers: corsHeaders },
      );
    }

    if (!statsRes.ok) {
      return Response.json(
        {
          ...baseResponse,
          reason: `User stats endpoint returned ${statsRes.status}.`,
          details: { status: statsRes.status, ifcIdentifier },
        },
        { status: 200, headers: corsHeaders },
      );
    }

    const resolvedUserId = getStatsUserId(statsPayload);
    if (!resolvedUserId) {
      return Response.json(
        { ...baseResponse, reason: "No user found for provided IFC identifier.", details: { ifcIdentifier } },
        { status: 200, headers: corsHeaders },
      );
    }

    // IF guide endpoint: /users/{discourseNameOrUserId}/flights
    const userFlightsUrl = buildLiveApiUrl(`/users/${encodeURIComponent(resolvedUserId)}/flights`);

    let flightsRes: Response;
    let flightsPayload: Record<string, unknown>;

    try {
      ({ response: flightsRes, payload: flightsPayload } = await fetchJsonWithTimeout(userFlightsUrl));
    } catch (error) {
      const isTimeout = error instanceof DOMException && error.name === "AbortError";
      return Response.json(
        { ...baseResponse, reason: isTimeout ? `User flights request timed out after ${REQUEST_TIMEOUT_MS}ms.` : `User flights request failed: ${String(error)}` },
        { status: 200, headers: corsHeaders },
      );
    }

    if (!flightsRes.ok) {
      return Response.json(
        {
          ...baseResponse,
          reason: `User flights endpoint returned ${flightsRes.status}.`,
          details: { status: flightsRes.status, resolvedUserId },
        },
        { status: 200, headers: corsHeaders },
      );
    }

    const flights = getFlightsArray(flightsPayload).slice(0, MAX_RECENT_LOGS);

    if (flights.length === 0) {
      return Response.json(
        {
          ...baseResponse,
          reason: "No recent flight logs found for user.",
          details: { resolvedUserId },
        },
        { status: 200, headers: corsHeaders },
      );
    }

    const matchedFlights = flights.filter((flight) => matchRoute(flight, depIcao, arrIcao));

    return Response.json(
      {
        validated: matchedFlights.length > 0,
        matchedFlights,
        firstMatchedFlight: matchedFlights[0] ?? null,
        reason: matchedFlights.length > 0 ? undefined : "No matching IF logs found for the PIREP route.",
        details: {
          pirepId,
          pilotId,
          ifcIdentifier,
          resolvedUserId,
          checkedLogs: flights.length,
          maxRecentLogs: MAX_RECENT_LOGS,
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
