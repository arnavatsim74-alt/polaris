import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { History, Search, FileText } from "lucide-react";
import { format } from "date-fns";
import { StatusBadge } from "@/components/StatusBadge";

export default function PirepHistory() {
  const { pilot } = useAuth();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const { data: pireps, isLoading } = useQuery({
    queryKey: ["pireps", pilot?.id],
    queryFn: async () => {
      if (!pilot?.id) return [];
      const { data } = await supabase
        .from("pireps")
        .select("*")
        .eq("pilot_id", pilot.id)
        .order("created_at", { ascending: false });
      return data || [];
    },
    enabled: !!pilot?.id,
  });

  const filteredPireps = pireps?.filter((pirep) => {
    const matchesStatus = statusFilter === "all" || pirep.status === statusFilter;
    const matchesSearch =
      searchQuery === "" ||
      pirep.flight_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
      pirep.dep_icao.toLowerCase().includes(searchQuery.toLowerCase()) ||
      pirep.arr_icao.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <History className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">PIREP History</h1>
          <p className="text-muted-foreground">View all your submitted flight reports</p>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by flight number or ICAO..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full md:w-48">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="denied">Denied</SelectItem>
                <SelectItem value="on_hold">On Hold</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* PIREPs Table */}
      <Card>
        <CardHeader>
          <CardTitle>Flight Reports</CardTitle>
          <CardDescription>
            {filteredPireps?.length || 0} PIREPs found
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : filteredPireps && filteredPireps.length > 0 ? (
            <div className="relative overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-2 font-medium">Date</th>
                    <th className="text-left py-3 px-2 font-medium">Flight</th>
                    <th className="text-left py-3 px-2 font-medium">Route</th>
                    <th className="text-left py-3 px-2 font-medium">Aircraft</th>
                    <th className="text-left py-3 px-2 font-medium">Hours</th>
                    <th className="text-left py-3 px-2 font-medium">Operator</th>
                    <th className="text-left py-3 px-2 font-medium">Type</th>
                    <th className="text-left py-3 px-2 font-medium">PAX/Cargo</th>
                    <th className="text-left py-3 px-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPireps.map((pirep) => (
                    <tr key={pirep.id} className="border-b last:border-0 hover:bg-muted/50">
                      <td className="py-3 px-2">
                        {format(new Date(pirep.flight_date), "MMM dd, yyyy")}
                      </td>
                      <td className="py-3 px-2 font-medium">{pirep.flight_number}</td>
                      <td className="py-3 px-2">
                        <span className="font-mono">
                          {pirep.dep_icao} → {pirep.arr_icao}
                        </span>
                      </td>
                      <td className="py-3 px-2">{pirep.aircraft_icao}</td>
                      <td className="py-3 px-2">
                        {Number(pirep.flight_hours).toFixed(1)}
                        {Number(pirep.multiplier) !== 1 && (
                          <span className="text-xs text-muted-foreground ml-1">
                            (×{pirep.multiplier})
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-2 text-muted-foreground">{pirep.operator}</td>
                      <td className="py-3 px-2">
                        <Badge variant="secondary" className="capitalize">
                          {pirep.flight_type}
                        </Badge>
                      </td>
                      <td className="py-3 px-2 text-muted-foreground">
                        {(pirep.pax ?? 0) > 0 ? `${pirep.pax} pax` : "-"}
                        {(pirep.cargo_kg ?? 0) > 0 ? ` / ${pirep.cargo_kg} kg` : ""}
                      </td>
                      <td className="py-3 px-2">
                        <div><StatusBadge status={pirep.status} classMap={{ on_hold: "status-on-hold" }} /></div>
                        {pirep.status_reason && (pirep.status === "denied" || pirep.status === "on_hold") && (
                          <p className="text-xs text-muted-foreground mt-1 max-w-[200px]" title={pirep.status_reason}>
                            Note: {pirep.status_reason}
                          </p>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No PIREPs found</p>
              <p className="text-sm">
                {searchQuery || statusFilter !== "all"
                  ? "Try adjusting your filters"
                  : "File your first PIREP to see it here"}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
