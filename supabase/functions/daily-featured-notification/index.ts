import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const today = new Date().toISOString().split("T")[0];

    const { data: featured } = await supabase
      .from("daily_featured_routes")
      .select(`
        id, featured_date,
        routes (route_number, dep_icao, arr_icao, aircraft_icao)
      `)
      .eq("featured_date", today);

    if (!featured || featured.length < 2) {
      return new Response(JSON.stringify({ message: `Only ${featured?.length ?? 0} featured route(s) today. Minimum 2 required for notification.` }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch active multipliers to mention in notification
    const { data: multipliers } = await supabase
      .from("multiplier_configs")
      .select("name, value")
      .eq("is_active", true)
      .order("value", { ascending: false })
      .limit(1);

    const multiplierText = multipliers && multipliers.length > 0
      ? `🔥 **${multipliers[0].value}x ${multipliers[0].name}** multiplier active!`
      : "";

    const webhookUrl = Deno.env.get("DISCORD_WEBHOOK_FEATURED") || Deno.env.get("DISCORD_WEBHOOK_URL");
    if (!webhookUrl) {
      return new Response(JSON.stringify({ error: "No webhook configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const fields = featured.flatMap((f: any, i: number) => [
      { name: `Route ${i + 1}`, value: f.routes?.route_number || "N/A", inline: true },
      { name: "From → To", value: `${f.routes?.dep_icao || "?"} → ${f.routes?.arr_icao || "?"}`, inline: true },
      { name: "Aircraft", value: f.routes?.aircraft_icao || "N/A", inline: true },
    ]);

    const embed = {
      title: "⭐ Daily Featured Routes!",
      description: `Today's ${featured.length} featured routes have been set for ${today}.${multiplierText ? `\n${multiplierText}` : ""}`,
      color: 0xf1c40f,
      fields: [
        ...fields,
        { name: "Date", value: today, inline: true },
      ],
      timestamp: new Date().toISOString(),
      footer: { text: "LATOUR Virtual" },
    };

    const discordRes = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [embed] }),
    });

    if (!discordRes.ok) {
      const err = await discordRes.text();
      console.error("Discord error:", err);
      return new Response(JSON.stringify({ error: "Discord failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await discordRes.text();
    return new Response(JSON.stringify({ success: true, count: featured.length }), {
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
