import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { CreditCard, Plus, Trash2, Edit, Upload, Image } from "lucide-react";
import { toast } from "sonner";

interface BonusTier {
  id: string;
  name: string;
  min_hours: number;
  card_image_url: string | null;
  text_color: string;
  sort_order: number;
}

export default function AdminBonusTiers() {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<BonusTier | null>(null);
  const [form, setForm] = useState({ name: "", min_hours: 0, text_color: "text-white", sort_order: 0 });
  const [uploading, setUploading] = useState(false);

  const { data: tiers = [], isLoading } = useQuery({
    queryKey: ["bonus-tiers"],
    queryFn: async () => {
      const { data } = await supabase.from("bonus_tiers").select("*").order("sort_order");
      return (data || []) as BonusTier[];
    },
  });

  if (!isAdmin) return <Navigate to="/" replace />;

  const openCreate = () => {
    setEditing(null);
    setForm({ name: "", min_hours: 0, text_color: "text-white", sort_order: (tiers.length + 1) });
    setDialogOpen(true);
  };

  const openEdit = (tier: BonusTier) => {
    setEditing(tier);
    setForm({ name: tier.name, min_hours: tier.min_hours, text_color: tier.text_color, sort_order: tier.sort_order });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error("Name required"); return; }
    if (editing) {
      const { error } = await supabase.from("bonus_tiers").update({
        name: form.name, min_hours: form.min_hours, text_color: form.text_color, sort_order: form.sort_order,
      }).eq("id", editing.id);
      if (error) { toast.error("Failed to update"); return; }
      toast.success("Tier updated");
    } else {
      const { error } = await supabase.from("bonus_tiers").insert({
        name: form.name, min_hours: form.min_hours, text_color: form.text_color, sort_order: form.sort_order,
      });
      if (error) { toast.error("Failed to create"); return; }
      toast.success("Tier created");
    }
    setDialogOpen(false);
    queryClient.invalidateQueries({ queryKey: ["bonus-tiers"] });
  };

  const handleDelete = async (id: string) => {
    await supabase.from("bonus_tiers").delete().eq("id", id);
    queryClient.invalidateQueries({ queryKey: ["bonus-tiers"] });
    toast.success("Tier deleted");
  };

  const handleImageUpload = async (tierId: string, file: File) => {
    setUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const name = `bonus-tier-${tierId}.${ext}`;
      const { error: uploadError } = await supabase.storage.from("site-assets").upload(name, file, { upsert: true });
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage.from("site-assets").getPublicUrl(name);
      await supabase.from("bonus_tiers").update({ card_image_url: publicUrl }).eq("id", tierId);
      queryClient.invalidateQueries({ queryKey: ["bonus-tiers"] });
      toast.success("Card image uploaded");
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <CreditCard className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">AFLV Bonus Tiers</h1>
            <p className="text-muted-foreground">Manage frequent flyer card tiers</p>
          </div>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={openCreate}><Plus className="h-4 w-4 mr-2" />Add Tier</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editing ? "Edit Tier" : "New Tier"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div><Label>Name</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
              <div><Label>Min Hours</Label><Input type="number" value={form.min_hours} onChange={e => setForm(f => ({ ...f, min_hours: Number(e.target.value) }))} /></div>
              <div>
                <Label>Card Text Color</Label>
                <Select value={form.text_color} onValueChange={v => setForm(f => ({ ...f, text_color: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="text-white">White</SelectItem>
                    <SelectItem value="text-black">Black</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Sort Order</Label><Input type="number" value={form.sort_order} onChange={e => setForm(f => ({ ...f, sort_order: Number(e.target.value) }))} /></div>
              <Button onClick={handleSave} className="w-full">Save</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : tiers.length === 0 ? (
        <p className="text-muted-foreground">No tiers configured yet.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tiers.map(tier => (
            <Card key={tier.id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center justify-between">
                  <span>{tier.name}</span>
                  <span className="text-sm font-normal text-muted-foreground">{tier.min_hours}h</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {tier.card_image_url ? (
                  <div className="aspect-[1172/690] rounded-lg overflow-hidden border">
                    <img src={tier.card_image_url} alt={tier.name} className="w-full h-full object-contain" />
                  </div>
                ) : (
                  <div className="aspect-[1172/690] rounded-lg border border-dashed flex items-center justify-center text-muted-foreground">
                    <div className="text-center">
                      <Image className="h-6 w-6 mx-auto mb-1 opacity-50" />
                      <p className="text-xs">No card image</p>
                    </div>
                  </div>
                )}
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => openEdit(tier)}>
                    <Edit className="h-3 w-3 mr-1" />Edit
                  </Button>
                  <label className="flex-1">
                    <Button variant="outline" size="sm" className="w-full" disabled={uploading} asChild>
                      <span><Upload className="h-3 w-3 mr-1" />Image</span>
                    </Button>
                    <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleImageUpload(tier.id, f); }} />
                  </label>
                  <Button variant="outline" size="sm" className="text-destructive" onClick={() => handleDelete(tier.id)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
