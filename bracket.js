// Pick Six — playoff bracket logic for NFL, NBA, NHL, MLB, MLS and NLL.
// No DOM here, so it can be tested in Node.
//
// A bracket is a plain object of slot → team abbreviation:
//   { 'AFC-R1-0': 'BUF', 'AFC-R2-0': 'KC', 'AFC-R3-0': 'KC', 'F': 'KC' }
// Slots: <conference>-R1-<i> (first round), -R2-<i>, -R3-0 (conference final), and F (the final).

export const FORMATS = {
  nfl: {
    conferences: ['AFC', 'NFC'],
    teams: 7,
    rounds: ['Wild Card', 'Divisional', 'Conference', 'Super Bowl'],
    bestOf: [1, 1, 1, 1],
    // 1 has a bye. Divisional round re-seeds: 1 hosts the lowest seed left.
    r1: [[2, 7], [3, 6], [4, 5]],
    byes: [1],
    reseed: true,
  },
  nba: {
    conferences: ['East', 'West'],
    teams: 8,
    rounds: ['First Round', 'Conf. Semis', 'Conf. Finals', 'NBA Finals'],
    bestOf: [7, 7, 7, 7],
    r1: [[1, 8], [4, 5], [3, 6], [2, 7]],
    r2: [[0, 1], [2, 3]], // winners of R1 games 0 & 1, 2 & 3
    byes: [],
    // With 10 teams per conference, seeds 7–10 play the play-in first:
    // 7 v 8 (winner is the 7 seed), 9 v 10, then the 7/8 loser v the 9/10 winner (winner is the 8 seed).
    playIn: true,
  },
  nhl: {
    conferences: ['East', 'West'],
    teams: 8,
    rounds: ['First Round', 'Second Round', 'Conf. Final', 'Stanley Cup Final'],
    bestOf: [7, 7, 7, 7],
    r1: [[1, 8], [4, 5], [3, 6], [2, 7]],
    r2: [[0, 1], [2, 3]],
    byes: [],
  },
  mlb: {
    conferences: ['AL', 'NL'],
    teams: 6,
    rounds: ['Wild Card', 'Division Series', 'LCS', 'World Series'],
    bestOf: [3, 5, 7, 7],
    // 1 and 2 have byes. 1 plays the 4/5 winner, 2 plays the 3/6 winner.
    r1: [[3, 6], [4, 5]],
    r2: [['bye', 1, 1], ['bye', 2, 0]], // [bye, seed, R1 game index]
    byes: [1, 2],
  },
  mls: {
    conferences: ['East', 'West'],
    teams: 8,
    // 9 teams per conference: 8 v 9 play a one-game wild card; the winner is the 8 seed.
    wildCard: true,
    rounds: ['Round One', 'Conf. Semis', 'Conf. Final', 'MLS Cup'],
    bestOf: [3, 1, 1, 1],
    r1: [[1, 8], [4, 5], [3, 6], [2, 7]],
    r2: [[0, 1], [2, 3]],
    byes: [],
  },
  // NLL: one table, top 8 make it. Drawn as two halves of the bracket (1/8 v 4/5, 2/7 v 3/6),
  // so the semifinal winners meet in the NLL Finals. Three rounds, no conference final.
  nll: {
    conferences: ['A', 'B'],
    labels: { A: 'Top half', B: 'Bottom half' },
    single: 'NLL',
    halves: { A: [1, 4, 5, 8], B: [2, 3, 6, 7] },
    teams: 4, // per half
    rounds: ['Quarterfinals', 'Semifinals', 'NLL Finals'],
    bestOf: [1, 3, 3],
    r1: { A: [[1, 8], [4, 5]], B: [[2, 7], [3, 6]] },
    r2: [[0, 1]],
    byes: [],
  },
};

// The standings tables a sport is ranked in (NLL: one table; everyone else: two conferences).
export const tablesOf = (sport) => { const f = formatOf(sport); return f.single ? [f.single] : f.conferences; };
// Playoff teams chosen per table in "Build your own".
export const extraSeeds = (sport) => { const f = formatOf(sport); return f.playIn ? 2 : f.wildCard ? 1 : 0; };
export const fieldSizeOf = (sport) => { const f = formatOf(sport); return f.single ? f.teams * 2 : f.teams + extraSeeds(sport); };
export const confLabel = (sport, c) => formatOf(sport).labels?.[c] || c;
const pairsFor = (f, conf) => (Array.isArray(f.r1) ? f.r1 : f.r1[conf]);
// One seeded list (seeds 1–8) → the two halves of a single-table bracket.
export function splitSingle(sport, list) {
  const f = formatOf(sport);
  return Object.fromEntries(f.conferences.map((c) => [c, list.filter((t) => f.halves[c].includes(t.seed))]));
}

export const ROUND_KEYS = ['PI', 'R1', 'R2', 'R3', 'F'];
export const ROUND_POINTS = { PI: 0, R1: 1, R2: 2, R3: 4, F: 8 };
export const roundOf = (slot) => (slot === 'F' ? 'F' : slot.split('-')[1]);
export const formatOf = (sport) => FORMATS[sport] || FORMATS.nfl;

export function maxPoints(sport) {
  const f = formatOf(sport);
  const r1 = f.conferences.reduce((n, c) => n + pairsFor(f, c).length, 0);
  const r2 = (f.r2 ? f.r2.length : 2) * 2;
  const r3 = f.rounds.length === 4 ? 2 : 0;
  return r1 * ROUND_POINTS.R1 + r2 * ROUND_POINTS.R2 + r3 * ROUND_POINTS.R3 + ROUND_POINTS.F;
}

// playoff_seeds rows → { [conference]: [team...] } sorted by seed
export function seedsByConference(rows, sport) {
  const f = formatOf(sport);
  if (f.single) {
    const list = (rows || []).filter((r) => r.conference === f.single)
      .map((r) => ({ ...r, abbr: r.team_abbr ?? r.abbr, team_name: r.team_name ?? r.abbr })).sort((a, b) => a.seed - b.seed);
    return splitSingle(sport, list);
  }
  const out = Object.fromEntries(f.conferences.map((c) => [c, []]));
  for (const r of rows || []) {
    if (out[r.conference]) {
      out[r.conference].push({ ...r, abbr: r.team_abbr ?? r.abbr, team_name: r.team_name ?? r.abbr });
    }
  }
  for (const c of f.conferences) out[c].sort((a, b) => a.seed - b.seed);
  return out;
}

export const hasPlayIn = (seeds, sport) => {
  const f = formatOf(sport);
  return extraSeeds(sport) > 0 && f.conferences.every((c) => seeds[c]?.length === f.teams + extraSeeds(sport));
};
export const isComplete = (seeds, sport) => {
  const f = formatOf(sport);
  return f.conferences.every((c) => seeds[c]?.length === f.teams) || hasPlayIn(seeds, sport);
};

// ---------------------------------------------------------------------------
// Building the bracket from picks
// ---------------------------------------------------------------------------

const game = (slot, a, b, picks, bestOf, neutral = false) => {
  // Better seed hosts (and is listed first).
  let home = a; let away = b;
  if (a && b && !neutral && b.seed < a.seed) { home = b; away = a; }
  const pick = picks[slot];
  const winner = home && away && (pick === home.abbr || pick === away.abbr)
    ? (pick === home.abbr ? home : away) : null;
  return { slot, round: roundOf(slot), home, away, neutral, bestOf, winner };
};

export function buildBracket(sport, seeds, picks = {}) {
  const f = formatOf(sport);
  const out = { F: null };
  for (const conf of f.conferences) {
    const s = seeds[conf] || [];
    const seedTeam = (n) => s.find((t) => t.seed === n) || null;
    const id = (r, i) => `${conf}-${r}-${i}`;

    // Play-in (NBA, when the field has seeds 9 and 10)
    let playIn = null;
    let bySeed = seedTeam;
    if (f.playIn && seedTeam(9) && seedTeam(10)) {
      const pi0 = game(id('PI', 0), seedTeam(7), seedTeam(8), picks, 1);
      const pi1 = game(id('PI', 1), seedTeam(9), seedTeam(10), picks, 1);
      const loser0 = pi0.winner ? (pi0.winner === pi0.home ? pi0.away : pi0.home) : null;
      const pi2 = game(id('PI', 2), loser0, pi1.winner, picks, 1);
      playIn = [pi0, pi1, pi2];
      const seven = pi0.winner ? { ...pi0.winner, seed: 7 } : null;
      const eight = pi2.winner ? { ...pi2.winner, seed: 8 } : null;
      bySeed = (n) => (n === 7 ? seven : n === 8 ? eight : seedTeam(n));
    } else if (f.wildCard && seedTeam(9)) {
      const wc = game(id('PI', 0), seedTeam(8), seedTeam(9), picks, 1);
      playIn = [wc];
      const eight = wc.winner ? { ...wc.winner, seed: 8 } : null;
      bySeed = (n) => (n === 8 ? eight : seedTeam(n));
    }

    const r1 = pairsFor(f, conf).map(([h, a], i) => game(id('R1', i), bySeed(h), bySeed(a), picks, f.bestOf[0]));
    const w1 = r1.map((g) => g.winner);

    let r2;
    if (f.reseed) {
      if (w1.every(Boolean)) {
        const alive = [...f.byes.map(bySeed), ...w1].sort((a, b) => a.seed - b.seed);
        r2 = [game(id('R2', 0), alive[0], alive[3], picks, f.bestOf[1]),
              game(id('R2', 1), alive[1], alive[2], picks, f.bestOf[1])];
      } else {
        r2 = [game(id('R2', 0), bySeed(1), null, picks, f.bestOf[1]), game(id('R2', 1), null, null, picks, f.bestOf[1])];
      }
    } else {
      r2 = f.r2.map((pair, i) => (pair[0] === 'bye'
        ? game(id('R2', i), bySeed(pair[1]), w1[pair[2]], picks, f.bestOf[1])
        : game(id('R2', i), w1[pair[0]], w1[pair[1]], picks, f.bestOf[1])));
    }

    // Three-round formats (NLL): the semifinal winner goes straight to the final.
    let r3 = null;
    let champ;
    if (f.rounds.length === 4) {
      const [a, b] = r2.map((g) => g.winner);
      r3 = game(id('R3', 0), a || null, b || null, picks, f.bestOf[2]);
      champ = r3.winner;
    } else {
      champ = r2[0].winner;
    }
    out[conf] = { byes: f.byes.map(bySeed).filter(Boolean), playIn, r1, r2, r3, champ: champ || null };
  }
  const [c0, c1] = f.conferences;
  out.F = game('F', out[c0].champ, out[c1].champ, picks, f.bestOf[f.bestOf.length - 1], true);
  return out;
}

export const allGames = (sport, b) => [
  ...formatOf(sport).conferences.flatMap((c) => [...(b[c].playIn || []), ...b[c].r1, ...b[c].r2, ...(b[c].r3 ? [b[c].r3] : [])]),
  b.F,
];

// Drop picks that no longer fit (you changed an early pick, so a later one is gone).
export function cleanPicks(sport, seeds, picks) {
  let current = { ...picks };
  for (let i = 0; i < 5; i++) {
    const valid = {};
    for (const g of allGames(sport, buildBracket(sport, seeds, current))) {
      if (g.winner) valid[g.slot] = g.winner.abbr;
    }
    if (Object.keys(valid).length === Object.keys(current).length) return valid;
    current = valid;
  }
  return current;
}

export const totalGames = (sport, seeds = null) => {
  const f = formatOf(sport);
  const r1 = f.conferences.reduce((n, c) => n + pairsFor(f, c).length, 0);
  return r1 + (f.r2 ? f.r2.length : 2) * 2 + (f.rounds.length === 4 ? 2 : 0) + 1 + (seeds && hasPlayIn(seeds, sport) ? (f.playIn ? 6 : 2) : 0);
};
export const pickCount = (sport, seeds, picks) =>
  allGames(sport, buildBracket(sport, seeds, picks)).filter((g) => g.winner).length;

// ---------------------------------------------------------------------------
// Win probabilities & simulation
// ---------------------------------------------------------------------------

// Regressed win % so a hot start isn't treated as unbeatable.
export function strength(t) {
  const w = (t.wins ?? 0) + (t.ties ?? 0) / 2;
  const g = (t.wins ?? 0) + (t.losses ?? 0) + (t.ties ?? 0);
  return (w + 3) / (g + 6);
}

// Chance of winning one game (log5 + home edge) …
function gameProb(home, away, edge) {
  const a = strength(home);
  const b = strength(away);
  const p = (a * (1 - b)) / (a * (1 - b) + b * (1 - a));
  const logit = Math.log(p / (1 - p)) + edge;
  return 1 / (1 + Math.exp(-logit));
}

// … and a best-of-N series.
export function seriesProb(p, bestOf) {
  if (bestOf <= 1) return p;
  const need = Math.ceil(bestOf / 2);
  let total = 0;
  let c = 1; // C(need-1+k, k)
  for (let k = 0; k < need; k++) {
    if (k > 0) c = (c * (need - 1 + k)) / k;
    total += c * p ** need * (1 - p) ** k;
  }
  return total;
}

// Chance the first-listed (home / better seed) team wins this matchup.
export function winProb(home, away, neutral = false, bestOf = 1) {
  const edge = neutral ? 0 : bestOf > 1 ? 0.08 : 0.2; // series alternate venues
  return seriesProb(gameProb(home, away, edge), bestOf);
}

const gameWinProb = (g) => winProb(g.home, g.away, g.neutral, g.bestOf);

function fill(sport, seeds, picks, choose) {
  const out = { ...picks };
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    for (const g of allGames(sport, buildBracket(sport, seeds, out))) {
      if (!g.winner && g.home && g.away) { out[g.slot] = choose(g).abbr; changed = true; }
    }
    if (!changed) break;
  }
  return out;
}

export const simulate = (sport, seeds, picks = {}, rng = Math.random) =>
  fill(sport, seeds, picks, (g) => (rng() < gameWinProb(g) ? g.home : g.away));

export const favorites = (sport, seeds, picks = {}) =>
  fill(sport, seeds, picks, (g) => (gameWinProb(g) >= 0.5 ? g.home : g.away));

// Many simulated playoffs → each team's chance to reach each stage.
export function odds(sport, seeds, runs = 10000, rng = Math.random) {
  const f = formatOf(sport);
  const tally = new Map();
  for (const c of f.conferences) {
    for (const t of seeds[c]) tally.set(t.abbr, { team: t, conference: c, r2: 0, r3: 0, final: 0, champ: 0 });
  }
  const bump = (t, k) => { if (t) tally.get(t.abbr)[k]++; };
  for (let i = 0; i < runs; i++) {
    const b = buildBracket(sport, seeds, simulate(sport, seeds, {}, rng));
    for (const c of f.conferences) {
      for (const g of b[c].r2) { bump(g.home, 'r2'); bump(g.away, 'r2'); }
      if (b[c].r3) { bump(b[c].r3.home, 'r3'); bump(b[c].r3.away, 'r3'); }
    }
    bump(b.F.home, 'final'); bump(b.F.away, 'final'); bump(b.F.winner, 'champ');
  }
  return [...tally.values()]
    .map((r) => ({ ...r, r2: r.r2 / runs, r3: r.r3 / runs, final: r.final / runs, champ: r.champ / runs }))
    .sort((a, b) => b.champ - a.champ);
}

// ---------------------------------------------------------------------------
// Real results & scoring
// ---------------------------------------------------------------------------

// Walk the real bracket using final playoff games (series: first to N wins).
export function actualResults(sport, seeds, games) {
  const post = (games || []).filter((g) => g.season_type === 3 && g.winner && g.winner !== 'tie');
  const winsBetween = (a, b) => {
    const w = { [a]: 0, [b]: 0 };
    for (const g of post) {
      const pair = [g.home_abbr, g.away_abbr];
      if (pair.includes(a) && pair.includes(b)) w[g.winner === 'home' ? g.home_abbr : g.away_abbr]++;
    }
    return w;
  };
  const results = {};
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    for (const g of allGames(sport, buildBracket(sport, seeds, results))) {
      if (g.winner || !g.home || !g.away) continue;
      const need = Math.ceil(g.bestOf / 2);
      const w = winsBetween(g.home.abbr, g.away.abbr);
      const done = Object.entries(w).find(([, n]) => n >= need);
      if (done) { results[g.slot] = done[0]; changed = true; }
    }
    if (!changed) break;
  }
  return results;
}

// Points for each correct winner per round (round-based, because the NFL re-seeds).
// Returns { points, correct, possible }: possible = points + picks still alive.
export function scoreBracket(sport, seeds, picks, results) {
  const real = { PI: new Set(), R1: new Set(), R2: new Set(), R3: new Set(), F: new Set() };
  for (const [slot, abbr] of Object.entries(results || {})) real[roundOf(slot)].add(abbr);

  const eliminated = new Set();
  for (const g of allGames(sport, buildBracket(sport, seeds, results || {}))) {
    if (g.winner) eliminated.add(g.winner === g.home ? g.away.abbr : g.home.abbr);
  }

  let points = 0; let correct = 0; let pending = 0;
  for (const [slot, abbr] of Object.entries(picks || {})) {
    const r = roundOf(slot);
    if (real[r]?.has(abbr)) { points += ROUND_POINTS[r]; correct++; }
    else if (!eliminated.has(abbr)) pending += ROUND_POINTS[r];
  }
  return { points, correct, possible: points + pending };
}
