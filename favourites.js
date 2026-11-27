// Award favourites shown at the top of the pick popup, best first.
// Built from betting odds and award-voter polls in late November 2026. Names must match
// the players table (ESPN spelling, no accents). Team awards list team abbreviations.
// Awards not listed here fall back to: teams with the best record (team awards) or no list.

export const FAVOURITES_AS_OF = 'late Nov 2026';

export const FAVOURITES = {
  nba: {
    mvp: ['Victor Wembanyama', 'Luka Doncic', 'Shai Gilgeous-Alexander', 'Nikola Jokic', 'Jayson Tatum'],
    dpoy: ['Victor Wembanyama', 'Chet Holmgren', 'Ausar Thompson', 'Rudy Gobert', 'Bam Adebayo'],
    roy: ['Yaxel Lendeborg', 'Cameron Boozer', 'Darius Acuff Jr.', 'Caleb Wilson', 'Darryn Peterson'],
    smoy: ['Payton Pritchard', 'Naz Reid', 'Jaime Jaquez Jr.', 'Alex Caruso', 'DeMar DeRozan'],
    mip: ['Ty Jerome', 'Ajay Mitchell'],
  },
  nfl: {
    mvp: ['Joe Burrow', 'Josh Allen', 'Brock Purdy', 'Trevor Lawrence', 'Patrick Mahomes'],
    opoy: ['Jahmyr Gibbs', "Ja'Marr Chase", 'Saquon Barkley', 'Bijan Robinson', 'Jaxon Smith-Njigba'],
    dpoy: ['Will Anderson Jr.', 'Dallas Turner', 'Fred Warner', 'Jeffery Simmons', 'T.J. Watt'],
    oroy: ['Fernando Mendoza', 'Jeremiyah Love', 'Carnell Tate', 'Jadarian Price', 'Jordyn Tyson'],
    droy: ['Arvell Reese', 'David Bailey', 'Sonny Styles', 'Rueben Bain Jr.', 'Caleb Downs'],
    cpoy: ['Patrick Mahomes', 'Joe Burrow'],
  },
  nhl: {
    hart: ['Connor McDavid', 'Kirill Kaprizov', 'Nathan MacKinnon', 'Macklin Celebrini', 'Nikita Kucherov'],
    lindsay: ['Connor McDavid', 'Kirill Kaprizov', 'Nathan MacKinnon', 'Macklin Celebrini'],
    norris: ['Evan Bouchard', 'Quinn Hughes', 'Zach Werenski', 'Cale Makar'],
    calder: ['Jacob Fowler', 'Michael Brandsegg-Nygard', 'Roman Kantserov'],
    vezina: ['Jesper Wallstedt', 'Pyotr Kochetkov', 'Linus Ullmark', 'Jeremy Swayman', 'Jake Oettinger'],
    selke: ['Joel Eriksson Ek', 'Anthony Cirelli', 'Nick Suzuki', 'Sebastian Aho'],
    adams: ['BOS', 'CAR', 'OTT', 'MTL', 'EDM'],
    byng: ['Jack Hughes'],
  },
  // No 2027 odds yet: last season's award finalists instead (see FAVOURITE_TITLE).
  mlb: {
    almvp: ['Yordan Alvarez', 'Junior Caminero', 'Bobby Witt Jr.'],
    nlmvp: ['Pete Crow-Armstrong'],
    alcy: ['Cam Schlittler', 'Dylan Cease', 'Parker Messick'],
    nlcy: ['Jacob Misiorowski', 'Chris Sale', 'Cristopher Sanchez'],
  },
};

// Heading over a sport's list when it isn't current betting favourites.
export const FAVOURITE_TITLE = { mlb: '2026 finalists' };
