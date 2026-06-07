// LOCAL TEST ONLY — not part of the site. Stubs auth + data so awards.html
// renders a full worst-case poster set for print-size measurement.
(function(){
  const BRACKETS = [
    ['6 & Under','15', 6],
    ['7-8','25', 8],
    ['9-10','25', 10],
    ['11-12','50', 12],
    ['13-14','50', 14],
    ['15-18','50', 16]
  ];
  const FIRST = ['Alexandra-Josephine','Christopher-Sebastian','Maximiliana','Bartholomew','Wilhelmina','Constantine','Evangelina-Rose','Montgomery','Persephone','Theodoricus'];
  const LAST  = ['Featherstone-Williams','Vandenberg-Castellanos','Worthington-Albemarle','Konstantinopoulos','Higginbotham-Stewart','Beauregard-Thibodeaux','Schwarzenberger','Oyelaran-Adekunle','Rajagopalan-Iyer','Castellanos-Mendoza'];
  // Worst case: every swimmer swims 8 distinct events and drops time in ALL
  // of them, so the Most Improved breakdown is as long as it can ever get.
  const STROKES = ['Freestyle','Backstroke','Breaststroke','Butterfly'];
  const MEETS = [
    ['Season Opener vs Lochmere','2026-05-23'],
    ['June Meet vs Prestonwood','2026-06-05']
  ];
  const SEASON = '2026 Summer';

  const swimmers = {};
  let n = 0;
  BRACKETS.forEach(([bracket, dist, age], bi) => {
    const dists = [dist, String(+dist * 2)]; // two distances x 4 strokes = 8 events
    ['F','M'].forEach((gender, gi) => {
      for(let i = 0; i < 5; i++){
        n++;
        const key = 's' + n;
        const name = FIRST[(bi*2+gi+i) % FIRST.length] + ' ' + LAST[(bi+gi*3+i) % LAST.length];
        const results = [];
        MEETS.forEach(([meet, date], mi) => {
          STROKES.forEach((stroke, si) => {
            dists.forEach((d, di) => {
              const base = 20 + bi*8 + i*1.7 + si*4 + di*22;
              const secs = +(base - mi*(1.2 + 0.31*si + 0.17*di)).toFixed(2);
              results.push({
                stroke, distance: d, time: secs.toFixed(2),
                seconds: secs, meet, date, season: SEASON
              });
            });
          });
        });
        swimmers[key] = {
          key, name, preferredName: '', gender, age, bracket,
          seasons: [SEASON],
          seasonInfo: { [SEASON]: { age, bracket, gender } },
          results
        };
      }
    });
  });

  FB.auth = {
    onAuthStateChanged(cb){ setTimeout(() => cb({ uid: 'print-test' }), 0); return () => {}; },
    currentUser: { uid: 'print-test' }
  };
  HHST.readAll = async () => ({ swimmers });
})();
