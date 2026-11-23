#!/usr/bin/env node
// Pick Six — pulls real NFL schedules and scores from ESPN's public scoreboard
// and saves them into the Supabase "games" table.
//
// Usage:
//   node scripts/sync-games.mjs              # last week, this week, next week
//   node scripts/sync-games.mjs --all        # whole season (run once at setup)
//   node scripts/sync-games.mjs --dry-run    # print what would be saved, save nothing
//   node scripts/sync-games.mjs --fixture f.json --dry-run   # parse a saved ESPN response (testing)
//
// Needs env vars (except with --dry-run): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// No npm packages required — Node 18+ has fetch built in.

import { readFile } from 'node:fs/promises';

const SPORTS = {
  nfl: {
    path: 'football/nfl',
    playoffTeams: 7, // per conference
    // [seasonType, lastWeek] — 2 = regular season, 3 = postseason
    weeks: { 2: 18, 3: 5 },
    skip: (seasonType, week) => seasonType === 3 && week === 4, // Pro Bowl
  },
  // Add more later, e.g. college football: { path: 'football/college-football', ... }
};

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const SPORT = option('--sport') || 'nfl';
const DRY_RUN = flag('--dry-run');
const ALL = flag('--all');
const FIXTURE = option('--fixture');
const cfg = SPORTS[SPORT];
if (!cfg) throw new Error(`Unknown sport "${SPORT}". Options: ${Object.keys(SPORTS).join(', ')}`);

const BASE = `https://site.api.espn.com/apis/site/v2/sports/${cfg.path}/scoreboard`;

async function getScoreboard(params = {}) {
  const url = new URL(BASE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { 'User-Agent': 'pick-six-sync' } });
  if (!res.ok) throw new Error(`ESPN ${res.status} for ${url}`);
  return res.json();
}

// Turn one ESPN event into one row for our games table.
export function toGameRow(event, sport = SPORT) {
  const comp = event.competitions?.[0];
  if (!comp) return null;
  const home = comp.competitors.find((c) => c.homeAway === 'home');
  const away = comp.competitors.find((c) => c.homeAway === 'away');
  if (!home || !away) return null;

  const statusType = (event.status || comp.status)?.type || {};
  const state = ['pre', 'in', 'post'].includes(statusType.state) ? statusType.state : 'pre';
  const num = (s) => (s === undefined || s === null || s === '' ? null : Number(s));
  const homeScore = state === 'pre' ? null : num(home.score);
  const awayScore = state === 'pre' ? null : num(away.score);

  let winner = null;
  // Postponed/cancelled games come back as "post" but not completed — leave ungraded.
  if (state === 'post' && statusType.completed !== false && homeScore !== null && awayScore !== null) {
    winner = homeScore > awayScore ? 'home' : awayScore > homeScore ? 'away' : 'tie';
  }

  const record = (c) => c.records?.find((r) => r.type === 'total' || r.name === 'overall')?.summary
    ?? c.records?.[0]?.summary ?? null;

  return {
    id: String(event.id),
    sport,
    season: event.season?.year,
    season_type: event.season?.type,
    week: event.week?.number,
    start_time: new Date(event.date).toISOString(),
    status: state,
    status_detail: statusType.shortDetail || statusType.detail || null,
    home_team: home.team.displayName,
    home_abbr: home.team.abbreviation,
    home_logo: home.team.logo || null,
    home_record: record(home),
    home_score: homeScore,
    away_team: away.team.displayName,
    away_abbr: away.team.abbreviation,
    away_logo: away.team.logo || null,
    away_record: record(away),
    away_score: awayScore,
    winner,
    updated_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Playoff seeds from ESPN standings
// ---------------------------------------------------------------------------

async function getStandings(season) {
  const url = new URL(`https://site.api.espn.com/apis/v2/sports/${cfg.path}/standings`);
  if (season) url.searchParams.set('season', season);
  const res = await fetch(url, { headers: { 'User-Agent': 'pick-six-sync' } });
  if (!res.ok) throw new Error(`ESPN standings ${res.status}`);
  return res.json();
}

const stat = (entry, ...names) => {
  for (const n of names) {
    const s = entry.stats?.find((x) => x.name === n || x.type === n);
    if (s && s.value !== undefined && s.value !== null) return Number(s.value);
  }
  return null;
};

function conferenceOf(group) {
  const text = `${group.abbreviation || ''} ${group.name || ''}`.toUpperCase();
  if (text.includes('AFC') || text.includes('AMERICAN')) return 'AFC';
  if (text.includes('NFC') || text.includes('NATIONAL FOOTBALL CONF')) return 'NFC';
  return null;
}

// Collect every team entry under a group (handles conference → division nesting).
function entriesUnder(group) {
  const own = group.standings?.entries || [];
  return own.concat(...(group.children || []).map(entriesUnder));
}

// ESPN standings → rows for the playoff_seeds table (7 per conference).
export function seedsFromStandings(data, season, sport = SPORT) {
  const conf = SPORTS[sport];
  const rows = [];
  for (const group of data.children || []) {
    const conference = conferenceOf(group);
    if (!conference) continue;
    const teams = entriesUnder(group).map((e) => ({
      abbr: e.team?.abbreviation,
      name: e.team?.displayName || e.team?.name,
      logo: e.team?.logos?.[0]?.href || e.team?.logo || null,
      seed: stat(e, 'playoffSeed'),
      wins: stat(e, 'wins') ?? 0,
      losses: stat(e, 'losses') ?? 0,
      ties: stat(e, 'ties') ?? 0,
      pct: stat(e, 'winPercent') ?? 0,
    })).filter((t) => t.abbr);

    let ranked = teams.filter((t) => t.seed && t.seed >= 1 && t.seed <= conf.playoffTeams)
      .sort((a, b) => a.seed - b.seed);
    if (ranked.length !== conf.playoffTeams) {
      // No seed numbers in the feed: fall back to best records (rough projection).
      console.warn(`${conference}: no playoffSeed in standings feed — ranking by win %`);
      ranked = teams.sort((a, b) => b.pct - a.pct || b.wins - a.wins).slice(0, conf.playoffTeams)
        .map((t, i) => ({ ...t, seed: i + 1 }));
    }
    for (const t of ranked) {
      rows.push({
        sport, season, conference, seed: t.seed, team_abbr: t.abbr, team_name: t.name, logo: t.logo,
        wins: t.wins, losses: t.losses, ties: t.ties, updated_at: new Date().toISOString(),
      });
    }
  }
  return rows;
}

export function rowsFromScoreboard(board, sport = SPORT) {
  const conf = SPORTS[sport];
  return (board.events || [])
    .map((e) => toGameRow(e, sport))
    .filter((r) => r && r.season && r.season_type && r.week)
    .filter((r) => !(conf.skip && conf.skip(r.season_type, r.week)));
}

// Which (seasonType, week) pairs to fetch around the current one.
function neighbours(seasonType, week) {
  const out = [];
  const last = cfg.weeks[seasonType];
  const prev = week > 1 ? [seasonType, week - 1]
    : cfg.weeks[seasonType - 1] ? [seasonType - 1, cfg.weeks[seasonType - 1]] : null;
  const next = last && week < last ? [seasonType, week + 1]
    : cfg.weeks[seasonType + 1] ? [seasonType + 1, 1] : null;
  if (prev) out.push(prev);
  out.push([seasonType, week]);
  if (next) out.push(next);
  return out.filter(([t, w]) => !(cfg.skip && cfg.skip(t, w)));
}

async function collectRows() {
  if (FIXTURE) {
    return { rows: rowsFromScoreboard(JSON.parse(await readFile(FIXTURE, 'utf8'))), season: null };
  }

  const current = await getScoreboard();
  const season = current.season?.year ?? current.leagues?.[0]?.season?.year;
  const seasonType = current.season?.type ?? current.leagues?.[0]?.season?.type?.type;
  const week = current.week?.number;
  if (!season || !seasonType) throw new Error('Could not read current season from ESPN');

  let targets;
  if (ALL) {
    targets = [];
    for (const [t, last] of Object.entries(cfg.weeks)) {
      for (let w = 1; w <= last; w++) {
        if (!(cfg.skip && cfg.skip(Number(t), w))) targets.push([Number(t), w]);
      }
    }
  } else if (week) {
    targets = neighbours(Number(seasonType), week);
  } else {
    targets = []; // offseason: nothing scheduled
  }

  console.log(`Season ${season}, type ${seasonType}, week ${week ?? '-'} → fetching ${targets.length} week(s)`);
  const rows = [];
  for (const [t, w] of targets) {
    const board = await getScoreboard({ dates: season, seasontype: t, week: w });
    rows.push(...rowsFromScoreboard(board));
  }
  return { rows, season, seasonType: Number(seasonType) };
}

async function saveRows(rows, table = 'games', conflict = 'id') {
  // Forgive small copy-paste slips in the secrets: spaces, quotes, missing https://, trailing paths.
  const clean = (v) => (v || '').trim().replace(/^['"]|['"]$/g, '').trim();
  let url = clean(process.env.SUPABASE_URL);
  const key = clean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY secrets');
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  url = url.replace(/\/(rest\/v1|dashboard).*$/i, '').replace(/\/+$/, '');
  if (url.includes('supabase.com/dashboard')) {
    throw new Error('SUPABASE_URL should look like https://<project-id>.supabase.co, not the dashboard link');
  }
  try {
    const u = new URL(url);
    if (!u.hostname.endsWith('.supabase.co')) {
      console.warn(`Note: SUPABASE_URL host doesn't end in .supabase.co (${u.hostname.length} chars) — double-check the secret`);
    }
  } catch {
    // Describe the problem without printing the secret itself.
    const facts = [
      `${url.length} characters`,
      /\s/.test(url) ? 'contains a space or line break' : 'no spaces',
      url.includes('supabase.co') ? 'contains "supabase.co"' : 'does NOT contain "supabase.co"',
      /[^\x20-\x7E]/.test(url) ? 'contains unusual/invisible characters' : 'plain characters only',
    ];
    throw new Error(`SUPABASE_URL secret isn't a valid URL (${facts.join(', ')}). `
      + 'Re-enter it as https://<project-id>.supabase.co');
  }

  const headers = {
    apikey: key,
    'Content-Type': 'application/json',
    Prefer: 'resolution=merge-duplicates,return=minimal',
  };
  // Legacy service_role keys are JWTs and also go in Authorization.
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;

  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/${table}?on_conflict=${conflict}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(chunk),
    });
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  }
}

async function main() {
  const { rows, season, seasonType } = await collectRows();
  // De-duplicate (an event can appear in two fetched weeks around season boundaries)
  const unique = [...new Map(rows.map((r) => [r.id, r])).values()];

  const finals = unique.filter((r) => r.winner).length;
  const live = unique.filter((r) => r.status === 'in').length;
  console.log(`${unique.length} games (${finals} final, ${live} live)`);

  // Playoff seeds: keep updating through the regular season; freeze once the playoffs start.
  let seeds = [];
  const standingsFile = option('--standings-fixture');
  if (standingsFile) {
    seeds = seedsFromStandings(JSON.parse(await readFile(standingsFile, 'utf8')), 2026);
  } else if (!FIXTURE && season && seasonType !== 3) {
    try {
      seeds = seedsFromStandings(await getStandings(season), season);
    } catch (err) {
      console.warn(`Skipping seeds: ${err.message}`);
    }
  }
  if (seeds.length) console.log(`${seeds.length} playoff seeds`);

  if (DRY_RUN) {
    for (const r of unique) {
      const score = r.status === 'pre' ? r.start_time : `${r.away_score}-${r.home_score} ${r.status_detail ?? ''}`;
      console.log(`  wk${r.week} ${r.away_abbr} @ ${r.home_abbr}  ${score}  winner=${r.winner ?? '-'}`);
    }
    for (const s of seeds) console.log(`  ${s.conference} #${s.seed} ${s.team_abbr} (${s.wins}-${s.losses}${s.ties ? `-${s.ties}` : ''})`);
    return;
  }
  await saveRows(unique);
  if (seeds.length === 14) await saveRows(seeds, 'playoff_seeds', 'sport,season,conference,seed');
  console.log('Saved.');
}

// Only run when executed directly (lets tests import the helpers).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
