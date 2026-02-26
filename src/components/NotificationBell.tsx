import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Bell } from "lucide-react";

export function NotificationBell() {
  const { pilot } = useAuth();
  const queryClient = useQueryClient();

  const { data: notifications } = useQuery({
    queryKey: ["notifications", pilot?.id],
    queryFn: async () => {
      if (!pilot?.id) return [];
      const { data } = await supabase
        .from("notifications")
        .select("*")
        .eq("recipient_pilot_id", pilot.id)
        .order("created_at", { ascending: false })
        .limit(30);
      return data || [];
    },
    enabled: !!pilot?.id,
    staleTime: 10_000,
    gcTime: 60_000,
    refetchInterval: 30000,
  });

  const unreadCount = notifications?.filter((n: any) => !n.is_read).length || 0;

  const markAllRead = async () => {
    if (!pilot?.id || unreadCount === 0) return;
    await supabase.from("notifications").update({ is_read: true }).eq("recipient_pilot_id", pilot.id).eq("is_read", false);
    queryClient.invalidateQueries({ queryKey: ["notifications", pilot.id] });
  };

  return (
    <Popover onOpenChange={(open) => open && markAllRead()}>
      <PopoverTrigger asChild>
        <Button size="icon" variant="ghost" className="relative">
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground text-[10px] min-w-4 h-4 rounded-full px-1 flex items-center justify-center">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="p-3 border-b font-medium text-sm">Notifications</div>
        <div className="max-h-96 overflow-y-auto">
          {!notifications?.length ? (
            <p className="text-sm text-muted-foreground p-4">No notifications yet.</p>
          ) : (
            notifications.map((n: any) => (
              <div key={n.id} className="p-3 border-b last:border-b-0">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium">{n.title}</p>
                  <Badge variant="outline" className="text-[10px] capitalize">{n.type.replace("_", " ")}</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{n.message}</p>
                <p className="text-[10px] text-muted-foreground mt-1">{new Date(n.created_at).toLocaleString()}</p>
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
