/* =============================================================
   HHST all-time team records — the record wall, snapshotted for
   Firestore. Ships to HHST.seedHistoricalRecords() from the admin
   "Seed historical records" button. That seed never overwrites an
   existing doc, so it's safe to re-run whenever a new season starts.

   Times are transcribed EXACTLY from the physical record boards
   posted at the pool. Records are all-time and permanent — they
   only change when a swim beats them, at which point the previous
   holder is archived into hhst_records/{id}/history/{autoId}.

   Distances by HHST bracket (all yards):
     6 & Under → 15y   |  7-8 / 9-10 → 25y  |  11-12 / 13-14 / 15-18 → 50y

   Relays are stored as a single record per gender + age group +
   relay type, with a `swimmers` array holding the 4-swimmer lineup.
   ============================================================= */
(function(global){

  // Per-bracket distance for the individual events on the wall.
  const BRACKET_DIST = {
    '6 & Under': '15',
    '7-8':       '25',
    '9-10':      '25',
    '11-12':     '50',
    '13-14':     '50',
    '15-18':     '50'
  };
  const STROKE_LABEL = { Free:'Free', Back:'Back', Breast:'Breast', Fly:'Fly' };

  // ---------- INDIVIDUAL RECORDS ----------
  const INDIVIDUAL = [
    { group:'6 & Under',
      girls:[
        { evt:'Free',   name:'J. Fishburn', time:'11.00' },
        { evt:'Back',   name:'J. Fishburn', time:'13.06' },
        { evt:'Breast', name:'S. Dixon',    time:'14.78' },
      ],
      boys:[
        { evt:'Free',   name:'T. Salvitti',  time:'9.46'  },
        { evt:'Back',   name:'D. Georges',   time:'11.72' },
        { evt:'Breast', name:'Justin Clark', time:'14.00' },
      ],
    },
    { group:'7-8',
      girls:[
        { evt:'Free',   name:'J. Fishburn', time:'16.40' },
        { evt:'Back',   name:'K. Harmon',   time:'19.78' },
        { evt:'Breast', name:'S. Dixon',    time:'21.32' },
        { evt:'Fly',    name:'A. Eklund',   time:'19.53' },
      ],
      boys:[
        { evt:'Free',   name:'Tristan Talwar', time:'14.60' },
        { evt:'Back',   name:'Tristan Talwar', time:'17.10' },
        { evt:'Breast', name:'Tristan Talwar', time:'19.11' },
        { evt:'Fly',    name:'Tristan Talwar', time:'15.72' },
      ],
    },
    { group:'9-10',
      girls:[
        { evt:'Free',   name:'Tara Talwar', time:'13.70' },
        { evt:'Back',   name:'S. Dixon',    time:'16.82' },
        { evt:'Breast', name:'Tara Talwar', time:'14.82' },
        { evt:'Fly',    name:'Tara Talwar', time:'14.50' },
      ],
      boys:[
        { evt:'Free',   name:'Tristan Talwar', time:'13.17' },
        { evt:'Back',   name:'Tristan Talwar', time:'15.31' },
        { evt:'Breast', name:'Tristan Talwar', time:'17.93' },
        { evt:'Fly',    name:'Tristan Talwar', time:'14.35' },
      ],
    },
    { group:'11-12',
      girls:[
        { evt:'Free',   name:'P. Fishburn', time:'27.79' },
        { evt:'Back',   name:'Tara Talwar', time:'32.63' },
        { evt:'Breast', name:'Tara Talwar', time:'35.00' },
        { evt:'Fly',    name:'Tara Talwar', time:'29.28' },
      ],
      boys:[
        { evt:'Free',   name:'Tristan Talwar', time:'26.99' },
        { evt:'Back',   name:'Tristan Talwar', time:'31.47' },
        { evt:'Breast', name:'Tristan Talwar', time:'34.56' },
        { evt:'Fly',    name:'Tristan Talwar', time:'28.85' },
      ],
    },
    { group:'13-14',
      girls:[
        { evt:'Free',   name:'Tara Talwar', time:'26.25' },
        { evt:'Back',   name:'Tara Talwar', time:'27.14' },
        { evt:'Breast', name:'Tara Talwar', time:'33.34' },
        { evt:'Fly',    name:'Tara Talwar', time:'31.13' },
      ],
      boys:[
        { evt:'Free',   name:'Colton Wade',   time:'24.41' },
        { evt:'Back',   name:'A. Chinchilla', time:'30.16' },
        { evt:'Breast', name:'S. Ankokar',    time:'32.53' },
        { evt:'Fly',    name:'S. Ankokar',    time:'29.97' },
      ],
    },
    { group:'15-18',
      girls:[
        { evt:'Free',   name:'Lauren Soleo', time:'25.94' },
        { evt:'Back',   name:'Tara Talwar',  time:'29.22' },
        { evt:'Breast', name:'Tara Talwar',  time:'35.44' },
        { evt:'Fly',    name:'Tara Talwar',  time:'27.20' },
      ],
      boys:[
        { evt:'Free',   name:'Colton Wade', time:'21.66' },
        { evt:'Back',   name:'Colton Wade', time:'25.52' },
        { evt:'Breast', name:'Colton Wade', time:'31.40' },
        { evt:'Fly',    name:'Colton Wade', time:'23.38' },
      ],
    },
  ];

  // ---------- RELAY RECORDS ----------
  // Each entry: 4-swimmer lineup + time. Distance is implied by bracket
  // (2x the individual distance for a 4-person relay — 4×15y at 6&U isn't
  // swum on this wall, so the youngest relay group is 7-8).
  const RELAY = [
    { group:'7-8',
      girls:[
        { type:'Medley Relay',    team:['A Eklund','S Yakoboy','T Talwar','K Harmon'],   time:'1:25.68' },
        { type:'Freestyle Relay', team:['S Dixon','L Reichardt','L Soleo','A Hugo'],     time:'1:16.34' },
      ],
      boys:[
        { type:'Medley Relay',    team:['C Fawsi','L McGann','I Vandevender','E Palonsky'], time:'1:22.84' },
        { type:'Freestyle Relay', team:['J Clark','M Hatfield','G Savage','D Georges'],     time:'1:13.84' },
      ],
    },
    { group:'9-10',
      girls:[
        { type:'Medley Relay',    team:['A Eklund','S Yakoboy','Tara Talwar','Maia Lyven'], time:'1:10.00' },
        { type:'Freestyle Relay', team:['R. Temple','C. Abin','S. Dixon','L. Soleo'],       time:'1:03.47' },
      ],
      boys:[
        { type:'Medley Relay',    team:['J Pullen','R Geason','J Bertolini-Felice','B Russel'], time:'1:12.04' },
        { type:'Freestyle Relay', team:['Seth McGann','T. Davis','M. Thomas','S. Ankokar'],     time:'1:02.34' },
      ],
    },
    { group:'11-12',
      girls:[
        { type:'Medley Relay',    team:['A Eklund','Tara Talwar','A Arvind','E Swafford'], time:'2:12.59' },
        { type:'Freestyle Relay', team:['A Eklund','Tara Talwar','A Arvind','E Swafford'], time:'2:01.19' },
      ],
      boys:[
        { type:'Medley Relay',    team:['B Buehler','Isaac Salvitti','T Talwar','L Kellner'], time:'2:10.00' },
        { type:'Freestyle Relay', team:['W Soleo','N Ankokar','A Monroe','T Wade'],           time:'2:07.29' },
      ],
    },
    { group:'13-14',
      girls:[
        { type:'Medley Relay',    team:['A Eklund','Tara Talwar','A Arvind','E Swafford'], time:'1:51.17' },
        // Freestyle Relay time was not visible on the source board — skipped
        // rather than fabricated. Add via admin edit once the plaque is legible.
      ],
      boys:[
        { type:'Medley Relay',    team:['W Soleo','N Ankokar','A Monroe','T Wade'],                 time:'2:00.25' },
        { type:'Freestyle Relay', team:['H. Elsaesser','B. Lentz','A. Chinchilla','C. Salvitti'],   time:'1:49.41' },
      ],
    },
    { group:'15-18',
      girls:[
        { type:'Medley Relay',    team:['E Swafford','A Eklund','Tara Talwar','Jenna Pullen'], time:'2:04.62' },
        { type:'Freestyle Relay', team:['A Eklund','M Cakenco','L Eklund','P Fishburn'],       time:'1:49.44' },
      ],
      boys:[
        { type:'Medley Relay',    team:['T Wade','Will Soleo','Joshua Pullen','Colton Wade'],  time:'1:48.25' },
        { type:'Freestyle Relay', team:['T Wade','Will Soleo','Joshua Pullen','Colton Wade'],  time:'1:36.29' },
      ],
    },
  ];

  // Flatten both boards into the shape seedHistoricalRecords consumes.
  // kind:'individual' or 'relay' partitions the two on the records page.
  const flat = [];
  INDIVIDUAL.forEach(g => {
    const dist = BRACKET_DIST[g.group];
    if(!dist) return;
    g.girls.forEach(e => flat.push({
      kind:'individual', ageGroup:g.group, gender:'F',
      event:`${dist} ${STROKE_LABEL[e.evt] || e.evt}`,
      swimmerName:e.name, time:e.time,
      meet:'Historical record'
    }));
    g.boys.forEach(e => flat.push({
      kind:'individual', ageGroup:g.group, gender:'M',
      event:`${dist} ${STROKE_LABEL[e.evt] || e.evt}`,
      swimmerName:e.name, time:e.time,
      meet:'Historical record'
    }));
  });
  RELAY.forEach(g => {
    (g.girls || []).forEach(e => flat.push({
      kind:'relay', ageGroup:g.group, gender:'F',
      event:e.type, swimmers:e.team, swimmerName:e.team.join(', '),
      time:e.time, meet:'Historical record'
    }));
    (g.boys || []).forEach(e => flat.push({
      kind:'relay', ageGroup:g.group, gender:'M',
      event:e.type, swimmers:e.team, swimmerName:e.team.join(', '),
      time:e.time, meet:'Historical record'
    }));
  });

  global.HHST_HISTORICAL_RECORDS = flat;
})(window);
