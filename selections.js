// Pick Six — what players can be picked for: single awards (Awards tab) and
// whole teams with every slot (All-Stars tab). Data only, no DOM.
//
// A sheet has sections of slots. `pos` lists position codes that fit a slot (used to sort
// search results; any player can still be chosen). `filter` limits players to a conference
// or division. Sheets in the same `group` (e.g. All-NBA 1st/2nd/3rd) can't share a player.

const S = (label, n, pos) => ({ label, n, pos });
const F = ['C', 'LW', 'RW', 'F', 'W'];
const NBA_GUARDS = ['PG', 'SG', 'G'];
const NBA_FRONT = ['SF', 'PF', 'F', 'C', 'FC', 'GF'];

// ----- Awards: one winner each, 3 points -----
const award = (id, title, note) => ({ id, title, note, sections: [S('Pick', 1)], points: 3 });

export const AWARDS = {
  nfl: [
    award('mvp', 'MVP', 'Most Valuable Player'),
    award('opoy', 'Offensive Player of the Year'),
    award('dpoy', 'Defensive Player of the Year'),
    award('oroy', 'Offensive Rookie of the Year'),
    award('droy', 'Defensive Rookie of the Year'),
    award('cpoy', 'Comeback Player of the Year'),
    award('sbmvp', 'Super Bowl MVP'),
  ],
  nba: [
    award('mvp', 'MVP', 'Most Valuable Player'),
    award('roy', 'Rookie of the Year'),
    award('dpoy', 'Defensive Player of the Year'),
    award('smoy', 'Sixth Man of the Year'),
    award('mip', 'Most Improved Player'),
    award('clutch', 'Clutch Player of the Year'),
    award('fmvp', 'Finals MVP'),
  ],
  nhl: [
    award('hart', 'Hart Trophy', 'MVP'),
    award('vezina', 'Vezina Trophy', 'Best goalie'),
    award('norris', 'Norris Trophy', 'Best defenceman'),
    award('calder', 'Calder Trophy', 'Rookie of the year'),
    award('rocket', 'Rocket Richard Trophy', 'Most goals'),
    award('connsmythe', 'Conn Smythe Trophy', 'Playoff MVP'),
  ],
  mlb: [
    award('almvp', 'AL MVP'), award('nlmvp', 'NL MVP'),
    award('alcy', 'AL Cy Young'), award('nlcy', 'NL Cy Young'),
    award('alroy', 'AL Rookie of the Year'), award('nlroy', 'NL Rookie of the Year'),
    award('wsmvp', 'World Series MVP'),
  ],
};

// ----- Teams: every slot, 1 point per player who really makes that team -----
const team = (id, title, sections, extra = {}) => ({ id, title, sections, points: 1, ...extra });

const nbaAllStar = (conf) => team(`allstar-${conf.toLowerCase()}`, `${conf} All-Stars`, [
  S('Starters · Backcourt', 2, NBA_GUARDS),
  S('Starters · Frontcourt', 3, NBA_FRONT),
  S('Reserves', 7),
], { heading: 'All-Star Game', filter: { conference: conf } });
const five = (id, title, heading, group) => team(id, title, [S('Players', 5)], { heading, group });

const proBowl = (conf) => team(`probowl-${conf.toLowerCase()}`, `${conf} Pro Bowl`, [
  S('Quarterbacks', 3, ['QB']), S('Running backs', 3, ['RB']), S('Fullback', 1, ['FB', 'RB']),
  S('Wide receivers', 4, ['WR']), S('Tight ends', 2, ['TE']),
  S('Tackles', 3, ['OT', 'T']), S('Guards', 3, ['G', 'OG']), S('Centers', 2, ['C']),
  S('Defensive ends', 3, ['DE', 'EDGE']), S('Interior linemen', 3, ['DT', 'NT']),
  S('Outside linebackers', 3, ['OLB', 'LB']), S('Inside linebackers', 2, ['ILB', 'LB', 'MLB']),
  S('Cornerbacks', 4, ['CB']), S('Safeties', 3, ['S', 'FS', 'SS']),
  S('Kicker', 1, ['PK', 'K']), S('Punter', 1, ['P']), S('Long snapper', 1, ['LS']),
  S('Return specialist', 1, ['WR', 'RB', 'CB']), S('Special teamer', 1),
], { heading: 'Pro Bowl', filter: { conference: conf } });
const allPro = (tier) => team(`allpro-${tier}`, `All-Pro ${tier === 1 ? 'First' : 'Second'} Team`, [
  S('Quarterback', 1, ['QB']), S('Running back', 1, ['RB']), S('Fullback', 1, ['FB', 'RB']),
  S('Wide receivers', 3, ['WR']), S('Tight end', 1, ['TE']),
  S('Tackles', 2, ['OT', 'T']), S('Guards', 2, ['G', 'OG']), S('Center', 1, ['C']),
  S('Edge rushers', 2, ['DE', 'EDGE', 'OLB']), S('Interior linemen', 2, ['DT', 'NT']),
  S('Linebackers', 2, ['LB', 'ILB', 'OLB', 'MLB']), S('Cornerbacks', 2, ['CB']), S('Safeties', 2, ['S', 'FS', 'SS']),
  S('Kicker', 1, ['PK', 'K']), S('Punter', 1, ['P']), S('Returner', 1, ['WR', 'RB', 'CB']),
], { heading: 'All-Pro', group: 'allpro' });

const nhlDivision = (div) => team(`allstar-${div.toLowerCase()}`, `${div} All-Stars`, [
  S('Forwards', 6, F), S('Defence', 3, ['D']), S('Goalies', 2, ['G']),
], { heading: 'All-Star Game', filter: { division: div } });
const nhlTeam = (id, title, heading, group) => team(id, title, [
  S('Centre', 1, ['C']), S('Left wing', 1, ['LW', 'W']), S('Right wing', 1, ['RW', 'W']),
  S('Defence', 2, ['D']), S('Goalie', 1, ['G']),
], { heading, group });

const mlbAllStar = (lg) => team(`allstar-${lg.toLowerCase()}`, `${lg} All-Stars`, [
  S('Starting catcher', 1, ['C']), S('Starting first base', 1, ['1B']), S('Starting second base', 1, ['2B']),
  S('Starting third base', 1, ['3B']), S('Starting shortstop', 1, ['SS']),
  S('Starting outfield', 3, ['LF', 'CF', 'RF', 'OF']), S('Starting DH', 1, ['DH']),
  S('Pitchers', 12, ['SP', 'RP', 'P']), S('Reserves', 11),
], { heading: 'All-Star Game', filter: { conference: lg } });
const allMlb = (tier) => team(`allmlb-${tier}`, `All-MLB ${tier === 1 ? 'First' : 'Second'} Team`, [
  S('Catcher', 1, ['C']), S('First base', 1, ['1B']), S('Second base', 1, ['2B']), S('Third base', 1, ['3B']),
  S('Shortstop', 1, ['SS']), S('Outfield', 3, ['LF', 'CF', 'RF', 'OF']), S('DH', 1, ['DH']),
  S('Starting pitchers', 5, ['SP', 'P']), S('Relief pitchers', 2, ['RP', 'P']),
], { heading: 'All-MLB', group: 'allmlb' });

export const TEAMS = {
  nba: [
    nbaAllStar('East'), nbaAllStar('West'),
    five('allnba-1', 'All-NBA First Team', 'All-NBA', 'allnba'),
    five('allnba-2', 'All-NBA Second Team', 'All-NBA', 'allnba'),
    five('allnba-3', 'All-NBA Third Team', 'All-NBA', 'allnba'),
    five('alldef-1', 'All-Defensive First Team', 'All-Defensive', 'alldef'),
    five('alldef-2', 'All-Defensive Second Team', 'All-Defensive', 'alldef'),
    five('allrookie-1', 'All-Rookie First Team', 'All-Rookie', 'allrookie'),
    five('allrookie-2', 'All-Rookie Second Team', 'All-Rookie', 'allrookie'),
  ],
  nfl: [proBowl('AFC'), proBowl('NFC'), allPro(1), allPro(2)],
  nhl: [
    nhlDivision('Atlantic'), nhlDivision('Metropolitan'), nhlDivision('Central'), nhlDivision('Pacific'),
    nhlTeam('allstarteam-1', 'First All-Star Team', 'NHL All-Star Teams', 'nhlteam'),
    nhlTeam('allstarteam-2', 'Second All-Star Team', 'NHL All-Star Teams', 'nhlteam'),
    nhlTeam('allrookie', 'All-Rookie Team', 'All-Rookie'),
  ],
  mlb: [mlbAllStar('AL'), mlbAllStar('NL'), allMlb(1), allMlb(2)],
};

export const TEAMS_TAB_NAME = { nfl: 'Pro Bowl', nba: 'All-Stars', nhl: 'All-Stars', mlb: 'All-Stars' };

export const slotCount = (sheet) => sheet.sections.reduce((n, s) => n + s.n, 0);

// Section + slot index → flat position in the stored array, and back.
export function slotIndex(sheet, sectionIdx, i) {
  let n = 0;
  for (let s = 0; s < sectionIdx; s++) n += sheet.sections[s].n;
  return n + i;
}
export function sectionOf(sheet, flat) {
  let n = 0;
  for (let s = 0; s < sheet.sections.length; s++) {
    if (flat < n + sheet.sections[s].n) return sheet.sections[s];
    n += sheet.sections[s].n;
  }
  return null;
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
