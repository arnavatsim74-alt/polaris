import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layouts/AppSidebar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { UserMenu } from "@/components/UserMenu";
import { NotificationBell } from "@/components/NotificationBell";
import vacompanyLogo from "@/assets/vacompany-logo.svg";
import { VACOMPANY_URL } from "@/lib/branding";
import { PolarisFooter } from "@/components/PolarisFooter";

export function AppLayout() {
  const [zuluTime, setZuluTime] = useState("");

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setZuluTime(now.toISOString().slice(11, 19));
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <SidebarProvider>
      <div className="h-dvh min-h-screen flex w-full overflow-hidden">
        <AppSidebar />
        <div className="flex-1 w-0 min-w-0 flex flex-col">
          {/* Header */}
          <header className="sticky top-0 z-40 h-14 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="flex h-full items-center gap-4 px-4">
              <SidebarTrigger className="-ml-1" />
              <div className="flex-1" />
              <div className="hidden sm:flex items-center rounded-md border px-2 py-1 text-xs font-mono text-muted-foreground">
                Zulu {zuluTime}Z
              </div>
              <a href={VACOMPANY_URL} target="_blank" rel="noopener noreferrer" aria-label="Visit VACompany">
                <img
                  src={vacompanyLogo}
                  alt="VA Logo"
                  className="h-8 w-auto object-contain opacity-80 invert dark:invert-0"
                />
              </a>
              <NotificationBell />
              <ThemeToggle />
              <UserMenu />
            </div>
          </header>

          {/* Main content */}
          <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden">
            <div className="mx-auto w-full max-w-full px-3 py-6 sm:px-4 md:px-6 animate-fade-in">
              <Outlet />
            </div>
            <PolarisFooter />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
