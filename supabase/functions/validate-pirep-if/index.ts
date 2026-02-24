import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const IF_USER_STATS_ENDPOINT = Deno.env.get("IF_USER_STATS_ENDPOINT") || "";
const IF_USER_FLIGHTS_ENDPOINT = Deno.env.get("IF_USER_FLIGHTS_ENDPOINT") || "";
const IF_API_KEY = Deno.env.get("IF_API_KEY") || "";
const REQUEST_TIMEOUT_MS = Number(Deno.env.get("IF_REQUEST_TIMEOUT_MS") || "8000");
const MAX_RECENT_LOGS = 10;

interface ValidateInput {
  pirepId: string;
  pilotId: string;
  depIcao: string;
  arrIcao: string;
  ifcIdentifier: string;
}

interface ValidationResponse {
  validated: boolean;
  matchedFlights: unknown[];
  firstMatchedFlight: unknown | null;
  reason?: string;
  details?: Record<string, unknown>;
}

function normalizeAirportCode(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function getFlightsFromPayload(payload: unknown): Record<string, unknown>[] {
  if (!payload || typeof payload !== "object") return [];

  const data = payload as Record<string, unknown>;
  const candidates = [
    data.flights,
    data.logs,
    data.results,
    data.data,
    (data.result as Record<string, unknown> | undefined)?.flights,
    (data.result as Record<string, unknown> | undefined)?.logs,
    (data.user as Record<string, unknown> | undefined)?.flights,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.filter((item): item is Record<string, unknown> => !!item && typeof item === "object");
    }
  }

  return [];
}

function getResolvedUser(payload: unknown): { userId: string; discourseName?: string } | null {
  if (!payload || typeof payload !== "object") return null;

  const data = payload as Record<string, unknown>;
  const resultObj = data.result && typeof data.result === "object" ? data.result as Record<string, unknown> : null;
  const userObj = data.user && typeof data.user === "object" ? data.user as Record<string, unknown> : null;

  const userId = [
    data.userId,
    data.user_id,
    data.ifUserId,
    data.id,
    resultObj?.userId,
    resultObj?.user_id,
    resultObj?.id,
    userObj?.userId,
    userObj?.user_id,
    userObj?.id,
  ].find((value) => typeof value === "string" || typeof value === "number");

  if (userId === undefined) return null;

  const discourseName = [
    data.discourseName,
    data.discourse_name,
    data.username,
    resultObj?.discourseName,
    resultObj?.discourse_name,
    resultObj?.username,
    userObj?.discourseName,
    userObj?.discourse_name,
    userObj?.username,
  ].find((value) => typeof value === "string");

  return {
    userId: String(userId).trim(),
    discourseName: typeof discourseName === "string" ? discourseName.trim() : undefined,
  };
}

async function fetchWithTimeout(url: URL): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(IF_API_KEY ? { Authorization: `Bearer ${IF_API_KEY}` } : {}),
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

function buildUrl(endpoint: string, params: Record<string, string>): URL {
  const url = new URL(endpoint);
  Object.entries(params).forEach(([key, value]) => {
    if (value.trim()) url.searchParams.set(key, value.trim());
  });
  if (IF_API_KEY && !url.searchParams.has("apiKey")) {
    url.searchParams.set("apiKey", IF_API_KEY);
  }
  return url;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const baseResponse: ValidationResponse = {
    validated: false,
    matchedFlights: [],
    firstMatchedFlight: null,
  };

  try {
    if (!IF_USER_STATS_ENDPOINT || !IF_USER_FLIGHTS_ENDPOINT) {
      return Response.json(
        {
          ...baseResponse,
          reason: "IF validation service is not configured (missing IF_USER_STATS_ENDPOINT / IF_USER_FLIGHTS_ENDPOINT).",
        },
        { status: 200, headers: corsHeaders },
      );
    }

    const input = await req.json() as ValidateInput;
    const depIcao = normalizeAirportCode(input.depIcao);
    const arrIcao = normalizeAirportCode(input.arrIcao);
    const ifcIdentifier = String(input.ifcIdentifier ?? "").trim();

    if (!input.pirepId || !input.pilotId || !depIcao || !arrIcao || !ifcIdentifier) {
      return Response.json(
        {
          ...baseResponse,
          reason: "Missing required fields: pirepId, pilotId, depIcao, arrIcao, ifcIdentifier.",
        },
        { status: 200, headers: corsHeaders },
      );
    }

    const statsUrl = buildUrl(IF_USER_STATS_ENDPOINT, {
      identifier: ifcIdentifier,
      ifcIdentifier,
      discourseName: ifcIdentifier,
      pilotId: input.pilotId,
    });

    let statsResponse: Response;
    try {
      statsResponse = await fetchWithTimeout(statsUrl);
    } catch (error) {
      const reason = error instanceof DOMException && error.name === "AbortError"
        ? `User stats request timed out after ${REQUEST_TIMEOUT_MS}ms.`
        : `User stats request failed: ${String(error)}`;
      return Response.json({ ...baseResponse, reason }, { status: 200, headers: corsHeaders });
    }

    if (!statsResponse.ok) {
      return Response.json(
        {
          ...baseResponse,
          reason: `User stats endpoint returned ${statsResponse.status}.`,
          details: { status: statsResponse.status },
        },
        { status: 200, headers: corsHeaders },
      );
    }

    const statsPayload = await statsResponse.json().catch(() => ({}));
    const resolvedUser = getResolvedUser(statsPayload);

    if (!resolvedUser?.userId) {
      return Response.json(
        {
          ...baseResponse,
          reason: "No user found for provided IFC identifier.",
        },
        { status: 200, headers: corsHeaders },
      );
    }

    const flightsUrl = buildUrl(IF_USER_FLIGHTS_ENDPOINT, {
      userId: resolvedUser.userId,
      limit: String(MAX_RECENT_LOGS),
    });

    let flightsResponse: Response;
    try {
      flightsResponse = await fetchWithTimeout(flightsUrl);
    } catch (error) {
      const reason = error instanceof DOMException && error.name === "AbortError"
        ? `User flights request timed out after ${REQUEST_TIMEOUT_MS}ms.`
        : `User flights request failed: ${String(error)}`;
      return Response.json({ ...baseResponse, reason }, { status: 200, headers: corsHeaders });
    }

    if (!flightsResponse.ok) {
      return Response.json(
        {
          ...baseResponse,
          reason: `User flights endpoint returned ${flightsResponse.status}.`,
          details: { status: flightsResponse.status, userId: resolvedUser.userId },
        },
        { status: 200, headers: corsHeaders },
      );
    }

    const flightsPayload = await flightsResponse.json().catch(() => ({}));
    const flights = getFlightsFromPayload(flightsPayload).slice(0, MAX_RECENT_LOGS);

    if (flights.length === 0) {
      return Response.json(
        {
          ...baseResponse,
          reason: "No recent flight logs found for user.",
          details: { userId: resolvedUser.userId },
        },
        { status: 200, headers: corsHeaders },
      );
    }

    const matchedFlights = flights.filter((flight) => {
      const originAirport = normalizeAirportCode(
        flight.dep_icao ?? flight.depIcao ?? flight.originAirport ?? flight.origin ?? flight.departureAirport,
      );
      const destinationAirport = normalizeAirportCode(
        flight.arr_icao ?? flight.arrIcao ?? flight.destinationAirport ?? flight.destination ?? flight.arrivalAirport,
      );

      return depIcao === originAirport && arrIcao === destinationAirport;
    });

    return Response.json(
      {
        validated: matchedFlights.length > 0,
        matchedFlights,
        firstMatchedFlight: matchedFlights[0] ?? null,
        reason: matchedFlights.length > 0 ? undefined : "No matching IF logs found for the PIREP route.",
        details: {
          pirepId: input.pirepId,
          pilotId: input.pilotId,
          resolvedUserId: resolvedUser.userId,
          checkedLogs: flights.length,
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
