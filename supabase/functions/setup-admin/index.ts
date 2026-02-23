import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Pre-approved admin emails - add your admin emails here
const ADMIN_EMAILS = ["admin@aflv.ru"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No auth header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify user with their JWT
    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if user email is in the pre-approved admin list
    const isAdminEmail = ADMIN_EMAILS.includes(user.email || "");
    if (!isAdminEmail) {
      return new Response(JSON.stringify({ setup: false, message: "Not admin email" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Check if pilot profile exists
    const { data: existingPilot } = await supabaseAdmin
      .from("pilots")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!existingPilot) {
      // Get next PID
      const { data: pidData } = await supabaseAdmin.rpc("get_next_pid");
      const pid = pidData || "AFLV000";

      const { error: pilotError } = await supabaseAdmin.from("pilots").insert({
        user_id: user.id,
        pid,
        full_name: "Administrator",
        current_rank: "commander",
      });

      if (pilotError) {
        console.error("Pilot creation error:", pilotError);
        return new Response(JSON.stringify({ error: pilotError.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Ensure admin role exists
    const { data: existingRole } = await supabaseAdmin
      .from("user_roles")
      .select("id")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();

    if (!existingRole) {
      const { error: roleError } = await supabaseAdmin
        .from("user_roles")
        .insert({ user_id: user.id, role: "admin" });

      if (roleError) {
        console.error("Role creation error:", roleError);
        return new Response(JSON.stringify({ error: roleError.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    console.log(`Admin setup complete for ${user.email}`);
    return new Response(JSON.stringify({ setup: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Setup admin error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});