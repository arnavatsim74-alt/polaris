import { useState, useEffect, useMemo } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Loader2, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { User } from "@supabase/supabase-js";
import { DiscordIcon } from "@/components/icons/DiscordIcon";
import aeroflotLogo from "@/assets/aeroflot-logo.png";
import { PolarisFooter } from "@/components/PolarisFooter";

const applicationSchema = z.object({
  fullName: z.string().min(2, "Full name must be at least 2 characters"),
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(6, "Password must be at least 6 characters").optional(),
  discordUsername: z.string().min(2, "Discord username is required"),
  ifGrade: z.enum(["Grade 2", "Grade 3", "Grade 4", "Grade 5"]),
  isIfatc: z.enum(["Yes", "No"]),
  ifcTrustLevel: z.enum(["Basic User (TL1)", "Member (TL2)", "Regular (TL3)", "Leader (TL4)", "I don't know"]),
  ageRange: z.enum(["13-16", "17-21", "22-27", "28-34", "35-41", "42-50", "51-60", "Above"]),
  ifcProfileUrl: z.string().url("Please enter a valid IFC profile URL").or(z.literal("")),
  otherVaMembership: z.string().min(2, "Please answer if you are a member of another VA or VO"),
  whyJoinAflv: z.string().min(10, "Please share why you want to join AFLV"),
  hearAboutAflv: z.string().min(2, "Please share where you heard about AFLV"),
});

type ApplicationStatus = "idle" | "pending" | "approved" | "rejected";

const getDiscordProfile = (authUser: User | null) => {
  const discordIdentity = authUser?.identities?.find((identity) => identity.provider === "discord");
  const identityData = (discordIdentity?.identity_data || {}) as Record<string, unknown>;
  const metadata = (authUser?.user_metadata || {}) as Record<string, unknown>;

  const usernameRaw =
    (typeof identityData.username === "string" && identityData.username) ||
    (typeof identityData.global_name === "string" && identityData.global_name) ||
    (typeof identityData.preferred_username === "string" && identityData.preferred_username) ||
    (typeof metadata.preferred_username === "string" && metadata.preferred_username) ||
    (typeof metadata.global_name === "string" && metadata.global_name) ||
    (typeof metadata.name === "string" && metadata.name) ||
    null;

  const discordUsername = usernameRaw ? usernameRaw.replace(/^@+/, "").trim() : null;
  const discordUserId =
    (typeof identityData.sub === "string" && identityData.sub) ||
    (typeof metadata.provider_id === "string" && metadata.provider_id) ||
    null;

  return { discordUsername, discordUserId };
};

export default function ApplyPage() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [discordUsername, setDiscordUsername] = useState("");
  const [ifGrade, setIfGrade] = useState("Grade 2");
  const [isIfatc, setIsIfatc] = useState("No");
  const [ifcTrustLevel, setIfcTrustLevel] = useState("I don't know");
  const [ageRange, setAgeRange] = useState("13-16");
  const [ifcProfileUrl, setIfcProfileUrl] = useState("");
  const [otherVaMembership, setOtherVaMembership] = useState("");
  const [whyJoinAflv, setWhyJoinAflv] = useState("");
  const [hearAboutAflv, setHearAboutAflv] = useState("");
  
  const [isLoading, setIsLoading] = useState(false);
  const [applicationStatus, setApplicationStatus] = useState<ApplicationStatus>("idle");
  const { user, signUp, signInWithDiscord } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isDiscordRegisterFlow = useMemo(() => {
    if (searchParams.get("oauth") === "register") return true;
    if (typeof window === "undefined") return false;
    return window.sessionStorage.getItem("discord_oauth_mode") === "register";
  }, [searchParams]);

  // Check if user already has an application
  useEffect(() => {
    const checkExistingApplication = async () => {
      if (!user) return;

      const { data } = await supabase
        .from("pilot_applications")
        .select("status, discord_username, if_grade, is_ifatc, ifc_trust_level, age_range, other_va_membership, hear_about_aflv")
        .eq("user_id", user.id)
        .single();

      if (data) {
        const hasExtendedDetails = Boolean(
          data.discord_username
          && data.if_grade
          && data.is_ifatc
          && data.ifc_trust_level
          && data.age_range
          && data.other_va_membership
          && data.hear_about_aflv
        );

        if (data.status === "approved" || data.status === "rejected" || hasExtendedDetails) {
          setApplicationStatus(data.status as ApplicationStatus);
        }
      }
    };

    checkExistingApplication();
  }, [user, isDiscordRegisterFlow]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const isExistingDiscordUser = !!user && isDiscordRegisterFlow;

    const validation = applicationSchema.safeParse({
      fullName,
      email,
      password: isExistingDiscordUser ? undefined : password,
      discordUsername,
      ifGrade,
      isIfatc,
      ifcTrustLevel,
      ageRange,
      ifcProfileUrl,
      otherVaMembership,
      whyJoinAflv,
      hearAboutAflv,
    });

    if (!validation.success) {
      toast.error(validation.error.errors[0].message);
      return;
    }

    setIsLoading(true);

    try {
      let applicantUserId = user?.id;
      let applicantEmail = email;
      const { discordUsername: oauthDiscordUsername, discordUserId } = getDiscordProfile(user);
      const normalizedDiscordUsername = (discordUsername || oauthDiscordUsername || "").trim().replace(/^@+/, "");

      if (!isExistingDiscordUser) {
        // First create the account
        const { error: signUpError, userId: signedUpUserId } = await signUp(email, password);

        if (signUpError) {
          if (signUpError.message.includes("already registered")) {
            toast.error("This email is already registered. Please sign in instead.");
          } else {
            toast.error(signUpError.message);
          }
          return;
        }

        if (!signedUpUserId) {
          toast.error("Account created, but we couldn't start your application session. Please log in and click Check application status.");
          navigate("/auth", { replace: true });
          return;
        }

        applicantUserId = signedUpUserId;
      } else {
        const metadataEmail = typeof user?.user_metadata?.email === "string" ? user.user_metadata.email : null;
        applicantEmail = user?.email || metadataEmail || `discord-${user?.id}@users.noreply.local`;
      }

      if (!applicantUserId) {
        toast.error("Failed to determine account for this application");
        return;
      }

      // Submit application
      const { error: appError } = await supabase.from("pilot_applications").upsert({
        user_id: applicantUserId,
        email: applicantEmail,
        full_name: fullName,
        vatsim_id: null,
        ivao_id: null,
        experience_level: ifGrade,
        preferred_simulator: isIfatc,
        reason_for_joining: whyJoinAflv,
        discord_username: normalizedDiscordUsername,
        discord_user_id: discordUserId,
        if_grade: ifGrade,
        is_ifatc: isIfatc,
        ifc_trust_level: ifcTrustLevel,
        age_range: ageRange,
        ifc_profile_url: ifcProfileUrl || null,
        other_va_membership: otherVaMembership,
        hear_about_aflv: hearAboutAflv,
      }, { onConflict: "user_id" });

      if (appError) {
        toast.error("Failed to submit application. Please sign in and click Check application status.");
        navigate("/auth", { replace: true });
        return;
      }

      toast.success("Application submitted successfully!");
      navigate("/auth", { replace: true });
    } catch (err) {
      console.error(err);
      toast.error("Failed to continue registration. Please sign in and click Check application status.");
      navigate("/auth", { replace: true });
    } finally {
      setIsLoading(false);
    }
  };


  const handleDiscordRegister = async () => {
    setIsLoading(true);

    try {
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem("discord_oauth_mode", "register");
      }
      const { error } = await signInWithDiscord("/apply", "register");
      if (error) {
        toast.error(error.message);
        return;
      }

      toast.success("Redirecting to Discord...");
    } catch {
      toast.error("Could not start Discord registration");
    } finally {
      setIsLoading(false);
    }
  };


  useEffect(() => {
    if (!user) return;
    const metadata = user.user_metadata || {};
    const { discordUsername: discordFromOAuth } = getDiscordProfile(user);
    if (discordFromOAuth && !discordUsername) {
      setDiscordUsername(String(discordFromOAuth));
    }
    if (!fullName) {
      const fullNameFromMetadata = metadata.full_name || metadata.name || metadata.global_name || "";
      if (fullNameFromMetadata) {
        setFullName(String(fullNameFromMetadata));
      }
    }
    if (!email) {
      const metadataEmail = typeof metadata.email === "string" ? metadata.email : user.email || "";
      if (metadataEmail) {
        setEmail(metadataEmail);
      }
    }
  }, [user, discordUsername, fullName, email]);

  useEffect(() => {
    if (applicationStatus === "idle") return;
    navigate("/auth", { replace: true });
  }, [applicationStatus, navigate]);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <div className="flex justify-between items-center p-4">
        <Link to="/auth" className="flex items-center gap-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          Back to login
        </Link>
        <ThemeToggle />
      </div>

      <div className="flex-1 flex items-center justify-center p-4">
          <Card className="w-full max-w-2xl">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4">
              <img src={aeroflotLogo} alt="Aeroflot Virtual Group" className="h-12 w-auto object-contain" />
            </div>
            <CardTitle className="text-2xl">Join Aeroflot Virtual Group</CardTitle>
            <CardDescription>
              Complete this form to apply for a pilot position with our virtual airline on Infinite Flight
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              {isDiscordRegisterFlow && user && (
                <p className="text-sm text-muted-foreground">Discord account connected. Complete the full application below to continue.</p>
              )}
              {/* Personal Information */}
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-muted-foreground">Personal Information</h3>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="fullName">Full Name *</Label>
                    <Input
                      id="fullName"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      disabled={isLoading}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email *</Label>
                    <Input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={isLoading}
                      readOnly={isDiscordRegisterFlow && !!user}
                      required
                    />
                  </div>
                </div>
                {!user && (
                  <div className="space-y-2">
                    <Label htmlFor="password">Password *</Label>
                    <Input
                      id="password"
                      type="password"
                      placeholder="Minimum 6 characters"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={isLoading}
                      required
                    />
                  </div>
                )}
              </div>

              {/* Application Details */}
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-muted-foreground">Application Details</h3>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="discordUsername">Discord Username *</Label>
                    <Input
                      id="discordUsername"
                      value={discordUsername}
                      onChange={(e) => setDiscordUsername(e.target.value)}
                      disabled={isLoading}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ifGrade">IF Grade (you should be Grade 2 to join) *</Label>
                    <select id="ifGrade" className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={ifGrade} onChange={(e) => setIfGrade(e.target.value)} disabled={isLoading} required>
                      <option>Grade 2</option>
                      <option>Grade 3</option>
                      <option>Grade 4</option>
                      <option>Grade 5</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="isIfatc">Are you IFATC? *</Label>
                    <select id="isIfatc" className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={isIfatc} onChange={(e) => setIsIfatc(e.target.value)} disabled={isLoading} required>
                      <option>Yes</option>
                      <option>No</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ifcTrustLevel">Your IFC trust level? *</Label>
                    <select id="ifcTrustLevel" className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={ifcTrustLevel} onChange={(e) => setIfcTrustLevel(e.target.value)} disabled={isLoading} required>
                      <option>Basic User (TL1)</option>
                      <option>Member (TL2)</option>
                      <option>Regular (TL3)</option>
                      <option>Leader (TL4)</option>
                      <option>I don't know</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ageRange">How old are you? (You should be 13 years old to join) *</Label>
                    <select id="ageRange" className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={ageRange} onChange={(e) => setAgeRange(e.target.value)} disabled={isLoading} required>
                      <option>13-16</option>
                      <option>17-21</option>
                      <option>22-27</option>
                      <option>28-34</option>
                      <option>35-41</option>
                      <option>42-50</option>
                      <option>51-60</option>
                      <option>Above</option>
                    </select>
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="ifcProfileUrl">Your IFC profile URL</Label>
                    <Input
                      id="ifcProfileUrl"
                      placeholder="https://community.infiniteflight.com/u/your-profile"
                      value={ifcProfileUrl}
                      onChange={(e) => setIfcProfileUrl(e.target.value)}
                      disabled={isLoading}
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="otherVaMembership">Are you member of any other VA or VO? *</Label>
                    <Input id="otherVaMembership" value={otherVaMembership} onChange={(e) => setOtherVaMembership(e.target.value)} disabled={isLoading} required />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="whyJoinAflv">Why you want to join AFLV? *</Label>
                    <Input id="whyJoinAflv" value={whyJoinAflv} onChange={(e) => setWhyJoinAflv(e.target.value)} disabled={isLoading} required />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="hearAboutAflv">Where did you hear about AFLV? *</Label>
                    <Input id="hearAboutAflv" value={hearAboutAflv} onChange={(e) => setHearAboutAflv(e.target.value)} disabled={isLoading} required />
                  </div>
                </div>
              </div>


              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Submit Application
              </Button>

              <div className="space-y-3">
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-card px-2 text-muted-foreground">or</span>
                  </div>
                </div>

                <Button type="button" variant="outline" className="w-full" disabled={isLoading} onClick={handleDiscordRegister}>
                  <DiscordIcon className="mr-2 h-4 w-4" />
                  Register with Discord
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
      <PolarisFooter />
    </div>
  );
}
