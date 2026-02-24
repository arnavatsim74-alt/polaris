import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Shield, Image, Globe, Webhook, Save } from "lucide-react";
import { toast } from "sonner";

const WEBHOOK_KEYS = [
  { key: "DISCORD_WEBHOOK_URL", label: "Default Webhook", description: "Fallback webhook for all notifications" },
  { key: "DISCORD_WEBHOOK_PIREP", label: "PIREP Webhook", description: "New PIREP notifications" },
  { key: "DISCORD_WEBHOOK_RANK", label: "Rank Webhook", description: "Rank promotion notifications" },
  { key: "DISCORD_WEBHOOK_FEATURED", label: "Featured Route Webhook", description: "Featured route notifications" },
  { key: "DISCORD_WEBHOOK_CHALLENGES", label: "Challenges Webhook", description: "New challenge notifications" },
];

export default function AdminSettings() {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [trackerUrl, setTrackerUrl] = useState("");
  const [trackerDirty, setTrackerDirty] = useState(false);
  const [webhooks, setWebhooks] = useState<Record<string, string>>({});
  const [webhooksDirty, setWebhooksDirty] = useState(false);

  const { data: settings, isLoading } = useQuery({
    queryKey: ["site-settings"],
    queryFn: async () => {
      const { data } = await supabase.from("site_settings").select("*");
      return data || [];
    },
    meta: {
      onSuccess: (data: any[]) => {
        const tracker = data.find((s: any) => s.key === "tracker_embed_url")?.value || "";
        setTrackerUrl(tracker);
        // Load webhook settings
        const wh: Record<string, string> = {};
        WEBHOOK_KEYS.forEach(({ key }) => {
          wh[key] = data.find((s: any) => s.key === `webhook_${key}`)?.value || "";
        });
        setWebhooks(wh);
      },
    },
  });

  // Initialize state from settings when loaded
  const getSetting = (key: string) =>
    settings?.find((s: any) => s.key === key)?.value || "";

  // Sync tracker URL on settings load
  if (settings && !trackerDirty) {
    const t = getSetting("tracker_embed_url");
    if (t !== trackerUrl) setTrackerUrl(t);
  }
  if (settings && !webhooksDirty) {
    const wh: Record<string, string> = {};
    WEBHOOK_KEYS.forEach(({ key }) => {
      wh[key] = getSetting(`webhook_${key}`);
    });
    if (JSON.stringify(wh) !== JSON.stringify(webhooks)) setWebhooks(wh);
  }

  const saveSetting = async (key: string, value: string) => {
    const existing = settings?.find((s: any) => s.key === key);
    if (existing) {
      await supabase.from("site_settings").update({ value, updated_at: new Date().toISOString() }).eq("key", key);
    } else {
      await supabase.from("site_settings").insert({ key, value });
    }
    queryClient.invalidateQueries({ queryKey: ["site-settings"] });
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, settingKey: string, fileName: string) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const name = `${fileName}.${ext}`;
      const { error: uploadError } = await supabase.storage.from("site-assets").upload(name, file, { upsert: true });
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage.from("site-assets").getPublicUrl(name);
      await saveSetting(settingKey, publicUrl);
      toast.success("Image updated");
    } catch (err) {
      console.error(err);
      toast.error("Failed to upload image");
    } finally {
      setUploading(false);
    }
  };

  const saveWebhooks = async () => {
    try {
      for (const { key } of WEBHOOK_KEYS) {
        await saveSetting(`webhook_${key}`, webhooks[key] || "");
      }
      // Also update the actual edge function secrets via a note to the admin
      toast.success("Webhook URLs saved to settings. Note: To apply these to Discord notifications, update the corresponding secrets in your backend.");
      setWebhooksDirty(false);
    } catch {
      toast.error("Failed to save webhooks");
    }
  };

  if (!isAdmin) return <Navigate to="/" replace />;

  const bannerUrl = getSetting("auth_banner_url");
  const heroUrl = getSetting("dashboard_hero_url");
  const sidebarLogoUrl = getSetting("sidebar_logo_url");
  const authLogoUrl = getSetting("auth_logo_url");

  const ImageUploadCard = ({ title, desc, settingKey, fileName, currentUrl, previewAlt }: {
    title: string; desc: string; settingKey: string; fileName: string; currentUrl: string; previewAlt: string;
  }) => (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{desc}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? <Skeleton className="h-40 w-full" /> : (
          <>
            {currentUrl ? (
              <div className="relative h-40 rounded-lg overflow-hidden border">
                <img src={currentUrl} alt={previewAlt} className="w-full h-full object-cover" />
              </div>
            ) : (
              <div className="h-40 rounded-lg border border-dashed flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <Image className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Using default</p>
                </div>
              </div>
            )}
            <div>
              <Label>Upload New Image</Label>
              <div className="mt-2">
                <Input type="file" accept="image/*" onChange={(e) => handleImageUpload(e, settingKey, fileName)} disabled={uploading} />
              </div>
            </div>
            {currentUrl && (
              <Button variant="outline" size="sm" className="text-destructive" onClick={async () => { await saveSetting(settingKey, ""); toast.success("Reset to default"); }}>
                Reset to Default
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Shield className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Site Settings</h1>
          <p className="text-muted-foreground">Configure site-wide settings</p>
        </div>
      </div>


      {/* Logo Management */}
      <div className="grid gap-6 md:grid-cols-2">
        <ImageUploadCard title="Sidebar Logo" desc="Logo shown in the sidebar navigation" settingKey="sidebar_logo_url" fileName="sidebar-logo" currentUrl={sidebarLogoUrl} previewAlt="Sidebar logo" />
        <ImageUploadCard title="Auth Page Logo" desc="Logo shown on the login page" settingKey="auth_logo_url" fileName="auth-logo" currentUrl={authLogoUrl} previewAlt="Auth logo" />
      </div>

      {/* Banner Images */}
      <div className="grid gap-6 md:grid-cols-2">
        <ImageUploadCard title="Dashboard Hero Image" desc="Hero image shown on the dashboard" settingKey="dashboard_hero_url" fileName="dashboard-hero" currentUrl={heroUrl} previewAlt="Dashboard hero" />
        <ImageUploadCard title="Auth Page Banner" desc="Banner image on the login page" settingKey="auth_banner_url" fileName="auth-banner" currentUrl={bannerUrl} previewAlt="Auth banner" />
      </div>

      {/* Tracker Embed URL */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Globe className="h-5 w-5" />Tracker Embed URL</CardTitle>
          <CardDescription>URL for the tracker page embed. Leave empty to use default.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            value={trackerUrl}
            onChange={(e) => { setTrackerUrl(e.target.value); setTrackerDirty(true); }}
            placeholder="https://ramva-tracker.vercel.app/"
          />
          <Button onClick={async () => { await saveSetting("tracker_embed_url", trackerUrl); setTrackerDirty(false); toast.success("Tracker URL saved"); }} disabled={!trackerDirty}>
            <Save className="h-4 w-4 mr-2" />Save
          </Button>
        </CardContent>
      </Card>

      {/* Discord Webhooks */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Webhook className="h-5 w-5" />Discord Webhooks</CardTitle>
          <CardDescription>Configure Discord webhook URLs for notifications. These are stored as site settings for reference.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {WEBHOOK_KEYS.map(({ key, label, description }) => (
            <div key={key} className="space-y-1">
              <Label>{label}</Label>
              <p className="text-xs text-muted-foreground">{description}</p>
              <Input
                value={webhooks[key] || ""}
                onChange={(e) => { setWebhooks(prev => ({ ...prev, [key]: e.target.value })); setWebhooksDirty(true); }}
                placeholder="https://discord.com/api/webhooks/..."
              />
            </div>
          ))}
          <Button onClick={saveWebhooks} disabled={!webhooksDirty}>
            <Save className="h-4 w-4 mr-2" />Save Webhooks
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
