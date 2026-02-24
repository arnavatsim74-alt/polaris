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

function isDigitsOnlyUpTo20(value: string): boolean {
  return /^\d{1,20}$/.test(value);
}

function pickFirstString(candidates: unknown[]): string {
  for (const candidate of candidates) {
    const value = normalize(candidate);
    if (value) return value;
  }
  return "";
}

function parseJsonRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
}

function getUsersArray(payload: Record<string, unknown>): Record<string, unknown>[] {
  const candidates: unknown[] = [
    payload.result,
    payload.results,
    payload.data,
    payload.users,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object");
    }
  }

  return [];
}

function getFlightsArray(payload: Record<string, unknown>): Record<string, unknown>[] {
  const candidates: unknown[] = [
    payload.result,
    payload.results,
    payload.data,
    payload.flights,
    payload.logs,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object");
    }
  }

  return [];
}

function matchRoute(flight: Record<string, unknown>, depIcao: string, arrIcao: string): boolean {
  const originAirport = normalizeAirport(
    flight.originAirport ?? flight.origin ?? flight.dep_icao ?? flight.depIcao,
  );
  const destinationAirport = normalizeAirport(
    flight.destinationAirport ?? flight.destination ?? flight.arr_icao ?? flight.arrIcao,
  );

  return originAirport === depIcao && destinationAirport === arrIcao;
}

function buildLiveApiUrl(path: string): URL {
  const url = new URL(`${IF_LIVE_API_BASE}${path}`);
  url.searchParams.set("apikey", IF_API_KEY);
  return url;
}

async function fetchJsonWithTimeout(url: URL, init: RequestInit): Promise<{ response: Response; payload: Record<string, unknown> }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${IF_API_KEY}`,
        ...(init.headers ?? {}),
      },
    });
    const payload = parseJsonRecord(await response.json().catch(() => ({})));
    return { response, payload };
  } finally {
    clearTimeout(timeout);
  }
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
    const pirepId = pickFirstString([input.pirepId, input.pirep_id]);
    const pilotId = pickFirstString([input.pilotId, input.pilot_id]);
    const depIcao = normalizeAirport(pickFirstString([input.depIcao, input.dep_icao]));
    const arrIcao = normalizeAirport(pickFirstString([input.arrIcao, input.arr_icao]));
    const ifcIdentifier = pickFirstString([
      input.ifcIdentifier,
      input.ifc_identifier,
      input.discourseName,
      input.discourse_name,
      input.ifcUsername,
    ]);
    const ifcCommunityId = pickFirstString([input.ifcCommunityId, input.ifc_community_id]);

    if (!depIcao || !arrIcao || (!ifcIdentifier && !ifcCommunityId)) {
      return Response.json(
        {
          ...baseResponse,
          reason: "Missing required fields: depIcao/dep_icao, arrIcao/arr_icao, and either ifcIdentifier (or discourseName/ifcUsername) or ifcCommunityId.",
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

    const usersLookupValue = ifcIdentifier || ifcCommunityId;

    // Official IF flow:
    // POST /users { discourseNames: ["delta737"] } -> userId
    const usersUrl = buildLiveApiUrl("/users");
    let usersRes: Response;
    let usersPayload: Record<string, unknown>;

    try {
      ({ response: usersRes, payload: usersPayload } = await fetchJsonWithTimeout(usersUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discourseNames: [usersLookupValue] }),
      }));
    } catch (error) {
      const isTimeout = error instanceof DOMException && error.name === "AbortError";
      return Response.json(
        {
          ...baseResponse,
          reason: isTimeout ? `Users lookup timed out after ${REQUEST_TIMEOUT_MS}ms.` : `Users lookup failed: ${String(error)}`,
        },
        { status: 200, headers: corsHeaders },
      );
    }

    if (!usersRes.ok) {
      return Response.json(
        {
          ...baseResponse,
          reason: `Users lookup endpoint returned ${usersRes.status}.`,
          details: { status: usersRes.status, usersLookupValue, ifcIdentifier, ifcCommunityId },
        },
        { status: 200, headers: corsHeaders },
      );
    }

    const users = getUsersArray(usersPayload);
    const resolvedUser = users[0] ?? {};
    const resolvedUserId = pickFirstString([resolvedUser.userId, resolvedUser.user_id, resolvedUser.id]);

    if (!resolvedUserId) {
      return Response.json(
        {
          ...baseResponse,
          reason: "No user found for provided IFC username.",
          details: { usersLookupValue, ifcIdentifier, ifcCommunityId, usersFound: users.length },
        },
        { status: 200, headers: corsHeaders },
      );
    }

    const flightsUrl = buildLiveApiUrl(`/users/${encodeURIComponent(resolvedUserId)}/flights`);
    let flightsRes: Response;
    let flightsPayload: Record<string, unknown>;

    try {
      ({ response: flightsRes, payload: flightsPayload } = await fetchJsonWithTimeout(flightsUrl, { method: "GET" }));
    } catch (error) {
      const isTimeout = error instanceof DOMException && error.name === "AbortError";
      return Response.json(
        {
          ...baseResponse,
          reason: isTimeout ? `User flights request timed out after ${REQUEST_TIMEOUT_MS}ms.` : `User flights request failed: ${String(error)}`,
          details: { resolvedUserId },
        },
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
          ifcCommunityId,
          usersLookupValue,
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
