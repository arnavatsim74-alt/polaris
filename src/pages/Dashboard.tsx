import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Clock, FileText, Award, Hash, Flame, Plus } from "lucide-react";
import { Link } from "react-router-dom";
import { isSameDay } from "date-fns";
import aeroflotBanner from "@/assets/aeroflot-banner.jpg";
import { TodayROTW } from "@/components/dashboard/TodayROTW";
import { UpcomingEvents } from "@/components/dashboard/UpcomingEvents";
import { NotamCard } from "@/components/dashboard/NotamCard";
import { Announcements } from "@/components/dashboard/Announcements";
import { DailyFeaturedRoutes } from "@/components/dashboard/DailyFeaturedRoutes";
import { StatusBadge } from "@/components/StatusBadge";

export default function Dashboard() {
  const { pilot } = useAuth();

  const { data: settings } = useQuery({
    queryKey: ["site-settings"],
    queryFn: async () => {
      const { data } = await supabase.from("site_settings").select("*");
      return data || [];
    },
  });

  const heroImageUrl = settings?.find((s: any) => s.key === "dashboard_hero_url")?.value;

  const { data: ranks } = useQuery({
    queryKey: ["rank-configs"],
    queryFn: async () => {
      const { data } = await supabase
        .from("rank_configs")
        .select("*")
        .eq("is_active", true)
        .order("order_index");
      return data || [];
    },
  });

  const { data: recentPireps, isLoading: pirepsLoading } = useQuery({
    queryKey: ["recent-pireps", pilot?.id],
    queryFn: async () => {
      if (!pilot?.id) return [];
      const { data } = await supabase
        .from("pireps")
        .select("*")
        .eq("pilot_id", pilot.id)
        .order("created_at", { ascending: false })
        .limit(5);
      return data || [];
    },
    enabled: !!pilot?.id,
    refetchInterval: 30_000,
  });

  const { data: streak } = useQuery({
    queryKey: ["pilot-streak", pilot?.id],
    queryFn: async () => {
      if (!pilot?.id) return null;
      const { data } = await supabase
        .from("pilot_streaks")
        .select("*")
        .eq("pilot_id", pilot.id)
        .maybeSingle();
      return data;
    },
    enabled: !!pilot?.id,
    refetchInterval: 60_000,
  });

  // Calculate approved flight hours from PIREPs (with multiplier)
  const { data: approvedHours } = useQuery({
    queryKey: ["approved-flight-hours", pilot?.id],
    queryFn: async () => {
      if (!pilot?.id) return 0;
      const { data } = await supabase
        .from("pireps")
        .select("flight_hours, multiplier")
        .eq("pilot_id", pilot.id)
        .eq("status", "approved");
      return data?.reduce((sum, p) => sum + Number(p.flight_hours) * Number(p.multiplier || 1), 0) || 0;
    },
    enabled: !!pilot?.id,
    refetchInterval: 60_000,
  });

  const formatFlightTime = (hours: number) => {
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return `${h}h ${m}m`;
  };

  const getRankLabel = (rankName: string) => {
    const rank = ranks?.find((r) => r.name === rankName);
    return rank?.label || rankName.replace(/_/g, " ");
  };

  const totalHours = Number(approvedHours ?? pilot.total_hours ?? 0);
  const sortedRanks = [...(ranks || [])].sort((a, b) => a.order_index - b.order_index);
  const currentRankConfig = sortedRanks.find((r) => r.name === pilot.current_rank);
  const nextRankConfig = sortedRanks.find((r) => r.order_index > (currentRankConfig?.order_index ?? -1));
  const currentMin = Number(currentRankConfig?.min_hours ?? 0);
  const nextMin = Number(nextRankConfig?.min_hours ?? currentMin);
  const hoursInCurrentBand = Math.max(0, totalHours - currentMin);
  const hoursRequiredForNext = Math.max(1, nextMin - currentMin);
  const rankProgressPercent = nextRankConfig
    ? Math.min(100, Math.round((hoursInCurrentBand / hoursRequiredForNext) * 100))
    : 100;

  const streakMilestones = [3, 7, 14, 30, 60];
  const currentStreak = Number(streak?.current_streak || 0);

  const getDayName = (dayIndex: number) => {
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return days[dayIndex];
  };

  const getWeekDays = () => {
    const today = new Date();
    const days = [];
    const pirepDates = recentPireps?.map((p) => new Date(p.flight_date)) || [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(today.getDate() - i);
      days.push({
        name: getDayName(date.getDay()),
        date: date.getDate(),
        isToday: i === 0,
        hasPirep: pirepDates.some((d) => isSameDay(d, date)),
      });
    }
    return days;
  };

  if (!pilot) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-48 w-full rounded-xl" />
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Hero Banner */}
      <div className="relative h-48 rounded-xl overflow-hidden">
        <img
          src={heroImageUrl || aeroflotBanner}
          alt="Aircraft"
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-background/60 via-background/30 to-transparent" />
        <div className="relative z-10 h-full flex items-end p-6">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">
              Welcome back, {pilot.full_name.split(" ")[0]}!
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Ready for your next flight?
            </p>
          </div>
        </div>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium">Rank Progress</p>
            <p className="text-xs text-muted-foreground">
              {nextRankConfig ? `${totalHours.toFixed(1)}h / ${nextMin}h` : "Max rank reached"}
            </p>
          </div>
          <Progress value={rankProgressPercent} className="h-2" />
          <p className="text-xs text-muted-foreground mt-2">
            {nextRankConfig
              ? `${Math.max(0, nextMin - totalHours).toFixed(1)}h remaining to ${nextRankConfig.label}`
              : "You are at the highest available rank."}
          </p>
        </CardContent>
      </Card>

      {/* Announcements */}
      <Announcements />

      {/* NOTAMs Card */}
      <NotamCard />

      {/* Daily Featured Routes */}
      <DailyFeaturedRoutes />

      {/* Today's ROTW */}
      <TodayROTW />

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">
                  Rank
                </p>
                <p className="text-2xl font-bold mt-1 capitalize">
                  {getRankLabel(pilot.current_rank)}
                </p>
              </div>
              <Award className="h-5 w-5 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">
                  Flight Time
                </p>
                <p className="text-2xl font-bold mt-1">
                  {formatFlightTime(approvedHours ?? pilot.total_hours)}
                </p>
              </div>
              <Clock className="h-5 w-5 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">
                  PIREPs
                </p>
                <p className="text-2xl font-bold mt-1">{pilot.total_pireps}</p>
              </div>
              <FileText className="h-5 w-5 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">
                  Callsign
                </p>
                <p className="text-2xl font-bold mt-1">{pilot.pid}</p>
              </div>
              <Hash className="h-5 w-5 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Two Column Layout for Streak and Events */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Streak Card */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Streak</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div className="p-4 bg-muted rounded-lg flex-1">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-lg">Daily Flying Streak</h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      File a PIREP to keep your streak going.
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Flame className="h-10 w-10 text-primary" />
                    <div className="text-right">
                      <p className="text-3xl font-bold">
                        {streak?.current_streak || 0} Days
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Current Streak
                      </p>
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {streakMilestones.map((milestone) => {
                    const achieved = currentStreak >= milestone;
                    return (
                      <Badge key={milestone} variant={achieved ? "default" : "outline"}>
                        {achieved ? "🏅" : "🔒"} {milestone}d
                      </Badge>
                    );
                  })}
                </div>
              </div>

              <div className="flex gap-1">
                {getWeekDays().map((day, index) => (
                  <div key={index} className="text-center">
                    <p className="text-xs text-muted-foreground mb-1">
                      {day.name}
                    </p>
                    <div
                      className={`w-8 h-8 rounded flex items-center justify-center text-sm font-medium ${
                        day.hasPirep
                          ? "bg-primary text-primary-foreground"
                          : day.isToday
                          ? "bg-accent text-accent-foreground"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {day.date}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Upcoming Events */}
        <UpcomingEvents />
      </div>

      {/* New PIREP Button */}
      <Link to="/file-pirep">
        <Button
          variant="outline"
          className="w-full border-primary/20 text-primary hover:bg-primary/10"
        >
          <Plus className="h-4 w-4 mr-2" />
          New PIREP +
        </Button>
      </Link>

      {/* Latest PIREPs */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Latest 5 PIREPs</h2>
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted text-left">
                    <th className="px-4 py-3 font-medium text-muted-foreground">
                      Flight Number
                    </th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">
                      Departure
                    </th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">
                      Arrival
                    </th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pirepsLoading ? (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-4 py-8 text-center text-muted-foreground"
                      >
                        Loading...
                      </td>
                    </tr>
                  ) : recentPireps && recentPireps.length > 0 ? (
                    recentPireps.map((pirep) => (
                      <tr key={pirep.id} className="border-t border-border">
                        <td className="px-4 py-3">{pirep.flight_number}</td>
                        <td className="px-4 py-3">{pirep.dep_icao}</td>
                        <td className="px-4 py-3">{pirep.arr_icao}</td>
                        <td className="px-4 py-3">
                          <StatusBadge status={pirep.status} classMap={{ on_hold: "status-on-hold" }} />
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-4 py-8 text-center text-muted-foreground"
                      >
                        No PIREPs filed yet. File your first PIREP to get
                        started!
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
