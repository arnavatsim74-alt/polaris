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

const parseIfcUsernameFromProfileValue = (value: string | null | undefined) => {
  if (!value) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  if (!trimmed.includes("/")) {
    return trimmed.replace(/^@+/, "");
  }

  const directUsernameMatch = trimmed.match(/\/u\/([^/?#]+)/i);
  if (directUsernameMatch?.[1]) return directUsernameMatch[1].replace(/^@+/, "");

  try {
    const parsed = new URL(trimmed);
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    const uIndex = pathParts.findIndex((part) => part.toLowerCase() === "u");
    if (uIndex >= 0 && pathParts[uIndex + 1]) {
      return pathParts[uIndex + 1].replace(/^@+/, "");
    }
  } catch {
    return null;
  }

  return null;
};

export default function ProfileSettings() {
  const { user, pilot, refreshPilot } = useAuth();
  const [discordUsername, setDiscordUsername] = useState("");
  const [ifcUsername, setIfcUsername] = useState("");
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
    if (pilot?.ifc_username) {
      setIfcUsername(pilot.ifc_username);
    }
  }, [pilot?.ifc_username]);

  useEffect(() => {
    const prefillIfcFromLegacyApplication = async () => {
      if (!user?.id || !pilot?.id || pilot.ifc_username) return;

      const { data: application, error } = await supabase
        .from("pilot_applications")
        .select("ifc_profile_url")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error || !application?.ifc_profile_url) return;

      const parsedLegacyIfcUsername = parseIfcUsernameFromProfileValue(application.ifc_profile_url);
      if (parsedLegacyIfcUsername) {
        setIfcUsername(parsedLegacyIfcUsername);
      }
    };

    void prefillIfcFromLegacyApplication();
  }, [user?.id, pilot?.id, pilot?.ifc_username]);

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

  const saveIfcUsername = async () => {
    if (!pilot?.id) return;

    const normalizedIfcUsername = ifcUsername.trim().replace(/^@+/, "");

    setIsSavingIfc(true);
    const { error } = await supabase
      .from("pilots")
      .update({ ifc_username: normalizedIfcUsername || null })
      .eq("id", pilot.id);

    setIsSavingIfc(false);

    if (error) {
      toast.error(`Failed to save IFC username: ${error.message}`);
      return;
    }

    await refreshPilot();
    toast.success("IFC username saved");
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
            Store your IFC username for validation and future integrations.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 max-w-lg">
          <div className="space-y-2">
            <Label htmlFor="ifc-user-id">Infinite Flight Community Username</Label>
            <Input
              id="ifc-user-id"
              value={ifcUsername}
              onChange={(e) => setIfcUsername(e.target.value)}
              placeholder="username without @"
            />
            <p className="text-xs text-muted-foreground">
              If left empty, the IFC username will be cleared.
            </p>
          </div>

          <Button onClick={saveIfcUsername} disabled={isSavingIfc || !pilot?.id}>
            {isSavingIfc ? "Saving..." : "Save IFC Username"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
