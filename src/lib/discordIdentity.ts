import { User } from "@supabase/supabase-js";

export const normalizeDiscordUsername = (value: string) => value.trim().replace(/^@+/, "");

export const getDiscordProfile = (authUser: User | null) => {
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

  const discordUsername = usernameRaw ? normalizeDiscordUsername(usernameRaw) : null;
  const discordUserId =
    (typeof identityData.sub === "string" && identityData.sub) ||
    (typeof metadata.provider_id === "string" && metadata.provider_id) ||
    null;

  return { discordUsername, discordUserId };
};
