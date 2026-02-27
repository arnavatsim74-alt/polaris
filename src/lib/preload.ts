import { supabase } from "@/integrations/supabase/client";

export async function preloadDashboardData(pilotId: string) {
  const queries = [
    supabase.from("site_settings").select("*"),
    supabase.from("rank_configs").select("*").eq("is_active", true).order("order_index"),
    supabase.from("pilot_streaks").select("*").eq("pilot_id", pilotId).maybeSingle(),
    supabase.from("pireps").select("*").eq("pilot_id", pilotId).order("created_at", { ascending: false }).limit(5),
    supabase.from("pireps").select("flight_hours, multiplier").eq("pilot_id", pilotId).eq("status", "approved"),
  ];

  await Promise.all(queries.map(q => q.then(({ error }) => {
    if (error) console.error("Preload error:", error);
  })));
}
