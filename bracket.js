// Pick Six — NFL playoff bracket logic (no DOM here, so it can be tested in Node).
//
// Format: 7 teams per conference. #1 seed gets a bye.
//   Wild Card:  2 v 7, 3 v 6, 4 v 5           (higher seed hosts)
//   Divisional: 1 v lowest remaining seed, other two play  (the NFL re-seeds)
//   Conference: the two divisional winners
//   Super Bowl: AFC champ v NFC champ (neutral site)
//
// A bracket is a plain object of slot → team abbreviation, e.g.
//   { 'AFC-WC-0': 'BUF', 'AFC-DIV-0': 'KC', 'AFC-CONF': 'KC', ..., 'SB': 'KC' }

export const CONFERENCES = ['AFC', 'NFC'];
export const ROUNDS = ['WC', 'DIV', 'CONF', 'SB'];
export const ROUND_NAMES = { WC: 'Wild Card', DIV: 'Divisional', CONF: 'Conference', SB: 'Super Bowl' };
export const ROUND_POINTS = { WC: 1, DIV: 2, CONF: 4, SB: 8 };
export const MAX_POINTS = 6 * 1 + 4 * 2 + 2 * 4 + 8; // 30

const WC_PAIRS = [[2, 7], [3, 6], [4, 5]];
const HOME_EDGE = 0.2; // ≈ +5 percentage points for the home team in a close game

export const roundOf = (slot) => (slot === 'SB' ? 'SB' : slot.split('-')[1]);

// seedsRows: rows from the playoff_seeds table → { AFC: [team...], NFC: [team...] } sorted by seed
export function seedsByConference(rows) {
  const out = { AFC: [], NFC: [] };
  for (const r of rows || []) {
    if (out[r.conference]) {
      out[r.conference].push({ ...r, abbr: r.team_abbr ?? r.abbr, team_name: r.team_name ?? r.abbr });
    }
  }
  for (const c of CONFERENCES) out[c].sort((a, b) => a.seed - b.seed);
  return out;
}

export const isComplete = (seeds) => CONFERENCES.every((c) => seeds[c]?.length === 7);

// ---------------------------------------------------------------------------
// Building the bracket from picks
// ---------------------------------------------------------------------------

const game = (slot, home, away, picks, neutral = false) => {
  const pick = picks[slot];
  const winner = home && away && (pick === home.abbr || pick === away.abbr)
    ? (pick === home.abbr ? home : away) : null;
  return { slot, round: roundOf(slot), home, away, neutral, winner };
};

// Returns every game in the bracket, with teams filled in as far as the picks allow.
export function buildBracket(seeds, picks = {}) {
  const out = { AFC: {}, NFC: {}, SB: null };
  for (const conf of CONFERENCES) {
    const s = seeds[conf];
    const bySeed = (n) => s.find((t) => t.seed === n) || null;

    const wc = WC_PAIRS.map(([h, a], i) => game(`${conf}-WC-${i}`, bySeed(h), bySeed(a), picks));
    const wcWinners = wc.map((g) => g.winner);

    let div;
    if (wcWinners.every(Boolean)) {
      const alive = [bySeed(1), ...wcWinners].sort((a, b) => a.seed - b.seed);
      div = [
        game(`${conf}-DIV-0`, alive[0], alive[3], picks),
        game(`${conf}-DIV-1`, alive[1], alive[2], picks),
      ];
    } else {
      // Can't know the re-seeded matchups yet — show the #1 seed waiting.
      div = [game(`${conf}-DIV-0`, bySeed(1), null, picks), game(`${conf}-DIV-1`, null, null, picks)];
    }

    const [d0, d1] = div.map((g) => g.winner);
    const confGame = d0 && d1
      ? game(`${conf}-CONF`, d0.seed < d1.seed ? d0 : d1, d0.seed < d1.seed ? d1 : d0, picks)
      : game(`${conf}-CONF`, d0 || d1 || null, null, picks);

    out[conf] = { bye: bySeed(1), wc, div, conf: confGame };
  }
  const afc = out.AFC.conf.winner;
  const nfc = out.NFC.conf.winner;
  out.SB = game('SB', afc, nfc, picks, true);
  return out;
}

export const allGames = (b) => [
  ...CONFERENCES.flatMap((c) => [...b[c].wc, ...b[c].div, b[c].conf]),
  b.SB,
];

// Drop picks that no longer fit (e.g. you changed a Wild Card winner, so your
// Divisional pick for the old team is gone).
export function cleanPicks(seeds, picks) {
  let current = { ...picks };
  // Iterate until stable: each pass can invalidate the next round.
  for (let i = 0; i < 4; i++) {
    const valid = {};
    for (const g of allGames(buildBracket(seeds, current))) {
      if (g.winner) valid[g.slot] = g.winner.abbr;
    }
    if (Object.keys(valid).length === Object.keys(current).length) return valid;
    current = valid;
  }
  return current;
}

export const pickCount = (seeds, picks) => allGames(buildBracket(seeds, picks)).filter((g) => g.winner).length; // of 13

// ---------------------------------------------------------------------------
// Win probabilities & simulation
// ---------------------------------------------------------------------------

// Regressed win % so a 3-0 team isn't treated as unbeatable.
export function strength(t) {
  const w = (t.wins ?? 0) + (t.ties ?? 0) / 2;
  const g = (t.wins ?? 0) + (t.losses ?? 0) + (t.ties ?? 0);
  return (w + 3) / (g + 6);
}

// Chance the home team wins (log5 + home-field bump unless neutral).
export function winProb(home, away, neutral = false) {
  const a = strength(home);
  const b = strength(away);
  let p = (a * (1 - b)) / (a * (1 - b) + b * (1 - a));
  if (!neutral) {
    const logit = Math.log(p / (1 - p)) + HOME_EDGE;
    p = 1 / (1 + Math.exp(-logit));
  }
  return p;
}

// Fill every remaining slot. `choose(game) → team` decides each game.
function fill(seeds, picks, choose) {
  const out = { ...picks };
  for (let pass = 0; pass < 5; pass++) {
    let changed = false;
    for (const g of allGames(buildBracket(seeds, out))) {
      if (!g.winner && g.home && g.away) {
        out[g.slot] = choose(g).abbr;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return out;
}

export const simulate = (seeds, picks = {}, rng = Math.random) =>
  fill(seeds, picks, (g) => (rng() < winProb(g.home, g.away, g.neutral) ? g.home : g.away));

export const favorites = (seeds, picks = {}) =>
  fill(seeds, picks, (g) => (winProb(g.home, g.away, g.neutral) >= 0.5 ? g.home : g.away));

// Run many simulated playoffs. Returns per-team chances of reaching each stage.
export function odds(seeds, runs = 10000, rng = Math.random) {
  const tally = new Map();
  for (const c of CONFERENCES) {
    for (const t of seeds[c]) tally.set(t.abbr, { team: t, conference: c, div: 0, conf: 0, sb: 0, champ: 0 });
  }
  for (let i = 0; i < runs; i++) {
    const b = buildBracket(seeds, simulate(seeds, {}, rng));
    for (const c of CONFERENCES) {
      for (const g of b[c].div) { tally.get(g.home.abbr).div++; tally.get(g.away.abbr).div++; }
      tally.get(b[c].conf.home.abbr).conf++;
      tally.get(b[c].conf.away.abbr).conf++;
    }
    tally.get(b.SB.home.abbr).sb++;
    tally.get(b.SB.away.abbr).sb++;
    tally.get(b.SB.winner.abbr).champ++;
  }
  return [...tally.values()]
    .map((r) => ({ ...r, div: r.div / runs, conf: r.conf / runs, sb: r.sb / runs, champ: r.champ / runs }))
    .sort((a, b) => b.champ - a.champ);
}

// ---------------------------------------------------------------------------
// Real results & scoring
// ---------------------------------------------------------------------------

// Walk the real bracket using final postseason games from the games table.
export function actualResults(seeds, games) {
  const post = (games || []).filter((g) => g.season_type === 3 && g.winner && g.winner !== 'tie');
  const find = (a, b) => post.find((g) => (g.home_abbr === a && g.away_abbr === b) || (g.home_abbr === b && g.away_abbr === a));
  const results = {};
  for (let pass = 0; pass < 5; pass++) {
    let changed = false;
    for (const g of allGames(buildBracket(seeds, results))) {
      if (g.winner || !g.home || !g.away) continue;
      const real = find(g.home.abbr, g.away.abbr);
      if (real) {
        results[g.slot] = real.winner === 'home' ? real.home_abbr : real.away_abbr;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return results;
}

// Points for each correct winner per round (round-based, because re-seeding
// means your Divisional matchups may differ from the real ones).
// Returns { points, correct, possible } — possible = points + picks still alive.
export function scoreBracket(seeds, picks, results) {
  const realByRound = { WC: new Set(), DIV: new Set(), CONF: new Set(), SB: new Set() };
  for (const [slot, abbr] of Object.entries(results || {})) realByRound[roundOf(slot)].add(abbr);

  const eliminated = new Set();
  for (const g of allGames(buildBracket(seeds, results || {}))) {
    if (g.winner) eliminated.add(g.winner === g.home ? g.away.abbr : g.home.abbr);
  }

  let points = 0; let correct = 0; let pending = 0;
  for (const [slot, abbr] of Object.entries(picks || {})) {
    const r = roundOf(slot);
    if (realByRound[r].has(abbr)) { points += ROUND_POINTS[r]; correct++; }
    else if (!eliminated.has(abbr)) pending += ROUND_POINTS[r];
  }
  return { points, correct, possible: points + pending };
}
