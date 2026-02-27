import { ReactNode, Suspense, lazy } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppLayout } from "@/components/layouts/AppLayout";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { AppLoader } from "@/components/AppLoader";

const AuthPage = lazy(() => import("@/pages/Auth"));
const ApplyPage = lazy(() => import("@/pages/Apply"));
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const FilePirep = lazy(() => import("@/pages/FilePirep"));
const PirepHistory = lazy(() => import("@/pages/PirepHistory"));
const RoutesPage = lazy(() => import("@/pages/Routes"));
const RoutesOfTheWeek = lazy(() => import("@/pages/RoutesOfTheWeek"));
const Leaderboard = lazy(() => import("@/pages/Leaderboard"));
const Events = lazy(() => import("@/pages/Events"));
const Details = lazy(() => import("@/pages/Details"));
const Challenges = lazy(() => import("@/pages/Challenges"));
const AflvBonusPage = lazy(() => import("@/pages/AflvBonus"));
const Tracker = lazy(() => import("@/pages/Tracker"));
const AdminPireps = lazy(() => import("@/pages/admin/AdminPireps"));
const AdminRoutes = lazy(() => import("@/pages/admin/AdminRoutes"));
const AdminROTW = lazy(() => import("@/pages/admin/AdminROTW"));
const AdminEvents = lazy(() => import("@/pages/admin/AdminEvents"));
const AdminApplications = lazy(() => import("@/pages/admin/AdminApplications"));
const AdminAircraft = lazy(() => import("@/pages/admin/AdminAircraft"));
const AdminRanks = lazy(() => import("@/pages/admin/AdminRanks"));
const AdminMultipliers = lazy(() => import("@/pages/admin/AdminMultipliers"));
const AdminNOTAMs = lazy(() => import("@/pages/admin/AdminNOTAMs"));
const AdminSettings = lazy(() => import("@/pages/admin/AdminSettings"));
const AdminMembers = lazy(() => import("@/pages/admin/AdminMembers"));
const AdminChallenges = lazy(() => import("@/pages/admin/AdminChallenges"));
const AdminAnnouncements = lazy(() => import("@/pages/admin/AdminAnnouncements"));
const AdminSidebarLinks = lazy(() => import("@/pages/admin/AdminSidebarLinks"));
const AdminAcademy = lazy(() => import("@/pages/admin/AdminAcademy"));
const AdminBonusTiers = lazy(() => import("@/pages/admin/AdminBonusTiers"));
const AdminActivity = lazy(() => import("@/pages/admin/AdminActivity"));
const Academy = lazy(() => import("@/pages/Academy"));
const AcademyCourse = lazy(() => import("@/pages/AcademyCourse"));
const AcademyExam = lazy(() => import("@/pages/AcademyExam"));
const ActivityPage = lazy(() => import("@/pages/Activity"));
const ProfileSettings = lazy(() => import("@/pages/ProfileSettings"));
const NotFound = lazy(() => import("@/pages/NotFound"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
      throwOnError: false,
    },
    mutations: {
      retry: 0,
    },
  },
});

const RouteScopedErrorBoundary = ({ children }: { children: ReactNode }) => {
  const location = useLocation();
  const resetKey = `${location.pathname}${location.search}`;

  return <AppErrorBoundary resetKey={resetKey}>{children}</AppErrorBoundary>;
};

const App = () => (
  <AppErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="dark" storageKey="latour-va-theme">
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <AuthProvider>
              <RouteScopedErrorBoundary>
                <Suspense fallback={null}>
                  <Routes>
                    <Route path="/auth" element={<AuthPage />} />
                    <Route path="/apply" element={<ApplyPage />} />
                    <Route path="/academy/exam/:examId" element={<AcademyExam />} />
                    <Route path="/" element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
                      <Route index element={<Dashboard />} />
                      <Route path="rotw" element={<RoutesOfTheWeek />} />
                      <Route path="file-pirep" element={<FilePirep />} />
                      <Route path="pirep-history" element={<PirepHistory />} />
                      <Route path="routes" element={<RoutesPage />} />
                      <Route path="leaderboard" element={<Leaderboard />} />
                      <Route path="events" element={<Events />} />
                      <Route path="details" element={<Details />} />
                      <Route path="challenges" element={<Challenges />} />
                      <Route path="latourbonus" element={<AflvBonusPage />} />
                      <Route path="aflvbonus" element={<AflvBonusPage />} />
                      <Route path="frequentflyer" element={<AflvBonusPage />} />
                      <Route path="tracker" element={<Tracker />} />
                      <Route path="academy" element={<Academy />} />
                      <Route path="academy/course/:courseId" element={<AcademyCourse />} />
                      <Route path="activity" element={<ActivityPage />} />
                      <Route path="profile" element={<ProfileSettings />} />
                      <Route path="admin/pireps" element={<AdminPireps />} />
                      <Route path="admin/routes" element={<AdminRoutes />} />
                      <Route path="admin/rotw" element={<AdminROTW />} />
                      <Route path="admin/events" element={<AdminEvents />} />
                      <Route path="admin/applications" element={<AdminApplications />} />
                      <Route path="admin/aircraft" element={<AdminAircraft />} />
                      <Route path="admin/ranks" element={<AdminRanks />} />
                      <Route path="admin/multipliers" element={<AdminMultipliers />} />
                      <Route path="admin/notams" element={<AdminNOTAMs />} />
                      <Route path="admin/settings" element={<AdminSettings />} />
                      <Route path="admin/members" element={<AdminMembers />} />
                      <Route path="admin/challenges" element={<AdminChallenges />} />
                      <Route path="admin/announcements" element={<AdminAnnouncements />} />
                      <Route path="admin/sidebar-links" element={<AdminSidebarLinks />} />
                      <Route path="admin/academy" element={<AdminAcademy />} />
                      <Route path="admin/bonus-tiers" element={<AdminBonusTiers />} />
                      <Route path="admin/activity" element={<AdminActivity />} />
                    </Route>
                    <Route path="*" element={<NotFound />} />
                  </Routes>
                </Suspense>
              </RouteScopedErrorBoundary>
            </AuthProvider>
          </BrowserRouter>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </AppErrorBoundary>
);

export default App;
