import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Shield, Plus, Trash2, Calendar, Users, Upload, Image as ImageIcon, Plane, RefreshCw, Pencil } from "lucide-react";
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

type EventForm = {
  name: string;
  description: string;
  server: string;
  start_time: string;
  end_time: string;
  dep_icao: string;
  arr_icao: string;
  aircraft_icao: string;
  aircraft_name: string;
  aircraft_id: string;
  available_dep_gates: string;
  available_arr_gates: string;
};

type AircraftRow = {
  id: string;
  icao_code: string;
  name: string;
  livery: string | null;
};

const formatZuluDateTime = (iso: string) => {
  const d = new Date(iso);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}Z`;
};

const emptyEventForm: EventForm = {
  name: "",
  description: "",
  server: "Expert",
  start_time: "",
  end_time: "",
  dep_icao: "",
  arr_icao: "",
  aircraft_icao: "",
  aircraft_name: "",
  aircraft_id: "",
  available_dep_gates: "",
  available_arr_gates: "",
};

function EventFormFields({
  value,
  setValue,
  mode,
  aircraft,
  isFetchingGates,
  onFetchGates,
  onBannerChange,
}: {
  value: EventForm;
  setValue: (next: EventForm) => void;
  mode: "add" | "edit";
  aircraft: AircraftRow[];
  isFetchingGates: boolean;
  onFetchGates: (icao: string, type: "dep" | "arr", mode: "add" | "edit") => void;
  onBannerChange: (file: File | null) => void;
}) {
  const formatAircraftLabel = (ac: AircraftRow) => `${ac.name} (${ac.icao_code})${ac.livery ? ` - ${ac.livery}` : ""}`;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Event Name *</Label>
        <Input value={value.name} onChange={(e) => setValue({ ...value, name: e.target.value })} placeholder="Weekly Group Flight" />
      </div>
      <div className="space-y-2">
        <Label>Description</Label>
        <Textarea value={value.description} onChange={(e) => setValue({ ...value, description: e.target.value })} placeholder="Join us for a scenic route..." rows={3} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Server *</Label>
          <Select value={value.server} onValueChange={(v) => setValue({ ...value, server: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Expert">Expert</SelectItem>
              <SelectItem value="Training">Training</SelectItem>
              <SelectItem value="Casual">Casual</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Aircraft</Label>
          <Select
            value={value.aircraft_id || "none"}
            onValueChange={(v) => {
              if (v === "none") {
                setValue({ ...value, aircraft_id: "", aircraft_icao: "", aircraft_name: "" });
                return;
              }
              const selectedAircraft = aircraft.find((ac) => ac.id === v);
              if (!selectedAircraft) return;
              const displayName = `${selectedAircraft.name}${selectedAircraft.livery ? ` - ${selectedAircraft.livery}` : ""}`;
              setValue({ ...value, aircraft_id: selectedAircraft.id, aircraft_icao: selectedAircraft.icao_code, aircraft_name: displayName });
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Any aircraft" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Any aircraft</SelectItem>
              {aircraft.map((ac) => (
                <SelectItem key={ac.id} value={ac.id}>{formatAircraftLabel(ac)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Start Time *</Label>
          <Input type="datetime-local" value={value.start_time} onChange={(e) => setValue({ ...value, start_time: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label>End Time *</Label>
          <Input type="datetime-local" value={value.end_time} onChange={(e) => setValue({ ...value, end_time: e.target.value })} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Departure ICAO *</Label>
          <Input value={value.dep_icao} onChange={(e) => setValue({ ...value, dep_icao: e.target.value.toUpperCase() })} placeholder="KJFK" maxLength={4} />
        </div>
        <div className="space-y-2">
          <Label>Arrival ICAO *</Label>
          <Input value={value.arr_icao} onChange={(e) => setValue({ ...value, arr_icao: e.target.value.toUpperCase() })} placeholder="EGLL" maxLength={4} />
        </div>
      </div>

      {mode === "add" && (
        <div className="space-y-2">
          <Label className="flex items-center gap-2"><ImageIcon className="h-4 w-4" /> Banner Image (optional)</Label>
          <Input type="file" accept="image/*" onChange={(e) => onBannerChange(e.target.files?.[0] || null)} />
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Available Departure Gates</Label>
            <Button type="button" size="sm" variant="outline" onClick={() => onFetchGates(value.dep_icao, "dep", mode)} disabled={isFetchingGates || !value.dep_icao}>
              <RefreshCw className={`h-3 w-3 mr-1 ${isFetchingGates ? "animate-spin" : ""}`} /> Auto-fetch
            </Button>
          </div>
          <Input value={value.available_dep_gates} onChange={(e) => setValue({ ...value, available_dep_gates: e.target.value })} placeholder="A1, A2, A3" />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Available Arrival Gates</Label>
            <Button type="button" size="sm" variant="outline" onClick={() => onFetchGates(value.arr_icao, "arr", mode)} disabled={isFetchingGates || !value.arr_icao}>
              <RefreshCw className={`h-3 w-3 mr-1 ${isFetchingGates ? "animate-spin" : ""}`} /> Auto-fetch
            </Button>
          </div>
          <Input value={value.available_arr_gates} onChange={(e) => setValue({ ...value, available_arr_gates: e.target.value })} placeholder="T1, T2, T3" />
        </div>
      </div>
    </div>
  );
}

export default function AdminEvents() {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isFetchingGates, setIsFetchingGates] = useState(false);
  const [newEvent, setNewEvent] = useState<EventForm>(emptyEventForm);
  const [editEvent, setEditEvent] = useState<EventForm>(emptyEventForm);

  const { data: events, isLoading } = useQuery({
    queryKey: ["admin-events"],
    queryFn: async () => {
      const { data } = await supabase.from("events").select("*").order("start_time", { ascending: false });
      return data || [];
    },
  });

  const { data: registrations } = useQuery({
    queryKey: ["admin-event-registrations"],
    queryFn: async () => {
      const { data } = await supabase.from("event_registrations").select("event_id");
      return data || [];
    },
  });

  const { data: aircraft = [] } = useQuery({
    queryKey: ["aircraft-list"],
    queryFn: async () => {
      const { data } = await supabase.from("aircraft").select("*").order("name");
      return data || [];
    },
  });

  const notifyDiscordEventUpdate = async (type: "event_created" | "event_updated", payload: any) => {
    try {
      await supabase.functions.invoke("discord-rank-notification", {
        body: {
          type,
          ...payload,
        },
      });
    } catch (e) {
      console.error("Discord event notification failed:", e);
    }
  };

  const fetchGatesFromIfatc = async (icao: string, type: "dep" | "arr", mode: "add" | "edit") => {
    if (!icao || icao.length < 3) {
      toast.error("Enter a valid ICAO code first");
      return;
    }
    const form = mode === "add" ? newEvent : editEvent;
    setIsFetchingGates(true);
    try {
      const { data, error } = await supabase.functions.invoke("fetch-gates", {
        body: { icao: icao.toUpperCase(), aircraft_icao: form.aircraft_icao || undefined },
      });
      if (error) throw error;
      const gates = data?.gates || [];
      if (gates.length > 0) {
        const gateStr = gates.map((g: any) => (typeof g === "string" ? g : g.name)).join(", ");
        if (mode === "add") {
          setNewEvent((prev) => ({ ...prev, [type === "dep" ? "available_dep_gates" : "available_arr_gates"]: gateStr }));
        } else {
          setEditEvent((prev) => ({ ...prev, [type === "dep" ? "available_dep_gates" : "available_arr_gates"]: gateStr }));
        }
        toast.success(`Fetched ${gates.length} compatible gates for ${icao.toUpperCase()}`);
      } else {
        toast.info("No compatible gates found — you can enter them manually");
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to fetch gates — enter them manually");
    } finally {
      setIsFetchingGates(false);
    }
  };

  const getRegistrationCount = (eventId: string) => registrations?.filter((r) => r.event_id === eventId).length || 0;

  const addEventMutation = useMutation({
    mutationFn: async (event: EventForm) => {
      setIsUploading(true);
      let bannerUrl = null;
      if (bannerFile) {
        const fileExt = bannerFile.name.split(".").pop();
        const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
        const { error: uploadError } = await supabase.storage.from("event-banners").upload(fileName, bannerFile);
        if (uploadError) throw uploadError;
        const { data } = supabase.storage.from("event-banners").getPublicUrl(fileName);
        bannerUrl = data.publicUrl;
      }

      const selectedAc = aircraft.find((ac) => ac.id === event.aircraft_id);

      const payload = {
        name: event.name,
        description: event.description,
        server: event.server,
        start_time: event.start_time,
        end_time: event.end_time,
        dep_icao: event.dep_icao.toUpperCase(),
        arr_icao: event.arr_icao.toUpperCase(),
        aircraft_icao: event.aircraft_icao || null,
        aircraft_name: event.aircraft_name || null,
        banner_url: bannerUrl,
        available_dep_gates: event.available_dep_gates ? event.available_dep_gates.split(",").map((g) => g.trim()).filter(Boolean) : [],
        available_arr_gates: event.available_arr_gates ? event.available_arr_gates.split(",").map((g) => g.trim()).filter(Boolean) : [],
      } as any;

      const { data, error } = await supabase.from("events").insert(payload).select("*").single();
      if (error) throw error;

      await notifyDiscordEventUpdate("event_created", { ...payload, livery: selectedAc?.livery || null });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-events"] });
      toast.success("Event created successfully");
      setIsAddDialogOpen(false);
      setBannerFile(null);
      setNewEvent(emptyEventForm);
    },
    onError: (error: any) => toast.error(error?.message ? `Failed to create event: ${error.message}` : "Failed to create event"),
    onSettled: () => setIsUploading(false),
  });

  const editEventMutation = useMutation({
    mutationFn: async (event: EventForm) => {
      if (!editingEventId) throw new Error("No event selected");

      const selectedAc = aircraft.find((ac) => ac.id === event.aircraft_id);

      const payload = {
        name: event.name,
        description: event.description,
        server: event.server,
        start_time: event.start_time,
        end_time: event.end_time,
        dep_icao: event.dep_icao.toUpperCase(),
        arr_icao: event.arr_icao.toUpperCase(),
        aircraft_icao: event.aircraft_icao || null,
        aircraft_name: event.aircraft_name || null,
        available_dep_gates: event.available_dep_gates ? event.available_dep_gates.split(",").map((g) => g.trim()).filter(Boolean) : [],
        available_arr_gates: event.available_arr_gates ? event.available_arr_gates.split(",").map((g) => g.trim()).filter(Boolean) : [],
      } as any;

      const { data, error } = await supabase.from("events").update(payload).eq("id", editingEventId).select("*").single();
      if (error) throw error;

      await notifyDiscordEventUpdate("event_updated", { ...payload, livery: selectedAc?.livery || null });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-events"] });
      queryClient.invalidateQueries({ queryKey: ["events"] });
      toast.success("Event updated. Discord embed refreshed.");
      setIsEditDialogOpen(false);
      setEditingEventId(null);
    },
    onError: (error: any) => toast.error(error?.message ? `Failed to update event: ${error.message}` : "Failed to update event"),
  });

  const deleteEventMutation = useMutation({
    mutationFn: async (eventId: string) => {
      const { error } = await supabase.from("events").delete().eq("id", eventId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-events"] });
      toast.success("Event deleted");
    },
    onError: () => toast.error("Failed to delete event"),
  });

  const openEditDialog = (event: any) => {
    setEditingEventId(event.id);
    setEditEvent({
      name: event.name || "",
      description: event.description || "",
      server: event.server || "Expert",
      start_time: event.start_time ? String(event.start_time).slice(0, 16) : "",
      end_time: event.end_time ? String(event.end_time).slice(0, 16) : "",
      dep_icao: event.dep_icao || "",
      arr_icao: event.arr_icao || "",
      aircraft_icao: event.aircraft_icao || "",
      aircraft_name: event.aircraft_name || "",
      aircraft_id: (aircraft.find((ac) => ac.icao_code === event.aircraft_icao && (`${ac.name}${ac.livery ? ` - ${ac.livery}` : ""}` === (event.aircraft_name || "")))?.id) || "",
      available_dep_gates: Array.isArray(event.available_dep_gates) ? event.available_dep_gates.join(", ") : "",
      available_arr_gates: Array.isArray(event.available_arr_gates) ? event.available_arr_gates.join(", ") : "",
    });
    setIsEditDialogOpen(true);
  };

  if (!isAdmin) return <Navigate to="/" replace />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Shield className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Event Management</h1>
            <p className="text-muted-foreground">Create, edit and manage flight events</p>
          </div>
        </div>

        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Add Event
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create New Event</DialogTitle>
              <DialogDescription>Create a new community event</DialogDescription>
            </DialogHeader>
            <EventFormFields
              value={newEvent}
              setValue={setNewEvent}
              mode="add"
              aircraft={aircraft as AircraftRow[]}
              isFetchingGates={isFetchingGates}
              onFetchGates={fetchGatesFromIfatc}
              onBannerChange={setBannerFile}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>Cancel</Button>
              <Button onClick={() => addEventMutation.mutate(newEvent)} disabled={addEventMutation.isPending || isUploading}>
                {isUploading && <Upload className="h-4 w-4 mr-2 animate-spin" />}
                Create Event
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Events</CardTitle>
          <CardDescription>{events?.length || 0} events</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
          ) : events && events.length > 0 ? (
            <div className="relative overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-2 font-medium">Event</th>
                    <th className="text-left py-3 px-2 font-medium">Server</th>
                    <th className="text-left py-3 px-2 font-medium">Route</th>
                    <th className="text-left py-3 px-2 font-medium">Date</th>
                    <th className="text-left py-3 px-2 font-medium">Registrations</th>
                    <th className="text-left py-3 px-2 font-medium">Status</th>
                    <th className="text-right py-3 px-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => {
                    const isPast = new Date(event.end_time) < new Date();
                    const isOngoing = new Date(event.start_time) <= new Date() && new Date(event.end_time) >= new Date();
                    return (
                      <tr key={event.id} className="border-b last:border-0 hover:bg-muted/50">
                      <td className="py-3 px-2">
                          <p className="font-medium">{event.name}</p>
                          <p className="text-xs text-muted-foreground line-clamp-1"><span dangerouslySetInnerHTML={renderSimpleMarkdown(event.description)} /></p>
                        </td>
                        <td className="py-3 px-2"><Badge variant="secondary">{event.server}</Badge></td>
                        <td className="py-3 px-2 font-mono">{event.dep_icao} → {event.arr_icao}</td>
                        <td className="py-3 px-2">{formatZuluDateTime(event.start_time)}</td>
                        <td className="py-3 px-2"><div className="flex items-center gap-1"><Users className="h-3 w-3 text-muted-foreground" />{getRegistrationCount(event.id)}</div></td>
                        <td className="py-3 px-2">
                          {isPast ? <Badge variant="secondary">Ended</Badge> : isOngoing ? <Badge className="bg-success text-success-foreground">Ongoing</Badge> : <Badge variant="outline">Upcoming</Badge>}
                        </td>
                        <td className="py-3 px-2 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEditDialog(event)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <ConfirmDialog trigger={<Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"><Trash2 className="h-4 w-4" /></Button>} title="Delete Event?" description="This event and all registrations will be permanently deleted." onConfirm={() => deleteEventMutation.mutate(event.id)} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <Calendar className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No events found</p>
              <p className="text-sm">Create your first event</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Event</DialogTitle>
            <DialogDescription>Update event details. A refreshed Discord embed will be sent.</DialogDescription>
          </DialogHeader>
          <EventFormFields
            value={editEvent}
            setValue={setEditEvent}
            mode="edit"
            aircraft={aircraft as AircraftRow[]}
            isFetchingGates={isFetchingGates}
            onFetchGates={fetchGatesFromIfatc}
            onBannerChange={setBannerFile}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => editEventMutation.mutate(editEvent)} disabled={editEventMutation.isPending}>
              <Plane className="h-4 w-4 mr-2" />
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
