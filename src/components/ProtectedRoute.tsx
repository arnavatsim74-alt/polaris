import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useMemo } from "react";

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireAdmin?: boolean;
}

/**
 * Guards route access and redirects users based on authentication state, pilot status, recruitment-exam token, and admin requirement.
 *
 * Checks whether the current user may view the wrapped children; when access is not allowed it renders a navigation redirect to either the authentication page or the home page.
 *
 * @param requireAdmin - If true, only allow access for users with admin privileges
 * @returns The wrapped children when access is permitted; otherwise a `<Navigate>` element that redirects to the appropriate route ("/auth" or "/")
 */
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
