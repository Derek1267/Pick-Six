#!/usr/bin/env node
// Pick Six — pulls real schedules, scores and playoff seeds from ESPN's public
// scoreboard/standings feeds and saves them into Supabase.
//
// Sports: nfl (weekly slates), nba, nhl, mlb (daily slates), mls, nll (Monday–Sunday slates by date).
//
// Usage:
//   node scripts/sync-games.mjs                  # every sport: recent + upcoming games
//   node scripts/sync-games.mjs --sport nba      # one sport
//   node scripts/sync-games.mjs --all            # whole season(s) (setup, and once a day)
//   node scripts/sync-games.mjs --dry-run        # print what would be saved, save nothing
//   node scripts/sync-games.mjs --players        # also refresh rosters (always done with --all)
//   node scripts/sync-games.mjs --sport nfl --fixture f.json [--standings-fixture s.json] --dry-run   (testing)
//
// Needs env vars (except with --dry-run): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// No npm packages required — Node 18+ has fetch built in.

import { readFile } from 'node:fs/promises';

export const SPORTS = {
  nfl: {
    path: 'football/nfl',
    mode: 'weekly',
    conferences: [['AFC', ['AFC', 'AMERICAN FOOTBALL']], ['NFC', ['NFC', 'NATIONAL FOOTBALL']]],
    playoffTeams: 7, // per conference
    weeks: { 2: 18, 3: 5 }, // seasonType → last week (2 regular, 3 postseason)
    skip: (seasonType, week) => seasonType === 3 && week === 4, // Pro Bowl
  },
  nba: {
    path: 'basketball/nba',
    mode: 'daily',
    conferences: [['East', ['EAST']], ['West', ['WEST']]],
    playoffTeams: 8,
  },
  nhl: {
    path: 'hockey/nhl',
    mode: 'daily',
    conferences: [['East', ['EAST']], ['West', ['WEST']]],
    playoffTeams: 8,
  },
  mlb: {
    path: 'baseball/mlb',
    mode: 'daily',
    conferences: [['AL', ['AMERICAN LEAGUE', ' AL']], ['NL', ['NATIONAL LEAGUE', ' NL']]],
    playoffTeams: 6,
  },
  mls: {
    path: 'soccer/usa.1',
    mode: 'daily',
    slateBy: 'week',
    conferences: [['East', ['EASTERN', 'EAST']], ['West', ['WESTERN', 'WEST']]],
    playoffTeams: 8,
  },
  nll: {
    path: 'lacrosse/nll',
    mode: 'daily',
    slateBy: 'week',
    single: 'NLL', // one standings table, no conferences
    conferences: [],
    playoffTeams: 8,
  },
};

// Soccer feeds use league-specific season type numbers; read the slug instead.
function seasonTypeOf(season) {
  const t = Number(season?.type);
  if (t >= 1 && t <= 4) return t;
  const slug = String(season?.slug || '').toLowerCase();
  if (slug.includes('regular')) return 2;
  if (/playoff|cup|final|round|semifinal|quarterfinal/.test(slug)) return 3;
  return null;
}

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const DRY_RUN = flag('--dry-run');
const ALL = flag('--all');
const FIXTURE = option('--fixture');
const STANDINGS_FIXTURE = option('--standings-fixture');
const SPORT_ARG = option('--sport') || (FIXTURE ? 'nfl' : 'all');

const espn = async (url) => {
  const res = await fetch(url, { headers: { 'User-Agent': 'pick-six-sync' } });
  if (!res.ok) throw new Error(`ESPN ${res.status} for ${url}`);
  return res.json();
};

async function getScoreboard(sport, params = {}) {
  const url = new URL(`https://site.api.espn.com/apis/site/v2/sports/${SPORTS[sport].path}/scoreboard`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return espn(url);
}

// ---------------------------------------------------------------------------
// Dates: daily sports are grouped by US Eastern calendar day ("slate"),
// and by Monday–Sunday week for weekly winners.
// ---------------------------------------------------------------------------

const etDate = (iso) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(iso)); // "2026-11-23"

const WEEK_EPOCH = Date.UTC(2000, 0, 3); // a Monday
export const weekIndexOf = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return Math.floor((Date.UTC(y, m - 1, d) - WEEK_EPOCH) / (7 * 864e5));
};

const mondayOf = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d);
  return new Date(t - ((new Date(t).getUTCDay() + 6) % 7) * 864e5).toISOString().slice(0, 10);
};

const ymdCompact = (d) => d.toISOString().slice(0, 10).replaceAll('-', '');
const addDays = (d, n) => new Date(d.getTime() + n * 864e5);

// ---------------------------------------------------------------------------
// ESPN event → games row
// ---------------------------------------------------------------------------

export function toGameRow(event, sport) {
  const comp = event.competitions?.[0];
  if (!comp) return null;
  const home = comp.competitors?.find((c) => c.homeAway === 'home');
  const away = comp.competitors?.find((c) => c.homeAway === 'away');
  if (!home || !away) return null;

  const statusType = (event.status || comp.status)?.type || {};
  const state = ['pre', 'in', 'post'].includes(statusType.state) ? statusType.state : 'pre';
  const num = (s) => (s === undefined || s === null || s === '' ? null : Number(typeof s === 'object' ? s.value : s));
  const homeScore = state === 'pre' ? null : num(home.score);
  const awayScore = state === 'pre' ? null : num(away.score);

  let winner = null;
  // Postponed/cancelled games come back as "post" but not completed — leave ungraded.
  if (state === 'post' && statusType.completed !== false && homeScore !== null && awayScore !== null) {
    winner = homeScore > awayScore ? 'home' : awayScore > homeScore ? 'away' : 'tie';
    // Level on goals but decided on penalties (soccer playoffs): the feed flags the winner.
    if (winner === 'tie' && (home.winner === true || away.winner === true)) winner = home.winner === true ? 'home' : 'away';
  }

  const record = (c) => c.records?.find((r) => r.type === 'total' || r.name === 'overall')?.summary
    ?? c.records?.[0]?.summary ?? null;

  const startIso = new Date(event.date).toISOString();
  const seasonType = seasonTypeOf(event.season);
  const daily = SPORTS[sport].mode === 'daily';
  const slateDay = SPORTS[sport].slateBy === 'week' ? mondayOf(etDate(startIso)) : etDate(startIso);

  return {
    id: `${sport === 'nfl' ? '' : `${sport}-`}${event.id}`, // NFL ids kept as-is for existing data
    sport,
    season: event.season?.year,
    season_type: seasonType,
    week: daily ? weekIndexOf(slateDay) : event.week?.number,
    slate: daily ? slateDay : `${seasonType}-${event.week?.number}`,
    start_time: startIso,
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

export function rowsFromScoreboard(board, sport) {
  const conf = SPORTS[sport];
  return (board.events || [])
    .map((e) => toGameRow(e, sport))
    .filter((r) => r && r.season && r.week != null)
    .filter((r) => r.season_type === 2 || r.season_type === 3) // regular season + playoffs only
    .filter((r) => !(conf.skip && conf.skip(r.season_type, r.week)));
}

// ---------------------------------------------------------------------------
// Playoff seeds from ESPN standings
// ---------------------------------------------------------------------------

const stat = (entry, ...names) => {
  for (const n of names) {
    const s = entry.stats?.find((x) => x.name === n || x.type === n);
    if (s && s.value !== undefined && s.value !== null) return Number(s.value);
  }
  return null;
};

// The groups that hold whole conferences (or the whole league, for single-table sports).
function conferenceGroups(data, sport) {
  if (SPORTS[sport].single) return [data];
  return (data.children || []).flatMap((g) => (conferenceOf(g, sport) ? [g] : (g.children || [])));
}

function conferenceOf(group, sport) {
  if (SPORTS[sport].single) return SPORTS[sport].single;
  const text = ` ${group.abbreviation || ''} ${group.name || ''} `.toUpperCase();
  for (const [key, words] of SPORTS[sport].conferences) {
    if (words.some((w) => text.includes(w))) return key;
  }
  return null;
}

// Collect every team entry under a group (handles conference → division nesting).
function entriesUnder(group) {
  const own = group.standings?.entries || [];
  return own.concat(...(group.children || []).map(entriesUnder));
}

// ESPN standings → rows for the playoff_seeds table.
export function seedsFromStandings(data, season, sport) {
  const cfg = SPORTS[sport];
  const rows = [];
  for (const group of conferenceGroups(data, sport)) {
    const conference = conferenceOf(group, sport);
    if (!conference) continue;
    const teams = entriesUnder(group).map((e) => ({
      abbr: e.team?.abbreviation,
      name: e.team?.displayName || e.team?.name,
      logo: e.team?.logos?.[0]?.href || e.team?.logo || null,
      seed: stat(e, 'playoffSeed'),
      wins: stat(e, 'wins') ?? 0,
      losses: stat(e, 'losses') ?? 0,
      // NFL ties; NHL overtime losses go in the same column
      ties: stat(e, 'ties', 'otLosses', 'overtimeLosses') ?? 0,
      pct: stat(e, 'winPercent', 'pointsPercentage') ?? 0,
      points: stat(e, 'points'),
    })).filter((t) => t.abbr);

    let ranked = teams.filter((t) => t.seed && t.seed >= 1 && t.seed <= cfg.playoffTeams)
      .sort((a, b) => a.seed - b.seed);
    const distinct = new Set(ranked.map((t) => t.seed)).size;
    if (ranked.length !== cfg.playoffTeams || distinct !== cfg.playoffTeams) {
      // No usable seed numbers in the feed: fall back to best records (rough projection).
      console.warn(`${sport.toUpperCase()} ${conference}: no playoffSeed in standings feed — ranking by record`);
      ranked = teams
        .sort((a, b) => (b.points ?? 0) - (a.points ?? 0) || b.pct - a.pct || b.wins - a.wins)
        .slice(0, cfg.playoffTeams)
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

// Every team in the standings, with its conference → rows for the teams table.
export function teamsFromStandings(data, sport) {
  const rows = [];
  for (const group of conferenceGroups(data, sport)) {
    const conference = conferenceOf(group, sport);
    if (!conference) continue;
    // Remember each team's division when the feed nests divisions under conferences.
    const divisionOf = new Map();
    for (const div of group.children || []) {
      for (const e of entriesUnder(div)) if (e.team?.abbreviation) divisionOf.set(e.team.abbreviation, div.name || null);
    }
    for (const e of entriesUnder(group)) {
      if (!e.team?.abbreviation) continue;
      rows.push({
        division: divisionOf.get(e.team.abbreviation) || null,
        sport, abbr: e.team.abbreviation, name: e.team.displayName || e.team.name || e.team.abbreviation,
        logo: e.team.logos?.[0]?.href || e.team.logo || null, conference,
        wins: stat(e, 'wins') ?? 0, losses: stat(e, 'losses') ?? 0, ties: stat(e, 'ties', 'otLosses', 'overtimeLosses') ?? 0,
        updated_at: new Date().toISOString(),
      });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Players (rosters) — refreshed with the daily full reload
// ---------------------------------------------------------------------------

// ESPN rosters come either flat (NBA) or grouped by position (NFL, NHL, MLB).
export function playersFromRoster(data, sport, teamAbbr) {
  const list = (data.athletes || []).flatMap((a) => (Array.isArray(a.items) ? a.items : [a]));
  return list.filter((a) => a?.id && (a.displayName || a.fullName)).map((a) => ({
    id: `${sport}-${a.id}`,
    sport,
    name: a.displayName || a.fullName,
    team_abbr: teamAbbr,
    position: a.position?.abbreviation || a.position?.name || null,
    headshot: a.headshot?.href || null,
    updated_at: new Date().toISOString(),
  }));
}

// NLL: ESPN has no lacrosse rosters, so read the league's own player list (nll.com/players).
// It's plain HTML: each player has a profile link (/players/<id>/<slug>/) followed by their
// team, number, height, weight and a position code (F, T, D or G). Parsed by text, not by
// class names, so small markup changes don't break it.
export function playersFromNllHtml(html, teams) {
  const text = (h) => h.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&#0?39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  const link = /<a[^>]+href=["'](?:https?:\/\/(?:www\.)?nll\.com)?\/players\/(\d+)\/[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  const hits = [];
  for (const m of html.matchAll(link)) {
    const name = text(m[2]);
    const photo = m[2].match(/url\((['"]?)(https?:[^)'"]+)\1\)/)?.[2] || m[2].match(/<img[^>]+src=["'](https?:[^"']+)["']/)?.[1] || null;
    if (name && /[a-z]/i.test(name) && name.length < 60) hits.push({ id: m[1], name, photo, at: m.index, end: m.index + m[0].length });
  }
  // Keep the first named link per player; the text up to the next player belongs to this one.
  const seen = new Set();
  const list = hits.filter((h) => (seen.has(h.id) ? false : seen.add(h.id)));
  const byName = teams.map((t) => ({ ...t, key: t.name.toLowerCase() })).sort((a, b) => b.key.length - a.key.length);
  return list.map((h, i) => {
    const raw = html.slice(h.end, list[i + 1]?.at ?? h.end + 3000);
    const chunk = text(raw).toLowerCase();
    const team = byName.find((t) => chunk.includes(t.key) || chunk.includes(t.key.replace(/\s+/g, '')));
    const pos = raw.match(/class=["'][^"']*\bposition\b[^"']*["'][^>]*>\s*([FTDG])\s*</)?.[1]
      || (chunk.toUpperCase().match(/(?:^|\s)([FTDG])(?=\s|$)/g) || []).pop()?.trim() || null;
    return {
      id: `nll-${h.id}`, sport: 'nll', name: h.name, team_abbr: team?.abbr || null,
      position: pos, headshot: h.photo, updated_at: new Date().toISOString(),
    };
  });
}

async function collectNllPlayers(teams) {
  const res = await fetch('https://www.nll.com/players/', { headers: { 'User-Agent': 'pick-six-sync (friends league site)' } });
  if (!res.ok) throw new Error(`nll.com ${res.status}`);
  const html = await res.text();
  const players = playersFromNllHtml(html, teams);
  if (!players.length) {
    // Help work out what changed on their side (no secrets here, it's a public page).
    const i = html.search(/\/players\/\d+/);
    console.warn(`[nll] no players parsed from nll.com (${html.length} chars, ${(html.match(/\/players\/\d+/g) || []).length} profile links)`);
    console.warn(`[nll] sample: ${html.slice(Math.max(0, i - 300), i + 900).replace(/\s+/g, ' ')}`);
  }
  return players;
}

async function collectPlayers(sport, knownTeams = []) {
  if (sport === 'nll') return collectNllPlayers(knownTeams);
  const base = `https://site.api.espn.com/apis/site/v2/sports/${SPORTS[sport].path}`;
  const teamsData = await espn(`${base}/teams`);
  const teams = (teamsData.sports?.[0]?.leagues?.[0]?.teams || []).map((t) => t.team).filter(Boolean);
  const rows = [];
  for (const t of teams) {
    try {
      rows.push(...playersFromRoster(await espn(`${base}/teams/${t.id}/roster`), sport, t.abbreviation));
    } catch (err) {
      console.warn(`[${sport}] roster for ${t.abbreviation} skipped: ${err.message}`);
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Fetch plans
// ---------------------------------------------------------------------------

// Which (seasonType, week) pairs to fetch around the current NFL week.
function neighbours(cfg, seasonType, week) {
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

async function collectWeekly(sport, current) {
  const cfg = SPORTS[sport];
  const season = current.season?.year ?? current.leagues?.[0]?.season?.year;
  const seasonType = Number(current.season?.type ?? current.leagues?.[0]?.season?.type?.type);
  const week = current.week?.number;
  let targets = [];
  if (ALL) {
    for (const [t, last] of Object.entries(cfg.weeks)) {
      for (let w = 1; w <= last; w++) if (!(cfg.skip && cfg.skip(Number(t), w))) targets.push([Number(t), w]);
    }
  } else if (week && cfg.weeks[seasonType]) {
    targets = neighbours(cfg, seasonType, week);
  }
  console.log(`[${sport}] season ${season}, type ${seasonType}, week ${week ?? '-'} → ${targets.length} week(s)`);
  const rows = [];
  for (const [t, w] of targets) {
    rows.push(...rowsFromScoreboard(await getScoreboard(sport, { dates: season, seasontype: t, week: w }), sport));
  }
  return { rows, season, seasonType };
}

async function collectDaily(sport, current) {
  const league = current.leagues?.[0] || {};
  const season = league.season?.year ?? current.season?.year;
  const seasonType = Number(league.season?.type?.type ?? current.season?.type);
  const today = new Date();
  let start; let end;
  if (ALL && league.calendarStartDate && league.calendarEndDate) {
    start = new Date(league.calendarStartDate);
    end = new Date(league.calendarEndDate);
  } else {
    start = addDays(today, -2); // late finals + stat corrections
    end = addDays(today, 7);    // a week of upcoming slates
  }
  const rows = [];
  let chunks = 0;
  // ESPN accepts short date ranges; if a range is refused, fall back to one day at a time.
  for (let from = start; from <= end; from = addDays(from, 7)) {
    const to = addDays(from, 6) < end ? addDays(from, 6) : end;
    try {
      rows.push(...rowsFromScoreboard(await getScoreboard(sport, { dates: `${ymdCompact(from)}-${ymdCompact(to)}` }), sport));
      chunks++;
    } catch (err) {
      if (!/ESPN 4\d\d/.test(err.message)) throw err;
      for (let d = from; d <= to; d = addDays(d, 1)) {
        try {
          rows.push(...rowsFromScoreboard(await getScoreboard(sport, { dates: ymdCompact(d) }), sport));
        } catch (dayErr) {
          if (!/ESPN 4\d\d/.test(dayErr.message)) throw dayErr;
          console.warn(`[${sport}] ESPN refused ${ymdCompact(d)} — skipped`);
        }
        chunks++;
      }
    }
  }
  console.log(`[${sport}] season ${season}, type ${seasonType}, ${ymdCompact(start)}–${ymdCompact(end)} (${chunks} request${chunks === 1 ? '' : 's'})`);
  return { rows, season, seasonType };
}

async function collect(sport) {
  if (FIXTURE) {
    return { rows: rowsFromScoreboard(JSON.parse(await readFile(FIXTURE, 'utf8')), sport), season: null, seasonType: null };
  }
  const current = await getScoreboard(sport);
  return SPORTS[sport].mode === 'daily' ? collectDaily(sport, current) : collectWeekly(sport, current);
}

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

function supabaseTarget() {
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
  return { url, key };
}

async function saveRows(rows, table = 'games', conflict = 'id') {
  const { url, key } = supabaseTarget();
  const headers = {
    apikey: key,
    'Content-Type': 'application/json',
    Prefer: 'resolution=merge-duplicates,return=minimal',
  };
  // Legacy service_role keys are JWTs and also go in Authorization.
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;

  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const res = await fetch(`${url}/rest/v1/${table}?on_conflict=${conflict}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(chunk),
    });
    if (!res.ok) {
      const text = await res.text();
      if (/PGRST204|column/.test(text)) {
        throw new Error(`Supabase ${res.status}: ${text}\n→ Your database is missing a newer column. Re-run supabase/schema.sql in the Supabase SQL Editor.`);
      }
      throw new Error(`Supabase ${res.status}: ${text}`);
    }
  }
}

async function syncSport(sport) {
  const cfg = SPORTS[sport];
  const { rows, season, seasonType } = await collect(sport);
  const unique = [...new Map(rows.map((r) => [r.id, r])).values()];
  const finals = unique.filter((r) => r.winner).length;
  const live = unique.filter((r) => r.status === 'in').length;
  console.log(`[${sport}] ${unique.length} games (${finals} final, ${live} live)`);

  // Playoff seeds: keep updating through the regular season; freeze once the playoffs start.
  let seeds = [];
  let teams = [];
  let standings = null;
  if (STANDINGS_FIXTURE) {
    standings = JSON.parse(await readFile(STANDINGS_FIXTURE, 'utf8'));
  } else if (!FIXTURE && season) {
    try {
      const url = new URL(`https://site.api.espn.com/apis/v2/sports/${cfg.path}/standings`);
      url.searchParams.set('season', season);
      standings = await espn(url);
    } catch (err) {
      console.warn(`[${sport}] skipping standings: ${err.message}`);
    }
  }
  if (standings) {
    teams = teamsFromStandings(standings, sport);
    // The default standings are conference-level; ask for division-level ones to learn divisions.
    if (!STANDINGS_FIXTURE && !cfg.single && teams.length && teams.every((t) => !t.division)) {
      try {
        const url = new URL(`https://site.api.espn.com/apis/v2/sports/${cfg.path}/standings`);
        url.searchParams.set('season', season);
        url.searchParams.set('level', '3');
        const byDivision = teamsFromStandings(await espn(url), sport);
        const division = new Map(byDivision.filter((t) => t.division).map((t) => [t.abbr, t.division]));
        if (division.size) teams = teams.map((t) => ({ ...t, division: division.get(t.abbr) || null }));
        else console.warn(`[${sport}] division standings had no divisions`);
      } catch (err) {
        console.warn(`[${sport}] no division standings: ${err.message}`);
      }
    }
    if (STANDINGS_FIXTURE || seasonType === 2) seeds = seedsFromStandings(standings, season || 2026, sport);
  }
  if (teams.length) console.log(`[${sport}] ${teams.length} teams`);

  let players = [];
  if ((ALL || flag('--players')) && !FIXTURE) {
    try {
      players = await collectPlayers(sport, teams);
      console.log(`[${sport}] ${players.length} players`);
    } catch (err) {
      console.warn(`[${sport}] skipping players: ${err.message}`);
    }
  }
  const fullField = seeds.length === cfg.playoffTeams * (cfg.single ? 1 : 2);
  if (seeds.length) console.log(`[${sport}] ${seeds.length} playoff seeds${fullField ? '' : ' (incomplete — not saved)'}`);

  if (DRY_RUN) {
    for (const r of unique.slice(0, 40)) {
      const score = r.status === 'pre' ? r.start_time : `${r.away_score}-${r.home_score} ${r.status_detail ?? ''}`;
      console.log(`  ${r.slate} ${r.away_abbr} @ ${r.home_abbr}  ${score}  winner=${r.winner ?? '-'}`);
    }
    if (unique.length > 40) console.log(`  … and ${unique.length - 40} more`);
    for (const s of seeds) console.log(`  ${s.conference} #${s.seed} ${s.team_abbr} (${s.wins}-${s.losses}${s.ties ? `-${s.ties}` : ''})`);
    const byConf = {};
    for (const t of teams) (byConf[t.conference] ||= []).push(t.abbr);
    for (const [c, list] of Object.entries(byConf)) console.log(`  teams ${c}: ${list.join(' ')}`);
    return;
  }
  if (unique.length) await saveRows(unique);
  if (fullField) await saveRows(seeds, 'playoff_seeds', 'sport,season,conference,seed');
  if (teams.length) await saveRows(teams, 'teams', 'sport,abbr');
  if (players.length) await saveRows([...new Map(players.map((p) => [p.id, p])).values()], 'players', 'id');
  console.log(`[${sport}] saved.`);
}

async function main() {
  const sports = SPORT_ARG === 'all' ? Object.keys(SPORTS) : SPORT_ARG.split(',');
  for (const s of sports) if (!SPORTS[s]) throw new Error(`Unknown sport "${s}". Options: ${Object.keys(SPORTS).join(', ')}, all`);
  let failed = 0;
  for (const sport of sports) {
    try {
      await syncSport(sport);
    } catch (err) {
      failed++;
      console.error(`[${sport}] FAILED: ${err.message || err}`);
    }
  }
  if (failed) process.exit(1);
}

// Only run when executed directly (lets tests import the helpers).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
