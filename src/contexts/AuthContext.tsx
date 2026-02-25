import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { PENDING_APPROVAL_MESSAGE } from "@/lib/authMessages";
import { getDiscordProfile } from "@/lib/discordIdentity";

interface Pilot {
  id: string;
  pid: string;
  full_name: string;
  avatar_url: string | null;
  discord_username?: string | null;
  discord_user_id?: string | null;
  ifc_username?: string | null;
  total_hours: number;
  total_pireps: number;
  current_rank: string;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  pilot: Pilot | null;
  isAdmin: boolean;
  isLoading: boolean;
  isPilotLoading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string) => Promise<{ error: Error | null; userId: string | null }>;
  signInWithDiscord: (redirectPath?: string, mode?: "login" | "register") => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refreshPilot: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [pilot, setPilot] = useState<Pilot | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isPilotLoading, setIsPilotLoading] = useState(false);

  const getDiscordIdentity = (authUser: User | null) => {
    const { discordUsername, discordUserId } = getDiscordProfile(authUser);
    return { username: discordUsername, discordUserId };
  };



  const getDiscordAvatarUrl = (authUser: User | null) => {
    const discordIdentity = authUser?.identities?.find((identity) => identity.provider === "discord");
    const identityData = (discordIdentity?.identity_data || {}) as Record<string, unknown>;

    const avatarFromMetadata =
      (typeof identityData.avatar_url === "string" && identityData.avatar_url)
      || (typeof authUser?.user_metadata?.avatar_url === "string" && authUser.user_metadata.avatar_url)
      || (typeof authUser?.user_metadata?.picture === "string" && authUser.user_metadata.picture)
      || null;
    if (avatarFromMetadata) return avatarFromMetadata;

    const avatarHash = typeof identityData.avatar === "string" ? identityData.avatar : null;
    const discordUserId = (typeof identityData.sub === "string" && identityData.sub)
      || (typeof identityData.id === "string" && identityData.id)
      || null;

    if (avatarHash && discordUserId) {
      return `https://cdn.discordapp.com/avatars/${discordUserId}/${avatarHash}.png`;
    }

    return null;
  };

  const syncDiscordFields = async (authUser: User, pilotData: any) => {
    const { username, discordUserId } = getDiscordIdentity(authUser);

    if (!username && !discordUserId) return;

    const patch: Record<string, string> = {};
    if (username && !pilotData.discord_username) patch.discord_username = username;
    if (discordUserId && !pilotData.discord_user_id) patch.discord_user_id = discordUserId;

    if (Object.keys(patch).length === 0) return;

    const { error } = await supabase.from("pilots").update(patch).eq("id", pilotData.id);
    if (error) {
      console.error("Failed to sync Discord profile fields:", error);
    }
  };

  const fetchPilotData = async (userId: string, authUser?: User) => {
    setIsPilotLoading(true);
    try {
      const { data: pilotData, error: pilotError } = await supabase
        .from("pilots")
        .select("*")
        .eq("user_id", userId)
        .single();

      if (pilotError) {
        throw pilotError;
      }

      if (pilotData) {
        if (authUser) {
          await syncDiscordFields(authUser, pilotData);
        }

        const { username: discordUsernameFromOAuth, discordUserId: discordUserIdFromOAuth } = authUser
          ? getDiscordIdentity(authUser)
          : { username: null, discordUserId: null };

        setPilot({
          id: pilotData.id,
          pid: pilotData.pid,
          full_name: pilotData.full_name,
          avatar_url: pilotData.avatar_url || getDiscordAvatarUrl(authUser || null),
          discord_username: pilotData.discord_username || discordUsernameFromOAuth,
          discord_user_id: pilotData.discord_user_id || discordUserIdFromOAuth,
          ifc_username: pilotData.ifc_username || null,
          total_hours: Number(pilotData.total_hours) || 0,
          total_pireps: pilotData.total_pireps || 0,
          current_rank: pilotData.current_rank || "cadet",
        });
      }

      const { data: roleData } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .eq("role", "admin")
        .maybeSingle();

      setIsAdmin(!!roleData);
    } catch (error) {
      console.error("Error fetching pilot data:", error);
      setPilot(null);
      setIsAdmin(false);
    } finally {
      setIsPilotLoading(false);
    }
  };

  const tryAdminSetup = async (userSession: Session) => {
    try {
      const email = userSession.user.email;
      if (email !== "admin@aflv.ru") return;

      // Check if pilot already exists
      const { data: existingPilot } = await supabase
        .from("pilots")
        .select("id")
        .eq("user_id", userSession.user.id)
        .maybeSingle();

      if (existingPilot) return;

      // Call edge function to set up admin
      await supabase.functions.invoke("setup-admin");

      // Re-fetch pilot data after setup
      await fetchPilotData(userSession.user.id);
    } catch (err) {
      console.error("Admin setup error:", err);
    }
  };

  const refreshPilot = async () => {
    if (user) await fetchPilotData(user.id, user);
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);

        if (event === "SIGNED_OUT" || !session?.user) {
          setPilot(null);
          setIsAdmin(false);
          setIsPilotLoading(false);
          return;
        }

        if (event === "TOKEN_REFRESHED") {
          return;
        }

        if (session?.user) {
          setIsPilotLoading(true);
          setTimeout(async () => {
            await fetchPilotData(session.user.id, session.user);
            // After fetching, try admin setup if needed
            await tryAdminSetup(session);
          }, 0);
        }
      }
    );

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        setIsPilotLoading(true);
        await fetchPilotData(session.user.id, session.user);
        await tryAdminSetup(session);
      } else {
        setPilot(null);
        setIsAdmin(false);
        setIsPilotLoading(false);
      }
      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error };

    const userId = data.user?.id;
    if (!userId) return { error: new Error("Could not verify your user account") };

    const { data: pilotData, error: pilotError } = await supabase
      .from("pilots")
      .select("id, approval_status")
      .eq("user_id", userId)
      .maybeSingle();

    if (pilotError) {
      return { error: new Error("Could not verify application approval. Please try again.") };
    }

    if (pilotData?.approval_status === "approved") {
      return { error: null };
    }

    await supabase.auth.signOut();
    return { error: new Error(PENDING_APPROVAL_MESSAGE) };
  };

  const signUp = async (email: string, password: string) => {
    const redirectUrl = `${window.location.origin}/`;
    const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: redirectUrl } });
    return { error, userId: data.user?.id ?? null };
  };


  const signInWithDiscord = async (redirectPath = "/", mode: "login" | "register" = "login") => {
    const hasQuery = redirectPath.includes("?");
    const flowParam = `oauth=${mode}`;
    const redirectPathWithFlow = redirectPath.includes("oauth=")
      ? redirectPath
      : `${redirectPath}${hasQuery ? "&" : "?"}${flowParam}`;
    const redirectTo = `${window.location.origin}${redirectPathWithFlow}`;

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "discord",
      options: { redirectTo },
    });
    return { error };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setPilot(null);
    setIsAdmin(false);
  };

  return (
    <AuthContext.Provider value={{ user, session, pilot, isAdmin, isLoading, isPilotLoading, signIn, signUp, signInWithDiscord, signOut, refreshPilot }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}
