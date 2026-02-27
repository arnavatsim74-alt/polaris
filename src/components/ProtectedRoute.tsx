import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useMemo } from "react";

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireAdmin?: boolean;
}

export function ProtectedRoute({ children, requireAdmin = false }: ProtectedRouteProps) {
  const { user, pilot, isAdmin, isLoading, isPilotLoading } = useAuth();
  const location = useLocation();

  const redirectTarget = useMemo(() => {
    if (isLoading) return null;
    if (!user) return "/auth";
    if (!pilot && !isPilotLoading) return "/auth";
    if (requireAdmin && !isAdmin) return "/";
    return null;
  }, [isAdmin, isLoading, pilot, requireAdmin, user]);

  if (isLoading || isPilotLoading) return null;

  if (redirectTarget === "/auth") {
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  if (redirectTarget === "/") {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
