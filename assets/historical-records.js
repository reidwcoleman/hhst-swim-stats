/* =============================================================
   HHST historical wall records — snapshot of the pre-Firestore
   record board. Fed to HHST.seedHistoricalRecords() by the admin
   "Seed historical records" button so the wall history survives
   the move to a dynamic system. seedHistoricalRecords never
   overwrites a record that's already set, so re-runs are safe.

   Distances follow the HHST bracket standard:
     6 & Under → 15y, 7-8 / 9-10 → 25y, 11-12 / 13-14 / 15-18 → 50y.
   Full-name entries were kept as-is; initial-only ("J. Fishburn")
   are stored as they appeared on the wall — good enough to display.
   ============================================================= */
(function(global){
  const STROKE = { Free:'Free', Back:'Back', Breast:'Breast', Fly:'Fly' };
  // { ageGroup, distance }[] — the "wall distance" that a stroke chip on the
  // old poster implied for that age group.
  const BRACKET_DIST = {
    '6 & Under': '15',
    '7-8':       '25',
    '9-10':      '25',
    '11-12':     '50',
    '13-14':     '50',
    '15-18':     '50'
  };
  const RAW = [
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
        { evt:'Breast', name:'Tara Talwar', time:'18.42' },
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
        { evt:'Free',   name:'Isaac Salvitti', time:'27.62' },
        { evt:'Back',   name:'Tristan Talwar', time:'31.47' },
        { evt:'Breast', name:'Tristan Talwar', time:'36.25' },
        { evt:'Fly',    name:'Tristan Talwar', time:'29.64' },
      ],
    },
    { group:'13-14',
      girls:[
        { evt:'Free',   name:'Tara Talwar', time:'26.25' },
        { evt:'Back',   name:'Tara Talwar', time:'28.85' },
        { evt:'Breast', name:'Tara Talwar', time:'33.34' },
        { evt:'Fly',    name:'Tara Talwar', time:'27.13' },
      ],
      boys:[
        { evt:'Free',   name:'Colton Wade',   time:'24.41' },
        { evt:'Back',   name:'A. Chinchilla', time:'30.16' },
        { evt:'Breast', name:'S. Ankolkar',   time:'32.53' },
        { evt:'Fly',    name:'S. Ankolkar',   time:'26.97' },
      ],
    },
    { group:'15-18',
      girls:[
        { evt:'Free',   name:'Lauren Soleo', time:'25.94' },
        { evt:'Back',   name:'Tara Talwar',  time:'29.22' },
        { evt:'Breast', name:'Tara Talwar',  time:'35.05' },
        { evt:'Fly',    name:'Tara Talwar',  time:'27.20' },
      ],
      boys:[
        { evt:'Free',   name:'Colton Wade', time:'21.66' },
        { evt:'Back',   name:'Colton Wade', time:'25.52' },
        { evt:'Breast', name:'Colton Wade', time:'30.11' },
        { evt:'Fly',    name:'Colton Wade', time:'23.38' },
      ],
    },
  ];

  const flat = [];
  RAW.forEach(g => {
    const dist = BRACKET_DIST[g.group];
    if(!dist) return;
    g.girls.forEach(e => flat.push({
      ageGroup: g.group, gender: 'F',
      event: `${dist} ${STROKE[e.evt] || e.evt}`,
      swimmerName: e.name, time: e.time,
      meet: 'Historical record (pre-2026)'
    }));
    g.boys.forEach(e => flat.push({
      ageGroup: g.group, gender: 'M',
      event: `${dist} ${STROKE[e.evt] || e.evt}`,
      swimmerName: e.name, time: e.time,
      meet: 'Historical record (pre-2026)'
    }));
  });

  global.HHST_HISTORICAL_RECORDS = flat;
})(window);
