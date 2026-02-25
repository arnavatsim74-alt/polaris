
## Project info

## How can I edit this code?

There are several ways of editing your application.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## How can I deploy this project?

Deploy this project using your preferred hosting platform (for example Vercel, Netlify, or a static server) after running `npm run build`.

## Can I connect a custom domain?

Yes, you can!

To connect a domain, configure your DNS records in your hosting provider and add the domain in your hosting dashboard.

## Supabase migration troubleshooting (notifications/replays/min-rank)

Use the unified migration:

- `supabase/migrations/20260217143000_academy_notifications_and_permissions_unified.sql`

It is idempotent and includes:
- notifications table + RLS policies,
- practical replay/min-rank columns,
- practical completion + replay upload permissions,
- DB-level assignment notifications for practicals and exams.

## Discord OAuth setup (Vite + Supabase)

This project is a **Vite SPA** (not Next.js), so you do **not** need `app/auth/callback/route.ts`.
Supabase handles the OAuth callback at its own endpoint.

Use these values:

- **Discord OAuth2 Redirect URL** (in Discord Developer Portal):
  - `https://<your-project-ref>.supabase.co/auth/v1/callback`
- **Supabase Auth > URL Configuration > Site URL**:
  - `https://ramva-vacompany.vercel.app`
- **Supabase Auth > URL Configuration > Additional Redirect URLs**:
  - `https://ramva-vacompany.vercel.app/*`
  - `http://localhost:5173/*` (for local dev)

The app uses:
- `/auth` for Discord sign-in
- `/apply` for Discord registration

On Discord registration, if the user signed in via Discord and has no application yet, the app auto-creates a row in `pilot_applications` with the Discord email/name so admins can review it in Applications.

### About `522 Connection timed out` on `*.supabase.co`

A `522` means Cloudflare couldn't reach the Supabase origin at that moment (provider/network outage), not a bad app route.

Try:
- Re-test after a few minutes.
- Check [Supabase status](https://status.supabase.com/).
- Retry with another network/VPN.
- Confirm your `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are correct in Vercel env vars.

## Discord Bot via Supabase Edge Functions (`/pirep` + utility commands)

You can host the Discord slash-command bot fully in Supabase with **two functions**:

- `discord-pirep-register` (one-time command registration)
- `discord-pirep-bot` (Discord interaction handler)

### 1) Deploy both functions

```bash
supabase functions deploy discord-pirep-register
supabase functions deploy discord-pirep-bot
```

### 2) Required secrets

Set these in Supabase secrets:

For `discord-pirep-register`:
- `DISCORD_BOT_TOKEN`
- `DISCORD_APPLICATION_ID`
- `DISCORD_REGISTER_SECRET` (optional but recommended; send in `x-register-secret` when calling register function)

For `discord-pirep-bot`:
- `DISCORD_PUBLIC_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

### 3) Register commands (one-time)

Call the register endpoint once (or whenever command schema changes):

```bash
curl -X POST \
  https://<project-ref>.supabase.co/functions/v1/discord-pirep-register \
  -H "x-register-secret: <your DISCORD_REGISTER_SECRET if set>"
```

This registers these global slash commands:
- `/pirep` (files PIREP with backend autocompletes for `operator`, `aircraft`, and `multiplier`)
- `/get-events` (next 2 days events, includes participate buttons; registration uses DB `register_for_event` gate assignment)
- `/leaderboard`
- `/challange`
- `/notams`
- `/rotw`
- `/featured`

### 4.1) Event reminder thread setup (T-30 minutes)

A dedicated edge function can auto-create a thread 30 minutes before an event in channel `1427122161570807858` and post the first plain-text message with pilot mentions + assigned gates.

Deploy:

```bash
supabase functions deploy discord-event-reminder
```

Required secrets:

```bash
supabase secrets set SUPABASE_URL=<your_project_url>
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<your_service_role_key>
supabase secrets set DISCORD_BOT_TOKEN=<your_bot_token>
```

Schedule (recommended every 1-5 min):
- Call `https://<project-ref>.supabase.co/functions/v1/discord-event-reminder` from your scheduler/cron.
- The function deduplicates reminders via `event_discord_reminders`, so each event gets only one `t_minus_30m` thread.

Discord user ID source (no manual entry needed):
- On event participation, the system now stores Discord user ID automatically when available.
- Priority used by reminder function: `event_registrations.discord_user_id` -> `pilots.discord_user_id` -> `auth.identities(provider=discord)`.

`/pirep` options:
- `flight_number` (string)
- `dep_icao` (string)
- `arr_icao` (string)
- `operator` (string, autocomplete from `site_settings.pirep_operators`)
- `aircraft` (string, autocomplete from `aircraft`)
- `flight_type` (string: passenger/cargo/charter)
- `flight_hours` (number)
- `multiplier` (string, optional, autocomplete from `multiplier_configs`)
- `flight_date` (string, optional, YYYY-MM-DD)

### 4) Discord Developer Portal setup

Set **Interactions Endpoint URL** to:
- `https://<project-ref>.supabase.co/functions/v1/discord-pirep-bot`

> Note: This is different from OAuth redirect URLs. Redirect URLs are for login flow; bot slash commands use the Interactions Endpoint URL.

### 5) Pilot resolution (no manual per-user mapping required)

The handler resolves the pilot by Discord identity from Supabase Auth (`auth.identities` provider `discord` -> `pilots.user_id`).

Fallback support remains for legacy manual linking:
- `supabase/migrations/20260218090000_add_discord_user_id_to_pilots.sql`

Additional fallback by Discord username (set in profile settings):
- `supabase/migrations/20260218101500_add_discord_username_to_pilots.sql`

If a user has signed into the VA site with Discord, the bot can file their PIREP without manual ID mapping.

### 6) Pilot Profile Settings: Discord username

Pilots can now set their Discord username at `/profile`.

- If the pilot signed in with Discord OAuth, the app auto-detects and pre-fills the username.
- The value is saved to `pilots.discord_username` and used as a fallback mapping source by the bot handler.
