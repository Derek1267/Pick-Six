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

// Well-known players, roughly best first. Used for suggestions anywhere there are no odds:
// All-Star and year-end spots, and awards without a favourites list. Teams and positions come
// from the players table, so trades show up automatically; names not found there are skipped.
export const STARS = {
  nba: [
    'Shai Gilgeous-Alexander', 'Nikola Jokic', 'Victor Wembanyama', 'Luka Doncic', 'Giannis Antetokounmpo', 'Jayson Tatum',
    'Anthony Edwards', 'Cade Cunningham', 'Jalen Brunson', 'Donovan Mitchell', 'Tyrese Haliburton', 'Jaylen Brown',
    'Stephen Curry', 'LeBron James', 'Kevin Durant', 'Devin Booker', 'Karl-Anthony Towns', 'Jalen Williams', 'Chet Holmgren',
    'Evan Mobley', 'Paolo Banchero', 'Franz Wagner', 'Jamal Murray', 'Tyrese Maxey', 'Joel Embiid', 'Anthony Davis',
    'Kawhi Leonard', 'James Harden', 'De\'Aaron Fox', 'Trae Young', 'Jalen Johnson', 'Scottie Barnes', 'Alperen Sengun',
    'Amen Thompson', 'Bam Adebayo', 'Pascal Siakam', 'Zion Williamson', 'Domantas Sabonis', 'Lauri Markkanen', 'Ja Morant',
    'Jaren Jackson Jr.', 'Darius Garland', 'Derrick White', 'Ivica Zubac', 'Rudy Gobert', 'Ausar Thompson', 'Josh Hart',
    'OG Anunoby', 'Mikal Bridges', 'Dyson Daniels', 'Jalen Duren', 'Stephon Castle', 'Cooper Flagg',
  ],
  nfl: [
    'Josh Allen', 'Lamar Jackson', 'Joe Burrow', 'Patrick Mahomes', 'Jalen Hurts', 'Jayden Daniels', 'Brock Purdy', 'Justin Herbert',
    'Jared Goff', 'Baker Mayfield', 'Drake Maye', 'Trevor Lawrence', 'Saquon Barkley', 'Jahmyr Gibbs', 'Bijan Robinson',
    'Derrick Henry', 'Christian McCaffrey', 'Jonathan Taylor', "De'Von Achane", 'Josh Jacobs', 'Kyle Juszczyk', 'Patrick Ricard',
    "Ja'Marr Chase", 'Justin Jefferson', 'CeeDee Lamb', 'Puka Nacua', 'Amon-Ra St. Brown', 'Jaxon Smith-Njigba', 'Malik Nabers',
    'Nico Collins', 'A.J. Brown', 'Brian Thomas Jr.', 'Ladd McConkey', 'Trey McBride', 'Brock Bowers', 'George Kittle', 'Sam LaPorta',
    'Penei Sewell', 'Tristan Wirfs', 'Lane Johnson', 'Trent Williams', 'Rashawn Slater', 'Jordan Mailata', 'Quinn Meinerz',
    'Joe Thuney', 'Chris Lindstrom', 'Tyler Smith', 'Landon Dickerson', 'Creed Humphrey', 'Frank Ragnow', 'Tyler Linderbaum',
    'Myles Garrett', 'Micah Parsons', 'T.J. Watt', 'Will Anderson Jr.', 'Aidan Hutchinson', 'Nik Bonitto', 'Trey Hendrickson',
    'Maxx Crosby', 'Chris Jones', 'Dexter Lawrence II', 'Jalen Carter', 'Jeffery Simmons', 'Zach Allen', 'Fred Warner',
    'Roquan Smith', 'Zack Baun', 'Bobby Wagner', 'Jack Campbell', 'Patrick Surtain II', 'Derek Stingley Jr.', 'Sauce Gardner',
    'Christian Gonzalez', 'Kyle Hamilton', 'Kerby Joseph', 'Brian Branch', 'Xavier McKinney', 'Jessie Bates III',
    'Cooper DeJean', 'Brandon Aubrey', 'Cameron Dicker', 'Chris Boswell', 'Jordan Stout', 'Logan Cooke', 'Kavontae Turpin', 'Marvin Mims Jr.',
  ],
  nhl: [
    'Connor McDavid', 'Nathan MacKinnon', 'Nikita Kucherov', 'Leon Draisaitl', 'Kirill Kaprizov', 'Auston Matthews', 'Macklin Celebrini',
    'David Pastrnak', 'Mitch Marner', 'Jack Eichel', 'Sidney Crosby', 'Jack Hughes', 'Matthew Tkachuk', 'Aleksander Barkov',
    'Mikko Rantanen', 'Kyle Connor', 'Artemi Panarin', 'Brady Tkachuk', 'Tim Stutzle', 'Sebastian Aho', 'Brayden Point',
    'Jason Robertson', 'Nick Suzuki', 'Cole Caufield', 'Clayton Keller', 'Martin Necas', 'William Nylander', 'Sam Reinhart',
    'Wyatt Johnston', 'Dylan Larkin', 'Adrian Kempe', 'Kevin Fiala', 'Tage Thompson', 'Jake Guentzel', 'Matt Boldy',
    'Cale Makar', 'Quinn Hughes', 'Zach Werenski', 'Evan Bouchard', 'Rasmus Dahlin', 'Roman Josi', 'Victor Hedman', 'Miro Heiskanen',
    'Adam Fox', 'Josh Morrissey', 'Lane Hutson', 'Moritz Seider', 'Jakob Chychrun', 'Noah Dobson', 'Charlie McAvoy', 'Jaccob Slavin',
    'Connor Hellebuyck', 'Andrei Vasilevskiy', 'Igor Shesterkin', 'Jake Oettinger', 'Ilya Sorokin', 'Jesper Wallstedt', 'Logan Thompson',
    'Sergei Bobrovsky', 'Jeremy Swayman', 'Linus Ullmark', 'Juuse Saros', 'Filip Gustavsson', 'Pyotr Kochetkov', 'Mackenzie Blackwood',
  ],
  mlb: [
    'Shohei Ohtani', 'Aaron Judge', 'Bobby Witt Jr.', 'Juan Soto', 'Cal Raleigh', 'Kyle Tucker', 'Mookie Betts', 'Freddie Freeman',
    'Jose Ramirez', 'Gunnar Henderson', 'Francisco Lindor', 'Julio Rodriguez', 'Pete Crow-Armstrong', 'Corbin Carroll', 'Ronald Acuna Jr.',
    'Fernando Tatis Jr.', 'Vladimir Guerrero Jr.', 'Yordan Alvarez', 'Junior Caminero', 'Kyle Schwarber', 'Pete Alonso', 'Matt Olson',
    'Bryce Harper', 'Manny Machado', 'Elly De La Cruz', 'Corey Seager', 'Jazz Chisholm Jr.', 'Ketel Marte', 'Jose Altuve',
    'Will Smith', 'William Contreras', 'Adley Rutschman', 'Salvador Perez', 'Riley Greene', 'Jackson Chourio', 'James Wood',
    'Wyatt Langford', 'Jarren Duran', 'Byron Buxton', 'Austin Riley', 'Rafael Devers', 'Brent Rooker', 'Marcell Ozuna',
    'Tarik Skubal', 'Paul Skenes', 'Garrett Crochet', 'Zack Wheeler', 'Cristopher Sanchez', 'Jacob Misiorowski', 'Chris Sale',
    'Logan Webb', 'Yoshinobu Yamamoto', 'Hunter Brown', 'Cam Schlittler', 'Dylan Cease', 'Max Fried', 'Logan Gilbert', 'Jacob deGrom',
    'Framber Valdez', 'Hunter Greene', 'Shota Imanaga', 'Bryan Woo', 'Emmanuel Clase', 'Josh Hader', 'Edwin Diaz', 'Mason Miller',
    'Andres Munoz', 'Cade Smith', 'Aroldis Chapman', 'Devin Williams', 'Robert Suarez', 'Jhoan Duran', 'Raisel Iglesias',
  ],
  mls: [
    'Lionel Messi', 'Denis Bouanga', 'Sam Surridge', 'Hany Mukhtar', 'Anders Dreyer', 'Evander', 'Diego Rossi', 'Cucho Hernandez',
    'Christian Benteke', 'Petar Musa', 'Philip Zinckernagel', 'Rodrigo De Paul', 'Luis Suarez', 'Hugo Cuypers', 'Brian White',
    'Sebastian Berhalter', 'Emil Forsberg', 'Carles Gil', 'Thiago Almada', 'Ricard Puig', 'Gabriel Pec', 'Jack McGlynn',
    'Diego Luna', 'Cristian Arango', 'Josef Martinez', 'Kevin Denkey', 'Dejan Joveljic', 'Wilfried Zaha', 'Tai Baribo',
    'Andres Reyes', 'Tristan Blackmon', 'Jakob Glesnes', 'Kai Wagner', 'Walker Zimmerman', 'Jordi Alba', 'Ranko Veselinovic',
    'Steven Moreira', 'Michael Boxall', 'Tim Parker', 'Alex Freeman', 'Andy Najar', 'DeAndre Yedlin', 'Miles Robinson',
    'Matt Freese', 'Dayne St. Clair', 'Roman Celentano', 'Yohei Takaoka', 'Brad Stuver', 'Kristijan Kahlina', 'Joe Willis', 'Hugo Lloris',
  ],
  nll: [
    'Dhane Smith', 'Jeff Teat', 'Josh Byrne', 'Mitch Jones', 'Chris Boushy', 'Connor Fields', 'Tyson Bell', 'Lyle Thompson',
    'Ryan Lee', 'Christian Del Bianco', 'Dillon Ward', 'Nick Rose', 'Matt Vinc', 'Frank Scigliano', 'Zach Higgins',
    'Mitch de Snoo', 'Latrell Harris', 'Graeme Hossack', 'Jake Withers', 'Reid Bowering', 'Zed Williams', 'Clarke Petterson',
    'Callum Crawford', 'Wesley Berg', 'Robert Church', 'Shayne Jackson', 'Jesse King', 'Tanner Cook', 'Ian MacKay', 'Randy Staats',
  ],
};

// Awards where a list of stars would be wrong (rookies, newcomers, comebacks): no suggestions.
export const NO_SUGGESTIONS = /roy|calder|rookie|young|newcomer|comeback|cpoy|teammate|sportsmanship|humanitarian|socialjustice|clemente|hustle|goal$/;
