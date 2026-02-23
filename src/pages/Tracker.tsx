import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const DEFAULT_TRACKER_URL = "https://ramva-tracker.lovable.app/";

export default function Tracker() {
  const { data: trackerUrl } = useQuery({
    queryKey: ["site-settings-tracker"],
    queryFn: async () => {
      const { data } = await supabase
        .from("site_settings")
        .select("value")
        .eq("key", "tracker_embed_url")
        .maybeSingle();
      return data?.value || DEFAULT_TRACKER_URL;
    },
  });

  return (
    <div className="-mx-4 -my-6 md:-mx-6 lg:-mx-8" style={{ height: "calc(100vh - 3.5rem)" }}>
      <iframe
        src={trackerUrl || DEFAULT_TRACKER_URL}
        className="w-full h-full border-0"
        title="AFLV Tracker"
        allow="fullscreen"
      />
    </div>
  );
}
