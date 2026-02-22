import { Badge } from "@/components/ui/badge";

const DEFAULT_STATUS_CLASSES: Record<string, string> = {
  pending: "status-pending",
  approved: "status-approved",
  denied: "status-denied",
  rejected: "status-denied",
};

export function StatusBadge({
  status,
  classMap,
}: {
  status: string;
  classMap?: Record<string, string>;
}) {
  const statusKey = (status || "").toLowerCase();
  const classes = { ...DEFAULT_STATUS_CLASSES, ...(classMap || {}) };

  return (
    <Badge variant="outline" className={classes[statusKey] || ""}>
      {statusKey.toUpperCase()}
    </Badge>
  );
}
