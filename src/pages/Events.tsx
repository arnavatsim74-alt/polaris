import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar, MapPin, Clock, Users, Plane, Check } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

function renderSimpleMarkdown(markdown?: string | null) {
  const text = markdown || "";

  const emojiTokens: string[] = [];
  const textWithEmojiTokens = text.replace(/<(?:(a)?):([a-zA-Z0-9_]+):(\d+)>/g, (_, animated: string, name: string, id: string) => {
    const ext = animated ? "gif" : "png";
    const safeName = name.replace(/[^a-zA-Z0-9_]/g, "");
    const safeId = id.replace(/\D/g, "");
    const emojiHtml = `<img src="https://cdn.discordapp.com/emojis/${safeId}.${ext}" alt=":${safeName}:" class="inline-block h-4 w-4 align-text-bottom" loading="lazy" />`;
    const token = `__DISCORD_EMOJI_${emojiTokens.length}__`;
    emojiTokens.push(emojiHtml);
    return token;
  });

  const escaped = textWithEmojiTokens
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const html = escaped
    .replace(/^### (.*)$/gm, "<h3>$1</h3>")
    .replace(/^## (.*)$/gm, "<h2>$1</h2>")
    .replace(/^# (.*)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/\n/g, "<br />");

  const withDiscordEmoji = emojiTokens.reduce((acc, emojiHtml, index) => (
    acc.replaceAll(`__DISCORD_EMOJI_${index}__`, emojiHtml)
  ), html);

  return { __html: withDiscordEmoji || "-" };
}

const formatLocalWithTimezone = (iso: string) => {
  const d = new Date(iso);
  const date = format(d, "MMM dd, HH:mm");
  const tz = new Intl.DateTimeFormat(undefined, { timeZoneName: "short" })
    .formatToParts(d)
    .find((p) => p.type === "timeZoneName")?.value || "Local";
  return `${date} ${tz}`;
};

export default function Events() {
  const { pilot } = useAuth();
  const queryClient = useQueryClient();

  const { data: events, isLoading } = useQuery({
    queryKey: ["events"],
    queryFn: async () => {
      const { data } = await supabase
        .from("events")
        .select("*")
        .eq("is_active", true)
        .gte("end_time", new Date().toISOString())
        .order("start_time");
      return data || [];
    },
  });

  const { data: registrations } = useQuery({
    queryKey: ["event-registrations", pilot?.id],
    queryFn: async () => {
      if (!pilot?.id) return [];
      const { data } = await supabase
        .from("event_registrations")
        .select("*")
        .eq("pilot_id", pilot.id);
      return data || [];
    },
    enabled: !!pilot?.id,
  });


  const { data: aircraft } = useQuery({
    queryKey: ["events-aircraft"],
    queryFn: async () => {
      const { data } = await supabase.from("aircraft").select("icao_code,livery");
      return data || [];
    },
  });

  const joinEventMutation = useMutation({
    mutationFn: async (eventId: string) => {
      if (!pilot?.id) throw new Error("Pilot not found");

      const { error } = await supabase.rpc("register_for_event", {
        p_event_id: eventId,
        p_pilot_id: pilot.id,
      });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["event-registrations"] });
      toast.success("Successfully registered for event!");
    },
    onError: (error) => {
      console.error(error);
      toast.error((error as any)?.message || "Failed to register for event");
    },
  });

  const isRegistered = (eventId: string) => {
    return registrations?.some((r) => r.event_id === eventId);
  };

  const getRegistration = (eventId: string) => {
    return registrations?.find((r) => r.event_id === eventId);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Calendar className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Events</h1>
          <p className="text-muted-foreground">Join upcoming group flights and events</p>
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-80" />
          ))}
        </div>
      ) : events && events.length > 0 ? (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {events.map((event) => {
            const registered = isRegistered(event.id);
            const registration = getRegistration(event.id);

            return (
              <Card key={event.id} className="overflow-hidden">
                {/* Full Banner */}
                <div className="relative">
                  {event.banner_url ? (
                    <img
                      src={event.banner_url}
                      alt={event.name}
                      className="w-full object-contain"
                    />
                  ) : (
                    <div className="h-40 bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                      <Plane className="h-16 w-16 text-primary/30" />
                    </div>
                  )}
                  <Badge className="absolute top-3 right-3">{event.server}</Badge>
                </div>

                <CardHeader>
                  <CardTitle className="line-clamp-1">{event.name}</CardTitle>
                  <CardDescription className="line-clamp-2">
                    <span dangerouslySetInnerHTML={renderSimpleMarkdown(event.description)} />
                  </CardDescription>
                </CardHeader>

                <CardContent className="space-y-4">
                  {/* Time */}
                  <div className="flex items-center gap-2 text-sm">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span>
                      {formatLocalWithTimezone(event.start_time)} - {formatLocalWithTimezone(event.end_time)}
                    </span>
                  </div>

                  {/* Route */}
                  <div className="flex items-center gap-2 text-sm">
                    <MapPin className="h-4 w-4 text-muted-foreground" />
                    <span className="font-mono">
                      {event.dep_icao} → {event.arr_icao}
                    </span>
                  </div>

                  {/* Aircraft */}
                  {(event as any).aircraft_icao && (
                    <div className="flex items-center gap-2 text-sm">
                      <Plane className="h-4 w-4 text-muted-foreground" />
                      <span>{(() => {
                        const eventName = String((event as any).aircraft_name || "");
                        const eventIcao = String((event as any).aircraft_icao || "");
                        const alreadyHasLivery = eventName.includes(" - ");
                        const fallbackLivery = aircraft?.find((a: any) => a.icao_code === eventIcao)?.livery;
                        const withLivery = !alreadyHasLivery && fallbackLivery ? `${eventName || eventIcao} - ${fallbackLivery}` : (eventName || eventIcao);
                        return withLivery || "Any";
                      })()}</span>
                    </div>
                  )}

                  {/* Gates if registered */}
                  {registered && registration && (
                    <div className="p-3 bg-muted rounded-lg text-sm space-y-1">
                      <p className="font-medium flex items-center gap-2">
                        <Check className="h-4 w-4 text-success" />
                        Registered
                      </p>
                      <p className="text-muted-foreground">
                        Departure Gate: {registration.assigned_dep_gate || "N/A"}
                      </p>
                      <p className="text-muted-foreground">
                        Arrival Gate: {registration.assigned_arr_gate || "N/A"}
                      </p>
                    </div>
                  )}

                  {/* Join Button */}
                  {!registered && (
                    <Button
                      className="w-full"
                      onClick={() => joinEventMutation.mutate(event.id)}
                      disabled={joinEventMutation.isPending}
                    >
                      <Users className="h-4 w-4 mr-2" />
                      Join Event
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <Calendar className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
            <p className="text-muted-foreground">No upcoming events</p>
            <p className="text-sm text-muted-foreground">Check back later for new events</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
