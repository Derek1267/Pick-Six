# Run your own Pick Six

Everything here runs on free tiers: Supabase, GitHub Pages, and GitHub Actions on a public repo.
Plan on about 30 minutes. You'll need a GitHub account and a Supabase account.

Throughout this guide:
- `<you>` = your GitHub username
- `<repo>` = your repository name (e.g. `Pick-Six`)
- `<ref>` = your Supabase project ID, the random letters in your project's dashboard address

---

## 1. Copy the code

Fork this repository, or create a new public repo and upload these files. Keep it **public**: public repos get unlimited free Actions minutes, which the score sync needs.

Your site will live at `https://<you>.github.io/<repo>/`. GitHub Pages addresses are case-sensitive, so match your repo name exactly.

## 2. Create the Supabase project

1. At [supabase.com](https://supabase.com), create a **New project** (the free plan is fine). When asked, leave these switched **on**:
   - Data API
   - Automatically grant API access to new tables
   - Automatically enable RLS
2. Open **SQL Editor → New query**, paste in all of [`supabase/schema.sql`](../supabase/schema.sql), and click **Run**. It should say "Success". The file is safe to re-run whenever it's updated.
3. Open **Authentication → URL Configuration**:
   - **Site URL:** `https://<you>.github.io/<repo>/`
   - **Redirect URLs:** add that same address, and `http://localhost:8000/` for local testing.

## 3. Connect the site to Supabase

Open **Project Settings → API Keys** (or the **Connect** button) and put two values into [`config.js`](../config.js):

```js
export const SUPABASE_URL = 'https://<ref>.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_…';   // the publishable / anon key
```

The publishable (anon) key is designed to be public. **Never** put the secret / `service_role` key in `config.js`.

## 4. Turn on Google sign-in (recommended)

Supabase's built-in email sender only allows a few sign-in emails per hour, so Google sign-in is the easiest way to let a group sign up at once. It's free.

**In Google Cloud:**
1. Go to [console.cloud.google.com](https://console.cloud.google.com) and create a project, e.g. "Pick Six".
2. Open **Google Auth Platform** (APIs & Services → OAuth consent screen) and fill in:
   - **Branding:** app name "Pick Six", a support email, and your site address as the home page.
   - **Audience:** choose **External**, then **Publish app**. Pick Six only asks for name and email, which don't need Google's review. While the app is in "Testing", only test users you add by hand can sign in.
3. Open **Clients → Create client** and choose **Web application**:
   - **Authorized JavaScript origins:** `https://<you>.github.io`
   - **Authorized redirect URIs:** `https://<ref>.supabase.co/auth/v1/callback`
4. Copy the **Client ID** and **Client secret**.

**In Supabase:**
1. Go to **Authentication → Sign In / Providers → Google** and switch it on.
2. Paste in the Client ID and Client secret, then save.

The Google sign-in screen will mention `<ref>.supabase.co`. That's normal for Supabase projects.

**Email sign-in** keeps working alongside Google. To get past the hourly email limit, or to customize the emails, connect your own sender under **Authentication → Emails → SMTP Settings**. Supabase only lets you edit email templates once custom SMTP is set up.

## 5. Turn on the score sync

1. In your repo, go to **Settings → Secrets and variables → Actions → New repository secret** and add two secrets:
   - `SUPABASE_URL` = `https://<ref>.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY` = the **secret** key (`sb_secret_…`) or legacy `service_role` key, from the same API Keys page
2. Go to the **Actions** tab, enable workflows if asked, then **Sync games → Run workflow**. Tick **Load whole seasons**, leave the sport as **all**, and run it. It takes about 3 minutes.
3. In Supabase's **Table Editor**, check that `games` has rows for each in-season sport, and that `playoff_seeds` has rows too.

From then on the sync runs by itself every 15 minutes, with a full-season refresh once a day.

- GitHub may start scheduled runs a few minutes late. That's fine, because picks lock on the database clock, not when the sync runs.
- GitHub pauses scheduled workflows after 60 days without a commit. If scores stop updating, re-enable the workflow on the Actions tab.

## 6. Publish the site

Go to **Settings → Pages → Build and deployment**, choose **Deploy from a branch**, then `main` and `/ (root)`, and save. After a minute or two it's live at `https://<you>.github.io/<repo>/`.

## 7. Try it

Sign in, create a league, open the invite link in another browser or on your phone, and sign in as a second person. Make picks, and confirm you can't see each other's until a game starts.

---

## Local development

```bash
python3 -m http.server 8000      # then open http://localhost:8000
node scripts/sync-games.mjs --dry-run              # print what the sync would save
node scripts/sync-games.mjs --sport nba --dry-run  # one sport
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| Site says "Almost there" | `config.js` still has placeholder values |
| Sync fails with `PGRST204` / "column" | Re-run `supabase/schema.sql`; your database is missing a newer column |
| Sync fails with "isn't a valid URL" | Re-enter the `SUPABASE_URL` secret as `https://<ref>.supabase.co` |
| "Google sign-in isn't switched on yet" | Finish step 4, and check the Google provider is enabled in Supabase |
| Google says `redirect_uri_mismatch` | The redirect URI in Google must be exactly `https://<ref>.supabase.co/auth/v1/callback` |
| Sign-in link lands on a 404 | The Site URL / Redirect URLs in Supabase must match your Pages address, including capital letters |
| A sport can't be chosen for a new league | It's off-season. It opens once ESPN publishes the next schedule, which the daily refresh picks up |

## Customizing

- **Sports:** schedules and seeds are configured in `SPORTS` in `scripts/sync-games.mjs`, and playoff formats in `FORMATS` in `bracket.js`.
- **Colors:** the CSS variables at the top of `styles.css`.
- **Logo:** `logo.svg`.
