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
    return { name: 'league', id: parts[1], tab: params.get('tab') || 'picks', week: params.get('week') };
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
      <h1>Pick winners.<br>Talk trash.<br><span class="accent">Climb the board.</span></h1>
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
          <li><strong>Build your own</strong> is always open: choose any playoff teams and seeds (within their real conferences), then fill it out or simulate it. It never counts in the league.</li>
          <li>🎲 <strong>Simulate</strong> plays out the bracket using team records and home advantage. <strong>Title odds</strong> come from thousands of simulated playoffs. It's a simple model, not a prediction you should bet on.</li>
        </ul>
        <p class="muted small">Formats: NFL 7 teams per conference (with a bye and re-seeding), NBA and NHL 8 teams with best-of-7 series
          (the NHL's real division-based pairings are simplified), MLB 6 teams per league with byes for the top two.</p>
      </section>

      <section class="card">
        <h2>Awards</h2>
        <ul>
          <li>The <strong>Awards</strong> tab lets you call the season's winners: MVPs, rookies, top goalies, Cy Youngs, and who makes the All-Star Game or Pro Bowl.</li>
          <li>Search for a player, or type any name. Picks stay hidden until the league owner locks that award.</li>
          <li>The owner enters the real winners when they're announced. One-player awards are worth 3 points, and each correct All-Star or Pro Bowl pick is worth 1.</li>
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
  if (!quiet) app.innerHTML = '<div class="loading">Loading league…</div>';

  const { data: league, error } = await sb.from('leagues').select('*').eq('id', route.id).maybeSingle();
  if (stale()) return;
  if (error || !league) {
    app.innerHTML = `<section class="card narrow"><h2>League not found</h2>
      <p>You may not be a member yet — ask for an invite link.</p><a class="btn" href="#/">Back to your leagues</a></section>`;
    return;
  }

  const [membersRes, gamesRes] = await Promise.all([
    sb.from('league_members').select('user_id, role, profiles(display_name)').eq('league_id', league.id),
    loadGames(league.sport, league.season).then((data) => ({ data }), (error) => ({ data: [], error })),
  ]);
  if (stale()) return;
  const members = (membersRes.data || []).map((m) => ({
    user_id: m.user_id, role: m.role, name: m.profiles?.display_name || 'Player',
  }));
  const games = gamesRes.data || [];
  app.classList.toggle('wide', route.tab === 'bracket');

  const head = `
    <section class="league-head">
      <a href="#/" class="link small">← All leagues</a>
      <div class="league-title-row">
        <h1>${esc(league.name)}</h1>
        <div class="row">
          <button class="btn small ghost" id="manage-btn">Manage</button>
          <button class="btn small secondary" id="invite-btn">Invite friends</button>
        </div>
      </div>
      <p class="muted small"><span class="sport-tag">${esc(sportInfo(league.sport).name)}</span> ${members.length} player${members.length === 1 ? '' : 's'}
        · code <strong class="mono">${esc(league.invite_code)}</strong></p>
      <div class="tabs" role="tablist">
        <a role="tab" href="#/league/${league.id}" class="${route.tab === 'picks' ? 'active' : ''}">Picks</a>
        <a role="tab" href="#/league/${league.id}?tab=standings" class="${route.tab === 'standings' ? 'active' : ''}">Standings</a>
        <a role="tab" href="#/league/${league.id}?tab=bracket" class="${route.tab === 'bracket' ? 'active' : ''}">Bracket</a>
        <a role="tab" href="#/league/${league.id}?tab=awards" class="${route.tab === 'awards' ? 'active' : ''}">Awards</a>
      </div>
    </section>`;

  let body;
  if (route.tab === 'standings') body = await standingsHtml(league, members, games);
  else if (route.tab === 'bracket') body = '<div id="bracket-root"><div class="loading">Loading bracket…</div></div>';
  else if (route.tab === 'awards') body = '<div id="awards-root"><div class="loading">Loading awards…</div></div>';
  else body = await picksHtml(league, members, games, route);
  if (stale()) return;

  app.innerHTML = head + body;
  state.league = league;

  const sel = document.getElementById('week-select');
  if (sel) sel.onchange = () => go(`#/league/${league.id}?week=${sel.value}`);

  if (route.tab === 'bracket') {
    await mountBracket(league, members, games, stale);
    return; // no auto-refresh here, so a simulation isn't wiped mid-look
  }
  if (route.tab === 'awards') {
    await mountAwards(league, members, stale);
    return;
  }

  document.getElementById('manage-btn').onclick = () => openManage(league, members);
  document.getElementById('invite-btn').onclick = async () => {
    const link = inviteLink(league.invite_code);
    const text = `Join my Pick Six league "${league.name}": ${link}`;
    if (navigator.share) {
      try { await navigator.share({ title: 'Pick Six', text, url: link }); return; } catch { /* fall back to copy */ }
    }
    try { await navigator.clipboard.writeText(link); toast('Invite link copied — paste it in your group chat', 'good'); }
    catch { toast(link); }
  };

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
    league.name = name;
    toast('League renamed', 'good');
    dialog.close();
    render();
  };

  draw();
  dialog.showModal();
}

// ----- Awards tab -----

// Award questions per sport. count = how many players you pick. One-player awards are worth
// 3 points; for multi-pick questions (All-Stars, Pro Bowl) each correct player is worth 1.
const AWARDS = {
  nfl: [
    { id: 'mvp', title: 'MVP', note: 'Most Valuable Player', count: 1 },
    { id: 'opoy', title: 'Offensive Player of the Year', count: 1 },
    { id: 'dpoy', title: 'Defensive Player of the Year', count: 1 },
    { id: 'oroy', title: 'Offensive Rookie of the Year', count: 1 },
    { id: 'droy', title: 'Defensive Rookie of the Year', count: 1 },
    { id: 'cpoy', title: 'Comeback Player of the Year', count: 1 },
    { id: 'sbmvp', title: 'Super Bowl MVP', count: 1 },
    { id: 'probowl', title: 'Pro Bowl', note: 'Pick 5 players who make the Pro Bowl', count: 5 },
  ],
  nba: [
    { id: 'mvp', title: 'MVP', note: 'Most Valuable Player', count: 1 },
    { id: 'roy', title: 'Rookie of the Year', count: 1 },
    { id: 'dpoy', title: 'Defensive Player of the Year', count: 1 },
    { id: 'smoy', title: 'Sixth Man of the Year', count: 1 },
    { id: 'mip', title: 'Most Improved Player', count: 1 },
    { id: 'clutch', title: 'Clutch Player of the Year', count: 1 },
    { id: 'fmvp', title: 'Finals MVP', count: 1 },
    { id: 'allstar', title: 'All-Stars', note: 'Pick 5 players who make the All-Star Game', count: 5 },
  ],
  nhl: [
    { id: 'hart', title: 'Hart Trophy', note: 'MVP', count: 1 },
    { id: 'vezina', title: 'Vezina Trophy', note: 'Best goalie', count: 1 },
    { id: 'norris', title: 'Norris Trophy', note: 'Best defenceman', count: 1 },
    { id: 'calder', title: 'Calder Trophy', note: 'Rookie of the year', count: 1 },
    { id: 'rocket', title: 'Rocket Richard Trophy', note: 'Most goals', count: 1 },
    { id: 'connsmythe', title: 'Conn Smythe Trophy', note: 'Playoff MVP', count: 1 },
    { id: 'allstar', title: 'All-Stars', note: 'Pick 5 players who make the All-Star Game', count: 5 },
  ],
  mlb: [
    { id: 'almvp', title: 'AL MVP', count: 1 },
    { id: 'nlmvp', title: 'NL MVP', count: 1 },
    { id: 'alcy', title: 'AL Cy Young', count: 1 },
    { id: 'nlcy', title: 'NL Cy Young', count: 1 },
    { id: 'alroy', title: 'AL Rookie of the Year', count: 1 },
    { id: 'nlroy', title: 'NL Rookie of the Year', count: 1 },
    { id: 'wsmvp', title: 'World Series MVP', count: 1 },
    { id: 'allstar', title: 'All-Stars', note: 'Pick 5 players who make the All-Star Game', count: 5 },
  ],
};
const awardPoints = (q) => (q.count === 1 ? 3 : 1);

async function loadPlayers(sport) {
  const all = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('players').select('id, name, team_abbr, position, headshot')
      .eq('sport', sport).order('name').range(from, from + 999);
    if (error || !data) break;
    all.push(...data);
    if (data.length < 1000) break;
  }
  return all;
}

// Points per player from the questions that have results.
function scoreAwards(questions, picksByUser, settings) {
  const totals = new Map();
  for (const q of questions) {
    const answers = new Set(settings.get(q.qid)?.answers || []);
    if (!answers.size) continue;
    for (const [userId, picks] of picksByUser) {
      const mine = picks.get(q.qid) || [];
      const hits = mine.filter((p) => answers.has(p)).length;
      const t = totals.get(userId) || { points: 0, correct: 0 };
      t.points += hits * awardPoints(q);
      t.correct += hits;
      totals.set(userId, t);
    }
  }
  return totals;
}

async function mountAwards(league, members, stale) {
  const root = document.getElementById('awards-root');
  const me = state.session.user.id;
  const isOwner = league.created_by === me;
  const sport = league.sport;
  const questions = (AWARDS[sport] || []).map((q) => ({ ...q, qid: `${sport}:${q.id}` }));

  const [players, picksRes, settingsRes] = await Promise.all([
    loadPlayers(sport),
    sb.from('award_picks').select('user_id, question_id, players').eq('league_id', league.id),
    sb.from('award_settings').select('question_id, locked_at, answers').eq('league_id', league.id),
  ]);
  if (stale()) return;
  if (picksRes.error?.code === '42P01' || settingsRes.error?.code === '42P01') {
    root.innerHTML = `<div class="empty card"><p><strong>Awards need a database update.</strong> Re-run supabase/schema.sql.</p></div>`;
    return;
  }

  const playerById = new Map(players.map((p) => [p.id, p]));
  const picksByUser = new Map(); // user → (qid → [ids])
  for (const row of picksRes.data || []) {
    if (!picksByUser.has(row.user_id)) picksByUser.set(row.user_id, new Map());
    picksByUser.get(row.user_id).set(row.question_id, row.players || []);
  }
  if (!picksByUser.has(me)) picksByUser.set(me, new Map());
  const settings = new Map((settingsRes.data || []).map((r) => [r.question_id, r]));

  const isOpen = (q) => { const l = settings.get(q.qid)?.locked_at; return !l || new Date(l) > new Date(); };
  const answersOf = (q) => settings.get(q.qid)?.answers || [];
  const myPicks = (q) => picksByUser.get(me).get(q.qid) || [];
  let resultsFor = null; // qid the owner is entering results for

  const playerInfo = (id) => (id.startsWith('custom:')
    ? { name: id.slice(7), team_abbr: '', position: '', headshot: null }
    : playerById.get(id) || { name: 'Unknown player', team_abbr: '', position: '' });
  const chip = (id, { removable = false, kind = 'pick', qid = '', correct = null } = {}) => {
    const p = playerInfo(id);
    return `<span class="player-chip ${correct === true ? 'correct' : correct === false ? 'wrong' : ''}">
      ${p.headshot ? `<img src="${esc(p.headshot)}" alt="" width="26" height="26" loading="lazy">` : '<span class="avatar">' + esc(p.name.slice(0, 1)) + '</span>'}
      <span><strong>${esc(p.name)}</strong>${p.team_abbr ? `<span class="muted small">${esc(p.team_abbr)}${p.position ? ` · ${esc(p.position)}` : ''}</span>` : ''}</span>
      ${removable ? `<button class="chip-x" data-remove-${kind}="${esc(id)}" data-q="${qid}" aria-label="Remove ${esc(p.name)}">×</button>` : ''}
    </span>`;
  };
  const searchBox = (q, kind) => `
    <div class="player-search">
      <input type="search" data-search="${kind}" data-q="${q.qid}" placeholder="${players.length ? 'Search players…' : 'Type a player name…'}"
             autocomplete="off" aria-label="Search players for ${esc(q.title)}">
      <div class="search-results" role="listbox" id="results-${kind}-${q.qid.replace(':', '-')}"></div>
    </div>`;

  const save = async (q, list) => {
    picksByUser.get(me).set(q.qid, list);
    draw();
    const res = list.length
      ? await sb.from('award_picks').upsert({ league_id: league.id, user_id: me, question_id: q.qid, players: list },
        { onConflict: 'league_id,user_id,question_id' })
      : await sb.from('award_picks').delete().eq('league_id', league.id).eq('user_id', me).eq('question_id', q.qid);
    if (res.error) { toast(friendlyError(res.error).replace('That game has already kicked off', 'This award is locked'), 'error'); }
  };
  const saveSettings = async (q, patch) => {
    const cur = settings.get(q.qid) || { question_id: q.qid, locked_at: null, answers: null };
    const next = { ...cur, ...patch };
    const { error } = await sb.from('award_settings').upsert({
      league_id: league.id, question_id: q.qid, locked_at: next.locked_at, answers: next.answers, updated_at: new Date().toISOString(),
    }, { onConflict: 'league_id,question_id' });
    if (error) return toast(friendlyError(error), 'error');
    settings.set(q.qid, next);
    // Locking reveals everyone's picks, so reload them.
    if ('locked_at' in patch) {
      const { data } = await sb.from('award_picks').select('user_id, question_id, players').eq('league_id', league.id);
      for (const row of data || []) {
        if (!picksByUser.has(row.user_id)) picksByUser.set(row.user_id, new Map());
        picksByUser.get(row.user_id).set(row.question_id, row.players || []);
      }
    }
    draw();
  };

  const card = (q) => {
    const open = isOpen(q);
    const answers = answersOf(q);
    const mine = myPicks(q);
    const status = answers.length ? '<span class="status-pill done">Results in</span>'
      : open ? '<span class="status-pill open">Open</span>' : '<span class="status-pill locked">🔒 Locked</span>';
    const verdict = (id) => (answers.length ? answers.includes(id) : null);
    const everyone = !open ? members.map((m) => {
      const list = picksByUser.get(m.user_id)?.get(q.qid) || [];
      return `<li><span class="who">${esc(m.name)}</span>
        <span class="chips">${list.length ? list.map((id) => chip(id, { correct: verdict(id) })).join('') : '<span class="muted small">no pick</span>'}</span></li>`;
    }).join('') : '';
    return `
      <article class="card award ${answers.length ? 'has-results' : ''}">
        <div class="award-head">
          <div><h3>${esc(q.title)}</h3><p class="muted small">${esc(q.note || '')}${q.note ? ' · ' : ''}${q.count === 1 ? 'Pick 1 · 3 pts' : `Pick ${q.count} · 1 pt each`}</p></div>
          ${status}
        </div>
        ${answers.length ? `<div class="answers"><span class="muted small">Winner${answers.length > 1 ? 's' : ''}:</span> ${answers.map((id) => chip(id, { removable: isOwner && resultsFor === q.qid, kind: 'answer', qid: q.qid })).join('')}</div>` : ''}
        ${open ? `
          <div class="my-picks">
            <div class="chips">${mine.map((id) => chip(id, { removable: true, qid: q.qid })).join('') || '<span class="muted small">No pick yet</span>'}</div>
            ${mine.length < q.count ? searchBox(q, 'pick') : ''}
          </div>` : `
          <ul class="everyone">${everyone}</ul>`}
        ${isOwner ? `
          <div class="owner-tools">
            ${open ? `<button class="btn small ghost" data-lock="${q.qid}">🔒 Lock picks</button>`
              : `<button class="btn small ghost" data-unlock="${q.qid}">Reopen picks</button>`}
            <button class="btn small ghost" data-results="${q.qid}">${resultsFor === q.qid ? 'Done entering results' : answers.length ? 'Edit results' : 'Enter results'}</button>
          </div>
          ${resultsFor === q.qid ? `<div class="results-entry"><p class="muted small">Add the real winner${q.count > 1 ? 's' : ''}. This locks the question and scores it.</p>${searchBox(q, 'answer')}</div>` : ''}` : ''}
      </article>`;
  };

  const leaderboard = () => {
    const totals = scoreAwards(questions, picksByUser, settings);
    if (!totals.size) return '';
    const rows = members.map((m) => ({ m, t: totals.get(m.user_id) || { points: 0, correct: 0 } }))
      .sort((a, b) => b.t.points - a.t.points || a.m.name.localeCompare(b.m.name));
    return `
      <section class="card flush">
        <table class="standings">
          <thead><tr><th>Player</th><th class="num">Correct</th><th class="num">Award pts</th></tr></thead>
          <tbody>${rows.map(({ m, t }) => `<tr class="${m.user_id === me ? 'me' : ''}"><td class="player">${esc(m.name)}</td>
            <td class="num">${t.correct}</td><td class="num strong">${t.points}</td></tr>`).join('')}</tbody>
        </table>
      </section>`;
  };

  const draw = () => {
    root.innerHTML = `
      <div class="banner"><strong>🏅 Awards.</strong> Call the season's big winners. Your picks stay hidden until
        ${isOwner ? 'you lock' : 'the league owner locks'} each award, then everyone's are shown.
        ${isOwner ? 'As the owner, lock each award before it’s announced and enter the winners. The real results aren’t loaded automatically.' : ''}
        ${players.length ? '' : '<br><span class="muted small">The player list loads with the daily sync; until then, type names in yourself.</span>'}</div>
      ${leaderboard()}
      <div class="awards">${questions.map(card).join('')}</div>`;
  };

  const showResults = (input) => {
    const box = input.parentElement.querySelector('.search-results');
    const q = questions.find((x) => x.qid === input.dataset.q);
    const kind = input.dataset.search;
    const term = input.value.trim().toLowerCase();
    if (!term) { box.innerHTML = ''; return; }
    const taken = new Set(kind === 'answer' ? answersOf(q) : myPicks(q));
    const matches = players.filter((p) => !taken.has(p.id) && p.name.toLowerCase().includes(term))
      .sort((a, b) => (a.name.toLowerCase().startsWith(term) ? 0 : 1) - (b.name.toLowerCase().startsWith(term) ? 0 : 1))
      .slice(0, 8);
    const exact = players.some((p) => p.name.toLowerCase() === term);
    box.innerHTML = matches.map((p) => `
      <button class="result" role="option" data-add-${kind}="${esc(p.id)}" data-q="${q.qid}">
        ${p.headshot ? `<img src="${esc(p.headshot)}" alt="" width="28" height="28" loading="lazy">` : '<span class="avatar">' + esc(p.name.slice(0, 1)) + '</span>'}
        <span><strong>${esc(p.name)}</strong> <span class="muted small">${esc(p.team_abbr || '')}${p.position ? ` · ${esc(p.position)}` : ''}</span></span>
      </button>`).join('')
      + (!exact ? `<button class="result custom" role="option" data-add-${kind}="custom:${esc(input.value.trim())}" data-q="${q.qid}">
          Use “${esc(input.value.trim())}”</button>` : '');
  };

  root.oninput = (e) => { if (e.target.matches('[data-search]')) showResults(e.target); };
  root.onclick = async (e) => {
    const t = (sel) => e.target.closest(sel);
    let el;
    const qOf = (node) => questions.find((x) => x.qid === node.dataset.q);
    if ((el = t('[data-add-pick]'))) {
      const q = qOf(el);
      if (myPicks(q).length < q.count) await save(q, [...myPicks(q), el.dataset.addPick]);
      root.querySelector(`[data-search="pick"][data-q="${q.qid}"]`)?.focus();
    } else if ((el = t('[data-remove-pick]'))) {
      const q = qOf(el);
      await save(q, myPicks(q).filter((id) => id !== el.dataset.removePick));
    } else if ((el = t('[data-add-answer]'))) {
      const q = qOf(el);
      const answers = [...answersOf(q), el.dataset.addAnswer].slice(0, q.count);
      await saveSettings(q, { answers, locked_at: settings.get(q.qid)?.locked_at || new Date().toISOString() });
      root.querySelector(`[data-search="answer"][data-q="${q.qid}"]`)?.focus();
    } else if ((el = t('[data-remove-answer]'))) {
      const q = qOf(el);
      const answers = answersOf(q).filter((id) => id !== el.dataset.removeAnswer);
      await saveSettings(q, { answers: answers.length ? answers : null });
    } else if ((el = t('[data-lock]'))) {
      await saveSettings(questions.find((x) => x.qid === el.dataset.lock), { locked_at: new Date().toISOString() });
    } else if ((el = t('[data-unlock]'))) {
      await saveSettings(questions.find((x) => x.qid === el.dataset.unlock), { locked_at: null });
    } else if ((el = t('[data-results]'))) {
      resultsFor = resultsFor === el.dataset.results ? null : el.dataset.results;
      draw();
    }
  };

  draw();
}

// ----- Bracket tab -----

const pct = (x) => (x >= 0.995 ? '>99%' : x < 0.005 ? (x > 0 ? '<1%' : '—') : `${Math.round(x * 100)}%`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lsGet = (k, fallback) => { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };

// Every team that appears in the loaded games, with its latest record.
function teamsFromGames(games) {
  const teams = new Map();
  const parse = (rec) => {
    const [w, l, t] = String(rec || '').split('-').map((n) => parseInt(n, 10));
    return { wins: w || 0, losses: l || 0, ties: t || 0 };
  };
  for (const g of games) { // games are in start order, so later records win
    for (const side of ['home', 'away']) {
      const abbr = g[`${side}_abbr`];
      if (!abbr) continue;
      const prev = teams.get(abbr) || {};
      const rec = g[`${side}_record`] ? parse(g[`${side}_record`]) : null;
      teams.set(abbr, {
        abbr, team_name: g[`${side}_team`] || abbr, logo: g[`${side}_logo`] || prev.logo || null,
        ...(rec || { wins: prev.wins || 0, losses: prev.losses || 0, ties: prev.ties || 0 }),
      });
    }
  }
  return [...teams.values()].sort((a, b) => a.team_name.localeCompare(b.team_name));
}

async function mountBracket(league, members, games, stale) {
  const root = document.getElementById('bracket-root');
  const me = state.session.user.id;
  const sport = league.sport;
  const F = BR.formatOf(sport);
  const [c0, c1] = F.conferences;
  const total = BR.totalGames(sport);

  const [seedRes, stateRes, picksRes, teamsRes] = await Promise.all([
    sb.from('playoff_seeds').select('*').eq('sport', sport).eq('season', league.season),
    sb.rpc('bracket_state', { p_league: league.id }),
    sb.from('bracket_picks').select('user_id, picks').eq('league_id', league.id),
    sb.from('teams').select('*').eq('sport', sport),
  ]);
  if (stale()) return;

  const officialSeeds = BR.seedsByConference(seedRes.data, sport);
  const haveSeeds = BR.isComplete(officialSeeds, sport);
  // Teams for "Build your own": the teams table knows every team's conference.
  const teamRows = (teamsRes.data || []).map((t) => ({ ...t, team_name: t.name }));
  const allTeams = teamRows.length ? teamRows : teamsFromGames(games);
  for (const c of F.conferences) {
    for (const t of officialSeeds[c] || []) {
      if (!allTeams.some((x) => x.abbr === t.abbr)) allTeams.push({ ...t, conference: c });
    }
  }
  const teamByAbbr = new Map(allTeams.map((t) => [t.abbr, t]));
  const knowsConferences = teamRows.length > 0;
  // A conference's teams, best record first.
  const confTeams = (c) => allTeams.filter((t) => !knowsConferences || t.conference === c)
    .sort((a, b) => BR.strength(b) - BR.strength(a) || a.team_name.localeCompare(b.team_name));
  const bstate = stateRes.data || 'not_ready'; // not_ready | open | locked
  const brackets = picksRes.data || [];

  // ----- league bracket (practice before the season ends, then official) -----
  const practiceKey = `pickSix.practiceBracket.${league.id}`;
  let leaguePicks = bstate === 'not_ready'
    ? lsGet(practiceKey, {})
    : (brackets.find((b) => b.user_id === me)?.picks || {});
  if (haveSeeds) leaguePicks = BR.cleanPicks(sport, officialSeeds, leaguePicks);

  // ----- just-for-fun bracket: any teams you like, saved on this device -----
  const funKey = `pickSix.funBracket.${sport}`;
  const defaultField = () => {
    if (haveSeeds) return Object.fromEntries(F.conferences.map((c) => [c, officialSeeds[c].map((t) => t.abbr)]));
    if (knowsConferences) return Object.fromEntries(F.conferences.map((c) => [c, confTeams(c).slice(0, F.teams).map((t) => t.abbr)]));
    const best = [...allTeams].sort((a, b) => BR.strength(b) - BR.strength(a)).slice(0, F.teams * 2);
    return Object.fromEntries(F.conferences.map((c, ci) => [c, best.filter((_, i) => i % 2 === ci).map((t) => t.abbr)]));
  };
  let fun = lsGet(funKey, null) || { field: defaultField(), picks: {} };
  // Throw away a saved field with teams in the wrong conference (older versions allowed that).
  if (knowsConferences && F.conferences.some((c) => (fun.field?.[c] || []).length !== F.teams
    || fun.field[c].some((abbr) => teamByAbbr.get(abbr)?.conference !== c))) {
    fun = { field: defaultField(), picks: {} };
  }
  const funSeeds = () => Object.fromEntries(F.conferences.map((c) => [c, (fun.field[c] || [])
    .map((abbr, i) => ({ ...(teamByAbbr.get(abbr) || officialSeeds[c]?.find((t) => t.abbr === abbr) || { abbr, team_name: abbr, wins: 0, losses: 0, ties: 0 }), seed: i + 1 }))]));
  const funReady = () => BR.isComplete(funSeeds(), sport);

  let mode = haveSeeds ? 'league' : 'fun';
  let editingField = false;
  let activeSlot = null; // "East:3" while choosing a team for that seed
  let busy = false;
  let saveTimer;
  let saveNote = '';
  let oddsCache = { sig: '', rows: [] };

  const seeds = () => (mode === 'fun' ? funSeeds() : officialSeeds);
  const getPicks = () => (mode === 'fun' ? fun.picks : leaguePicks);
  const editable = () => mode === 'fun' || bstate !== 'locked';

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
    if (mode === 'fun') { fun.picks = clean; lsSet(funKey, fun); return; }
    leaguePicks = clean;
    if (bstate === 'not_ready') { lsSet(practiceKey, leaguePicks); return; }
    if (bstate !== 'open') return;
    saveNote = 'Saving…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const { error } = await sb.from('bracket_picks').upsert(
        { league_id: league.id, user_id: me, picks: leaguePicks },
        { onConflict: 'league_id,user_id' },
      );
      saveNote = error ? '' : 'Saved ✓';
      if (error) toast(friendlyError(error), 'error');
      const el = root.querySelector('.save-note');
      if (el) el.textContent = saveNote;
    }, 500);
  };

  const oddsRows = () => {
    const s = seeds();
    const sig = JSON.stringify(F.conferences.map((c) => s[c].map((t) => t.abbr)));
    if (oddsCache.sig !== sig) oddsCache = { sig, rows: BR.odds(sport, s, 6000) };
    return oddsCache.rows;
  };

  // ----- rendering -----
  const teamRow = (g, side) => {
    const t = g[side];
    if (!t) return '<div class="bt tbd">TBD</div>';
    const other = side === 'home' ? g.away : g.home;
    const pHome = other ? BR.winProb(g.home, g.away, g.neutral, g.bestOf) : null;
    const p = pHome === null ? null : side === 'home' ? pHome : 1 - pHome;
    const picked = g.winner?.abbr === t.abbr;
    let result = '';
    if (mode === 'league') {
      if (picked && realWinners.has(`${g.round}:${t.abbr}`)) result = 'correct';
      else if (picked && eliminated.has(t.abbr)) result = 'wrong';
    }
    const out = mode === 'league' && eliminated.has(t.abbr) ? 'out' : '';
    return `
      <button class="bt ${picked ? 'picked' : ''} ${result} ${out}" data-slot="${g.slot}" data-team="${esc(t.abbr)}"
              ${editable() && other && !busy ? '' : 'disabled'} aria-pressed="${picked}"
              title="${esc(t.team_name)} (${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ''})">
        <span class="seed">${t.seed}</span>
        ${t.logo ? `<img src="${esc(t.logo)}" alt="" width="20" height="20" loading="lazy">` : ''}
        <span class="abbr">${esc(t.abbr)}</span>
        ${p !== null ? `<span class="prob">${pct(p)}</span>` : ''}
      </button>`;
  };
  const matchup = (g) => `
    <div class="bm ${g.winner ? 'done' : ''}">${teamRow(g, 'home')}${teamRow(g, 'away')}</div>`;
  const roundLabel = (i, name = F.rounds[i]) => `<div class="round-label">${esc(name)}${F.bestOf[i] > 1
    ? `<span class="bo-tag">Best of ${F.bestOf[i]}</span>` : ''}</div>`;
  const byeCards = (b) => b.byes.map((t) => `<div class="bye"><span class="seed">${t.seed}</span> ${esc(t.abbr)} <span class="muted">bye</span></div>`).join('');

  const bracketHtml = () => {
    const s = seeds();
    const b = BR.buildBracket(sport, s, getPicks());
    const champ = b.F.winner;
    const champOdds = champ ? oddsRows().find((r) => r.team.abbr === champ.abbr)?.champ : null;
    const col = (cls, inner) => `<div class="round ${cls}">${inner}</div>`;
    return `
      <div class="bracket-scroll" tabindex="0" aria-label="Playoff bracket (scrolls sideways)">
        <div class="bracket-full">
          <div class="bf-conf left">${c0}</div>
          <div class="bf-conf center">${esc(F.rounds[3])}</div>
          <div class="bf-conf right">${c1}</div>
          ${[0, 1, 2].map((i) => roundLabel(i)).join('')}
          ${roundLabel(3, 'Final')}
          ${[2, 1, 0].map((i) => roundLabel(i)).join('')}
          ${col('', byeCards(b[c0]) + b[c0].r1.map(matchup).join(''))}
          ${col('', b[c0].r2.map(matchup).join(''))}
          ${col('', matchup(b[c0].r3))}
          ${col('final-col', `
            ${matchup(b.F)}
            <div class="champion ${champ ? 'crowned' : ''}">
              ${champ ? `<span class="trophy" aria-hidden="true">🏆</span>
                <span class="champ-name">${esc(champ.team_name)}</span>
                <span class="muted small">${pct(champOdds ?? 0)} title odds</span>`
                : '<span class="muted small">Pick a champion</span>'}
            </div>`)}
          ${col('', matchup(b[c1].r3))}
          ${col('', b[c1].r2.map(matchup).join(''))}
          ${col('', byeCards(b[c1]) + b[c1].r1.map(matchup).join(''))}
        </div>
      </div>`;
  };

  const recordOf = (t) => (t ? `${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ''}` : '');
  const fieldEditorHtml = () => {
    if (!editingField) return '';
    const slot = (c, i) => {
      const t = teamByAbbr.get(fun.field[c][i]);
      const active = activeSlot === `${c}:${i}`;
      return `
        <button class="seed-slot ${active ? 'active' : ''}" data-slot-edit="${c}:${i}" aria-expanded="${active}"
                aria-label="${c} seed ${i + 1}: ${esc(t?.team_name || 'empty')}. Change team">
          <span class="seed-num">${i + 1}</span>
          ${t?.logo ? `<img src="${esc(t.logo)}" alt="" width="28" height="28" loading="lazy">` : '<span class="logo-dot"></span>'}
          <span class="slot-name"><strong>${esc(t?.abbr || '—')}</strong><span class="muted small">${esc(t?.team_name || '')}</span></span>
          <span class="muted small rec">${recordOf(t)}</span>
        </button>`;
    };
    const chooser = (c) => {
      if (!activeSlot || !activeSlot.startsWith(`${c}:`)) return '';
      const idx = Number(activeSlot.split(':')[1]);
      return `
        <div class="team-chooser" role="listbox" aria-label="Choose a team for ${c} seed ${idx + 1}">
          <p class="muted small">Seed ${idx + 1}: pick a team. Teams already in the bracket swap places.</p>
          <div class="team-grid">
            ${confTeams(c).map((t) => {
              const at = fun.field[c].indexOf(t.abbr);
              return `<button class="team-chip ${at === idx ? 'current' : ''}" role="option" aria-selected="${at === idx}" data-assign="${esc(t.abbr)}">
                ${t.logo ? `<img src="${esc(t.logo)}" alt="" width="24" height="24" loading="lazy">` : ''}
                <span><strong>${esc(t.abbr)}</strong><span class="muted small">${recordOf(t)}</span></span>
                ${at >= 0 ? `<span class="in-seed">#${at + 1}</span>` : ''}
              </button>`;
            }).join('')}
          </div>
        </div>`;
    };
    return `
      <section class="card field-editor">
        <div class="row between"><h2>Choose the playoff teams</h2>
          <button class="btn small" data-action="done-field">Done</button></div>
        ${knowsConferences ? '' : '<p class="muted small">Conferences will be checked once the next sync loads every team.</p>'}
        <div class="field-cols">
          ${F.conferences.map((c) => `
            <div class="field-conf">
              <h3 class="conf-name">${c}</h3>
              <div class="seed-list">${(fun.field[c] || []).map((_, i) => slot(c, i)).join('')}</div>
              ${chooser(c)}
            </div>`).join('')}
        </div>
        <div class="row end"><button class="btn ghost small" data-action="reset-field">Reset to ${haveSeeds ? 'real seeds' : 'best records'}</button></div>
      </section>`;
  };

  const banner = () => {
    const n = BR.pickCount(sport, seeds(), getPicks());
    if (mode === 'fun') {
      return `<div class="banner fun"><strong>🛠 Build your own.</strong> Pick any playoff teams and seeds, then play it out.
        Saved on this device. It doesn't count in your league. ${n}/${total} picked.</div>`;
    }
    if (bstate === 'not_ready') {
      return `<div class="banner"><strong>🔮 Projected bracket.</strong> Seeds are based on today's standings and change as the season goes.
        This practice bracket is saved on this device. Real brackets open when the regular season ends.</div>`;
    }
    if (bstate === 'open') {
      return `<div class="banner open"><strong>Brackets are open!</strong> ${n}/${total} picked.
        ${firstKick ? `Locks when the playoffs start: ${fmtKickoff(firstKick)} (${fmtCountdown(firstKick)}).` : 'Locks when the playoffs start.'}
        <span class="save-note">${saveNote}</span></div>`;
    }
    return `<div class="banner locked"><strong>🔒 Brackets are locked.</strong> Points per correct winner:
      ${F.rounds.map((r, i) => `${esc(r)} ${BR.ROUND_POINTS[BR.ROUND_KEYS[i]]}`).join(' · ')}.</div>`;
  };

  const standingsHtmlB = () => {
    if (mode !== 'league' || bstate !== 'locked') return '';
    const rows = members.map((m) => {
      const bp = brackets.find((b) => b.user_id === m.user_id)?.picks;
      const sc = bp ? BR.scoreBracket(sport, officialSeeds, bp, results) : null;
      return { m, sc, champ: bp?.F };
    }).sort((a, b) => (b.sc?.points ?? -1) - (a.sc?.points ?? -1) || (b.sc?.possible ?? -1) - (a.sc?.possible ?? -1));
    return `
      <section class="card flush">
        <table class="standings">
          <thead><tr><th>Player</th><th class="num">Pts</th><th class="num">Max</th><th>Champion</th></tr></thead>
          <tbody>${rows.map(({ m, sc, champ }) => `
            <tr class="${m.user_id === me ? 'me' : ''}">
              <td class="player">${esc(m.name)}</td>
              <td class="num strong">${sc ? sc.points : '—'}</td>
              <td class="num">${sc ? sc.possible : '—'}</td>
              <td>${champ ? `<span class="${eliminated.has(champ) ? 'struck' : ''}">${esc(champ)}</span>` : '<span class="muted">no bracket</span>'}</td>
            </tr>`).join('')}</tbody>
        </table>
      </section>`;
  };

  const oddsHtml = () => {
    const rows = oddsRows();
    const top = rows[0]?.champ || 1;
    return `
      <section class="card">
        <h2>Title odds</h2>
        <p class="muted small">From thousands of simulated playoffs using each team's record and home advantage${F.bestOf[0] > 1 ? ', played as full series' : ''}.
          It's a simple model. Your game predictor could replace it later.</p>
        <div class="odds-wrap"><table class="odds">
          <thead><tr><th>Team</th><th class="num">${esc(F.rounds[1])}</th><th class="num">${esc(F.rounds[2])}</th><th class="num">${esc(F.rounds[3])}</th><th class="num">Champion</th></tr></thead>
          <tbody>${rows.map((r) => `
            <tr>
              <td><span class="seed">${r.team.seed}</span> <strong>${esc(r.team.abbr)}</strong> <span class="muted small">${esc(r.conference)}</span></td>
              <td class="num">${pct(r.r2)}</td><td class="num">${pct(r.r3)}</td><td class="num">${pct(r.final)}</td>
              <td class="num"><span class="bar" style="--w:${Math.round((r.champ * 100) / top)}%"></span><strong>${pct(r.champ)}</strong></td>
            </tr>`).join('')}</tbody>
        </table></div>
      </section>`;
  };

  const draw = () => {
    if (mode === 'fun' && !funReady()) {
      root.innerHTML = `<div class="empty card"><p><strong>No ${sportInfo(sport).name} teams loaded yet.</strong>
        Brackets appear once the schedule has synced.</p></div>`;
      return;
    }
    const n = BR.pickCount(sport, seeds(), getPicks());
    const simLabel = n === total ? '🎲 Re-simulate' : n ? '🎲 Simulate the rest' : '🎲 Simulate';
    root.innerHTML = `
      <div class="mode-switch" role="tablist" aria-label="Bracket type">
        <button role="tab" data-mode="league" aria-selected="${mode === 'league'}" class="${mode === 'league' ? 'active' : ''}" ${haveSeeds ? '' : 'disabled title="Playoff seeds haven\'t loaded yet"'}>League bracket</button>
        <button role="tab" data-mode="fun" aria-selected="${mode === 'fun'}" class="${mode === 'fun' ? 'active' : ''}">Build your own</button>
      </div>
      ${banner()}
      ${editable() ? `
        <div class="bracket-controls">
          <button class="btn sim" data-action="simulate" ${busy ? 'disabled' : ''}>${simLabel}</button>
          <button class="btn secondary" data-action="favorites" ${busy ? 'disabled' : ''}>Pick favorites</button>
          <button class="btn ghost" data-action="clear" ${busy || !n ? 'disabled' : ''}>Clear</button>
          ${mode === 'fun' ? `<button class="btn ghost" data-action="edit-field" ${busy ? 'disabled' : ''}>${editingField ? 'Hide teams' : '✎ Choose teams'}</button>` : ''}
        </div>` : ''}
      ${fieldEditorHtml()}
      ${standingsHtmlB()}
      ${bracketHtml()}
      ${oddsHtml()}`;
  };

  // Reveal a simulated bracket one round at a time.
  const animateTo = async (target) => {
    busy = true;
    const p = { ...getPicks() };
    for (const r of BR.ROUND_KEYS) {
      for (const [slot, abbr] of Object.entries(target)) if (BR.roundOf(slot) === r) p[slot] = abbr;
      setPicks(p);
      draw();
      await sleep(360);
    }
    busy = false;
    draw();
  };

  root.onclick = (e) => {
    if (busy) return;
    const team = e.target.closest('[data-slot]');
    if (team && !team.disabled) {
      setPicks({ ...getPicks(), [team.dataset.slot]: team.dataset.team });
      draw();
      return;
    }
    const slotBtn = e.target.closest('[data-slot-edit]');
    if (slotBtn) {
      activeSlot = activeSlot === slotBtn.dataset.slotEdit ? null : slotBtn.dataset.slotEdit;
      draw();
      return;
    }
    const assign = e.target.closest('[data-assign]');
    if (assign && activeSlot) {
      const [conf, idxStr] = activeSlot.split(':');
      const idx = Number(idxStr);
      const abbr = assign.dataset.assign;
      const j = fun.field[conf].indexOf(abbr);
      if (j >= 0) fun.field[conf][j] = fun.field[conf][idx]; // swap places
      fun.field[conf][idx] = abbr;
      fun.picks = BR.cleanPicks(sport, funSeeds(), fun.picks);
      lsSet(funKey, fun);
      oddsCache = { sig: '', rows: [] };
      activeSlot = null;
      draw();
      return;
    }
    const modeBtn = e.target.closest('[data-mode]');
    if (modeBtn && !modeBtn.disabled) { mode = modeBtn.dataset.mode; editingField = false; draw(); return; }
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    const full = BR.pickCount(sport, seeds(), getPicks()) === total;
    if (action === 'simulate' || action === 'favorites') {
      if (full) setPicks({}); // full bracket → start over
      const base = getPicks();
      animateTo(action === 'simulate' ? BR.simulate(sport, seeds(), base) : BR.favorites(sport, seeds(), base));
    } else if (action === 'clear') {
      setPicks({}); draw();
    } else if (action === 'edit-field') {
      editingField = !editingField; activeSlot = null; draw();
    } else if (action === 'done-field') {
      editingField = false; activeSlot = null; draw();
    } else if (action === 'reset-field') {
      fun.field = defaultField(); fun.picks = {}; activeSlot = null; lsSet(funKey, fun); draw();
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
