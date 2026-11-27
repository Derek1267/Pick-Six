// Head coaches / managers and top front-office executives, by team abbreviation.
// Shown with teams on the coach and executive awards. Checked late November 2026;
// update when a team makes a change. A missing name just isn't shown.

export const STAFF_AS_OF = 'Nov 2026';

const t = (coach, exec) => ({ coach, exec });

export const STAFF = {
  nba: {
    ATL: t('Quin Snyder', 'Onsi Saleh'), BOS: t('Joe Mazzulla', 'Brad Stevens'), BKN: t('Jordi Fernández', 'Sean Marks'),
    CHA: t('Charles Lee', 'Jeff Peterson'), CHI: t('Tiago Splitter', 'Stephen Mervis'), CLE: t('Kenny Atkinson', 'Brandon Weems'),
    DAL: t('Dusty May', 'Mike Schmitz'), DEN: t('David Adelman', 'Ben Tenzer'), DET: t('J. B. Bickerstaff', 'Michael Blackstone'),
    GS: t('Steve Kerr', 'Mike Dunleavy Jr.'), HOU: t('Ime Udoka', 'Rafael Stone'), IND: t('Rick Carlisle', 'Chad Buchanan'),
    LAC: t('Tyronn Lue', 'Trent Redden'), LAL: t('JJ Redick', 'Rob Pelinka'), MEM: t('Tuomas Iisalo', 'Zach Kleiman'),
    MIA: t('Erik Spoelstra', 'Andy Elisburg'), MIL: t('Taylor Jenkins', 'Jon Horst'), MIN: t('Chris Finch', 'Matt Lloyd'),
    NO: t('Jamahl Mosley', 'Troy Weaver'), NY: t('Mike Brown', 'William Wesley'), OKC: t('Mark Daigneault', 'Sam Presti'),
    ORL: t('Sean Sweeney', 'Anthony Parker'), PHI: t('Nick Nurse', 'Jameer Nelson'), PHX: t('Jordan Ott', 'Brian Gregory'),
    POR: t('Micah Nori', 'Joe Cronin'), SAC: t('Doug Christie', 'Scott Perry'), SA: t('Mitch Johnson', 'Brian Wright'),
    TOR: t('Darko Rajaković', 'Bobby Webster'), UTAH: t('Will Hardy', 'Justin Zanik'), WSH: t('Brian Keefe', 'Will Dawkins'),
  },
  nfl: {
    ARI: t('Mike LaFleur', 'Monti Ossenfort'), ATL: t('Kevin Stefanski', 'Ian Cunningham'), BAL: t('Jesse Minter', 'Eric DeCosta'),
    BUF: t('Joe Brady', 'Brandon Beane'), CAR: t('Dave Canales', 'Dan Morgan'), CHI: t('Ben Johnson', 'Ryan Poles'),
    CIN: t('Zac Taylor', 'Duke Tobin'), CLE: t('Todd Monken', 'Andrew Berry'), DAL: t('Brian Schottenheimer', 'Jerry Jones'),
    DEN: t('Sean Payton', 'George Paton'), DET: t('Dan Campbell', 'Brad Holmes'), GB: t('Matt LaFleur', 'Brian Gutekunst'),
    HOU: t('DeMeco Ryans', 'Nick Caserio'), IND: t('Shane Steichen', 'Chris Ballard'), JAX: t('Liam Coen', 'James Gladstone'),
    KC: t('Andy Reid', 'Brett Veach'), LV: t('Klint Kubiak', 'John Spytek'), LAC: t('Jim Harbaugh', 'Joe Hortiz'),
    LAR: t('Sean McVay', 'Les Snead'), MIA: t('Jeff Hafley', 'Jon-Eric Sullivan'), MIN: t("Kevin O'Connell", 'Kwesi Adofo-Mensah'),
    NE: t('Mike Vrabel', 'Eliot Wolf'), NO: t('Kellen Moore', 'Mickey Loomis'), NYG: t('John Harbaugh', 'Joe Schoen'),
    NYJ: t('Aaron Glenn', 'Darren Mougey'), PHI: t('Nick Sirianni', 'Howie Roseman'), PIT: t('Mike McCarthy', 'Omar Khan'),
    SF: t('Kyle Shanahan', 'John Lynch'), SEA: t('Mike Macdonald', 'John Schneider'), TB: t('Todd Bowles', 'Jason Licht'),
    TEN: t('Robert Saleh', 'Mike Borgonzi'), WSH: t('Dan Quinn', 'Adam Peters'),
  },
  nhl: {
    ANA: t('Joel Quenneville', 'Pat Verbeek'), BOS: t('Marco Sturm', 'Don Sweeney'), BUF: t('Lindy Ruff', 'Jarmo Kekäläinen'),
    CGY: t('Ryan Huska', 'Craig Conroy'), CAR: t("Rod Brind'Amour", 'Eric Tulsky'), CHI: t('Jeff Blashill', 'Kyle Davidson'),
    COL: t('Jared Bednar', 'Joe Sakic'), CBJ: t('Rick Bowness', 'Don Waddell'), DAL: t('Glen Gulutzan', 'Jim Nill'),
    DET: t('Todd McLellan', 'Shawn Horcoff'), EDM: t('Mike Babcock', 'Stan Bowman'), FLA: t('Paul Maurice', 'Bill Zito'),
    LA: t('Peter Laviolette', 'Ken Holland'), MIN: t('John Hynes', 'Bill Guerin'), MTL: t('Martin St. Louis', 'Kent Hughes'),
    NSH: t('Andrew Brunette', 'Chris MacFarland'), NJ: t('Sheldon Keefe', 'Sunny Mehta'), NYI: t(null, 'Mathieu Darche'),
    NYR: t('Mike Sullivan', 'Chris Drury'), OTT: t('Travis Green', 'Steve Staios'), PHI: t('Rick Tocchet', 'Daniel Brière'),
    PIT: t(null, 'Kyle Dubas'), SJ: t('Ryan Warsofsky', 'Mike Grier'), SEA: t(null, 'Jason Botterill'),
    STL: t(null, 'Alexander Steen'), TB: t('Jon Cooper', 'Julien BriseBois'), TOR: t(null, 'John Chayka'),
    UTA: t('André Tourigny', 'Bill Armstrong'), VAN: t('Manny Malhotra', 'Ryan Johnson'), VGK: t('Ryan Craig', 'Kelly McCrimmon'),
    WSH: t('Spencer Carbery', 'Chris Patrick'), WPG: t('Scott Arniel', 'Kevin Cheveldayoff'),
  },
  mlb: {
    ARI: t('Torey Lovullo', 'Mike Hazen'), ATH: t('Mark Kotsay', null), ATL: t('Walt Weiss', 'Alex Anthopoulos'),
    BAL: t('Craig Albernaz', 'Mike Elias'), BOS: t('Chad Tracy', 'Craig Breslow'), CHC: t('Craig Counsell', 'Jed Hoyer'),
    CHW: t('Will Venable', 'Chris Getz'), CIN: t('Terry Francona', 'Nick Krall'), CLE: t('Stephen Vogt', 'Chris Antonetti'),
    COL: t('Warren Schaeffer', 'Paul DePodesta'), DET: t('A. J. Hinch', 'Scott Harris'), HOU: t('Brad Ausmus', 'Randy Flores'),
    KC: t('Matt Quatraro', 'J. J. Picollo'), LAA: t(null, 'Perry Minasian'), LAD: t('Dave Roberts', 'Andrew Friedman'),
    MIA: t('Clayton McCullough', 'Peter Bendix'), MIL: t('Pat Murphy', 'Matt Arnold'), MIN: t('Derek Shelton', 'Derek Falvey'),
    NYM: t('Andy Green', 'David Stearns'), NYY: t('Aaron Boone', 'Brian Cashman'), PHI: t('Don Mattingly', 'Dave Dombrowski'),
    PIT: t('Don Kelly', 'Ben Cherington'), SD: t('Craig Stammen', 'A. J. Preller'), SF: t('Tony Vitello', 'Buster Posey'),
    SEA: t('Jason Kanzler', 'Jerry Dipoto'), STL: t('Oliver Marmol', 'Chaim Bloom'), TB: t('Kevin Cash', null),
    TEX: t('Skip Schumaker', 'Ross Fenstermaker'), TOR: t('John Schneider', 'Ross Atkins'), WSH: t('Blake Butera', 'Paul Toboni'),
  },
};

// MLS and NLL are keyed by team name (matched loosely), since their feed abbreviations vary.
export const STAFF_BY_NAME = {
  mls: {
    'Atlanta United FC': t('Gerardo Martino'), 'Austin FC': t('Davy Arnaud (interim)'), 'Charlotte FC': t('Dean Smith'),
    'Chicago Fire FC': t('Gregg Berhalter'), 'FC Cincinnati': t('Pat Noonan'), 'Colorado Rapids': t('Matt Wells'),
    'Columbus Crew': t('Laurent Courtois (interim)'), 'FC Dallas': t('Eric Quill'), 'D.C. United': t('René Weiler'),
    'Houston Dynamo FC': t('Ben Olsen'), 'Inter Miami CF': t('Kily González'), 'LA Galaxy': t('Greg Vanney'),
    'Minnesota United FC': t('Cameron Knowles'), 'CF Montréal': t('Philippe Eullaffroy (interim)'), 'Nashville SC': t('B. J. Callaghan'),
    'New England Revolution': t('Marko Mitrović'), 'New York City FC': t('Pascal Jansen'), 'Red Bull New York': t('Michael Bradley'),
    'New York Red Bulls': t('Michael Bradley'), 'Orlando City SC': t('Martín Perelman (interim)'), 'Philadelphia Union': t('Ryan Richter (interim)'),
    'Portland Timbers': t('Martí Cifuentes'), 'Real Salt Lake': t('Pablo Mastroeni'), 'San Diego FC': t('Mikey Varas'),
    'San Jose Earthquakes': t('Bruce Arena'), 'Seattle Sounders FC': t('Brian Schmetzer'), 'Sporting Kansas City': t('Raphaël Wicky'),
    'St. Louis City SC': t('Yoann Damet'), 'Toronto FC': t('Robin Fraser'), 'Vancouver Whitecaps FC': t('Jesper Sørensen'),
  },
  nll: {
    'Buffalo Bandits': t('John Tavares'), 'Calgary Roughnecks': t('Josh Sanderson'), 'Colorado Mammoth': t('Pat Coyle'),
    'Georgia Swarm': t('Ed Comeau'), 'Halifax Thunderbirds': t('Mike Accursi'), 'Las Vegas Desert Dogs': t('Shawn Williams'),
    'Oshawa FireWolves': t('Glenn Clark'), 'Rochester Knighthawks': t('Randy Mearns'), 'San Diego Seals': t('Patrick Merrill'),
    'Saskatchewan Rush': t('Jimmy Quinlan'), 'Toronto Rock': t('Matt Sawyer'), 'Vancouver Warriors': t('Curt Malawsky'),
  },
};
const loose = (name) => String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z ]/g, ' ').split(/\s+/).filter((w) => w && !['fc', 'sc', 'cf'].includes(w)).join(' ');
export function staffFor(sport, abbr, name) {
  if (STAFF[sport]?.[abbr]) return STAFF[sport][abbr];
  const list = STAFF_BY_NAME[sport];
  if (!list) return null;
  const key = loose(name);
  return Object.entries(list).find(([n]) => loose(n) === key)?.[1] || null;
}

// Which name goes with which award: coaches for coach awards, executives for executive / GM awards.
export const STAFF_ROLE = {
  'nba:coy': 'coach', 'nba:eoy': 'exec',
  'nfl:coy': 'coach',
  'nhl:adams': 'coach', 'nhl:gm': 'exec',
  'mlb:almoy': 'coach', 'mlb:nlmoy': 'coach',
  'mls:coy': 'coach', 'nll:coy': 'coach',
};
