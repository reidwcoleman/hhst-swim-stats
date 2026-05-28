/* =============================================================
   HHST Swim Stats — Async data layer (Firestore-backed)
   Collection: swimmers/{key} → { name, address, parents[], age,
     group, results[] (embedded), updatedAt }
   Doc:        meta/stats     → { lastUpload, meetCount }
   ============================================================= */
(function(global){

  // -------- Helpers --------
  function norm(s){
    return (s||'').toString().trim().toLowerCase()
      .replace(/[^a-z0-9 ]/g,'')
      .replace(/\s+/g,' ');
  }
  function swimmerKey(name){
    return norm(name).replace(/\s+/g,'-');
  }
  function slugify(s){
    return (s||'').toString().toLowerCase()
      .replace(/[^a-z0-9]+/g,'-')
      .replace(/^-+|-+$/g,'') || 'x';
  }
  function meetTimeDocId(swimmerKey, eventLabel){
    return `${swimmerKey}__${slugify(eventLabel)}`;
  }
  // Some exports (HHST's Times sheet, USA Swimming) tag the time with the
  // course code: "17.11Y" (yards), "1:07.94L" (long-course meters),
  // "S" (short-course meters), "M" (meters). Strip a single trailing
  // course-code letter before parsing so the time still parses.
  function stripCourseCode(s){
    return (s == null ? '' : s.toString()).trim().replace(/\s*[YSLM]\s*$/i, '').trim();
  }
  function fmtTime(t){
    if(t==null) return '';
    let s = stripCourseCode(t);
    if(!s) return '';
    if(/^\d{1,2}:\d{2}\.\d{1,2}$/.test(s)){
      const [m, rest] = s.split(':');
      const [sec, hh] = rest.split('.');
      return `${parseInt(m,10)}:${sec.padStart(2,'0')}.${(hh||'00').padEnd(2,'0').slice(0,2)}`;
    }
    const num = parseFloat(s);
    if(!isFinite(num)) return s;
    const m = Math.floor(num/60);
    const sec = num - m*60;
    const secStr = sec.toFixed(2).padStart(5,'0');
    return `${m}:${secStr}`;
  }
  function timeToSeconds(t){
    if(t==null) return NaN;
    const s = stripCourseCode(t);
    if(!s) return NaN;
    if(/^\d{1,2}:\d{2}\.\d{1,2}$/.test(s)){
      const [m, rest] = s.split(':');
      const [sec, hh] = rest.split('.');
      return parseInt(m,10)*60 + parseInt(sec,10) + (parseInt(hh||0,10)/100);
    }
    const n = parseFloat(s);
    return isFinite(n) ? n : NaN;
  }

  // -------- CSV Parsing --------
  function parseCSV(text){
    const rows = [];
    let row = [], cur = '', inQ = false;
    for(let i=0;i<text.length;i++){
      const c = text[i];
      if(inQ){
        if(c === '"' && text[i+1] === '"'){ cur += '"'; i++; }
        else if(c === '"'){ inQ = false; }
        else cur += c;
      } else {
        if(c === '"'){ inQ = true; }
        else if(c === ','){ row.push(cur); cur = ''; }
        else if(c === '\r'){ /* ignore */ }
        else if(c === '\n'){ row.push(cur); rows.push(row); row=[]; cur=''; }
        else cur += c;
      }
    }
    if(cur.length || row.length){ row.push(cur); rows.push(row); }
    return rows.filter(r => r.length && r.some(x => x !== ''));
  }

  // Header alias -> normalized internal field name. Keys are matched after stripping
  // every non-alphanumeric char, so "Athlete Last Name", "AthleteLastName", and
  // "athlete_last_name" all collapse to the same key.
  const HEADER_ALIASES = {
    // Name
    'name':'name','fullname':'name','swimmer':'name','swimmername':'name',
    'athlete':'name','athletename':'name','athletefullname':'name',
    'athletedisplayname':'name','displayname':'name',
    'first':'first','firstname':'first','givenname':'first',
    'athletefirst':'first','athletefirstname':'first',
    'last':'last','lastname':'last','surname':'last','familyname':'last',
    'athletelast':'last','athletelastname':'last',
    'middle':'middle','middlename':'middle','athletemiddle':'middle','athletemiddlename':'middle',
    'preferredname':'preferredname','nickname':'preferredname',
    'athletepreferredname':'preferredname','athletenickname':'preferredname',
    // Address (Swimtopia splits across columns)
    'address':'address','street':'address','homeaddress':'address',
    'address1':'address','addressline1':'address','streetaddress':'address',
    'address2':'address2','addressline2':'address2',
    'city':'city','state':'state',
    'zip':'zip','zipcode':'zip','postalcode':'zip','postcode':'zip',
    // Contact
    'email':'email','emailaddress':'email','primaryemail':'email','athleteemail':'email',
    // Parent (single-column form — pair columns are handled separately below)
    'parent':'parent','parentname':'parent','parent1':'parent','guardian':'parent','parentguardian':'parent',
    'accountname':'parent','householdname':'parent','primarycontact':'parent','contactname':'parent',
    // Event / time / meet
    'event':'event','stroke':'event','eventname':'event','strokename':'event',
    'distance':'distance','eventdistance':'distance',
    'time':'time','finaltime':'time','result':'time','swimtime':'time','seedtime':'time',
    // HHST stats workbook columns — original_time wins (preserves the course code on display),
    // converted_time is the same value in seconds; mapping both is safe because the first
    // matching column wins (see `if(rec[k]) continue;` in ingestRows).
    'originaltime':'time','convertedtime':'time',
    'meet':'meet','meetname':'meet','competition':'meet','swimmeet':'meet','meettitle':'meet',
    'date':'date','meetdate':'date','sessiondate':'date','eventdate':'date','swimdate':'date',
    // Season (per-row override; admin upload also sets a default season for the whole file)
    'season':'season','swimseason':'season','seasonname':'season','meetseason':'season','year':'season',
    // Team columns (ignored for now — kept here so they don't get misinterpreted as something else)
    'team':'team','teamname':'team','teamabbr':'team','teamabbreviation':'team',
    // Age / DOB
    'age':'age','swimmerage':'age','athleteage':'age',
    'dob':'dob','dateofbirth':'dob','birthdate':'dob','birthday':'dob','athletebirthdate':'dob',
    // Gender (boys/girls swim separately — needed to split leaderboards correctly)
    'gender':'gender','sex':'gender','athletegender':'gender','athletesex':'gender','genderidentity':'gender',
    // Group (Swimtopia exports both — RosterGroup is the team's training group, AgeGroup is the age class)
    'group':'group','traininggroup':'group','squad':'group','groupname':'group','teamgroup':'group',
    'rostergroup':'rostergroup',
    'agegroup':'agegroup',
    // Result-line extras
    'place':'place','finish':'place','rank':'place','finishplace':'place',
    'split':'split','splits':'split'
  };
  function normHeaderKey(h){
    return (h||'').toString().toLowerCase().replace(/[^a-z0-9]+/g,'');
  }
  function mapHeader(h){
    const key = normHeaderKey(h);
    return HEADER_ALIASES[key] || key || '_';
  }

  // "Carter, Riley" -> "Riley Carter".  Plain "Riley Carter" untouched.
  function fixNameOrder(s){
    if(!s) return '';
    s = s.toString().trim();
    if(s.indexOf(',') === -1) return s;
    const parts = s.split(',').map(x=>x.trim()).filter(Boolean);
    if(parts.length === 2) return `${parts[1]} ${parts[0]}`.replace(/\s+/g,' ').trim();
    return s.replace(/,/g, ' ').replace(/\s+/g,' ').trim();
  }
  function ageFromDob(dob){
    if(!dob) return '';
    const d = new Date(dob);
    if(isNaN(d.getTime())) return '';
    const now = new Date();
    let age = now.getFullYear() - d.getFullYear();
    const m = now.getMonth() - d.getMonth();
    if(m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
    return (age > 0 && age < 120) ? String(age) : '';
  }
  function isValidEmail(s){
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((s||'').trim());
  }
  // Normalize any "M/F/Male/Female/Boy/Girl/Man/Woman" to canonical "M" or "F".
  // Returns '' when the input doesn't clearly identify a gender.
  function parseGender(s){
    if(s == null) return '';
    const t = s.toString().trim().toLowerCase();
    if(!t) return '';
    if(t === 'm' || t === 'man' || t.startsWith('male') || t.startsWith('boy')) return 'M';
    if(t === 'f' || t === 'woman' || t.startsWith('female') || t.startsWith('girl')) return 'F';
    return '';
  }
  // Pull a gender out of a Swimtopia / HHST age-group label such as
  // "Boys 11-12", "Girls 6 & Under", "Mens 15-18". Returns '' if the
  // label doesn't include a gender word.
  function parseGenderFromAgeGroup(ag){
    if(!ag) return '';
    const t = ag.toString().toLowerCase();
    if(/\b(boy|men|male)/.test(t)) return 'M';
    if(/\b(girl|women|female)/.test(t)) return 'F';
    return '';
  }
  // "Boys" / "Girls" / "" — used for UI labels and section headers.
  function genderLabel(g){
    if(g === 'M') return 'Boys';
    if(g === 'F') return 'Girls';
    return '';
  }
  // Combined competition bucket: "Boys 11-12" / "Girls 11-12" / "11-12" if
  // gender isn't known. Falls back to the swimmer's bracket (or training
  // group) when an age bracket can't be computed.
  function competitionGroup(sw){
    if(!sw) return 'Unknown';
    const bracket = sw.bracket || getAgeGroup(sw.age) || sw.ageGroup || sw.group || 'Unknown';
    const g = genderLabel(sw.gender);
    if(!g || bracket === 'Unknown') return bracket;
    return `${g} ${bracket}`;
  }
  // Build a full address from Swimtopia's split columns: "804 Landuff Court, Cary, NC 27519"
  function composeAddress(rec){
    if(!rec.address && !rec.city && !rec.state && !rec.zip) return '';
    const parts = [];
    if(rec.address) parts.push(rec.address);
    if(rec.address2) parts.push(rec.address2);
    if(rec.city) parts.push(rec.city);
    const tail = [rec.state, rec.zip].filter(Boolean).join(' ').trim();
    if(tail) parts.push(tail);
    return parts.join(', ');
  }

  function extractStroke(s){
    s = (s||'').toLowerCase();
    if(s.includes('free')) return 'Freestyle';
    if(s.includes('back')) return 'Backstroke';
    if(s.includes('breast')) return 'Breaststroke';
    if(s.includes('fly') || s.includes('butter')) return 'Butterfly';
    if(s.includes('im') || s.includes('medley')) return 'IM';
    return '';
  }
  const SWIM_DISTANCES = [25,50,75,100,150,200,400,500,800,1000,1500,1650];
  function extractDistance(s){
    s = (s||'').toString();
    // 1) distance followed by stroke keyword: "50 Free", "100 Yard Back"
    const m1 = s.match(/\b(\d{2,4})\s*(?:yd|y|m|meter|yard)?\s*(?:free|back|breast|fly|butter|im|medley)/i);
    if(m1) return m1[1];
    // 2) distance with explicit unit: "50 yd", "200 meter"
    const m2 = s.match(/\b(\d{2,4})\s*(?:yd|y|m|meter|yard)\b/i);
    if(m2) return m2[1];
    // 3) standalone number that's a recognized swim distance
    const re = new RegExp(`\\b(${SWIM_DISTANCES.join('|')})\\b`);
    const m3 = s.match(re);
    if(m3) return m3[1];
    return '';
  }
  const STROKE_ABBREV = {
    'Freestyle':'Free','Backstroke':'Back','Breaststroke':'Breast',
    'Butterfly':'Fly','IM':'IM'
  };
  // Turn any event string into a canonical "<dist> <Stroke>" label,
  // so "Boys 13-14 50 Yard Free" and "50 Free" stack on the same event.
  function normalizeEventLabel(rec){
    const ev = (rec.event||'').toString().trim();
    const explicitDist = (rec.distance||'').toString().trim();
    const dist = explicitDist || extractDistance(ev);
    const strokeFull = extractStroke(ev);
    const stroke = STROKE_ABBREV[strokeFull] || strokeFull || '';
    if(dist && stroke) return `${dist} ${stroke}`;
    if(ev) return ev;
    if(dist) return dist;
    return 'Unknown';
  }

  // -------- Firestore reads --------
  async function readAll(){
    const snap = await FB.db.collection('swimmers').get();
    const swimmers = {};
    snap.forEach(doc => { swimmers[doc.id] = doc.data(); });
    let meta = { lastUpload: null, meetCount: 0 };
    try{
      const m = await FB.db.collection('meta').doc('stats').get();
      if(m.exists) meta = m.data();
    } catch(e){}
    return { swimmers, lastUpload: meta.lastUpload || null, meetCount: meta.meetCount || 0 };
  }
  async function getSwimmer(key){
    const d = await FB.db.collection('swimmers').doc(key).get();
    return d.exists ? d.data() : null;
  }

  // -------- Ingest (admin) --------
  // opts.mode:
  //   'roster'  — create swimmer docs for unknown names (used by the roster upload)
  //   'results' — only update existing swimmers; rows for unknown swimmers are skipped
  //               and reported in result.skippedSwimmers (default for safety so meet
  //               uploads can't pollute the roster with phantom records)
  // opts.season:
  //   Free-form label (e.g. "2025 Summer"). Tags every imported result with
  //   this season so leaderboards / time-dropped / records can be filtered to
  //   a single season. If omitted, results are tagged with '' and behave like
  //   legacy data (visible only when no season filter is applied).
  async function ingestCSV(text, opts){
    return ingestRows(parseCSV(text), opts);
  }

  // ingestRows accepts already-parsed rows (array-of-arrays, headers in row 0).
  // CSV and XLSX share this pipeline — the admin page does the file-type
  // detection and hands us rows.
  async function ingestRows(rows, opts){
    opts = opts || {};
    const mode = opts.mode === 'roster' ? 'roster' : 'results';
    const season = (opts.season || '').toString().trim();
    if(!rows || rows.length < 2) return { added:0, swimmers:0, profileUpdates:0, skippedSwimmers:[], errors:['Empty file'] };
    const rawHeaders = rows[0];
    const headers = rawHeaders.map(mapHeader);
    // Collect every column that LOOKS like an email column, regardless of mapping
    const emailColIdxs = [];
    for(let i=0;i<rawHeaders.length;i++){
      if(/email/i.test(rawHeaders[i] || '')) emailColIdxs.push(i);
    }
    // Detect Parent1_FirstName / Parent1_LastName pairs (and Parent2_*, Parent3_*, Guardian_*)
    const parentNamePairs = [];
    for(let i=0; i<rawHeaders.length; i++){
      const h = normHeaderKey(rawHeaders[i]);
      const m = h.match(/^(parent|guardian)(\d*)firstname$/);
      if(!m) continue;
      const lastKey = `${m[1]}${m[2]}lastname`;
      let lastIdx = -1;
      for(let j=0;j<rawHeaders.length;j++){
        if(normHeaderKey(rawHeaders[j]) === lastKey){ lastIdx = j; break; }
      }
      parentNamePairs.push({firstIdx: i, lastIdx});
    }

    // Stage updates per swimmer (so we batch writes)
    const updates = {}; // key -> swimmer object
    const errors = [];
    let added = 0;
    const meetNames = new Set();
    const profileUpdated = new Set(); // swimmers whose profile (non-result) fields changed

    // First pass: pull existing swimmers we'll touch (so we merge, not overwrite)
    const touchedKeys = new Set();
    const records = [];
    for(let r=1; r<rows.length; r++){
      const cells = rows[r];
      if(!cells || !cells.length) continue;
      const rec = {};
      for(let i=0;i<headers.length;i++){
        // don't let later headers wipe an earlier value when two map to the same key
        const k = headers[i];
        const v = (cells[i]||'').trim();
        if(rec[k]) continue;
        rec[k] = v;
      }
      // Gather all email-like cells for this row
      const emails = [];
      for(const i of emailColIdxs){
        const v = (cells[i]||'').trim();
        if(v && isValidEmail(v)) emails.push(v);
      }
      rec.__emails = emails;

      // Combine parent first/last column pairs into full names. Also keep the
      // single 'parent' column if it had a value.
      const parents = [];
      if(rec.parent) parents.push(rec.parent);
      for(const pair of parentNamePairs){
        const first = (cells[pair.firstIdx]||'').trim();
        const last = pair.lastIdx >= 0 ? (cells[pair.lastIdx]||'').trim() : '';
        const full = `${first} ${last}`.replace(/\s+/g,' ').trim();
        if(full) parents.push(full);
      }
      rec.__parents = parents;

      // Resolve name. Prefer first+last columns; fall back to single name column
      // (which may be in "Last, First" form — fixNameOrder flips it).
      let name = '';
      if(rec.first || rec.last) name = `${rec.first||''} ${rec.last||''}`.trim();
      else if(rec.name) name = fixNameOrder(rec.name);
      name = name.replace(/\s+/g,' ').trim();
      if(!name){ errors.push(`Row ${r+1}: missing swimmer name`); continue; }
      rec.__name = name;
      rec.__key = swimmerKey(name);
      touchedKeys.add(rec.__key);
      records.push(rec);
    }
    // Fetch existing. In results mode, also scan the whole roster so we can
    // alias preferred-name variants (e.g. "Maddy Cakerice" -> "Madelyn Cakerice").
    const existing = {};
    if(mode === 'results'){
      const aliasToKey = {};
      const allSnap = await FB.db.collection('swimmers').get();
      allSnap.forEach(doc => {
        const sw = doc.data();
        existing[doc.id] = sw;
        if(sw.preferredName){
          const lastWord = (sw.name||'').split(' ').filter(Boolean).pop();
          if(lastWord){
            const aliasKey = swimmerKey(`${sw.preferredName} ${lastWord}`);
            if(aliasKey && aliasKey !== doc.id) aliasToKey[aliasKey] = doc.id;
          }
        }
      });
      // Reroute any records whose key only matches via a preferred-name alias
      for(const rec of records){
        if(!existing[rec.__key] && aliasToKey[rec.__key]){
          const realKey = aliasToKey[rec.__key];
          rec.__key = realKey;
          rec.__name = existing[realKey].name;
        }
      }
    } else {
      await Promise.all(Array.from(touchedKeys).map(async k => {
        const sw = await getSwimmer(k);
        existing[k] = sw;
      }));
    }

    const skippedSwimmers = new Set();
    const writtenKeys = new Set();
    const meetTimeWrites = [];
    for(const rec of records){
      const key = rec.__key;
      const name = rec.__name;
      // In results mode, never create a swimmer that isn't already on the roster.
      if(mode === 'results' && !existing[key] && !updates[key]){
        skippedSwimmers.add(name);
        continue;
      }
      if(!updates[key]){
        updates[key] = existing[key] || {
          key, name,
          address: '',
          emails: [],
          parents: [],
          age: '',
          group: '',
          ageGroup: '',
          gender: '',
          results: []
        };
        // ensure shape
        updates[key].emails = updates[key].emails || [];
        updates[key].parents = updates[key].parents || [];
        updates[key].results = updates[key].results || [];
      }
      writtenKeys.add(key);
      const sw = updates[key];
      let touched = false;
      // Compose address from line1 + city + state + zip when available
      if(!sw.address){
        const composed = composeAddress(rec);
        if(composed){ sw.address = composed; touched = true; }
      }
      // Age: only accept a plain numeric value (so a misaligned date doesn't get stored as age)
      if(rec.age && /^\d{1,3}$/.test(rec.age.trim()) && !sw.age){
        sw.age = rec.age.trim(); touched = true;
      } else if(rec.dob && !sw.age){
        const a = ageFromDob(rec.dob);
        if(a){ sw.age = a; touched = true; }
      }
      // group = team training group (RosterGroup / Bronze, Silver, Gold)
      if(!sw.group){
        const g = (rec.rostergroup && rec.rostergroup.trim()) || (rec.group && rec.group.trim()) || '';
        if(g){ sw.group = g; touched = true; }
      }
      // ageGroup = competition age class ("Boys 13-14") — kept separate so leaderboards
      // can group by age even when a team training group is also set.
      if(!sw.ageGroup){
        const ag = (rec.agegroup && rec.agegroup.trim()) || '';
        if(ag){ sw.ageGroup = ag; touched = true; }
      }
      // Gender — explicit gender/sex column wins; if absent we parse it out of
      // the Swimtopia ageGroup ("Boys 11-12" → M, "Girls 6 & Under" → F).
      // Needed so leaderboards can split boys vs girls (kids don't race the
      // other gender, so a combined leaderboard misrepresents the standings).
      if(!sw.gender){
        let g = parseGender(rec.gender);
        if(!g) g = parseGenderFromAgeGroup(rec.agegroup);
        if(!g) g = parseGenderFromAgeGroup(sw.ageGroup);
        if(g){ sw.gender = g; touched = true; }
      }
      // Preferred name (skip values that look like a full "Last, First" — Swimtopia sometimes mis-fills this)
      if(rec.preferredname && rec.preferredname.indexOf(',') === -1 && !sw.preferredName){
        sw.preferredName = rec.preferredname; touched = true;
      }
      // Parents — single column + all parent_firstname/lastname pair columns
      for(const p of rec.__parents){
        if(p && !sw.parents.map(norm).includes(norm(p))){
          sw.parents.push(p); touched = true;
        }
      }
      for(const e of rec.__emails){
        const lower = e.toLowerCase();
        if(!sw.emails.map(x=>x.toLowerCase()).includes(lower)){
          sw.emails.push(e);
          touched = true;
        }
      }
      // Auto-assigned bracket from numeric age (6 & Under / 7-8 / 9-10 / 11-12 / 13-14 / 15-18).
      // Kept distinct from sw.ageGroup (Swimtopia raw label) so existing leaderboard
      // grouping stays intact while the new collections always have a clean bracket.
      const computedBracket = getAgeGroup(sw.age);
      if(sw.bracket !== computedBracket){
        sw.bracket = computedBracket;
        touched = true;
      }
      if(touched) profileUpdated.add(key);
      if(rec.event && rec.time){
        const eventLabel = normalizeEventLabel(rec);
        const distance = (rec.distance||'').toString().trim() || extractDistance(rec.event);
        const stroke = extractStroke(rec.event);
        const timeStr = fmtTime(rec.time);
        // Per-row season can override the upload-level default — useful when
        // the spreadsheet has a `season` column (rec.season is grabbed below
        // from the header aliases).
        const rowSeason = (rec.season || '').toString().trim() || season;
        const result = {
          event: eventLabel,
          distance,
          stroke,
          time: timeStr,
          seconds: timeToSeconds(timeStr),
          meet: rec.meet || 'Unknown Meet',
          date: rec.date || '',
          place: rec.place || '',
          split: rec.split || '',
          season: rowSeason
        };
        sw.results.push(result);
        added++;
        if(rec.meet) meetNames.add(rec.meet);
        // Stage a mirror write to hhst_meet_times. Doc id = swimmer + event +
        // season, so re-uploading the same combo into a different season
        // creates a separate doc instead of overwriting last season's record.
        const mirrorId = rowSeason
          ? `${meetTimeDocId(key, eventLabel)}__${slugify(rowSeason)}`
          : meetTimeDocId(key, eventLabel);
        meetTimeWrites.push({
          id: mirrorId,
          data: {
            swimmerKey: key,
            swimmerName: name,
            event: eventLabel,
            distance,
            stroke,
            time: timeStr,
            seconds: result.seconds,
            meet: result.meet,
            date: result.date,
            place: result.place,
            ageGroup: computedBracket,
            gender: sw.gender || '',
            competitionGroup: competitionGroup(sw),
            season: rowSeason
          }
        });
      }
    }

    // Batch write all touched swimmers (Firestore caps batch at 500 ops)
    const keys = Object.keys(updates);
    const chunks = [];
    for(let i=0;i<keys.length;i+=400) chunks.push(keys.slice(i, i+400));
    for(const chunk of chunks){
      const batch = FB.db.batch();
      chunk.forEach(k => {
        const ref = FB.db.collection('swimmers').doc(k);
        batch.set(ref, { ...updates[k], updatedAt: FB.FieldValue.serverTimestamp() }, { merge: true });
      });
      await batch.commit();
    }

    // Mirror to hhst_rosters/{key} — slim doc for the simple view requested
    // by the new feature. Lives alongside swimmers/{key} so the existing
    // dashboards/leaderboards keep working off the rich schema.
    const rosterChunks = [];
    for(let i=0;i<keys.length;i+=400) rosterChunks.push(keys.slice(i, i+400));
    for(const chunk of rosterChunks){
      const batch = FB.db.batch();
      chunk.forEach(k => {
        const sw = updates[k];
        const ref = FB.db.collection('hhst_rosters').doc(k);
        batch.set(ref, {
          swimmerKey: k,
          name: sw.name,
          age: sw.age || '',
          ageGroup: sw.bracket || getAgeGroup(sw.age),
          gender: sw.gender || '',
          competitionGroup: competitionGroup(sw),
          group: sw.group || '',
          uploadedAt: FB.FieldValue.serverTimestamp()
        }, { merge: true });
      });
      await batch.commit();
    }

    // Mirror to hhst_meet_times/{swimmerKey__event} — one doc per swimmer+event,
    // so re-uploading the same combo updates rather than appending.
    const mtChunks = [];
    for(let i=0;i<meetTimeWrites.length;i+=400) mtChunks.push(meetTimeWrites.slice(i, i+400));
    for(const chunk of mtChunks){
      const batch = FB.db.batch();
      chunk.forEach(w => {
        const ref = FB.db.collection('hhst_meet_times').doc(w.id);
        batch.set(ref, { ...w.data, uploadedAt: FB.FieldValue.serverTimestamp() }, { merge: true });
      });
      await batch.commit();
    }

    // Recompute distinct meets across the whole roster
    const allSnap = await FB.db.collection('swimmers').get();
    const allMeets = new Set();
    allSnap.forEach(doc => {
      const d = doc.data();
      (d.results||[]).forEach(r => allMeets.add(r.meet));
    });
    await FB.db.collection('meta').doc('stats').set({
      meetCount: allMeets.size,
      lastUpload: FB.FieldValue.serverTimestamp()
    }, { merge: true });

    return {
      added,
      swimmers: writtenKeys.size,
      profileUpdates: profileUpdated.size,
      skippedSwimmers: Array.from(skippedSwimmers),
      meets: meetNames.size,
      errors
    };
  }

  // Top N best times per competition group for a given event.
  // eventMatcher: { stroke: 'Freestyle', distance: '50' } (either can be omitted)
  // opts.splitByGender (default true) bucket Boys / Girls separately within
  //   each age bracket — kids don't race the other gender at HHST, so a
  //   combined leaderboard misrepresents who's actually fastest in their heat.
  function leaderboardsByEvent(swimmers, eventMatcher, opts){
    eventMatcher = eventMatcher || {};
    const limit = (opts && opts.limit) || 5;
    const splitByGender = !opts || opts.splitByGender !== false;
    const season = (opts && opts.season) || '';
    const byGroup = {};
    for(const sw of swimmers){
      const bracket = sw.bracket || getAgeGroup(sw.age) || sw.ageGroup || sw.group;
      if(!bracket || bracket === 'Unknown') continue;
      const group = splitByGender ? competitionGroup(sw) : bracket;
      if(!group || group === 'Unknown') continue;
      const matching = (sw.results||[]).filter(r => {
        if(season && r.season !== season) return false;
        if(eventMatcher.stroke && r.stroke !== eventMatcher.stroke) return false;
        if(eventMatcher.distance && String(r.distance) !== String(eventMatcher.distance)) return false;
        return isFinite(r.seconds);
      });
      if(!matching.length) continue;
      const best = matching.slice().sort((a,b)=> a.seconds - b.seconds)[0];
      if(!byGroup[group]) byGroup[group] = [];
      byGroup[group].push({
        key: sw.key,
        name: sw.name,
        preferredName: sw.preferredName || '',
        gender: sw.gender || '',
        time: best.time,
        seconds: best.seconds,
        meet: best.meet,
        date: best.date,
        age: sw.age || ''
      });
    }
    const out = {};
    for(const [group, list] of Object.entries(byGroup)){
      list.sort((a,b) => a.seconds - b.seconds);
      out[group] = list.slice(0, limit);
    }
    return out;
  }
  // Order age-group labels in a natural age progression. Prefers the
  // canonical AGE_GROUP_ORDER (6 & Under → 15-18) so HHST brackets sort
  // exactly the way the rest of the UI does, then falls back to numeric
  // age extraction for any Swimtopia gender-split labels.
  function sortAgeGroups(groups){
    function rank(g){
      const canonical = AGE_GROUP_ORDER.indexOf(g);
      if(canonical >= 0) return canonical * 100;
      const s = (g||'').toLowerCase();
      const ageMatch = s.match(/(\d+)\s*[-&]/);
      const lo = ageMatch ? parseInt(ageMatch[1],10) : (/under/.test(s) ? 0 : 99);
      const isBoy = /boy|men/.test(s) ? 1 : 0;
      return 1000 + lo * 10 + isBoy;
    }
    return groups.slice().sort((a,b) => rank(a) - rank(b));
  }

  // (buildLeaderboards / teamStats / compareEventLabel / AGE_GROUP_ORDER live
  // in the Stats helpers section below — those are the team-wide gender-merged
  // leaderboards used by the filter view on leaderboards.html. The Fastest
  // Five printable certificates use leaderboardsByEvent above, which keeps
  // Swimtopia's gender-split age groups intact.)

  // -------- Lookup --------
  async function findSwimmer({ name, email, parent }){
    const targetName = norm(fixNameOrder(name));
    const targetEmail = (email||'').trim().toLowerCase();
    const targetParent = norm(parent);
    if(!targetName) return { ok:false, reason:'Please enter the swimmer\'s name.' };
    // Build a "last first" variant of what the user typed, just in case they enter "Carter Riley"
    const parts = targetName.split(' ').filter(Boolean);
    const swapped = parts.length === 2 ? `${parts[1]} ${parts[0]}` : null;

    const snap = await FB.db.collection('swimmers').get();
    let match = null;
    snap.forEach(doc => {
      if(match) return;
      const sw = doc.data();
      const swName = norm(sw.name);
      // Build the preferred-name variant (e.g. "Maddy Cakerice" when sw.name is "Madelyn Cakerice")
      let swPref = '';
      if(sw.preferredName){
        const lastWord = (sw.name||'').split(' ').filter(Boolean).pop() || '';
        swPref = norm(`${sw.preferredName} ${lastWord}`);
      }
      const candidates = [swName, swPref].filter(Boolean);
      const targetsToCheck = [targetName, swapped].filter(Boolean);
      for(const cand of candidates){
        for(const t of targetsToCheck){
          if(cand === t || cand.includes(t) || t.includes(cand)){ match = sw; return; }
        }
      }
    });
    if(!match) return { ok:false, reason:'We couldn\'t find a swimmer with that name. Double-check the spelling.' };
    if(match.emails && match.emails.length){
      const emailOk = !targetEmail || match.emails.some(e => e.toLowerCase() === targetEmail);
      if(!emailOk) return { ok:false, reason:'The email you entered doesn\'t match the one we have on file for this swimmer.' };
    } else if(targetEmail){
      // Swimmer has no email yet on file — fall back to parent name as the verifier so legacy records still work.
      // (Roster CSV upload should fill this in going forward.)
    }
    if(match.parents && match.parents.length){
      const parentOk = !targetParent || match.parents.some(p => {
        const np = norm(p);
        return np === targetParent || np.includes(targetParent) || targetParent.includes(np);
      });
      if(!parentOk) return { ok:false, reason:'The parent name you entered doesn\'t match our records.' };
    }
    return { ok:true, swimmer: match };
  }

  // -------- Admin ops (require auth) --------
  async function deleteSwimmer(key){
    await FB.db.collection('swimmers').doc(key).delete();
    try{ await FB.db.collection('hhst_rosters').doc(key).delete(); }catch(e){}
    // Best-effort: also wipe this swimmer's meet-time mirror docs
    try{
      const mt = await FB.db.collection('hhst_meet_times').where('swimmerKey','==',key).get();
      const refs = [];
      mt.forEach(d => refs.push(d.ref));
      while(refs.length){
        const batch = FB.db.batch();
        refs.splice(0,400).forEach(ref => batch.delete(ref));
        await batch.commit();
      }
    }catch(e){}
  }
  // Remove every swimmer that isn't on the current roster (i.e. has no
  // matching doc in hhst_rosters). Called after a times upload so stale
  // swimmers — anyone removed from the team roster — get cleaned up.
  // Refuses to run if the roster collection is empty, so a first-ever
  // times upload (before any roster has been imported) can't wipe the DB.
  async function pruneNonRosterSwimmers(){
    const rosterSnap = await FB.db.collection('hhst_rosters').get();
    if(rosterSnap.empty) return [];
    const rosterKeys = new Set();
    rosterSnap.forEach(d => rosterKeys.add(d.id));
    const swSnap = await FB.db.collection('swimmers').get();
    const toDelete = [];
    swSnap.forEach(d => { if(!rosterKeys.has(d.id)) toDelete.push(d.id); });
    for(const key of toDelete){
      try { await deleteSwimmer(key); } catch(e){ /* keep going */ }
    }
    return toDelete;
  }

  async function addSwimmerManual({name, address, email, parent, age, group, gender}){
    const key = swimmerKey(fixNameOrder(name));
    const existing = await getSwimmer(key);
    const next = existing || { key, name: fixNameOrder(name), address:'', emails:[], parents:[], age:'', group:'', gender:'', results:[] };
    next.emails = next.emails || [];
    next.parents = next.parents || [];
    next.results = next.results || [];
    if(address) next.address = address;
    if(age) next.age = age;
    if(group) next.group = group;
    const g = parseGender(gender);
    if(g) next.gender = g;
    if(parent && !next.parents.map(norm).includes(norm(parent))) next.parents.push(parent);
    if(email && isValidEmail(email)){
      const lower = email.toLowerCase();
      if(!next.emails.map(e=>e.toLowerCase()).includes(lower)) next.emails.push(email);
    }
    await FB.db.collection('swimmers').doc(key).set({
      ...next, updatedAt: FB.FieldValue.serverTimestamp()
    }, { merge: true });
    return next;
  }
  async function updateSwimmer(key, fields){
    const existing = await getSwimmer(key);
    if(!existing) throw new Error('Swimmer not found');
    const next = { ...existing };
    if(fields.address !== undefined) next.address = fields.address;
    if(fields.emails !== undefined) next.emails = fields.emails;
    if(fields.parents !== undefined) next.parents = fields.parents;
    if(fields.age !== undefined) next.age = fields.age;
    if(fields.group !== undefined) next.group = fields.group;
    if(fields.gender !== undefined) next.gender = parseGender(fields.gender) || '';
    next.emails = next.emails || [];
    next.parents = next.parents || [];
    next.results = next.results || [];
    await FB.db.collection('swimmers').doc(key).set({
      ...next, updatedAt: FB.FieldValue.serverTimestamp()
    }, { merge: true });
    return next;
  }
  async function clearCollection(name){
    const snap = await FB.db.collection(name).get();
    const docs = [];
    snap.forEach(d => docs.push(d.ref));
    while(docs.length){
      const batch = FB.db.batch();
      docs.splice(0,400).forEach(ref => batch.delete(ref));
      await batch.commit();
    }
  }
  async function clearAll(opts){
    opts = opts || { roster:true, meetTimes:true };
    if(opts.roster !== false){
      // Roster wipe also drops the embedded results in swimmers/{key}.
      await clearCollection('swimmers');
      await clearCollection('hhst_rosters');
      await clearCollection('hhst_meet_times');
    } else if(opts.meetTimes !== false){
      // Times-only wipe: keep swimmer docs, but null out the embedded results.
      const snap = await FB.db.collection('swimmers').get();
      const refs = [];
      snap.forEach(d => refs.push(d.ref));
      while(refs.length){
        const batch = FB.db.batch();
        refs.splice(0,400).forEach(ref => batch.set(ref, { results: [] }, { merge: true }));
        await batch.commit();
      }
      await clearCollection('hhst_meet_times');
    }
    if(opts.roster !== false && opts.meetTimes !== false){
      try{ await FB.db.collection('meta').doc('stats').delete(); }catch(e){}
    }
  }
  async function clearRoster(){ return clearAll({ roster:true, meetTimes:false }); }
  async function clearMeetTimes(){ return clearAll({ roster:false, meetTimes:true }); }

  // -------- Auth --------
  // Login form labels say "Email" & "Password" so they create
  // an admin account in Firebase Auth Console.
  async function loginAdmin(email, password){
    try{
      await FB.auth.signInWithEmailAndPassword(email, password);
      return { ok:true };
    } catch(e){
      return { ok:false, reason: friendlyAuthError(e) };
    }
  }
  function friendlyAuthError(e){
    const code = (e && e.code) || '';
    if(code.includes('user-not-found')) return 'No admin account found for that email.';
    if(code.includes('wrong-password') || code.includes('invalid-credential')) return 'Incorrect email or password.';
    if(code.includes('too-many-requests')) return 'Too many failed attempts. Try again in a minute.';
    if(code.includes('network')) return 'Network error — check your connection.';
    return (e && e.message) || 'Sign-in failed.';
  }
  async function logoutAdmin(){ await FB.auth.signOut(); }
  function onAuthChanged(cb){ return FB.auth.onAuthStateChanged(cb); }
  function isAdminLoggedIn(){ return !!FB.auth.currentUser; }

  // -------- Stats helpers --------
  // HHST age groups
  const AGE_GROUP_ORDER = ['6 & Under','7-8','9-10','11-12','13-14','15-18','Unknown'];
  function getAgeGroup(age){
    const n = parseInt(age, 10);
    if(!isFinite(n) || n <= 0) return 'Unknown';
    if(n <= 6) return '6 & Under';
    if(n <= 8) return '7-8';
    if(n <= 10) return '9-10';
    if(n <= 12) return '11-12';
    if(n <= 14) return '13-14';
    return '15-18';
  }

  // -------- Season helpers --------
  // A "season" is a free-form label the coach picks at upload time
  // ("2025 Summer", "2024-25 Winter", etc.). It's tagged on every imported
  // race, then leaderboards / time-dropped / records can be filtered to a
  // single season. Sort order: lexicographic descending — picks year-prefixed
  // labels like "2025 Summer" newest-first naturally.
  function getAllSeasons(allSwimmers){
    const seen = new Set();
    const list = Array.isArray(allSwimmers) ? allSwimmers : Object.values(allSwimmers || {});
    list.forEach(sw => (sw.results || []).forEach(r => {
      if(r && r.season) seen.add(r.season);
    }));
    return Array.from(seen).sort((a,b) => b.localeCompare(a, undefined, { numeric:true, sensitivity:'base' }));
  }
  function currentSeason(allSwimmers){
    const seasons = getAllSeasons(allSwimmers);
    return seasons[0] || '';
  }
  // Return a swimmer with results filtered to a single season — used by the
  // season-aware leaderboard / stats helpers below. season === '' means "all
  // seasons" (no filter applied).
  function filterSwimmerToSeason(sw, season){
    if(!season) return sw;
    return { ...sw, results: (sw.results || []).filter(r => r && r.season === season) };
  }

  // Stroke order for grouping / sorting
  const STROKE_ORDER = ['Freestyle','Backstroke','Breaststroke','Butterfly','IM'];
  function distanceNum(ev){
    const m = (ev||'').match(/\d+/);
    return m ? parseInt(m[0],10) : 0;
  }
  function compareEventLabel(a, b){
    const sa = extractStroke(a) || 'Z';
    const sb = extractStroke(b) || 'Z';
    const ai = STROKE_ORDER.indexOf(sa), bi = STROKE_ORDER.indexOf(sb);
    const aOrd = ai < 0 ? 99 : ai;
    const bOrd = bi < 0 ? 99 : bi;
    if(aOrd !== bOrd) return aOrd - bOrd;
    return distanceNum(a) - distanceNum(b);
  }

  // opts.season — when present, only results from that season are counted.
  // Empty / omitted means "across all seasons" (legacy behavior).
  function statsForSwimmer(sw, opts){
    const season = (opts && opts.season) || '';
    const results = season
      ? (sw.results||[]).filter(r => r && r.season === season)
      : (sw.results||[]);
    const total = results.length;
    const events = {};
    const meets = new Set();
    results.forEach(r=>{
      meets.add(r.meet);
      const evKey = r.event;
      if(!events[evKey]) events[evKey] = [];
      events[evKey].push(r);
    });
    const bestTimes = Object.entries(events).map(([event, arr])=>{
      const sorted = arr.slice().sort((a,b)=> (a.seconds||Infinity)-(b.seconds||Infinity));
      const byDate = arr.slice().sort((a,b)=> (new Date(a.date).getTime()||0) - (new Date(b.date).getTime()||0));
      const first  = byDate.find(r => isFinite(r.seconds));
      const latest = byDate.slice().reverse().find(r => isFinite(r.seconds));
      const best   = sorted[0];
      const improvement    = (first && isFinite(first.seconds)) ? (first.seconds - best.seconds) : 0;
      const improvementPct = (first && first.seconds) ? ((first.seconds - best.seconds) / first.seconds * 100) : 0;
      const latestIsPR = !!(latest && best && latest.seconds === best.seconds && arr.length >= 2);
      return {
        event,
        time: best.time, seconds: best.seconds, count: arr.length, history: arr,
        stroke: best.stroke || extractStroke(event),
        distance: best.distance || extractDistance(event),
        bestMeet: best.meet, bestDate: best.date,
        firstTime: first ? first.time : null,   firstSeconds: first ? first.seconds : null,   firstDate: first ? first.date : null,
        latestTime: latest ? latest.time : null, latestSeconds: latest ? latest.seconds : null, latestDate: latest ? latest.date : null,
        improvement, improvementPct, latestIsPR
      };
    }).sort((a,b)=> compareEventLabel(a.event, b.event));

    let prCount = 0;
    bestTimes.forEach(b=>{
      if(b.history.length >= 2){
        const sorted = b.history.slice().sort((a,b)=> new Date(a.date)-new Date(b.date));
        if(sorted[sorted.length-1].seconds <= sorted[0].seconds) prCount++;
      }
    });

    // Place breakdown across all races
    let gold = 0, silver = 0, bronze = 0, top10 = 0;
    results.forEach(r => {
      const p = parseInt(r.place, 10);
      if(!isFinite(p) || p <= 0) return;
      if(p === 1) gold++;
      else if(p === 2) silver++;
      else if(p === 3) bronze++;
      if(p <= 10) top10++;
    });

    // Stroke usage breakdown
    const strokeCounts = {};
    results.forEach(r => {
      const s = r.stroke || extractStroke(r.event) || 'Other';
      if(s) strokeCounts[s] = (strokeCounts[s]||0) + 1;
    });

    // Recent meets (unique, by date desc)
    const meetMap = {};
    results.forEach(r => {
      if(!r.meet) return;
      const d = new Date(r.date).getTime() || 0;
      if(!meetMap[r.meet] || d > meetMap[r.meet].date){
        meetMap[r.meet] = { meet: r.meet, date: d, dateStr: r.date, races: 0 };
      }
    });
    Object.values(meetMap).forEach(m => {
      m.races = results.filter(r => r.meet === m.meet).length;
    });
    const recentMeets = Object.values(meetMap).sort((a,b)=> b.date - a.date);
    const recentMeet  = recentMeets[0] || null;

    // Most-improved + favorite (most-raced) event
    const improved   = bestTimes.slice().filter(b => b.improvement > 0).sort((a,b)=> b.improvement - a.improvement);
    const mostImproved = improved[0] || null;
    const favorite     = bestTimes.slice().sort((a,b)=> b.count - a.count)[0] || null;
    const totalTimeDropSec = bestTimes.reduce((sum,b)=> sum + Math.max(0, b.improvement), 0);

    const placeNums = results.map(r => parseInt(r.place,10)).filter(p => isFinite(p) && p > 0);
    const avgPlace  = placeNums.length ? (placeNums.reduce((s,p)=>s+p,0) / placeNums.length) : null;

    return {
      totalRaces: total,
      meetCount: meets.size,
      eventCount: bestTimes.length,
      prCount,
      bestTimes,
      gold, silver, bronze, top10,
      podiumCount: gold + silver + bronze,
      strokeCounts,
      recentMeets, recentMeet,
      mostImproved, favorite,
      totalTimeDropSec,
      avgPlace,
      ageGroup: getAgeGroup(sw.age)
    };
  }

  // For one swimmer, where do they rank in their age group for each event they've swum?
  function rankSwimmerInAgeGroup(sw, allSwimmers){
    const ag = getAgeGroup(sw.age);
    const myEvents = {};
    (sw.results||[]).forEach(r => {
      if(!isFinite(r.seconds)) return;
      if(!(r.event in myEvents) || r.seconds < myEvents[r.event]) myEvents[r.event] = r.seconds;
    });
    const ranks = {};
    Object.entries(myEvents).forEach(([event, mySec]) => {
      const competitors = [];
      Object.values(allSwimmers).forEach(other => {
        if(getAgeGroup(other.age) !== ag) return;
        let best = Infinity;
        (other.results||[]).forEach(r => {
          if(r.event === event && isFinite(r.seconds) && r.seconds < best) best = r.seconds;
        });
        if(isFinite(best)) competitors.push({ key: other.key, sec: best });
      });
      competitors.sort((a,b)=> a.sec - b.sec);
      const idx = competitors.findIndex(c => c.key === sw.key);
      ranks[event] = { rank: idx + 1, total: competitors.length };
    });
    return { ageGroup: ag, ranks };
  }

  // Build leaderboards across the whole roster.
  // Returns array of { ageGroup, bracket, gender, event, stroke, distance, entries:[...] }
  // where ageGroup is the combined "Boys 11-12" / "Girls 11-12" label
  // (unless opts.splitByGender === false), and `bracket` is the plain
  // numeric bracket ("11-12") so callers can still color-code by age.
  function buildLeaderboards(allSwimmers, opts = {}){
    const stroke = opts.stroke || null;
    const top    = opts.top || 5;
    const splitByGender = opts.splitByGender !== false;
    const season = opts.season || '';
    const buckets = {};
    Object.values(allSwimmers).forEach(sw => {
      const bracket = getAgeGroup(sw.age);
      const ag = splitByGender ? competitionGroup(sw) : bracket;
      const byEvent = {};
      (sw.results||[]).forEach(r => {
        if(!isFinite(r.seconds)) return;
        if(season && r.season !== season) return;
        const evStroke = r.stroke || extractStroke(r.event);
        if(stroke && evStroke !== stroke) return;
        if(!byEvent[r.event] || r.seconds < byEvent[r.event].seconds) byEvent[r.event] = r;
      });
      Object.entries(byEvent).forEach(([event, r]) => {
        const key = ag + '||' + event;
        if(!buckets[key]){
          buckets[key] = {
            ageGroup: ag, bracket, gender: sw.gender || '', event,
            stroke: r.stroke || extractStroke(event) || 'Other',
            distance: r.distance || extractDistance(event),
            entries: []
          };
        }
        buckets[key].entries.push({
          swimmerKey: sw.key,
          swimmerName: sw.name,
          gender: sw.gender || '',
          time: r.time,
          seconds: r.seconds,
          meet: r.meet,
          date: r.date,
          age: sw.age || ''
        });
      });
    });
    Object.values(buckets).forEach(b => {
      b.entries.sort((a,b) => a.seconds - b.seconds);
      b.entries = b.entries.slice(0, top);
    });
    return Object.values(buckets);
  }

  // Team-wide aggregate stats. opts.season filters every count + the
  // time-dropped sum to a single season; omit for an all-time view.
  function teamStats(allSwimmers, opts){
    const season = (opts && opts.season) || '';
    const swimmers = Object.values(allSwimmers);
    const filteredResults = sw => season
      ? (sw.results||[]).filter(r => r && r.season === season)
      : (sw.results||[]);
    const totalRaces = swimmers.reduce((s, x) => s + filteredResults(x).length, 0);
    const meets = new Set();
    let gold=0, silver=0, bronze=0;
    let totalDropSec = 0;
    let prRaces = 0;
    let activeSwimmers = 0;
    swimmers.forEach(sw => {
      const seasonResults = filteredResults(sw);
      if(!seasonResults.length) return;
      activeSwimmers++;
      const s = statsForSwimmer(sw, { season });
      gold += s.gold; silver += s.silver; bronze += s.bronze;
      totalDropSec += s.totalTimeDropSec;
      prRaces += s.prCount;
      seasonResults.forEach(r => meets.add(r.meet));
    });
    return {
      swimmerCount: season ? activeSwimmers : swimmers.length,
      totalRaces, meetCount: meets.size,
      gold, silver, bronze,
      podium: gold + silver + bronze,
      totalDropSec, prRaces,
      season: season || null
    };
  }

  // Break stats out per season — used by the Admin "Time dropped by season"
  // card so coaches can see at a glance how much time has been shaved off
  // each season. Returns an array sorted newest-first.
  function teamStatsBySeason(allSwimmers){
    const seasons = getAllSeasons(allSwimmers);
    const out = seasons.map(s => ({ ...teamStats(allSwimmers, { season: s }), season: s }));
    // Also include an "Untagged" pseudo-season for legacy data with no season set,
    // but only if any such results exist — keeps the card honest about coverage.
    const hasUntagged = Object.values(allSwimmers).some(sw =>
      (sw.results||[]).some(r => !r || !r.season));
    if(hasUntagged){
      const swPool = Object.fromEntries(Object.entries(allSwimmers).map(([k, sw]) => [
        k, { ...sw, results: (sw.results||[]).filter(r => !r || !r.season).map(r => ({ ...r, season:'__untagged' })) }
      ]));
      const t = teamStats(swPool, { season: '__untagged' });
      out.push({ ...t, season: '(Untagged)' });
    }
    return out;
  }

  // -------- Theme --------
  function initTheme(){
    const saved = localStorage.getItem('hhst.theme');
    if(saved) document.documentElement.setAttribute('data-theme', saved);
  }
  function toggleTheme(){
    const cur = document.documentElement.getAttribute('data-theme');
    const next = cur === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('hhst.theme', next);
  }

  // Group an array of swimmers into the canonical HHST age brackets,
  // preserving AGE_GROUP_ORDER. Useful for pages that want to render the
  // roster split into bracket sections.
  function groupByBracket(swimmers){
    const buckets = {};
    AGE_GROUP_ORDER.forEach(g => { buckets[g] = []; });
    (swimmers||[]).forEach(sw => {
      const b = sw.bracket || getAgeGroup(sw.age);
      (buckets[b] || buckets['Unknown']).push(sw);
    });
    Object.values(buckets).forEach(list => list.sort((a,b)=> (a.name||'').localeCompare(b.name||'')));
    return buckets;
  }

  global.HHST = {
    readAll, getSwimmer,
    parseCSV, ingestCSV, ingestRows,
    findSwimmer,
    deleteSwimmer, pruneNonRosterSwimmers, addSwimmerManual, updateSwimmer,
    clearAll, clearRoster, clearMeetTimes,
    isAdminLoggedIn, loginAdmin, logoutAdmin, onAuthChanged,
    statsForSwimmer, rankSwimmerInAgeGroup, buildLeaderboards, teamStats, teamStatsBySeason,
    getAllSeasons, currentSeason, filterSwimmerToSeason,
    getAgeGroup, AGE_GROUP_ORDER, STROKE_ORDER, extractStroke, extractDistance, distanceNum, compareEventLabel,
    fmtTime, timeToSeconds, swimmerKey, slugify, meetTimeDocId, norm,
    mapHeader, normHeaderKey,
    fixNameOrder, isValidEmail, ageFromDob,
    normalizeEventLabel,
    leaderboardsByEvent, sortAgeGroups,
    groupByBracket,
    parseGender, parseGenderFromAgeGroup, genderLabel, competitionGroup,
    initTheme, toggleTheme
  };
})(window);
