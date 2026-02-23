import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import nacl from "npm:tweetnacl@1.0.3";
import { createClient } from "npm:@supabase/supabase-js@2.49.4";

// ─── Env ──────────────────────────────────────────────────────────────────────
const DISCORD_PUBLIC_KEY        = Deno.env.get("DISCORD_PUBLIC_KEY") || "";
const DISCORD_BOT_TOKEN         = Deno.env.get("DISCORD_BOT_TOKEN") || "";
const DISCORD_REGISTER_SECRET   = Deno.env.get("DISCORD_REGISTER_SECRET") || "";
const FRONTEND_URL              = Deno.env.get("FRONTEND_URL") || "";
const SUPABASE_URL              = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

if (!DISCORD_PUBLIC_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing env vars. Required: DISCORD_PUBLIC_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY");
}

// ─── Constants ────────────────────────────────────────────────────────────────
const RECRUITMENTS_CHANNEL_ID                   = "1474299044091265096";
const RECRUITMENTS_CATEGORY_ID                  = "1426656419758870693";
const RECRUITMENT_BUTTON_CUSTOM_ID              = "recruitment_fly_high";
const RECRUITMENT_CALLSIGN_BUTTON_PREFIX        = "recruitment_set_callsign:";
const RECRUITMENT_CALLSIGN_MODAL_PREFIX         = "recruitment_callsign_modal:";
const RECRUITMENT_PRACTICAL_READY_PREFIX        = "recruitment_practical_ready:";
const RECRUITMENT_PRACTICAL_CONFIRM_PREFIX      = "recruitment_practical_confirm:";
const RECRUITMENT_PRACTICAL_REVIEW_PREFIX       = "recruitment_practical_review:";
const RECRUITMENT_PRACTICAL_REVIEW_MODAL_PREFIX = "recruitment_practical_review_modal:";
const RECRUITMENT_PRACTICAL_REVIEWER_ROLE_ID    = "1427942885004808263";
const RECRUITMENT_STAFF_ROLE_ID                 = "1427942885004808263";
const ROLE_IDS_ON_PRACTICAL_PASS_ADD    = ["1427945161840787518", "1427945314077118474", "1427945404514963506"] as const;
const ROLE_IDS_ON_PRACTICAL_PASS_REMOVE = ["1432355201326518373", "1427947293427892234"] as const;

const COLORS = { BLUE: 0x3498db, GREEN: 0x2ecc71, RED: 0xe74c3c, ORANGE: 0xe67e22 } as const;

// Shared practical task list (avoids duplication between embed and DB notes)
const PRACTICAL_TASKS = [
  "1. Spawn at any gate at UUBW.",
  "2. Taxi to RWY 30.",
  "3. Depart straight and transition to UUDD pattern for RWY 32L.",
  "4. Touch and go with proper UNICOM use.",
  "5. Transition to UUDD RWY 32R downwind.",
  "6. Touch and go, then depart to the northwest.",
  '7. Proceed direct "MR" Moscow Shr. VOR.',
  "8. Transition to pattern for landing at any runway at UUEE.",
  "9. Land, park, and exit.",
  "> **Note - You are pilot currently Provisional Pilot. you can fly for AFLV Any time and any route under the cadet rank.**",
];

// ─── Supabase ─────────────────────────────────────────────────────────────────
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// ─── Response helpers ─────────────────────────────────────────────────────────

/** Ephemeral (user-only) plain-text reply */
const ephemeralReply = (content: string) =>
  Response.json({ type: 4, data: { content, flags: 64 } });

/** Embed response, optionally ephemeral */
const embedResponse = ({
  title, description, color, fields, imageUrl, ephemeral = false,
}: {
  title: string; description: string; color: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  imageUrl?: string; ephemeral?: boolean;
}) =>
  Response.json({
    type: 4,
    data: {
      embeds: [{ title, description, color, fields, image: imageUrl ? { url: imageUrl } : undefined, timestamp: new Date().toISOString() }],
      ...(ephemeral ? { flags: 64 } : {}),
    },
  });

/** Wrap buttons into a Discord action row */
const actionRow = (...components: object[]) => ({ type: 1, components });

/** Build a single type-2 button */
const btn = (style: number, custom_id: string, label: string) => ({ type: 2, style, custom_id, label });

// ─── Discord helpers ──────────────────────────────────────────────────────────
const toHexBytes = (value: string) => {
  const bytes = new Uint8Array(value.length / 2);
  for (let i = 0; i < value.length; i += 2) bytes[i / 2] = parseInt(value.slice(i, i + 2), 16);
  return bytes;
};

const verifyDiscordRequest = async (req: Request, rawBody: string) => {
  const signature = req.headers.get("x-signature-ed25519");
  const timestamp = req.headers.get("x-signature-timestamp");
  if (!signature || !timestamp || !DISCORD_PUBLIC_KEY) return false;
  return nacl.sign.detached.verify(
    new TextEncoder().encode(timestamp + rawBody),
    toHexBytes(signature),
    toHexBytes(DISCORD_PUBLIC_KEY),
  );
};

const discordApi = async (path: string, init: RequestInit = {}) => {
  if (!DISCORD_BOT_TOKEN) throw new Error("Missing DISCORD_BOT_TOKEN");
  return fetch(`https://discord.com/api/v10${path}`, {
    ...init,
    headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
};

const discordJson = async (res: Response) => res.json().catch(() => ({}));

const getGuildIdFromChannel = async (channelId: string) => {
  if (!channelId) return null;
  const res     = await discordApi(`/channels/${channelId}`, { method: "GET" });
  const payload = await discordJson(res);
  return res.ok ? (String(payload?.guild_id || "") || null) : null;
};

// ─── Interaction user helpers ─────────────────────────────────────────────────
const getDiscordUser = (body: any) => ({
  id:       (body.member?.user?.id       || body.user?.id       || null) as string | null,
  username: (body.member?.user?.username || body.user?.username || null) as string | null,
});

const assertReviewer = (body: any) =>
  (body.member?.roles || []).includes(RECRUITMENT_PRACTICAL_REVIEWER_ROLE_ID);

// ─── Generic utils ────────────────────────────────────────────────────────────
const parseOptions = (options: any[] = []) => {
  const map: Record<string, any> = {};
  for (const opt of options) map[opt.name] = opt.value;
  return map;
};

const toDiscordDate = (iso: string) => `<t:${Math.floor(new Date(iso).getTime() / 1000)}:f>`;

const getCurrentWeekStartISO = () => {
  const now = new Date();
  const dow = (now.getDay() + 6) % 7;
  now.setDate(now.getDate() - dow);
  now.setHours(0, 0, 0, 0);
  return now.toISOString().slice(0, 10);
};

const titleCaseRank = (rank: string | null | undefined) =>
  rank ? rank.replace(/_/g, " ").split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") : "Unknown";

const readModalInput = (body: any, customId: string) => {
  for (const row of body.data?.components || [])
    for (const comp of row.components || [])
      if (comp.custom_id === customId) return String(comp.value || "");
  return "";
};

// ─── Supabase helpers ─────────────────────────────────────────────────────────
const getSiteSetting = async (key: string) => {
  const { data } = await supabase.from("site_settings").select("value").eq("key", key).maybeSingle();
  return data?.value ?? null;
};

const getOperators = async () => {
  const raw = (await getSiteSetting("pirep_operators")) || "RAM,SU,ATR";
  return raw.split(",").map((x: string) => x.trim()).filter(Boolean).slice(0, 25);
};

const searchAircraft = async (query: string) => {
  let req = supabase.from("aircraft").select("icao_code,name,livery").order("icao_code").limit(25);
  const q = query.trim();
  if (q) req = req.or(`icao_code.ilike.%${q}%,name.ilike.%${q}%`);
  const { data, error } = await req;
  if (error) { console.error("Failed to fetch aircraft for autocomplete", error); return []; }
  return data || [];
};

const getMultipliers = async () => {
  const { data } = await supabase.from("multiplier_configs").select("name,value").eq("is_active", true).order("value", { ascending: true });
  return (data || [])
    .map((m: any) => ({ name: String(m.name || "").trim(), value: Number(m.value || 1) }))
    .filter((m: any) => m.name && Number.isFinite(m.value))
    .slice(0, 25);
};

const resolveMultiplierValue = async (input: string | null | undefined) => {
  if (!input) return 1;
  const s = String(input).trim();
  if (!s) return 1;
  const n = Number(s);
  if (Number.isFinite(n) && n > 0) return n;
  const multipliers = await getMultipliers();
  return (
    multipliers.find((m: any) => m.name.toLowerCase() === s.toLowerCase())?.value ||
    multipliers.find((m: any) => `${m.name} (${m.value.toFixed(1)}x)`.toLowerCase() === s.toLowerCase())?.value ||
    1
  );
};

const resolvePilotByDiscordUser = async (discordUserId: string, discordUsername?: string | null) => {
  const { data: authUserId, error } = await supabase.rpc("get_auth_user_id_by_discord", { p_discord_user_id: discordUserId });
  if (error) throw error;
  if (authUserId) {
    const { data } = await supabase.from("pilots").select("id,pid,full_name").eq("user_id", authUserId).maybeSingle();
    if (data?.id) return data;
  }
  const { data: legacy } = await supabase.from("pilots").select("id,pid,full_name").eq("discord_user_id", discordUserId).maybeSingle();
  if (legacy?.id) return legacy;
  if (discordUsername) {
    const normalized = String(discordUsername).replace(/^@+/, "").trim();
    const { data } = await supabase.from("pilots").select("id,pid,full_name").ilike("discord_username", normalized).maybeSingle();
    if (data?.id) return data;
  }
  return null;
};

const getPilotFromInteraction = (body: any) => {
  const { id, username } = getDiscordUser(body);
  return id ? resolvePilotByDiscordUser(id, username) : Promise.resolve(null);
};

// ─── Gate assignment ──────────────────────────────────────────────────────────
const pickGate = (available: string[] | null, used: Set<string>) => {
  if (!available?.length) return null;
  return available.find((g) => !!g && !used.has(g)) || available[0] || null;
};

const joinEventWithFallback = async (eventId: string, pilotId: string, discordUserId?: string | null) => {
  const { data: existing } = await supabase
    .from("event_registrations").select("assigned_dep_gate,assigned_arr_gate")
    .eq("event_id", eventId).eq("pilot_id", pilotId).maybeSingle();

  const patchDiscordId = () => discordUserId
    ? supabase.from("event_registrations").update({ discord_user_id: discordUserId })
        .eq("event_id", eventId).eq("pilot_id", pilotId).is("discord_user_id", null)
    : Promise.resolve();

  if (existing) { await patchDiscordId(); return existing; }

  const { data: rpcData, error: rpcError } = await supabase.rpc("register_for_event", { p_event_id: eventId, p_pilot_id: pilotId });
  if (!rpcError) { await patchDiscordId(); return rpcData; }
  if (!String(rpcError.message || "").toLowerCase().includes("not allowed")) throw rpcError;

  const { data: event, error: eventErr } = await supabase.from("events").select("available_dep_gates,available_arr_gates").eq("id", eventId).maybeSingle();
  if (eventErr || !event) throw rpcError;

  const { data: regs, error: regsErr } = await supabase.from("event_registrations").select("assigned_dep_gate,assigned_arr_gate").eq("event_id", eventId);
  if (regsErr) throw regsErr;

  const usedDep = new Set((regs || []).map((r: any) => r.assigned_dep_gate).filter(Boolean));
  const usedArr = new Set((regs || []).map((r: any) => r.assigned_arr_gate).filter(Boolean));

  const { data: inserted, error: insertErr } = await supabase.from("event_registrations")
    .insert({ event_id: eventId, pilot_id: pilotId, registered_at: new Date().toISOString(), discord_user_id: discordUserId || null, assigned_dep_gate: pickGate((event as any).available_dep_gates || null, usedDep), assigned_arr_gate: pickGate((event as any).available_arr_gates || null, usedArr) })
    .select("assigned_dep_gate,assigned_arr_gate").maybeSingle();
  if (insertErr) throw insertErr;
  return inserted;
};

// ─── Command handlers ─────────────────────────────────────────────────────────
const handlePirep = async (body: any) => {
  const options = parseOptions(body.data?.options || []);
  const pilot   = await getPilotFromInteraction(body);
  if (!pilot?.id) {
    return embedResponse({ title: "PIREP Filing Failed", description: "No pilot profile is linked to your Discord account. Sign in on the VA site with Discord (or set Discord username in profile settings).", color: COLORS.RED });
  }

  const multiplierValue      = await resolveMultiplierValue(options.multiplier);
  const selectedAircraftIcao = String(options.aircraft || "").toUpperCase();
  const { data: selectedAircraft } = await supabase.from("aircraft").select("icao_code,livery").eq("icao_code", selectedAircraftIcao).maybeSingle();
  const aircraftWithLivery   = `${selectedAircraftIcao}${selectedAircraft?.livery ? ` (${selectedAircraft.livery})` : ""}`;

  const { error } = await supabase.from("pireps").insert({
    flight_number: String(options.flight_number || "").toUpperCase(),
    dep_icao:      String(options.dep_icao      || "").toUpperCase(),
    arr_icao:      String(options.arr_icao      || "").toUpperCase(),
    operator:      String(options.operator      || ""),
    aircraft_icao: selectedAircraftIcao,
    flight_type:   String(options.flight_type   || "passenger"),
    flight_hours:  Number(options.flight_hours  || 0),
    flight_date:   options.flight_date           || new Date().toISOString().slice(0, 10),
    multiplier:    multiplierValue,
    pilot_id:      pilot.id,
    status:        "pending",
  });

  if (error) return embedResponse({ title: "PIREP Filing Failed", description: error.message, color: COLORS.RED });

  return embedResponse({
    title: "PIREP Filed Successfully",
    description: `**${String(options.flight_number).toUpperCase()}** • ${String(options.dep_icao).toUpperCase()} → ${String(options.arr_icao).toUpperCase()}`,
    color: COLORS.GREEN,
    fields: [
      { name: "Pilot",      value: pilot.full_name,                                    inline: true },
      { name: "Aircraft",   value: aircraftWithLivery || "N/A",                        inline: true },
      { name: "Operator",   value: String(options.operator || "N/A"),                  inline: true },
      { name: "Hours",      value: `${Number(options.flight_hours || 0).toFixed(1)}h`, inline: true },
      { name: "Multiplier", value: `${multiplierValue.toFixed(1)}x`,                  inline: true },
      { name: "Status",     value: "Pending Review",                                   inline: true },
    ],
  });
};

const handleGetEvents = async () => {
  const now   = new Date();
  const until = new Date(now);
  until.setDate(until.getDate() + 2);

  const { data: events } = await supabase.from("events")
    .select("id,name,description,start_time,end_time,server,dep_icao,arr_icao,banner_url,aircraft_icao,aircraft_name")
    .eq("is_active", true).gte("start_time", now.toISOString()).lte("start_time", until.toISOString())
    .order("start_time", { ascending: true }).limit(5);

  if (!events?.length) return embedResponse({ title: "Upcoming Events", description: "No events scheduled in the next 2 days.", color: COLORS.BLUE });

  const icaos = [...new Set((events || []).map((e: any) => String(e?.aircraft_icao || "").trim().toUpperCase()).filter(Boolean))];
  const liveryByIcao = new Map<string, string>();
  if (icaos.length) {
    const { data: rows } = await supabase.from("aircraft").select("icao_code,livery").in("icao_code", icaos).not("livery", "is", null);
    for (const row of rows || []) {
      const icao  = String((row as any).icao_code || "").trim().toUpperCase();
      const livery = String((row as any).livery   || "").trim();
      if (icao && livery && !liveryByIcao.has(icao)) liveryByIcao.set(icao, livery);
    }
  }

  const embeds = events.map((event: any) => {
    const icao   = String(event?.aircraft_icao || "").trim().toUpperCase();
    const name   = String(event?.aircraft_name || "").trim();
    const livery = liveryByIcao.get(icao);
    const aircraftDisplay = name ? name : icao ? `${icao}${livery ? ` (${livery})` : ""}` : "Any";
    return {
      title: `✈️ ${event.name}`,
      description: event.description || "Join this upcoming community event.",
      color: COLORS.BLUE,
      fields: [
        { name: "Route",    value: `${event.dep_icao} → ${event.arr_icao}`, inline: true },
        { name: "Server",   value: event.server,                            inline: true },
        { name: "Start",    value: toDiscordDate(event.start_time),         inline: false },
        { name: "End",      value: toDiscordDate(event.end_time),           inline: false },
        { name: "Aircraft", value: aircraftDisplay,                         inline: true },
      ],
      image: event.banner_url ? { url: event.banner_url } : undefined,
      footer: { text: "Use the Participate button below to auto-assign your gates." },
    };
  });

  const components = events.map((event: any) =>
    actionRow(btn(1, `event_join:${event.id}`, `Participate • ${event.dep_icao}-${event.arr_icao}`.slice(0, 80)))
  );

  return Response.json({ type: 4, data: { embeds, components } });
};

const handleLeaderboard = async () => {
  const { data: pilots, error } = await supabase.from("pilots").select("pid,full_name,total_hours,current_rank").order("total_hours", { ascending: false }).limit(5);
  if (error)           return embedResponse({ title: "Leaderboard Error", description: error.message,     color: COLORS.RED  });
  if (!pilots?.length) return embedResponse({ title: "Leaderboard",       description: "No pilots found.", color: COLORS.BLUE });
  const lines = pilots.map((p: any, i: number) =>
    `${i + 1}. **${p.full_name}** (${p.pid}) • ${titleCaseRank(p.current_rank)} • ${Number(p.total_hours || 0).toFixed(1)}h`
  ).join("\n");
  return embedResponse({ title: "🏆 Top 5 Pilot Leaderboard", description: lines, color: COLORS.BLUE });
};

const handleChallengeList = async () => {
  const { data: challenges } = await supabase.from("challenges").select("id,name,description,destination_icao,image_url").eq("is_active", true).order("created_at", { ascending: false }).limit(5);
  if (!challenges?.length) return embedResponse({ title: "Challenges", description: "No active challenges right now.", color: COLORS.BLUE });
  const embeds     = challenges.map((c: any) => ({ title: `🎯 ${c.name}`, description: c.description || "Community challenge", color: COLORS.BLUE, fields: c.destination_icao ? [{ name: "Destination", value: c.destination_icao, inline: true }] : [], image: c.image_url ? { url: c.image_url } : undefined }));
  const components = challenges.map((c: any) => actionRow(btn(1, `challenge_accept:${c.id}`, "Participate")));
  return Response.json({ type: 4, data: { embeds, components } });
};

const notamColor = (priority: string | null | undefined) => {
  const p = String(priority || "").toLowerCase();
  if (p.includes("urgent") || p.includes("important")) return COLORS.RED;
  if (p.includes("warning")) return COLORS.ORANGE;
  return COLORS.BLUE;
};

const handleNotams = async () => {
  const nowIso = new Date().toISOString();
  const { data: notams } = await supabase.from("notams").select("title,content,priority").eq("is_active", true).or(`expires_at.is.null,expires_at.gte.${nowIso}`).order("created_at", { ascending: false }).limit(8);
  if (!notams?.length) return embedResponse({ title: "NOTAMs", description: "No active NOTAMs.", color: COLORS.BLUE });
  const embeds = notams.map((n: any) => ({ title: `📢 ${n.title}`, description: String(n.content || "").slice(0, 350), color: notamColor(n.priority), fields: [{ name: "Priority", value: String(n.priority || "info").toUpperCase(), inline: true }] }));
  return Response.json({ type: 4, data: { embeds } });
};

const handleRotw = async () => {
  const { data: rotw } = await supabase.from("routes_of_week").select("day_of_week,route:routes(route_number,dep_icao,arr_icao,aircraft_icao,livery,est_flight_time_minutes)").eq("week_start", getCurrentWeekStartISO()).order("day_of_week", { ascending: true });
  if (!rotw?.length) return embedResponse({ title: "Routes of the Week", description: "No routes are configured for this week.", color: COLORS.BLUE });
  const days  = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const lines = rotw.map((r: any) => {
    const route = Array.isArray(r.route) ? r.route[0] : r.route;
    const dur   = route?.est_flight_time_minutes ? `${Math.floor(route.est_flight_time_minutes / 60)}:${String(route.est_flight_time_minutes % 60).padStart(2, "0")}` : "N/A";
    return `**${days[r.day_of_week] || "Day"}** — **${route?.route_number || "N/A"}** | ${route?.dep_icao || "----"} → ${route?.arr_icao || "----"} | ${route?.aircraft_icao || "N/A"}${route?.livery ? ` (${route.livery})` : ""} | ${dur}`;
  });
  return embedResponse({ title: "🗺️ Routes of the Week", description: lines.join("\n"), color: COLORS.BLUE });
};

const handleFeatured = async () => {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase.from("daily_featured_routes").select("route:routes(route_number,dep_icao,arr_icao,aircraft_icao,livery)").eq("featured_date", today).limit(5);
  if (!data?.length) return embedResponse({ title: "Featured Routes", description: "No featured routes for today.", color: COLORS.BLUE });
  const lines = data.map((item: any) => {
    const route = Array.isArray(item.route) ? item.route[0] : item.route;
    return `• **${route?.route_number || "N/A"}** ${route?.dep_icao || "----"} → ${route?.arr_icao || "----"} | ${route?.aircraft_icao || "N/A"}${route?.livery ? ` (${route.livery})` : ""}`;
  });
  return embedResponse({ title: `⭐ Featured Routes (${today})`, description: lines.join("\n"), color: COLORS.BLUE });
};

// ─── Button handlers ──────────────────────────────────────────────────────────
const handleJoinEventButton = async (body: any, eventId: string) => {
  const pilot = await getPilotFromInteraction(body);
  if (!pilot?.id) return embedResponse({ title: "Event Join Failed", description: "No pilot mapping found. Link Discord in profile settings first.", color: COLORS.RED });
  try {
    const { id } = getDiscordUser(body);
    const data   = await joinEventWithFallback(eventId, pilot.id, id);
    return ephemeralReply(`✅ Joined event. Departure gate: ${data?.assigned_dep_gate || "TBD"}, Arrival gate: ${data?.assigned_arr_gate || "TBD"}`);
  } catch (error: any) {
    return embedResponse({ title: "Event Join Failed", description: error?.message || "Could not join event.", color: COLORS.RED });
  }
};

const handleAcceptChallengeButton = async (body: any, challengeId: string) => {
  const pilot = await getPilotFromInteraction(body);
  if (!pilot?.id) return ephemeralReply("⚠️ No pilot mapping found for your Discord account.");
  const { data: existing } = await supabase.from("challenge_completions").select("id").eq("pilot_id", pilot.id).eq("challenge_id", challengeId).maybeSingle();
  if (!existing?.id) {
    const { error } = await supabase.from("challenge_completions").insert({ pilot_id: pilot.id, challenge_id: challengeId, status: "incomplete", completed_at: null } as any);
    if (error) return ephemeralReply(`⚠️ Challenge action failed: ${error.message}`);
  }
  return ephemeralReply("✅ Challenge accepted.");
};

// ─── Recruitment – Discord API helpers ────────────────────────────────────────
const createRecruitmentEmbed = async () => {
  const res = await discordApi(`/channels/${RECRUITMENTS_CHANNEL_ID}/messages`, {
    method: "POST",
    body: JSON.stringify({
      embeds: [{ title: "AFLV Recruitments", description: "Click **Fly High** to open your recruitment ticket and start your entrance written exam.", color: COLORS.BLUE }],
      components: [actionRow(btn(1, RECRUITMENT_BUTTON_CUSTOM_ID, "Fly High"))],
    }),
  });
  const payload = await discordJson(res);
  if (!res.ok) throw new Error(payload?.message || "Failed to create recruitment embed");
  return payload;
};

const createRecruitmentChannel = async (guildId: string, discordUserId: string, username: string) => {
  const safeUsername = username.toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 40) || discordUserId;
  const res = await discordApi(`/guilds/${guildId}/channels`, {
    method: "POST",
    body: JSON.stringify({
      name: `recruitment-${safeUsername}-${discordUserId.slice(-4)}`,
      type: 0,
      parent_id: RECRUITMENTS_CATEGORY_ID,
      permission_overwrites: [
        { id: guildId,                   type: 0, deny: "1024", allow: "0" },
        { id: discordUserId,             type: 1, allow: "1024", deny: "0" },
        { id: RECRUITMENT_STAFF_ROLE_ID, type: 0, allow: "1024", deny: "0" },
      ],
    }),
  });
  const payload = await discordJson(res);
  if (!res.ok) throw new Error(payload?.message || "Failed to create recruitment channel");
  return payload;
};

const updatePilotRolesAfterPracticalPass = async (guildId: string, discordUserId: string) => {
  if (!guildId || !discordUserId) return;
  const memberRes     = await discordApi(`/guilds/${guildId}/members/${discordUserId}`, { method: "GET" });
  const memberPayload = await discordJson(memberRes);
  if (!memberRes.ok) throw new Error(memberPayload?.message || "Failed to fetch member for role update");

  const nextRoles = new Set((Array.isArray(memberPayload?.roles) ? memberPayload.roles : []).map((r: any) => String(r)));
  for (const id of ROLE_IDS_ON_PRACTICAL_PASS_ADD)    nextRoles.add(id);
  for (const id of ROLE_IDS_ON_PRACTICAL_PASS_REMOVE) nextRoles.delete(id);

  const patchRes     = await discordApi(`/guilds/${guildId}/members/${discordUserId}`, { method: "PATCH", body: JSON.stringify({ roles: [...nextRoles] }) });
  const patchPayload = await discordJson(patchRes);
  if (!patchRes.ok) throw new Error(patchPayload?.message || "Failed to update member roles");
};

// ─── Recruitment – Supabase helpers ──────────────────────────────────────────
const resolveAuthUserFromDiscord = async (discordUserId: string) => {
  const { data, error } = await supabase.rpc("get_auth_user_id_by_discord", { p_discord_user_id: discordUserId });
  if (error) throw error;
  return data || null;
};

const getRecruitmentExamId = async () => {
  const value = await getSiteSetting("recruitment_exam_id");
  if (!value) throw new Error("Missing site setting: recruitment_exam_id");
  return String(value);
};

const ensureApplication = async (userId: string, discordUserId: string, username: string) => {
  const { data: existing } = await supabase.from("pilot_applications").select("id").eq("user_id", userId).maybeSingle();
  if (existing?.id) {
    await supabase.from("pilot_applications").update({ discord_user_id: discordUserId }).eq("id", existing.id);
    return existing.id;
  }
  const { data, error } = await supabase.from("pilot_applications").insert({
    user_id: userId, email: `${discordUserId}@users.noreply.local`, full_name: username,
    experience_level: "Grade 2", preferred_simulator: "No", reason_for_joining: "Recruitment flow",
    discord_username: username, if_grade: "Grade 2", is_ifatc: "No",
    ifc_trust_level: "I don't know", age_range: "13-16", other_va_membership: "No",
    hear_about_aflv: "Discord Recruitment", discord_user_id: discordUserId, status: "pending",
  } as any).select("id").single();
  if (error) throw error;
  return data.id as string;
};

const getLatestRecruitmentCooldown = async (discordUserId: string) => {
  const { data, error } = await supabase.from("recruitment_exam_sessions")
    .select("completed_at, passed").eq("discord_user_id", discordUserId).eq("passed", false)
    .not("completed_at", "is", null).order("completed_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  if (!data?.completed_at) return null;
  const remaining = new Date(data.completed_at).getTime() + 24 * 60 * 60 * 1000 - Date.now();
  return remaining > 0 ? Math.ceil(remaining / 60_000) : null;
};

const getLatestRecruitmentSession = async (discordUserId: string) => {
  const primary = await supabase.from("recruitment_exam_sessions")
    .select("id, completed_at, passed, recruitment_channel_id, exam_message_id")
    .eq("discord_user_id", discordUserId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!primary.error) return primary.data || null;
  // Backward compatibility if exam_message_id column is not yet present.
  const fallback = await supabase.from("recruitment_exam_sessions")
    .select("id, completed_at, passed, recruitment_channel_id")
    .eq("discord_user_id", discordUserId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (fallback.error) throw fallback.error;
  return fallback.data ? { ...fallback.data, exam_message_id: null } : null;
};

const getRecruitmentSessionByToken = async (token: string) => {
  const { data, error } = await supabase.from("recruitment_exam_sessions")
    .select("id, discord_user_id, passed, completed_at").eq("token", token).maybeSingle();
  if (error) throw error;
  return data || null;
};

const verifyAdminFromAuthHeader = async (authHeader: string | null) => {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.replace("Bearer ", "").trim();
  if (!token) return null;
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) return null;
  const { data: adminRole, error: roleError } = await supabase.from("user_roles").select("role").eq("user_id", userData.user.id).eq("role", "admin").maybeSingle();
  if (roleError || !adminRole) return null;
  return userData.user.id;
};

const getLatestRecruitmentSessionForUser = async (userId: string) => {
  const { data: app } = await supabase.from("pilot_applications").select("id").eq("user_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!app?.id) return null;
  const { data: session } = await supabase.from("recruitment_exam_sessions").select("recruitment_channel_id, discord_user_id").eq("application_id", app.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return session || null;
};

// ─── Practical status ─────────────────────────────────────────────────────────
const applyPracticalStatus = async (practicalId: string, status: "passed" | "failed", remarks?: string, guildId?: string) => {
  const { data: practical, error: practicalError } = await supabase
    .from("academy_practicals")
    .select("id, pilot_id, course_id, notes, status, pilots!academy_practicals_pilot_id_fkey(id, user_id, pid, full_name, discord_user_id)")
    .eq("id", practicalId).maybeSingle();
  if (practicalError || !practical?.pilots) throw new Error("Practical not found");

  const { error: updateError } = await supabase.from("academy_practicals").update({
    status, completed_at: new Date().toISOString(),
    result_notes: (remarks || "").trim() || (status === "passed" ? "Passed via recruitment Discord review action" : "Failed via recruitment Discord review action"),
  }).eq("id", practicalId);
  if (updateError) throw updateError;

  const pilot         = practical.pilots as any;
  const latestSession = await getLatestRecruitmentSessionForUser(String(pilot.user_id));
  const discordUserId = String(pilot.discord_user_id || latestSession?.discord_user_id || "");
  const channelId     = String(latestSession?.recruitment_channel_id || "");

  const postToChannel = (content: string) =>
    channelId ? discordApi(`/channels/${channelId}/messages`, { method: "POST", body: JSON.stringify({ content }) }).catch(() => null) : Promise.resolve();

  if (status === "passed") {
    let deleteQuery = supabase.from("recruitment_exam_sessions").delete().eq("auth_user_id", String(pilot.user_id));
    if (discordUserId) {
      deleteQuery = supabase.from("recruitment_exam_sessions").delete()
        .or(`auth_user_id.eq.${String(pilot.user_id)},discord_user_id.eq.${discordUserId}`);
    }
    await deleteQuery;
    await postToChannel(`🎉 Congratulations <@${discordUserId}>! You passed your practical.\nPlease read the Pilot Guide here: <#1428000030521823293> this channel will now ne closed. Any doubts? please open a ticket.`);
    if (channelId && discordUserId) {
      await discordApi(`/channels/${channelId}/permissions/${discordUserId}`, { method: "PUT", body: JSON.stringify({ type: 1, allow: "0", deny: "1024" }) }).catch(() => null);
    }
    if (discordUserId) {
      const resolvedGuildId = guildId || await getGuildIdFromChannel(channelId);
      if (resolvedGuildId) await updatePilotRolesAfterPracticalPass(resolvedGuildId, discordUserId).catch((e) => console.error("Failed to update post-practical roles", e));
    }
    return { action: "pass_notification_sent", practical, discordUserId, channelId };
  }

  // Failed: schedule retest
  await supabase.from("academy_practicals").insert({
    pilot_id: practical.pilot_id, course_id: practical.course_id, status: "scheduled",
    scheduled_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    notes: `Auto-retest after failed practical (${new Date().toISOString()})`,
  });
  await postToChannel(`❌ <@${discordUserId}> practical result: failed. You have a 24-hour cooldown. A retest practical has been auto-assigned for after cooldown.`);
  return { action: "fail_retest_assigned", practical, discordUserId, channelId };
};

const handlePracticalStatusAction = async (body: any, authHeader: string | null) => {
  const adminUserId = await verifyAdminFromAuthHeader(authHeader);
  if (!adminUserId) return new Response("Unauthorized", { status: 401 });
  const practicalId = String(body?.practicalId || "");
  const status      = String(body?.status || "");
  if (!practicalId || !["passed", "failed"].includes(status)) return new Response("Invalid practical payload", { status: 400 });
  try {
    const result = await applyPracticalStatus(practicalId, status as "passed" | "failed", String(body?.remarks || ""), String(body?.guildId || ""));
    return Response.json({ ok: true, action: result.action, adminUserId });
  } catch (error: any) {
    const message = error?.message || "Could not update practical status";
    return new Response(message, { status: message === "Practical not found" ? 404 : 500 });
  }
};

// ─── Recruitment – Practical review button / modal ────────────────────────────
const handlePracticalReviewButton = async (body: any, customId: string) => {
  if (!assertReviewer(body)) return ephemeralReply("You are not allowed to review practicals.");
  const [, status, practicalId] = customId.split(":");
  if (!practicalId || !["passed", "failed"].includes(status)) return ephemeralReply("Invalid practical review action.");
  return Response.json({
    type: 9,
    data: {
      custom_id: `${RECRUITMENT_PRACTICAL_REVIEW_MODAL_PREFIX}${status}:${practicalId}`.slice(0, 100),
      title: `Practical ${status === "passed" ? "Pass" : "Fail"} Remarks`,
      components: [actionRow({ type: 4, custom_id: "review_remarks", label: "Remarks / Notes", style: 2, required: false, max_length: 1000, placeholder: "Optional remarks for this result..." })],
    },
  });
};

const handlePracticalReviewModal = async (body: any, customId: string) => {
  if (!assertReviewer(body)) return ephemeralReply("You are not allowed to review practicals.");
  const [status, practicalId] = customId.slice(RECRUITMENT_PRACTICAL_REVIEW_MODAL_PREFIX.length).split(":");
  if (!practicalId || !["passed", "failed"].includes(status)) return ephemeralReply("Invalid practical review action.");
  const remarks = readModalInput(body, "review_remarks");
  try {
    const result  = await applyPracticalStatus(practicalId, status as "passed" | "failed", remarks, String(body?.guild_id || ""));
    const color   = status === "passed" ? COLORS.GREEN : COLORS.RED;
    const outcome = status === "passed" ? "PASSED" : "FAILED";
    return Response.json({
      type: 4,
      data: {
        embeds: [{
          title: "AFLV | Practical Review", color,
          description: `Practical review complete.\n**Result:** ${outcome}`,
          fields: [
            { name: "Pilot",        value: result.discordUserId ? `<@${result.discordUserId}>` : String((result.practical as any)?.pilots?.full_name || "Unknown"), inline: true },
            { name: "Practical ID", value: practicalId, inline: false },
            ...(remarks?.trim() ? [{ name: "Remarks", value: remarks.trim().slice(0, 1024), inline: false }] : []),
          ],
          timestamp: new Date().toISOString(),
        }],
      },
    });
  } catch (error: any) {
    return ephemeralReply(error?.message || "Could not update practical status.");
  }
};

// ─── Recruitment – Fly High flow ──────────────────────────────────────────────

/**
 * Always ephemeral — all Fly High followups are user-only.
 * The initial ACK (type 5) also carries flags:64 — both are required.
 */
const sendInteractionFollowup = async (applicationId: string, interactionToken: string, content: string) => {
  await fetch(`https://discord.com/api/v10/webhooks/${applicationId}/${interactionToken}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, flags: 64 }),
  });
};

const processRecruitmentButton = async (body: any): Promise<string> => {
  const { id: discordUserId, username } = getDiscordUser(body);
  const safeUsername = username || "candidate";
  const guildId      = body.guild_id;
  if (!discordUserId || !guildId) return "Missing Discord user/guild context.";

  const authUserId  = await resolveAuthUserFromDiscord(discordUserId).catch(() => null);
  const examId      = await getRecruitmentExamId();
  const lastSession = await getLatestRecruitmentSession(discordUserId);

  const cooldownMinutes = await getLatestRecruitmentCooldown(discordUserId);
  if (cooldownMinutes) {
    const h = Math.floor(cooldownMinutes / 60), m = cooldownMinutes % 60;
    return `You need to wait before retest. Next exam link will be available in ${h}h ${m}m.`;
  }

  const token = crypto.randomUUID();
  const { error: sessionError } = await supabase.from("recruitment_exam_sessions").insert({
    application_id: null, exam_id: examId, auth_user_id: authUserId, discord_user_id: discordUserId, token,
  });
  if (sessionError) {
    const msg = String((sessionError as any)?.message || "").toLowerCase();
    if (msg.includes("application_id") && authUserId) {
      const applicationId = await ensureApplication(authUserId, discordUserId, safeUsername);
      const { error: retryError } = await supabase.from("recruitment_exam_sessions").insert({
        application_id: applicationId, exam_id: examId, auth_user_id: authUserId, discord_user_id: discordUserId, token,
      });
      if (retryError) throw retryError;
    } else {
      throw sessionError;
    }
  }

  const channel = await createRecruitmentChannel(guildId, discordUserId, safeUsername);
  const examUrl = `${FRONTEND_URL.replace(/\/$/, "")}/academy/exam/${examId}?recruitmentToken=${encodeURIComponent(token)}`;

  if (lastSession?.passed === false && !cooldownMinutes && lastSession.recruitment_channel_id && lastSession.exam_message_id) {
    await discordApi(`/channels/${lastSession.recruitment_channel_id}/messages/${lastSession.exam_message_id}`, { method: "DELETE" }).catch(() => null);
  }

  const examMsgRes = await discordApi(`/channels/${channel.id}/messages`, {
    method: "POST",
    body: JSON.stringify({
      content: `<@${discordUserId}>`,
      embeds: [{
        title: "AFLV | Recruitment Written Test", color: COLORS.BLUE,
        description: ["Please complete your entrance written exam using the link below:", examUrl, "", "After you pass, click **Continue** below.", "**Note:** If you fail, there is a 24-hour cooldown before a new written test link is issued. if new link is not issued please inform respective authorities."].join("\n"),
        timestamp: new Date().toISOString(),
      }],
      components: [actionRow(btn(1, `${RECRUITMENT_CALLSIGN_BUTTON_PREFIX}${token}`, "Continue"))],
    }),
  });

  const examMsgPayload = await discordJson(examMsgRes);
  const updateRes = await supabase.from("recruitment_exam_sessions")
    .update({ recruitment_channel_id: channel.id, exam_message_id: examMsgPayload?.id || null }).eq("token", token);
  if (updateRes.error) {
    // Backward compatibility if exam_message_id column is not yet present.
    await supabase.from("recruitment_exam_sessions").update({ recruitment_channel_id: channel.id }).eq("token", token);
  }

  // ✅ User-only — sent as ephemeral followup
  return `Recruitment channel created: <#${channel.id}>`;
};

const handleRecruitmentButton = (body: any) => {
  const interactionToken = String(body?.token || "");
  const applicationId    = String(body?.application_id || "");

  const task = (async () => {
    if (!interactionToken || !applicationId) return;
    try {
      const content = await processRecruitmentButton(body);
      await sendInteractionFollowup(applicationId, interactionToken, content);
    } catch (error: any) {
      await sendInteractionFollowup(applicationId, interactionToken, error?.message || "Recruitment flow failed");
    }
  })();

  (globalThis as any).EdgeRuntime?.waitUntil?.(task);

  // ⚠️ flags:64 in the ACK is required — without it Discord shows the
  // deferred "thinking..." state publicly regardless of the followup flags.
  return Response.json({ type: 5, data: { flags: 64 } });
};

const handleOpenCallsignModal = async (body: any, token: string) => {
  const { id: discordUserId } = getDiscordUser(body);
  if (!discordUserId) return ephemeralReply("Missing Discord user context.");
  if (!token)         return ephemeralReply("Recruitment session not found. Please restart from Fly High.");

  const session = await getRecruitmentSessionByToken(token);
  if (!session)       return ephemeralReply("Recruitment session not found. Please click Fly High again.");

  if (session.discord_user_id && String(session.discord_user_id) !== String(discordUserId)) {
    return ephemeralReply("This button belongs to another recruitment session.");
  }

  if (!session.passed) {
    if (!session.completed_at) return ephemeralReply("Please complete the written test first, then click Continue.");
    const cooldownMinutes = await getLatestRecruitmentCooldown(String(discordUserId));
    if (cooldownMinutes) {
      const h = Math.floor(cooldownMinutes / 60), m = cooldownMinutes % 60;
      return ephemeralReply(`You failed the written test. Please wait ${h}h ${m}m before retry.`);
    }
    return ephemeralReply("Please complete and pass the written test first.");
  }

  return Response.json({
    type: 9,
    data: {
      custom_id: `${RECRUITMENT_CALLSIGN_MODAL_PREFIX}${token}`.slice(0, 100),
      title: "Continue",
      components: [
        actionRow({ type: 4, custom_id: "preferred_callsign", label: "Preferred Callsign (AFLVXXX)", style: 1, min_length: 7, max_length: 7, required: true, placeholder: "AFLV123" }),
        actionRow({ type: 4, custom_id: "contact_email", label: "Registration Email (if not Discord)", style: 1, required: false, placeholder: "name@example.com" }),
      ],
    },
  });
};

const handleSubmitCallsignModal = async (body: any, token: string) => {
  const { id: discordUserId } = getDiscordUser(body);
  if (!discordUserId) return ephemeralReply("Missing Discord user context.");

  const preferredPid = readModalInput(body, "preferred_callsign").toUpperCase().trim();
  if (!/^AFLV[A-Z0-9]{3}$/.test(preferredPid)) return ephemeralReply("Invalid format. Use AFLVXXX (letters/numbers).");

  const email = readModalInput(body, "contact_email").trim();
  const { data, error } = await supabase.rpc("set_recruitment_callsign_details", { p_token: token, p_pid: preferredPid, p_email: email || null });

  if (error) {
    const msg = String(error.message || "Could not set callsign.");
    if (msg.toLowerCase().includes("callsign already taken")) {
      return ephemeralReply("This callsign is already taken. Please click Continue and choose another callsign.");
    }
    return ephemeralReply(msg);
  }

  // Public — visible in the recruitment channel
  return Response.json({
    type: 4,
    data: {
      content: `✅ Callsign **${String(data?.pid || preferredPid)}** saved. Now register/login at https://crew-aflv.vercel.app/. Then click the button below to continue.`,
      components: [actionRow(btn(1, `${RECRUITMENT_PRACTICAL_CONFIRM_PREFIX}${token}`, "I have registered, continue"))],
    },
  });
};

const handleRecruitmentPracticalConfirm = async (token: string) => {
  if (!token) return ephemeralReply("Recruitment session expired. Please press Continue again from latest message.");

  const { data: finalState, error: finalError } = await supabase.rpc("finalize_recruitment_registration", { p_token: token });
  if (finalError) return ephemeralReply(finalError.message || "Could not verify registration status.");

  if (!finalState?.approved) {
    return ephemeralReply("Please register on Crew Center first (Discord login or same email from callsign form), then click this button again.");
  }

  // Public — visible in channel
  return Response.json({
    type: 7,
    data: {
      content: "Confirm to let the bot assign your practical now.",
      components: [actionRow(btn(3, `${RECRUITMENT_PRACTICAL_READY_PREFIX}${token}`, "Yes, assign practical now"))],
    },
  });
};

const buildPracticalAssignedInteraction = (pidInput: string, practicalIdInput: string) => {
  const pid         = String(pidInput || "AFLV");
  const shortPid    = pid.replace(/^AFLV/i, "") || pid;
  const practicalId = String(practicalIdInput || "");
  // Public — visible in the recruitment channel
  return Response.json({
    type: 4,
    data: {
      embeds: [{
        title: "AFLV | Practical Assigned", color: COLORS.BLUE,
        description: "Your practical is assigned. Complete the task and wait for examiner review.",
        fields: [
          { name: "Practical Tasks",     value: PRACTICAL_TASKS.join("\n") },
          { name: "Aircraft / Callsign", value: `ATYP - C172\nCALLSIGN - Aeroflot ${shortPid}CR` },
        ],
        timestamp: new Date().toISOString(),
      }],
      components: practicalId ? [actionRow(
        btn(3, `${RECRUITMENT_PRACTICAL_REVIEW_PREFIX}passed:${practicalId}`, "Pass"),
        btn(4, `${RECRUITMENT_PRACTICAL_REVIEW_PREFIX}failed:${practicalId}`, "Fail"),
      )] : [],
    },
  });
};

const handleRecruitmentPracticalReady = async (body: any, token: string) => {
  if (!token) return ephemeralReply("Recruitment session expired. Please press Continue again from latest message.");
  const { id: discordUserId } = getDiscordUser(body);
  if (!discordUserId) return ephemeralReply("Missing Discord user context.");

  const { data: finalState, error: finalError } = await supabase.rpc("finalize_recruitment_registration", { p_token: token });
  if (finalError) return ephemeralReply(finalError.message || "Could not finalize recruitment registration.");
  if (!finalState?.approved) {
    return ephemeralReply("You still need to register on Crew Center first. Register with Discord OR with your email used in the callsign form at https://crew-aflv.vercel.app/ then click again.");
  }

  const { data: sessionByToken } = await supabase.from("recruitment_exam_sessions").select("auth_user_id").eq("token", token).maybeSingle();
  if (sessionByToken?.auth_user_id) {
    const { data: pilotRow } = await supabase.from("pilots").select("id").eq("user_id", sessionByToken.auth_user_id).maybeSingle();
    if (pilotRow?.id) {
      const { data: failedPractical } = await supabase.from("academy_practicals").select("completed_at")
        .eq("pilot_id", pilotRow.id).eq("status", "failed").order("completed_at", { ascending: false }).limit(1).maybeSingle();
      if (failedPractical?.completed_at) {
        const nextAt = new Date(new Date(failedPractical.completed_at).getTime() + 24 * 60 * 60 * 1000);
        if (Date.now() < nextAt.getTime()) {
          return ephemeralReply(`You failed practical recently. Please wait until ${nextAt.toLocaleString()} before continuing.`);
        }
      }
    }
  }

  const { data, error } = await supabase.rpc("assign_recruitment_practical", { p_token: token });
  if (error) return ephemeralReply(error.message || "Could not assign practical.");

  if (data?.ok === false && String(data?.message || "").toLowerCase().includes("not approved") && sessionByToken?.auth_user_id) {
    const { data: approvedApp } = await supabase.from("pilot_applications").select("id")
      .eq("user_id", sessionByToken.auth_user_id).eq("status", "approved")
      .order("reviewed_at", { ascending: false }).limit(1).maybeSingle();

    if (approvedApp?.id) {
      const { data: pilotForFallback } = await supabase.from("pilots").select("id,pid").eq("user_id", sessionByToken.auth_user_id).maybeSingle();
      if (pilotForFallback?.id) {
        const { data: existingPractical } = await supabase.from("academy_practicals").select("id")
          .eq("pilot_id", pilotForFallback.id).in("status", ["scheduled", "completed"]).ilike("notes", "Recruitment practical%")
          .order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (existingPractical?.id) return buildPracticalAssignedInteraction(String(pilotForFallback.pid || "AFLV"), String(existingPractical.id));

        const courseIdRaw = await getSiteSetting("recruitment_practical_id");
        const courseId    = courseIdRaw && /^[0-9a-f-]{36}$/i.test(String(courseIdRaw)) ? String(courseIdRaw) : null;
        const shortPid    = String(pilotForFallback.pid || "AFLV").replace(/^AFLV/i, "");
        const practicalNotes = ["Recruitment practical", ...PRACTICAL_TASKS, "", `ATYP - C172`, `CALLSIGN - Aeroflot ${shortPid}CR`].join("\n");

        const { data: createdPractical, error: createError } = await supabase.from("academy_practicals")
          .insert({ pilot_id: pilotForFallback.id, course_id: courseId, status: "scheduled", notes: practicalNotes })
          .select("id").single();
        if (createError) return ephemeralReply(createError.message || "Could not assign practical.");
        return buildPracticalAssignedInteraction(String(pilotForFallback.pid || "AFLV"), String(createdPractical?.id || ""));
      }
    }
  }

  if (data?.already_assigned) return ephemeralReply("Practical already assigned. Please complete it and wait for staff review.");
  if (data?.ok === false)      return ephemeralReply(String(data?.message || "Could not assign practical."));

  return buildPracticalAssignedInteraction(String(data?.pid || "AFLV"), String(data?.practical_id || ""));
};

// ─── Main server ──────────────────────────────────────────────────────────────
serve(async (req) => {
  try {
    // Authenticated REST actions (not Discord interactions)
    if (!req.headers.get("x-signature-ed25519") && req.headers.get("authorization")) {
      const body = await req.json().catch(() => ({}));
      if (body?.action === "handle_practical_status") return await handlePracticalStatusAction(body, req.headers.get("authorization"));
      return Response.json({ ok: false, error: "Unsupported authenticated action" }, { status: 400 });
    }

    // Embed registration via secret header
    if (req.headers.get("x-register-secret")) {
      const provided = req.headers.get("x-register-secret") || "";
      if (!DISCORD_REGISTER_SECRET || provided !== DISCORD_REGISTER_SECRET) return new Response("Unauthorized", { status: 401 });
      try {
        const message = await createRecruitmentEmbed();
        return Response.json({ ok: true, messageId: message.id, channelId: RECRUITMENTS_CHANNEL_ID });
      } catch (error: any) {
        return Response.json({ ok: false, error: error?.message || "Failed to create recruitment embed" }, { status: 500 });
      }
    }

    // Verify Discord signature
    const rawBody = await req.text();
    if (!await verifyDiscordRequest(req, rawBody)) return new Response("invalid request signature", { status: 401 });

    const body = JSON.parse(rawBody);

    // PING
    if (body.type === 1) return Response.json({ type: 1 });

    // Autocomplete (type 4)
    if (body.type === 4) {
      const focused = body.data?.options?.find((o: any) => o.focused);
      if (!focused) return Response.json({ type: 8, data: { choices: [] } });
      if (focused.name === "operator") {
        const q = String(focused.value || "").toLowerCase();
        const choices = (await getOperators()).filter((o) => o.toLowerCase().includes(q)).slice(0, 25).map((o) => ({ name: o, value: o }));
        return Response.json({ type: 8, data: { choices } });
      }
      if (focused.name === "aircraft") {
        const choices = (await searchAircraft(String(focused.value || ""))).map((a: any) => ({ name: `${a.icao_code} - ${a.name || "Unknown"}${a.livery ? ` (${a.livery})` : ""}`.slice(0, 100), value: a.icao_code }));
        return Response.json({ type: 8, data: { choices } });
      }
      if (focused.name === "multiplier") {
        const q = String(focused.value || "").toLowerCase();
        const choices = (await getMultipliers()).filter((m: any) => m.name.toLowerCase().includes(q) || `${m.value}`.includes(q)).slice(0, 25).map((m: any) => ({ name: `${m.name} (${m.value.toFixed(1)}x)`.slice(0, 100), value: m.name }));
        return Response.json({ type: 8, data: { choices } });
      }
      return Response.json({ type: 8, data: { choices: [] } });
    }

    // Button interactions (type 3)
    if (body.type === 3) {
      const customId = String(body.data?.custom_id || "");
      try {
        if (customId.startsWith("event_join:"))                              return handleJoinEventButton(body, customId.slice("event_join:".length));
        if (customId.startsWith("challenge_accept:"))                        return handleAcceptChallengeButton(body, customId.slice("challenge_accept:".length));
        if (customId === RECRUITMENT_BUTTON_CUSTOM_ID)                       return handleRecruitmentButton(body);
        if (customId.startsWith(RECRUITMENT_CALLSIGN_BUTTON_PREFIX))         return handleOpenCallsignModal(body, customId.slice(RECRUITMENT_CALLSIGN_BUTTON_PREFIX.length));
        if (customId.startsWith(RECRUITMENT_PRACTICAL_CONFIRM_PREFIX))       return handleRecruitmentPracticalConfirm(customId.slice(RECRUITMENT_PRACTICAL_CONFIRM_PREFIX.length));
        if (customId.startsWith(RECRUITMENT_PRACTICAL_READY_PREFIX))         return handleRecruitmentPracticalReady(body, customId.slice(RECRUITMENT_PRACTICAL_READY_PREFIX.length));
        if (customId.startsWith(RECRUITMENT_PRACTICAL_REVIEW_PREFIX))        return handlePracticalReviewButton(body, customId);
      } catch (error: any) {
        return ephemeralReply(error?.message || "Action failed");
      }
      return embedResponse({ title: "Action Failed", description: "Unknown button action.", color: COLORS.RED });
    }

    // Modal submissions (type 5)
    if (body.type === 5) {
      const customId = String(body.data?.custom_id || "");
      try {
        if (customId.startsWith(RECRUITMENT_CALLSIGN_MODAL_PREFIX))         return handleSubmitCallsignModal(body, customId.slice(RECRUITMENT_CALLSIGN_MODAL_PREFIX.length));
        if (customId.startsWith(RECRUITMENT_PRACTICAL_REVIEW_MODAL_PREFIX)) return handlePracticalReviewModal(body, customId);
      } catch (error: any) {
        return ephemeralReply(error?.message || "Modal action failed");
      }
      return embedResponse({ title: "Action Failed", description: "Unknown modal action.", color: COLORS.RED });
    }

    // Slash commands (type 2)
    if (body.type === 2) {
      const name = body.data?.name;
      if (name === "pirep")       return handlePirep(body);
      if (name === "get-events")  return handleGetEvents();
      if (name === "leaderboard") return handleLeaderboard();
      if (name === "challange")   return handleChallengeList();
      if (name === "notams")      return handleNotams();
      if (name === "rotw")        return handleRotw();
      if (name === "featured")    return handleFeatured();
    }

    return embedResponse({ title: "Unsupported Command", description: "This interaction type is not handled.", color: COLORS.RED });
  } catch (error: any) {
    console.error("discord-pirep-bot unhandled error", error);
    if (req.headers.get("x-signature-ed25519")) {
      return Response.json({ type: 4, data: { content: error?.message || "Unexpected bot error. Please try again.", flags: 64 } });
    }
    return Response.json({ ok: false, error: error?.message || "Unexpected bot error" }, { status: 500 });
  }
});