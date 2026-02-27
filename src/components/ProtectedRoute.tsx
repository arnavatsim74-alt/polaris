import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireAdmin?: boolean;
}

export function ProtectedRoute({ children, requireAdmin = false }: ProtectedRouteProps) {
  const { user, pilot, isAdmin, isLoading, isPilotLoading } = useAuth();
  const location = useLocation();
  const [hasRecruitmentExamAccess, setHasRecruitmentExamAccess] = useState(false);
  const [isCheckingRecruitmentAccess, setIsCheckingRecruitmentAccess] = useState(false);

  useEffect(() => {
    const checkRecruitmentExamAccess = async () => {
      if (!user || pilot) return;
      const isExamPath = location.pathname.startsWith("/academy/exam/");
      if (!isExamPath) {
        setHasRecruitmentExamAccess(false);
        return;
      }

      const token = new URLSearchParams(location.search).get("recruitmentToken");
      if (!token) {
        setHasRecruitmentExamAccess(false);
        return;
      }

      setIsCheckingRecruitmentAccess(true);
      const { data } = await supabase.rpc("can_access_recruitment_exam", {
        p_token: token,
        p_user_id: user.id,
      });
      setHasRecruitmentExamAccess(!!data);
      setIsCheckingRecruitmentAccess(false);
    };

    checkRecruitmentExamAccess();
  }, [location.pathname, location.search, pilot, user]);

  const redirectTarget = useMemo(() => {
    if (isLoading || isCheckingRecruitmentAccess) return null;

    if (!user) return "/auth";

    if (!pilot) {
      if (isPilotLoading) return null;
      if (location.pathname.startsWith("/academy/exam/") && hasRecruitmentExamAccess) {
        return null;
      }
      return "/auth";
    }

    if (requireAdmin && !isAdmin) return "/";

    return null;
  }, [hasRecruitmentExamAccess, isAdmin, isCheckingRecruitmentAccess, isLoading, isPilotLoading, location.pathname, pilot, requireAdmin, user]);

  useEffect(() => {
    if (!redirectTarget) return;

    console.info("[ProtectedRoute] Redirecting", {
      from: location.pathname,
      to: redirectTarget,
      isLoading,
      isPilotLoading,
      isCheckingRecruitmentAccess,
      hasUser: !!user,
      hasPilot: !!pilot,
      isAdmin,
      requireAdmin,
    });
  }, [isAdmin, isCheckingRecruitmentAccess, isLoading, isPilotLoading, location.pathname, pilot, redirectTarget, requireAdmin, user]);

  if (isLoading || isPilotLoading || isCheckingRecruitmentAccess) return null;

  if (redirectTarget === "/auth") {
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  if (redirectTarget === "/") {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
