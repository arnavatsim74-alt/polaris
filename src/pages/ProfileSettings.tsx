import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { normalizeDiscordUsername } from "@/lib/discordIdentity";
import { UserCog } from "lucide-react";

const IFC_USER_ID_REGEX = /^\d{1,20}$/;

const parseIfcUserIdFromProfileUrl = (url: string | null | undefined) => {
  if (!url) return null;

  const directIdMatch = url.match(/\/u\/(\d+)/i);
  if (directIdMatch?.[1]) return directIdMatch[1];

  try {
    const parsed = new URL(url);
    const queryId = parsed.searchParams.get("id");
    if (queryId && IFC_USER_ID_REGEX.test(queryId)) return queryId;
  } catch {
    return null;
  }

  return null;
};

export default function ProfileSettings() {
  const { user, pilot, refreshPilot } = useAuth();
  const [discordUsername, setDiscordUsername] = useState("");
  const [ifcUserId, setIfcUserId] = useState("");
  const [isSavingDiscord, setIsSavingDiscord] = useState(false);
  const [isSavingIfc, setIsSavingIfc] = useState(false);

  const discordFromOAuth = useMemo(() => {
    const identity = user?.identities?.find((i) => i.provider === "discord");
    if (!identity) return "";

    const data = (identity.identity_data || {}) as Record<string, unknown>;
    const raw =
      (typeof data.username === "string" && data.username) ||
      (typeof data.global_name === "string" && data.global_name) ||
      (typeof data.preferred_username === "string" && data.preferred_username) ||
      "";

    return normalizeDiscordUsername(raw);
  }, [user]);

  useEffect(() => {
    if (pilot?.discord_username) {
      setDiscordUsername(pilot.discord_username);
      return;
    }
    if (discordFromOAuth) {
      setDiscordUsername(discordFromOAuth);
    }
  }, [pilot?.discord_username, discordFromOAuth]);

  useEffect(() => {
    if (pilot?.ifc_user_id) {
      setIfcUserId(pilot.ifc_user_id);
    }
  }, [pilot?.ifc_user_id]);

  useEffect(() => {
    const prefillIfcFromLegacyApplication = async () => {
      if (!user?.id || !pilot?.id || pilot.ifc_user_id) return;

      const { data: application, error } = await supabase
        .from("pilot_applications")
        .select("ifc_profile_url")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error || !application?.ifc_profile_url) return;

      const parsedLegacyIfcUserId = parseIfcUserIdFromProfileUrl(application.ifc_profile_url);
      if (parsedLegacyIfcUserId) {
        setIfcUserId(parsedLegacyIfcUserId);
      }
    };

    void prefillIfcFromLegacyApplication();
  }, [user?.id, pilot?.id, pilot?.ifc_user_id]);

  const saveDiscordUsername = async () => {
    if (!pilot?.id) return;

    const normalized = normalizeDiscordUsername(discordUsername);
    if (!normalized) {
      toast.error("Please enter a valid Discord username");
      return;
    }

    setIsSavingDiscord(true);
    const { error } = await supabase
      .from("pilots")
      .update({ discord_username: normalized })
      .eq("id", pilot.id);

    setIsSavingDiscord(false);

    if (error) {
      toast.error(error.message.includes("pilots_discord_username_key")
        ? "This Discord username is already linked to another pilot."
        : `Failed to save Discord username: ${error.message}`);
      return;
    }

    await refreshPilot();
    toast.success("Discord username saved");
  };

  const saveIfcUserId = async () => {
    if (!pilot?.id) return;

    const normalizedIfcId = ifcUserId.trim();
    if (normalizedIfcId && !IFC_USER_ID_REGEX.test(normalizedIfcId)) {
      toast.error("Infinite Flight Community ID must contain digits only (up to 20 characters)");
      return;
    }

    setIsSavingIfc(true);
    const { error } = await supabase
      .from("pilots")
      .update({ ifc_user_id: normalizedIfcId || null })
      .eq("id", pilot.id);

    setIsSavingIfc(false);

    if (error) {
      toast.error(`Failed to save IFC ID: ${error.message}`);
      return;
    }

    await refreshPilot();
    toast.success("Infinite Flight Community ID saved");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <UserCog className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Profile Settings</h1>
          <p className="text-muted-foreground">Manage your pilot profile preferences and Discord mapping</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Discord Username Mapping</CardTitle>
          <CardDescription>
            This is used as a fallback for Discord `/pirep` pilot mapping to ensure approved PIREPs credit the correct pilot hours.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 max-w-lg">
          <div className="space-y-2">
            <Label htmlFor="discord-username">Discord Username</Label>
            <Input
              id="discord-username"
              value={discordUsername}
              onChange={(e) => setDiscordUsername(e.target.value)}
              placeholder="e.g. itz._.a"
            />
            {discordFromOAuth && !pilot?.discord_username && (
              <p className="text-xs text-muted-foreground">
                We detected <span className="font-medium">{discordFromOAuth}</span> from your Discord OAuth profile.
              </p>
            )}
          </div>

          <Button onClick={saveDiscordUsername} disabled={isSavingDiscord || !pilot?.id}>
            {isSavingDiscord ? "Saving..." : "Save Discord Username"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Infinite Flight Community</CardTitle>
          <CardDescription>
            Store your IFC user ID for future integrations. This must be your numeric IFC account ID.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 max-w-lg">
          <div className="space-y-2">
            <Label htmlFor="ifc-user-id">Infinite Flight Community ID</Label>
            <Input
              id="ifc-user-id"
              value={ifcUserId}
              onChange={(e) => setIfcUserId(e.target.value)}
              placeholder="e.g. 123456"
            />
            <p className="text-xs text-muted-foreground">
              Numbers only. If left empty, the IFC ID will be cleared.
            </p>
          </div>

          <Button onClick={saveIfcUserId} disabled={isSavingIfc || !pilot?.id}>
            {isSavingIfc ? "Saving..." : "Save Infinite Flight Community ID"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
