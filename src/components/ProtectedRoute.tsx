import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireAdmin?: boolean;
}

export function ProtectedRoute({ children, requireAdmin = false }: ProtectedRouteProps) {
  const { user, pilot, isAdmin, isLoading } = useAuth();
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

  if (isLoading || isCheckingRecruitmentAccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  if (!pilot) {
    if (location.pathname.startsWith("/academy/exam/") && hasRecruitmentExamAccess) {
      return <>{children}</>;
    }

    return <Navigate to="/auth" replace />;
  }

  if (requireAdmin && !isAdmin) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
