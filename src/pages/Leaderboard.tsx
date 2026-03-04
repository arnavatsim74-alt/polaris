import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Trophy, Medal, Clock, User } from "lucide-react";

const fallbackRankLabels: Record<string, string> = {
  cadet: "Cadet",
  first_officer: "First Officer",
  captain: "Captain",
  senior_captain: "Senior Captain",
  commander: "Commander",
};

export default function Leaderboard() {
  const { pilot } = useAuth();
  const [period, setPeriod] = useState("all");

  const { data: rankConfigs } = useQuery({
    queryKey: ["rank-configs"],
    queryFn: async () => {
      const { data } = await supabase
        .from("rank_configs")
        .select("name, label")
        .eq("is_active", true);
      return data || [];
    },
  });

  const rankDisplayNames: Record<string, string> = {};
  rankConfigs?.forEach((r) => {
    rankDisplayNames[r.name] = r.label;
  });

  const getRankLabel = (rank: string) =>
    rankDisplayNames[rank] || fallbackRankLabels[rank] || rank;

  const { data: pilots, isLoading } = useQuery({
    queryKey: ["leaderboard", period],
    queryFn: async () => {
      // For "all time" — just rank by total_hours on the pilots table
      if (period === "all") {
        const { data } = await supabase
          .from("pilots")
          .select("id, pid, full_name, total_hours, current_rank")
          .order("total_hours", { ascending: false })
          .limit(100);
        return data || [];
      }

      // For time-filtered periods — sum hours from pireps within the window
      const now = new Date();
      const cutoff = new Date();
      if (period === "month") cutoff.setDate(now.getDate() - 30);
      if (period === "week") cutoff.setDate(now.getDate() - 7);

      const { data: pireps } = await supabase
        .from("pireps")
        .select("pilot_id, flight_hours, pilots!pireps_pilot_id_fkey(id, pid, full_name, current_rank)")
        .eq("status", "approved")
        .gte("flight_date", cutoff.toISOString().split("T")[0]);

      if (!pireps) return [];

      // Aggregate hours per pilot
      const map = new Map<string, { id: string; pid: string; full_name: string; current_rank: string; total_hours: number }>();
      for (const p of pireps) {
        const pilot = p.pilots as any;
        if (!pilot) continue;
        const existing = map.get(pilot.id);
        if (existing) {
          existing.total_hours += Number(p.flight_hours) || 0;
        } else {
          map.set(pilot.id, {
            id: pilot.id,
            pid: pilot.pid,
            full_name: pilot.full_name,
            current_rank: pilot.current_rank,
            total_hours: Number(p.flight_hours) || 0,
          });
        }
      }

      return Array.from(map.values())
        .sort((a, b) => b.total_hours - a.total_hours)
        .slice(0, 100);
    },
  });

  const getRankBadge = (position: number) => {
    if (position === 0) return <Medal className="h-5 w-5 text-yellow-500" />;
    if (position === 1) return <Medal className="h-5 w-5 text-gray-400" />;
    if (position === 2) return <Medal className="h-5 w-5 text-amber-600" />;
    return <span className="text-muted-foreground font-mono w-5 text-center">{position + 1}</span>;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Trophy className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Leaderboard</h1>
            <p className="text-muted-foreground">Top pilots ranked by flight hours</p>
          </div>
        </div>
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Time period" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Time</SelectItem>
            <SelectItem value="month">Last 30 Days</SelectItem>
            <SelectItem value="week">Last 7 Days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Top 3 Cards */}
      {!isLoading && pilots && pilots.length >= 3 && (
        <div className="grid gap-4 md:grid-cols-3">
          {/* 2nd Place */}
          <Card className="order-1 md:order-1 border-gray-400/30">
            <CardContent className="pt-6 text-center">
              <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800">
                <Medal className="h-8 w-8 text-gray-400" />
              </div>
              <p className="text-lg font-bold">{pilots[1].full_name}</p>
              <p className="text-sm text-muted-foreground">{pilots[1].pid}</p>
              <Badge variant="secondary" className="mt-2 capitalize">
                {getRankLabel(pilots[1].current_rank)}
              </Badge>
              <p className="mt-3 text-2xl font-bold">{Number(pilots[1].total_hours).toFixed(1)} hrs</p>
            </CardContent>
          </Card>

          {/* 1st Place */}
          <Card className="order-0 md:order-0 border-yellow-500/30 bg-gradient-to-b from-yellow-500/5 to-transparent">
            <CardContent className="pt-6 text-center">
              <div className="mx-auto mb-3 flex h-20 w-20 items-center justify-center rounded-full bg-yellow-100 dark:bg-yellow-900/20">
                <Trophy className="h-10 w-10 text-yellow-500" />
              </div>
              <p className="text-xl font-bold">{pilots[0].full_name}</p>
              <p className="text-sm text-muted-foreground">{pilots[0].pid}</p>
              <Badge className="mt-2 capitalize bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 border-yellow-500/30">
                {getRankLabel(pilots[0].current_rank)}
              </Badge>
              <p className="mt-3 text-3xl font-bold">{Number(pilots[0].total_hours).toFixed(1)} hrs</p>
            </CardContent>
          </Card>

          {/* 3rd Place */}
          <Card className="order-2 md:order-2 border-amber-600/30">
            <CardContent className="pt-6 text-center">
              <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/20">
                <Medal className="h-8 w-8 text-amber-600" />
              </div>
              <p className="text-lg font-bold">{pilots[2].full_name}</p>
              <p className="text-sm text-muted-foreground">{pilots[2].pid}</p>
              <Badge variant="secondary" className="mt-2 capitalize">
                {getRankLabel(pilots[2].current_rank)}
              </Badge>
              <p className="mt-3 text-2xl font-bold">{Number(pilots[2].total_hours).toFixed(1)} hrs</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Full Leaderboard */}
      <Card>
        <CardHeader>
          <CardTitle>Full Rankings</CardTitle>
          <CardDescription>All pilots ordered by total flight hours</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : pilots && pilots.length > 0 ? (
            <div className="relative overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-2 font-medium w-12">#</th>
                    <th className="text-left py-3 px-2 font-medium">Pilot</th>
                    <th className="text-left py-3 px-2 font-medium">PID</th>
                    <th className="text-left py-3 px-2 font-medium">Rank</th>
                    <th className="text-right py-3 px-2 font-medium">Hours</th>
                  </tr>
                </thead>
                <tbody>
                  {pilots.map((p, index) => (
                    <tr
                      key={p.id}
                      className={`border-b last:border-0 hover:bg-muted/50 ${
                        p.id === pilot?.id ? "bg-primary/5" : ""
                      }`}
                    >
                      <td className="py-3 px-2">
                        <div className="flex items-center justify-center">
                          {getRankBadge(index)}
                        </div>
                      </td>
                      <td className="py-3 px-2">
                        <div className="flex items-center gap-2">
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground">
                            <User className="h-4 w-4" />
                          </div>
                          <span className="font-medium">
                            {p.full_name}
                            {p.id === pilot?.id && (
                              <Badge variant="secondary" className="ml-2">You</Badge>
                            )}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-2 text-muted-foreground font-mono">{p.pid}</td>
                      <td className="py-3 px-2">
                        <Badge variant="outline" className="capitalize">
                          {getRankLabel(p.current_rank)}
                        </Badge>
                      </td>
                      <td className="py-3 px-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Clock className="h-3 w-3 text-muted-foreground" />
                          <span className="font-medium">{Number(p.total_hours).toFixed(1)}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <Trophy className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No pilots found</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
