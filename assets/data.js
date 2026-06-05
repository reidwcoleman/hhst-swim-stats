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
  // season — when given, the bracket/gender are read from that season's
  // seasonInfo (via swimmerSeasonInfo) so a swimmer who aged up shows in
  // the right age group for each season. Omit for the most-recent view.
  function competitionGroup(sw, season){
    if(!sw) return 'Unknown';
    const info = swimmerSeasonInfo(sw, season);
    const bracket = resolveBracket(info);
    const g = genderLabel(info.gender);
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
    // Per-file provenance. When the admin page passes an uploadId (one per
    // dropped file) we tag every result + roster-membership it produces with
    // it, and write a row into hhst_uploads. That's what lets a coach later
    // remove a single file's contribution (one meet, one roster) without
    // clearing everything. Omitted for legacy/manual paths — those rows just
    // carry no uploadId and stay outside the per-file delete system.
    const uploadId = (opts.uploadId || '').toString().trim();
    const fileName = (opts.fileName || '').toString();
    // Named-meet upload: the coach gives the meet an explicit name (e.g.
    // "Highcroft at Riverstone") and optional date that apply to EVERY race in
    // the file, regardless of what the file's Meet/Date columns say. This is how
    // one upload == one named meet. Omitted for roster uploads and for legacy
    // column-driven meet imports, which fall back to the file's own columns.
    const meetName = (opts.meetName || '').toString().trim();
    const meetDate = (opts.meetDate || '').toString().trim();
    // Time-trial flag: when set, every result this upload creates is stamped
    // timeTrial:true. Such results still live on the swimmer's profile (best
    // times, meet history, charts) but are EXCLUDED from all team/competitive
    // boards — Fastest Five, Most Improved, season leaderboards, team stats,
    // and profile rankings — so an informal practice swim never tops a board.
    const timeTrial = !!opts.timeTrial;
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
    const newSwimmerKeys = new Set(); // swimmers first created by THIS upload (roster mode)

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
    // A row is "self-describing" when it carries enough to stand up a roster
    // entry on its own: a name (always required) plus at least one real
    // attribute — age, age group, gender, DOB, or training group. A meet file
    // made of such rows (the team's Top Times export, where every line has an
    // age + age_group) doubles as a roster, so we let it CREATE swimmers in the
    // same pass instead of forcing a separate roster upload first. Times-only
    // rows (just name + event + time) still require an existing roster, which
    // preserves the old guard against a stray meet file inventing swimmers.
    function hasRosterIdentity(rec){
      const hasAge = !!(rec.age && /^\d{1,3}$/.test(rec.age.trim()));
      return hasAge || !!rec.agegroup || !!rec.gender || !!rec.dob
          || !!rec.rostergroup || !!rec.group;
    }
    for(const rec of records){
      const key = rec.__key;
      const name = rec.__name;
      const selfDescribing = hasRosterIdentity(rec);
      // In results mode we don't create a swimmer who isn't already on the
      // roster — UNLESS the row is self-describing, in which case it carries its
      // own roster identity and is created below (one-step self-contained meet).
      if(mode === 'results' && !existing[key] && !updates[key] && !selfDescribing){
        skippedSwimmers.add(name);
        continue;
      }
      // Per-season roster gate: when uploading times for a specific season,
      // only match swimmers who were on THAT season's roster. Legacy
      // (untagged, no seasons array) swimmers still match as a wildcard so
      // pre-seasons data keeps working. A self-describing row is exempt — it
      // establishes the swimmer's membership for this season as it imports.
      if(mode === 'results' && season && existing[key] && !updates[key] && !selfDescribing){
        const sw = existing[key];
        const sws = Array.isArray(sw.seasons) ? sw.seasons : [];
        if(sws.length && !sws.includes(season)){
          skippedSwimmers.add(`${name} (not on ${season} roster)`);
          continue;
        }
      }
      if(!updates[key]){
        if(!existing[key]) newSwimmerKeys.add(key);
        updates[key] = existing[key] || {
          key, name,
          address: '',
          emails: [],
          parents: [],
          age: '',
          group: '',
          ageGroup: '',
          gender: '',
          seasons: [],
          seasonInfo: {},
          rosterUploads: {},
          results: []
        };
        // ensure shape
        updates[key].emails     = updates[key].emails     || [];
        updates[key].parents    = updates[key].parents    || [];
        updates[key].results    = updates[key].results    || [];
        updates[key].seasons    = updates[key].seasons    || [];
        updates[key].seasonInfo = updates[key].seasonInfo || {};
        updates[key].rosterUploads = (updates[key].rosterUploads && typeof updates[key].rosterUploads === 'object') ? updates[key].rosterUploads : {};
      }
      writtenKeys.add(key);
      const sw = updates[key];
      let touched = false;
      // Compose address from line1 + city + state + zip when available
      if(!sw.address){
        const composed = composeAddress(rec);
        if(composed){ sw.address = composed; touched = true; }
      }
      // ===== PER-SEASON ATTRIBUTES (age / group / ageGroup / gender / bracket) =====
      // These vary by season — a swimmer is 10 in 2024 and 12 in 2026 — so they
      // live in sw.seasonInfo[season] rather than a single top-level value.
      // `tgt` is the per-season record for this row's season; when no season is
      // known (legacy upload) we fall back to writing top-level so old data
      // keeps working. We OVERWRITE within the season (so re-uploading a roster
      // corrects a wrong age) but only when the incoming cell actually has a
      // value — a blank age column must never wipe a good one.
      const sSeason = (rec.season || '').toString().trim() || season;
      // Lazily get-or-create the per-season record — only when we actually have
      // an attribute to write. A times-only row (no age/group/gender columns)
      // never creates a record, so we don't litter seasonInfo with empty
      // {bracket:'Unknown'} stubs that would later blank out the mirror.
      function seasonTgt(){
        if(!sSeason) return sw;
        if(!sw.seasonInfo || typeof sw.seasonInfo !== 'object') sw.seasonInfo = {};
        if(!sw.seasonInfo[sSeason]) sw.seasonInfo[sSeason] = {};
        return sw.seasonInfo[sSeason];
      }
      // Age — accept a plain numeric value, else compute from DOB. Overwrite
      // within the season when we have a fresh value (so a re-upload corrects
      // a wrong age) but never wipe a good value with a blank cell.
      let freshAge = '';
      if(rec.age && /^\d{1,3}$/.test(rec.age.trim())){
        freshAge = rec.age.trim();
      } else if(rec.dob){
        freshAge = ageFromDob(rec.dob) || '';
      }
      if(freshAge){
        const t = seasonTgt();
        if(t.age !== freshAge){ t.age = freshAge; touched = true; }
      }
      // group = team training group (RosterGroup / Bronze, Silver, Gold)
      {
        const g = (rec.rostergroup && rec.rostergroup.trim()) || (rec.group && rec.group.trim()) || '';
        if(g){ const t = seasonTgt(); if(t.group !== g){ t.group = g; touched = true; } }
      }
      // ageGroup = competition age class label ("Boys 13-14") as exported
      {
        const ag = (rec.agegroup && rec.agegroup.trim()) || '';
        if(ag){ const t = seasonTgt(); if(t.ageGroup !== ag){ t.ageGroup = ag; touched = true; } }
      }
      // Gender — explicit gender/sex column wins; else parse from the ageGroup
      // label ("Boys 11-12" → M, "Girls 6 & Under" → F).
      {
        let g = parseGender(rec.gender);
        if(!g) g = parseGenderFromAgeGroup(rec.agegroup);
        if(!g) g = parseGenderFromAgeGroup((sSeason && sw.seasonInfo && sw.seasonInfo[sSeason] && sw.seasonInfo[sSeason].ageGroup) || '');
        if(g){ const t = seasonTgt(); if(t.gender !== g){ t.gender = g; touched = true; } }
      }
      // Bracket is derived from THIS season's age — only when an age exists, so
      // we never stamp 'Unknown' onto an otherwise-empty record. A real upload
      // also promotes the record from an estimate to exact.
      {
        const t = sSeason ? (sw.seasonInfo && sw.seasonInfo[sSeason]) : sw;
        if(t && t.age){
          const b = getAgeGroup(t.age);
          if(t.bracket !== b){ t.bracket = b; touched = true; }
        }
        if(t && t.estimated && (freshAge || (rec.rostergroup||rec.group||rec.agegroup||rec.gender))){
          delete t.estimated; touched = true;
        }
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
      // Per-season roster membership: when this row came from a roster upload
      // tagged with a season, record that the swimmer was on the team that
      // season. Times uploads also append the season here as a side-effect —
      // a swim that gets matched is implicit proof of roster membership.
      // The seasons list is what the times-mode gate above checks against.
      if(sSeason){
        if(!Array.isArray(sw.seasons)) sw.seasons = [];
        if(!sw.seasons.includes(sSeason)){
          sw.seasons.push(sSeason);
          touched = true;
        }
      }
      // Roster-membership provenance: which roster file(s) put this swimmer on
      // this season's roster. Only roster uploads write here — a times upload
      // implies membership but doesn't "own" it, so removing a meet file never
      // drops anyone from the roster. deleteUpload() reads this to know when a
      // season's last roster file is gone and the membership can be retired.
      if(sSeason && uploadId && mode === 'roster'){
        if(!sw.rosterUploads || typeof sw.rosterUploads !== 'object') sw.rosterUploads = {};
        const arr = Array.isArray(sw.rosterUploads[sSeason]) ? sw.rosterUploads[sSeason] : [];
        if(!arr.includes(uploadId)){ arr.push(uploadId); touched = true; }
        sw.rosterUploads[sSeason] = arr;
      }
      // Mirror the most-recent season that actually HAS attribute content up to
      // the top-level fields. Keeps legacy reads (sw.age / sw.bracket / etc.)
      // and the all-seasons view showing a sensible value. Fields are sticky
      // (fall back to the prior top-level value) so a partial newest season
      // can't half-blank the mirror, and a times-only season (no content)
      // never wipes the swimmer's known age.
      {
        const mr = mostRecentSeasonInfoKey(sw);
        const L = (mr && sw.seasonInfo) ? sw.seasonInfo[mr] : null;
        if(L){
          sw.age      = L.age      || sw.age      || '';
          sw.group    = L.group    || sw.group    || '';
          sw.ageGroup = L.ageGroup || sw.ageGroup || '';
          sw.gender   = L.gender   || sw.gender   || '';
          sw.bracket  = sw.age ? getAgeGroup(sw.age) : (sw.bracket || 'Unknown');
        } else if(sw.age){
          // Legacy / no-season write landed top-level — keep bracket coherent.
          sw.bracket = getAgeGroup(sw.age);
        }
      }
      if(touched) profileUpdated.add(key);
      if(rec.event && rec.time){
        // Per-row season can override the upload-level default — useful when
        // the spreadsheet has a `season` column (rec.season is grabbed below
        // from the header aliases). EXCEPTION: a named-meet upload is, by
        // definition, one meet in the one season the coach picked — so a stray
        // Season/Year column in the file must NOT scatter that meet across
        // seasons. When meetName is set we pin every race to the upload season.
        const rowSeason = meetName ? season : ((rec.season || '').toString().trim() || season);
        const stroke = extractStroke(rec.event);
        let distance = (rec.distance||'').toString().trim() || extractDistance(rec.event);
        // Stroke-only "best times" files carry a stroke ("Freestyle") but no
        // distance. Infer the distance from the swimmer's age group FOR THIS
        // SEASON (6&U 15y, 7-8 & 9-10 25y, 11-12 and older 50y) so the time
        // lands on a real event ("50 Free") and shows on leaderboards / Fastest
        // Five, instead of a distanceless "Freestyle" bucket. IM is skipped (it
        // has no single signature distance). Only fills a MISSING distance —
        // a file that already specifies one is never overridden.
        if(!distance && stroke && stroke !== 'IM'){
          const inferred = distanceForBracket(resolveBracket(swimmerSeasonInfo(sw, rowSeason)));
          if(inferred) distance = inferred;
        }
        // Build the canonical "<dist> <Stroke>" label once we (maybe) inferred a
        // distance, so the event stacks with the same event from meet files.
        const eventLabel = (distance && stroke)
          ? `${distance} ${STROKE_ABBREV[stroke] || stroke}`
          : normalizeEventLabel(rec);
        const timeStr = fmtTime(rec.time);
        const result = {
          event: eventLabel,
          distance,
          stroke,
          time: timeStr,
          seconds: timeToSeconds(timeStr),
          meet: meetName || rec.meet || 'Unknown Meet',
          date: meetDate || rec.date || '',
          place: rec.place || '',
          split: rec.split || '',
          season: rowSeason,
          uploadId: uploadId || ''
        };
        if(timeTrial) result.timeTrial = true;
        // Skip an EXACT duplicate race (same meet + season + event + time).
        // Re-uploading the same meet file then becomes idempotent instead of
        // stacking a 2nd/3rd/4th identical time onto every swimmer. Genuinely
        // different times (e.g. a prelim and a final) differ in `time`, so
        // they're still kept.
        const isExactDup = sw.results.some(r =>
          r && r.meet === result.meet && (r.season || '') === (result.season || '')
          && r.event === result.event && r.time === result.time);
        if(isExactDup) continue;
        sw.results.push(result);
        added++;
        // Record the meet for the registry/summary — but don't let a meetless
        // legacy row register the synthetic 'Unknown Meet' placeholder (matches
        // the pre-named-meet behavior).
        if(meetName || rec.meet) meetNames.add(result.meet);
        // Stage a mirror write to hhst_meet_times. Doc id = swimmer + event +
        // season + uploadId. Including the uploadId means each file owns its own
        // mirror docs, so two meet files that both carry the same swimmer+event+
        // season don't clobber one shared doc — and deleteUpload's
        // where('uploadId','==',…) wipe stays exactly 1:1 with this file's rows.
        const mirrorBase = rowSeason
          ? `${meetTimeDocId(key, eventLabel)}__${slugify(rowSeason)}`
          : meetTimeDocId(key, eventLabel);
        const mirrorId = uploadId ? `${mirrorBase}__${slugify(uploadId)}` : mirrorBase;
        // Mirror uses THIS row's season attributes (age group / gender) so a
        // time from 2024 carries the swimmer's 2024 age group, not their
        // current one.
        const mi = swimmerSeasonInfo(sw, rowSeason);
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
            ageGroup: mi.bracket || getAgeGroup(mi.age),
            gender: mi.gender || '',
            competitionGroup: competitionGroup(sw, rowSeason),
            season: rowSeason,
            uploadId: uploadId || ''
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
        // One doc per swimmer (id = swimmer key, so pruneNonRosterSwimmers
        // can still treat doc ids as swimmer keys). The per-season truth
        // rides along in seasonInfo; top-level age/ageGroup mirror the most
        // recent season for the simple view.
        batch.set(ref, {
          swimmerKey: k,
          name: sw.name,
          age: sw.age || '',
          ageGroup: sw.bracket || getAgeGroup(sw.age),
          gender: sw.gender || '',
          competitionGroup: competitionGroup(sw),
          group: sw.group || '',
          seasons: Array.isArray(sw.seasons) ? sw.seasons : [],
          seasonInfo: (sw.seasonInfo && typeof sw.seasonInfo === 'object') ? sw.seasonInfo : {},
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

    // Record this file in the uploads registry so it shows in the admin's
    // "Uploaded files" list and can be removed on its own later. Skipped when
    // no uploadId was supplied (legacy/manual ingest) so we don't create
    // un-deletable phantom rows.
    if(uploadId){
      try {
        await FB.db.collection('hhst_uploads').doc(uploadId).set({
          uploadId,
          fileName: fileName || '',
          season,
          mode,
          timeTrial,
          meetName: meetName || '',
          meetDate: meetDate || '',
          addedResults: added,
          swimmerCount: writtenKeys.size,
          newSwimmerKeys: Array.from(newSwimmerKeys),
          touchedSwimmerKeys: Array.from(writtenKeys),
          meetNames: Array.from(meetNames),
          uploadedAt: FB.FieldValue.serverTimestamp()
        }, { merge: true });
      } catch(e){
        // The ingest itself already committed, but without this registry row the
        // file won't show in "Uploaded files" and can't be removed on its own.
        // Surface it as an error so the admin knows rather than failing silently.
        errors.push(`Saved data but could not register "${fileName || uploadId}" in the uploaded-files list (remove-by-file unavailable for it): ${e && e.message || e}`);
      }
    }

    return {
      added,
      swimmers: writtenKeys.size,
      newSwimmers: newSwimmerKeys.size,
      profileUpdates: profileUpdated.size,
      skippedSwimmers: Array.from(skippedSwimmers),
      meets: meetNames.size,
      uploadId: uploadId || '',
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
    // When opts.meet is set, the board is built ONLY from times swum at that
    // meet (the Fastest Five posters use this to show the most recent meet's
    // results, not a swimmer's season-best). Unset → best time of the season.
    const meet = (opts && opts.meet) || '';
    const byGroup = {};
    for(const sw of swimmers){
      // Use the swimmer's age/bracket FOR THE SELECTED SEASON (so a kid who
      // aged up is grouped correctly per season, not by their latest age).
      const info = swimmerSeasonInfo(sw, season);
      const bracket = resolveBracket(info);
      if(!bracket || bracket === 'Unknown') continue;
      // People filter: when scoped to a season, only include swimmers on that
      // season's roster. Legacy swimmers with no seasons array still match.
      if(season){
        const sws = Array.isArray(sw.seasons) ? sw.seasons : [];
        if(sws.length && !sws.includes(season)) continue;
      }
      const group = splitByGender ? competitionGroup(sw, season) : bracket;
      if(!group || group === 'Unknown') continue;
      const matching = (sw.results||[]).filter(r => {
        if(r.timeTrial) return false; // time trials excluded from Fastest Five / leaderboards
        if(season && r.season !== season) return false;
        if(meet && r.meet !== meet) return false;
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
        gender: info.gender || '',
        time: best.time,
        seconds: best.seconds,
        meet: best.meet,
        date: best.date,
        age: info.age || ''
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

  // Parse the assorted date strings results carry — ISO "2025-06-14" or
  // US "07/15/25" / "7/15/2025" — into a sortable epoch ms. NaN when blank or
  // unparseable. (Two-digit years map to 2000+.)
  function parseFlexibleDate(s){
    if(!s) return NaN;
    const str = s.toString().trim();
    if(!str) return NaN;
    let m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if(m) return new Date(+m[1], +m[2]-1, +m[3]).getTime();
    m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if(m){ let y = +m[3]; if(y < 100) y += 2000; return new Date(y, +m[1]-1, +m[2]).getTime(); }
    const t = Date.parse(str);
    return isFinite(t) ? t : NaN;
  }
  // Distinct meets within a season, each with a representative (latest) date,
  // sorted OLDEST → NEWEST. A meet with no date (e.g. a preseason best-times
  // "Practice Meet") sorts earliest, so a later real meet becomes the target.
  function meetsInSeason(swimmers, season){
    const byMeet = new Map();
    let seq = 0;
    swimmers.forEach(sw => (sw.results||[]).forEach(r => {
      if(!r || !r.meet) return;
      if(r.timeTrial) return; // time trials never count as a meet (keeps them out of Fastest Five / Most Improved targeting)
      if(season && r.season !== season) return;
      const ts = parseFlexibleDate(r.date);
      const cur = byMeet.get(r.meet);
      if(!cur){ byMeet.set(r.meet, { meet: r.meet, ts: isFinite(ts) ? ts : -Infinity, dateStr: r.date || '', seq: seq++ }); }
      else if(isFinite(ts) && ts > cur.ts){ cur.ts = ts; cur.dateStr = r.date || cur.dateStr; }
    }));
    // Sort oldest → newest by date. Dateless meets (ts === -Infinity) sort
    // earliest. Comparing two ts values with subtraction would yield NaN when
    // both are -Infinity (the all-dateless case), leaving the order undefined —
    // so fall back to first-seen order (`seq`) on any tie to keep "most recent
    // meet" deterministic instead of dependent on swimmer iteration order.
    return Array.from(byMeet.values()).sort((a, b) => {
      if(a.ts !== b.ts){
        if(!isFinite(a.ts)) return -1;
        if(!isFinite(b.ts)) return 1;
        return a.ts - b.ts;
      }
      return a.seq - b.seq;
    });
  }
  // ---- Most Improved (latest meet vs the meet before it) ----------------
  // Ranks swimmers by total seconds dropped between the current season's most
  // recent meet (the "target") and the meet immediately before it within the
  // SAME season (the "baseline" — "compare the second meet to the first meet").
  // The season needs at least two meets: with only one, there's nothing to
  // compare against and the function returns empty (the board stays hidden). It
  // never reaches into a previous season. For each (swimmer, event) swum at
  // BOTH meets, drop = baseline time − target time, counted only when faster.
  // Returns { meet, date, baselineMeet, baselineSeason, boards } where boards is
  // keyed by competitionGroup ("Boys 11-12" / "Girls 11-12" / bare bracket).
  // opts.season scopes the target meet (defaults handled by the caller).
  function mostImprovedAtMeet(allSwimmers, opts){
    opts = opts || {};
    const limit = opts.limit || 5;
    const splitByGender = opts.splitByGender !== false;
    const season = (opts.season || '').toString();
    const swimmers = Array.isArray(allSwimmers) ? allSwimmers : Object.values(allSwimmers);
    const empty = { meet:'', date:'', baselineMeet:'', baselineSeason:'', boards:{} };

    // 1) Target meet = the most recent meet in `season` (explicit override wins).
    const seasonMeets = meetsInSeason(swimmers, season);
    if(!seasonMeets.length) return empty;
    let target = opts.meet
      ? seasonMeets.find(m => m.meet === opts.meet) || { meet: opts.meet, ts: -Infinity, dateStr: opts.date || '' }
      : seasonMeets[seasonMeets.length - 1];

    // 2) Baseline meet = the meet just before target IN THIS SEASON. Most
    //    Improved only makes sense once the season has two meets to compare —
    //    when there's just one, return empty so the board stays hidden (we do
    //    NOT reach back into a previous season).
    const baselineSeason = season;
    const tIdx = seasonMeets.findIndex(m => m.meet === target.meet);
    const baseline = tIdx > 0 ? seasonMeets[tIdx - 1] : null;
    if(!baseline) return empty;

    // 3) For each swimmer, compare their target-meet time to their baseline-meet
    //    time, per event (best time at each meet when an event was swum twice).
    const drops = [];
    swimmers.forEach(sw => {
      // People filter: only rank swimmers on this season's roster (legacy
      // swimmers with no seasons array still match).
      if(season){
        const sws = Array.isArray(sw.seasons) ? sw.seasons : [];
        if(sws.length && !sws.includes(season)) return;
      }
      // Index each meet's swims by STROKE, then by distance. Matching on stroke
      // (not the raw event label) is what makes the comparison survive the
      // common case where the earlier "practice meet" was uploaded WITHOUT a
      // distance: that file's distance gets inferred from the swimmer's age
      // bracket (6&U→15, 7-8/9-10→25, 11-12+→50), which can disagree with the
      // real distance the swimmer actually raced at the later meet. Keying on
      // the event label ("15 Free" vs "25 Free") would silently drop those
      // swimmers from Most Improved entirely. tgtByStroke[stroke] is a Map of
      // distance → { sec, ev } holding the swimmer's best swim of that stroke.
      const strokeOf = r => r.stroke || extractStroke(r.event) || '';
      const distOf   = r => ((r.distance != null ? String(r.distance) : '').trim() || extractDistance(r.event) || '');
      const tgtByStroke = {}, baseByStroke = {};
      function indexResult(into, r){
        const st = strokeOf(r); if(!st) return;     // unstroked legacy row → can't compare
        const d = distOf(r);
        if(!into[st]) into[st] = new Map();
        const cur = into[st].get(d);
        if(cur === undefined || r.seconds < cur.sec) into[st].set(d, { sec: r.seconds, ev: r.event });
      }
      (sw.results||[]).forEach(r => {
        if(!r || !isFinite(r.seconds)) return;
        if(r.timeTrial) return; // time trials excluded from Most Improved
        if(r.meet === target.meet && (!season || r.season === season)) indexResult(tgtByStroke, r);
        if(r.meet === baseline.meet && (!baselineSeason || r.season === baselineSeason)) indexResult(baseByStroke, r);
      });
      // Plausibility guard for guessed-distance data: no stroke beats freestyle
      // over the same distance, so if a non-free TARGET time is faster than the
      // swimmer's own freestyle at that distance, the distance label is wrong
      // (a 25 mislabeled 50, etc.) — drop it rather than report a fake plunge.
      const tgtFree = tgtByStroke['Freestyle']; // Map dist → { sec, ev } (may be undefined)
      let totalDrop = 0;
      const eventsDropped = [];
      Object.keys(tgtByStroke).forEach(stroke => {
        const tMap = tgtByStroke[stroke];
        const bMap = baseByStroke[stroke];
        if(!bMap) return;                          // stroke not swum at the baseline meet → can't compare
        tMap.forEach((tEntry, dist) => {
          if(stroke !== 'Freestyle' && tgtFree){
            const f = tgtFree.get(dist);
            if(f && tEntry.sec < f.sec) return;    // impossible time → bad distance label, skip
          }
          let bEntry = bMap.get(dist);
          // Distance label diverged across the two meets — almost always because
          // the baseline "practice/best-times" meet had no real distance, so the
          // ingest inferred one from the swimmer's age bracket (6&U→15,
          // 7-8/9-10→25, 11-12+→50) that disagrees with the distance actually
          // raced at the target meet. Fall back to the single same-stroke swim
          // at each meet so the swimmer isn't silently dropped — BUT only when
          // the target race is at least as long as the baseline's (labelled)
          // distance. A faster time over an equal-or-longer race is a genuine
          // improvement; a faster time over a SHORTER race is just the shorter
          // race and would manufacture a huge bogus drop (a 50-yd baseline paired
          // with a 25-yd target reads as a ~20s "improvement"), so we refuse it.
          // When either meet has multiple distances for this stroke we can't tell
          // which swims pair up, so an exact distance match is required instead.
          if(!bEntry && tMap.size === 1 && bMap.size === 1){
            const [bDist, only] = bMap.entries().next().value;
            const tNum = parseInt(dist, 10), bNum = parseInt(bDist, 10);
            if(isFinite(tNum) && isFinite(bNum) && tNum >= bNum) bEntry = only;
          }
          if(!bEntry) return;                      // not swum at the baseline meet → can't compare
          const drop = bEntry.sec - tEntry.sec;
          if(drop > 0){ totalDrop += drop; eventsDropped.push({ event: tEntry.ev, drop }); }
        });
      });
      if(totalDrop > 0){
        const info = swimmerSeasonInfo(sw, season);
        const bracket = resolveBracket(info);
        if(!bracket || bracket === 'Unknown') return;
        drops.push({
          key: sw.key,
          name: sw.name,
          preferredName: sw.preferredName || '',
          gender: info.gender || '',
          age: info.age || '',
          bracket,
          totalDrop,
          eventsDropped,
          eventCount: eventsDropped.length
        });
      }
    });

    // Group by competition group (Boys / Girls / mixed) and slice top N
    const byGroup = {};
    drops.forEach(d => {
      const g = genderLabel(d.gender);
      const key = (splitByGender && g) ? `${g} ${d.bracket}` : d.bracket;
      if(!byGroup[key]) byGroup[key] = [];
      byGroup[key].push(d);
    });
    Object.keys(byGroup).forEach(k => {
      byGroup[k].sort((a,b) => b.totalDrop - a.totalDrop);
      byGroup[k] = byGroup[k].slice(0, limit);
    });

    return {
      meet: target.meet,
      date: target.dateStr || '',
      baselineMeet: baseline.meet,
      baselineSeason: baselineSeason,
      boards: byGroup
    };
  }

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
  // Re-mirror the most-recent CONTENT season's per-season attributes up to the
  // swimmer's top-level age/group/ageGroup/gender/bracket. Shared by the ingest
  // path and deleteUpload so a removal that drops a season keeps the top-level
  // view coherent. Sticky: never blanks a known value when the newest content
  // season is empty.
  function mirrorTopLevelFromSeasons(sw){
    const mr = mostRecentSeasonInfoKey(sw);
    const L = (mr && sw.seasonInfo) ? sw.seasonInfo[mr] : null;
    if(L){
      sw.age      = L.age      || sw.age      || '';
      sw.group    = L.group    || sw.group    || '';
      sw.ageGroup = L.ageGroup || sw.ageGroup || '';
      sw.gender   = L.gender   || sw.gender   || '';
      sw.bracket  = sw.age ? getAgeGroup(sw.age) : (sw.bracket || 'Unknown');
    } else if(sw.age){
      sw.bracket = getAgeGroup(sw.age);
    }
  }

  // -------- Uploaded-files registry (per-file add/remove) --------
  // Every season-scoped upload (roster or meet times) writes one hhst_uploads
  // doc. getUploads lists them (newest first) for the admin "Uploaded files"
  // panel; deleteUpload surgically removes a single file's contribution.
  async function getUploads(){
    const snap = await FB.db.collection('hhst_uploads').get();
    const out = [];
    snap.forEach(d => out.push({ id: d.id, ...d.data() }));
    function ms(u){
      const t = u && u.uploadedAt;
      if(t && typeof t.toMillis === 'function') return t.toMillis();
      if(t && typeof t.seconds === 'number') return t.seconds * 1000;
      return 0;
    }
    out.sort((a,b) => {
      const m = ms(b) - ms(a);
      if(m) return m;
      // Stable secondary sort so equal/absent timestamps still order sensibly.
      const sa = (a.season||''), sb = (b.season||'');
      if(sa !== sb) return compareSeasonsDesc(sa, sb);
      return (b.id||'').localeCompare(a.id||'');
    });
    return out;
  }

  // Remove a single uploaded file's contribution.
  //  • meet-times upload  → strips every result tagged with this uploadId from
  //    each swimmer (and the matching hhst_meet_times mirror docs). Roster
  //    membership is left intact — meets never define the roster.
  //  • roster upload      → drops this file from each swimmer's rosterUploads
  //    provenance. When a season has no roster file left AND the swimmer has no
  //    results in that season, the season membership + seasonInfo are retired.
  //  A swimmer left with no seasons, no results, and no roster provenance is
  //  deleted outright (they only ever existed because of this file).
  // Returns { mode, season, removedResults, removedSwimmers, updatedSwimmers }.
  async function deleteUpload(uploadId){
    uploadId = (uploadId || '').toString().trim();
    if(!uploadId) return { mode:null, season:'', removedResults:0, removedSwimmers:0, updatedSwimmers:0 };
    let meta = null;
    try {
      const uSnap = await FB.db.collection('hhst_uploads').doc(uploadId).get();
      if(uSnap.exists) meta = uSnap.data();
    } catch(e){}

    const swSnap = await FB.db.collection('swimmers').get();
    const toWrite = [];   // full-doc overwrites (so dropped seasonInfo keys actually disappear)
    const toDelete = [];  // orphan swimmer keys
    let removedResults = 0;

    swSnap.forEach(d => {
      const sw = d.data() || {};
      let changed = false;
      // The set of seasons THIS file actually contributed to, via the only two
      // provenance mechanisms we track: a tagged result's season (meet file) or
      // a rosterUploads[season] entry holding this uploadId (roster file). We
      // only ever consider retiring seasons in this set — every other season
      // (legacy roster membership, manually-added seasons, migrated per-season
      // ages, OTHER files' seasons) is left completely untouched. This is what
      // keeps a single-file delete from collaterally destroying unrelated data.
      const touchedSeasons = new Set();

      // 1) Strip results from this upload (recording their seasons as touched).
      const results = Array.isArray(sw.results) ? sw.results : [];
      const keptResults = [];
      results.forEach(r => {
        if(r && r.uploadId === uploadId){
          removedResults++;
          if(r.season) touchedSeasons.add(r.season);
        } else {
          keptResults.push(r);
        }
      });
      if(keptResults.length !== results.length){ sw.results = keptResults; changed = true; }

      // 2) Drop this file from roster provenance (recording its seasons too).
      if(sw.rosterUploads && typeof sw.rosterUploads === 'object'){
        Object.keys(sw.rosterUploads).forEach(s => {
          const arr = Array.isArray(sw.rosterUploads[s]) ? sw.rosterUploads[s] : [];
          if(!arr.includes(uploadId)) return;
          changed = true;
          touchedSeasons.add(s);
          const left = arr.filter(u => u !== uploadId);
          if(left.length) sw.rosterUploads[s] = left;
          else delete sw.rosterUploads[s];
        });
      }

      if(!changed) return;

      // 3) Retire a TOUCHED season only when nothing backs it anymore: no roster
      // file still lists it (rosterUploads[s] gone) AND no remaining race is
      // tagged with it. Seasons this file never touched are never examined, so
      // legacy/manual/migrated memberships and other seasons survive intact.
      const hasProv = s => !!(sw.rosterUploads && typeof sw.rosterUploads === 'object' && Array.isArray(sw.rosterUploads[s]) && sw.rosterUploads[s].length);
      const hasResultInSeason = s => (sw.results || []).some(r => r && r.season === s);
      touchedSeasons.forEach(s => {
        if(hasProv(s) || hasResultInSeason(s)) return; // still backed — keep it
        if(Array.isArray(sw.seasons)) sw.seasons = sw.seasons.filter(x => x !== s);
        if(sw.seasonInfo && typeof sw.seasonInfo === 'object' && sw.seasonInfo[s]) delete sw.seasonInfo[s];
      });

      // Keep the top-level mirror coherent after any seasonInfo/season change.
      mirrorTopLevelFromSeasons(sw);

      // Orphan deletion is reserved for a swimmer who now has NOTHING left:
      // no races, no roster membership of any kind, and no per-season attribute
      // content. That can only happen to a swimmer this file alone created —
      // a legacy/manual swimmer always retains at least one of these.
      const noResults = !((sw.results || []).length);
      const noSeasons = !(Array.isArray(sw.seasons) && sw.seasons.length);
      const noProvenance = !(sw.rosterUploads && typeof sw.rosterUploads === 'object' && Object.keys(sw.rosterUploads).length);
      const noSeasonInfo = !(sw.seasonInfo && typeof sw.seasonInfo === 'object' && Object.values(sw.seasonInfo).some(seasonInfoHasContent));
      if(noResults && noSeasons && noProvenance && noSeasonInfo){
        toDelete.push(d.id);
      } else {
        toWrite.push({ key: d.id, data: sw });
      }
    });

    // Overwrite touched swimmers (merge:false so removed seasonInfo/season keys
    // are actually gone, not silently retained by a merge).
    for(let i=0;i<toWrite.length;i+=400){
      const batch = FB.db.batch();
      toWrite.slice(i, i+400).forEach(w => {
        batch.set(FB.db.collection('swimmers').doc(w.key),
          { ...w.data, updatedAt: FB.FieldValue.serverTimestamp() });
      });
      await batch.commit();
    }
    // Delete fully-orphaned swimmers (also wipes their roster/meet-time mirrors).
    for(const key of toDelete){
      try { await deleteSwimmer(key); } catch(e){ /* keep going */ }
    }

    // Wipe this upload's meet-time mirror docs.
    try {
      const mt = await FB.db.collection('hhst_meet_times').where('uploadId','==',uploadId).get();
      const refs = [];
      mt.forEach(doc => refs.push(doc.ref));
      while(refs.length){
        const batch = FB.db.batch();
        refs.splice(0,400).forEach(ref => batch.delete(ref));
        await batch.commit();
      }
    } catch(e){}

    // Also overwrite hhst_rosters mirrors for surviving touched swimmers so the
    // slim view tracks the change (best-effort, chunked at Firestore's limit).
    try {
      for(let i=0;i<toWrite.length;i+=400){
        const batch = FB.db.batch();
        toWrite.slice(i, i+400).forEach(w => {
          const sw = w.data;
          batch.set(FB.db.collection('hhst_rosters').doc(w.key), {
            swimmerKey: w.key,
            name: sw.name,
            age: sw.age || '',
            ageGroup: sw.bracket || getAgeGroup(sw.age),
            gender: sw.gender || '',
            competitionGroup: competitionGroup(sw),
            group: sw.group || '',
            seasons: Array.isArray(sw.seasons) ? sw.seasons : [],
            seasonInfo: (sw.seasonInfo && typeof sw.seasonInfo === 'object') ? sw.seasonInfo : {},
            uploadedAt: FB.FieldValue.serverTimestamp()
          }); // full overwrite — a merge would leave stale seasonInfo keys behind
        });
        await batch.commit();
      }
    } catch(e){}

    // Remove the registry row itself.
    try { await FB.db.collection('hhst_uploads').doc(uploadId).delete(); } catch(e){}

    // Recompute distinct meet count from the post-delete state we ALREADY have
    // in memory (the swSnap we read up front + the toWrite/toDelete deltas) —
    // no second full-collection scan.
    try {
      const writeMap = new Map(toWrite.map(w => [w.key, w.data]));
      const deleteSet = new Set(toDelete);
      const allMeets = new Set();
      swSnap.forEach(doc => {
        if(deleteSet.has(doc.id)) return;
        const finalDoc = writeMap.get(doc.id) || doc.data();
        (finalDoc.results || []).forEach(r => { if(r && r.meet) allMeets.add(r.meet); });
      });
      await FB.db.collection('meta').doc('stats').set({ meetCount: allMeets.size }, { merge: true });
    } catch(e){}

    return {
      mode: meta ? (meta.mode||null) : null,
      season: meta ? (meta.season||'') : '',
      removedResults,
      removedSwimmers: toDelete.length,
      updatedSwimmers: toWrite.length
    };
  }

  // Remove truly-orphan swimmer docs — entries with no roster membership
  // for ANY season AND no race results. Per-season rosters mean a swimmer
  // who's only on a past season's roster must be preserved (otherwise
  // re-uploading old times would have nowhere to land), so the prune now
  // ONLY catches swimmers that were never properly added: no seasons, no
  // results, no hhst_rosters mirror. Refuses to run if the roster
  // collection is empty so a first-ever times upload can't wipe the DB.
  async function pruneNonRosterSwimmers(){
    const rosterSnap = await FB.db.collection('hhst_rosters').get();
    if(rosterSnap.empty) return [];
    const rosterKeys = new Set();
    rosterSnap.forEach(d => rosterKeys.add(d.id));
    const swSnap = await FB.db.collection('swimmers').get();
    const toDelete = [];
    swSnap.forEach(d => {
      if(rosterKeys.has(d.id)) return;
      const sw = d.data() || {};
      const seasons = Array.isArray(sw.seasons) ? sw.seasons : [];
      const results = Array.isArray(sw.results) ? sw.results : [];
      // A swimmer who's been on any season's roster, or who has any race
      // result on file, is real data — leave them alone.
      if(seasons.length || results.length) return;
      toDelete.push(d.id);
    });
    for(const key of toDelete){
      try { await deleteSwimmer(key); } catch(e){ /* keep going */ }
    }
    return toDelete;
  }

  // -------- One-time migration: estimate per-season ages for legacy data --------
  // The per-season age feature shipped AFTER data was already uploaded under
  // the old single-age schema, so existing swimmers have one frozen age and no
  // seasonInfo — every season shows the same (wrong) age. The exact per-season
  // ages were never stored, so we reconstruct them by year-math: a swimmer who
  // is age A in their most-recent season (year Y) was about A-(Y-y) in an
  // earlier season of year y. This un-mixes the age GROUPS across seasons for
  // the common case. It's an ESTIMATE (flagged estimated:true) and is
  // overwritten exactly the next time that season's roster/times are uploaded.
  // Never touches a season that already has real per-season content.
  // Returns { migrated, scanned }.
  async function migrateSeasonAges(){
    const snap = await FB.db.collection('swimmers').get();
    const writes = [];
    let scanned = 0;
    snap.forEach(d => {
      scanned++;
      const sw = d.data() || {};
      // Every season the swimmer is associated with — roster membership AND
      // any season tag carried on their results (a results-only season would
      // otherwise be selectable but never migrated, so it'd stay mixed).
      const sset = new Set();
      (Array.isArray(sw.seasons) ? sw.seasons : []).forEach(s => { if(s) sset.add(s); });
      (Array.isArray(sw.results) ? sw.results : []).forEach(r => { if(r && r.season) sset.add(r.season); });
      const seasons = Array.from(sset);
      if(!seasons.length) return;
      const anchorAge = parseInt(sw.age, 10);
      if(!isFinite(anchorAge) || anchorAge <= 0) return; // nothing to anchor on
      // Sort newest→oldest with the shared comparator. We ASSUME the stored
      // top-level age is the swimmer's age in their newest season (index 0),
      // then walk back one year per season. Two ways to space the seasons:
      //  • by 4-digit year delta when both years are known (precise)
      //  • by rank order otherwise (so yearless labels like "Summer"/"Winter"
      //    still get distinct, monotonically-younger ages instead of all
      //    collapsing to the frozen anchor age).
      const ordered = seasons.slice().sort(compareSeasonsDesc);
      const anchorYear = seasonYearKey(ordered[0]);
      const info = Object.assign({}, sw.seasonInfo || {});
      let changed = false;
      ordered.forEach((s, idx) => {
        if(seasonInfoHasContent(info[s])) return; // keep exact data, never clobber
        const yr = seasonYearKey(s);
        let est;
        if(anchorYear && yr) est = anchorAge - (anchorYear - yr); // precise year delta
        else est = anchorAge - idx;                               // rank fallback (~1 yr/season)
        if(!isFinite(est)) est = anchorAge;
        if(est < 1) est = 1; // floor at 1 — never bounce back up to the newest age
        const g = sw.gender || '';
        info[s] = {
          age: String(est),
          bracket: getAgeGroup(est),
          group: sw.group || '',
          // Build the label from the estimated bracket + gender rather than
          // copying the stale current-season label.
          ageGroup: (genderLabel(g) ? genderLabel(g) + ' ' : '') + getAgeGroup(est),
          gender: g,
          estimated: true
        };
        changed = true;
      });
      if(changed) writes.push({ key: d.id, seasonInfo: info });
    });
    for(let i=0;i<writes.length;i+=400){
      const batch = FB.db.batch();
      writes.slice(i, i+400).forEach(w => {
        batch.set(FB.db.collection('swimmers').doc(w.key),
          { seasonInfo: w.seasonInfo, updatedAt: FB.FieldValue.serverTimestamp() },
          { merge: true });
      });
      await batch.commit();
    }
    return { migrated: writes.length, scanned };
  }
  // How many swimmers would benefit from migrateSeasonAges (on ≥1 season, have
  // a usable age, and are missing per-season content for some season). Lets the
  // admin show a "fix it" banner only when there's legacy data to fix.
  function countSwimmersNeedingSeasonMigration(allSwimmers){
    const list = Array.isArray(allSwimmers) ? allSwimmers : Object.values(allSwimmers || {});
    let n = 0;
    list.forEach(sw => {
      const sset = new Set();
      (Array.isArray(sw.seasons) ? sw.seasons : []).forEach(s => { if(s) sset.add(s); });
      (Array.isArray(sw.results) ? sw.results : []).forEach(r => { if(r && r.season) sset.add(r.season); });
      const seasons = Array.from(sset);
      if(!seasons.length) return;
      const a = parseInt(sw.age, 10);
      if(!isFinite(a) || a <= 0) return;
      const missing = seasons.some(s => !seasonInfoHasContent((sw.seasonInfo||{})[s]));
      if(missing) n++;
    });
    return n;
  }

  // -------- One-time fix: backfill distances onto stroke-only legacy times --------
  // Older "best times" files imported as distanceless stroke buckets
  // ("Freestyle", "Backstroke") that never appear on a distance-based
  // leaderboard. This walks every embedded result and, for any that has a
  // stroke but no distance, infers the distance from the swimmer's age group
  // FOR THAT RESULT'S SEASON (6&U 15y, 7-8 & 9-10 25y, 11-12 and older 50y) and
  // relabels the event to "<dist> <Stroke>" so it stacks with meet-file events.
  // IM is left alone (no single signature distance), and a result that already
  // has a distance is never touched.
  // opts.apply (default false) = dry run that only counts what WOULD change.
  // Returns { resultsScanned, swimmersAffected, resultsFixed, applied }.
  async function inferMissingDistances(opts){
    const apply = !!(opts && opts.apply);
    const snap = await FB.db.collection('swimmers').get();
    const writes = [];
    let resultsScanned = 0, resultsFixed = 0;
    snap.forEach(d => {
      const sw = d.data() || {};
      // Work on cloned result objects so a dry run never mutates anything and
      // the originals are only replaced when we actually commit.
      const results = (Array.isArray(sw.results) ? sw.results : []).map(r => (r && typeof r === 'object') ? { ...r } : r);
      let changed = false;
      results.forEach(r => {
        if(!r) return;
        resultsScanned++;
        const hasDist = (r.distance != null && String(r.distance).trim() !== '');
        if(hasDist) return;
        const stroke = r.stroke || extractStroke(r.event);
        if(!stroke || stroke === 'IM') return;
        // If the event string itself already encodes a distance, just lift it
        // into the empty distance field rather than inferring.
        const fromEvent = extractDistance(r.event);
        if(fromEvent){
          r.distance = fromEvent;
          if(!r.event || !/\d/.test(r.event)) r.event = `${fromEvent} ${STROKE_ABBREV[stroke] || stroke}`;
          changed = true; resultsFixed++;
          return;
        }
        const inferred = distanceForBracket(resolveBracket(swimmerSeasonInfo(sw, r.season)));
        if(!inferred) return; // unknown age group → can't place it, leave as-is
        r.distance = inferred;
        r.stroke = stroke;
        r.event = `${inferred} ${STROKE_ABBREV[stroke] || stroke}`;
        changed = true; resultsFixed++;
      });
      if(changed) writes.push({ key: d.id, results });
    });
    if(apply){
      for(let i=0;i<writes.length;i+=400){
        const batch = FB.db.batch();
        writes.slice(i, i+400).forEach(w => {
          batch.set(FB.db.collection('swimmers').doc(w.key),
            { results: w.results, updatedAt: FB.FieldValue.serverTimestamp() }, { merge: true });
        });
        await batch.commit();
      }
    }
    return { resultsScanned, swimmersAffected: writes.length, resultsFixed, applied: apply };
  }

  // Rename a meet everywhere it appears in the embedded results (and the
  // meet-time mirror). Used to give a placeholder-named legacy import a real
  // name, e.g. "Unknown Meet" -> "Practice Meet". opts.season optionally scopes
  // the rename to a single season. Returns { resultsRenamed, swimmersAffected }.
  async function renameMeet(fromMeet, toMeet, opts){
    fromMeet = (fromMeet || '').toString();
    toMeet   = (toMeet || '').toString();
    if(!fromMeet || !toMeet || fromMeet === toMeet) return { resultsRenamed:0, swimmersAffected:0 };
    const season = (opts && opts.season) || '';
    const snap = await FB.db.collection('swimmers').get();
    const writes = [];
    let resultsRenamed = 0;
    snap.forEach(d => {
      const sw = d.data() || {};
      const results = (Array.isArray(sw.results) ? sw.results : []).map(r => (r && typeof r === 'object') ? { ...r } : r);
      let changed = false;
      results.forEach(r => {
        if(!r || r.meet !== fromMeet) return;
        if(season && r.season !== season) return;
        r.meet = toMeet; changed = true; resultsRenamed++;
      });
      if(changed) writes.push({ key: d.id, results });
    });
    for(let i=0;i<writes.length;i+=400){
      const batch = FB.db.batch();
      writes.slice(i, i+400).forEach(w => {
        batch.set(FB.db.collection('swimmers').doc(w.key),
          { results: w.results, updatedAt: FB.FieldValue.serverTimestamp() }, { merge: true });
      });
      await batch.commit();
    }
    // Best-effort: rename in the meet-time mirror too.
    try {
      const mt = await FB.db.collection('hhst_meet_times').where('meet','==',fromMeet).get();
      const refs = [];
      mt.forEach(doc => { if(!season || (doc.data()||{}).season === season) refs.push(doc.ref); });
      for(let i=0;i<refs.length;i+=400){
        const batch = FB.db.batch();
        refs.slice(i, i+400).forEach(ref => batch.set(ref, { meet: toMeet }, { merge: true }));
        await batch.commit();
      }
    } catch(e){}
    return { resultsRenamed, swimmersAffected: writes.length };
  }

  // Collapse duplicate times for ONE meet: keep only the FASTEST time per
  // swimmer per stroke for that meet, deleting the rest from the embedded
  // results AND the hhst_meet_times mirror. Built for cleaning up a meet that
  // got uploaded several times (so each swimmer had the same stroke logged
  // 2-4×). opts.season scopes the cleanup to a single season.
  // opts.apply (default false) is a dry run that only COUNTS what would be
  // removed — nothing is written.
  // Returns { meet, resultsScanned, duplicatesRemoved, swimmersAffected, applied }.
  async function dedupeMeetByStroke(meetName, opts){
    meetName = (meetName || '').toString();
    const season = (opts && opts.season) || '';
    const apply  = !!(opts && opts.apply);
    if(!meetName) return { meet:'', resultsScanned:0, duplicatesRemoved:0, swimmersAffected:0, applied:apply };
    const snap = await FB.db.collection('swimmers').get();
    const writes = []; // { key, results, kept:[...], sw }
    let resultsScanned = 0, duplicatesRemoved = 0;
    snap.forEach(d => {
      const sw = d.data() || {};
      const results = Array.isArray(sw.results) ? sw.results : [];
      const matchIdx = [];
      const bestByStroke = new Map(); // stroke -> { idx, seconds }
      results.forEach((r, i) => {
        if(!r || r.meet !== meetName) return;
        if(season && r.season !== season) return;
        resultsScanned++;
        matchIdx.push(i);
        const stroke = r.stroke || extractStroke(r.event) || r.event || '';
        const sec = (typeof r.seconds === 'number' && isFinite(r.seconds))
          ? r.seconds : timeToSeconds(r.time);
        const cur = bestByStroke.get(stroke);
        const better = !cur || (isFinite(sec) && (!isFinite(cur.seconds) || sec < cur.seconds));
        if(better) bestByStroke.set(stroke, { idx:i, seconds: isFinite(sec) ? sec : Infinity });
      });
      if(!matchIdx.length) return;
      const keepIdx = new Set(Array.from(bestByStroke.values()).map(v => v.idx));
      const removeSet = new Set(matchIdx.filter(i => !keepIdx.has(i)));
      if(!removeSet.size) return;
      duplicatesRemoved += removeSet.size;
      const newResults = results.filter((_, i) => !removeSet.has(i));
      const kept = Array.from(keepIdx).map(i => results[i]);
      writes.push({ key: d.id, results: newResults, kept, sw });
    });

    if(apply && writes.length){
      // 1) Rewrite each affected swimmer's embedded results.
      for(let i=0;i<writes.length;i+=400){
        const batch = FB.db.batch();
        writes.slice(i, i+400).forEach(w => {
          batch.set(FB.db.collection('swimmers').doc(w.key),
            { results: w.results, updatedAt: FB.FieldValue.serverTimestamp() }, { merge:true });
        });
        await batch.commit();
      }
      // 2) Best-effort: rebuild this meet's mirror docs for affected swimmers —
      //    delete all their hhst_meet_times rows for this meet/season, then
      //    re-write one per kept result.
      try {
        for(const w of writes){
          const q = await FB.db.collection('hhst_meet_times')
            .where('swimmerKey','==', w.key).where('meet','==', meetName).get();
          const refs = [];
          q.forEach(doc => { if(!season || (doc.data()||{}).season === season) refs.push(doc.ref); });
          for(let i=0;i<refs.length;i+=400){
            const batch = FB.db.batch();
            refs.slice(i, i+400).forEach(ref => batch.delete(ref));
            await batch.commit();
          }
          const sw = w.sw, key = w.key, name = sw.name || '';
          const batch = FB.db.batch();
          w.kept.forEach(r => {
            if(!r || r.meet !== meetName) return;
            if(season && r.season !== season) return;
            const eventLabel = r.event || ((r.distance && r.stroke)
              ? `${r.distance} ${STROKE_ABBREV[r.stroke] || r.stroke}` : (r.stroke || ''));
            const rowSeason = r.season || '';
            const mirrorBase = rowSeason
              ? `${meetTimeDocId(key, eventLabel)}__${slugify(rowSeason)}`
              : meetTimeDocId(key, eventLabel);
            const mirrorId = r.uploadId ? `${mirrorBase}__${slugify(r.uploadId)}` : mirrorBase;
            const mi = swimmerSeasonInfo(sw, rowSeason);
            batch.set(FB.db.collection('hhst_meet_times').doc(mirrorId), {
              swimmerKey:key, swimmerName:name, event:eventLabel,
              distance:r.distance || '', stroke:r.stroke || '', time:r.time || '',
              seconds:(typeof r.seconds === 'number' ? r.seconds : timeToSeconds(r.time)),
              meet:r.meet, date:r.date || '', place:r.place || '',
              ageGroup: mi.bracket || getAgeGroup(mi.age), gender: mi.gender || '',
              competitionGroup: competitionGroup(sw, rowSeason),
              season: rowSeason, uploadId: r.uploadId || ''
            }, { merge:true });
          });
          await batch.commit();
        }
      } catch(e){ /* mirror cleanup is best-effort */ }
    }

    return { meet: meetName, resultsScanned, duplicatesRemoved, swimmersAffected: writes.length, applied: apply };
  }

  // Write the per-season {age,group,gender,bracket,ageGroup} into sw.seasonInfo
  // and re-mirror the most-recent season up to the top-level fields.
  function applySeasonInfo(sw, season, { age, group, gender, ageGroup } = {}){
    if(!season){
      // No season → legacy top-level write.
      if(age !== undefined && age !== '') sw.age = age;
      if(group !== undefined && group !== '') sw.group = group;
      const g = parseGender(gender);
      if(g) sw.gender = g;
      if(sw.age != null) sw.bracket = getAgeGroup(sw.age);
      return;
    }
    if(!sw.seasonInfo || typeof sw.seasonInfo !== 'object') sw.seasonInfo = {};
    const rec = sw.seasonInfo[season] || (sw.seasonInfo[season] = {});
    let wroteReal = false;
    if(age !== undefined && age !== ''){ rec.age = String(age); wroteReal = true; }
    if(group !== undefined && group !== ''){ rec.group = group; wroteReal = true; }
    if(ageGroup !== undefined && ageGroup !== ''){ rec.ageGroup = ageGroup; wroteReal = true; }
    const g = parseGender(gender);
    if(g){ rec.gender = g; wroteReal = true; }
    rec.bracket = getAgeGroup(rec.age);
    // A manual edit / re-upload promotes the record from estimated to exact.
    if(wroteReal) delete rec.estimated;
    if(!Array.isArray(sw.seasons)) sw.seasons = [];
    if(!sw.seasons.includes(season)) sw.seasons.push(season);
    // Mirror the most-recent season WITH content to top-level (sticky).
    const mr = mostRecentSeasonInfoKey(sw);
    const L = (mr && sw.seasonInfo[mr]) ? sw.seasonInfo[mr] : null;
    if(L){
      sw.age = L.age || sw.age || ''; sw.bracket = sw.age ? getAgeGroup(sw.age) : (sw.bracket||'Unknown');
      sw.group = L.group || sw.group || ''; sw.ageGroup = L.ageGroup || sw.ageGroup || ''; sw.gender = L.gender || sw.gender || '';
    }
  }
  async function addSwimmerManual({name, address, email, parent, age, group, gender, season}){
    const key = swimmerKey(fixNameOrder(name));
    const existing = await getSwimmer(key);
    const next = existing || { key, name: fixNameOrder(name), address:'', emails:[], parents:[], age:'', group:'', gender:'', seasons:[], seasonInfo:{}, results:[] };
    next.emails = next.emails || [];
    next.parents = next.parents || [];
    next.results = next.results || [];
    next.seasons = next.seasons || [];
    next.seasonInfo = next.seasonInfo || {};
    if(address) next.address = address;
    applySeasonInfo(next, (season||'').trim(), { age, group, gender });
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
  // fields: { address?, emails?, parents?, age?, group?, gender? }
  // season — when provided, age/group/gender write into seasonInfo[season]
  // (and re-mirror top-level). emails/parents/address are identity and always
  // write top-level. Omit season for a legacy top-level edit.
  async function updateSwimmer(key, fields, season){
    const existing = await getSwimmer(key);
    if(!existing) throw new Error('Swimmer not found');
    const next = { ...existing };
    next.emails = next.emails || [];
    next.parents = next.parents || [];
    next.results = next.results || [];
    next.seasonInfo = next.seasonInfo || {};
    if(fields.address !== undefined) next.address = fields.address;
    if(fields.emails !== undefined) next.emails = fields.emails;
    if(fields.parents !== undefined) next.parents = fields.parents;
    // Per-season attributes
    applySeasonInfo(next, (season||'').trim(), {
      age:    fields.age,
      group:  fields.group,
      gender: fields.gender
    });
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
      // Everyone's gone, so every uploaded-file row is moot.
      await clearCollection('hhst_uploads');
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
      // Drop only the meet-times upload rows; roster upload rows stay.
      await deleteUploadsByMode('results');
    }
    if(opts.roster !== false && opts.meetTimes !== false){
      try{ await FB.db.collection('meta').doc('stats').delete(); }catch(e){}
    }
  }
  async function clearRoster(){ return clearAll({ roster:true, meetTimes:false }); }
  async function clearMeetTimes(){ return clearAll({ roster:false, meetTimes:true }); }
  // Delete every uploads-registry row of a given mode ('roster' | 'results').
  async function deleteUploadsByMode(mode){
    try {
      const snap = await FB.db.collection('hhst_uploads').where('mode','==',mode).get();
      const refs = [];
      snap.forEach(d => refs.push(d.ref));
      while(refs.length){
        const batch = FB.db.batch();
        refs.splice(0,400).forEach(ref => batch.delete(ref));
        await batch.commit();
      }
    } catch(e){}
  }

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
  // HHST's signature freestyle/stroke distance for each age group — used to
  // infer a distance for stroke-only "best times" files that carry no distance
  // column (6 & Under swim 15y, 7-8 and 9-10 swim 25y, 11-12 and older swim
  // 50y). Returns '' for Unknown so we never fabricate a distance we can't
  // place. (Matches the Fastest Five poster distances.)
  function distanceForBracket(bracket){
    switch(bracket){
      case '6 & Under': return '15';
      case '7-8':       return '25';
      case '9-10':      return '25';
      case '11-12':
      case '13-14':
      case '15-18':     return '50';
      default:          return '';
    }
  }

  // -------- Per-season swimmer attributes --------
  // A swimmer's age, bracket (age group), training group, ageGroup label, and
  // gender all change between seasons (a kid who's 10 in 2024 is 12 in 2026).
  // Those vary-by-season fields live in sw.seasonInfo = { [season]: {...} }.
  // Identity (name, emails, parents, etc.) stays top-level. The top-level
  // age/bracket/group/ageGroup/gender are MIRRORED from the most-recent season
  // so legacy reads and the all-seasons view get a sensible value.

  // Highest-year-first season comparator, shared with getAllSeasons so
  // "most recent" means the same thing everywhere.
  function compareSeasonsDesc(a, b){
    const ya = seasonYearKey(a), yb = seasonYearKey(b);
    if(yb !== ya) return yb - ya;
    return b.localeCompare(a, undefined, { numeric:true, sensitivity:'base' });
  }
  // Does a per-season record actually carry attribute data (vs an empty stub)?
  function seasonInfoHasContent(rec){
    return !!(rec && (rec.age || rec.group || rec.ageGroup || rec.gender));
  }
  // The single most-recent season a swimmer is associated with — across both
  // their seasonInfo map keys and their roster-membership seasons[] list.
  // (Membership semantics: includes times-only seasons.)
  function mostRecentSeasonOf(sw){
    if(!sw) return '';
    const set = new Set();
    if(sw.seasonInfo && typeof sw.seasonInfo === 'object'){
      Object.keys(sw.seasonInfo).forEach(s => { if(s) set.add(s); });
    }
    if(Array.isArray(sw.seasons)) sw.seasons.forEach(s => { if(s) set.add(s); });
    const list = Array.from(set);
    if(!list.length) return '';
    list.sort(compareSeasonsDesc);
    return list[0];
  }
  // The most-recent season whose seasonInfo record actually has content —
  // used for the top-level mirror and the "most recent" display fallback, so
  // a times-only (empty) season never blanks the swimmer's known age.
  function mostRecentSeasonInfoKey(sw){
    if(!sw || !sw.seasonInfo || typeof sw.seasonInfo !== 'object') return '';
    const keys = Object.keys(sw.seasonInfo).filter(k => seasonInfoHasContent(sw.seasonInfo[k]));
    if(!keys.length) return '';
    keys.sort(compareSeasonsDesc);
    return keys[0];
  }
  // Single source of truth for resolving an age-group bracket from a season
  // info record — every read path uses this so they bucket identically. Order:
  // a real numeric bracket → derive from age → the exported ageGroup label →
  // the training group → Unknown. (A swimmer with a "Boys 13-14" label but a
  // blank Age column still buckets sensibly instead of vanishing into Unknown.)
  function resolveBracket(info){
    if(!info) return 'Unknown';
    if(info.bracket && info.bracket !== 'Unknown') return info.bracket;
    const fromAge = getAgeGroup(info.age);
    if(fromAge !== 'Unknown') return fromAge;
    // Fall back to the exported label — but strip a leading gender word so a
    // "Girls 13-14" ageGroup yields the bare bracket "13-14" (competitionGroup
    // re-prepends the gender, so leaving it in would double it to
    // "Girls Girls 13-14").
    const label = (info.ageGroup || info.group || '')
      .replace(/^\s*(boys|girls|men|women|male|female)\s+/i, '').trim();
    return label || 'Unknown';
  }
  // Resolve the {age,bracket,group,ageGroup,gender} record for a swimmer in a
  // given season. bracket is always derived from that season's age. Resolution:
  //   1) season given + seasonInfo[season] HAS CONTENT → that season's record
  //   2) otherwise (season missing/empty/'') + a content season exists →
  //      the most-recent CONTENT season's record (so a swimmer predating the
  //      selected season still shows their latest known age, not a blank)
  //   3) no content anywhere (legacy doc / times-only) → the top-level mirror
  // Gender is treated as cross-season (it doesn't change) — it falls back to
  // the top-level mirror so a gender-less season's record doesn't drop the
  // swimmer off the Boys/Girls split.
  function swimmerSeasonInfo(sw, season){
    if(!sw) return { age:'', bracket:'Unknown', group:'', ageGroup:'', gender:'' };
    const map = sw.seasonInfo;
    function shape(rec){
      const age = (rec && rec.age) || '';
      return {
        age,
        bracket: (rec && rec.bracket) || getAgeGroup(age),
        group:   (rec && rec.group)   || '',
        ageGroup:(rec && rec.ageGroup)|| '',
        gender:  (rec && rec.gender)  || sw.gender || ''
      };
    }
    if(map && typeof map === 'object'){
      if(season && seasonInfoHasContent(map[season])) return shape(map[season]);
      const mr = mostRecentSeasonInfoKey(sw);
      if(mr && map[mr]) return shape(map[mr]);
    }
    // Legacy doc / no per-season content → top-level mirror
    return {
      age: sw.age || '',
      bracket: sw.bracket || getAgeGroup(sw.age),
      group: sw.group || '',
      ageGroup: sw.ageGroup || '',
      gender: sw.gender || ''
    };
  }

  // -------- Season helpers --------
  // A "season" is a free-form label the coach picks at upload time
  // ("2025 Summer", "2024-25 Winter", "2026", etc.). It's tagged on every
  // imported race AND on each swimmer's `seasons` roster-membership array,
  // so this function pulls from BOTH — otherwise a brand-new season that
  // only has a roster uploaded (no times yet) wouldn't appear anywhere
  // in the dropdowns or "current season" logic.
  //
  // Sort order: the highest 4-digit year in the label wins (so "2026"
  // beats "2025 Summer" beats "2024-25 Winter"). Same-year labels fall
  // back to numeric-aware locale compare so "Summer" / "Winter" within
  // a year sort sensibly.
  function seasonYearKey(s){
    const m = (s||'').toString().match(/(\d{4})/);
    return m ? parseInt(m[1], 10) : 0;
  }
  // Highest-year-label first (so "2026" leads "2025 Summer"), then numeric-aware
  // locale compare so within a year "Summer"/"Winter" order sensibly. This is
  // label-driven on purpose: the coach's newest season label is "current" even
  // if its meets aren't dated (e.g. a best-times / practice season).
  function compareSeasonLabels(a, b){
    const ya = seasonYearKey(a), yb = seasonYearKey(b);
    if(yb !== ya) return yb - ya;
    return b.localeCompare(a, undefined, { numeric:true, sensitivity:'base' });
  }
  function getAllSeasons(allSwimmers){
    const seen = new Set();
    const list = Array.isArray(allSwimmers) ? allSwimmers : Object.values(allSwimmers || {});
    list.forEach(sw => {
      // Roster-membership seasons (added by every roster upload, and by
      // every successfully-matched times upload).
      if(Array.isArray(sw.seasons)){
        sw.seasons.forEach(s => { if(s) seen.add(s); });
      }
      // Per-result season tags (set by every times upload).
      (sw.results || []).forEach(r => {
        if(r && r.season) seen.add(r.season);
      });
    });
    return Array.from(seen).sort(compareSeasonLabels);
  }
  function currentSeason(allSwimmers){
    const seasons = getAllSeasons(allSwimmers);
    return seasons[0] || '';
  }
  // Like currentSeason(), but only considers seasons that actually have race
  // TIMES on file (not roster-only seasons). The Fastest Five / Most Improved
  // posters need a season that has results - a brand-new season with only a
  // roster uploaded would otherwise produce empty posters. Falls back to ''
  // when no result carries a season tag (pure legacy data -> show all-time).
  function currentSeasonWithTimes(allSwimmers){
    const seen = new Set();
    const list = Array.isArray(allSwimmers) ? allSwimmers : Object.values(allSwimmers || {});
    list.forEach(sw => {
      (sw.results || []).forEach(r => { if(r && r.season) seen.add(r.season); });
    });
    const sorted = Array.from(seen).sort(compareSeasonLabels);
    return sorted[0] || '';
  }
  // Return every distinct meet that's been imported, with its latest date
  // and season tagged. Sorted most-recent-first so the leaderboards meet
  // filter shows the freshest results at the top of the dropdown.
  // opts.season — only return meets that have a race tagged with this season.
  function getAllMeets(allSwimmers, opts){
    const season = (opts && opts.season) || '';
    const list = Array.isArray(allSwimmers) ? allSwimmers : Object.values(allSwimmers || {});
    const byKey = new Map();
    list.forEach(sw => (sw.results || []).forEach(r => {
      if(!r || !r.meet) return;
      if(season && r.season !== season) return;
      const existing = byKey.get(r.meet);
      const date = r.date || '';
      if(!existing){
        byKey.set(r.meet, { meet: r.meet, date, season: r.season || '' });
      } else if(date && date > existing.date){
        existing.date = date;
        if(r.season) existing.season = r.season;
      }
    }));
    return Array.from(byKey.values()).sort((a,b) => {
      if(a.date && b.date) return b.date.localeCompare(a.date);
      if(a.date) return -1;
      if(b.date) return 1;
      return a.meet.localeCompare(b.meet);
    });
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
      ageGroup: resolveBracket(swimmerSeasonInfo(sw, season))
    };
  }

  // For one swimmer, where do they rank in their age group for each event they've swum?
  // season — rank the swimmer within their age group FOR THAT SEASON: use the
  // season's age bracket and only count races (theirs and competitors') tagged
  // with the season, so rankings don't bleed across years.
  // Gender — at HHST boys and girls don't race each other, so a girl is only
  // compared against other girls in her bracket (and vice versa). Swimmers with
  // an unknown gender fall through to the full bracket (legacy data with no
  // gender on file still gets ranked rather than vanishing).
  function rankSwimmerInAgeGroup(sw, allSwimmers, season){
    season = season || '';
    const myInfo = swimmerSeasonInfo(sw, season);
    const ag = resolveBracket(myInfo);
    const myGender = myInfo.gender || '';
    const inSeason = r => !season || (r && r.season === season);
    const myEvents = {};
    (sw.results||[]).forEach(r => {
      if(!isFinite(r.seconds) || !inSeason(r) || r.timeTrial) return;
      if(!(r.event in myEvents) || r.seconds < myEvents[r.event]) myEvents[r.event] = r.seconds;
    });
    const ranks = {};
    Object.entries(myEvents).forEach(([event, mySec]) => {
      const competitors = [];
      Object.values(allSwimmers).forEach(other => {
        const oInfo = swimmerSeasonInfo(other, season);
        if(resolveBracket(oInfo) !== ag) return;
        // Same-gender heat only — skip the other gender when we know ours.
        if(myGender && oInfo.gender && oInfo.gender !== myGender) return;
        let best = Infinity;
        (other.results||[]).forEach(r => {
          if(r.event === event && isFinite(r.seconds) && inSeason(r) && !r.timeTrial && r.seconds < best) best = r.seconds;
        });
        if(isFinite(best)) competitors.push({ key: other.key, sec: best });
      });
      competitors.sort((a,b)=> a.sec - b.sec);
      const idx = competitors.findIndex(c => c.key === sw.key);
      ranks[event] = { rank: idx + 1, total: competitors.length };
    });
    // Build a human label: "Girls 11-12" when we know the gender, else just "11-12".
    const gLabel = genderLabel(myGender);
    const ageGroupLabel = (gLabel && ag && ag !== 'Unknown') ? `${gLabel} ${ag}` : ag;
    return { ageGroup: ag, ageGroupLabel, gender: myGender, ranks };
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
    const meet   = opts.meet || '';
    const buckets = {};
    Object.values(allSwimmers).forEach(sw => {
      // Per-season age/bracket/gender so a multi-season swimmer is ranked in
      // the right age group for the season being viewed.
      const info = swimmerSeasonInfo(sw, season);
      const bracket = resolveBracket(info);
      const ag = splitByGender ? competitionGroup(sw, season) : bracket;
      const byEvent = {};
      (sw.results||[]).forEach(r => {
        if(!isFinite(r.seconds)) return;
        if(r.timeTrial) return; // time trials excluded from team leaderboards
        if(season && r.season !== season) return;
        if(meet && r.meet !== meet) return;
        const evStroke = r.stroke || extractStroke(r.event);
        if(stroke && evStroke !== stroke) return;
        if(!byEvent[r.event] || r.seconds < byEvent[r.event].seconds) byEvent[r.event] = r;
      });
      Object.entries(byEvent).forEach(([event, r]) => {
        const key = ag + '||' + event;
        if(!buckets[key]){
          buckets[key] = {
            ageGroup: ag, bracket, gender: info.gender || '', event,
            stroke: r.stroke || extractStroke(event) || 'Other',
            distance: r.distance || extractDistance(event),
            entries: []
          };
        }
        buckets[key].entries.push({
          swimmerKey: sw.key,
          swimmerName: sw.name,
          gender: info.gender || '',
          time: r.time,
          seconds: r.seconds,
          meet: r.meet,
          date: r.date,
          age: info.age || ''
        });
      });
    });
    Object.values(buckets).forEach(b => {
      b.entries.sort((a,b) => a.seconds - b.seconds);
      if(splitByGender){
        b.entries = b.entries.slice(0, top);
      } else {
        // Gender-merged bucket (the leaderboards.html path that re-splits in
        // the UI): keep the top-N of EACH gender, not the top-N overall, so a
        // gender that's slower on average can't get sliced out before the UI
        // splits the column.
        const byG = { M:[], F:[], '':[] };
        b.entries.forEach(e => { (byG[e.gender] || byG['']).push(e); });
        b.entries = byG.F.slice(0, top)
          .concat(byG.M.slice(0, top), byG[''].slice(0, top))
          .sort((a, c) => a.seconds - c.seconds);
      }
    });
    return Object.values(buckets);
  }

  // Team-wide aggregate stats. opts.season filters every count + the
  // time-dropped sum to a single season; omit for an all-time view.
  function teamStats(allSwimmers, opts){
    const season = (opts && opts.season) || '';
    const meet   = (opts && opts.meet)   || '';
    const swimmers = Object.values(allSwimmers);
    const filteredResults = sw => (sw.results||[]).filter(r => {
      if(!r) return false;
      if(r.timeTrial) return false; // time trials excluded from team aggregates
      if(season && r.season !== season) return false;
      if(meet && r.meet !== meet) return false;
      return true;
    });
    const totalRaces = swimmers.reduce((s, x) => s + filteredResults(x).length, 0);
    const meetsSet = new Set();
    let gold=0, silver=0, bronze=0;
    let totalDropSec = 0;
    let prRaces = 0;
    let activeSwimmers = 0;
    swimmers.forEach(sw => {
      const filtered = filteredResults(sw);
      if(!filtered.length) return;
      activeSwimmers++;
      // statsForSwimmer doesn't take a meet filter, so when we're scoped to
      // a single meet just count podiums directly from the filtered rows.
      if(meet){
        filtered.forEach(r => {
          const p = parseInt(r.place, 10);
          if(!isFinite(p) || p <= 0) return;
          if(p === 1) gold++;
          else if(p === 2) silver++;
          else if(p === 3) bronze++;
        });
      } else {
        const s = statsForSwimmer(sw, { season });
        gold += s.gold; silver += s.silver; bronze += s.bronze;
        totalDropSec += s.totalTimeDropSec;
        prRaces += s.prCount;
      }
      filtered.forEach(r => meetsSet.add(r.meet));
    });
    return {
      swimmerCount: (season || meet) ? activeSwimmers : swimmers.length,
      totalRaces, meetCount: meetsSet.size,
      gold, silver, bronze,
      podium: gold + silver + bronze,
      totalDropSec, prRaces,
      season: season || null,
      meet: meet || null
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
  // season — bucket each swimmer by their age group FOR THAT SEASON (so the
  // admin roster shows correct per-season age groups). Omit for the
  // most-recent view.
  function groupByBracket(swimmers, season){
    const buckets = {};
    AGE_GROUP_ORDER.forEach(g => { buckets[g] = []; });
    (swimmers||[]).forEach(sw => {
      const info = swimmerSeasonInfo(sw, season);
      const b = resolveBracket(info);
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
    getUploads, deleteUpload,
    migrateSeasonAges, countSwimmersNeedingSeasonMigration, inferMissingDistances, renameMeet, dedupeMeetByStroke,
    clearAll, clearRoster, clearMeetTimes,
    isAdminLoggedIn, loginAdmin, logoutAdmin, onAuthChanged,
    statsForSwimmer, rankSwimmerInAgeGroup, buildLeaderboards, teamStats, teamStatsBySeason,
    getAllSeasons, currentSeason, currentSeasonWithTimes, filterSwimmerToSeason, getAllMeets,
    getAgeGroup, AGE_GROUP_ORDER, STROKE_ORDER, extractStroke, extractDistance, distanceNum, compareEventLabel,
    fmtTime, timeToSeconds, swimmerKey, slugify, meetTimeDocId, norm,
    mapHeader, normHeaderKey,
    fixNameOrder, isValidEmail, ageFromDob,
    normalizeEventLabel,
    leaderboardsByEvent, mostImprovedAtMeet, meetsInSeason, sortAgeGroups,
    groupByBracket,
    parseGender, parseGenderFromAgeGroup, genderLabel, competitionGroup,
    swimmerSeasonInfo, mostRecentSeasonOf,
    initTheme, toggleTheme
  };
})(window);
