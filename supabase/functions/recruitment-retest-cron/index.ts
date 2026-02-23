import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const DISCORD_BOT_TOKEN = Deno.env.get("DISCORD_BOT_TOKEN") || "";
const FRONTEND_URL = Deno.env.get("FRONTEND_URL") || "";
const RECRUITMENT_PRACTICAL_REVIEW_PREFIX = "recruitment_practical_review:";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const discordApi = async (path: string, init: RequestInit = {}) => {
  return fetch(`https://discord.com/api/v10${path}`, {
    ...init,
    headers: {
      Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
};

serve(async () => {
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !DISCORD_BOT_TOKEN || !FRONTEND_URL) {
      return Response.json({ ok: false, error: "Missing required env vars" }, { status: 500 });
    }

    const { data: failedSessions, error: fetchError } = await supabase
      .from("recruitment_exam_sessions")
      .select("id, auth_user_id, application_id, exam_id, discord_user_id, recruitment_channel_id, exam_message_id, completed_at, created_at")
      .eq("passed", false)
      .not("completed_at", "is", null)
      .is("retest_sent_at", null)
      .not("discord_user_id", "is", null)
      .not("recruitment_channel_id", "is", null)
      .order("completed_at", { ascending: true })
      .limit(200);

    if (fetchError) throw fetchError;

    let processed = 0;
    let sent = 0;
    let skipped = 0;

    for (const session of failedSessions || []) {
      processed++;

      const completedAt = new Date(session.completed_at as string).getTime();
      const readyAt = completedAt + (24 * 60 * 60 * 1000);
      if (Date.now() < readyAt) {
        skipped++;
        continue;
      }

      const { data: newer } = await supabase
        .from("recruitment_exam_sessions")
        .select("id")
        .eq("discord_user_id", session.discord_user_id)
        .gt("created_at", session.created_at)
        .limit(1)
        .maybeSingle();

      if (newer?.id) {
        await supabase.from("recruitment_exam_sessions").update({ retest_sent_at: new Date().toISOString() }).eq("id", session.id);
        skipped++;
        continue;
      }

      const token = crypto.randomUUID();
      const examUrl = `${FRONTEND_URL.replace(/\/$/, "")}/academy/exam/${session.exam_id}?recruitmentToken=${encodeURIComponent(token)}`;

      if (session.exam_message_id && session.recruitment_channel_id) {
        await discordApi(`/channels/${session.recruitment_channel_id}/messages/${session.exam_message_id}`, {
          method: "DELETE",
        }).catch(() => null);
      }

      const messageResponse = await discordApi(`/channels/${session.recruitment_channel_id}/messages`, {
        method: "POST",
        body: JSON.stringify({
          content: `🔁 <@${session.discord_user_id}> your 24-hour cooldown is complete.\nHere is your NEW written test link:\n${examUrl}\n\n(Previous test link has been removed.)`,
        }),
      });

      const messagePayload = await messageResponse.json().catch(() => ({}));
      if (!messageResponse.ok) {
        console.error("Failed to send retest message", messagePayload);
        continue;
      }

      const { data: newSession, error: insertError } = await supabase
        .from("recruitment_exam_sessions")
        .insert({
          auth_user_id: session.auth_user_id,
          application_id: session.application_id,
          exam_id: session.exam_id,
          discord_user_id: session.discord_user_id,
          recruitment_channel_id: session.recruitment_channel_id,
          exam_message_id: messagePayload?.id || null,
          token,
        })
        .select("id")
        .single();

      if (insertError) {
        console.error("Failed to create retest session", insertError);
        continue;
      }

      await supabase
        .from("recruitment_exam_sessions")
        .update({ retest_sent_at: new Date().toISOString() })
        .eq("id", session.id);

      sent++;
      console.log("Retest session created", { oldSessionId: session.id, newSessionId: newSession.id });
    }



    let practicalRemindersSent = 0;
    const { data: pendingRetestPracticals } = await supabase
      .from("academy_practicals")
      .select("id, pilot_id, scheduled_at, notes, pilots!academy_practicals_pilot_id_fkey(user_id, discord_user_id, pid)")
      .eq("status", "scheduled")
      .ilike("notes", "Auto-retest after failed practical%")
      .lte("scheduled_at", new Date().toISOString())
      .order("scheduled_at", { ascending: true })
      .limit(200);

    for (const practical of pendingRetestPracticals || []) {
      const notes = String((practical as any)?.notes || "");
      if (notes.includes("[DISCORD_SENT]")) continue;

      const pilot = (practical as any).pilots;
      const pilotUserId = String(pilot?.user_id || "");
      if (!pilotUserId) continue;

      const { data: app } = await supabase
        .from("pilot_applications")
        .select("id")
        .eq("user_id", pilotUserId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!app?.id) continue;

      const { data: session } = await supabase
        .from("recruitment_exam_sessions")
        .select("recruitment_channel_id, discord_user_id")
        .eq("application_id", app.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!session?.recruitment_channel_id) continue;

      const shortPid = String(pilot?.pid || "AFLV").replace(/^AFLV/i, "");
      const messageResponse = await discordApi(`/channels/${session.recruitment_channel_id}/messages`, {
        method: "POST",
        body: JSON.stringify({
          content: session.discord_user_id ? `<@${session.discord_user_id}>` : undefined,
          embeds: [{
            title: "AFLV | Practical Retest Assigned",
            color: 0x3498db,
            description: "Your 24-hour cooldown is complete. Practical retest is now active.",
            fields: [
              {
                name: "Practical Tasks",
                value: [
                  "1. Spawn at any gate at UUBW.",
                  "2. Taxi to RWY 30.",
                  "3. Depart straight and transition to UUDD pattern for RWY 32L.",
                  "4. Touch and go with proper UNICOM use.",
                  "5. Transition to UUDD RWY 32R downwind.",
                  "6. Touch and go, then depart to the northwest.",
                  "7. Proceed direct \"MR\" Moscow Shr. VOR.",
                  "8. Transition to pattern for landing at any runway at UUEE.",
                  "9. Land, park, and exit.",
                ].join("\n"),
              },
              { name: "Aircraft / Callsign", value: `ATYP - C172\nCALLSIGN - Aeroflot ${shortPid}CR` },
            ],
            timestamp: new Date().toISOString(),
          }],
          components: [{
            type: 1,
            components: [{
              type: 2,
              style: 3,
              custom_id: `${RECRUITMENT_PRACTICAL_REVIEW_PREFIX}passed:${(practical as any).id}`,
              label: "Pass",
            }, {
              type: 2,
              style: 4,
              custom_id: `${RECRUITMENT_PRACTICAL_REVIEW_PREFIX}failed:${(practical as any).id}`,
              label: "Fail",
            }],
          }],
        }),
      });

      if (!messageResponse.ok) continue;

      await supabase
        .from("academy_practicals")
        .update({ notes: `${notes}

[DISCORD_SENT] ${new Date().toISOString()}` })
        .eq("id", (practical as any).id);

      practicalRemindersSent++;
    }

    return Response.json({ ok: true, processed, sent, skipped, practicalRemindersSent });
  } catch (error: any) {
    console.error("recruitment-retest-cron failed", error);
    return Response.json({ ok: false, error: error?.message || "Unknown error" }, { status: 500 });
  }
});
