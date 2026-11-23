# Pick Six 🏈

Weekly NFL pick'em for friends. Make a private league, share the invite link, pick a winner for every game on the real schedule, and let the leaderboard settle it.

**How it works**

| Piece | What it does | Cost |
|---|---|---|
| `index.html`, `app.js`, `styles.css` | The website (plain HTML/JS, no build step) | Free on GitHub Pages |
| Supabase | Email sign-in, database, security rules | Free tier |
| `scripts/sync-games.mjs` + GitHub Action | Pulls the real NFL schedule and scores from ESPN every 15 min | Free |

**Rules built into the database** (so nobody can cheat from the browser console):
- Picks lock at kickoff, game by game.
- You can't see league-mates' picks for a game until it kicks off. After kickoff, everyone's picks are shown.
- Only league members can see a league, its members, or its leaderboard.
- Scoring: 1 point per correct pick. Ties and postponed games don't count. Weekly winner = most correct that week (ties share the win).

**Playoff bracket (Bracket tab)**
- Shows the playoff field (7 teams per conference) from ESPN's standings. During the season these are the seeds "if the season ended today".
- 🎲 **Simulate** plays out the bracket using each team's record plus home field. **Pick favorites** fills it with the likelier winner of each game. There's also a **Title odds** table built from 10,000 simulated playoffs.
- Before the regular season ends, the bracket is a practice bracket saved on your device.
- Real brackets open when the last regular-season game goes final. They lock at the first Wild Card kickoff, and that's when everyone's brackets are revealed.
- Bracket scoring is per correct winner: Wild Card 1, Divisional 2, Conference 4, Super Bowl 8 (30 max). The NFL re-seeds after the Wild Card round, and the bracket handles that.

---

## Setup (about 20 minutes)

### 1. Create the Supabase project
1. Sign up at [supabase.com](https://supabase.com) → **New project** (free plan is fine).
2. Open **SQL Editor → New query**, paste everything in `supabase/schema.sql`, and click **Run**.
   (If you already ran an older version, just run the whole file again. It's safe to re-run, and it adds the bracket tables.)
3. **Authentication → URL Configuration**:
   - *Site URL*: `https://derek1267.github.io/pick-six/` (your GitHub Pages address)
   - *Redirect URLs*: add that same address, plus `http://localhost:8000/` for local testing.
4. **Authentication → Email Templates → Magic Link**: add the code to the email so people can type it in.
   (This helps on phones where the link opens in a different browser.) For example:
   ```html
   <h2>Your Pick Six sign-in</h2>
   <p><a href="{{ .ConfirmationURL }}">Tap here to sign in</a></p>
   <p>Or enter this code: <strong>{{ .Token }}</strong></p>
   ```
   Do the same for the **Confirm signup** template.

> Supabase's built-in email sender only allows a few emails per hour. That's fine for testing. Before inviting a big group, set up custom SMTP under **Authentication → Emails → SMTP Settings**. A free [Resend](https://resend.com) account works.

### 2. Point the site at Supabase
Go to **Project Settings → API Keys** and copy the Project URL and the **anon / publishable** key into `config.js`.
The anon key is designed to be public. **Never** put the `service_role` / secret key in `config.js`.

### 3. Put it on GitHub
```bash
cd pick-six
git init
git add .
git commit -m "Pick Six: first version"
git branch -M main
git remote add origin https://github.com/Derek1267/pick-six.git   # create the empty repo on GitHub first
git push -u origin main
```

### 4. Turn on the schedule sync
1. In the repo, go to **Settings → Secrets and variables → Actions → New repository secret** and add:
   - `SUPABASE_URL`: your project URL
   - `SUPABASE_SERVICE_ROLE_KEY`: the **service_role / secret** key (Project Settings → API Keys)
2. Go to **Actions → Sync NFL games → Run workflow**, tick **Load the whole season**, and run it. That loads every week.
3. After that it runs every 15 minutes on its own and keeps scores and finals current.

> Public repos get unlimited Action minutes. On a **private** repo, every-15-minutes uses up the free 2,000 minutes. Change the cron in `.github/workflows/sync-games.yml` to `'*/30 * * * *'`, or make the repo public.
> GitHub also pauses scheduled workflows after 60 days with no commits. If scores stop updating, re-enable it on the Actions tab.

### 5. Publish the site
**Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)`**. After a minute it's live at `https://derek1267.github.io/pick-six/`.

---

## Testing locally
```bash
cd pick-six
python3 -m http.server 8000
# open http://localhost:8000
```
To test the sync without saving anything: `node scripts/sync-games.mjs --dry-run`

## Project layout
```
pick-six/
├── index.html            page shell
├── app.js                all the app logic (sign-in, leagues, picks, standings, bracket tab)
├── bracket.js            playoff bracket rules, simulator, odds, scoring
├── styles.css            look and feel
├── config.js             your Supabase URL + anon key
├── supabase/schema.sql   tables, security rules, league/leaderboard functions
├── scripts/sync-games.mjs   ESPN → Supabase schedule/score sync
└── .github/workflows/sync-games.yml   runs the sync every 15 min
```

## Ideas for next versions
- **Beat the Bot**: add the game predictor as a league "player" that makes picks automatically.
- **Confidence points** or **upset bonus** scoring as a league setting.
- **Survivor mode**.
- Pick reminder emails before the first game of each week.
- More sports: add an entry to `SPORTS` in `scripts/sync-games.mjs`.
- Leave/rename league buttons. The database rules already allow both.

Schedules and scores come from ESPN's public scoreboard feed. It's unofficial and could change without notice. If the sync breaks, `toGameRow()` (games) and `seedsFromStandings()` (playoff seeds) in `scripts/sync-games.mjs` are the places to fix. Run `node scripts/sync-games.mjs --dry-run` to print the games and seeds it would save. If ESPN's feed doesn't include seed numbers, the script warns you and ranks teams by win % instead (a rough projection).
