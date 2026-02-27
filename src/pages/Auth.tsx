import { useEffect, useState } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { DiscordIcon } from "@/components/icons/DiscordIcon";
import aeroflotLogo from "@/assets/aeroflot-logo.png";
import aeroflotBanner from "@/assets/aeroflot-banner.jpg";
import vacompanyLogo from "@/assets/vacompany-logo.svg";
import { VACOMPANY_URL } from "@/lib/branding";
import { PolarisFooter } from "@/components/PolarisFooter";
import { PENDING_APPROVAL_MESSAGE } from "@/lib/authMessages";

const loginSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export default function AuthPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, pilot, isLoading: isAuthLoading, signIn, signInWithDiscord, signOut } = useAuth();

  const { data: siteSettings } = useQuery({
    queryKey: ["site-settings-auth"],
    queryFn: async () => {
      try {
        const { data } = await supabase
          .from("site_settings")
          .select("key, value")
          .in("key", ["auth_banner_url", "auth_logo_url"]);
        const map: Record<string, string> = {};
        data?.forEach((s: any) => { if (s.value) map[s.key] = s.value; });
        return map;
      } catch {
        return {};
      }
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  const bannerSrc = siteSettings?.auth_banner_url || aeroflotBanner;
  const logoSrc = siteSettings?.auth_logo_url || aeroflotLogo;


  useEffect(() => {
    const oauthFlow = searchParams.get("oauth");
    if (oauthFlow !== "login") return;
    if (isAuthLoading) return;
    if (!user) return;

    if (pilot) {
      navigate("/", { replace: true });
      return;
    }

    const validateOAuthApproval = async () => {
      const { data: pilotData, error } = await supabase
        .from("pilots")
        .select("approval_status")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error || pilotData?.approval_status !== "approved") {
        await signOut();
        toast.error(PENDING_APPROVAL_MESSAGE);
        navigate("/auth", { replace: true });
        return;
      }

      navigate("/", { replace: true });
    };

    validateOAuthApproval();
  }, [searchParams, isAuthLoading, user, pilot, signOut, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const validation = loginSchema.safeParse({ email, password });
    if (!validation.success) {
      toast.error(validation.error.errors[0].message);
      return;
    }

    setIsLoading(true);

    try {
      const { error } = await signIn(email, password);
      
      if (error) {
        if (error.message.includes("Invalid login credentials")) {
          toast.error("Invalid email or password");
        } else if (error.message.includes("Email not confirmed")) {
          toast.error("Please confirm your email address before signing in");
        } else {
          toast.error(error.message);
        }
        return;
      }

      toast.success("Welcome back!");
      navigate("/");
    } catch (err) {
      toast.error("An unexpected error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDiscordSignIn = async () => {
    setIsLoading(true);

    try {
      const { error } = await signInWithDiscord("/auth", "login");
      if (error) {
        toast.error(error.message);
        return;
      }

      toast.success("Redirecting to Discord...");
    } catch {
      toast.error("Could not start Discord sign in");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Left side - Image (wider) */}
      <div className="hidden lg:flex lg:w-3/5 relative">
        <img 
          src={bannerSrc} 
          alt="Aeroflot Aircraft" 
          className="absolute inset-0 w-full h-full object-cover" 
        />
        <div className="absolute inset-0 bg-gradient-to-t from-background/80 via-transparent to-transparent" />
        <div className="relative z-10 flex flex-col justify-end p-12">
          <img src={logoSrc} alt="Koreanair Virtual" className="h-16 w-auto object-contain mb-4" />
          <p className="text-lg text-foreground/90 max-w-md">
            Welcome to the professional crew management system for Koreanair Virtual pilots on Infinite Flight.
          </p>
        </div>
      </div>

      {/* Right side - Login form (narrower) */}
      <div className="flex-1 flex flex-col lg:w-2/5">
        <div className="flex items-center justify-between p-4">
          <a href={VACOMPANY_URL} target="_blank" rel="noopener noreferrer" aria-label="Visit VACompany">
            <img src={vacompanyLogo} alt="VACompany" className="h-10 w-auto object-contain opacity-80 invert dark:invert-0" />
          </a>
          <ThemeToggle />
        </div>
        
        <div className="flex-1 flex items-center justify-center p-8">
          <Card className="w-full max-w-sm">
            <CardHeader className="space-y-1">
              <div className="lg:hidden mb-4">
                <img src={logoSrc} alt="Koreanair Virtual" className="h-10 w-auto object-contain" />
              </div>
              <CardTitle className="text-2xl">Sign in</CardTitle>
              <CardDescription>
                Enter your credentials to access the Crew Center
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="pilot@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={isLoading}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={isLoading}
                    required
                  />
                </div>
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Sign In
                </Button>

                <div className="relative py-2">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-card px-2 text-muted-foreground">or</span>
                  </div>
                </div>

                <Button type="button" variant="outline" className="w-full" disabled={isLoading} onClick={handleDiscordSignIn}>
                  <DiscordIcon className="mr-2 h-4 w-4" />
                  Continue with Discord
                </Button>
              </form>

              <div className="mt-6 text-center text-sm">
                <span className="text-muted-foreground">New? </span>
                <Link to="/apply" className="text-primary hover:underline font-medium">
                  Apply to join
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* VACompany branding */}
        <div className="flex items-center justify-center pb-4 opacity-70">
          <a href={VACOMPANY_URL} target="_blank" rel="noopener noreferrer" aria-label="Visit VACompany">
            <img src={vacompanyLogo} alt="VACompany" className="h-8 w-auto object-contain invert dark:invert-0" />
          </a>
        </div>
        <PolarisFooter />
      </div>
    </div>
  );
}
