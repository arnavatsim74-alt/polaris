import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Plane, Clock, Award, TrendingUp, CreditCard } from "lucide-react";

interface BonusTier {
  id: string;
  name: string;
  min_hours: number;
  card_image_url: string | null;
  text_color: string;
  sort_order: number;
}

function getCurrentTier(tiers: BonusTier[], hours: number) {
  let tier: BonusTier | null = null;
  for (const t of tiers) {
    if (hours >= t.min_hours) tier = t;
  }
  return tier;
}

function getNextTier(tiers: BonusTier[], hours: number) {
  for (const t of tiers) {
    if (hours < t.min_hours) return t;
  }
  return null;
}

function generateCardNumber() {
  const segments = Array.from({ length: 4 }, () =>
    String(Math.floor(Math.random() * 10000)).padStart(4, "0")
  );
  return segments.join(" ");
}

export default function AflvBonus() {
  const { pilot } = useAuth();
  const queryClient = useQueryClient();
  const hours = pilot?.total_hours ?? 0;

  const { data: tiers = [] } = useQuery({
    queryKey: ["bonus-tiers"],
    queryFn: async () => {
      const { data } = await supabase.from("bonus_tiers").select("*").order("sort_order");
      return (data || []) as BonusTier[];
    },
  });

  const currentTier = getCurrentTier(tiers, hours);
  const nextTier = getNextTier(tiers, hours);

  const { data: bonusCard } = useQuery({
    queryKey: ["bonus-card", pilot?.id],
    queryFn: async () => {
      if (!pilot) return null;
      const { data } = await supabase
        .from("pilot_bonus_cards")
        .select("*")
        .eq("pilot_id", pilot.id)
        .maybeSingle();
      return data;
    },
    enabled: !!pilot,
  });

  const createCard = useMutation({
    mutationFn: async () => {
      if (!pilot) throw new Error("No pilot");
      const { data, error } = await supabase
        .from("pilot_bonus_cards")
        .insert({ pilot_id: pilot.id, card_number: generateCardNumber() })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bonus-card"] }),
  });

  const shouldCreate = !!pilot && bonusCard === null && !createCard.isPending;
  if (shouldCreate) createCard.mutate();

  const progressToNext = nextTier
    ? ((hours - (currentTier?.min_hours ?? 0)) / (nextTier.min_hours - (currentTier?.min_hours ?? 0))) * 100
    : 100;

  const cardNumber = bonusCard?.card_number ?? "•••• •••• •••• ••••";
  const defaultCardImage = tiers[0]?.card_image_url;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">AFLV Bonus</h1>
        <p className="text-muted-foreground">Aeroflot Virtual Group Frequent Flyer Program</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        {/* Card Display */}
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-wider text-muted-foreground">
              Your Frequent Flyer Card
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative aspect-[1172/690] w-full max-w-lg mx-auto">
              {(currentTier?.card_image_url || defaultCardImage) ? (
                <img
                  src={currentTier?.card_image_url ?? defaultCardImage!}
                  alt={`${currentTier?.name ?? "Standard"} tier card`}
                  className="w-full h-full object-contain rounded-xl shadow-2xl"
                />
              ) : (
                <div className="w-full h-full rounded-xl shadow-2xl bg-gradient-to-br from-muted to-muted-foreground/20 flex items-center justify-center">
                  <CreditCard className="h-16 w-16 text-muted-foreground/50" />
                </div>
              )}
              <div className={`absolute bottom-[18%] left-[8%] drop-shadow-lg ${currentTier?.text_color ?? "text-white"}`} style={{ fontFamily: "'Bank Gothic', 'Copperplate', 'Copperplate Gothic Bold', sans-serif" }}>
                <p className="text-xs md:text-sm opacity-90">{cardNumber}</p>
                <p className="text-lg md:text-xl font-bold uppercase">{pilot?.full_name ?? "Pilot"}</p>
              </div>
              <div className="absolute bottom-[8%] right-[8%]">
                <Badge variant="secondary" className={`text-xs font-bold bg-white/20 backdrop-blur border-white/30 ${currentTier?.text_color ?? "text-white"}`}>
                  {currentTier?.name ?? "Standard"}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Stats */}
        <div className="grid gap-4 grid-cols-1">
          <Card>
            <CardContent className="flex items-center gap-4 p-6">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <Clock className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Hours</p>
                <p className="text-2xl font-bold">{hours.toFixed(1)}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-4 p-6">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <Plane className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Flights</p>
                <p className="text-2xl font-bold">{pilot?.total_pireps ?? 0}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-4 p-6">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <Award className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Current Tier</p>
                <p className="text-2xl font-bold">{currentTier?.name ?? "Standard"}</p>
              </div>
            </CardContent>
          </Card>
          {nextTier && (
            <Card>
              <CardContent className="p-6 space-y-3">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-primary" />
                  <p className="text-sm text-muted-foreground">Progress to {nextTier.name}</p>
                </div>
                <Progress value={progressToNext} className="h-3" />
                <p className="text-xs text-muted-foreground">
                  {(nextTier.min_hours - hours).toFixed(1)} hours remaining
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* All Tiers */}
      {tiers.length > 0 && (
        <div>
          <h2 className="text-xl font-semibold mb-4">Tier Levels</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {tiers.map((tier) => {
              const unlocked = hours >= tier.min_hours;
              return (
                <Card key={tier.id} className={unlocked ? "ring-2 ring-primary" : "opacity-60"}>
                  <CardContent className="p-4 space-y-3">
                    {tier.card_image_url ? (
                      <div className="aspect-[1172/690] w-full overflow-hidden rounded-lg">
                        <img src={tier.card_image_url} alt={tier.name} className="w-full h-full object-contain" />
                      </div>
                    ) : (
                      <div className="aspect-[1172/690] w-full overflow-hidden rounded-lg bg-muted flex items-center justify-center">
                        <CreditCard className="h-8 w-8 text-muted-foreground/40" />
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">{tier.name}</span>
                      <Badge variant={unlocked ? "default" : "outline"}>
                        {unlocked ? "Unlocked" : `${tier.min_hours}h required`}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
