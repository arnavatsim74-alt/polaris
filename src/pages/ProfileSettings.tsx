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

export default function ProfileSettings() {
  const { user, pilot, refreshPilot } = useAuth();
  const [discordUsername, setDiscordUsername] = useState("");
  const [isSaving, setIsSaving] = useState(false);

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

  const saveDiscordUsername = async () => {
    if (!pilot?.id) return;

    const normalized = normalizeDiscordUsername(discordUsername);
    if (!normalized) {
      toast.error("Please enter a valid Discord username");
      return;
    }

    setIsSaving(true);
    const { error } = await supabase
      .from("pilots")
      .update({ discord_username: normalized })
      .eq("id", pilot.id);

    setIsSaving(false);

    if (error) {
      toast.error(error.message.includes("pilots_discord_username_key")
        ? "This Discord username is already linked to another pilot."
        : `Failed to save Discord username: ${error.message}`);
      return;
    }

    await refreshPilot();
    toast.success("Discord username saved");
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

          <Button onClick={saveDiscordUsername} disabled={isSaving || !pilot?.id}>
            {isSaving ? "Saving..." : "Save Discord Username"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
