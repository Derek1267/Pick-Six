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
import { ICON, CAT_ICON, SURFACE, ILLO } from './icons.js';
import { STAFF_ROLE, staffFor } from './staff.js';
import { FAVOURITES, FAVOURITES_AS_OF, FAVOURITE_TITLE, NO_SUGGESTIONS, suggestionPool } from './favourites.js';

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
  // Soccer and lacrosse play a few times a week: one slate per Monday–Sunday week. MLS games can be drawn.
  mls: { name: 'MLS', daily: true, unit: 'week', weekSlates: true, draws: true },
  nll: { name: 'NLL', daily: true, unit: 'week', weekSlates: true },
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

// Monday of the week a date falls in ("2026-11-26" → "2026-11-23").
function mondayOf(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d);
  const back = (new Date(t).getUTCDay() + 6) % 7;
  return new Date(t - back * 864e5).toISOString().slice(0, 10);
}

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
  const { data } = await sb.from('league_members').select('user_id, role, joined_at, profiles(display_name)').eq('league_id', id);
  const members = (data || []).map((m) => ({ user_id: m.user_id, role: m.role, joined_at: m.joined_at, name: m.profiles?.display_name || 'Player' }));
  const bundle = { league, members };
  cache.leagues.set(id, { at: Date.now(), data: bundle });
  return bundle;
}

// A tiny IndexedDB store: season schedules are too big for localStorage, and keeping them
// on the device means a returning visit draws straight away instead of re-downloading.
const idb = (() => {
  let dbp;
  const open = () => (dbp ||= new Promise((resolve) => {
    try {
      const req = indexedDB.open('pick-six', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  }));
  const run = async (mode, fn) => {
    const db = await open();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction('kv', mode);
        const req = fn(tx.objectStore('kv'));
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => resolve(null);
      } catch { resolve(null); }
    });
  };
  return { get: (k) => run('readonly', (st) => st.get(k)), set: (k, v) => run('readwrite', (st) => st.put(v, k)) };
})();

const inflight = new Map(); // one request per key at a time (the page and the prefetch share it)
const once = (key, fn) => {
  if (!inflight.has(key)) inflight.set(key, fn().finally(() => inflight.delete(key)));
  return inflight.get(key);
};

const DEVICE_TTL = 6 * 36e5; // a stored schedule is good for drawing; live games are re-checked anyway

async function getGames(sport, season) {
  const key = `${sport}:${season}`;
  const hit = cache.games.get(key);
  if (fresh(hit, GAMES_TTL)) return hit.data;
  if (!hit) {
    const stored = await idb.get(`games:${key}`);
    if (stored && Date.now() - stored.at < DEVICE_TTL) {
      cache.games.set(key, stored);
      once(`games:${key}`, () => reloadGames(sport, season)).catch(() => {}); // refresh behind the scenes
      return refreshLiveGames(sport, season);
    }
  }
  return once(`games:${key}`, () => reloadGames(sport, season));
}

async function reloadGames(sport, season) {
  const key = `${sport}:${season}`;
  const data = await loadGames(sport, season);
  const entry = { at: Date.now(), data };
  cache.games.set(key, entry);
  idb.set(`games:${key}`, entry);
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

// Supabase returns at most 1,000 rows per request: get the count with the first page,
// then fetch the rest of the season's pages at the same time.
async function loadGames(sport, season) {
  const page = (from, count) => sb.from('games').select('*', count ? { count: 'exact' } : undefined)
    .eq('sport', sport).eq('season', season).order('start_time').order('id').range(from, from + 999);
  const first = await page(0, true);
  if (first.error) throw first.error;
  const total = first.count ?? first.data.length;
  const rest = await Promise.all(Array.from({ length: Math.max(0, Math.ceil(total / 1000) - 1) }, (_, i) => page((i + 1) * 1000)));
  for (const r of rest) if (r.error) throw r.error;
  return [...first.data, ...rest.flatMap((r) => r.data)];
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
// League rules the owner can change (Manage → League rules). Defaults keep the original game.
const DEFAULT_SETTINGS = { lockOfWeek: true, upsetBonus: false, autoPick: false, deadline: 'game', lateCatchUp: false };
const settingsOf = (league) => ({ ...DEFAULT_SETTINGS, ...(league?.settings || {}) });
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

  if (!configured) return renderSetupNeeded();

  const route = parseRoute();
  app.classList.toggle('league-page', route.name === 'league' && !!state.session);
  if (route.name !== 'league') delete app.dataset.league;
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
      <p class="lede">Start a private league for the NFL, NBA, NHL, MLB, MLS or NLL, pick games on the real schedule, and let the leaderboard settle the arguments.</p>
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
        <h2 class="icon-head">${ICON.users}Leagues</h2>
        <ul>
          <li>Start a private league for one of six leagues (NFL, NBA, NHL, MLB, MLS or NLL) and share the invite link or 6-letter code.</li>
          <li>Only people in your league can see it, its picks or its standings.</li>
          <li>Start one in the off-season too: it's for the season ahead. Predictions and brackets open right away, and picks start when the schedule comes out.</li>
          <li>The league owner can rename it, remove players or delete it. Anyone can leave a league from <strong>Manage</strong>.</li>
        </ul>
      </section>

      <section class="card">
        <h2 class="icon-head">${ICON.picks}Making picks</h2>
        <ul>
          <li><strong>NFL</strong>: pick every game, week by week. <strong>NBA, NHL, MLB</strong>: pick day by day, because they play almost every night.</li>
          <li>Tap a team to pick it. You can change your mind as often as you like until that game starts.</li>
          <li><strong>Each game locks at its own start time.</strong> A Sunday game stays open even after Thursday's game locks.</li>
          <li>Your league-mates' picks stay hidden until a game starts. After that, everyone's picks for it are shown.</li>
        </ul>
      </section>

      <section class="card">
        <h2 class="icon-head">${ICON.board}Scoring &amp; standings</h2>
        <ul>
          <li>1 point for every correct pick. Ties and postponed games don't count either way, except in <strong>MLS</strong>, where you can pick a draw.</li>
          <li><strong>Standings</strong> rank by total correct picks, then win percentage.</li>
          <li>Each week someone takes the <strong>weekly win</strong> (most correct that week, Monday to Sunday for daily sports). Ties share it.</li>
          <li>Scores update about every 15 minutes during games.</li>
        </ul>
      </section>

      <section class="card">
        <h2 class="icon-head">${ICON.bracket}Brackets</h2>
        <ul>
          <li>The <strong>Bracket</strong> tab shows the playoff picture with the final in the middle.</li>
          <li>During the season the seeds are "if the season ended today" and your bracket is just for practice.
            When the regular season ends, real brackets open. They lock when the first playoff game starts, and then everyone's are revealed.</li>
          <li>Points per correct winner: 1 in round one, 2 in round two, 4 for the conference final, 8 for the final.</li>
          <li><strong>Build your own</strong> is always open. First choose which teams make the playoffs and their seeds (NBA brackets include the play-in tournament for seeds 7 to 10), then fill it out or simulate it. Start from today's standings or your own standings prediction. It never counts in the league.</li>
          <li>🎲 <strong>Simulate</strong> plays out the bracket using team records and home advantage. <strong>Title odds</strong> come from thousands of simulated playoffs. It's a simple model, not a prediction you should bet on.</li>
        </ul>
        <p class="muted small">Formats: NFL 7 teams per conference (with a bye and re-seeding), NBA and NHL 8 teams with best-of-7 series
          (the NHL's real division-based pairings are simplified), MLB 6 teams per league with byes for the top two,
          MLS 9 teams per conference (8 v 9 play a wild card game, then a best-of-3 first round),
          and NLL the top 8 overall: single-game quarterfinals, then best-of-3 semifinals and Finals.</p>
      </section>

      <section class="card">
        <h2 class="icon-head">${ICON.predict}Predictions</h2>
        <ul>
          <li><strong>Final standings:</strong> rank every team in each conference. 3 points for the exact spot and 1 for one spot off, scored live against today's standings.</li>
          <li><strong>Awards:</strong> MVPs, rookies, trophies, coaches and executives (pick the team), playoff MVPs and more. 3 points each.</li>
          <li><strong>All-Stars</strong> (<strong>Pro Bowl</strong> for NFL): fill the whole roster for each side, starters, reserves and injury replacements. 1 point per player who makes it.</li>
          <li><strong>Year-end teams:</strong> All-NBA, All-Defensive, All-Rookie, All-Pro, All-MLB and more. 1 point per correct player.</li>
          <li>Picks stay hidden until the league owner locks them. The owner enters the real results when they're announced.</li>
        </ul>
      </section>

      <section class="card">
        <h2 class="icon-head">${ICON.lock}Signing in</h2>
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
      <span class="muted small"><span class="sport-tag">${esc(sportInfo(l.sport).name)}</span> ${l.league_members?.[0]?.count ?? 1} player${(l.league_members?.[0]?.count ?? 1) === 1 ? '' : 's'}</span>
      <span class="arrow" aria-hidden="true">→</span>
    </a>`).join('');

  app.innerHTML = `
    <section class="page-head">
      <h1>Your leagues</h1>
    </section>
    ${leagues.length ? `<div class="league-list">${cards}</div>` : `
      <div class="empty card illustrated">${ILLO.leagues}
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
            <label class="sport-option" title="${inSeason[key] ? '' : `Off-season: the league is for next season. Predictions open now; picks start with the schedule.`}">
              <input type="radio" name="sport" value="${key}" ${key === firstOpen ? 'checked' : ''}>
              <span>${info.name}<small>${inSeason[key] ? 'In season' : 'Next season'}</small></span></label>`).join('')}
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
  // Same league, new tab: keep the title band where it is and only swap the page under it.
  const keepBand = app.dataset.league === route.id && !!app.querySelector('.band');
  if (keepBand) {
    paintTabs(route);
    if (!quiet) app.querySelector('.page').innerHTML = pageLoading(route);
  } else if (!quiet && !cached) {
    app.innerHTML = '<div class="loading">Loading league…</div>';
  }

  const bundle = await getLeagueBundle(route.id);
  if (stale()) return;
  const league = bundle?.league;
  if (!league) {
    delete app.dataset.league;
    app.innerHTML = `<section class="card narrow"><h2>League not found</h2>
      <p>You may not be a member yet. Ask the owner for an invite link.</p><a class="btn" href="#/">Back to your leagues</a></section>`;
    return;
  }

  const members = bundle.members.map((m) => ({ ...m }));
  state.league = league;
  if (!keepBand) {
    app.innerHTML = bandHtml(league, members, route) + `<div class="page">${pageLoading(route)}</div>`;
    app.dataset.league = league.id;
    paintTabs(route);
  } else {
    app.querySelector('.band-players').textContent = `${members.length} player${members.length === 1 ? '' : 's'}`;
    app.querySelector('.band-title').textContent = league.name;
  }
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

  const needsGames = route.tab === 'picks' || route.tab === 'bracket';
  let games = [];
  if (needsGames) {
    try {
      games = quiet ? await refreshLiveGames(league.sport, league.season) : await getGames(league.sport, league.season);
    } catch { games = []; }
  }
  if (stale()) return;

  const page = app.querySelector('.page');
  let body;
  if (route.tab === 'leaderboard') body = await standingsHtml(league, members, games);
  else if (route.tab === 'bracket') body = '<div id="bracket-root"><div class="loading">Loading bracket…</div></div>';
  else if (route.tab === 'predict') body = `${predictionsNav(league, route)}<div id="predict-root">${skeleton()}</div>`;
  else body = await picksHtml(league, members, games, route);
  if (stale()) return;
  page.innerHTML = body;

  const slateBtn = document.getElementById('slate-btn');
  if (slateBtn) {
    const menu = document.getElementById('slate-menu');
    const close = () => { menu.hidden = true; slateBtn.setAttribute('aria-expanded', 'false'); };
    slateBtn.onclick = (e) => {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
      slateBtn.setAttribute('aria-expanded', String(!menu.hidden));
      if (!menu.hidden) menu.querySelector('.slate-opt.on')?.scrollIntoView({ block: 'center' });
    };
    menu.onclick = (e) => { if (e.target.closest('.slate-opt')) close(); };
  }

  prefetchLeague(league); // warm the other tabs while you look at this one

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

const LEAGUE_TABS = [
  ['picks', 'Picks', 'picks'], ['leaderboard', 'Leaderboard', 'board'], ['bracket', 'Bracket', 'bracket'], ['predict', 'Predictions', 'predict'],
];

function bandHtml(league, members, route) {
  return `
    <header class="band">
      <div class="band-inner">
        <a href="#/" class="band-back">${ICON.back}Your leagues</a>
        <div class="band-row">
          <div class="band-id">
            <h1 class="band-title">${esc(league.name)}</h1>
            <p class="band-meta"><span class="sport-badge">${esc(sportInfo(league.sport).name)}</span>
              <span class="band-stat">${ICON.users}<span class="band-players">${members.length} player${members.length === 1 ? '' : 's'}</span></span>
              <span class="band-stat">Code <strong class="code">${esc(league.invite_code)}</strong></span></p>
          </div>
          <div class="band-actions">
            <button class="btn small on-dark" id="invite-btn">${ICON.share}Invite friends</button>
            <button class="btn small ghost on-dark" id="manage-btn">${ICON.gear}Manage</button>
          </div>
        </div>
        <nav class="band-tabs" aria-label="League">
          ${LEAGUE_TABS.map(([key, label, icon]) => `<a data-tab="${key}" href="#/league/${league.id}${key === 'picks' ? '' : `?tab=${key}`}">${ICON[icon]}<span>${label}</span></a>`).join('')}
        </nav>
      </div>
    </header>`;
}

function paintTabs(route) {
  for (const a of app.querySelectorAll('.band-tabs a')) {
    const on = a.dataset.tab === route.tab;
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
}

// Placeholder shapes while a tab loads, so the page doesn't jump.
const skeleton = (n = 6) => `<div class="skeleton" aria-label="Loading">${'<span></span>'.repeat(n)}</div>`;
const pageLoading = (route) => (route.tab === 'predict' && state.league
  ? `${predictionsNav(state.league, route)}<div id="predict-root">${skeleton()}</div>` : skeleton());

// Fetch what the other tabs need once the browser is idle, so switching tabs is instant.
function prefetchLeague(league) {
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 400));
  idle(() => {
    getGames(league.sport, league.season).catch(() => {});
    getTeams(league.sport).catch(() => {});
  });
}

// A slate = the set of games you pick together: an NFL week, or one day for NBA/NHL/MLB.
function groupSlates(games, sport) {
  const daily = sportInfo(sport).daily;
  const slates = new Map();
  for (const g of games) {
    const k = g.slate || weekKey(g.season_type, g.week);
    if (!slates.has(k)) {
      slates.set(k, { key: k, type: g.season_type, week: g.week, games: [],
        label: (sportInfo(sport).weekSlates ? weekLabel(g.season_type, g.week, sport)
          : daily ? dayLabel(k) : weekLabel(g.season_type, g.week, sport)).replace(/^Playoffs · /, '') });
    }
    slates.get(k).games.push(g);
  }
  return [...slates.values()].sort((a, b) => (daily
    ? a.key.localeCompare(b.key)
    : a.type - b.type || a.week - b.week));
}

function defaultSlate(slates, sport) {
  if (sportInfo(sport).daily) {
    const today = sportInfo(sport).weekSlates ? mondayOf(todayET()) : todayET();
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

const seasonName = (league) => (['nba', 'nhl', 'nll'].includes(league.sport)
  ? `${league.season - 1}–${String(league.season).slice(2)}` : String(league.season));

async function picksHtml(league, members, games, route) {
  const weeks = groupSlates(games, league.sport);
  const unit = sportInfo(league.sport).unit;
  if (!weeks.length) {
    return `<div class="empty card illustrated">${ILLO.picks}<p><strong>The ${esc(seasonName(league))} schedule isn’t out yet.</strong>
      Games show up here as soon as it’s published. Until then, make your <a href="#/league/${league.id}?tab=predict">predictions</a> and
      build a <a href="#/league/${league.id}?tab=bracket&mode=fun">bracket</a>.</p></div>`;
  }

  const key = weeks.some((w) => w.key === route.week) ? route.week : defaultSlate(weeks, league.sport);
  const idx = weeks.findIndex((w) => w.key === key);
  const wk = weeks[idx];
  const ids = wk.games.map((g) => g.id);

  const picksRes = await sb.from('picks').select('user_id, game_id, pick, is_lock')
    .eq('league_id', league.id).in('game_id', ids);
  const picks = picksRes.data || [];
  const me = state.session.user.id;
  const mine = new Map(picks.filter((p) => p.user_id === me).map((p) => [p.game_id, p.pick]));
  const rules = settingsOf(league);
  const myLock = rules.lockOfWeek ? picks.find((p) => p.user_id === me && p.is_lock)?.game_id || null : null;
  // "Whole week" deadline: everything in this slate locks when its first game starts.
  const firstStart = Math.min(...wk.games.map((g) => new Date(g.start_time)));
  const gameOpen = (g) => isOpen(g) && (rules.deadline !== 'week' || firstStart > Date.now());
  const lockUsed = myLock && !gameOpen(wk.games.find((g) => g.id === myLock) || {});

  const open = wk.games.filter(gameOpen);
  const pickedOpen = open.filter((g) => mine.has(g.id)).length;
  const graded = wk.games.filter((g) => g.winner && mine.has(g.id));
  const right = graded.filter((g) => mine.get(g.id) === g.winner).length;
  const nextLock = open.find((g) => !mine.has(g.id)) || open[0];

  const weekLink = (w) => `#/league/${league.id}?week=${w.key}`;
  // Our own dropdown (the browser's one can't be styled): grouped into regular season and playoffs.
  const groupName = (w) => (w.type === 3 ? 'Playoffs' : 'Regular season');
  const groups = [...new Set(weeks.map(groupName))];
  const nav = `
    <div class="week-nav">
      ${idx > 0 ? `<a class="nav-arrow" href="${weekLink(weeks[idx - 1])}" aria-label="Previous ${unit}">${ICON.back}</a>` : `<span class="nav-arrow off">${ICON.back}</span>`}
      <div class="slate-pick">
        <button class="slate-btn" id="slate-btn" aria-haspopup="listbox" aria-expanded="false">
          <span class="slate-kicker">${esc(groupName(wk))}</span>
          <span class="slate-label">${esc(wk.label)}</span>
          ${ICON.chevron}
        </button>
        <div class="slate-menu" id="slate-menu" role="listbox" aria-label="Choose ${unit}" hidden>
          ${groups.map((gname) => `<h5>${esc(gname)}</h5><div class="slate-grid">${weeks.filter((w) => groupName(w) === gname).map((w) => `
            <a role="option" class="slate-opt ${w.key === key ? 'on' : ''}" aria-selected="${w.key === key}" href="${weekLink(w)}">
              <span>${esc(w.label)}</span><small>${w.games.length} game${w.games.length === 1 ? '' : 's'}</small></a>`).join('')}</div>`).join('')}
        </div>
      </div>
      ${idx < weeks.length - 1 ? `<a class="nav-arrow next" href="${weekLink(weeks[idx + 1])}" aria-label="Next ${unit}">${ICON.back}</a>` : `<span class="nav-arrow next off">${ICON.back}</span>`}
    </div>`;

  const summary = `
    <div class="summary">
      ${open.length ? `<div><span class="big-num">${pickedOpen}/${open.length}</span><span class="muted small">open games picked</span></div>` : ''}
      ${graded.length ? `<div><span class="big-num">${right}-${graded.length - right}</span><span class="muted small">this ${unit}</span></div>` : ''}
      ${nextLock ? `<div><span class="big-num">${fmtCountdown(nextLock.start_time)}</span><span class="muted small">until ${nextLock.away_abbr} @ ${nextLock.home_abbr} locks</span></div>` : ''}
      ${!open.length && !graded.length ? `<div class="muted">All games for this ${unit} are locked.</div>` : ''}
    </div>`;

  const draws = !!sportInfo(league.sport).draws;
  const ctx = { rules, myLock, lockUsed, gameOpen, unit };
  const cards = wk.games.map((g) => gameCard(g, mine.get(g.id), picks, members, me, draws, ctx)).join('');

  // Reminder: games locking in the next 24 hours that still need your pick.
  const soon = open.filter((g) => !mine.has(g.id) && new Date(g.start_time) - Date.now() < 864e5);
  const reminder = soon.length ? `<div class="reminder">${ICON.calendar}<p><strong>${soon.length} game${soon.length === 1 ? '' : 's'}
      lock${soon.length === 1 ? 's' : ''} in the next 24 hours without your pick.</strong>
      ${rules.deadline === 'week' ? 'This league locks the whole ' + unit + ' at the first game.' : ''}</p></div>` : '';
  const tools = `<div class="pick-tools">
      ${rules.lockOfWeek ? `<span class="muted small">${ICON.lock} Lock of the ${unit}: ${myLock ? 'set, counts double' : 'tap “Lock it” on one pick to double it'}</span>` : '<span></span>'}
      <button class="btn small secondary" id="ics-btn">${ICON.calendar}Add to calendar</button></div>`;

  state.icsGames = wk.games;
  return nav + reminder + summary + tools + `<div class="games">${cards}</div>`;
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

// Soccer: a draw is a pick too.
function drawButton(g, myPick, locked) {
  const picked = myPick === 'tie';
  const result = g.winner && picked ? (g.winner === 'tie' ? 'correct' : 'wrong') : '';
  return `<button class="draw-btn ${picked ? 'picked' : ''} ${result} ${g.winner === 'tie' ? 'winner' : ''}" ${locked ? 'disabled' : ''}
      data-game="${esc(g.id)}" data-pick="tie" aria-pressed="${picked}" aria-label="Pick a draw">
      <span>Draw</span>${picked ? `<span class="badge">${result === 'correct' ? '✓' : result === 'wrong' ? '✗' : 'Pick'}</span>` : ''}</button>`;
}

function gameCard(g, myPick, picks, members, me, draws = false, ctx = {}) {
  const locked = ctx.gameOpen ? !ctx.gameOpen(g) : !isOpen(g);
  const rules = ctx.rules || DEFAULT_SETTINGS;
  const isLock = ctx.myLock === g.id;
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
    const tied = gp.filter((p) => p.pick === 'tie');
    const who = (list) => list.map((p) => `<span class="pill ${p.user_id === me ? 'me' : ''}">${esc(nameOf(members, p.user_id))}</span>`).join('') || '<span class="muted small">nobody</span>';
    const pct = gp.length ? Math.round((away.length / gp.length) * 100) : 50;
    // "8 of 10 picked DAL": the crowd's side, so you can see who went against it.
    const lead = home.length >= away.length ? ['home', home.length, g.home_abbr] : ['away', away.length, g.away_abbr];
    const splitText = gp.length ? `<p class="split-text"><strong>${lead[1]} of ${gp.length}</strong> picked ${esc(lead[2])}${tied.length ? ` · ${tied.length} picked a draw` : ''}${
      myPick && myPick !== lead[0] && myPick !== 'tie' ? ' <span class="pill against">You went against the crowd</span>' : ''}</p>` : '';
    const autoNote = !myPick && rules.autoPick ? `<p class="muted small auto-note">Auto pick: ${esc((g.away_record && recPct(g.away_record) > recPct(g.home_record)) ? g.away_abbr : g.home_abbr)} (better record)</p>` : '';
    reveal = gp.length ? `
      <div class="reveal">
        ${splitText}${autoNote}
        <div class="split" style="--pct:${pct}%"><span></span></div>
        <div class="reveal-cols ${draws ? 'three' : ''}">
          <div>${who(away)}</div>
          ${draws ? `<div class="mid">${tied.length ? who(tied) : ''}</div>` : ''}
          <div class="right">${who(home)}</div>
        </div>
      </div>` : '';
  } else if (!myPick) {
    status += ' <span class="nudge">Pick needed</span>';
  }

  const lockBtn = rules.lockOfWeek && myPick && (!locked || isLock)
    ? (isLock ? `<span class="lock-tag">${ICON.lock}Lock ×2</span>`
      : !ctx.lockUsed ? `<button class="lock-btn" data-lock-game="${esc(g.id)}">${ICON.lock}Lock it</button>` : '')
    : '';
  return `
    <article class="game ${locked ? 'locked' : ''} ${isLock ? 'is-lock' : ''}">
      <div class="game-top">${status}${lockBtn}</div>
      <div class="matchup">
        ${teamButton(g, 'away', myPick, locked)}
        ${draws ? drawButton(g, myPick, locked) : '<span class="at">@</span>'}
        ${teamButton(g, 'home', myPick, locked)}
      </div>
      ${reveal}
    </article>`;
}

const recPct = (r) => {
  const [w, l, t = 0] = String(r || '').split('-').map(Number);
  const gp = w + l + t;
  return gp ? (w + t / 2) / gp : 0;
};

async function setLock(league, gameId) {
  const { error } = await sb.from('picks').update({ is_lock: true })
    .eq('league_id', league.id).eq('user_id', state.session.user.id).eq('game_id', gameId);
  if (error) toast(friendlyError(error), 'error');
  else toast('Locked in. This pick counts double.', 'good');
  render();
}

// A calendar file (.ics) with this week's games, for any calendar app. No account needed.
function downloadIcs(league, games) {
  const stamp = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Pick Six//EN', 'CALSCALE:GREGORIAN'];
  for (const g of games) {
    const start = new Date(g.start_time);
    lines.push('BEGIN:VEVENT', `UID:${g.id}@pick-six`, `DTSTAMP:${stamp(Date.now())}`, `DTSTART:${stamp(start)}`,
      `DTEND:${stamp(start.getTime() + 3 * 36e5)}`, `SUMMARY:${g.away_abbr} @ ${g.home_abbr} (picks lock)`,
      `DESCRIPTION:Make your pick: ${location.origin}${location.pathname}#/league/${league.id}`,
      'BEGIN:VALARM', 'TRIGGER:-PT1H', 'ACTION:DISPLAY', 'DESCRIPTION:Picks lock in an hour', 'END:VALARM', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  const url = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/calendar' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `pick-six-${league.sport}.ics` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function makePick(league, gameId, side, btn) {
  const card = btn.closest('.matchup');
  const prev = card.querySelector('.team.picked, .draw-btn.picked');
  if (prev === btn) return;
  // Optimistic update
  card.querySelectorAll('.team, .draw-btn').forEach((b) => {
    b.classList.toggle('picked', b === btn);
    b.setAttribute('aria-pressed', b === btn);
    b.querySelector('.badge')?.remove();
  });
  btn.insertAdjacentHTML('beforeend', `<span class="badge">${side === 'tie' ? 'Pick' : 'Your pick'}</span>`);
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

// The headline award per sport, for the "Called the MVP" trophy.
const MVP_AWARD = { nba: ['mvp'], nfl: ['mvp'], nhl: ['hart'], mlb: ['almvp', 'nlmvp'], mls: ['mvp'], nll: ['mvp'] };

async function allLeaguePicks(leagueId) {
  // Everyone's picks on games that have started (the database hides the rest), 1,000 rows at a time.
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('picks').select('user_id, game_id, pick, is_lock')
      .eq('league_id', leagueId).order('game_id').range(from, from + 999);
    if (error || !data?.length) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

async function standingsHtml(league, members) {
  const sport = league.sport;
  const rules = settingsOf(league);
  const me = state.session.user.id;
  const mvpQs = (MVP_AWARD[sport] || []).map((id) => `${sport}:${id}`);
  const [lb, games, allPicks, mvpAnswers, mvpPicks, seedRes, bracketRes] = await Promise.all([
    sb.rpc('league_leaderboard', { p_league: league.id }),
    getGames(sport, league.season).catch(() => []),
    allLeaguePicks(league.id),
    sb.from('award_settings').select('question_id, answers').eq('league_id', league.id).in('question_id', mvpQs),
    sb.from('award_picks').select('user_id, question_id, players').eq('league_id', league.id).in('question_id', mvpQs),
    sb.from('playoff_seeds').select('*').eq('sport', sport).eq('season', league.season),
    sb.from('bracket_picks').select('user_id, picks').eq('league_id', league.id),
  ]);
  if (lb.error) return `<p class="error">${esc(friendlyError(lb.error))}</p>`;
  const rows = lb.data || [];

  const blank = () => ({ correct: 0, graded: 0, points: 0, locks: 0, upsets: 0, autos: 0, weekWins: 0, perfect: 0, catchUp: 0, badges: [] });
  const players = new Map(members.map((m) => [m.user_id, { ...m, ...blank() }]));
  const byWeek = new Map();
  for (const r of rows) {
    const p = players.get(r.user_id) || players.set(r.user_id, { user_id: r.user_id, name: r.display_name, ...blank() }).get(r.user_id);
    p.name = r.display_name;
    if (r.week == null) continue;
    Object.assign(p, { correct: p.correct + r.correct, graded: p.graded + r.graded, points: p.points + r.points,
      locks: p.locks + r.locks_hit, upsets: p.upsets + r.upsets, autos: p.autos + r.autos });
    const k = weekKey(r.season_type, r.week);
    if (!byWeek.has(k)) byWeek.set(k, { key: k, type: r.season_type, week: r.week, rows: [] });
    byWeek.get(k).rows.push(r);
    if (r.graded >= 3 && r.correct === r.graded) p.perfect += 1;
  }

  // Late joiners (if the owner allows it): weeks played before they joined count as that week's lowest score.
  const weekEnd = new Map();
  for (const g of games) {
    const k = weekKey(g.season_type, g.week);
    weekEnd.set(k, Math.max(weekEnd.get(k) || 0, new Date(g.start_time).getTime()));
  }
  if (rules.lateCatchUp) {
    for (const w of byWeek.values()) {
      const played = w.rows.filter((r) => r.graded > 0);
      if (!played.length) continue;
      const low = Math.min(...played.map((r) => r.points));
      for (const p of players.values()) {
        const joined = new Date(p.joined_at || 0).getTime();
        if (joined > (weekEnd.get(w.key) || 0) && !w.rows.some((r) => r.user_id === p.user_id && r.graded > 0)) {
          p.points += low; p.catchUp += low;
          w.rows.push({ user_id: p.user_id, display_name: p.name, points: low, correct: 0, graded: 0, catchUp: true });
        }
      }
    }
  }

  // Weekly winners by points (ties share the win).
  const weekly = [...byWeek.values()].sort((a, b) => b.type - a.type || b.week - a.week).map((w) => {
    const real = w.rows.filter((r) => !r.catchUp);
    const best = Math.max(0, ...real.map((r) => r.points));
    const winners = real.filter((r) => r.points === best && best > 0);
    winners.forEach((r) => { players.get(r.user_id).weekWins += 1; });
    return { ...w, best, winners };
  });

  // ----- trophies -----
  const award = (userIds, icon, label, title) => userIds.forEach((id) => players.get(id)?.badges.push({ icon, label, title }));
  for (const p of players.values()) {
    if (p.perfect) p.badges.push({ icon: 'check', label: p.perfect > 1 ? `Perfect ×${p.perfect}` : 'Perfect week', title: 'Got every pick right in a week' });
    if (p.weekWins) p.badges.push({ icon: 'trophy', label: p.weekWins > 1 ? `Week wins ×${p.weekWins}` : 'Week winner', title: 'Won a week' });
  }
  const leaders = (field) => {
    const top = Math.max(0, ...[...players.values()].map((p) => p[field]));
    return top > 0 ? [...players.values()].filter((p) => p[field] === top).map((p) => p.user_id) : [];
  };
  if (rules.upsetBonus) award(leaders('upsets'), 'flame', 'Upset king', 'Most correct underdog picks');
  if (rules.lockOfWeek) award(leaders('locks'), 'lock', 'Lock master', 'Most locks that came through');
  const answers = new Map((mvpAnswers.data || []).map((r) => [r.question_id, new Set((r.answers || []).filter(Boolean))]));
  const calledMvp = (mvpPicks.data || []).filter((r) => answers.get(r.question_id)?.has(r.players?.[0])).map((r) => r.user_id);
  award([...new Set(calledMvp)], 'star', 'Called the MVP', 'Picked the MVP before the season was decided');
  const seeds = BR.seedsByConference(seedRes.data || [], sport);
  if (BR.isComplete(seeds, sport)) {
    const results = BR.actualResults(sport, seeds, games);
    if (results.F) {
      const scored = (bracketRes.data || []).map((b) => ({ id: b.user_id, pts: BR.scoreBracket(sport, seeds, b.picks, results).points }));
      const top = Math.max(0, ...scored.map((s) => s.pts));
      award(scored.filter((s) => s.pts === top && top > 0).map((s) => s.id), 'bracket', 'Best bracket', 'Highest-scoring playoff bracket');
    }
  }

  // ----- table -----
  const table = [...players.values()].sort((a, b) => b.points - a.points || b.correct - a.correct
    || (b.graded ? b.correct / b.graded : 0) - (a.graded ? a.correct / a.graded : 0) || a.name.localeCompare(b.name));
  const showPts = rules.lockOfWeek || rules.upsetBonus || rules.lateCatchUp;
  let rank = 0; let last = null;
  const chip = (b) => `<span class="badge-chip" title="${esc(b.title)}">${ICON[b.icon]}${esc(b.label)}</span>`;
  const rowsHtml = table.map((p, i) => {
    if (p.points !== last) { rank = i + 1; last = p.points; }
    const pct = p.graded ? (p.correct / p.graded).toFixed(3).replace(/^0/, '') : '—';
    return `
      <tr class="${p.user_id === me ? 'me' : ''}">
        <td class="rank">${rank === 1 && p.points > 0 ? ICON.trophy : rank}</td>
        <td class="player">${esc(p.name)}${p.catchUp ? ` <span class="muted small" title="Weeks before joining count as that week's lowest score">+${p.catchUp} catch-up</span>` : ''}</td>
        ${showPts ? `<td class="num strong">${p.points}</td>` : ''}
        <td class="num ${showPts ? '' : 'strong'}">${p.correct}</td>
        <td class="num">${p.graded - p.correct}</td>
        <td class="num">${pct}</td>
        <td class="num">${p.weekWins || '—'}</td>
      </tr>`;
  }).join('');
  const scoringNote = [rules.lockOfWeek && 'locks count double', rules.upsetBonus && '+1 for a correct underdog pick',
    rules.autoPick && 'missed picks go to the better-record team', rules.deadline === 'week' && `picks lock at the first game of each ${sportInfo(sport).unit}`]
    .filter(Boolean);

  const weeklyHtml = weekly.length ? weekly.map((w) => `
    <li><span class="wk">${weekLabel(w.type, w.week, sport)}</span>
      <span>${w.winners.length ? w.winners.map((r) => esc(r.display_name)).join(', ') : '<span class="muted">—</span>'}</span>
      <span class="muted small">${w.best} pt${w.best === 1 ? '' : 's'}</span></li>`).join('')
    : '<li class="muted">Weekly winners show up once games go final.</li>';

  // ----- head to head: games where you and a friend picked different sides -----
  const gameById = new Map(games.map((g) => [g.id, g]));
  const pickOf = new Map(allPicks.map((p) => [`${p.user_id}|${p.game_id}`, p.pick]));
  const myFinal = allPicks.filter((p) => p.user_id === me && gameById.get(p.game_id)?.winner);
  const h2h = members.filter((m) => m.user_id !== me).map((m) => {
    let mine = 0; let theirs = 0;
    for (const p of myFinal) {
      const other = pickOf.get(`${m.user_id}|${p.game_id}`);
      if (!other || other === p.pick) continue;
      const w = gameById.get(p.game_id).winner;
      if (p.pick === w) mine++; else if (other === w) theirs++;
    }
    return { m, mine, theirs };
  }).sort((a, b) => (b.mine - b.theirs) - (a.mine - a.theirs) || a.m.name.localeCompare(b.m.name));
  const h2hHtml = h2h.length ? `
    <section class="card">
      <h2 class="icon-head">${ICON.users}Head to head</h2>
      <p class="muted small">Games where you and a friend picked different teams. Who got it right?</p>
      <table class="h2h"><thead><tr><th>Friend</th><th class="num">You</th><th class="num">Them</th><th></th></tr></thead>
      <tbody>${h2h.map(({ m, mine, theirs }) => `<tr><td>${esc(m.name)}</td><td class="num strong">${mine}</td><td class="num">${theirs}</td>
        <td><span class="h2h-tag ${mine > theirs ? 'up' : mine < theirs ? 'down' : ''}">${mine > theirs ? 'You lead' : mine < theirs ? 'They lead' : mine ? 'Even' : '—'}</span></td></tr>`).join('')}</tbody></table>
    </section>` : '';

  // ----- trophy case -----
  const withBadges = table.filter((p) => p.badges.length);
  const trophyHtml = `
    <section class="card">
      <h2 class="icon-head">${ICON.medal}Trophy case</h2>
      ${withBadges.length ? `<ul class="trophy-case">${withBadges.map((p) => `<li><span class="who">${esc(p.name)}</span><span class="chips">${p.badges.map(chip).join('')}</span></li>`).join('')}</ul>`
        : '<p class="muted small">Perfect weeks, week wins, Best bracket, Called the MVP and more show up here as the season goes.</p>'}
    </section>`;

  // ----- weekly recap (shareable picture) -----
  state.recap = weeklyRecap(league, weekly, games, allPicks, members);

  return `
    <div class="board-grid">
      <div class="board-main">
        <div class="card flush">
          <table class="standings">
            <thead><tr><th>#</th><th>Player</th>${showPts ? '<th class="num">Pts</th>' : ''}<th class="num">W</th><th class="num">L</th><th class="num">Pct</th><th class="num" title="Weeks won">Wk wins</th></tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
        ${scoringNote.length ? `<p class="muted small scoring-note">This league: ${scoringNote.join(' · ')}.</p>` : ''}
        ${state.recap ? `<section class="card recap-card">
          <div><h2 class="icon-head">${ICON.share}${esc(state.recap.label)} recap</h2>
          <p class="muted small">Winner, best upset call and worst miss, as a picture for the group chat.</p></div>
          <button class="btn" id="recap-btn">${ICON.share}Share recap</button></section>` : ''}
        ${h2hHtml}
      </div>
      <div class="board-side">
        ${trophyHtml}
        <section class="card">
          <h2 class="icon-head">${ICON.trophy}Weekly winners</h2>
          <ul class="weekly">${weeklyHtml}</ul>
        </section>
      </div>
    </div>`;
}

// The most recent finished week: who won, the best upset call, the worst miss.
function weeklyRecap(league, weekly, games, allPicks, members) {
  const done = weekly.find((w) => w.winners.length);
  if (!done) return null;
  const weekGames = games.filter((g) => weekKey(g.season_type, g.week) === done.key && g.winner);
  const byGame = new Map();
  for (const p of allPicks) { if (!byGame.has(p.game_id)) byGame.set(p.game_id, []); byGame.get(p.game_id).push(p); }
  const team = (g, side) => (side === 'home' ? g.home_abbr : g.away_abbr);
  let upset = null; let miss = null;
  for (const g of weekGames) {
    const ps = byGame.get(g.id) || [];
    if (!ps.length) continue;
    const right = ps.filter((p) => p.pick === g.winner);
    if (right.length && (!upset || right.length / ps.length < upset.share)) {
      upset = { share: right.length / ps.length, who: right.map((p) => nameOf(members, p.user_id)), team: g.winner === 'tie' ? 'a draw' : team(g, g.winner), of: ps.length, n: right.length };
    }
    const wrong = ps.filter((p) => p.pick !== g.winner);
    const lost = g.winner === 'home' ? 'away' : 'home';
    if (wrong.length && (!miss || wrong.length > miss.n)) miss = { n: wrong.length, of: ps.length, team: team(g, lost), winner: g.winner === 'tie' ? 'a draw' : team(g, g.winner) };
  }
  return {
    label: weekLabel(done.type, done.week, league.sport), league: league.name, sport: sportInfo(league.sport).name,
    winners: done.winners.map((r) => r.display_name), best: done.best, upset, miss,
  };
}

// Draw the recap as a 1080×1350 picture and share it (or download it where sharing files isn't supported).
async function shareRecap() {
  const r = state.recap;
  if (!r) return;
  await document.fonts?.ready;
  const c = Object.assign(document.createElement('canvas'), { width: 1080, height: 1350 });
  const x = c.getContext('2d');
  x.fillStyle = '#160b2e'; x.fillRect(0, 0, 1080, 1350);
  x.fillStyle = '#6d3fe0'; x.fillRect(0, 0, 1080, 14);
  const text = (t, px, y, { font = 'Figtree', weight = 700, color = '#ffffff', size = 40, align = 'center' } = {}) => {
    x.font = `${weight} ${size}px "${font}", sans-serif`; x.fillStyle = color; x.textAlign = align;
    let s = String(t);
    while (x.measureText(s).width > 960 && s.length > 4) s = `${s.slice(0, -2)}…`;
    x.fillText(s, px, y);
  };
  text('PICK SIX', 540, 110, { font: 'Big Shoulders Display', weight: 900, size: 64, color: '#f5b400' });
  text(`${r.league} · ${r.sport}`, 540, 170, { size: 34, color: 'rgba(255,255,255,.7)', weight: 600 });
  text(`${r.label} recap`, 540, 260, { font: 'Big Shoulders Display', weight: 800, size: 92 });
  const block = (y, title, big, small) => {
    x.fillStyle = 'rgba(255,255,255,.07)'; x.beginPath(); x.roundRect(80, y, 920, 260, 28); x.fill();
    text(title, 540, y + 64, { size: 32, color: '#f5b400', weight: 700 });
    text(big, 540, y + 150, { font: 'Big Shoulders Display', weight: 800, size: 76 });
    text(small, 540, y + 214, { size: 32, color: 'rgba(255,255,255,.75)', weight: 600 });
  };
  block(320, 'Week winner', r.winners.join(' & '), `${r.best} point${r.best === 1 ? '' : 's'}`);
  block(610, 'Best upset call', r.upset ? r.upset.who.slice(0, 3).join(', ') : 'Nobody', r.upset ? `${r.upset.n} of ${r.upset.of} picked ${r.upset.team}` : 'No upsets called');
  block(900, 'Worst miss', r.miss ? `${r.miss.n} of ${r.miss.of} took ${r.miss.team}` : 'Nobody missed', r.miss ? `and ${r.miss.winner} won` : '');
  text('Pick winners with your friends: derek1267.github.io/Pick-Six', 540, 1260, { size: 28, color: 'rgba(255,255,255,.55)', weight: 600 });
  const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
  const file = new File([blob], 'pick-six-recap.png', { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: `${r.label} recap` }); return; } catch { /* fall back to download */ }
  }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: 'pick-six-recap.png' });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
  if (teamsCache.has(sport)) return teamsCache.get(sport);
  const load = () => once(`teams:${sport}`, async () => {
    const { data } = await sb.from('teams').select('abbr, name, logo, conference, division, wins, losses, ties').eq('sport', sport);
    if (data?.length) { teamsCache.set(sport, data); idb.set(`teams:${sport}`, { at: Date.now(), data }); }
    return data || [];
  });
  const stored = await idb.get(`teams:${sport}`);
  if (stored?.data?.length && Date.now() - stored.at < DEVICE_TTL) {
    teamsCache.set(sport, stored.data);
    if (Date.now() - stored.at > 30 * 6e4) load().catch(() => {}); // records move: refresh quietly
    return stored.data;
  }
  return load();
}

async function searchPlayers(sport, term, teamAbbrs, rule = null) {
  const safe = term.replace(/[%_,()]/g, ' ').trim();
  if (!safe) return [];
  let q = sb.from('players').select('id, name, team_abbr, position, headshot').eq('sport', sport)
    .ilike('name', `%${safe}%`).order('name').limit(30);
  if (teamAbbrs?.length) q = q.in('team_abbr', teamAbbrs);
  if (rule?.only) q = q.in('position', rule.only);
  if (rule?.not) q = q.not('position', 'in', `(${rule.not.join(',')})`);
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

const sheetCache = new Map(); // `${league}|${kind}` → { picks, settings, at } — drawn instantly, refreshed behind
const favCache = new Map();   // `${sport}:${name}` → player row (or null when not in the players table)

// "Giannis Antetokounmpo" → ['Giannis', 'Antetokounmpo']; suffixes stay with the last name.
function splitName(name) {
  const w = String(name).trim().split(/\s+/);
  if (w.length === 1) return ['', w[0]];
  let last = w.pop();
  if (/^(jr\.?|sr\.?|ii|iii|iv)$/i.test(last) && w.length > 1) last = `${w.pop()} ${last}`;
  return [w.join(' '), last];
}
const TWO_WORD_NICKS = ['Trail Blazers', 'Red Sox', 'White Sox', 'Blue Jays', 'Maple Leafs', 'Red Wings', 'Blue Jackets', 'Golden Knights'];
function splitTeam(name) {
  const two = TWO_WORD_NICKS.find((n) => name.endsWith(` ${n}`));
  if (two) return [name.slice(0, -two.length - 1), two];
  return splitName(name);
}
const nameLines = (e) => (e.kind === 'team' ? splitTeam(e.name) : e.kind === 'custom' ? ['', e.name] : splitName(e.name));

async function favouritePlayers(sport, names) {
  const missing = names.filter((n) => !favCache.has(`${sport}:${n}`));
  if (missing.length) {
    const { data } = await sb.from('players').select('id, name, team_abbr, position, headshot').eq('sport', sport).in('name', missing);
    for (const n of missing) favCache.set(`${sport}:${n}`, null);
    for (const p of data || []) { favCache.set(`${sport}:${p.name}`, p); playerCache.set(p.id, p); }
  }
  return names.map((n) => favCache.get(`${sport}:${n}`) || { id: `custom:${n}`, name: n, team_abbr: '', position: '' });
}

async function mountSheets(root, league, members, stale, { sheets: defs, kind }) {
  const me = state.session.user.id;
  const isOwner = league.created_by === me;
  const sport = league.sport;
  const prefix = kind === 'awards' ? `${sport}:` : `${sport}:team:`;
  const sheets = defs.map((d) => ({ ...d, qid: `${prefix}${d.id}`, size: SEL.slotCount(d) }));
  const qids = sheets.map((s) => s.qid);
  const cacheKey = `${league.id}|${kind}`;
  const dialog = document.getElementById('pick-dialog');

  const fetchAll = async () => {
    const [picksRes, settingsRes] = await Promise.all([
      sb.from('award_picks').select('user_id, question_id, players').eq('league_id', league.id).in('question_id', qids),
      sb.from('award_settings').select('question_id, locked_at, answers').eq('league_id', league.id).in('question_id', qids),
    ]);
    const data = { picks: picksRes.data || [], settings: settingsRes.data || [], at: Date.now() };
    await fetchPlayers([...data.picks.flatMap((r) => r.players || []), ...data.settings.flatMap((r) => r.answers || [])]);
    sheetCache.set(cacheKey, data);
    return data;
  };

  const cached = sheetCache.get(cacheKey);
  const [first, teams] = await Promise.all([cached || fetchAll(), getTeams(sport)]);
  if (stale()) return;

  const picksByUser = new Map();
  let settings = new Map();
  const apply = (data) => {
    picksByUser.clear();
    picksByUser.set(me, new Map());
    for (const r of data.picks) {
      if (!picksByUser.has(r.user_id)) picksByUser.set(r.user_id, new Map());
      picksByUser.get(r.user_id).set(r.question_id, r.players || []);
    }
    settings = new Map(data.settings.map((r) => [r.question_id, r]));
  };
  apply(first);
  const remember = () => sheetCache.set(cacheKey, {
    picks: [...picksByUser].flatMap(([user_id, m]) => [...m].map(([question_id, players]) => ({ user_id, question_id, players }))),
    settings: [...settings.values()], at: Date.now(),
  });

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
  const staffRole = (sheet) => STAFF_ROLE[sheet.qid];
  const staffName = (sheet, abbr) => { const r = staffRole(sheet); return r ? staffFor(sport, abbr, teams.find((t) => t.abbr === abbr)?.name)?.[r] || '' : ''; };

  let active = null;     // { qid, flat, mode: 'pick' | 'answer' } — the spot being filled in the popup
  let resultsFor = null; // qid the owner is entering results for
  let ownerMode = false; // owner controls stay out of the way until asked for
  let side = sheets[0]?.qid; // All-Stars: which conference/division is showing
  let searchTimer;

  const save = async (sheet, arr) => {
    picksByUser.get(me).set(sheet.qid, arr);
    remember();
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
    remember();
    if ('locked_at' in patch) apply(await fetchAll()); // locking reveals everyone's picks
  };

  // Players already used on this sheet, or on sheets in the same group (All-NBA 1st/2nd/3rd…).
  const usedIds = (sheet, mode) => {
    const get = (s) => (mode === 'answer' ? answers(s) : mine(s));
    const related = sheets.filter((s) => s.qid === sheet.qid || (sheet.group && s.group === sheet.group));
    return new Set(related.flatMap(get).filter(Boolean));
  };

  // ----- pieces -----
  const statusOf = (sheet) => (answerSet(sheet).size ? ['done', 'Results in'] : isOpen(sheet) ? ['open', 'Open'] : ['locked', 'Locked']);

  // One spot: a fixed-shape card (position, picture, first name, last name, detail) so every
  // card in a row is the same size whether it's filled or not.
  const slot = (sheet, flat, value, mode, editable, size = 'big') => {
    const label = SEL.slotLabel(sheet, flat) || '';
    const pos = `<span class="spot-pos">${esc(label)}</span>`;
    if (value) {
      const e = entityOf(value, teams);
      const verdict = mode === 'pick' && answerSet(sheet).size ? answerSet(sheet).has(value) : null;
      const [firstLine, lastLine] = nameLines(e);
      const sub = e.kind === 'team' ? (staffName(sheet, e.team?.abbr) || recordText(e.team)) : e.sub;
      const tap = editable ? ` role="button" tabindex="0" data-open="${flat}" data-mode="${mode}" data-q="${sheet.qid}" aria-label="Change ${esc(e.name)}"` : '';
      return `<div class="spot ${size} filled ${editable ? 'tappable' : ''} ${verdict === true ? 'hit' : verdict === false ? 'miss' : ''}"${tap}>
        ${pos}${portrait(e, size === 'big' ? 52 : 40)}
        <span class="spot-first" style="--len:${Math.max(firstLine.length, 6)}">${esc(firstLine)}</span>
        <span class="spot-last" style="--len:${Math.max(lastLine.length, 6)}">${esc(lastLine)}</span>
        <span class="spot-sub">${esc(sub || '')}</span>
        ${editable ? `<button class="spot-x" data-clear="${flat}" data-mode="${mode}" data-q="${sheet.qid}" aria-label="Remove ${esc(e.name)}">${ICON.close}</button>` : ''}
      </div>`;
    }
    if (!editable) return `<div class="spot ${size} empty">${pos}<span class="spot-plus none"></span><span class="spot-add muted">No pick</span></div>`;
    const what = sheet.pick === 'team' ? 'Choose team' : 'Add player';
    return `<button class="spot ${size} empty" data-open="${flat}" data-mode="${mode}" data-q="${sheet.qid}" aria-label="${esc(`${what}${label ? ` (${label})` : ''}`)}">
      ${pos}<span class="spot-plus">${ICON.plus}</span><span class="spot-add">${esc(what)}</span></button>`;
  };

  // Rows for a plain section: same card width everywhere, rows centred, no lonely last card.
  const perRow = (n, max) => (n <= max ? n : Math.ceil(n / Math.ceil(n / max)));
  const sectionBlock = (sheet, sIdx, values, mode, editable) => {
    const section = sheet.sections[sIdx];
    const start = SEL.slotIndex(sheet, sIdx, 0);
    const size = section.size === 'big' ? 'big' : 'small';
    const spots = Array.from({ length: section.n }, (_, i) => slot(sheet, start + i, values[start + i], mode, editable, size)).join('');
    return `
      <section class="roster-section ${section.kind || ''}">
        ${sheet.size > 1 ? `<h4>${esc(section.label)}</h4>` : ''}
        <div class="spots ${size}" style="--per:${perRow(section.n, 7)};--per-m:${perRow(section.n, 4)}">${spots}</div>
      </section>`;
  };

  // Position layout drawn on a court / rink / field / diamond.
  const surfaceBlock = (sheet, values, mode, editable) => sheet.layout.groups.map((g) => {
    const cols = g.rows[0].length;
    const cells = (row) => row.map((f) => (f === null ? '<span class="cell"></span>'
      : `<span class="cell">${slot(sheet, f, values[f], mode, editable, 'big')}</span>`)).join('');
    return `
      <section class="surface-block">
        ${g.title ? `<h4>${esc(g.title)}</h4>` : ''}
        <div class="surface-scroll"><div class="surface-inner" style="--cols:${cols}">
          <div class="surface s-${sheet.layout.surface}">
            ${SURFACE[sheet.layout.surface]}
            <div class="formation">${g.rows.map((r) => `<div class="frow">${cells(r)}</div>`).join('')}</div>
          </div>
          ${g.bench ? `<div class="bench"><h5>Backups</h5>${g.bench.map((r) => `<div class="frow">${cells(r)}</div>`).join('')}</div>` : ''}
        </div></div>
      </section>`;
  }).join('');

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
    const drawn = SEL.laidOut(sheet);
    const plain = sheet.sections.map((s, i) => i).filter((i) => !drawn.has(SEL.slotIndex(sheet, i, 0)));
    return `
      ${entering ? '<p class="note">Fill in the real result. Saving locks this and scores everyone.</p>' : ''}
      ${sheet.layout ? surfaceBlock(sheet, values, mode, editable) : ''}
      ${plain.map((i) => sectionBlock(sheet, i, values, mode, editable)).join('')}
      ${!entering && answerSet(sheet).size ? `<p class="note">${answerSet(sheet).size} real picks entered. Green spots made it.</p>` : ''}
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
  const intro = (iconName, text) => `
    <div class="tab-intro">${ICON[iconName]}<p>${text} ${hidden}</p>
      ${isOwner ? `<button class="btn small secondary" data-ownermode>${ICON.gear}${ownerMode ? 'Hide owner controls' : 'Owner controls'}</button>` : ''}</div>`;

  // ----- layouts -----
  const drawAwards = () => {
    const cats = [...new Set(sheets.map((s) => s.cat || 'season'))];
    return `
      ${intro('trophy', 'Call the winners: 3 points each.')}
      ${leaderboard()}
      ${cats.map((cat) => `
        <section class="award-cat">
          <h3 class="cat-head">${CAT_ICON[cat] || ICON.trophy}${esc(SEL.AWARD_CATEGORIES[cat] || 'Awards')}</h3>
          <div class="trophies" style="${[2, 3, 4, 5].map((m) => `--p${m}:${perRow(sheets.filter((s) => (s.cat || 'season') === cat).length, m)}`).join(';')}">${sheets.filter((s) => (s.cat || 'season') === cat).map((sheet) => {
            const [cls, label] = statusOf(sheet);
            const entering = resultsFor === sheet.qid;
            const values = entering ? answers(sheet) : mine(sheet);
            const real = answerSet(sheet);
            return `
              <article class="trophy ${cls} ${entering ? 'entering' : ''}">
                <header><h4>${esc(sheet.title)}</h4><p>${esc(sheet.note || '')}</p></header>
                ${slot(sheet, 0, values[0], entering ? 'answer' : 'pick', entering || isOpen(sheet), 'big')}
                <footer>
                  <span class="pill ${cls}">${label}</span>
                  ${real.size && !entering ? `<span class="winner">Winner: <strong>${esc(entityOf([...real][0], teams).name)}</strong></span>` : ''}
                  ${everyone(sheet)}
                  ${ownerTools(sheet)}
                </footer>
              </article>`;
          }).join('')}</div>
        </section>`).join('')}`;
  };

  const drawAllStars = () => {
    const sheet = sheets.find((s) => s.qid === side) || sheets[0];
    const [cls, label] = statusOf(sheet);
    const filled = mine(sheet).filter(Boolean).length;
    return `
      ${intro('star', 'Pick the full roster: 1 point for every player who makes it, injury replacements included.')}
      ${leaderboard()}
      ${sheets.length < 2 ? '' : `<div class="side-switch" role="tablist" aria-label="Choose a side">
        ${sheets.map((s) => `<button role="tab" aria-selected="${s.qid === sheet.qid}" class="${s.qid === sheet.qid ? 'on' : ''}" data-side="${s.qid}">
          ${esc(s.side)}<span class="count">${mine(s).filter(Boolean).length}/${s.size}</span></button>`).join('')}
      </div>`}
      <article class="roster" style="--base:${Math.max(7, sheet.layout?.groups[0].rows[0].length || 0)}">
        <header class="roster-head"><h3>${esc(sheet.title)}</h3><span class="muted small">${filled} of ${sheet.size} picked</span><span class="pill ${cls}">${label}</span></header>
        ${rosterBody(sheet)}
      </article>`;
  };

  const drawYearEnd = () => {
    const headings = [...new Set(sheets.map((s) => s.heading))];
    return `
      ${intro('medal', 'Name the year-end teams: 1 point for every player you get right. A player can only go on one team in each set.')}
      ${leaderboard()}
      ${headings.map((h) => `
        <section class="ye-group">
          <h3 class="cat-head">${ICON.medal}${esc(h)}</h3>
          <div class="ye-grid ${['court', 'rink'].includes(sheets.find((s) => s.heading === h)?.layout?.surface) ? 'tiles' : ''}">
          ${sheets.filter((s) => s.heading === h).map((sheet) => {
            const [cls, label] = statusOf(sheet);
            return `<article class="roster ye" style="--base:${Math.max(7, sheet.layout?.groups[0].rows[0].length || 0)}">
              <header class="roster-head"><h4>${esc(sheet.title)}</h4><span class="pill ${cls}">${label}</span></header>
              ${rosterBody(sheet)}
            </article>`;
          }).join('')}
          </div>
        </section>`).join('')}`;
  };

  const draw = () => {
    if (!document.body.contains(root)) return;
    root.innerHTML = kind === 'awards' ? drawAwards() : kind === 'allstars' ? drawAllStars() : drawYearEnd();
  };

  // ----- the pick popup -----
  const pickRow = (id, e, sub, rank = null) => `
    <button class="prow" data-choose="${esc(id)}">
      <span class="prank">${rank || ''}</span>
      ${portrait(e, 40)}
      <span class="pname"><strong>${esc(e.name)}</strong><small>${esc(sub || '')}</small></span>
      <span class="pgo">Pick</span>
    </button>`;

  const teamRow = (sheet, t, rank = null) => pickRow(`team:${t.abbr}`, { kind: 'team', name: t.name, team: t },
    [staffName(sheet, t.abbr), recordText(t)].filter(Boolean).join(' · '), rank);

  const favouritesHtml = async (sheet) => {
    const used = usedIds(sheet, active.mode);
    const awardId = sheet.qid.slice(prefix.length);
    const curated = kind === 'awards' ? FAVOURITES[sport]?.[awardId] : null;
    if (sheet.pick === 'team') {
      const pool = teamsFor(sheet);
      let list = curated ? curated.map((a) => pool.find((t) => t.abbr === a)).filter(Boolean) : [];
      const title = list.length ? `Favourites <span class="muted">as of ${FAVOURITES_AS_OF}</span>` : 'Best records right now';
      if (!list.length) {
        const pctOf = (t) => { const gp = t.wins + t.losses + (t.ties || 0); return gp ? (t.wins + (t.ties || 0) / 2) / gp : 0; };
        list = [...pool].sort((a, b) => pctOf(b) - pctOf(a) || b.wins - a.wins).slice(0, 5);
      }
      list = list.filter((t) => !used.has(`team:${t.abbr}`));
      return `<h3 class="pick-sub">${ICON.star}${title}</h3>
        <div class="plist">${list.map((t, i) => teamRow(sheet, t, i + 1)).join('')}</div>
        <h3 class="pick-sub">${ICON.users}All teams</h3>
        <div class="plist">${[...pool].sort((a, b) => a.name.localeCompare(b.name)).filter((t) => !used.has(`team:${t.abbr}`)).map((t) => teamRow(sheet, t)).join('')}</div>`;
    }
    const allowed = sheet.filter ? new Set(teamsFor(sheet).map((t) => t.abbr)) : null;
    if (!curated?.length) {
      // No odds for this spot: suggest well-known players who fit it (position, conference, not used yet).
      if (kind === 'awards' && NO_SUGGESTIONS.test(awardId)) return '';
      // Only players who fit the spot (position, conference) and aren't used yet.
      const { names, title } = suggestionPool(sport, kind === 'awards' ? '' : sheet.id);
      const pool = (await favouritePlayers(sport, names))
        .filter((p) => !p.id.startsWith('custom:') && !used.has(p.id) && (!allowed || allowed.has(p.team_abbr)));
      const picks = SEL.suggestFor(sport, sheet, active.flat, pool, { isAward: kind === 'awards' });
      if (!picks.length) return '';
      const note = title === 'Rookie favourites' ? `this season’s top rookies, as of ${FAVOURITES_AS_OF}` : 'well-known players for this spot, not odds';
      return `<h3 class="pick-sub">${ICON.star}${title} <span class="muted">${note}</span></h3>
        <div class="plist">${picks.map((p, i) => pickRow(p.id, { kind: 'player', name: p.name, headshot: p.headshot },
          [p.team_abbr, p.position].filter(Boolean).join(' · '), i + 1)).join('')}</div>`;
    }
    const players = (await favouritePlayers(sport, curated))
      .filter((p) => !used.has(p.id) && (!allowed || !p.team_abbr || allowed.has(p.team_abbr)));
    if (!players.length) return '';
    const title = FAVOURITE_TITLE[sport] ? `${esc(FAVOURITE_TITLE[sport])} <span class="muted">next season’s odds aren’t out yet</span>`
      : `Favourites <span class="muted">as of ${FAVOURITES_AS_OF}</span>`;
    return `<h3 class="pick-sub">${ICON.star}${title}</h3>
      <div class="plist">${players.slice(0, 5).map((p, i) => pickRow(p.id, { kind: 'player', name: p.name, headshot: p.headshot },
        [p.team_abbr, p.position].filter(Boolean).join(' · '), i + 1)).join('')}</div>`;
  };

  const drawPicker = async () => {
    const sheet = sheets.find((s) => s.qid === active?.qid);
    if (!sheet) return;
    const label = SEL.slotLabel(sheet, active.flat);
    const sec = SEL.sectionOf(sheet, active.flat);
    const heading = kind === 'awards' ? sheet.title : `${sheet.title}${label ? ` · ${label}` : sec && sheet.size > 1 ? ` · ${sec.label}` : ''}`;
    const f = sheet.filter;
    const currentId = (active.mode === 'answer' ? answers(sheet) : mine(sheet))[active.flat];
    const current = currentId ? entityOf(currentId, teams) : null;
    const searchBox = sheet.pick === 'team' ? '' : `
      <label class="search-field">${ICON.search}<input type="search" id="sheet-search" autocomplete="off"
        placeholder="Search ${esc(f?.conference || f?.division || sportInfo(sport).name)} ${esc(SEL.slotRule(sport, sheet, active.flat)?.only && label ? `${label}s` : 'players')}" aria-label="Search players"></label>
      <div class="plist" role="listbox" id="sheet-results"></div>`;
    dialog.innerHTML = `
      <header class="pick-head">
        <div><p class="pick-kicker">${active.mode === 'answer' ? 'Enter the real result' : 'Your pick'}</p><h2>${esc(heading)}</h2></div>
        <button class="icon-btn" data-close aria-label="Close">${ICON.close}</button>
      </header>
      <div class="pick-body">${current ? `<div class="pick-current">${portrait(current, 40)}<span class="pname"><small>Current pick</small><strong>${esc(current.name)}</strong></span>
        <button class="btn small secondary" data-remove>Remove</button></div>` : ''}${searchBox}<div id="pick-favs"><p class="muted small">Loading suggestions…</p></div></div>`;
    if (!dialog.open) dialog.showModal();
    const myActive = active;
    const favs = await favouritesHtml(sheet);
    if (active !== myActive) return;
    const box = dialog.querySelector('#pick-favs');
    if (box) box.innerHTML = favs;
    dialog.querySelector('#sheet-search')?.focus({ preventScroll: true });
  };

  const closePicker = () => { active = null; if (dialog.open) dialog.close(); };

  // ----- search -----
  const runSearch = async (input) => {
    const box = dialog.querySelector('#sheet-results');
    const sheet = sheets.find((s) => s.qid === active?.qid);
    if (!box || !sheet) return;
    const term = input.value.trim();
    if (term.length < 2) { box.innerHTML = ''; return; }
    const fitsPos = SEL.slotPositions(sheet, active.flat);
    const taken = usedIds(sheet, active.mode);
    const allowed = sheet.filter ? teamsFor(sheet).map((t) => t.abbr) : null;
    const rule = SEL.slotRule(sport, sheet, active.flat);
    const found = (await searchPlayers(sport, term, allowed, rule)).filter((p) => !taken.has(p.id));
    if (input.value.trim() !== term) return; // a newer search is on its way
    const lower = term.toLowerCase();
    const fits = (p) => (fitsPos?.length ? fitsPos.includes(p.position) : true);
    found.sort((a, b) => (fits(b) - fits(a)) || (b.name.toLowerCase().startsWith(lower) - a.name.toLowerCase().startsWith(lower)));
    const exact = found.some((p) => p.name.toLowerCase() === lower);
    box.innerHTML = found.slice(0, 8).map((p) => pickRow(p.id, { kind: 'player', name: p.name, headshot: p.headshot },
      [p.team_abbr, p.position].filter(Boolean).join(' · ')).replace('class="prow"', `class="prow ${fits(p) ? '' : 'off'}"`)).join('')
      + (!exact ? `<button class="prow custom" data-choose="custom:${esc(term)}"><span class="prank"></span><span class="face blank" style="width:40px;height:40px">${ICON.plus}</span><span class="pname"><strong>Use “${esc(term)}”</strong><small>Not in the list? Pick them by name.</small></span></button>` : '');
  };

  const choose = async (id) => {
    const sheet = sheets.find((s) => s.qid === active.qid);
    const arr = active.mode === 'answer' ? answers(sheet) : mine(sheet);
    arr[active.flat] = id;
    // Move straight on to the next empty spot in the same section.
    const sec = SEL.sectionOf(sheet, active.flat);
    const next = id ? arr.findIndex((v, i) => !v && i > active.flat && SEL.sectionOf(sheet, i) === sec) : -1;
    const mode = active.mode;
    if (next >= 0 && kind !== 'awards') { active = { ...active, flat: next }; drawPicker(); } else closePicker();
    if (mode === 'answer') {
      await saveSettings(sheet, { answers: arr.some(Boolean) ? arr : null, locked_at: settings.get(sheet.qid)?.locked_at || new Date().toISOString() });
    } else {
      picksByUser.get(me).set(sheet.qid, arr);
      draw();
      await save(sheet, arr);
    }
    draw();
  };

  dialog.oninput = (e) => {
    if (e.target.id !== 'sheet-search') return;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => runSearch(e.target), 180);
  };
  dialog.onclick = (e) => {
    if (e.target === dialog || e.target.closest('[data-close]')) return closePicker();
    if (e.target.closest('[data-remove]') && active) return choose('');
    const el = e.target.closest('[data-choose]');
    if (el && active) choose(el.dataset.choose);
  };
  dialog.onclose = () => { active = null; };
  root.onkeydown = (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.spot.tappable')) { e.preventDefault(); e.target.click(); }
  };

  root.onclick = async (e) => {
    const t = (sel) => e.target.closest(sel);
    const sheetOf = (q) => sheets.find((s) => s.qid === q);
    let el;
    if (t('[data-ownermode]')) {
      ownerMode = !ownerMode; if (!ownerMode) resultsFor = null; draw();
    } else if ((el = t('[data-side]'))) {
      side = el.dataset.side; draw();
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
    } else if ((el = t('[data-open]'))) {
      active = { qid: el.dataset.q, flat: Number(el.dataset.open), mode: el.dataset.mode };
      drawPicker();
    } else if ((el = t('[data-lock]'))) {
      await saveSettings(sheetOf(el.dataset.lock), { locked_at: new Date().toISOString() });
      draw();
    } else if ((el = t('[data-unlock]'))) {
      await saveSettings(sheetOf(el.dataset.unlock), { locked_at: null });
      draw();
    } else if ((el = t('[data-results]'))) {
      resultsFor = resultsFor === el.dataset.results ? null : el.dataset.results;
      draw();
    }
  };

  draw();

  // Shown from the cache? Check for anything newer behind the scenes.
  if (cached) {
    const before = JSON.stringify([cached.picks, cached.settings]);
    const fresh = await fetchAll().catch(() => null);
    if (fresh && !stale() && !active && JSON.stringify([fresh.picks, fresh.settings]) !== before) { apply(fresh); draw(); }
  }
}

// ----- Final standings predictor ---------------------------------------------

const PLAYOFF_LINES = {
  nfl: { playoff: 7 },
  nba: { playoff: 6, playIn: 10 },
  nhl: { playoff: 8 },
  mls: { playoff: 9 },
  nll: { playoff: 8 },
  mlb: { playoff: 6 },
};

async function mountStandings(root, league, members, stale) {
  const me = state.session.user.id;
  const isOwner = league.created_by === me;
  const sport = league.sport;
  const confs = BR.tablesOf(sport);
  const qidOf = (c) => `${sport}:standings:${c}`;
  const qids = confs.map(qidOf);

  const [teams, picksRes, settingsRes, started] = await Promise.all([
    getTeams(sport),
    sb.from('award_picks').select('user_id, question_id, players').eq('league_id', league.id).in('question_id', qids),
    sb.from('award_settings').select('question_id, locked_at').eq('league_id', league.id).in('question_id', qids),
    seasonStarted(league),
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
          <span class="r-team"><strong>${esc(t?.name || abbr)}</strong><span class="muted small">${started ? `${recordText(t)} · ${ordinal(now + 1)} today` : `Last season ${recordText(t)} · ${ordinal(now + 1)}`}</span></span>
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
          ${started ? `<p class="pred-score"><strong>${score.points}</strong> points if the season ended today <span class="muted small">${score.exact} in the exact spot</span></p>`
            : '<p class="pred-score muted small">Scoring starts with the first game of the season.</p>'}
          ${!isSaved(c) && open ? `<p class="note">Starting from ${started ? 'today’s standings' : 'how last season finished'}. Move teams to make it yours.</p>` : ''}
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
    if (!anyLocked || !started) return '';
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
      <p class="lede-sm">Predict where every team finishes. 3 points for the exact spot, 1 point for one spot off, ${started ? 'scored live against today’s standings' : 'scored live once the season starts'}.
        ${isOwner ? `Lock ${confs.length > 1 ? 'each side' : 'it'} before the season gets going.` : 'Everyone’s picks show once the owner locks them.'}</p>
      ${leaderboard()}
      <div class="standings-grid ${confs.length === 1 ? 'one' : ''}">${confs.map(list).join('')}</div>`;
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
// Has this league's season played a game yet? (Off-season leagues are for the season ahead.)
const startedCache = new Map();
async function seasonStarted(league) {
  const key = `${league.sport}:${league.season}`;
  if (!startedCache.has(key)) {
    const { data } = await sb.from('games').select('id').eq('sport', league.sport).eq('season', league.season)
      .lte('start_time', new Date().toISOString()).limit(1);
    startedCache.set(key, (data || []).length > 0);
  }
  return startedCache.get(key);
}

async function myStandingsPrediction(league) {
  const sport = league.sport;
  const confs = BR.tablesOf(sport);
  const { data } = await sb.from('award_picks').select('question_id, players').eq('league_id', league.id)
    .eq('user_id', state.session.user.id).in('question_id', confs.map((c) => `${sport}:standings:${c}`));
  const out = {};
  for (const r of data || []) out[r.question_id.split(':').pop()] = r.players || [];
  return confs.every((c) => out[c]?.length) ? out : null;
}

// ----- Predictions hub ---------------------------------------------------------

async function mountPredictions(league, members, route, stale) {
  const subs = ['standings', 'awards', 'yearend', ...((SEL.ALLSTARS[league.sport] || []).length ? ['allstars'] : [])];
  const sub = subs.includes(route.sub) ? route.sub : 'standings';
  const root = document.getElementById('predict-root');
  if (sub === 'standings') return mountStandings(root, league, members, stale);
  if (sub === 'awards') return mountSheets(root, league, members, stale, { kind: 'awards', sheets: SEL.AWARDS[league.sport] || [] });
  if (sub === 'allstars') return mountSheets(root, league, members, stale, { kind: 'allstars', sheets: SEL.ALLSTARS[league.sport] || [] });
  return mountSheets(root, league, members, stale, { kind: 'yearend', sheets: SEL.YEAR_END[league.sport] || [] });
}

function predictionsNav(league, route) {
  const sub = route.sub || 'standings';
  const items = [
    ['standings', 'Final standings', 'standings'],
    ['awards', 'Awards', 'trophy'],
    ['allstars', SEL.ALLSTAR_NAME[league.sport] || 'All-Stars', 'star'],
    ['yearend', 'Year-end teams', 'medal'],
  ].filter(([k]) => k !== 'allstars' || (SEL.ALLSTARS[league.sport] || []).length);
  return `<nav class="subnav" aria-label="Predictions">${items.map(([k, label, icon]) =>
    `<a href="#/league/${league.id}?tab=predict&sub=${k}" class="${sub === k ? 'on' : ''}" ${sub === k ? 'aria-current="page"' : ''}>${ICON[icon]}${esc(label)}</a>`).join('')}</nav>`;
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
  const fieldSize = BR.fieldSizeOf(sport); // NBA "Build your own" includes the play-in (seeds 7–10)
  const tables = BR.tablesOf(sport);        // where teams are chosen from (NLL: one table)
  const label = (c) => BR.confLabel(sport, c);
  const sideRounds = F.rounds.length - 1;   // columns on each side of the final

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
  const fieldFromToday = () => Object.fromEntries(tables.map((c) => [c, todayOrder(c).slice(0, fieldSize)]));
  let fun = lsGet(funKey, null);
  const validField = (f) => f && tables.every((c) => Array.isArray(f[c]) && f[c].length === fieldSize
    && f[c].every((a) => !a || !knowsConferences || teamByAbbr.get(a)?.conference === c));
  if (!fun || !validField(fun.field)) fun = { field: fieldFromToday(), picks: {}, step: 'field' };
  const persistFun = () => lsSet(funKey, fun);
  const fieldFull = () => tables.every((c) => fun.field[c].every(Boolean));
  const funSeeds = () => {
    const seeded = Object.fromEntries(tables.map((c) => [c, fun.field[c].filter(Boolean)
      .map((abbr, i) => ({ ...(teamByAbbr.get(abbr) || { abbr, team_name: abbr, wins: 0, losses: 0, ties: 0 }), seed: i + 1 }))]));
    return F.single ? BR.splitSingle(sport, seeded[F.single]) : seeded;
  };

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
    if (F.wildCard) {
      const block = (c) => `<div class="pi-conf"><h4>${esc(label(c))}</h4><div class="pi-games one">${matchup(b[c].playIn[0], '8 v 9: winner is the 8 seed')}</div></div>`;
      return `<section class="playin"><h3>Wild card</h3><div class="pi-wrap">${block(c0)}${block(c1)}</div></section>`;
    }
    const block = (c) => `<div class="pi-conf"><h4>${esc(c)}</h4><div class="pi-games">
      ${matchup(b[c].playIn[0], '7 v 8: winner is 7th')}
      ${matchup(b[c].playIn[1], '9 v 10: loser is out')}
      ${matchup(b[c].playIn[2], 'Last chance: winner is 8th')}
    </div></div>`;
    return `<section class="playin"><h3>Play-in tournament</h3><div class="pi-wrap">${block(c0)}${block(c1)}</div></section>`;
  };

  const bracketHtml = () => {
    const s = seeds();
    const b = BR.buildBracket(sport, s, getPicks());
    const champ = b.F.winner;
    const champOdds = champ ? oddsRows()?.find((r) => r.team.abbr === champ.abbr)?.champ : null;
    const col = (cls, inner) => `<div class="round ${cls}">${inner}</div>`;
    const ladder = Array.from({ length: sideRounds }, (_, i) => i);
    return `
      ${playInHtml(b)}
      <div class="bracket-scroll" tabindex="0" aria-label="Playoff bracket (scrolls sideways)">
        <div class="bracket-full" style="--side:${sideRounds}">
          <div class="bf-conf left">${esc(label(c0))}</div>
          <div class="bf-conf center">${esc(F.rounds[sideRounds])}</div>
          <div class="bf-conf right">${esc(label(c1))}</div>
          ${ladder.map((i) => roundLabel(i)).join('')}${roundLabel(sideRounds, 'Final')}${[...ladder].reverse().map((i) => roundLabel(i)).join('')}
          ${col('', byeCards(b[c0]) + b[c0].r1.map((g) => matchup(g)).join(''))}
          ${col('', b[c0].r2.map((g) => matchup(g)).join(''))}
          ${b[c0].r3 ? col('', matchup(b[c0].r3)) : ''}
          ${col('final-col', `${matchup(b.F)}
            <div class="champion ${champ ? 'crowned' : ''}">
              ${champ ? `${champ.logo ? `<img src="${esc(champ.logo)}" alt="" width="44" height="44">` : ''}
                <span class="champ-name">${esc(champ.team_name || champ.name)}</span>
                ${champOdds != null ? `<span class="muted small">${pct(champOdds)} title odds</span>` : ''}`
                : '<span class="muted small">Your champion shows here</span>'}
            </div>`)}
          ${b[c1].r3 ? col('', matchup(b[c1].r3)) : ''}
          ${col('', b[c1].r2.map((g) => matchup(g)).join(''))}
          ${col('', byeCards(b[c1]) + b[c1].r1.map((g) => matchup(g)).join(''))}
        </div>
      </div>`;
  };

  // Title odds as a heat grid: one row per team, one cell per round reached, darker = likelier.
  const oddsHtml = () => {
    const rows = oddsRows();
    const head = `<header class="odds-head">${ICON.dice}<div><h3>Title odds</h3>
      <p class="muted small">How far each team gets in thousands of simulated playoffs, using records and home advantage${F.bestOf[0] > 1 ? ', played as full series' : ''}. A simple model, not a forecast.</p></div></header>`;
    if (!rows) return `<section class="panel odds-panel">${head}${skeleton(4)}</section>`;
    const logoOf = (abbr) => allTeams.find((t) => t.abbr === abbr);
    const cols = sideRounds === 3
      ? [[F.rounds[1], 'r2'], [F.rounds[2], 'r3'], [F.rounds[3], 'final'], ['Champion', 'champ']]
      : [[F.rounds[1], 'r2'], [F.rounds[2], 'final'], ['Champion', 'champ']];
    const cell = (r, key, label) => {
      const v = r[key];
      const tint = Math.round(Math.sqrt(v) * 100); // sqrt so small chances still show
      return `<td class="heat ${v >= 0.42 ? 'deep' : ''}" style="--t:${tint}%" title="${esc(`${r.team.abbr} reaches ${label}: ${pct(v)}`)}">${pct(v)}</td>`;
    };
    const table = (conf) => {
      const list = rows.filter((r) => F.single || r.conference === conf).sort((a, b) => b.champ - a.champ || b.final - a.final);
      return `<div class="odds-conf"><h4>${esc(conf)}</h4>
        <table class="odds"><thead><tr><th>Team</th>${cols.map(([label]) => `<th class="num">${esc(label)}</th>`).join('')}</tr></thead>
        <tbody>${list.map((r) => `<tr>
          <td class="odds-team"><span class="seed">${r.team.seed}</span>${teamLogo(logoOf(r.team.abbr) || r.team, 22)}<strong>${esc(r.team.abbr)}</strong></td>
          ${cols.map(([label, key]) => cell(r, key, label)).join('')}</tr>`).join('')}</tbody></table></div>`;
    };
    return `<section class="panel odds-panel">${head}
      <div class="odds-grid ${F.single ? 'one' : ''}">${(F.single ? [F.single] : F.conferences).map(table).join('')}</div>
      <p class="odds-key muted small"><span class="key-ramp"></span>Less likely → more likely</p></section>`;
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
        const divider = F.playIn && i === F.teams - 2 ? '<li class="cut cut-playin"><span>Play-in tournament: seeds 7 to 10</span></li>'
          : F.wildCard && i === F.teams - 1 ? '<li class="cut cut-playin"><span>Wild card: 8 v 9</span></li>' : '';
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
      <div class="field-grid ${tables.length === 1 ? 'one' : ''}">${tables.map(conf).join('')}</div>
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
    return `<p class="note">Brackets are locked. Points per correct winner: ${(sideRounds === 3 ? ['R1', 'R2', 'R3', 'F'] : ['R1', 'R2', 'F']).map((k, i) => `${esc(F.rounds[i])} ${BR.ROUND_POINTS[k]}`).join(', ')}.</p>`;
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
        ? `Pick the ${fieldSize} teams${F.single ? '' : ` per ${sport === 'mlb' ? 'league' : 'conference'}`} that make it${F.playIn ? ', including the four in the play-in tournament' : F.wildCard ? ', including the two in the wild card game' : ''}, in seed order. Saved on this device. It doesn’t count in your league.`
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
    if (how === 'clear') fun.field = Object.fromEntries(tables.map((c) => [c, Array(fieldSize).fill('')]));
    if (how === 'today') fun.field = fieldFromToday();
    if (how === 'prediction') {
      const pred = await myStandingsPrediction(league);
      if (!pred) { toast('Save a final standings prediction first (Predictions tab).', 'error'); return; }
      fun.field = Object.fromEntries(tables.map((c) => [c, [...pred[c], ...todayOrder(c)].filter((a, i, arr) => arr.indexOf(a) === i).slice(0, fieldSize)]));
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

// Close the week/day menu when clicking elsewhere or pressing Escape.
const closeSlateMenus = () => document.querySelectorAll('.slate-menu:not([hidden])').forEach((m) => {
  m.hidden = true; m.previousElementSibling?.setAttribute('aria-expanded', 'false');
});
document.addEventListener('click', (e) => { if (!e.target.closest('.slate-pick')) closeSlateMenus(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSlateMenus(); });

// One click handler for every pick button (survives re-renders).
app.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-pick]');
  if (btn && !btn.disabled && state.league) makePick(state.league, btn.dataset.game, btn.dataset.pick, btn);
  const lock = e.target.closest('[data-lock-game]');
  if (lock && state.league) setLock(state.league, lock.dataset.lockGame);
  if (e.target.closest('#ics-btn') && state.league) downloadIcs(state.league, state.icsGames || []);
  if (e.target.closest('#recap-btn')) shareRecap();
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Intro: what Pick Six is. Opens on the first visit and from the ? button.
// ---------------------------------------------------------------------------

const INTRO_KEY = 'pickSix.introSeen';
const INTRO_STEPS = [
  ['users', 'Start a league', 'Make a private league for the NFL, NBA, NHL, MLB, MLS or NLL and send friends the invite link.'],
  ['picks', 'Pick winners', 'Choose the winner of every real game. Each pick locks when its game starts.'],
  ['board', 'Climb the leaderboard', 'One point per correct pick. The site keeps score as results come in.'],
  ['bracket', 'Fill out a bracket', 'Call the playoffs round by round, or simulate them for fun.'],
  ['predict', 'Predict the season', 'Final standings, awards, All-Stars and year-end teams.'],
];

function openIntro() {
  const dlg = document.getElementById('intro-dialog');
  dlg.innerHTML = `
    <button class="icon-btn intro-x" data-close aria-label="Close">${ICON.close}</button>
    <div class="intro-hero"><img src="logo.svg" alt="" width="64" height="64">
      <div><h2 id="intro-title">Welcome to Pick Six</h2><p>A free pick'em and bracket game for you and your friends.</p></div></div>
    <ol class="intro-steps">${INTRO_STEPS.map(([icon, title, text]) => `
      <li><span class="intro-ic">${ICON[icon]}</span><div><strong>${title}</strong><p>${text}</p></div></li>`).join('')}</ol>
    <div class="intro-foot"><a href="#/how" class="link small" data-close>Read the full rules</a>
      <button class="btn" data-close autofocus>Let's go</button></div>`;
  dlg.onclick = (e) => { if (e.target === dlg || e.target.closest('[data-close]')) dlg.close(); };
  dlg.onclose = () => { try { localStorage.setItem(INTRO_KEY, '1'); } catch { /* private mode */ } };
  if (!dlg.open) dlg.showModal();
}

const helpBtn = document.getElementById('help-btn');
if (helpBtn) { helpBtn.innerHTML = ICON.help; helpBtn.onclick = openIntro; }

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
  let seen = true;
  try { seen = !!localStorage.getItem(INTRO_KEY); } catch { /* private mode */ }
  if (!seen) setTimeout(openIntro, 400);
}

boot();
