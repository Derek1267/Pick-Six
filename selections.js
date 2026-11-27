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
// Football position groups (ESPN lists most linebackers as LB and safeties as S).
const OT = ['OT', 'T', 'OL'];
const OG = ['G', 'OG', 'OL'];
const OC = ['C', 'OL'];
const EDGE = ['DE', 'OLB', 'LB'];
const DL = ['DT', 'NT', 'DE'];
const LB = ['LB', 'OLB', 'ILB', 'MLB'];
const CB = ['CB', 'DB'];
const SAF = ['S', 'FS', 'SS', 'DB'];

// ---------------------------------------------------------------------------
// Awards (3 points each)
// ---------------------------------------------------------------------------

const award = (id, title, note, more = {}) => ({ id, title, note, sections: [S('Pick', 1, more.pos ? { pos: more.pos } : {})], points: 3, ...more });
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
    teamAward('coy', 'Coach of the Year', 'Red Auerbach Trophy', { cat: 'staff' }),
    teamAward('eoy', 'Executive of the Year', 'Front office', { cat: 'staff' }),
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
    teamAward('coy', 'Coach of the Year', 'Head coach', { cat: 'staff' }),
    teamAward('aoy', 'Assistant Coach of the Year', 'Pick the team’s staff', { cat: 'staff' }),
    award('sbmvp', 'Super Bowl MVP', 'Pete Rozelle Trophy', { cat: 'post' }),
    award('wpmoy', 'Walter Payton Man of the Year', null, { cat: 'character' }),
  ],
  nhl: [
    award('hart', 'Hart Trophy', 'Most valuable player', { cat: 'season' }),
    award('lindsay', 'Ted Lindsay Award', 'Best player, voted by players', { cat: 'season' }),
    award('vezina', 'Vezina Trophy', 'Best goaltender', { cat: 'season', pos: ['G'] }),
    award('norris', 'Norris Trophy', 'Best defenceman', { cat: 'season', pos: ['D'] }),
    award('calder', 'Calder Trophy', 'Rookie of the year', { cat: 'season' }),
    award('selke', 'Selke Trophy', 'Best defensive forward', { cat: 'season', pos: ['C', 'LW', 'RW'] }),
    award('artross', 'Art Ross Trophy', 'Most points', { cat: 'stats', pos: ['C', 'LW', 'RW', 'D'] }),
    award('rocket', 'Rocket Richard Trophy', 'Most goals', { cat: 'stats', pos: ['C', 'LW', 'RW', 'D'] }),
    award('jennings', 'William M. Jennings Trophy', 'Fewest goals against', { cat: 'stats', pos: ['G'] }),
    teamAward('adams', 'Jack Adams Award', 'Coach of the year', { cat: 'staff' }),
    teamAward('gm', 'General Manager of the Year', 'Front office', { cat: 'staff' }),
    award('connsmythe', 'Conn Smythe Trophy', 'Playoff MVP', { cat: 'post' }),
    award('byng', 'Lady Byng Trophy', 'Sportsmanship', { cat: 'character' }),
    award('masterton', 'Masterton Trophy', 'Perseverance and dedication', { cat: 'character' }),
    award('clancy', 'King Clancy Trophy', 'Leadership and community', { cat: 'character' }),
  ],
  mlb: [
    award('almvp', 'AL MVP', null, { cat: 'season', filter: { conference: 'AL' } }),
    award('nlmvp', 'NL MVP', null, { cat: 'season', filter: { conference: 'NL' } }),
    award('alcy', 'AL Cy Young', null, { cat: 'season', filter: { conference: 'AL' }, pos: ['SP', 'RP'] }),
    award('nlcy', 'NL Cy Young', null, { cat: 'season', filter: { conference: 'NL' }, pos: ['SP', 'RP'] }),
    award('alroy', 'AL Rookie of the Year', null, { cat: 'season', filter: { conference: 'AL' } }),
    award('nlroy', 'NL Rookie of the Year', null, { cat: 'season', filter: { conference: 'NL' } }),
    award('alrel', 'AL Reliever of the Year', 'Mariano Rivera Award', { cat: 'season', filter: { conference: 'AL' }, pos: ['RP'] }),
    award('nlrel', 'NL Reliever of the Year', 'Trevor Hoffman Award', { cat: 'season', filter: { conference: 'NL' }, pos: ['RP'] }),
    award('alcomeback', 'AL Comeback Player', null, { cat: 'season', filter: { conference: 'AL' } }),
    award('nlcomeback', 'NL Comeback Player', null, { cat: 'season', filter: { conference: 'NL' } }),
    award('alaaron', 'AL Hank Aaron Award', 'Best hitter', { cat: 'stats', filter: { conference: 'AL' }, pos: ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'OF', 'DH'] }),
    award('nlaaron', 'NL Hank Aaron Award', 'Best hitter', { cat: 'stats', filter: { conference: 'NL' }, pos: ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'OF', 'DH'] }),
    teamAward('almoy', 'AL Manager of the Year', 'Manager', { cat: 'staff', filter: { conference: 'AL' } }),
    teamAward('nlmoy', 'NL Manager of the Year', 'Manager', { cat: 'staff', filter: { conference: 'NL' } }),
    award('alcsmvp', 'ALCS MVP', null, { cat: 'post', filter: { conference: 'AL' } }),
    award('nlcsmvp', 'NLCS MVP', null, { cat: 'post', filter: { conference: 'NL' } }),
    award('wsmvp', 'World Series MVP', 'Willie Mays Award', { cat: 'post' }),
    award('asgmvp', 'All-Star Game MVP', 'Ted Williams Award', { cat: 'events' }),
    award('clemente', 'Roberto Clemente Award', null, { cat: 'character' }),
  ],
  mls: [
    award('mvp', 'Most Valuable Player', 'Landon Donovan MVP', { cat: 'season' }),
    award('gk', 'Goalkeeper of the Year', null, { cat: 'season', pos: ['G', 'GK'] }),
    award('defender', 'Defender of the Year', null, { cat: 'season', pos: ['D'] }),
    award('young', 'Young Player of the Year', 'Age 22 and under', { cat: 'season' }),
    award('newcomer', 'Newcomer of the Year', 'New to MLS', { cat: 'season' }),
    award('comeback', 'Comeback Player of the Year', null, { cat: 'season' }),
    award('boot', 'Golden Boot', 'Most goals', { cat: 'stats', pos: ['F', 'M'] }),
    award('assists', 'Assists leader', 'Most assists', { cat: 'stats', pos: ['M', 'F'] }),
    teamAward('coy', 'Coach of the Year', 'Sigi Schmid Award', { cat: 'staff' }),
    award('cupmvp', 'MLS Cup MVP', null, { cat: 'post' }),
    award('goal', 'Goal of the Year', null, { cat: 'events' }),
    award('asgmvp', 'All-Star Game MVP', null, { cat: 'events' }),
    award('humanitarian', 'Humanitarian of the Year', null, { cat: 'character' }),
  ],
  nll: [
    award('mvp', 'Most Valuable Player', null, { cat: 'season' }),
    award('roy', 'Rookie of the Year', null, { cat: 'season' }),
    award('goalie', 'Goaltender of the Year', null, { cat: 'season', pos: ['G'] }),
    award('dpoy', 'Defensive Player of the Year', null, { cat: 'season', pos: ['D', 'T'] }),
    award('transition', 'Transition Player of the Year', null, { cat: 'season', pos: ['T'] }),
    award('points', 'Scoring leader', 'Most points', { cat: 'stats', pos: ['F', 'T'] }),
    award('goals', 'Goals leader', 'Most goals', { cat: 'stats', pos: ['F', 'T'] }),
    teamAward('coy', 'Coach of the Year', 'Les Bartley Award', { cat: 'staff' }),
    teamAward('gm', 'GM of the Year', 'Front office', { cat: 'staff' }),
    award('finalsmvp', 'Finals MVP', null, { cat: 'post' }),
    award('sportsmanship', 'Sportsmanship Award', null, { cat: 'character' }),
    award('teammate', 'Teammate of the Year', null, { cat: 'character' }),
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
        OT, OT, OT, OG, OG, OG, OC, OC],
    }),
    S('Defense', 18, {
      labels: ['DE', 'DE', 'DE', 'DT', 'DT', 'DT', 'OLB', 'OLB', 'OLB', 'ILB', 'ILB', 'CB', 'CB', 'CB', 'CB', 'S', 'S', 'S'],
      posBySlot: [EDGE, EDGE, EDGE, DL, DL, DL, LB, LB, LB, LB, LB, CB, CB, CB, CB, SAF, SAF, SAF],
    }),
    S('Special teams', 5, { labels: ['K', 'P', 'LS', 'RET', 'ST'], posBySlot: [['PK', 'K'], ['P'], ['LS'], null, null] }),
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

// Soccer: a 4-3-3 on the pitch, attack at the top. Slots: 0 GK, 1–4 defenders, 5–7 midfielders, 8–10 forwards.
const XI_LABELS = ['GK', 'D', 'D', 'D', 'D', 'M', 'M', 'M', 'F', 'F', 'F'];
const XI_POS = [['G', 'GK'], ['D'], ['D'], ['D'], ['D'], ['M'], ['M'], ['M'], ['F'], ['F'], ['F']];
const XI_LAYOUT = { surface: 'pitch', groups: [{ rows: [[_, 8, _, 9, _, 10, _], [_, 5, _, 6, _, 7, _], [1, _, 2, _, 3, _, 4], [_, _, _, 0, _, _, _]] }] };

const mlsAllStar = () => ({
  id: 'allstar-mls', side: 'MLS', title: 'MLS All-Stars', points: 1,
  sections: [
    S('Starting XI', 11, { size: 'big', labels: XI_LABELS, posBySlot: XI_POS }),
    S('Reserves', 15, { kind: 'reserve' }),
    extras,
  ],
  layout: XI_LAYOUT,
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
    S('Reserves', 11, { kind: 'reserve', pos: ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'OF', 'DH'] }),
    extras,
  ],
  layout: { surface: 'diamond', groups: [{ rows: DIAMOND }] },
});

export const ALLSTARS = {
  nba: [nbaAllStar('East'), nbaAllStar('West')],
  nfl: [proBowl('AFC'), proBowl('NFC')],
  nhl: ['Atlantic', 'Metropolitan', 'Central', 'Pacific'].map(nhlDivision),
  mlb: [mlbAllStar('AL'), mlbAllStar('NL')],
  mls: [mlsAllStar()],
  nll: [], // the NLL has no All-Star game
};
export const ALLSTAR_NAME = { nfl: 'Pro Bowl', nba: 'All-Stars', nhl: 'All-Stars', mlb: 'All-Stars', mls: 'All-Stars', nll: 'All-Stars' };

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
    posBySlot: [['QB'], ['RB'], ['FB', 'RB'], ['WR'], ['WR'], ['WR'], ['TE'], OT, OT, OG, OG, OC],
  }),
  S('Defense', 12, {
    labels: ['EDGE', 'EDGE', 'DT', 'DT', 'LB', 'LB', 'CB', 'CB', 'S', 'S', 'NB', 'DB'],
    posBySlot: [EDGE, EDGE, DL, DL, LB, LB, CB, CB, SAF, SAF, CB, [...CB, ...SAF]],
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

// Box lacrosse: three forwards up top, two defenders, the goalie in net.
const nllTeam = (tier) => ({
  ...yearEnd(`allnll-${tier}`, `${tier === 1 ? 'First' : 'Second'} Team`, 'All-NLL', 'allnll', [
    S('Lineup', 6, { size: 'big', labels: ['F', 'F', 'F', 'D', 'D', 'G'], posBySlot: [['F', 'T'], ['F', 'T'], ['F', 'T'], ['D', 'T'], ['D', 'T'], ['G']] }),
  ]),
  layout: { surface: 'rink', groups: [{ rows: [[0, 1, 2], [3, _, 4], [_, 5, _]] }] },
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
  mls: [{ ...yearEnd('bestxi', 'Best XI', 'MLS Best XI', null, [S('Starting XI', 11, { size: 'big', labels: XI_LABELS, posBySlot: XI_POS })]), layout: XI_LAYOUT }],
  nll: [nllTeam(1), nllTeam(2)],
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
// Positions a slot is limited to. Football is strict (no quarterback at safety); hockey keeps
// goalies in net and baseball keeps pitchers and hitters apart. Basketball is positionless.
const PITCHERS = ['SP', 'RP', 'P'];
export function slotRule(sport, sheet, flat) {
  const fit = slotPositions(sheet, flat);
  if (sport === 'nfl') return fit?.length ? { only: fit } : null;
  if (sport === 'nhl' && fit?.length) return fit.includes('G') ? { only: ['G'] } : { not: ['G'] };
  if (sport === 'nll' && sheet.layout) return fit?.includes('G') ? { only: ['G'] } : { not: ['G'] };
  if (sport === 'mls' && fit?.length) return fit.includes('G') ? { only: ['G', 'GK'] } : { not: ['G', 'GK'] };
  if (sport === 'mlb' && fit?.length) return fit.some((p) => PITCHERS.includes(p)) ? { only: PITCHERS } : { not: PITCHERS };
  return null;
}

// Suggestions for one spot from a ranked pool of players: only players who fit the spot,
// exact position first (an LF spot shows left fielders before other outfielders), and for
// open spots (reserves, injury replacements) a spread of positions rather than five of one.
export function suggestFor(sport, sheet, flat, pool, { isAward = false } = {}) {
  const fit = slotPositions(sheet, flat);
  const rule = slotRule(sport, sheet, flat);
  const label = slotLabel(sheet, flat);
  const sec = sectionOf(sheet, flat);
  const open = !fit?.length;
  // A named special-teams role with no position (returner, long snapper…): nobody to suggest.
  if (open && !isAward && label && sec && !['alt', 'reserve'].includes(sec.kind) && sport !== 'nba') return [];
  const ok = (p) => (!rule?.only || rule.only.includes(p.position)) && (!rule?.not || !rule.not.includes(p.position))
    && (open || fit.includes(p.position));
  // Exact position first (a DT spot shows DTs before DEs); otherwise keep the pool's order (best first).
  const rank = (p) => (p.position === label ? 0 : 1);
  const list = pool.filter(ok).map((p, i) => ({ p, i })).sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i).map((x) => x.p);
  if (!open || isAward || sport === 'nba' || sport === 'mls') return list.slice(0, 5);
  const seen = new Set();
  const spread = list.filter((p) => (seen.has(p.position) ? false : seen.add(p.position)));
  return [...spread, ...list.filter((p) => !spread.includes(p))].slice(0, 5);
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
    if (sport === 'mls') return [3 * t.wins + (t.ties || 0), t.wins]; // 3 points a win, 1 a draw
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
