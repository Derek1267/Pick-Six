// Pick Six — front end. Plain JavaScript, no build step.
// Pages (hash routes):
//   #/                      your leagues, create or join one
//   #/join/ABC123           invite link — joins after sign-in
//   #/league/<id>           weekly picks          (?tab=standings for the leaderboard, &week=2-12 for a week)
//   #/league/<id>?tab=bracket   playoff bracket + simulator

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY, SPORT } from './config.js';
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

const weekKey = (type, week) => `${type}-${week}`;

function weekLabel(type, week) {
  if (type === 3) return ['Wild Card', 'Divisional', 'Conference', 'Pro Bowl', 'Super Bowl'][week - 1] || `Playoffs ${week}`;
  if (type === 1) return `Preseason ${week}`;
  return `Week ${week}`;
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
  if (route.name === 'join') localStorage.setItem(JOIN_KEY, route.code);

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
      The README walks through it step by step.</p>
    </section>`;
}

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

function renderSignIn(route) {
  const joining = route.name === 'join' || localStorage.getItem(JOIN_KEY);
  if (state.pendingEmail) return renderCodeStep();

  app.innerHTML = `
    <section class="hero">
      <p class="eyebrow">${joining ? "You've been invited to a league" : 'NFL pick’em for you and your friends'}</p>
      <h1>Pick winners.<br>Talk trash.<br><span class="accent">Climb the board.</span></h1>
      <p class="lede">Start a private league, pick every game on the real schedule, and let the leaderboard settle the arguments.</p>
    </section>
    <section class="card narrow">
      <h2>${joining ? 'Sign in to join' : 'Get started'}</h2>
      <form id="signin-form" class="stack">
        <label><span>Display name <span class="muted">(new players)</span></span>
          <input name="name" maxlength="30" placeholder="e.g. Derek" autocomplete="nickname">
        </label>
        <label>Email
          <input name="email" type="email" required placeholder="you@example.com" autocomplete="email">
        </label>
        <button class="btn big" type="submit">Email me a sign-in link</button>
        <p class="muted small">No password needed. We'll email you a link and a 6-digit code.</p>
      </form>
    </section>`;

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
      return toast(friendlyError(error), 'error');
    }
    state.pendingEmail = email;
    renderCodeStep();
  });
}

function renderCodeStep() {
  app.innerHTML = `
    <section class="card narrow">
      <h2>Check your email</h2>
      <p>We sent a sign-in link to <strong>${esc(state.pendingEmail)}</strong>.
      Tap the link, or type the 6-digit code here:</p>
      <form id="code-form" class="stack">
        <input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,8}"
               maxlength="8" placeholder="123456" class="code-input" required>
        <button class="btn big" type="submit">Sign in</button>
      </form>
      <button class="link" id="restart">Use a different email</button>
    </section>`;
  document.getElementById('restart').onclick = () => { state.pendingEmail = null; render(); };
  document.getElementById('code-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const token = new FormData(e.target).get('code').trim();
    const { error } = await sb.auth.verifyOtp({ email: state.pendingEmail, token, type: 'email' });
    if (error) return toast('That code didn’t work — check it or request a new one.', 'error');
    state.pendingEmail = null; // onAuthStateChange re-renders
  });
}

// ---------------------------------------------------------------------------
// Home: your leagues, create, join
// ---------------------------------------------------------------------------

async function renderHome(stale) {
  app.innerHTML = '<div class="loading">Loading your leagues…</div>';
  const { data: leagues, error } = await sb
    .from('leagues')
    .select('id, name, invite_code, season, sport, league_members(count)')
    .order('created_at');
  if (stale()) return;
  if (error) { app.innerHTML = `<p class="error">${esc(friendlyError(error))}</p>`; return; }

  const cards = leagues.map((l) => `
    <a class="league-card" href="#/league/${l.id}">
      <span class="league-name">${esc(l.name)}</span>
      <span class="muted small">${l.season} ${esc(l.sport.toUpperCase())} · ${l.league_members?.[0]?.count ?? 1} players</span>
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
    const name = new FormData(e.target).get('name').trim();
    const { data, error } = await sb.rpc('create_league', { p_name: name, p_sport: SPORT });
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
    sb.from('games').select('*').eq('sport', league.sport).eq('season', league.season).order('start_time'),
  ]);
  if (stale()) return;
  const members = (membersRes.data || []).map((m) => ({
    user_id: m.user_id, role: m.role, name: m.profiles?.display_name || 'Player',
  }));
  const games = gamesRes.data || [];

  const head = `
    <section class="league-head">
      <a href="#/" class="link small">← All leagues</a>
      <div class="league-title-row">
        <h1>${esc(league.name)}</h1>
        <button class="btn small secondary" id="invite-btn">Invite friends</button>
      </div>
      <p class="muted small">${league.season} ${esc(league.sport.toUpperCase())} · ${members.length} player${members.length === 1 ? '' : 's'}
        · code <strong class="mono">${esc(league.invite_code)}</strong></p>
      <div class="tabs" role="tablist">
        <a role="tab" href="#/league/${league.id}" class="${route.tab === 'picks' ? 'active' : ''}">Picks</a>
        <a role="tab" href="#/league/${league.id}?tab=standings" class="${route.tab === 'standings' ? 'active' : ''}">Standings</a>
        <a role="tab" href="#/league/${league.id}?tab=bracket" class="${route.tab === 'bracket' ? 'active' : ''}">Bracket</a>
      </div>
    </section>`;

  let body;
  if (route.tab === 'standings') body = await standingsHtml(league, members, games);
  else if (route.tab === 'bracket') body = '<div id="bracket-root"><div class="loading">Loading bracket…</div></div>';
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

function groupWeeks(games) {
  const weeks = new Map();
  for (const g of games) {
    const k = weekKey(g.season_type, g.week);
    if (!weeks.has(k)) weeks.set(k, { key: k, type: g.season_type, week: g.week, games: [] });
    weeks.get(k).games.push(g);
  }
  return [...weeks.values()].sort((a, b) => a.type - b.type || a.week - b.week);
}

function defaultWeek(weeks) {
  // The first week that still has a game that isn't finished.
  const now = Date.now();
  return (weeks.find((w) => w.games.some((g) => g.status !== 'post' && new Date(g.start_time) > now - 864e5))
    || weeks[weeks.length - 1])?.key;
}

// ----- Picks tab -----

async function picksHtml(league, members, games, route) {
  const weeks = groupWeeks(games);
  if (!weeks.length) {
    return `<div class="empty card"><p><strong>No games loaded yet.</strong>
      Run the "Sync NFL games" GitHub Action (with "full season" ticked) to pull in the schedule.</p></div>`;
  }

  const key = weeks.some((w) => w.key === route.week) ? route.week : defaultWeek(weeks);
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
      ${idx > 0 ? `<a class="btn icon ghost" href="${weekLink(weeks[idx - 1])}" aria-label="Previous week">‹</a>` : '<span class="btn icon ghost disabled">‹</span>'}
      <select id="week-select" aria-label="Choose week">
        ${weeks.map((w) => `<option value="${w.key}" ${w.key === key ? 'selected' : ''}>${weekLabel(w.type, w.week)}</option>`).join('')}
      </select>
      ${idx < weeks.length - 1 ? `<a class="btn icon ghost" href="${weekLink(weeks[idx + 1])}" aria-label="Next week">›</a>` : '<span class="btn icon ghost disabled">›</span>'}
    </div>`;

  const summary = `
    <div class="summary">
      ${open.length ? `<div><span class="big-num">${pickedOpen}/${open.length}</span><span class="muted small">open games picked</span></div>` : ''}
      ${graded.length ? `<div><span class="big-num">${right}-${graded.length - right}</span><span class="muted small">this week</span></div>` : ''}
      ${nextLock ? `<div><span class="big-num">${fmtCountdown(nextLock.start_time)}</span><span class="muted small">until ${nextLock.away_abbr} @ ${nextLock.home_abbr} locks</span></div>` : ''}
      ${!open.length && !graded.length ? '<div class="muted">All games for this week are locked.</div>' : ''}
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
    <li><span class="wk">${weekLabel(w.type, w.week)}</span>
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

// ----- Bracket tab -----

const pct = (x) => (x >= 0.995 ? '>99%' : x < 0.005 ? (x > 0 ? '<1%' : '—') : `${Math.round(x * 100)}%`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function mountBracket(league, members, games, stale) {
  const root = document.getElementById('bracket-root');
  const me = state.session.user.id;
  const [seedRes, stateRes, picksRes] = await Promise.all([
    sb.from('playoff_seeds').select('*').eq('sport', league.sport).eq('season', league.season),
    sb.rpc('bracket_state', { p_league: league.id }),
    sb.from('bracket_picks').select('user_id, picks').eq('league_id', league.id),
  ]);
  if (stale()) return;

  const seeds = BR.seedsByConference(seedRes.data);
  if (!BR.isComplete(seeds)) {
    root.innerHTML = `<div class="empty card"><p><strong>No playoff picture yet.</strong>
      Seeds appear after the "Sync NFL games" Action runs.</p></div>`;
    return;
  }

  const bstate = stateRes.data || 'not_ready'; // not_ready | open | locked
  const practiceKey = `pickSix.practiceBracket.${league.id}`;
  const brackets = picksRes.data || [];
  let picks = {};
  if (bstate === 'not_ready') {
    try { picks = JSON.parse(localStorage.getItem(practiceKey) || '{}'); } catch { picks = {}; }
  } else {
    picks = brackets.find((b) => b.user_id === me)?.picks || {};
  }
  picks = BR.cleanPicks(seeds, picks);

  const results = BR.actualResults(seeds, games);
  const realWinners = new Set(Object.entries(results).map(([slot, abbr]) => `${BR.roundOf(slot)}:${abbr}`));
  const eliminated = new Set();
  for (const g of BR.allGames(BR.buildBracket(seeds, results))) {
    if (g.winner) eliminated.add(g.winner === g.home ? g.away.abbr : g.home.abbr);
  }
  const firstKick = games.filter((g) => g.season_type === 3).map((g) => g.start_time).sort()[0];
  const editable = bstate !== 'locked';
  const oddsRows = BR.odds(seeds, 10000);
  const odds = new Map(oddsRows.map((r) => [r.team.abbr, r]));

  let busy = false;
  let saveTimer;
  let saveNote = '';

  const persist = () => {
    if (bstate === 'not_ready') {
      try { localStorage.setItem(practiceKey, JSON.stringify(picks)); } catch { /* private mode */ }
      return;
    }
    if (bstate !== 'open') return;
    saveNote = 'Saving…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const { error } = await sb.from('bracket_picks').upsert(
        { league_id: league.id, user_id: me, picks },
        { onConflict: 'league_id,user_id' },
      );
      saveNote = error ? '' : 'Saved ✓';
      if (error) toast(friendlyError(error), 'error');
      const el = root.querySelector('.save-note');
      if (el) el.textContent = saveNote;
    }, 500);
  };

  const teamRow = (g, side) => {
    const t = g[side];
    if (!t) return '<div class="bt tbd">TBD</div>';
    const other = side === 'home' ? g.away : g.home;
    const p = other ? (side === 'home' ? BR.winProb(g.home, g.away, g.neutral) : 1 - BR.winProb(g.home, g.away, g.neutral)) : null;
    const picked = g.winner?.abbr === t.abbr;
    let result = '';
    if (picked && realWinners.has(`${g.round}:${t.abbr}`)) result = 'correct';
    else if (picked && eliminated.has(t.abbr)) result = 'wrong';
    const out = eliminated.has(t.abbr) ? 'out' : '';
    return `
      <button class="bt ${picked ? 'picked' : ''} ${result} ${out}" data-slot="${g.slot}" data-team="${esc(t.abbr)}"
              ${editable && other && !busy ? '' : 'disabled'} aria-pressed="${picked}" title="${esc(t.team_name)} (${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ''})">
        <span class="seed">${t.seed}</span>
        ${t.logo ? `<img src="${esc(t.logo)}" alt="" width="20" height="20" loading="lazy">` : ''}
        <span class="abbr">${esc(t.abbr)}</span>
        ${p !== null ? `<span class="prob">${pct(p)}</span>` : ''}
      </button>`;
  };

  const matchup = (g) => `<div class="bm ${g.winner ? 'done' : ''}">${teamRow(g, 'home')}${teamRow(g, 'away')}</div>`;

  const confHtml = (conf, b) => `
    <section class="conf-block">
      <h3 class="conf-name ${conf.toLowerCase()}">${conf}</h3>
      <div class="bracket-grid">
        <div class="round-label">Wild Card</div><div class="round-label">Divisional</div><div class="round-label">Conference</div>
        <div class="round">
          <div class="bye"><span class="seed">1</span> ${esc(b.bye.abbr)} <span class="muted">bye</span></div>
          ${b.wc.map(matchup).join('')}
        </div>
        <div class="round">${b.div.map(matchup).join('')}</div>
        <div class="round">${matchup(b.conf)}</div>
      </div>
    </section>`;

  const banner = () => {
    const n = BR.pickCount(seeds, picks);
    if (bstate === 'not_ready') {
      return `<div class="banner"><strong>🔮 Projected bracket.</strong> Seeds are based on today's standings and change every week.
        This is a practice bracket saved on this device. Real brackets open when the regular season ends.</div>`;
    }
    if (bstate === 'open') {
      return `<div class="banner open"><strong>Brackets are open!</strong> ${n}/13 picked.
        ${firstKick ? `Locks at the first Wild Card kickoff: ${fmtKickoff(firstKick)} (${fmtCountdown(firstKick)}).` : 'Locks at the first Wild Card kickoff.'}
        <span class="save-note">${saveNote}</span></div>`;
    }
    return '<div class="banner locked"><strong>🔒 Brackets are locked.</strong> Points per correct winner: Wild Card 1 · Divisional 2 · Conference 4 · Super Bowl 8.</div>';
  };

  const standingsHtmlB = () => {
    if (bstate !== 'locked') return '';
    const rows = members.map((m) => {
      const bp = brackets.find((b) => b.user_id === m.user_id)?.picks;
      const sc = bp ? BR.scoreBracket(seeds, bp, results) : null;
      return { m, sc, champ: bp?.SB };
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

  const oddsHtml = () => `
    <section class="card">
      <h2>Title odds</h2>
      <p class="muted small">From 10,000 simulated playoffs using each team's record and home field.
        It's a simple model. Your game predictor could replace it later.</p>
      <div class="odds-wrap"><table class="odds">
        <thead><tr><th>Team</th><th class="num">Divisional</th><th class="num">Conf. game</th><th class="num">Super Bowl</th><th class="num">Win it all</th></tr></thead>
        <tbody>${oddsRows.map((r) => `
          <tr>
            <td><span class="seed">${r.team.seed}</span> <strong>${esc(r.team.abbr)}</strong> <span class="muted small">${r.conference}</span></td>
            <td class="num">${pct(r.div)}</td><td class="num">${pct(r.conf)}</td><td class="num">${pct(r.sb)}</td>
            <td class="num"><span class="bar" style="--w:${Math.round(r.champ * 100 / oddsRows[0].champ)}%"></span><strong>${pct(r.champ)}</strong></td>
          </tr>`).join('')}</tbody>
      </table></div>
    </section>`;

  const draw = () => {
    const b = BR.buildBracket(seeds, picks);
    const n = BR.pickCount(seeds, picks);
    const champ = b.SB.winner;
    const simLabel = n === 13 ? '🎲 Re-simulate' : n ? '🎲 Simulate the rest' : '🎲 Simulate';
    root.innerHTML = `
      ${banner()}
      ${editable ? `
        <div class="bracket-controls">
          <button class="btn" data-action="simulate" ${busy ? 'disabled' : ''}>${simLabel}</button>
          <button class="btn secondary" data-action="favorites" ${busy ? 'disabled' : ''}>Pick favorites</button>
          <button class="btn ghost" data-action="clear" ${busy || !n ? 'disabled' : ''}>Clear</button>
        </div>` : ''}
      ${standingsHtmlB()}
      <div class="bracket">
        ${confHtml('AFC', b.AFC)}
        ${confHtml('NFC', b.NFC)}
        <section class="sb-block">
          <h3 class="conf-name sb">Super Bowl</h3>
          ${matchup(b.SB)}
          <div class="champion ${champ ? 'crowned' : ''}">
            ${champ ? `<span class="trophy">🏆</span><span class="champ-name">${esc(champ.team_name)}</span>
              <span class="muted small">${pct(odds.get(champ.abbr)?.champ ?? 0)} title odds</span>`
              : '<span class="muted">Pick a champion</span>'}
          </div>
        </section>
      </div>
      ${oddsHtml()}`;
  };

  // Reveal a simulated bracket one round at a time.
  const animateTo = async (target) => {
    busy = true;
    const order = ['WC', 'DIV', 'CONF', 'SB'];
    for (const r of order) {
      for (const [slot, abbr] of Object.entries(target)) if (BR.roundOf(slot) === r) picks[slot] = abbr;
      picks = BR.cleanPicks(seeds, picks);
      draw();
      await sleep(380);
    }
    busy = false;
    draw();
    persist();
  };

  root.onclick = (e) => {
    if (busy) return;
    const team = e.target.closest('[data-slot]');
    if (team && !team.disabled) {
      picks = BR.cleanPicks(seeds, { ...picks, [team.dataset.slot]: team.dataset.team });
      draw();
      persist();
      return;
    }
    const action = e.target.closest('[data-action]')?.dataset.action;
    const full = BR.pickCount(seeds, picks) === 13;
    if (action === 'simulate' || action === 'favorites') {
      if (full) picks = {}; // full bracket → start over
      const target = action === 'simulate' ? BR.simulate(seeds, picks) : BR.favorites(seeds, picks);
      animateTo(target);
    } else if (action === 'clear') {
      picks = {};
      draw();
      persist();
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
