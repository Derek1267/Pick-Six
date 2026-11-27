// Pick Six — front end. Plain JavaScript, no build step.
// Pages (hash routes):
//   #/                      your leagues, create or join one
//   #/join/ABC123           invite link — joins after sign-in
//   #/league/<id>           picks by week (NFL) or by day (NBA/NHL/MLB)   (?week=2-12 or ?week=2026-11-23)
//   #/league/<id>?tab=standings   leaderboard
//   #/league/<id>?tab=bracket   playoff bracket + simulator

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import * as BR from './bracket.js';
import * as SEL from './selections.js';

const app = document.getElementById('app');
const accountNav = document.getElementById('account');
const configured = !SUPABASE_URL.includes('YOUR-') && !SUPABASE_ANON_KEY.includes('YOUR-');
const sb = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

const state = {
  session: null,
  profile: null,
  refreshTimer: null,
  pendingEmail: null,
  renderId: 0,
  league: null,
};

const JOIN_KEY = 'pickSix.pendingJoin';

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

let toastTimer;
function toast(message, kind = '') {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 3200);
}

const friendlyError = (err) => {
  const msg = err?.message || String(err);
  if (/row-level security/i.test(msg)) return 'That game has already kicked off — picks are locked.';
  return msg;
};

export const SPORTS = {
  nfl: { name: 'NFL', daily: false, unit: 'week' },
  nba: { name: 'NBA', daily: true, unit: 'day' },
  nhl: { name: 'NHL', daily: true, unit: 'day' },
  mlb: { name: 'MLB', daily: true, unit: 'day' },
};
const sportInfo = (sport) => SPORTS[sport] || SPORTS.nfl;

const weekKey = (type, week) => `${type}-${week}`;

// NFL: "Week 12" / playoff round. Daily sports: "Week of Nov 17" (Mon–Sun).
function weekLabel(type, week, sport = 'nfl') {
  if (sportInfo(sport).daily) {
    const monday = new Date(Date.UTC(2000, 0, 3) + week * 7 * 864e5);
    const label = `Week of ${monday.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })}`;
    return type === 3 ? `Playoffs · ${label}` : label;
  }
  if (type === 3) return ['Wild Card', 'Divisional', 'Conference', 'Pro Bowl', 'Super Bowl'][week - 1] || `Playoffs ${week}`;
  if (type === 1) return `Preseason ${week}`;
  return `Week ${week}`;
}

const todayET = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

function dayLabel(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  const today = todayET();
  const tomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(Date.now() + 864e5));
  const base = date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  if (ymd === today) return `Today · ${base}`;
  if (ymd === tomorrow) return `Tomorrow · ${base}`;
  return base;
}

// ----- In-memory caches: switching tabs or weeks shouldn't re-download a whole season -----
const cache = { leagues: new Map(), games: new Map() };
const LEAGUE_TTL = 60e3;       // league name + members
const GAMES_TTL = 10 * 60e3;   // full season schedule (live games are refreshed separately)
const fresh = (entry, ttl) => entry && Date.now() - entry.at < ttl;
export const forgetLeague = (id) => cache.leagues.delete(id);

async function getLeagueBundle(id) {
  const hit = cache.leagues.get(id);
  if (fresh(hit, LEAGUE_TTL)) return hit.data;
  const { data: league, error } = await sb.from('leagues').select('*').eq('id', id).maybeSingle();
  if (error || !league) return null;
  const { data } = await sb.from('league_members').select('user_id, role, profiles(display_name)').eq('league_id', id);
  const members = (data || []).map((m) => ({ user_id: m.user_id, role: m.role, name: m.profiles?.display_name || 'Player' }));
  const bundle = { league, members };
  cache.leagues.set(id, { at: Date.now(), data: bundle });
  return bundle;
}

async function getGames(sport, season) {
  const key = `${sport}:${season}`;
  const hit = cache.games.get(key);
  if (fresh(hit, GAMES_TTL)) return hit.data;
  const data = await loadGames(sport, season);
  cache.games.set(key, { at: Date.now(), data });
  return data;
}

// Only the games around right now can change between full reloads — fetch just those.
async function refreshLiveGames(sport, season) {
  const hit = cache.games.get(`${sport}:${season}`);
  if (!hit) return getGames(sport, season);
  const from = new Date(Date.now() - 12 * 36e5).toISOString();
  const to = new Date(Date.now() + 2 * 36e5).toISOString();
  const { data } = await sb.from('games').select('*').eq('sport', sport).eq('season', season)
    .gte('start_time', from).lte('start_time', to);
  if (data?.length) {
    const byId = new Map(data.map((g) => [g.id, g]));
    hit.data = hit.data.map((g) => byId.get(g.id) || g);
  }
  return hit.data;
}

// Supabase returns at most 1,000 rows per request — page through a season.
async function loadGames(sport, season) {
  const all = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('games').select('*').eq('sport', sport).eq('season', season)
      .order('start_time').order('id').range(from, from + 999);
    if (error) throw error;
    all.push(...data);
    if (data.length < 1000) break;
  }
  return all;
}

function fmtKickoff(iso) {
  const d = new Date(iso);
  const soon = Math.abs(d - Date.now()) < 6 * 864e5;
  return d.toLocaleString(undefined, soon
    ? { weekday: 'short', hour: 'numeric', minute: '2-digit' }
    : { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function fmtCountdown(iso) {
  const ms = new Date(iso) - Date.now();
  if (ms <= 0) return 'now';
  const m = Math.round(ms / 6e4);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)} days`;
}

const isOpen = (g) => g.status === 'pre' && new Date(g.start_time) > new Date();
const nameOf = (members, id) => members.find((m) => m.user_id === id)?.name ?? 'Someone';
const inviteLink = (code) => `${location.origin}${location.pathname}#/join/${code}`;

function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  const params = new URLSearchParams(query);
  if (parts[0] === 'league' && parts[1]) {
    let tab = params.get('tab') || 'picks';
    let sub = params.get('sub');
    // older links
    if (tab === 'standings') tab = 'leaderboard';
    if (tab === 'awards') { tab = 'predict'; sub = 'awards'; }
    if (tab === 'teams') { tab = 'predict'; sub = 'allstars'; }
    return { name: 'league', id: parts[1], tab, sub, week: params.get('week'), mode: params.get('mode') };
  }
  if (parts[0] === 'join' && parts[1]) return { name: 'join', code: parts[1].toUpperCase() };
  if (parts[0] === 'how') return { name: 'how' };
  return { name: 'home' };
}

function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

// ---------------------------------------------------------------------------
// Main render
// ---------------------------------------------------------------------------

async function render() {
  clearInterval(state.refreshTimer);
  const myRender = ++state.renderId;
  const stale = () => myRender !== state.renderId; // a newer render started

  app.classList.remove('wide');
  if (!configured) return renderSetupNeeded();

  const route = parseRoute();
  if (route.name === 'join') localStorage.setItem(JOIN_KEY, route.code);
  if (route.name === 'how') {
    if (state.session && !state.profile) await loadProfile();
    renderAccount();
    return renderHow();
  }

  if (!state.session) {
    renderAccount();
    return renderSignIn(route);
  }

  if (!state.profile) await loadProfile();
  if (stale()) return;
  renderAccount();

  // Finish an invite link that was opened before signing in.
  const pending = localStorage.getItem(JOIN_KEY);
  if (pending) {
    localStorage.removeItem(JOIN_KEY);
    const { data, error } = await sb.rpc('join_league', { p_code: pending });
    if (error) {
      toast(friendlyError(error), 'error');
      if (route.name === 'join') return go('#/');
    } else {
      toast(`You're in ${data.name}! Make your picks.`, 'good');
      return go(`#/league/${data.id}`);
    }
  }

  if (route.name === 'league') return renderLeague(route, stale);
  return renderHome(stale);
}

function renderSetupNeeded() {
  app.innerHTML = `
    <section class="card narrow">
      <h1>Almost there</h1>
      <p>Open <code>config.js</code> and paste in your Supabase project URL and anon key.
      docs/SETUP.md walks through it step by step.</p>
    </section>`;
}

// ---------------------------------------------------------------------------
// Light / dark mode
// ---------------------------------------------------------------------------

const themeBtn = document.getElementById('theme-toggle');
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
const ICON_SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const ICON_MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

const isDark = () => (document.documentElement.dataset.theme || (systemDark.matches ? 'dark' : 'light')) === 'dark';

function paintThemeButton() {
  const dark = isDark();
  themeBtn.innerHTML = dark ? ICON_SUN : ICON_MOON;
  themeBtn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0f0a1c' : '#1e1036');
}

themeBtn.addEventListener('click', () => {
  const next = isDark() ? 'light' : 'dark';
  // Picking the same as the device clears the override, so the site follows the device again.
  const matchesSystem = (next === 'dark') === systemDark.matches;
  if (matchesSystem) delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = next;
  try {
    if (matchesSystem) localStorage.removeItem('pickSix.theme');
    else localStorage.setItem('pickSix.theme', next);
  } catch { /* private mode */ }
  paintThemeButton();
});
systemDark.addEventListener?.('change', paintThemeButton);
paintThemeButton();

// ---------------------------------------------------------------------------
// Account / profile
// ---------------------------------------------------------------------------

async function loadProfile() {
  const uid = state.session.user.id;
  const { data } = await sb.from('profiles').select('id, display_name').eq('id', uid).maybeSingle();
  state.profile = data || { id: uid, display_name: state.session.user.email.split('@')[0] };
}

function renderAccount() {
  if (!state.session) { accountNav.innerHTML = ''; return; }
  accountNav.innerHTML = `
    <button class="chip" id="edit-name" title="Change display name">${esc(state.profile?.display_name || 'You')}</button>
    <button class="link" id="sign-out">Sign out</button>`;
}

accountNav.addEventListener('click', async (e) => {
  if (e.target.id === 'sign-out') {
    await sb.auth.signOut();
  } else if (e.target.id === 'edit-name') {
    const dialog = document.getElementById('name-dialog');
    document.getElementById('name-input').value = state.profile?.display_name || '';
    dialog.showModal();
  }
});

document.getElementById('name-cancel').addEventListener('click', () => document.getElementById('name-dialog').close());
document.getElementById('name-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('name-input').value.trim().slice(0, 30);
  if (!name) return;
  const { error } = await sb.from('profiles').update({ display_name: name }).eq('id', state.session.user.id);
  if (error) return toast(friendlyError(error), 'error');
  state.profile.display_name = name;
  document.getElementById('name-dialog').close();
  toast('Name updated', 'good');
  render();
});

// ---------------------------------------------------------------------------
// Sign in (email magic link or 6-digit code)
// ---------------------------------------------------------------------------

const GOOGLE_G = `<svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>`;

function renderSignIn(route) {
  const joining = route.name === 'join' || localStorage.getItem(JOIN_KEY);
  if (state.pendingEmail) return renderCheckEmail();

  app.innerHTML = `
    <section class="hero">
      <p class="eyebrow">${joining ? "You've been invited to a league" : 'Pick’em & brackets for you and your friends'}</p>
      <h1>Pick winners. Talk trash. Climb the board.</h1>
      <p class="lede">Start a private league for the NFL, NBA, NHL or MLB, pick games on the real schedule, and let the leaderboard settle the arguments.</p>
    </section>
    <section class="card narrow">
      <h2>${joining ? 'Sign in to join' : 'Get started'}</h2>
      <div class="stack">
        <button class="btn big google" id="google-btn" type="button">${GOOGLE_G}<span>Continue with Google</span></button>
        <details class="email-signin">
          <summary>No Google account? Use email instead</summary>
          <form id="signin-form" class="stack">
            <label><span>Display name <span class="muted">(new players)</span></span>
              <input name="name" maxlength="30" placeholder="e.g. Derek" autocomplete="nickname">
            </label>
            <label>Email
              <input name="email" type="email" required placeholder="you@example.com" autocomplete="email">
            </label>
            <button class="btn secondary" type="submit">Email me a sign-in link</button>
            <p class="muted small">No password needed. We'll email you a link. Open it on this device.</p>
          </form>
        </details>
        <p class="muted small center"><a href="#/how">How Pick Six works</a></p>
      </div>
    </section>`;

  document.getElementById('google-btn').addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: location.origin + location.pathname },
    });
    if (error) {
      e.currentTarget.disabled = false;
      toast(/provider is not enabled/i.test(error.message)
        ? 'Google sign-in isn’t switched on yet — use email for now.' : friendlyError(error), 'error');
    }
  });

  document.getElementById('signin-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const email = form.get('email').trim();
    const name = form.get('name').trim();
    const btn = e.target.querySelector('button');
    btn.disabled = true; btn.textContent = 'Sending…';
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: location.origin + location.pathname,
        data: name ? { display_name: name } : undefined,
      },
    });
    if (error) {
      btn.disabled = false; btn.textContent = 'Email me a sign-in link';
      return toast(/rate limit/i.test(error.message)
        ? 'Too many sign-in emails right now — try Google sign-in, or wait a bit.' : friendlyError(error), 'error');
    }
    state.pendingEmail = email;
    renderCheckEmail();
  });
}

function renderCheckEmail() {
  app.innerHTML = `
    <section class="card narrow">
      <h2>Check your email</h2>
      <p>We sent a sign-in link to <strong>${esc(state.pendingEmail)}</strong>.
      Tap <strong>Sign in</strong> in that email on this device and you'll land back here, signed in.</p>
      <p class="muted small">Nothing there after a minute? Check spam, or go back and use Google instead.</p>
      <button class="link" id="restart">← Back</button>
    </section>`;
  document.getElementById('restart').onclick = () => { state.pendingEmail = null; render(); };
}

// ---------------------------------------------------------------------------
// How it works
// ---------------------------------------------------------------------------

function renderHow() {
  app.innerHTML = `
    <article class="how">
      <a href="#/" class="link small">← ${state.session ? 'Your leagues' : 'Back'}</a>
      <h1>How Pick Six works</h1>

      <section class="card">
        <h2>Leagues</h2>
        <ul>
          <li>Start a private league for one sport (NFL, NBA, NHL or MLB) and share the invite link or 6-letter code.</li>
          <li>Only people in your league can see it, its picks or its standings.</li>
          <li>The league owner can rename it, remove players or delete it. Anyone can leave a league from <strong>Manage</strong>.</li>
        </ul>
      </section>

      <section class="card">
        <h2>Making picks</h2>
        <ul>
          <li><strong>NFL</strong>: pick every game, week by week. <strong>NBA, NHL, MLB</strong>: pick day by day, because they play almost every night.</li>
          <li>Tap a team to pick it. You can change your mind as often as you like until that game starts.</li>
          <li><strong>Each game locks at its own start time.</strong> A Sunday game stays open even after Thursday's game locks.</li>
          <li>Your league-mates' picks stay hidden until a game starts. After that, everyone's picks for it are shown.</li>
        </ul>
      </section>

      <section class="card">
        <h2>Scoring &amp; standings</h2>
        <ul>
          <li>1 point for every correct pick. Ties and postponed games don't count either way.</li>
          <li><strong>Standings</strong> rank by total correct picks, then win percentage.</li>
          <li>Each week someone takes the <strong>weekly win</strong> (most correct that week, Monday to Sunday for daily sports). Ties share it.</li>
          <li>Scores update about every 15 minutes during games.</li>
        </ul>
      </section>

      <section class="card">
        <h2>Brackets</h2>
        <ul>
          <li>The <strong>Bracket</strong> tab shows the playoff picture with the final in the middle.</li>
          <li>During the season the seeds are "if the season ended today" and your bracket is just for practice.
            When the regular season ends, real brackets open. They lock when the first playoff game starts, and then everyone's are revealed.</li>
          <li>Points per correct winner: 1 in round one, 2 in round two, 4 for the conference final, 8 for the final.</li>
          <li><strong>Build your own</strong> is always open. First choose which teams make the playoffs and their seeds (NBA brackets include the play-in tournament for seeds 7 to 10), then fill it out or simulate it. Start from today's standings or your own standings prediction. It never counts in the league.</li>
          <li>🎲 <strong>Simulate</strong> plays out the bracket using team records and home advantage. <strong>Title odds</strong> come from thousands of simulated playoffs. It's a simple model, not a prediction you should bet on.</li>
        </ul>
        <p class="muted small">Formats: NFL 7 teams per conference (with a bye and re-seeding), NBA and NHL 8 teams with best-of-7 series
          (the NHL's real division-based pairings are simplified), MLB 6 teams per league with byes for the top two.</p>
      </section>

      <section class="card">
        <h2>Predictions</h2>
        <ul>
          <li><strong>Final standings:</strong> rank every team in each conference. 3 points for the exact spot and 1 for one spot off, scored live against today's standings.</li>
          <li><strong>Awards:</strong> MVPs, rookies, trophies, coaches and executives (pick the team), playoff MVPs and more. 3 points each.</li>
          <li><strong>All-Stars</strong> (<strong>Pro Bowl</strong> for NFL): fill the whole roster for each side, starters, reserves and injury replacements. 1 point per player who makes it.</li>
          <li><strong>Year-end teams:</strong> All-NBA, All-Defensive, All-Rookie, All-Pro, All-MLB and more. 1 point per correct player.</li>
          <li>Picks stay hidden until the league owner locks them. The owner enters the real results when they're announced.</li>
        </ul>
      </section>

      <section class="card">
        <h2>Signing in</h2>
        <ul>
          <li>Use <strong>Continue with Google</strong>, or get a sign-in link by email. There's no password.</li>
          <li>If Google sign-in won't open from a chat app (like Instagram or Messenger), open the link in Safari or Chrome instead.</li>
          <li>Change your display name any time by tapping your name at the top.</li>
        </ul>
      </section>
    </article>`;
}

// ---------------------------------------------------------------------------
// Home: your leagues, create, join
// ---------------------------------------------------------------------------

async function renderHome(stale) {
  app.innerHTML = '<div class="loading">Loading your leagues…</div>';
  const nowIso = new Date().toISOString();
  const [{ data: leagues, error }, ...upcoming] = await Promise.all([
    sb.from('leagues').select('id, name, invite_code, season, sport, league_members(count)').order('created_at'),
    // A sport can host new leagues only while it has games coming up.
    ...Object.keys(SPORTS).map((sport) => sb.from('games').select('id').eq('sport', sport)
      .gt('start_time', nowIso).limit(1)),
  ]);
  const inSeason = Object.fromEntries(Object.keys(SPORTS).map((sport, i) => [sport, (upcoming[i].data || []).length > 0]));
  const firstOpen = Object.keys(SPORTS).find((sp) => inSeason[sp]);
  if (stale()) return;
  if (error) { app.innerHTML = `<p class="error">${esc(friendlyError(error))}</p>`; return; }

  const cards = leagues.map((l) => `
    <a class="league-card" href="#/league/${l.id}">
      <span class="league-name">${esc(l.name)}</span>
      <span class="muted small"><span class="sport-tag">${esc(sportInfo(l.sport).name)}</span> ${l.league_members?.[0]?.count ?? 1} players</span>
      <span class="arrow" aria-hidden="true">→</span>
    </a>`).join('');

  app.innerHTML = `
    <section class="page-head">
      <h1>Your leagues</h1>
    </section>
    ${leagues.length ? `<div class="league-list">${cards}</div>` : `
      <div class="empty card">
        <p><strong>No leagues yet.</strong> Start one and send the invite link to your group chat,
        or join with a code a friend sent you.</p>
      </div>`}
    <div class="two-col">
      <form id="create-form" class="card stack">
        <h2>Start a league</h2>
        <input name="name" maxlength="50" required placeholder="League name, e.g. Sunday Crew">
        <fieldset class="sport-pick">
          <legend class="muted small">Sport</legend>
          ${Object.entries(SPORTS).map(([key, info]) => `
            <label class="sport-option ${inSeason[key] ? '' : 'off'}" title="${inSeason[key] ? '' : `${info.name} opens when its next season's schedule is out`}">
              <input type="radio" name="sport" value="${key}" ${key === firstOpen ? 'checked' : ''} ${inSeason[key] ? '' : 'disabled'}>
              <span>${info.name}${inSeason[key] ? '' : ' <small>off-season</small>'}</span></label>`).join('')}
        </fieldset>
        <button class="btn" type="submit">Create league</button>
      </form>
      <form id="join-form" class="card stack">
        <h2>Join a league</h2>
        <input name="code" maxlength="6" required placeholder="Invite code" class="code-input" autocapitalize="characters">
        <button class="btn secondary" type="submit">Join</button>
      </form>
    </div>`;

  document.getElementById('create-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const name = form.get('name').trim();
    const { data, error } = await sb.rpc('create_league', { p_name: name, p_sport: form.get('sport') || 'nfl' });
    if (error) return toast(friendlyError(error), 'error');
    toast(`${data.name} created — invite your friends!`, 'good');
    go(`#/league/${data.id}`);
  });
  document.getElementById('join-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = new FormData(e.target).get('code').trim();
    const { data, error } = await sb.rpc('join_league', { p_code: code });
    if (error) return toast(friendlyError(error), 'error');
    toast(`Welcome to ${data.name}!`, 'good');
    go(`#/league/${data.id}`);
  });
}

// ---------------------------------------------------------------------------
// League page
// ---------------------------------------------------------------------------

async function renderLeague(route, stale, { quiet = false } = {}) {
  const cached = fresh(cache.leagues.get(route.id), LEAGUE_TTL);
  if (!quiet && !cached) app.innerHTML = '<div class="loading">Loading league…</div>';

  const bundle = await getLeagueBundle(route.id);
  if (stale()) return;
  const league = bundle?.league;
  if (!league) {
    app.innerHTML = `<section class="card narrow"><h2>League not found</h2>
      <p>You may not be a member yet. Ask the owner for an invite link.</p><a class="btn" href="#/">Back to your leagues</a></section>`;
    return;
  }

  const members = bundle.members.map((m) => ({ ...m }));
  const needsGames = route.tab === 'picks' || route.tab === 'bracket';
  let games = [];
  if (needsGames) {
    try {
      games = quiet ? await refreshLiveGames(league.sport, league.season) : await getGames(league.sport, league.season);
    } catch { games = []; }
  }
  if (stale()) return;
  app.classList.toggle('wide', route.tab === 'bracket' || (route.tab === 'predict' && route.sub === 'allstars'));

  const tab = (key, label, extra = '') => `<a href="#/league/${league.id}${key === 'picks' ? '' : `?tab=${key}`}${extra}"
    class="${route.tab === key ? 'on' : ''}" ${route.tab === key ? 'aria-current="page"' : ''}>${label}</a>`;
  const head = `
    <header class="band">
      <div class="band-inner">
        <a href="#/" class="band-back">Your leagues</a>
        <div class="band-row">
          <div class="band-id">
            <h1 class="band-title">${esc(league.name)}</h1>
            <p class="band-meta"><span class="sport-badge">${esc(sportInfo(league.sport).name)}</span>
              <span>${members.length} player${members.length === 1 ? '' : 's'}</span>
              <span>Code <strong class="code">${esc(league.invite_code)}</strong></span></p>
          </div>
          <div class="band-actions">
            <button class="btn small on-dark" id="invite-btn">Invite friends</button>
            <button class="btn small ghost on-dark" id="manage-btn">Manage</button>
          </div>
        </div>
        <nav class="band-tabs" aria-label="League">
          ${tab('picks', 'Picks')}${tab('leaderboard', 'Leaderboard')}${tab('bracket', 'Bracket')}${tab('predict', 'Predictions')}
        </nav>
      </div>
    </header>`;

  let body;
  if (route.tab === 'leaderboard') body = await standingsHtml(league, members, games);
  else if (route.tab === 'bracket') body = '<div id="bracket-root"><div class="loading">Loading bracket…</div></div>';
  else if (route.tab === 'predict') body = `${predictionsNav(league, route)}<div id="predict-root"><div class="loading">Loading…</div></div>`;
  else body = await picksHtml(league, members, games, route);
  if (stale()) return;

  app.innerHTML = head + `<div class="page">${body}</div>`;
  state.league = league;

  const sel = document.getElementById('week-select');
  if (sel) sel.onchange = () => go(`#/league/${league.id}?week=${sel.value}`);

  document.getElementById('manage-btn').onclick = () => openManage(league, members);
  document.getElementById('invite-btn').onclick = async () => {
    const link = inviteLink(league.invite_code);
    const text = `Join my Pick Six league "${league.name}": ${link}`;
    if (navigator.share) {
      try { await navigator.share({ title: 'Pick Six', text, url: link }); return; } catch { /* fall back to copy */ }
    }
    try { await navigator.clipboard.writeText(link); toast('Invite link copied. Paste it in your group chat.', 'good'); }
    catch { toast(link); }
  };

  if (route.tab === 'bracket') {
    await mountBracket(league, members, games, stale, route);
    return; // no auto-refresh here, so a simulation isn't wiped mid-look
  }
  if (route.tab === 'predict') {
    await mountPredictions(league, members, route, stale);
    return;
  }

  // Keep live games fresh: re-load every minute while anything is in progress or about to lock.
  const live = games.some((g) => g.status === 'in'
    || (g.status === 'pre' && new Date(g.start_time) - Date.now() < 15 * 6e4 && new Date(g.start_time) > Date.now() - 4 * 36e5));
  if (live) {
    state.refreshTimer = setInterval(() => {
      if (document.visibilityState === 'visible' && !document.querySelector('dialog[open]')) {
        const id = ++state.renderId;
        renderLeague(route, () => id !== state.renderId, { quiet: true });
      }
    }, 60_000);
  }
}

// A slate = the set of games you pick together: an NFL week, or one day for NBA/NHL/MLB.
function groupSlates(games, sport) {
  const daily = sportInfo(sport).daily;
  const slates = new Map();
  for (const g of games) {
    const k = g.slate || weekKey(g.season_type, g.week);
    if (!slates.has(k)) {
      slates.set(k, { key: k, type: g.season_type, week: g.week, games: [],
        label: daily ? dayLabel(k) : weekLabel(g.season_type, g.week, sport) });
    }
    slates.get(k).games.push(g);
  }
  return [...slates.values()].sort((a, b) => (daily
    ? a.key.localeCompare(b.key)
    : a.type - b.type || a.week - b.week));
}

function defaultSlate(slates, sport) {
  if (sportInfo(sport).daily) {
    const today = todayET();
    const upcoming = slates.find((s) => s.key >= today);
    // Today, unless everything today is already final — then the next day with games.
    if (upcoming?.key === today && upcoming.games.every((g) => g.status === 'post')) {
      return (slates.find((s) => s.key > today) || upcoming).key;
    }
    return (upcoming || slates[slates.length - 1])?.key;
  }
  // The first week that still has a game that isn't finished.
  const now = Date.now();
  return (slates.find((w) => w.games.some((g) => g.status !== 'post' && new Date(g.start_time) > now - 864e5))
    || slates[slates.length - 1])?.key;
}

// ----- Picks tab -----

async function picksHtml(league, members, games, route) {
  const weeks = groupSlates(games, league.sport);
  const unit = sportInfo(league.sport).unit;
  if (!weeks.length) {
    return `<div class="empty card"><p><strong>No games loaded yet.</strong>
      Run the "Sync games" GitHub Action (with "Load whole seasons" ticked) to pull in the schedule.</p></div>`;
  }

  const key = weeks.some((w) => w.key === route.week) ? route.week : defaultSlate(weeks, league.sport);
  const idx = weeks.findIndex((w) => w.key === key);
  const wk = weeks[idx];
  const ids = wk.games.map((g) => g.id);

  const picksRes = await sb.from('picks').select('user_id, game_id, pick')
    .eq('league_id', league.id).in('game_id', ids);
  const picks = picksRes.data || [];
  const me = state.session.user.id;
  const mine = new Map(picks.filter((p) => p.user_id === me).map((p) => [p.game_id, p.pick]));

  const open = wk.games.filter(isOpen);
  const pickedOpen = open.filter((g) => mine.has(g.id)).length;
  const graded = wk.games.filter((g) => g.winner && mine.has(g.id));
  const right = graded.filter((g) => mine.get(g.id) === g.winner).length;
  const nextLock = open.find((g) => !mine.has(g.id)) || open[0];

  const weekLink = (w) => `#/league/${league.id}?week=${w.key}`;
  const nav = `
    <div class="week-nav">
      ${idx > 0 ? `<a class="btn icon ghost" href="${weekLink(weeks[idx - 1])}" aria-label="Previous ${unit}">‹</a>` : '<span class="btn icon ghost disabled">‹</span>'}
      <select id="week-select" aria-label="Choose ${unit}">
        ${weeks.map((w) => `<option value="${w.key}" ${w.key === key ? 'selected' : ''}>${esc(w.label)}${w.type === 3 && unit === 'day' ? ' · Playoffs' : ''}</option>`).join('')}
      </select>
      ${idx < weeks.length - 1 ? `<a class="btn icon ghost" href="${weekLink(weeks[idx + 1])}" aria-label="Next ${unit}">›</a>` : '<span class="btn icon ghost disabled">›</span>'}
    </div>`;

  const summary = `
    <div class="summary">
      ${open.length ? `<div><span class="big-num">${pickedOpen}/${open.length}</span><span class="muted small">open games picked</span></div>` : ''}
      ${graded.length ? `<div><span class="big-num">${right}-${graded.length - right}</span><span class="muted small">this ${unit}</span></div>` : ''}
      ${nextLock ? `<div><span class="big-num">${fmtCountdown(nextLock.start_time)}</span><span class="muted small">until ${nextLock.away_abbr} @ ${nextLock.home_abbr} locks</span></div>` : ''}
      ${!open.length && !graded.length ? `<div class="muted">All games for this ${unit} are locked.</div>` : ''}
    </div>`;

  const cards = wk.games.map((g) => gameCard(g, mine.get(g.id), picks, members, me)).join('');

  return nav + summary + `<div class="games">${cards}</div>`;
}

function teamButton(g, side, myPick, locked) {
  const t = side === 'home'
    ? { name: g.home_team, abbr: g.home_abbr, logo: g.home_logo, rec: g.home_record, score: g.home_score }
    : { name: g.away_team, abbr: g.away_abbr, logo: g.away_logo, rec: g.away_record, score: g.away_score };
  const picked = myPick === side;
  let result = '';
  if (g.winner && picked) result = g.winner === side ? 'correct' : 'wrong';
  const winnerCls = g.winner === side ? 'winner' : '';
  return `
    <button class="team ${picked ? 'picked' : ''} ${result} ${winnerCls}" ${locked ? 'disabled' : ''}
            data-game="${esc(g.id)}" data-pick="${side}" aria-pressed="${picked}"
            aria-label="Pick ${esc(t.name)}">
      ${t.logo ? `<img src="${esc(t.logo)}" alt="" loading="lazy" width="40" height="40">` : `<span class="logo-fallback">${esc(t.abbr)}</span>`}
      <span class="team-text">
        <span class="team-abbr">${esc(t.abbr)}</span>
        <span class="team-name">${esc(t.name)}</span>
        ${t.rec ? `<span class="team-rec">${esc(t.rec)}</span>` : ''}
      </span>
      ${g.status !== 'pre' && t.score !== null ? `<span class="score">${t.score}</span>` : ''}
      ${picked ? `<span class="badge">${result === 'correct' ? '✓' : result === 'wrong' ? '✗' : 'Your pick'}</span>` : ''}
    </button>`;
}

function gameCard(g, myPick, picks, members, me) {
  const locked = !isOpen(g);
  let status;
  if (g.status === 'post') status = `<span class="status final">${esc(g.status_detail || 'Final')}</span>`;
  else if (g.status === 'in') status = `<span class="status live">● ${esc(g.status_detail || 'Live')}</span>`;
  else if (locked) status = '<span class="status">🔒 Locked</span>';
  else status = `<span class="status">${fmtKickoff(g.start_time)}</span>`;

  // After kickoff everyone's picks are visible.
  let reveal = '';
  if (locked) {
    const gp = picks.filter((p) => p.game_id === g.id);
    const away = gp.filter((p) => p.pick === 'away');
    const home = gp.filter((p) => p.pick === 'home');
    const who = (list) => list.map((p) => `<span class="pill ${p.user_id === me ? 'me' : ''}">${esc(nameOf(members, p.user_id))}</span>`).join('') || '<span class="muted small">nobody</span>';
    const pct = gp.length ? Math.round((away.length / gp.length) * 100) : 50;
    reveal = gp.length ? `
      <div class="reveal">
        <div class="split" style="--pct:${pct}%"><span></span></div>
        <div class="reveal-cols">
          <div>${who(away)}</div>
          <div class="right">${who(home)}</div>
        </div>
      </div>` : '';
  } else if (!myPick) {
    status += ' <span class="nudge">Pick needed</span>';
  }

  return `
    <article class="game ${locked ? 'locked' : ''}">
      <div class="game-top">${status}</div>
      <div class="matchup">
        ${teamButton(g, 'away', myPick, locked)}
        <span class="at">@</span>
        ${teamButton(g, 'home', myPick, locked)}
      </div>
      ${reveal}
    </article>`;
}

async function makePick(league, gameId, side, btn) {
  const card = btn.closest('.matchup');
  const prev = card.querySelector('.team.picked');
  if (prev === btn) return;
  // Optimistic update
  card.querySelectorAll('.team').forEach((b) => {
    b.classList.toggle('picked', b === btn);
    b.setAttribute('aria-pressed', b === btn);
    b.querySelector('.badge')?.remove();
  });
  btn.insertAdjacentHTML('beforeend', '<span class="badge">Your pick</span>');
  btn.closest('.game').querySelector('.nudge')?.remove();

  const { error } = await sb.from('picks').upsert(
    { league_id: league.id, user_id: state.session.user.id, game_id: gameId, pick: side },
    { onConflict: 'league_id,user_id,game_id' },
  );
  if (error) {
    toast(friendlyError(error), 'error');
    render();
  } else {
    const summary = document.querySelector('.summary .big-num');
    if (summary && !prev) {
      const [a, b] = summary.textContent.split('/').map(Number);
      if (!Number.isNaN(a) && b) summary.textContent = `${Math.min(a + 1, b)}/${b}`;
    }
  }
}

// ----- Standings tab -----

async function standingsHtml(league, members) {
  const sport = league.sport;
  const { data: rows, error } = await sb.rpc('league_leaderboard', { p_league: league.id });
  if (error) return `<p class="error">${esc(friendlyError(error))}</p>`;

  const players = new Map(members.map((m) => [m.user_id, { ...m, correct: 0, graded: 0, weekWins: 0 }]));
  const byWeek = new Map();
  for (const r of rows) {
    const p = players.get(r.user_id) || players.set(r.user_id, { user_id: r.user_id, name: r.display_name, correct: 0, graded: 0, weekWins: 0 }).get(r.user_id);
    p.name = r.display_name;
    if (r.week == null) continue;
    p.correct += r.correct;
    p.graded += r.graded;
    const k = weekKey(r.season_type, r.week);
    if (!byWeek.has(k)) byWeek.set(k, { type: r.season_type, week: r.week, rows: [] });
    byWeek.get(k).rows.push(r);
  }

  // Weekly winners (ties share the win)
  const weekly = [...byWeek.values()].sort((a, b) => b.type - a.type || b.week - a.week).map((w) => {
    const best = Math.max(...w.rows.map((r) => r.correct));
    const winners = w.rows.filter((r) => r.correct === best && best > 0);
    winners.forEach((r) => { players.get(r.user_id).weekWins += 1; });
    return { ...w, best, winners };
  });

  const table = [...players.values()].sort((a, b) => b.correct - a.correct
    || (b.graded ? b.correct / b.graded : 0) - (a.graded ? a.correct / a.graded : 0)
    || a.name.localeCompare(b.name));

  let rank = 0; let last = null;
  const me = state.session.user.id;
  const rowsHtml = table.map((p, i) => {
    if (p.correct !== last) { rank = i + 1; last = p.correct; }
    const pct = p.graded ? (p.correct / p.graded).toFixed(3).replace(/^0/, '') : '—';
    return `
      <tr class="${p.user_id === me ? 'me' : ''}">
        <td class="rank">${rank === 1 && p.correct > 0 ? '🏆' : rank}</td>
        <td class="player">${esc(p.name)}</td>
        <td class="num strong">${p.correct}</td>
        <td class="num">${p.graded - p.correct}</td>
        <td class="num">${pct}</td>
        <td class="num">${p.weekWins || '—'}</td>
      </tr>`;
  }).join('');

  const weeklyHtml = weekly.length ? weekly.map((w) => `
    <li><span class="wk">${weekLabel(w.type, w.week, sport)}</span>
      <span>${w.winners.length ? w.winners.map((r) => esc(r.display_name)).join(', ') : '<span class="muted">—</span>'}</span>
      <span class="muted small">${w.best} correct</span></li>`).join('')
    : '<li class="muted">Weekly winners show up once games go final.</li>';

  return `
    <div class="card flush">
      <table class="standings">
        <thead><tr><th>#</th><th>Player</th><th class="num">W</th><th class="num">L</th><th class="num">Pct</th><th class="num" title="Weeks won">Wk wins</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
    <section class="card">
      <h2>Weekly winners</h2>
      <ul class="weekly">${weeklyHtml}</ul>
    </section>`;
}

// ----- Manage league dialog -----

const NOT_ALLOWED = 'That didn\u2019t go through. The database may need its latest update (re-run supabase/schema.sql).';

function openManage(league, members) {
  const dialog = document.getElementById('manage-dialog');
  const me = state.session.user.id;
  const isOwner = league.created_by === me;
  const confirmTap = (btn, label) => {
    // Two-tap confirm: first tap arms the button, second tap acts.
    if (btn.dataset.armed) return true;
    btn.dataset.armed = '1';
    btn.textContent = label;
    btn.classList.add('danger');
    setTimeout(() => { delete btn.dataset.armed; }, 4000);
    return false;
  };

  const draw = () => {
    dialog.innerHTML = `
      <div class="manage">
        <div class="row between"><h2>Manage league</h2>
          <button class="btn icon ghost" data-close aria-label="Close">×</button></div>
        ${isOwner ? `
          <form id="rename-form" class="stack">
            <label>League name <input name="name" maxlength="50" required value="${esc(league.name)}"></label>
            <button class="btn small" type="submit">Save name</button>
          </form>` : ''}
        <h3>Players (${members.length})</h3>
        <ul class="member-list">
          ${members.map((m) => `
            <li><span>${esc(m.name)}${m.user_id === me ? ' <span class="muted small">(you)</span>' : ''}
              ${m.role === 'owner' ? ' <span class="sport-tag">Owner</span>' : ''}</span>
              ${isOwner && m.user_id !== me ? `<button class="btn small ghost" data-remove="${m.user_id}">Remove</button>` : ''}
            </li>`).join('')}
        </ul>
        <div class="danger-zone">
          ${isOwner
            ? `<button class="btn small ghost" data-delete>Delete league</button>
               <p class="muted small">Deleting removes the league, everyone's picks and brackets for good.</p>`
            : `<button class="btn small ghost" data-leave>Leave league</button>
               <p class="muted small">You can rejoin later with the invite code.</p>`}
        </div>
      </div>`;
  };

  dialog.onclick = async (e) => {
    if (e.target === dialog || e.target.closest('[data-close]')) { dialog.close(); return; }
    const remove = e.target.closest('[data-remove]');
    if (remove) {
      const who = members.find((m) => m.user_id === remove.dataset.remove);
      if (!confirmTap(remove, `Remove ${who?.name ?? 'player'}?`)) return;
      const { error } = await sb.from('league_members').delete()
        .eq('league_id', league.id).eq('user_id', remove.dataset.remove);
      if (error) return toast(friendlyError(error), 'error');
      // The database quietly skips deletes it doesn't allow, so check it really happened.
      const { data: still } = await sb.from('league_members').select('user_id')
        .eq('league_id', league.id).eq('user_id', remove.dataset.remove);
      if (still?.length) return toast(NOT_ALLOWED, 'error');
      forgetLeague(league.id);
      members.splice(members.indexOf(who), 1);
      toast(`${who?.name ?? 'Player'} removed`, 'good');
      draw();
      return;
    }
    const leave = e.target.closest('[data-leave]');
    if (leave) {
      if (!confirmTap(leave, 'Tap again to leave')) return;
      const { error } = await sb.from('league_members').delete().eq('league_id', league.id).eq('user_id', me);
      if (error) return toast(friendlyError(error), 'error');
      const { data: still } = await sb.from('league_members').select('user_id').eq('league_id', league.id).eq('user_id', me);
      if (still?.length) return toast(NOT_ALLOWED, 'error');
      forgetLeague(league.id);
      dialog.close();
      toast(`You left ${league.name}`, 'good');
      go('#/');
      return;
    }
    const del = e.target.closest('[data-delete]');
    if (del) {
      if (!confirmTap(del, 'Tap again to delete for good')) return;
      const { error } = await sb.from('leagues').delete().eq('id', league.id);
      if (error) return toast(friendlyError(error), 'error');
      const { data: still } = await sb.from('leagues').select('id').eq('id', league.id);
      if (still?.length) return toast(NOT_ALLOWED, 'error');
      forgetLeague(league.id);
      dialog.close();
      toast(`${league.name} deleted`, 'good');
      go('#/');
    }
  };

  dialog.onsubmit = async (e) => {
    if (e.target.id !== 'rename-form') return;
    e.preventDefault();
    const name = new FormData(e.target).get('name').trim();
    if (!name) return;
    const { error } = await sb.from('leagues').update({ name }).eq('id', league.id);
    if (error) return toast(friendlyError(error), 'error');
    forgetLeague(league.id);
    league.name = name;
    toast('League renamed', 'good');
    dialog.close();
    render();
  };

  draw();
  dialog.showModal();
}

// ===========================================================================
// Predictions: final standings, awards, All-Stars, year-end teams
// ===========================================================================

const playerCache = new Map(); // id → player, filled as needed (never the whole list)
const teamsCache = new Map();  // sport → team rows

async function fetchPlayers(ids) {
  const missing = [...new Set(ids)].filter((id) => id && !id.startsWith('custom:') && !id.startsWith('team:') && !playerCache.has(id));
  for (let i = 0; i < missing.length; i += 100) {
    const { data } = await sb.from('players').select('id, name, team_abbr, position, headshot').in('id', missing.slice(i, i + 100));
    for (const p of data || []) playerCache.set(p.id, p);
  }
}

async function getTeams(sport) {
  if (!teamsCache.has(sport)) {
    const { data } = await sb.from('teams').select('abbr, name, logo, conference, division, wins, losses, ties').eq('sport', sport);
    teamsCache.set(sport, data || []);
  }
  return teamsCache.get(sport);
}

async function searchPlayers(sport, term, teamAbbrs) {
  const safe = term.replace(/[%_,()]/g, ' ').trim();
  if (!safe) return [];
  let q = sb.from('players').select('id, name, team_abbr, position, headshot').eq('sport', sport)
    .ilike('name', `%${safe}%`).order('name').limit(30);
  if (teamAbbrs?.length) q = q.in('team_abbr', teamAbbrs);
  const { data } = await q;
  for (const p of data || []) playerCache.set(p.id, p);
  return data || [];
}

const recordText = (t) => (t ? `${t.wins}–${t.losses}${t.ties ? `–${t.ties}` : ''}` : '');
const teamLogo = (t, size = 28) => (t?.logo
  ? `<img class="tlogo" src="${esc(t.logo)}" alt="" width="${size}" height="${size}" loading="lazy">`
  : `<span class="tlogo blank" style="width:${size}px;height:${size}px">${esc((t?.abbr || '?').slice(0, 3))}</span>`);

// What a stored id means: a player, a team ("team:BOS") or a typed name ("custom:…").
function entityOf(id, teams) {
  if (id.startsWith('custom:')) return { kind: 'custom', name: id.slice(7), sub: '' };
  if (id.startsWith('team:')) {
    const t = teams.find((x) => x.abbr === id.slice(5));
    return { kind: 'team', name: t?.name || id.slice(5), sub: t ? recordText(t) : '', team: t };
  }
  const p = playerCache.get(id);
  return p ? { kind: 'player', name: p.name, sub: [p.team_abbr, p.position].filter(Boolean).join(' '), headshot: p.headshot, team: teams.find((x) => x.abbr === p.team_abbr) }
    : { kind: 'player', name: 'Unknown player', sub: '' };
}

const initials = (name) => name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
function portrait(e, size) {
  if (e.kind === 'team') return teamLogo(e.team, size);
  if (e.headshot) return `<img class="face" src="${esc(e.headshot)}" alt="" width="${size}" height="${size}" loading="lazy">`;
  return `<span class="face blank" style="width:${size}px;height:${size}px">${esc(initials(e.name))}</span>`;
}

// Small read-only chip, used in "everyone's picks" lists.
function entityChip(id, teams, verdict = null) {
  const e = entityOf(id, teams);
  return `<span class="echip ${verdict === true ? 'hit' : verdict === false ? 'miss' : ''}">${portrait(e, 22)}<span>${esc(e.name)}</span></span>`;
}

// ----- Shared engine for awards, All-Stars and year-end teams -----------------

async function mountSheets(root, league, members, stale, { sheets: defs, kind }) {
  const me = state.session.user.id;
  const isOwner = league.created_by === me;
  const sport = league.sport;
  const prefix = kind === 'awards' ? `${sport}:` : `${sport}:team:`;
  const sheets = defs.map((d) => ({ ...d, qid: `${prefix}${d.id}`, size: SEL.slotCount(d) }));
  const qids = sheets.map((s) => s.qid);

  const [picksRes, settingsRes, teams] = await Promise.all([
    sb.from('award_picks').select('user_id, question_id, players').eq('league_id', league.id).in('question_id', qids),
    sb.from('award_settings').select('question_id, locked_at, answers').eq('league_id', league.id).in('question_id', qids),
    getTeams(sport),
  ]);
  if (stale()) return;

  const picksByUser = new Map([[me, new Map()]]);
  const setRows = (rows) => {
    for (const r of rows || []) {
      if (!picksByUser.has(r.user_id)) picksByUser.set(r.user_id, new Map());
      picksByUser.get(r.user_id).set(r.question_id, r.players || []);
    }
  };
  setRows(picksRes.data);
  const settings = new Map((settingsRes.data || []).map((r) => [r.question_id, r]));
  await fetchPlayers([
    ...[...picksByUser.values()].flatMap((m) => [...m.values()].flat()),
    ...[...settings.values()].flatMap((r) => r.answers || []),
  ]);
  if (stale()) return;

  const pad = (arr, n) => Array.from({ length: n }, (_, i) => (arr || [])[i] || '');
  const mine = (sheet) => pad(picksByUser.get(me).get(sheet.qid), sheet.size);
  const answers = (sheet) => pad(settings.get(sheet.qid)?.answers, sheet.size);
  const answerSet = (sheet) => new Set((settings.get(sheet.qid)?.answers || []).filter(Boolean));
  const isOpen = (sheet) => { const l = settings.get(sheet.qid)?.locked_at; return !l || new Date(l) > new Date(); };
  const teamsFor = (sheet) => {
    const f = sheet.filter;
    if (!f || !teams.length) return teams;
    const list = teams.filter((t) => (f.conference ? t.conference === f.conference : true)
      && (f.division ? (t.division || '').toLowerCase().includes(f.division.toLowerCase()) : true));
    return list.length ? list : teams;
  };

  let active = null;     // { qid, flat, mode: 'pick' | 'answer' }
  let resultsFor = null; // qid the owner is entering results for
  let ownerMode = false; // owner controls stay out of the way until asked for
  let side = sheets[0]?.qid; // All-Stars: which conference/division is showing
  let searchTimer;

  const save = async (sheet, arr) => {
    picksByUser.get(me).set(sheet.qid, arr);
    const res = arr.some(Boolean)
      ? await sb.from('award_picks').upsert({ league_id: league.id, user_id: me, question_id: sheet.qid, players: arr },
        { onConflict: 'league_id,user_id,question_id' })
      : await sb.from('award_picks').delete().eq('league_id', league.id).eq('user_id', me).eq('question_id', sheet.qid);
    if (res.error) toast(/row-level/i.test(res.error.message) ? 'Picks for this one are locked.' : friendlyError(res.error), 'error');
  };
  const saveSettings = async (sheet, patch) => {
    const cur = settings.get(sheet.qid) || { question_id: sheet.qid, locked_at: null, answers: null };
    const next = { ...cur, ...patch };
    const { error } = await sb.from('award_settings').upsert({
      league_id: league.id, question_id: sheet.qid, locked_at: next.locked_at, answers: next.answers,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'league_id,question_id' });
    if (error) { toast(friendlyError(error), 'error'); return; }
    settings.set(sheet.qid, next);
    if ('locked_at' in patch) { // locking reveals everyone's picks
      const { data } = await sb.from('award_picks').select('user_id, question_id, players').eq('league_id', league.id).in('question_id', qids);
      setRows(data);
      await fetchPlayers((data || []).flatMap((r) => r.players || []));
    }
  };

  // Players already used on this sheet, or on sheets in the same group (All-NBA 1st/2nd/3rd…).
  const usedIds = (sheet, mode) => {
    const get = (s) => (mode === 'answer' ? answers(s) : mine(s));
    const related = sheets.filter((s) => s.qid === sheet.qid || (sheet.group && s.group === sheet.group));
    return new Set(related.flatMap(get).filter(Boolean));
  };

  // ----- pieces -----
  const statusOf = (sheet) => (answerSet(sheet).size ? ['done', 'Results in'] : isOpen(sheet) ? ['open', 'Open'] : ['locked', 'Locked']);

  // One spot on a roster or award. Filled spots show the player; empty ones are a button.
  const slot = (sheet, flat, value, mode, editable, size) => {
    const label = SEL.slotLabel(sheet, flat);
    const isActive = active && active.qid === sheet.qid && active.flat === flat && active.mode === mode;
    if (value) {
      const e = entityOf(value, teams);
      const verdict = mode === 'pick' && answerSet(sheet).size ? answerSet(sheet).has(value) : null;
      return `<div class="spot ${size} filled ${verdict === true ? 'hit' : verdict === false ? 'miss' : ''}">
        ${label ? `<span class="spot-label">${esc(label)}</span>` : ''}
        ${portrait(e, size === 'big' ? 56 : 32)}
        <span class="spot-name">${esc(e.name)}</span>
        ${e.sub ? `<span class="spot-sub">${esc(e.sub)}</span>` : ''}
        ${editable ? `<button class="spot-x" data-clear="${flat}" data-mode="${mode}" data-q="${sheet.qid}" aria-label="Remove ${esc(e.name)}">×</button>` : ''}
      </div>`;
    }
    if (!editable) return `<div class="spot ${size} empty">${label ? `<span class="spot-label">${esc(label)}</span>` : ''}<span class="spot-none">No pick</span></div>`;
    const what = sheet.pick === 'team' ? 'Choose team' : label ? `Add ${label.toLowerCase()}` : 'Add player';
    return `<button class="spot ${size} empty ${isActive ? 'active' : ''}" data-open="${flat}" data-mode="${mode}" data-q="${sheet.qid}">
      ${label ? `<span class="spot-label">${esc(label)}</span>` : ''}<span class="spot-add">${esc(what)}</span></button>`;
  };

  const drawer = (sheet) => {
    if (sheet.pick === 'team') {
      const used = usedIds(sheet, active.mode);
      return `<div class="drawer"><div class="team-pick">${teamsFor(sheet).slice().sort((a, b) => a.name.localeCompare(b.name)).map((t) => `
        <button class="tpick" data-choose="team:${esc(t.abbr)}" ${used.has(`team:${t.abbr}`) ? 'disabled' : ''}>${teamLogo(t, 26)}<span>${esc(t.name)}</span></button>`).join('')}
      </div><button class="link small" data-close>Cancel</button></div>`;
    }
    const f = sheet.filter;
    return `<div class="drawer">
      <div class="drawer-row"><input type="search" id="sheet-search" autocomplete="off"
        placeholder="Search ${esc(f?.conference || f?.division || sportInfo(sport).name)} players" aria-label="Search players">
        <button class="link small" data-close>Cancel</button></div>
      <div class="search-results" role="listbox" id="sheet-results"></div>
    </div>`;
  };

  // A section of spots; the search drawer opens under the section being filled.
  const sectionBlock = (sheet, sIdx, values, mode, editable) => {
    const section = sheet.sections[sIdx];
    const start = SEL.slotIndex(sheet, sIdx, 0);
    const size = section.size === 'big' ? 'big' : 'small';
    const spots = Array.from({ length: section.n }, (_, i) => slot(sheet, start + i, values[start + i], mode, editable, size)).join('');
    const showDrawer = active && active.qid === sheet.qid && active.mode === mode && active.flat >= start && active.flat < start + section.n;
    return `
      <section class="roster-section ${section.kind || ''}">
        ${sheet.size > 1 ? `<h4>${esc(section.label)}</h4>` : ''}
        <div class="spots ${size} n${section.n}">${spots}</div>
        ${showDrawer ? drawer(sheet) : ''}
      </section>`;
  };

  const ownerTools = (sheet) => {
    if (!isOwner || !ownerMode) return '';
    const open = isOpen(sheet);
    const entering = resultsFor === sheet.qid;
    return `<div class="owner-tools">
      <span class="muted small">Owner</span>
      ${open ? `<button class="link small" data-lock="${sheet.qid}">Lock picks</button>`
        : `<button class="link small" data-unlock="${sheet.qid}">Reopen picks</button>`}
      <button class="link small" data-results="${sheet.qid}">${entering ? 'Done entering results' : answerSet(sheet).size ? 'Edit results' : 'Enter results'}</button>
    </div>`;
  };

  const everyone = (sheet) => {
    if (isOpen(sheet)) return '';
    const set = answerSet(sheet);
    return `<details class="everyone"><summary>See everyone's picks</summary><ul>${members.map((m) => {
      const list = (picksByUser.get(m.user_id)?.get(sheet.qid) || []).filter(Boolean);
      const hits = list.filter((id) => set.has(id)).length;
      return `<li><span class="who">${esc(m.name)}${set.size ? ` <span class="muted">${hits} right</span>` : ''}</span>
        <span class="echips">${list.length ? list.map((id) => entityChip(id, teams, set.size ? set.has(id) : null)).join('') : '<span class="muted small">No picks</span>'}</span></li>`;
    }).join('')}</ul></details>`;
  };

  // The roster (or results entry) for one sheet.
  const rosterBody = (sheet) => {
    const entering = resultsFor === sheet.qid;
    const values = entering ? answers(sheet) : mine(sheet);
    const editable = entering || isOpen(sheet);
    const mode = entering ? 'answer' : 'pick';
    return `
      ${entering ? '<p class="note">Fill in the real result. Saving locks this and scores everyone.</p>' : ''}
      ${sheet.sections.map((_, i) => sectionBlock(sheet, i, values, mode, editable)).join('')}
      ${!entering && answerSet(sheet).size ? `<p class="note">${[...answerSet(sheet)].length} real picks entered. Green spots made it.</p>` : ''}
      ${everyone(sheet)}
      ${ownerTools(sheet)}`;
  };

  const leaderboard = () => {
    const totals = SEL.scoreSheets(sheets, picksByUser, new Map([...settings].map(([k, v]) => [k, v.answers])));
    if (!totals.size) return '';
    const rows = members.map((m) => ({ m, t: totals.get(m.user_id) || { points: 0, correct: 0 } }))
      .sort((a, b) => b.t.points - a.t.points || a.m.name.localeCompare(b.m.name));
    return `<table class="board compact"><thead><tr><th>Player</th><th class="num">Right</th><th class="num">Points</th></tr></thead>
      <tbody>${rows.map(({ m, t }) => `<tr class="${m.user_id === me ? 'me' : ''}"><td>${esc(m.name)}</td>
        <td class="num">${t.correct}</td><td class="num strong">${t.points}</td></tr>`).join('')}</tbody></table>`;
  };

  const hidden = isOwner
    ? 'Picks stay hidden until you lock them.'
    : 'Picks stay hidden until the league owner locks them.';
  const ownerToggle = () => (isOwner ? `<p class="owner-switch"><button class="link small" data-ownermode>${ownerMode
    ? 'Hide owner controls' : 'Owner controls: lock picks and enter results'}</button></p>` : '');

  // ----- layouts -----
  const drawAwards = () => {
    const cats = [...new Set(sheets.map((s) => s.cat || 'season'))];
    return `
      <p class="lede-sm">Call the winners: 3 points each. ${hidden}</p>
      ${ownerToggle()}
      ${leaderboard()}
      ${cats.map((cat) => `
        <section class="award-cat">
          <h3>${esc(SEL.AWARD_CATEGORIES[cat] || 'Awards')}</h3>
          <div class="trophies">${sheets.filter((s) => (s.cat || 'season') === cat).map((sheet) => {
            const [cls, label] = statusOf(sheet);
            const entering = resultsFor === sheet.qid;
            const values = entering ? answers(sheet) : mine(sheet);
            const real = answerSet(sheet);
            return `
              <article class="trophy ${cls} ${entering ? 'entering' : ''}">
                <header><h4>${esc(sheet.title)}</h4>${sheet.note ? `<p>${esc(sheet.note)}</p>` : ''}<span class="pill ${cls}">${label}</span></header>
                ${slot(sheet, 0, values[0], entering ? 'answer' : 'pick', entering || isOpen(sheet), 'big')}
                ${active && active.qid === sheet.qid ? drawer(sheet) : ''}
                ${real.size && !entering ? `<p class="winner">Winner: <strong>${esc(entityOf([...real][0], teams).name)}</strong></p>` : ''}
                ${everyone(sheet)}
                ${ownerTools(sheet)}
              </article>`;
          }).join('')}</div>
        </section>`).join('')}`;
  };

  const drawAllStars = () => {
    const sheet = sheets.find((s) => s.qid === side) || sheets[0];
    const [cls, label] = statusOf(sheet);
    const filled = mine(sheet).filter(Boolean).length;
    return `
      <p class="lede-sm">Pick the full roster: 1 point for every player who makes it, injury replacements included. ${hidden}</p>
      ${ownerToggle()}
      ${leaderboard()}
      <div class="side-switch" role="tablist" aria-label="Choose a side">
        ${sheets.map((s) => `<button role="tab" aria-selected="${s.qid === sheet.qid}" class="${s.qid === sheet.qid ? 'on' : ''}" data-side="${s.qid}">
          ${esc(s.side)}<span class="count">${mine(s).filter(Boolean).length}/${s.size}</span></button>`).join('')}
      </div>
      <article class="roster">
        <header class="roster-head"><h3>${esc(sheet.title)}</h3><span class="muted small">${filled} of ${sheet.size} picked</span><span class="pill ${cls}">${label}</span></header>
        ${rosterBody(sheet)}
      </article>`;
  };

  const drawYearEnd = () => {
    const headings = [...new Set(sheets.map((s) => s.heading))];
    return `
      <p class="lede-sm">Name the year-end teams: 1 point for every player you get right. A player can only go on one team in each set. ${hidden}</p>
      ${ownerToggle()}
      ${leaderboard()}
      ${headings.map((h) => `
        <section class="ye-group">
          <h3>${esc(h)}</h3>
          ${sheets.filter((s) => s.heading === h).map((sheet) => {
            const [cls, label] = statusOf(sheet);
            return `<article class="roster ye">
              <header class="roster-head"><h4>${esc(sheet.title)}</h4><span class="pill ${cls}">${label}</span></header>
              ${rosterBody(sheet)}
            </article>`;
          }).join('')}
        </section>`).join('')}`;
  };

  const draw = () => {
    root.innerHTML = kind === 'awards' ? drawAwards() : kind === 'allstars' ? drawAllStars() : drawYearEnd();
    root.querySelector('#sheet-search')?.focus({ preventScroll: true });
  };

  // ----- search -----
  const runSearch = async (input) => {
    const box = root.querySelector('#sheet-results');
    const sheet = sheets.find((s) => s.qid === active?.qid);
    if (!box || !sheet) return;
    const term = input.value.trim();
    if (term.length < 2) { box.innerHTML = ''; return; }
    const fitsPos = SEL.slotPositions(sheet, active.flat);
    const taken = usedIds(sheet, active.mode);
    const allowed = sheet.filter ? teamsFor(sheet).map((t) => t.abbr) : null;
    const found = (await searchPlayers(sport, term, allowed)).filter((p) => !taken.has(p.id));
    if (input.value.trim() !== term) return; // a newer search is on its way
    const lower = term.toLowerCase();
    const fits = (p) => (fitsPos?.length ? fitsPos.includes(p.position) : true);
    found.sort((a, b) => (fits(b) - fits(a)) || (b.name.toLowerCase().startsWith(lower) - a.name.toLowerCase().startsWith(lower)));
    const exact = found.some((p) => p.name.toLowerCase() === lower);
    box.innerHTML = found.slice(0, 8).map((p) => `
      <button class="result ${fits(p) ? '' : 'off'}" role="option" data-choose="${esc(p.id)}">
        ${portrait({ kind: 'player', name: p.name, headshot: p.headshot }, 30)}
        <span class="r-name">${esc(p.name)}</span><span class="r-sub">${esc([p.team_abbr, p.position].filter(Boolean).join(' '))}</span>
      </button>`).join('')
      + (!exact ? `<button class="result custom" role="option" data-choose="custom:${esc(term)}">Use “${esc(term)}”</button>` : '');
  };

  root.oninput = (e) => {
    if (e.target.id !== 'sheet-search') return;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => runSearch(e.target), 180);
  };
  root.onkeydown = (e) => { if (e.key === 'Escape' && active) { active = null; draw(); } };

  root.onclick = async (e) => {
    const t = (sel) => e.target.closest(sel);
    const sheetOf = (q) => sheets.find((s) => s.qid === q);
    let el;
    if (t('[data-ownermode]')) {
      ownerMode = !ownerMode; if (!ownerMode) resultsFor = null; draw();
    } else if ((el = t('[data-side]'))) {
      side = el.dataset.side; active = null; draw();
    } else if ((el = t('[data-open]'))) {
      active = { qid: el.dataset.q, flat: Number(el.dataset.open), mode: el.dataset.mode };
      draw();
    } else if (t('[data-close]')) {
      active = null; draw();
    } else if ((el = t('[data-choose]')) && active) {
      const sheet = sheetOf(active.qid);
      const id = el.dataset.choose;
      const arr = active.mode === 'answer' ? answers(sheet) : mine(sheet);
      arr[active.flat] = id;
      // Move straight on to the next empty spot in the same section.
      const sec = SEL.sectionOf(sheet, active.flat);
      const next = arr.findIndex((v, i) => !v && i > active.flat && SEL.sectionOf(sheet, i) === sec);
      const mode = active.mode;
      active = next >= 0 ? { ...active, flat: next } : null;
      if (mode === 'answer') {
        await saveSettings(sheet, { answers: arr, locked_at: settings.get(sheet.qid)?.locked_at || new Date().toISOString() });
      } else {
        picksByUser.get(me).set(sheet.qid, arr);
        draw();
        await save(sheet, arr);
      }
      draw();
    } else if ((el = t('[data-clear]'))) {
      const sheet = sheetOf(el.dataset.q);
      const flat = Number(el.dataset.clear);
      if (el.dataset.mode === 'answer') {
        const arr = answers(sheet); arr[flat] = '';
        await saveSettings(sheet, { answers: arr.some(Boolean) ? arr : null });
      } else {
        const arr = mine(sheet); arr[flat] = '';
        picksByUser.get(me).set(sheet.qid, arr);
        draw();
        await save(sheet, arr);
      }
      draw();
    } else if ((el = t('[data-lock]'))) {
      await saveSettings(sheetOf(el.dataset.lock), { locked_at: new Date().toISOString() });
      active = null; draw();
    } else if ((el = t('[data-unlock]'))) {
      await saveSettings(sheetOf(el.dataset.unlock), { locked_at: null });
      draw();
    } else if ((el = t('[data-results]'))) {
      resultsFor = resultsFor === el.dataset.results ? null : el.dataset.results;
      active = null; draw();
    }
  };

  draw();
}

// ----- Final standings predictor ---------------------------------------------

const PLAYOFF_LINES = {
  nfl: { playoff: 7 },
  nba: { playoff: 6, playIn: 10 },
  nhl: { playoff: 8 },
  mlb: { playoff: 6 },
};

async function mountStandings(root, league, members, stale) {
  const me = state.session.user.id;
  const isOwner = league.created_by === me;
  const sport = league.sport;
  const confs = BR.formatOf(sport).conferences;
  const qidOf = (c) => `${sport}:standings:${c}`;
  const qids = confs.map(qidOf);

  const [teams, picksRes, settingsRes] = await Promise.all([
    getTeams(sport),
    sb.from('award_picks').select('user_id, question_id, players').eq('league_id', league.id).in('question_id', qids),
    sb.from('award_settings').select('question_id, locked_at').eq('league_id', league.id).in('question_id', qids),
  ]);
  if (stale()) return;
  if (!teams.length) {
    root.innerHTML = '<p class="empty-note">Team standings load with the next sync. Check back shortly.</p>';
    return;
  }

  const byAbbr = new Map(teams.map((t) => [t.abbr, t]));
  const confTeams = (c) => teams.filter((t) => t.conference === c);
  const real = Object.fromEntries(confs.map((c) => [c, SEL.realOrder(confTeams(c), sport)]));
  const saved = new Map(); // user → (conf → order)
  for (const r of picksRes.data || []) {
    const c = r.question_id.split(':').pop();
    if (!saved.has(r.user_id)) saved.set(r.user_id, new Map());
    saved.get(r.user_id).set(c, r.players || []);
  }
  const settings = new Map((settingsRes.data || []).map((r) => [r.question_id.split(':').pop(), r]));
  const isOpen = (c) => { const l = settings.get(c)?.locked_at; return !l || new Date(l) > new Date(); };

  // Your order: what you saved (keeping only teams still in that conference), else today's standings.
  const orderFor = (c) => {
    const valid = new Set(real[c]);
    const mineSaved = (saved.get(me)?.get(c) || []).filter((a) => valid.has(a));
    const rest = real[c].filter((a) => !mineSaved.includes(a));
    return [...mineSaved, ...rest];
  };
  const order = Object.fromEntries(confs.map((c) => [c, orderFor(c)]));
  const isSaved = (c) => (saved.get(me)?.get(c) || []).length > 0;
  let saveTimer;

  const persist = (c) => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      if (!saved.has(me)) saved.set(me, new Map());
      saved.get(me).set(c, order[c]);
      const { error } = await sb.from('award_picks').upsert(
        { league_id: league.id, user_id: me, question_id: qidOf(c), players: order[c] },
        { onConflict: 'league_id,user_id,question_id' },
      );
      if (error) toast(/row-level/i.test(error.message) ? 'These standings are locked.' : friendlyError(error), 'error');
      else draw();
    }, 500);
  };

  const lines = PLAYOFF_LINES[sport] || { playoff: 0 };
  const ordinal = (n) => `${n}${['th', 'st', 'nd', 'rd'][(n % 100 >= 11 && n % 100 <= 13) ? 0 : Math.min(n % 10, 4) % 4] || 'th'}`;

  const list = (c) => {
    const open = isOpen(c);
    const score = SEL.scoreStandings(order[c], real[c]);
    const rows = order[c].map((abbr, i) => {
      const t = byAbbr.get(abbr);
      const now = real[c].indexOf(abbr);
      const diff = now - i;
      const line = i + 1 === lines.playoff ? '<li class="cut cut-playoff" aria-hidden="true"><span>Playoff line</span></li>'
        : i + 1 === lines.playIn ? '<li class="cut cut-playin" aria-hidden="true"><span>Play-in line</span></li>' : '';
      return `<li class="rank-row ${diff === 0 ? 'exact' : Math.abs(diff) === 1 ? 'close' : ''}">
          <span class="rank">${i + 1}</span>
          ${teamLogo(t, 28)}
          <span class="r-team"><strong>${esc(t?.name || abbr)}</strong><span class="muted small">${recordText(t)} · ${ordinal(now + 1)} today</span></span>
          ${open ? `<span class="movers">
            <button class="mv" data-move="${c}:${i}:-1" ${i === 0 ? 'disabled' : ''} aria-label="Move ${esc(t?.name || abbr)} up">▲</button>
            <button class="mv" data-move="${c}:${i}:1" ${i === order[c].length - 1 ? 'disabled' : ''} aria-label="Move ${esc(t?.name || abbr)} down">▼</button>
          </span>` : ''}
        </li>${line}`;
    }).join('');
    return `
      <section class="standings-col">
        <header>
          <h3>${esc(c)}</h3>
          <p class="pred-score"><strong>${score.points}</strong> points if the season ended today <span class="muted small">${score.exact} in the exact spot</span></p>
          ${!isSaved(c) && open ? '<p class="note">Starting from today’s standings. Move teams to make it yours.</p>' : ''}
          ${!open ? '<span class="pill locked">Locked</span>' : ''}
        </header>
        <ol class="ranks">${rows}</ol>
        ${isOwner ? `<div class="owner-tools"><span class="muted small">Owner</span>
          ${open ? `<button class="link small" data-lockconf="${c}">Lock ${esc(c)} predictions</button>`
            : `<button class="link small" data-unlockconf="${c}">Reopen</button>`}</div>` : ''}
      </section>`;
  };

  const leaderboard = () => {
    const anyLocked = confs.some((c) => !isOpen(c));
    if (!anyLocked) return '';
    const rows = members.map((m) => {
      let pts = 0;
      for (const c of confs) {
        if (isOpen(c)) continue;
        const o = saved.get(m.user_id)?.get(c);
        if (o?.length) pts += SEL.scoreStandings(o, real[c]).points;
      }
      return { m, pts };
    }).sort((a, b) => b.pts - a.pts);
    return `<table class="board compact"><thead><tr><th>Player</th><th class="num">Points today</th></tr></thead>
      <tbody>${rows.map(({ m, pts }) => `<tr class="${m.user_id === me ? 'me' : ''}"><td>${esc(m.name)}</td><td class="num strong">${pts}</td></tr>`).join('')}</tbody></table>`;
  };

  const draw = () => {
    root.innerHTML = `
      <p class="lede-sm">Predict where every team finishes. 3 points for the exact spot, 1 point for one spot off, scored live against today’s standings.
        ${isOwner ? 'Lock each side before the season gets going.' : 'Everyone’s picks show once the owner locks them.'}</p>
      ${leaderboard()}
      <div class="standings-grid">${confs.map(list).join('')}</div>`;
  };

  root.onclick = async (e) => {
    const mv = e.target.closest('[data-move]');
    if (mv) {
      const [c, iStr, dStr] = mv.dataset.move.split(':');
      const i = Number(iStr); const j = i + Number(dStr);
      if (j < 0 || j >= order[c].length) return;
      [order[c][i], order[c][j]] = [order[c][j], order[c][i]];
      draw();
      root.querySelector(`[data-move="${c}:${j}:${dStr}"]`)?.focus();
      persist(c);
      return;
    }
    const lock = e.target.closest('[data-lockconf], [data-unlockconf]');
    if (lock) {
      const c = lock.dataset.lockconf || lock.dataset.unlockconf;
      const locked_at = lock.dataset.lockconf ? new Date().toISOString() : null;
      const { error } = await sb.from('award_settings').upsert({ league_id: league.id, question_id: qidOf(c), locked_at, updated_at: new Date().toISOString() },
        { onConflict: 'league_id,question_id' });
      if (error) return toast(friendlyError(error), 'error');
      settings.set(c, { locked_at });
      if (locked_at) {
        const { data } = await sb.from('award_picks').select('user_id, question_id, players').eq('league_id', league.id).in('question_id', qids);
        for (const r of data || []) {
          if (!saved.has(r.user_id)) saved.set(r.user_id, new Map());
          saved.get(r.user_id).set(r.question_id.split(':').pop(), r.players || []);
        }
      }
      draw();
    }
  };

  draw();
}

// Your saved standings prediction for a league (used to seed "Build your own").
async function myStandingsPrediction(league) {
  const sport = league.sport;
  const confs = BR.formatOf(sport).conferences;
  const { data } = await sb.from('award_picks').select('question_id, players').eq('league_id', league.id)
    .eq('user_id', state.session.user.id).in('question_id', confs.map((c) => `${sport}:standings:${c}`));
  const out = {};
  for (const r of data || []) out[r.question_id.split(':').pop()] = r.players || [];
  return confs.every((c) => out[c]?.length) ? out : null;
}

// ----- Predictions hub ---------------------------------------------------------

async function mountPredictions(league, members, route, stale) {
  const sub = ['standings', 'awards', 'allstars', 'yearend'].includes(route.sub) ? route.sub : 'standings';
  const root = document.getElementById('predict-root');
  if (sub === 'standings') return mountStandings(root, league, members, stale);
  if (sub === 'awards') return mountSheets(root, league, members, stale, { kind: 'awards', sheets: SEL.AWARDS[league.sport] || [] });
  if (sub === 'allstars') return mountSheets(root, league, members, stale, { kind: 'allstars', sheets: SEL.ALLSTARS[league.sport] || [] });
  return mountSheets(root, league, members, stale, { kind: 'yearend', sheets: SEL.YEAR_END[league.sport] || [] });
}

function predictionsNav(league, route) {
  const sub = route.sub || 'standings';
  const items = [
    ['standings', 'Final standings'],
    ['awards', 'Awards'],
    ['allstars', SEL.ALLSTAR_NAME[league.sport] || 'All-Stars'],
    ['yearend', 'Year-end teams'],
  ];
  return `<nav class="subnav" aria-label="Predictions">${items.map(([k, label]) =>
    `<a href="#/league/${league.id}?tab=predict&sub=${k}" class="${sub === k ? 'on' : ''}" ${sub === k ? 'aria-current="page"' : ''}>${esc(label)}</a>`).join('')}</nav>`;
}

// ===========================================================================
// Bracket tab
// ===========================================================================

const ODDS_MEMO = new Map(); // simulated title odds, per sport + field
const pct = (x) => (x >= 0.995 ? '>99%' : x < 0.005 ? (x > 0 ? '<1%' : '—') : `${Math.round(x * 100)}%`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lsGet = (k, fallback) => { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };

// Every team that appears in the loaded games, with its latest record (fallback when the teams table is empty).
function teamsFromGames(games) {
  const teams = new Map();
  const parse = (rec) => {
    const [w, l, t] = String(rec || '').split('-').map((n) => parseInt(n, 10));
    return { wins: w || 0, losses: l || 0, ties: t || 0 };
  };
  for (const g of games) {
    for (const side of ['home', 'away']) {
      const abbr = g[`${side}_abbr`];
      if (!abbr) continue;
      const prev = teams.get(abbr) || {};
      const rec = g[`${side}_record`] ? parse(g[`${side}_record`]) : null;
      teams.set(abbr, {
        abbr, name: g[`${side}_team`] || abbr, logo: g[`${side}_logo`] || prev.logo || null,
        ...(rec || { wins: prev.wins || 0, losses: prev.losses || 0, ties: prev.ties || 0 }),
      });
    }
  }
  return [...teams.values()];
}

async function mountBracket(league, members, games, stale, route) {
  const root = document.getElementById('bracket-root');
  const me = state.session.user.id;
  const sport = league.sport;
  const F = BR.formatOf(sport);
  const [c0, c1] = F.conferences;
  const fieldSize = F.teams + (F.playIn ? 2 : 0); // NBA "Build your own" includes the play-in (seeds 7–10)

  const [seedRes, stateRes, picksRes, teamRows] = await Promise.all([
    sb.from('playoff_seeds').select('*').eq('sport', sport).eq('season', league.season),
    sb.rpc('bracket_state', { p_league: league.id }),
    sb.from('bracket_picks').select('user_id, picks').eq('league_id', league.id),
    getTeams(sport),
  ]);
  if (stale()) return;

  const officialSeeds = BR.seedsByConference(seedRes.data, sport);
  const haveSeeds = BR.isComplete(officialSeeds, sport);
  const allTeams = (teamRows.length ? teamRows : teamsFromGames(games)).map((t) => ({ ...t, team_name: t.name }));
  const teamByAbbr = new Map(allTeams.map((t) => [t.abbr, t]));
  const knowsConferences = teamRows.length > 0;
  const confTeams = (c) => allTeams.filter((t) => !knowsConferences || t.conference === c);
  const todayOrder = (c) => (knowsConferences ? SEL.realOrder(confTeams(c), sport) : confTeams(c)
    .sort((a, b) => BR.strength(b) - BR.strength(a)).map((t) => t.abbr));
  const bstate = stateRes.data || 'not_ready';
  const brackets = picksRes.data || [];

  // ----- league bracket (practice before the season ends, then official) -----
  const practiceKey = `pickSix.practiceBracket.${league.id}`;
  let leaguePicks = bstate === 'not_ready' ? lsGet(practiceKey, {}) : (brackets.find((b) => b.user_id === me)?.picks || {});
  if (haveSeeds) leaguePicks = BR.cleanPicks(sport, officialSeeds, leaguePicks);

  // ----- build your own: choose the field, then fill the bracket (saved on this device) -----
  const funKey = `pickSix.funBracket2.${sport}`;
  const fieldFromToday = () => Object.fromEntries(F.conferences.map((c) => [c, todayOrder(c).slice(0, fieldSize)]));
  let fun = lsGet(funKey, null);
  const validField = (f) => f && F.conferences.every((c) => Array.isArray(f[c]) && f[c].length === fieldSize
    && f[c].every((a) => !a || !knowsConferences || teamByAbbr.get(a)?.conference === c));
  if (!fun || !validField(fun.field)) fun = { field: fieldFromToday(), picks: {}, step: 'field' };
  const persistFun = () => lsSet(funKey, fun);
  const fieldFull = () => F.conferences.every((c) => fun.field[c].every(Boolean));
  const funSeeds = () => Object.fromEntries(F.conferences.map((c) => [c, fun.field[c].filter(Boolean)
    .map((abbr, i) => ({ ...(teamByAbbr.get(abbr) || { abbr, team_name: abbr, wins: 0, losses: 0, ties: 0 }), seed: i + 1 }))]));

  let mode = route.mode === 'fun' || !haveSeeds ? 'fun' : 'league';
  let busy = false;
  let saveTimer;
  let saveNote = '';
  const seeds = () => (mode === 'fun' ? funSeeds() : officialSeeds);
  const getPicks = () => (mode === 'fun' ? fun.picks : leaguePicks);
  const editable = () => mode === 'fun' || bstate !== 'locked';
  const total = () => BR.totalGames(sport, seeds());

  const results = haveSeeds ? BR.actualResults(sport, officialSeeds, games) : {};
  const realWinners = new Set(Object.entries(results).map(([slot, abbr]) => `${BR.roundOf(slot)}:${abbr}`));
  const eliminated = new Set();
  if (haveSeeds) {
    for (const g of BR.allGames(sport, BR.buildBracket(sport, officialSeeds, results))) {
      if (g.winner) eliminated.add(g.winner === g.home ? g.away.abbr : g.home.abbr);
    }
  }
  const firstKick = games.filter((g) => g.season_type === 3).map((g) => g.start_time).sort()[0];

  const setPicks = (p) => {
    const clean = BR.cleanPicks(sport, seeds(), p);
    if (mode === 'fun') { fun.picks = clean; persistFun(); return; }
    leaguePicks = clean;
    if (bstate === 'not_ready') { lsSet(practiceKey, leaguePicks); return; }
    if (bstate !== 'open') return;
    saveNote = 'Saving…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const { error } = await sb.from('bracket_picks').upsert({ league_id: league.id, user_id: me, picks: leaguePicks }, { onConflict: 'league_id,user_id' });
      saveNote = error ? '' : 'Saved';
      if (error) toast(friendlyError(error), 'error');
      const el = root.querySelector('.save-note');
      if (el) el.textContent = saveNote;
    }, 500);
  };

  // Title odds take a moment to simulate: worked out after the bracket is on screen, then remembered.
  let oddsPending = false;
  const oddsRows = () => {
    const s = seeds();
    if (!BR.isComplete(s, sport)) return null;
    const sig = `${sport}:${JSON.stringify(F.conferences.map((c) => s[c].map((t) => `${t.abbr}${t.wins}-${t.losses}`)))}`;
    if (ODDS_MEMO.has(sig)) return ODDS_MEMO.get(sig);
    if (!oddsPending) {
      oddsPending = true;
      setTimeout(() => {
        ODDS_MEMO.set(sig, BR.odds(sport, s, 4000));
        oddsPending = false;
        if (!busy && document.body.contains(root)) draw();
      }, 60);
    }
    return null;
  };

  // ----- bracket pieces -----
  const teamRow = (g, side) => {
    const t = g[side];
    if (!t) return '<div class="bt tbd">To be decided</div>';
    const other = side === 'home' ? g.away : g.home;
    const pHome = other ? BR.winProb(g.home, g.away, g.neutral, g.bestOf) : null;
    const p = pHome === null ? null : side === 'home' ? pHome : 1 - pHome;
    const picked = g.winner?.abbr === t.abbr;
    let result = '';
    if (mode === 'league') {
      if (picked && realWinners.has(`${g.round}:${t.abbr}`)) result = 'hit';
      else if (picked && eliminated.has(t.abbr)) result = 'miss';
    }
    const out = mode === 'league' && eliminated.has(t.abbr) ? 'out' : '';
    return `<button class="bt ${picked ? 'picked' : ''} ${result} ${out}" data-slot="${g.slot}" data-team="${esc(t.abbr)}"
        ${editable() && other && !busy ? '' : 'disabled'} aria-pressed="${picked}" title="${esc(t.team_name || t.name)} (${recordText(t)})">
      <span class="seed">${t.seed}</span>${t.logo ? `<img src="${esc(t.logo)}" alt="" width="20" height="20" loading="lazy">` : ''}
      <span class="abbr">${esc(t.abbr)}</span>${p !== null ? `<span class="prob">${pct(p)}</span>` : ''}
    </button>`;
  };
  const matchup = (g, label = '') => `<div class="bm ${g.winner ? 'done' : ''}">${label ? `<span class="bm-label">${esc(label)}</span>` : ''}${teamRow(g, 'home')}${teamRow(g, 'away')}</div>`;
  const byeCards = (b) => b.byes.map((t) => `<div class="bye"><span class="seed">${t.seed}</span>${esc(t.abbr)}<span class="muted">bye</span></div>`).join('');
  const roundLabel = (i, name = F.rounds[i]) => `<div class="round-label">${esc(name)}${F.bestOf[i] > 1 ? `<span>Best of ${F.bestOf[i]}</span>` : ''}</div>`;

  const playInHtml = (b) => {
    if (!b[c0].playIn) return '';
    const block = (c) => `<div class="pi-conf"><h4>${esc(c)}</h4><div class="pi-games">
      ${matchup(b[c].playIn[0], '7 v 8 · winner is the 7 seed')}
      ${matchup(b[c].playIn[1], '9 v 10 · loser is out')}
      ${matchup(b[c].playIn[2], 'Last chance · winner is the 8 seed')}
    </div></div>`;
    return `<section class="playin"><h3>Play-in tournament</h3><div class="pi-wrap">${block(c0)}${block(c1)}</div></section>`;
  };

  const bracketHtml = () => {
    const s = seeds();
    const b = BR.buildBracket(sport, s, getPicks());
    const champ = b.F.winner;
    const champOdds = champ ? oddsRows()?.find((r) => r.team.abbr === champ.abbr)?.champ : null;
    const col = (cls, inner) => `<div class="round ${cls}">${inner}</div>`;
    return `
      ${playInHtml(b)}
      <div class="bracket-scroll" tabindex="0" aria-label="Playoff bracket (scrolls sideways)">
        <div class="bracket-full">
          <div class="bf-conf left">${esc(c0)}</div>
          <div class="bf-conf center">${esc(F.rounds[3])}</div>
          <div class="bf-conf right">${esc(c1)}</div>
          ${[0, 1, 2].map((i) => roundLabel(i)).join('')}${roundLabel(3, 'Final')}${[2, 1, 0].map((i) => roundLabel(i)).join('')}
          ${col('', byeCards(b[c0]) + b[c0].r1.map((g) => matchup(g)).join(''))}
          ${col('', b[c0].r2.map((g) => matchup(g)).join(''))}
          ${col('', matchup(b[c0].r3))}
          ${col('final-col', `${matchup(b.F)}
            <div class="champion ${champ ? 'crowned' : ''}">
              ${champ ? `${champ.logo ? `<img src="${esc(champ.logo)}" alt="" width="44" height="44">` : ''}
                <span class="champ-name">${esc(champ.team_name || champ.name)}</span>
                ${champOdds != null ? `<span class="muted small">${pct(champOdds)} title odds</span>` : ''}`
                : '<span class="muted small">Your champion shows here</span>'}
            </div>`)}
          ${col('', matchup(b[c1].r3))}
          ${col('', b[c1].r2.map((g) => matchup(g)).join(''))}
          ${col('', byeCards(b[c1]) + b[c1].r1.map((g) => matchup(g)).join(''))}
        </div>
      </div>`;
  };

  const oddsHtml = () => {
    const rows = oddsRows();
    if (!rows) return '<section class="panel"><h3>Title odds</h3><p class="muted">Simulating playoffs…</p></section>';
    const top = rows[0]?.champ || 1;
    return `<section class="panel">
      <h3>Title odds</h3>
      <p class="muted small">Thousands of simulated playoffs using each team’s record and home advantage${F.bestOf[0] > 1 ? ', played as full series' : ''}. A simple model, not a forecast.</p>
      <div class="odds-wrap"><table class="odds">
        <thead><tr><th>Team</th><th class="num">${esc(F.rounds[1])}</th><th class="num">${esc(F.rounds[2])}</th><th class="num">${esc(F.rounds[3])}</th><th class="num">Champion</th></tr></thead>
        <tbody>${rows.map((r) => `<tr>
          <td><span class="seed">${r.team.seed}</span> <strong>${esc(r.team.abbr)}</strong> <span class="muted small">${esc(r.conference)}</span></td>
          <td class="num">${pct(r.r2)}</td><td class="num">${pct(r.r3)}</td><td class="num">${pct(r.final)}</td>
          <td class="num"><span class="bar" style="--w:${Math.round((r.champ * 100) / top)}%"></span><strong>${pct(r.champ)}</strong></td></tr>`).join('')}</tbody>
      </table></div></section>`;
  };

  const bracketStandings = () => {
    if (mode !== 'league' || bstate !== 'locked') return '';
    const rows = members.map((m) => {
      const bp = brackets.find((b) => b.user_id === m.user_id)?.picks;
      const sc = bp ? BR.scoreBracket(sport, officialSeeds, bp, results) : null;
      return { m, sc, champ: bp?.F };
    }).sort((a, b) => (b.sc?.points ?? -1) - (a.sc?.points ?? -1) || (b.sc?.possible ?? -1) - (a.sc?.possible ?? -1));
    return `<table class="board compact"><thead><tr><th>Player</th><th class="num">Points</th><th class="num">Still possible</th><th>Champion</th></tr></thead>
      <tbody>${rows.map(({ m, sc, champ }) => `<tr class="${m.user_id === me ? 'me' : ''}"><td>${esc(m.name)}</td>
        <td class="num strong">${sc ? sc.points : '—'}</td><td class="num">${sc ? sc.possible : '—'}</td>
        <td>${champ ? `<span class="${eliminated.has(champ) ? 'struck' : ''}">${esc(champ)}</span>` : '<span class="muted">No bracket</span>'}</td></tr>`).join('')}</tbody></table>`;
  };

  // ----- build your own, step 1: choose the playoff teams -----
  const fieldHtml = () => {
    const lines = PLAYOFF_LINES[sport] || {};
    const conf = (c) => {
      const inField = new Set(fun.field[c].filter(Boolean));
      const others = confTeams(c).filter((t) => !inField.has(t.abbr))
        .sort((a, b) => todayOrder(c).indexOf(a.abbr) - todayOrder(c).indexOf(b.abbr));
      const full = fun.field[c].every(Boolean);
      const rows = fun.field[c].map((abbr, i) => {
        const t = teamByAbbr.get(abbr);
        const divider = F.playIn && i === F.teams - 2 ? '<li class="cut cut-playin"><span>Play-in tournament: seeds 7 to 10</span></li>' : '';
        return `${divider}<li class="seed-row ${abbr ? '' : 'open'}">
          <span class="rank">${i + 1}</span>
          ${abbr ? `${teamLogo(t, 28)}<span class="r-team"><strong>${esc(t?.name || abbr)}</strong><span class="muted small">${recordText(t)}</span></span>
            <span class="movers">
              <button class="mv" data-fmove="${c}:${i}:-1" ${i === 0 ? 'disabled' : ''} aria-label="Move up">▲</button>
              <button class="mv" data-fmove="${c}:${i}:1" ${i === fieldSize - 1 ? 'disabled' : ''} aria-label="Move down">▼</button>
              <button class="mv x" data-fremove="${c}:${i}" aria-label="Take ${esc(t?.name || abbr)} out">×</button>
            </span>`
            : '<span class="r-team muted">Open spot: pick a team below</span>'}
        </li>`;
      }).join('');
      return `<section class="field-col">
        <h3>${esc(c)}</h3>
        <ol class="ranks">${rows}</ol>
        <h4 class="others-h">${full ? 'Not in the playoffs' : 'Add a team'}</h4>
        <div class="others">${others.map((t) => `<button class="tpick" data-fadd="${c}:${esc(t.abbr)}" ${full ? 'disabled' : ''}>${teamLogo(t, 22)}<span>${esc(t.abbr)}</span></button>`).join('')}</div>
      </section>`;
    };
    void lines;
    return `
      <div class="field-tools">
        <button class="btn small secondary" data-fill="today">Use today’s standings</button>
        <button class="btn small secondary" data-fill="prediction">Use my standings prediction</button>
        <button class="btn small ghost" data-fill="clear">Clear</button>
      </div>
      <div class="field-grid">${conf(c0)}${conf(c1)}</div>
      <div class="step-next"><button class="btn" data-step="bracket" ${fieldFull() ? '' : 'disabled'}>Fill out the bracket</button>
        ${fieldFull() ? '' : '<span class="muted small">Fill every seed first.</span>'}</div>`;
  };

  // ----- page -----
  const banner = () => {
    const n = BR.pickCount(sport, seeds(), getPicks());
    if (mode === 'fun') return '';
    if (bstate === 'not_ready') {
      return `<p class="note">Seeds are today’s standings and change as the season goes. This practice bracket stays on this device. Real brackets open when the regular season ends.</p>`;
    }
    if (bstate === 'open') {
      return `<p class="note strong">Brackets are open: ${n} of ${total()} picked.
        ${firstKick ? `They lock when the playoffs start, ${fmtKickoff(firstKick)}.` : 'They lock when the playoffs start.'} <span class="save-note">${saveNote}</span></p>`;
    }
    return `<p class="note">Brackets are locked. Points per correct winner: ${['R1', 'R2', 'R3', 'F'].map((k, i) => `${esc(F.rounds[i])} ${BR.ROUND_POINTS[k]}`).join(', ')}.</p>`;
  };

  const draw = () => {
    const showField = mode === 'fun' && (fun.step === 'field' || !fieldFull());
    const n = showField ? 0 : BR.pickCount(sport, seeds(), getPicks());
    const simLabel = n === total() ? 'Simulate again' : n ? 'Simulate the rest' : 'Simulate';
    root.innerHTML = `
      <div class="bracket-top">
        <div class="side-switch" role="tablist" aria-label="Bracket type">
          <button role="tab" data-mode="league" aria-selected="${mode === 'league'}" class="${mode === 'league' ? 'on' : ''}" ${haveSeeds ? '' : 'disabled title="Playoff seeds haven\'t loaded yet"'}>League bracket</button>
          <button role="tab" data-mode="fun" aria-selected="${mode === 'fun'}" class="${mode === 'fun' ? 'on' : ''}">Build your own</button>
        </div>
        ${mode === 'fun' ? `<div class="steps" role="tablist" aria-label="Steps">
          <button role="tab" data-step="field" class="${showField ? 'on' : ''}" aria-selected="${showField}">1. Playoff teams</button>
          <button role="tab" data-step="bracket" class="${showField ? '' : 'on'}" aria-selected="${!showField}" ${fieldFull() ? '' : 'disabled'}>2. Bracket</button>
        </div>` : ''}
      </div>
      ${mode === 'fun' ? `<p class="lede-sm">${showField
        ? `Pick the ${fieldSize} teams per ${sport === 'mlb' ? 'league' : 'conference'} that make it${F.playIn ? ', including the four in the play-in tournament' : ''}, in seed order. Saved on this device. It doesn’t count in your league.`
        : 'Play out your bracket. Tap a team to advance it, or simulate.'}</p>` : banner()}
      ${showField ? fieldHtml() : `
        ${bracketStandings()}
        ${editable() ? `<div class="bracket-controls">
          <button class="btn sim" data-action="simulate" ${busy ? 'disabled' : ''}>${simLabel}</button>
          <button class="btn secondary" data-action="favorites" ${busy ? 'disabled' : ''}>Pick favourites</button>
          <button class="btn ghost" data-action="clear" ${busy || !n ? 'disabled' : ''}>Clear picks</button>
        </div>` : ''}
        ${bracketHtml()}
        ${oddsHtml()}`}`;
  };

  const animateTo = async (target) => {
    busy = true;
    const p = { ...getPicks() };
    for (const r of BR.ROUND_KEYS) {
      const slots = Object.entries(target).filter(([slot]) => BR.roundOf(slot) === r);
      if (!slots.length) continue;
      for (const [slot, abbr] of slots) p[slot] = abbr;
      setPicks(p);
      draw();
      await sleep(320);
    }
    busy = false;
    draw();
  };

  const fillField = async (how) => {
    if (how === 'clear') fun.field = Object.fromEntries(F.conferences.map((c) => [c, Array(fieldSize).fill('')]));
    if (how === 'today') fun.field = fieldFromToday();
    if (how === 'prediction') {
      const pred = await myStandingsPrediction(league);
      if (!pred) { toast('Save a final standings prediction first (Predictions tab).', 'error'); return; }
      fun.field = Object.fromEntries(F.conferences.map((c) => [c, [...pred[c], ...todayOrder(c)].filter((a, i, arr) => arr.indexOf(a) === i).slice(0, fieldSize)]));
    }
    fun.picks = {};
    persistFun();
    draw();
  };

  root.onclick = async (e) => {
    if (busy) return;
    const t = (sel) => e.target.closest(sel);
    let el;
    if ((el = t('[data-slot]')) && !el.disabled) {
      setPicks({ ...getPicks(), [el.dataset.slot]: el.dataset.team }); draw();
    } else if ((el = t('[data-mode]')) && !el.disabled) {
      mode = el.dataset.mode; draw();
    } else if ((el = t('[data-step]')) && !el.disabled) {
      fun.step = el.dataset.step; persistFun(); draw();
    } else if ((el = t('[data-fill]'))) {
      await fillField(el.dataset.fill);
    } else if ((el = t('[data-fmove]'))) {
      const [c, iStr, dStr] = el.dataset.fmove.split(':');
      const i = Number(iStr); const j = i + Number(dStr);
      const f = fun.field[c];
      [f[i], f[j]] = [f[j], f[i]];
      fun.picks = {}; persistFun(); draw();
      root.querySelector(`[data-fmove="${c}:${j}:${dStr}"]`)?.focus();
    } else if ((el = t('[data-fremove]'))) {
      const [c, iStr] = el.dataset.fremove.split(':');
      fun.field[c][Number(iStr)] = '';
      fun.picks = {}; persistFun(); draw();
    } else if ((el = t('[data-fadd]')) && !el.disabled) {
      const [c, abbr] = el.dataset.fadd.split(':');
      const i = fun.field[c].indexOf('');
      if (i >= 0) { fun.field[c][i] = abbr; fun.picks = {}; persistFun(); draw(); }
    } else if ((el = t('[data-action]'))) {
      const action = el.dataset.action;
      const full = BR.pickCount(sport, seeds(), getPicks()) === total();
      if (action === 'simulate' || action === 'favorites') {
        if (full) setPicks({});
        const base = getPicks();
        animateTo(action === 'simulate' ? BR.simulate(sport, seeds(), base) : BR.favorites(sport, seeds(), base));
      } else if (action === 'clear') {
        setPicks({}); draw();
      }
    }
  };

  draw();
}

// One click handler for every pick button (survives re-renders).
app.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-pick]');
  if (btn && !btn.disabled && state.league) makePick(state.league, btn.dataset.game, btn.dataset.pick, btn);
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot() {
  if (configured) {
    // Surface errors from an expired/used email link
    const hashParams = new URLSearchParams(location.hash.replace(/^#/, ''));
    if (hashParams.get('error_description')) {
      toast(hashParams.get('error_description').replace(/\+/g, ' '), 'error');
    }

    const { data } = await sb.auth.getSession();
    state.session = data.session;
    if (/access_token=|error_description=/.test(location.hash)) {
      history.replaceState(null, '', `${location.pathname}#/`);
    }

    sb.auth.onAuthStateChange((_event, session) => {
      const changedUser = (session?.user?.id || null) !== (state.session?.user?.id || null);
      state.session = session;
      if (changedUser) {
        state.profile = null;
        state.pendingEmail = null;
        setTimeout(render); // don't call Supabase inside the auth callback
      }
    });
  }
  window.addEventListener('hashchange', render);
  render();
}

boot();
