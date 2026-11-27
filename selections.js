// Pick Six — what can be predicted: awards, All-Star rosters, year-end teams.
// Data only, no DOM.
//
// A sheet has sections of slots:
//   { label, n, pos?, size?: 'big' | 'small', labels?: [per-slot label], kind?: 'reserve' | 'alt' }
// `pos` lists position codes that fit (search shows them first; anyone can still be chosen).
// `filter` limits players to a conference or division. Sheets in the same `group`
// (e.g. All-NBA 1st/2nd/3rd) can't share a player. `pick: 'team'` means you choose a team
// (coach / executive awards) instead of a player.

const S = (label, n, more = {}) => ({ label, n, ...more });

// Surface layouts: each row has the same number of cells so positions line up in columns;
// `_` is an empty cell. Values are flat slot indexes (display only; stored order never changes).
const _ = null;
const mid = (f) => [_, _, _, _, f, _, _, _, _]; // the middle of a 9-wide football formation
const DIAMOND = [[5, _, 6, _, 7], [_, 4, _, 2, _], [3, _, _, _, 1], [_, _, 0, _, _], [_, _, 8, _, _]];
const NBA_G = ['PG', 'SG', 'G'];
const NBA_F = ['SF', 'PF', 'F', 'C', 'FC', 'GF'];
const NHL_F = ['C', 'LW', 'RW', 'F', 'W'];

// ---------------------------------------------------------------------------
// Awards (3 points each)
// ---------------------------------------------------------------------------

const award = (id, title, note, more = {}) => ({ id, title, note, sections: [S('Pick', 1)], points: 3, ...more });
const teamAward = (id, title, note, more = {}) => award(id, title, note, { pick: 'team', ...more });

export const AWARD_CATEGORIES = {
  season: 'Season awards',
  stats: 'Stat titles',
  staff: 'Coaches & front office',
  post: 'Playoffs',
  character: 'Character & community',
  events: 'Events',
};

export const AWARDS = {
  nba: [
    award('mvp', 'Most Valuable Player', 'Michael Jordan Trophy', { cat: 'season' }),
    award('dpoy', 'Defensive Player of the Year', 'Hakeem Olajuwon Trophy', { cat: 'season' }),
    award('roy', 'Rookie of the Year', 'Wilt Chamberlain Trophy', { cat: 'season' }),
    award('smoy', 'Sixth Man of the Year', 'John Havlicek Trophy', { cat: 'season' }),
    award('mip', 'Most Improved Player', 'George Mikan Trophy', { cat: 'season' }),
    award('clutch', 'Clutch Player of the Year', 'Jerry West Trophy', { cat: 'season' }),
    teamAward('coy', 'Coach of the Year', 'Red Auerbach Trophy · pick the team', { cat: 'staff' }),
    teamAward('eoy', 'Executive of the Year', 'Pick the team', { cat: 'staff' }),
    award('fmvp', 'Finals MVP', 'Bill Russell Trophy', { cat: 'post' }),
    award('ecfmvp', 'East Finals MVP', 'Larry Bird Trophy', { cat: 'post', filter: { conference: 'East' } }),
    award('wcfmvp', 'West Finals MVP', 'Magic Johnson Trophy', { cat: 'post', filter: { conference: 'West' } }),
    award('asgmvp', 'All-Star Game MVP', 'Kobe Bryant Trophy', { cat: 'events' }),
    award('cupmvp', 'NBA Cup MVP', null, { cat: 'events' }),
    award('hustle', 'Hustle Award', null, { cat: 'character' }),
    award('sportsmanship', 'Sportsmanship Award', 'Joe Dumars Trophy', { cat: 'character' }),
    award('teammate', 'Teammate of the Year', 'Twyman–Stokes Trophy', { cat: 'character' }),
    award('socialjustice', 'Social Justice Champion', 'Kareem Abdul-Jabbar Trophy', { cat: 'character' }),
  ],
  nfl: [
    award('mvp', 'Most Valuable Player', null, { cat: 'season' }),
    award('opoy', 'Offensive Player of the Year', null, { cat: 'season' }),
    award('dpoy', 'Defensive Player of the Year', null, { cat: 'season' }),
    award('oroy', 'Offensive Rookie of the Year', null, { cat: 'season' }),
    award('droy', 'Defensive Rookie of the Year', null, { cat: 'season' }),
    award('cpoy', 'Comeback Player of the Year', null, { cat: 'season' }),
    teamAward('coy', 'Coach of the Year', 'Pick the team', { cat: 'staff' }),
    teamAward('aoy', 'Assistant Coach of the Year', 'Pick the team', { cat: 'staff' }),
    award('sbmvp', 'Super Bowl MVP', 'Pete Rozelle Trophy', { cat: 'post' }),
    award('wpmoy', 'Walter Payton Man of the Year', null, { cat: 'character' }),
  ],
  nhl: [
    award('hart', 'Hart Trophy', 'Most valuable player', { cat: 'season' }),
    award('lindsay', 'Ted Lindsay Award', 'Best player, voted by players', { cat: 'season' }),
    award('vezina', 'Vezina Trophy', 'Best goaltender', { cat: 'season' }),
    award('norris', 'Norris Trophy', 'Best defenceman', { cat: 'season' }),
    award('calder', 'Calder Trophy', 'Rookie of the year', { cat: 'season' }),
    award('selke', 'Selke Trophy', 'Best defensive forward', { cat: 'season' }),
    award('artross', 'Art Ross Trophy', 'Most points', { cat: 'stats' }),
    award('rocket', 'Rocket Richard Trophy', 'Most goals', { cat: 'stats' }),
    award('jennings', 'William M. Jennings Trophy', 'Fewest goals against', { cat: 'stats' }),
    teamAward('adams', 'Jack Adams Award', 'Coach of the year · pick the team', { cat: 'staff' }),
    teamAward('gm', 'General Manager of the Year', 'Pick the team', { cat: 'staff' }),
    award('connsmythe', 'Conn Smythe Trophy', 'Playoff MVP', { cat: 'post' }),
    award('byng', 'Lady Byng Trophy', 'Sportsmanship', { cat: 'character' }),
    award('masterton', 'Masterton Trophy', 'Perseverance and dedication', { cat: 'character' }),
    award('clancy', 'King Clancy Trophy', 'Leadership and community', { cat: 'character' }),
  ],
  mlb: [
    award('almvp', 'AL MVP', null, { cat: 'season', filter: { conference: 'AL' } }),
    award('nlmvp', 'NL MVP', null, { cat: 'season', filter: { conference: 'NL' } }),
    award('alcy', 'AL Cy Young', null, { cat: 'season', filter: { conference: 'AL' } }),
    award('nlcy', 'NL Cy Young', null, { cat: 'season', filter: { conference: 'NL' } }),
    award('alroy', 'AL Rookie of the Year', null, { cat: 'season', filter: { conference: 'AL' } }),
    award('nlroy', 'NL Rookie of the Year', null, { cat: 'season', filter: { conference: 'NL' } }),
    award('alrel', 'AL Reliever of the Year', 'Mariano Rivera Award', { cat: 'season', filter: { conference: 'AL' } }),
    award('nlrel', 'NL Reliever of the Year', 'Trevor Hoffman Award', { cat: 'season', filter: { conference: 'NL' } }),
    award('alcomeback', 'AL Comeback Player', null, { cat: 'season', filter: { conference: 'AL' } }),
    award('nlcomeback', 'NL Comeback Player', null, { cat: 'season', filter: { conference: 'NL' } }),
    award('alaaron', 'AL Hank Aaron Award', 'Best hitter', { cat: 'stats', filter: { conference: 'AL' } }),
    award('nlaaron', 'NL Hank Aaron Award', 'Best hitter', { cat: 'stats', filter: { conference: 'NL' } }),
    teamAward('almoy', 'AL Manager of the Year', 'Pick the team', { cat: 'staff', filter: { conference: 'AL' } }),
    teamAward('nlmoy', 'NL Manager of the Year', 'Pick the team', { cat: 'staff', filter: { conference: 'NL' } }),
    award('alcsmvp', 'ALCS MVP', null, { cat: 'post', filter: { conference: 'AL' } }),
    award('nlcsmvp', 'NLCS MVP', null, { cat: 'post', filter: { conference: 'NL' } }),
    award('wsmvp', 'World Series MVP', 'Willie Mays Award', { cat: 'post' }),
    award('asgmvp', 'All-Star Game MVP', 'Ted Williams Award', { cat: 'events' }),
    award('clemente', 'Roberto Clemente Award', null, { cat: 'character' }),
  ],
};

// ---------------------------------------------------------------------------
// All-Star rosters (1 point per player who makes it, injury replacements included)
// One sheet per side; the tab shows a toggle between sides.
// ---------------------------------------------------------------------------

const extras = S('Injury replacements & honourable mentions', 3, { kind: 'alt' });

const nbaAllStar = (conf) => ({
  id: `allstar-${conf.toLowerCase()}`, side: conf, title: `${conf} All-Stars`, points: 1,
  filter: { conference: conf },
  sections: [
    S('Starters', 5, { size: 'big', labels: ['Guard', 'Guard', 'Forward', 'Forward', 'Forward'], posBySlot: [NBA_G, NBA_G, NBA_F, NBA_F, NBA_F] }),
    S('Reserves', 7, { kind: 'reserve' }),
    extras,
  ],
  layout: { surface: 'court', groups: [{ rows: [[2, 3, 4], [0, _, 1]] }] },
});

const proBowl = (conf) => ({
  id: `probowl-${conf.toLowerCase()}`, side: conf, title: `${conf} Pro Bowl`, points: 1,
  filter: { conference: conf },
  sections: [
    S('Offense', 21, {
      size: 'big',
      labels: ['QB', 'QB', 'QB', 'RB', 'RB', 'RB', 'FB', 'WR', 'WR', 'WR', 'WR', 'TE', 'TE', 'T', 'T', 'T', 'G', 'G', 'G', 'C', 'C'],
      posBySlot: [['QB'], ['QB'], ['QB'], ['RB'], ['RB'], ['RB'], ['FB', 'RB'], ['WR'], ['WR'], ['WR'], ['WR'], ['TE'], ['TE'],
        ['OT', 'T'], ['OT', 'T'], ['OT', 'T'], ['G', 'OG'], ['G', 'OG'], ['G', 'OG'], ['C'], ['C']],
    }),
    S('Defense', 18, {
      labels: ['DE', 'DE', 'DE', 'DT', 'DT', 'DT', 'OLB', 'OLB', 'OLB', 'ILB', 'ILB', 'CB', 'CB', 'CB', 'CB', 'S', 'S', 'S'],
      posBySlot: [['DE'], ['DE'], ['DE'], ['DT', 'NT'], ['DT', 'NT'], ['DT', 'NT'], ['OLB', 'LB'], ['OLB', 'LB'], ['OLB', 'LB'],
        ['ILB', 'LB', 'MLB'], ['ILB', 'LB', 'MLB'], ['CB'], ['CB'], ['CB'], ['CB'], ['S', 'FS', 'SS'], ['S', 'FS', 'SS'], ['S', 'FS', 'SS']],
    }),
    S('Special teams', 5, { labels: ['K', 'P', 'LS', 'RET', 'ST'], posBySlot: [['PK', 'K'], ['P'], ['LS'], ['WR', 'RB', 'CB'], null] }),
    extras,
  ],
  layout: {
    surface: 'field',
    groups: [
      { title: 'Offense', rows: [[7, 11, 13, 16, 19, 17, 14, 12, 8], mid(0), mid(6), mid(3)], bench: [[1, 2, 4, 5, 9, 10, 15, 18, 20]] },
      { title: 'Defense', rows: [[_, _, _, 36, _, 37, _, _, _], [32, _, 27, _, 30, _, 28, _, 33], [_, 21, _, 24, _, 25, _, 22, _]], bench: [[_, 23, 26, 29, 31, 34, 35, 38, _]] },
    ],
  },
});

const nhlDivision = (div) => ({
  id: `allstar-${div.toLowerCase()}`, side: div, title: `${div} All-Stars`, points: 1,
  filter: { division: div },
  sections: [
    S('Forwards', 6, { size: 'big', labels: ['LW', 'C', 'RW', 'LW', 'C', 'RW'], posBySlot: Array(6).fill(NHL_F) }),
    S('Defence', 3, { size: 'big', labels: ['D', 'D', 'D'], posBySlot: Array(3).fill(['D']) }),
    S('Goalies', 2, { size: 'big', labels: ['G', 'G'], posBySlot: [['G'], ['G']] }),
    extras,
  ],
  layout: { surface: 'rink', groups: [{ rows: [[0, 1, 2], [3, 4, 5], [6, 7, 8], [9, _, 10]] }] },
});

const mlbAllStar = (lg) => ({
  id: `allstar-${lg.toLowerCase()}`, side: lg, title: `${lg} All-Stars`, points: 1,
  filter: { conference: lg },
  sections: [
    S('Starters', 9, {
      size: 'big',
      labels: ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'],
      posBySlot: [['C'], ['1B'], ['2B'], ['3B'], ['SS'], ['LF', 'CF', 'RF', 'OF'], ['LF', 'CF', 'RF', 'OF'], ['LF', 'CF', 'RF', 'OF'], ['DH']],
    }),
    S('Pitchers', 12, { kind: 'reserve', pos: ['SP', 'RP', 'P'] }),
    S('Reserves', 11, { kind: 'reserve' }),
    extras,
  ],
  layout: { surface: 'diamond', groups: [{ rows: DIAMOND }] },
});

export const ALLSTARS = {
  nba: [nbaAllStar('East'), nbaAllStar('West')],
  nfl: [proBowl('AFC'), proBowl('NFC')],
  nhl: ['Atlantic', 'Metropolitan', 'Central', 'Pacific'].map(nhlDivision),
  mlb: [mlbAllStar('AL'), mlbAllStar('NL')],
};
export const ALLSTAR_NAME = { nfl: 'Pro Bowl', nba: 'All-Stars', nhl: 'All-Stars', mlb: 'All-Stars' };

// ---------------------------------------------------------------------------
// Year-end teams (1 point per player)
// ---------------------------------------------------------------------------

const yearEnd = (id, title, heading, group, sections) => ({ id, title, heading, group, sections, points: 1 });
const five = (id, title, heading, group) => ({
  ...yearEnd(id, title, heading, group, [S('Players', 5, { size: 'big' })]),
  layout: { surface: 'court', groups: [{ rows: [[0, 1, 2], [3, _, 4]] }] },
});

const allPro = (tier) => yearEnd(`allpro-${tier}`, `${tier === 1 ? 'First' : 'Second'} Team All-Pro`, 'All-Pro', 'allpro', [
  S('Offense', 12, {
    size: 'big', labels: ['QB', 'RB', 'FB', 'WR', 'WR', 'WR', 'TE', 'T', 'T', 'G', 'G', 'C'],
    posBySlot: [['QB'], ['RB'], ['FB', 'RB'], ['WR'], ['WR'], ['WR'], ['TE'], ['OT', 'T'], ['OT', 'T'], ['G', 'OG'], ['G', 'OG'], ['C']],
  }),
  S('Defense', 12, {
    labels: ['EDGE', 'EDGE', 'DT', 'DT', 'LB', 'LB', 'CB', 'CB', 'S', 'S', 'NB', 'DB'],
    posBySlot: [['DE', 'OLB'], ['DE', 'OLB'], ['DT', 'NT'], ['DT', 'NT'], ['LB', 'ILB', 'OLB'], ['LB', 'ILB', 'OLB'], ['CB'], ['CB'], ['S', 'FS', 'SS'], ['S', 'FS', 'SS'], ['CB'], ['CB', 'S']],
  }),
  S('Special teams', 4, { labels: ['K', 'P', 'KR', 'PR'], posBySlot: [['PK', 'K'], ['P'], null, null] }),
]);
const allProTeam = (tier) => ({
  ...allPro(tier),
  layout: {
    surface: 'field',
    groups: [
      { title: 'Offense', rows: [[3, 5, 7, 9, 11, 10, 8, 6, 4], mid(0), mid(2), mid(1)] },
      { title: 'Defense', rows: [[_, _, _, 20, _, 21, _, _, _], [18, 22, _, 16, _, 17, _, 23, 19], [_, 12, _, 14, _, 15, _, 13, _]] },
    ],
  },
});

const nhlTeam = (id, title, heading, group) => ({
  ...yearEnd(id, title, heading, group, [
    S('Lineup', 6, {
      size: 'big', labels: ['C', 'LW', 'RW', 'D', 'D', 'G'],
      posBySlot: [['C'], ['LW', 'W'], ['RW', 'W'], ['D'], ['D'], ['G']],
    }),
  ]),
  layout: { surface: 'rink', groups: [{ rows: [[1, 0, 2], [3, _, 4], [_, 5, _]] }] },
});

const allMlb = (tier) => withDiamond(yearEnd(`allmlb-${tier}`, `All-MLB ${tier === 1 ? 'First' : 'Second'} Team`, 'All-MLB', 'allmlb', [
  S('Position players', 9, {
    size: 'big', labels: ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'],
    posBySlot: [['C'], ['1B'], ['2B'], ['3B'], ['SS'], ['LF', 'CF', 'RF', 'OF'], ['LF', 'CF', 'RF', 'OF'], ['LF', 'CF', 'RF', 'OF'], ['DH']],
  }),
  S('Pitchers', 7, { labels: ['SP', 'SP', 'SP', 'SP', 'SP', 'RP', 'RP'], posBySlot: [...Array(5).fill(['SP', 'P']), ['RP', 'P'], ['RP', 'P']] }),
]));
function withDiamond(sheet) {
  return { ...sheet, layout: { surface: 'diamond', groups: [{ rows: DIAMOND }] } };
}

export const YEAR_END = {
  nba: [
    five('allnba-1', 'First Team', 'All-NBA', 'allnba'),
    five('allnba-2', 'Second Team', 'All-NBA', 'allnba'),
    five('allnba-3', 'Third Team', 'All-NBA', 'allnba'),
    five('alldef-1', 'First Team', 'All-Defensive', 'alldef'),
    five('alldef-2', 'Second Team', 'All-Defensive', 'alldef'),
    five('allrookie-1', 'First Team', 'All-Rookie', 'allrookie'),
    five('allrookie-2', 'Second Team', 'All-Rookie', 'allrookie'),
  ],
  nfl: [allProTeam(1), allProTeam(2)],
  nhl: [
    nhlTeam('allstarteam-1', 'First Team', 'NHL All-Star Teams', 'nhlteam'),
    nhlTeam('allstarteam-2', 'Second Team', 'NHL All-Star Teams', 'nhlteam'),
    nhlTeam('allrookie', 'All-Rookie Team', 'All-Rookie', null),
  ],
  mlb: [allMlb(1), allMlb(2)],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Slots a sheet's surface layout draws (formation rows and bench); the rest render as plain rows.
export function laidOut(sheet) {
  const set = new Set();
  for (const g of sheet.layout?.groups || []) {
    for (const r of [...g.rows, ...(g.bench || [])]) r.forEach((f) => { if (f !== null) set.add(f); });
  }
  return set;
}

export const slotCount = (sheet) => sheet.sections.reduce((n, s) => n + s.n, 0);

export function slotIndex(sheet, sectionIdx, i) {
  let n = 0;
  for (let s = 0; s < sectionIdx; s++) n += sheet.sections[s].n;
  return n + i;
}

// Flat position → { section, i } (i = index inside the section)
export function locate(sheet, flat) {
  let n = 0;
  for (const section of sheet.sections) {
    if (flat < n + section.n) return { section, i: flat - n };
    n += section.n;
  }
  return null;
}
export const sectionOf = (sheet, flat) => locate(sheet, flat)?.section || null;

// Position codes that fit a slot.
export function slotPositions(sheet, flat) {
  const loc = locate(sheet, flat);
  if (!loc) return null;
  return loc.section.posBySlot?.[loc.i] || loc.section.pos || null;
}
export function slotLabel(sheet, flat) {
  const loc = locate(sheet, flat);
  return loc?.section.labels?.[loc.i] || null;
}

// Points per player: picks that appear in the real results.
export function scoreSheets(sheets, picksByUser, answersBySheet) {
  const totals = new Map();
  for (const sheet of sheets) {
    const answers = new Set((answersBySheet.get(sheet.qid) || []).filter(Boolean));
    if (!answers.size) continue;
    for (const [userId, picks] of picksByUser) {
      const mine = (picks.get(sheet.qid) || []).filter(Boolean);
      const hits = new Set(mine.filter((p) => answers.has(p))).size;
      const t = totals.get(userId) || { points: 0, correct: 0 };
      t.points += hits * sheet.points;
      t.correct += hits;
      totals.set(userId, t);
    }
  }
  return totals;
}

// ---------------------------------------------------------------------------
// Standings predictions
// ---------------------------------------------------------------------------

// Real order within a conference: NHL by points (2 per win + 1 per OT loss), others by win %.
export function realOrder(teams, sport) {
  const score = (t) => {
    const gp = t.wins + t.losses + (t.ties || 0);
    if (sport === 'nhl') return [2 * t.wins + (t.ties || 0), t.wins];
    return [gp ? (t.wins + (t.ties || 0) / 2) / gp : 0, t.wins];
  };
  return [...teams].sort((a, b) => {
    const [a1, a2] = score(a); const [b1, b2] = score(b);
    return b1 - a1 || b2 - a2 || a.abbr.localeCompare(b.abbr);
  }).map((t) => t.abbr);
}

// 3 points for the exact spot, 1 point for one spot off.
export function scoreStandings(predicted, actual) {
  const pos = new Map(actual.map((abbr, i) => [abbr, i]));
  let points = 0; let exact = 0;
  predicted.forEach((abbr, i) => {
    if (!pos.has(abbr)) return;
    const d = Math.abs(pos.get(abbr) - i);
    if (d === 0) { points += 3; exact++; } else if (d === 1) points += 1;
  });
  return { points, exact, max: actual.length * 3 };
}
