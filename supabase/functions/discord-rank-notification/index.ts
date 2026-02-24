import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const isValidWebhookUrl = (value?: string | null) => {
  if (!value || value.includes("PLACEHOLDER_VALUE_TO_BE_REPLACED")) return false;
  try {
    const u = new URL(value);
    return (u.protocol === "https:") && (u.hostname.includes("discord.com") || u.hostname.includes("discordapp.com"));
  } catch {
    return false;
  }
};


serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { type } = body;

    // Pick the correct webhook URL based on notification type
    let webhookUrl: string | undefined;
    let embed: any;

    if (type === "new_pirep") {
      webhookUrl = Deno.env.get("DISCORD_WEBHOOK_PIREP") || Deno.env.get("DISCORD_WEBHOOK_URL");
      const { pilot_name, pid, flight_number, dep_icao, arr_icao, aircraft_icao, livery, flight_hours, operator, flight_type } = body;
      embed = {
        title: "✈️ New PIREP Filed!",
        description: `**${pilot_name}** (${pid}) has filed a new PIREP.`,
        color: 0x2ecc71,
        fields: [
          { name: "Flight", value: flight_number, inline: true },
          { name: "Route", value: `${dep_icao} → ${arr_icao}`, inline: true },
          { name: "Aircraft", value: `${aircraft_icao || "N/A"}${livery ? ` (${livery})` : ""}`, inline: true },
          { name: "Hours", value: String(flight_hours), inline: true },
          { name: "Operator", value: operator, inline: true },
          { name: "Type", value: flight_type, inline: true },
        ],
        timestamp: new Date().toISOString(),
        footer: { text: "LATOUR Virtual" },
      };
    } else if (type === "featured_route") {
      webhookUrl = Deno.env.get("DISCORD_WEBHOOK_FEATURED") || Deno.env.get("DISCORD_WEBHOOK_URL");
      const { route_number, dep_icao, arr_icao, aircraft_icao, livery, featured_date } = body;
      embed = {
        title: "⭐ Featured Route of the Day!",
        description: `Today's featured route has been set.`,
        color: 0xf1c40f,
        fields: [
          { name: "Route", value: route_number, inline: true },
          { name: "From → To", value: `${dep_icao} → ${arr_icao}`, inline: true },
          { name: "Aircraft", value: `${aircraft_icao || "N/A"}${livery ? ` (${livery})` : ""}`, inline: true },
          { name: "Date", value: featured_date, inline: true },
        ],
        timestamp: new Date().toISOString(),
        footer: { text: "LATOUR Virtual" },
      };
    } else if (type === "event_created" || type === "event_updated") {
      webhookUrl = Deno.env.get("DISCORD_WEBHOOK_EVENTS") || Deno.env.get("DISCORD_WEBHOOK_URL");
      const { name, description, dep_icao, arr_icao, server, start_time, end_time, aircraft_icao, aircraft_name, livery } = body;
      embed = {
        title: type === "event_updated" ? "🛠️ Event Updated" : "📅 New Event Created",
        description: `**${name || "Event"}**${description ? `\n${description}` : ""}`,
        color: type === "event_updated" ? 0xf39c12 : 0x3498db,
        fields: [
          { name: "Route", value: `${dep_icao || "----"} → ${arr_icao || "----"}`, inline: true },
          { name: "Server", value: server || "N/A", inline: true },
          { name: "Aircraft", value: `${aircraft_name || aircraft_icao || "Any"}${livery ? ` (${livery})` : ""}`, inline: true },
          ...(start_time ? [{ name: "Start", value: new Date(start_time).toISOString(), inline: true }] : []),
          ...(end_time ? [{ name: "End", value: new Date(end_time).toISOString(), inline: true }] : []),
        ],
        timestamp: new Date().toISOString(),
        footer: { text: "LATOUR Virtual" },
      };
    } else if (type === "new_challenge") {
      webhookUrl = Deno.env.get("DISCORD_WEBHOOK_CHALLENGES") || Deno.env.get("DISCORD_WEBHOOK_URL");
      const { name, description, destination_icao, image_url } = body;
      embed = {
        title: "🎯 New Challenge Available!",
        description: `A new challenge has been added: **${name}**`,
        color: 0xe67e22,
        fields: [
          ...(description ? [{ name: "Description", value: description, inline: false }] : []),
          ...(destination_icao ? [{ name: "Destination", value: destination_icao, inline: true }] : []),
        ],
        ...(image_url ? { image: { url: image_url } } : {}),
        timestamp: new Date().toISOString(),
        footer: { text: "LATOUR Virtual" },
      };
    } else {
      // Default: rank promotion
      webhookUrl = Deno.env.get("DISCORD_WEBHOOK_RANK") || Deno.env.get("DISCORD_WEBHOOK_URL");
      const { pilot_name, pid, old_rank, new_rank } = body;
      const formatRank = (rank: string) =>
        rank.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
      embed = {
        title: "🎖️ Rank Promotion!",
        description: `**${pilot_name}** (${pid}) has been promoted!`,
        color: 0x1e90ff,
        fields: [
          { name: "Previous Rank", value: formatRank(old_rank), inline: true },
          { name: "New Rank", value: formatRank(new_rank), inline: true },
        ],
        timestamp: new Date().toISOString(),
        footer: { text: "LATOUR Virtual" },
      };
    }

    if (!isValidWebhookUrl(webhookUrl)) {
      console.warn("Skipping Discord webhook due to invalid or placeholder URL for type:", type);
      return new Response(JSON.stringify({ success: true, skipped: true, reason: "invalid_webhook_url" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const discordResponse = await fetch(webhookUrl!, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [embed] }),
    });

    if (!discordResponse.ok) {
      const errorText = await discordResponse.text();
      console.error("Discord webhook failed:", errorText);
      return new Response(JSON.stringify({ error: "Discord webhook failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await discordResponse.text();

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
