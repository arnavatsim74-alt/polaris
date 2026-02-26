import { useLocation, Link } from "react-router-dom";
import {
  LayoutDashboard, FileText, History, Route, Trophy, Calendar, Info, Shield, Users, Star, Plane, Award, Zap, Settings, AlertTriangle, Target, Megaphone, CreditCard, Link as LinkIcon, Globe, MessageCircle, ExternalLink, BookOpen, HelpCircle, MapPin, Activity,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarHeader, SidebarFooter, useSidebar,
} from "@/components/ui/sidebar";
import aeroflotLogo from "@/assets/aeroflot-logo.png";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

const ICON_MAP: Record<string, any> = {
  Link: LinkIcon, Globe, MessageCircle, ExternalLink, BookOpen, HelpCircle, Star, Plane, Award, Calendar, Trophy, Target,
};

const pilotNavItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Routes of the Week", url: "/rotw", icon: Star },
  { title: "File PIREP", url: "/file-pirep", icon: FileText },
  { title: "PIREP History", url: "/pirep-history", icon: History },
  { title: "Routes", url: "/routes", icon: Route },
  { title: "Challenges", url: "/challenges", icon: Target },
  { title: "Leaderboard", url: "/leaderboard", icon: Trophy },
  { title: "Events", url: "/events", icon: Calendar },
  { title: "Details", url: "/details", icon: Info },
  { title: "LATOUR Bonus", url: "/latourbonus", icon: CreditCard },
  { title: "Tracker", url: "/tracker", icon: MapPin },
  { title: "Academy", url: "/academy", icon: BookOpen },
  { title: "Activity", url: "/activity", icon: Activity },
];

const adminNavItems = [
  { title: "PIREPs", url: "/admin/pireps", icon: FileText },
  { title: "Routes", url: "/admin/routes", icon: Route },
  { title: "ROTW", url: "/admin/rotw", icon: Star },
  { title: "Events", url: "/admin/events", icon: Calendar },
  { title: "Aircraft", url: "/admin/aircraft", icon: Plane },
  { title: "Ranks", url: "/admin/ranks", icon: Award },
  { title: "Multipliers", url: "/admin/multipliers", icon: Zap },
  { title: "NOTAMs", url: "/admin/notams", icon: AlertTriangle },
  { title: "Members", url: "/admin/members", icon: Users },
  { title: "Challenges", url: "/admin/challenges", icon: Target },
  { title: "Announcements", url: "/admin/announcements", icon: Megaphone },
  { title: "Applications", url: "/admin/applications", icon: Users },
  { title: "Settings", url: "/admin/settings", icon: Settings },
  { title: "Sidebar Links", url: "/admin/sidebar-links", icon: LinkIcon },
  { title: "Academy", url: "/admin/academy", icon: BookOpen },
  { title: "Bonus Tiers", url: "/admin/bonus-tiers", icon: CreditCard },
  { title: "Activity", url: "/admin/activity", icon: Activity },
];

export function AppSidebar() {
  const location = useLocation();
  const { pilot, isAdmin } = useAuth();
  const { state, isMobile, setOpenMobile } = useSidebar();
  const isCollapsed = state === "collapsed";

  const { data: customLinks = [] } = useQuery({
    queryKey: ["custom-sidebar-links"],
    queryFn: async () => {
      const { data } = await supabase
        .from("custom_sidebar_links")
        .select("*")
        .eq("is_active", true)
        .order("sort_order");
      return data ?? [];
    },
    staleTime: Infinity,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  const { data: sidebarLogoUrl } = useQuery({
    queryKey: ["site-settings-sidebar-logo"],
    queryFn: async () => {
      const { data } = await supabase
        .from("site_settings")
        .select("value")
        .eq("key", "sidebar_logo_url")
        .maybeSingle();
      return data?.value || "";
    },
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
  });

  const logoSrc = sidebarLogoUrl || aeroflotLogo;

  const isActive = (path: string) => {
    if (path === "/") return location.pathname === "/";
    return location.pathname.startsWith(path);
  };

  const handleNavClick = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <div className={cn("flex items-center gap-3 px-3 py-2", isCollapsed && "justify-center")}>
          <img src={logoSrc} alt="LATOUR Virtual" className={cn("w-auto object-contain", isCollapsed ? "h-8" : "h-10")} />
        </div>
      </SidebarHeader>

      <SidebarContent className="pb-2 scrollbar-hide">
        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] uppercase tracking-wider">Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {pilotNavItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title} className="h-9">
                    <Link to={item.url} onClick={handleNavClick}>
                      <item.icon className="h-4 w-4" />
                      <span className="text-sm">{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {customLinks.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-[10px] uppercase tracking-wider">Links</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {customLinks.map((link: any) => {
                  const Icon = ICON_MAP[link.icon] || LinkIcon;
                  const isExternal = link.url.startsWith("http");
                  return (
                    <SidebarMenuItem key={link.id}>
                      <SidebarMenuButton asChild tooltip={link.title} className="h-9">
                        {isExternal ? (
                          <a href={link.url} target="_blank" rel="noopener noreferrer" onClick={handleNavClick}>
                            <Icon className="h-4 w-4" />
                            <span className="text-sm">{link.title}</span>
                          </a>
                        ) : (
                          <Link to={link.url} onClick={handleNavClick}>
                            <Icon className="h-4 w-4" />
                            <span className="text-sm">{link.title}</span>
                          </Link>
                        )}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {isAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-[10px] uppercase tracking-wider">
              <Shield className="h-3 w-3 mr-1" />Admin
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {adminNavItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title} className="h-9">
                      <Link to={item.url} onClick={handleNavClick}>
                        <item.icon className="h-4 w-4" />
                        <span className="text-sm">{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="mt-auto border-t border-sidebar-border pb-2">
        {pilot && !isCollapsed && (
          <div className="px-3 py-2">
            <div className="flex items-center gap-3">
              <Avatar className="h-8 w-8">
                <AvatarImage src={pilot.avatar_url || undefined} alt={pilot.full_name} />
                <AvatarFallback className="bg-sidebar-accent text-sidebar-accent-foreground text-xs font-medium">
                  {pilot.full_name.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-col">
                <span className="text-xs font-medium text-sidebar-foreground">{pilot.pid}</span>
                <span className="text-xs text-sidebar-foreground/70 capitalize">{pilot.current_rank.replace(/_/g, " ")}</span>
              </div>
            </div>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
