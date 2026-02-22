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
  const [hasPendingApplication, setHasPendingApplication] = useState(false);
  const [hasRecruitmentExamAccess, setHasRecruitmentExamAccess] = useState(false);
  const [isCheckingApplication, setIsCheckingApplication] = useState(false);
  const [isCheckingRecruitmentAccess, setIsCheckingRecruitmentAccess] = useState(false);

  useEffect(() => {
    const checkApplication = async () => {
      if (!user || pilot) return;
      setIsCheckingApplication(true);

      const { data } = await supabase
        .from("pilot_applications")
        .select("status")
        .eq("user_id", user.id)
        .maybeSingle();

      setHasPendingApplication(data?.status === "pending");
      setIsCheckingApplication(false);
    };

    checkApplication();
  }, [user, pilot]);

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

  if (isLoading || isCheckingApplication || isCheckingRecruitmentAccess) {
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

  // If user is authenticated but has no pilot profile, they need to apply or wait for account provisioning
  if (!pilot) {
    if (location.pathname.startsWith("/academy/exam/") && hasRecruitmentExamAccess) {
      return <>{children}</>;
    }

    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="max-w-md p-8 text-center">
          <h1 className="text-2xl font-bold mb-4">Pending Approval</h1>
          <p className="text-muted-foreground mb-6">
            {hasPendingApplication
              ? "Your pilot application is being reviewed. You'll receive access once approved by an administrator."
              : "No active pilot profile was found yet. Use the button below to check your application status."}
          </p>
          <button
            onClick={() => window.location.href = "/apply"}
            className="text-primary hover:underline"
          >
            Check application status
          </button>
        </div>
      </div>
    );
  }

  if (requireAdmin && !isAdmin) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
