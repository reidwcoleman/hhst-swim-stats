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
  // Canonical "<dist> <ShortStroke>" form of an event for the team-records
  // system — "50 Freestyle" / "50 Yard Free" / "50 free" all collapse to
  // "50 Free". Returns '' when the event has no usable distance+stroke pair
  // (so IM without an explicit distance and unrecognized events are skipped
  // instead of getting a bogus record). Prefers explicit distance/stroke
  // fields on a result object, falls back to parsing the label.
  function normalizeRecordEvent(evOrObj){
    let dist = '', stroke = '';
    if(evOrObj && typeof evOrObj === 'object'){
      dist   = (evOrObj.distance != null ? String(evOrObj.distance) : '').trim();
      stroke = (evOrObj.stroke || '').trim();
      if(!dist)   dist   = extractDistance(evOrObj.event || '');
      if(!stroke) stroke = extractStroke(evOrObj.event || '');
    } else {
      const s = (evOrObj || '').toString();
      dist   = extractDistance(s);
      stroke = extractStroke(s);
    }
    if(!dist || !stroke) return '';
    return `${dist} ${STROKE_ABBREV[stroke] || stroke}`;
  }
  // Deterministic hhst_records doc id — "boys_11-12_50-free". Gender label is
  // required (records split M/F); ageGroup + normalized event are slugified
  // so the id is URL-safe.
  function recordDocId(genderCode, ageGroup, normEvent){
    const g = genderCode === 'M' ? 'boys' : genderCode === 'F' ? 'girls' : 'mixed';
    return `${g}_${slugify(ageGroup || 'unknown')}_${slugify(normEvent || 'unknown')}`;
  }
  // Some exports (HHST's Times sheet, USA Swimming) tag the time with the
  // course code: "17.11Y" (yards), "1:07.94L" (long-course meters),
  // "S" (short-course meters), "M" (meters). Strip a single trailing
  // course-code letter before parsing so the time still parses.
  function stripCourseCode(s){
    // Strip a trailing course letter (Y/S/L/M) ONLY when it follows a digit, so
    // real times clean up ("28.42Y"→"28.42", "1:02.18 L"→"1:02.18") but status
    // codes that merely end in one of those letters are left intact ("NS", "DFS",
    // "SCR M"… ). Without the digit guard, "NS"→"N" and "DFS"→"DF" got mangled.
    return (s == null ? '' : s.toString()).trim().replace(/(\d)\s*[YSLM]\s*$/i, '$1').trim();
  }
  // Colon time grammar, shared by fmtTime + timeToSeconds so the formatted
  // string and the seconds value ALWAYS agree. The old /^\d{1,2}:\d{2}\.\d{1,2}$/
  // hard-required a literal "." and exactly two seconds digits, so "1:05",
  // "2:30", "1:5", "1:4.50" and "1:05.456" all FELL THROUGH to parseFloat(),
  // which stops at the ":" and returned just the minute integer ("1:05"→1s) —
  // silently corrupting result.seconds at ingest and the Most Improved drops
  // built from them. The grammar below makes the fraction optional, allows 1–2
  // seconds digits and 1–3 minute digits, and reads the fraction as hundredths
  // (single tenths → ".40", 3-decimals truncate — swim timing never rounds up).
  const COLON_TIME = /^(\d{1,3}):(\d{1,2})(?:\.(\d{1,3}))?$/;
  function fracHundredths(frac){ return frac ? frac.padEnd(2,'0').slice(0,2) : '00'; }
  function fmtTime(t){
    if(t==null) return '';
    let s = stripCourseCode(t);
    if(!s) return '';
    const mm = s.match(COLON_TIME);
    if(mm){
      return `${parseInt(mm[1],10)}:${mm[2].padStart(2,'0')}.${fracHundredths(mm[3])}`;
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
    const mm = s.match(COLON_TIME);
    if(mm){
      return parseInt(mm[1],10)*60 + parseInt(mm[2],10) + parseInt(fracHundredths(mm[3]),10)/100;
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

  // -------- Hy-Tek (.hy3) / SDIF (.sd3) meet-results parsers --------
  // SwimTopia's Meet Maestro exports a finished meet's results as a Hy-Tek
  // .hy3 or an SDIF .sd3 file (often inside a .zip). Both are fixed-width text:
  // the first two characters of every line are the record type. We turn them
  // into the SAME array-of-arrays (header row + data rows) that ingestRows
  // already consumes, so all the downstream roster-matching, time formatting
  // (fmtTime/timeToSeconds) and de-duplication stay identical to the CSV path.
  // 1-indexed fixed-width slice, trimmed — matches the published record layouts.
  function fw(line, start, len){ return (line == null ? '' : line).slice(start - 1, start - 1 + len).trim(); }
  // "MMDDYYYY" -> "MM/DD/YYYY" so the importer's flexible date parser reads it.
  function mdyToDate(s){
    s = (s || '').trim();
    return /^\d{8}$/.test(s) ? `${s.slice(0,2)}/${s.slice(2,4)}/${s.slice(4,8)}` : '';
  }
  // Hy-Tek stroke codes are letters (A-E) or digits (1-5); SDIF uses digits 1-5.
  const HYTEK_STROKE = { '1':'Free','2':'Back','3':'Breast','4':'Fly','5':'IM',
                         'A':'Free','B':'Back','C':'Breast','D':'Fly','E':'IM' };
  const SDIF_STROKE  = { '1':'Free','2':'Back','3':'Breast','4':'Fly','5':'IM' };

  // Hy-Tek .hy3 → rows. Records used: B1 (meet name/date), D1 (swimmer),
  // E1 (event entry: distance + stroke), E2 (event result: time/place/date).
  // We emit one row per entry, preferring the FINAL swim (type F) over a
  // prelim/swim-off, so a swimmer who swam both isn't counted twice.
  function parseHy3(text){
    const lines = (text || '').split(/\r?\n/);
    const out = [['first','last','gender','event','distance','time','place','date','meet']];
    let meetName = '', meetDate = '';
    const swimmers = {};        // swimmerCode -> { first, last, gender }
    let cur = null;             // { code, distance, stroke, final, fallback, dq }
    // Prefer a real swim (final, then prelim/swim-off) over a DQ — a swimmer
    // who has any clock time for an entry isn't counted as a DQ. The DQ row is
    // only emitted when the entry has NO valid time at all.
    const flush = () => {
      if(cur){ const row = cur.final || cur.fallback || cur.dq; if(row) out.push(row); cur = null; }
    };
    for(const line of lines){
      const rec = line.slice(0, 2);
      if(rec === 'B1'){
        meetName = fw(line, 3, 45);
        meetDate = mdyToDate(fw(line, 93, 8));
      } else if(rec === 'D1'){
        flush();
        swimmers[fw(line, 4, 5)] = { gender: fw(line, 3, 1), last: fw(line, 9, 20), first: fw(line, 29, 20) };
      } else if(rec === 'E1'){
        flush();
        cur = { code: fw(line, 4, 5), distance: fw(line, 16, 6), stroke: HYTEK_STROKE[fw(line, 22, 1)] || '', final: null, fallback: null, dq: null };
      } else if(rec === 'E2' && cur && cur.distance && cur.stroke){
        const type = fw(line, 3, 1);                 // F = final, P = prelim, S = swim-off
        const rawTime = fw(line, 4, 8);
        const sw = swimmers[cur.code] || {};
        const mk = (t, place) => [ sw.first || '', sw.last || '', sw.gender || '',
          `${cur.distance} ${cur.stroke}`, cur.distance, t, place,
          mdyToDate(fw(line, 88, 8)) || meetDate, meetName ];
        if(timeToSeconds(rawTime) > 0){
          const row = mk(rawTime, fw(line, 30, 4));
          if(type === 'F') cur.final = row;
          else if(!cur.fallback) cur.fallback = row;
        } else if(!cur.dq){
          // A result line (E2) with no clock time = the swimmer raced but got
          // no official time — a DQ. Keep it as a DQ race (a real swim on any
          // other E2 for this entry still wins) so every racer is counted. A
          // pure scratch/no-show has no E2 line, so it's still excluded.
          cur.dq = mk('DQ', '');
        }
      }
    }
    flush();
    return out;
  }

  // SDIF .sd3 → rows. One D0 record per swim. Uses the achieved time
  // (finals 116, else prelim 98, else swim-off 107) — never the seed/entry
  // time (89), which is just what the swimmer was seeded with.
  function parseSd3(text){
    const lines = (text || '').split(/\r?\n/);
    const out = [['name','gender','event','distance','time','place','date','meet']];
    let meetName = '', meetDate = '';
    for(const line of lines){
      const rec = line.slice(0, 2);
      if(rec === 'B1'){
        meetName = fw(line, 12, 30);
        meetDate = mdyToDate(fw(line, 122, 8));
      } else if(rec === 'D0'){
        const distance = fw(line, 68, 4);
        const stroke = SDIF_STROKE[fw(line, 72, 1)] || '';
        const finals = fw(line, 116, 8), prelim = fw(line, 98, 8), swimoff = fw(line, 107, 8);
        let rawTime = '', place = '';
        if(timeToSeconds(finals) > 0){ rawTime = finals; place = fw(line, 136, 3); }
        else if(timeToSeconds(prelim) > 0){ rawTime = prelim; place = fw(line, 133, 3); }
        else if(timeToSeconds(swimoff) > 0){ rawTime = swimoff; }
        if(!(timeToSeconds(rawTime) > 0) || !distance || !stroke) continue;  // entries-only / DQ → skip
        out.push([ fw(line, 12, 28) /* LAST, FIRST */, fw(line, 66, 1),
          `${distance} ${stroke}`, distance, rawTime, place,
          mdyToDate(fw(line, 81, 8)) || meetDate, meetName ]);
      }
    }
    return out;
  }

  // Pick the right parser by extension, falling back to sniffing the record
  // codes (a .zip's inner file, or an extension-less download). Returns the
  // array-of-arrays, or null when the text isn't a recognized results file.
  function parseResultsFile(name, text){
    const n = (name || '').toLowerCase();
    if(n.endsWith('.hy3')) return parseHy3(text);
    if(n.endsWith('.sd3')) return parseSd3(text);
    const head = (text || '').slice(0, 6000);
    if(/^D0/m.test(head)) return parseSd3(text);          // SDIF individual-event records
    if(/^(D1|E1|E2)/m.test(head)) return parseHy3(text);  // Hy-Tek swimmer/event records
    return null;
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
  // A meet "time" cell that isn't a clock time is a status code. Some of those
  // codes mean the swimmer RACED but earned no official time — a DQ
  // (disqualified) or DNF (did not finish). Those are real races and the
  // swimmer must still be counted. Everything else that isn't a time (NS / DNS
  // = no-show, SCR = scratch, NT = no time / seed placeholder, DEC/DFS =
  // declared / declared false start, blank) means the swimmer did NOT race, so
  // it stays skipped. Returns true only for the "raced, no time" codes.
  function isRacedStatus(t){
    const s = (t == null ? '' : t.toString()).toUpperCase();
    if(/\bDISQ/.test(s) || /\bDSQ\b/.test(s) || /\bD\.?Q\b/.test(s) || /\bDQ/.test(s)) return true;
    if(/\bDNF\b/.test(s)) return true;
    return false;
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
  // A few legacy uploads ingested status placeholders ("NT", "N", "N/A"…) as
  // result rows before the importer learned to skip them. Those are NOT races
  // (the swimmer never swam), so they must not count toward races logged or
  // render as times in meet history. Raced-but-no-time codes (DQ / DNF) are
  // real races and are kept, normalized onto the dq flag the UI already
  // understands. Today's importer never writes such rows — this guard cleans
  // the old ones at read time for every page at once.
  function sanitizeResults(sw){
    if(sw && Array.isArray(sw.results)){
      sw.results = sw.results.filter(r => {
        if(!r) return false;
        if(isFinite(r.seconds) || r.dq) return true;
        if(isRacedStatus(r.time)){ r.dq = true; return true; }
        return false;
      });
    }
    return sw;
  }
  async function readAll(){
    const snap = await FB.db.collection('swimmers').get();
    const swimmers = {};
    snap.forEach(doc => { swimmers[doc.id] = sanitizeResults(doc.data()); });
    let meta = { lastUpload: null, meetCount: 0 };
    try{
      const m = await FB.db.collection('meta').doc('stats').get();
      if(m.exists) meta = m.data();
    } catch(e){}
    return { swimmers, lastUpload: meta.lastUpload || null, meetCount: meta.meetCount || 0 };
  }
  async function getSwimmer(key){
    const d = await FB.db.collection('swimmers').doc(key).get();
    return d.exists ? sanitizeResults(d.data()) : null;
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
    let updated = 0; // existing races whose time/place/date changed on a re-upload
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

    // ---- Same-meet content detection ----
    // The per-row de-dupe below keys on the MEET NAME, so re-uploading a meet
    // under a slightly different name (or a fuller export of the same meet:
    // identical swims plus a couple of late additions) would stack every swim
    // a second time. Catch that here: fingerprint each incoming swim as
    // swimmer + stroke + exact time, group by incoming meet, and if most of an
    // existing meet's swims (same season) reappear verbatim under a different
    // incoming name, treat them as the SAME meet — incoming rows are
    // re-labelled to the existing meet's name, so the duplicates merge in
    // place and only the genuinely new times are added.
    const meetAlias = {};   // incoming meet name -> existing meet name
    const mergedMeets = []; // [{from, to, matched}] reported back to the admin page
    if(mode === 'results' && !timeTrial){
      const fingerprint = (key, rec) => {
        const stroke = extractStroke(rec.event || '');
        const secs = timeToSeconds(fmtTime(rec.time || ''));
        if(!stroke || !isFinite(secs)) return null; // DQ/NS rows can't fingerprint
        return `${key}|${stroke}|${secs.toFixed(2)}`;
      };
      // Incoming swims grouped by the meet name they'd land under, plus the
      // set of seasons this file touches (existing results are only compared
      // within those seasons — same time in a different season is not a dupe).
      const incomingByMeet = {};
      const seasonsTouched = new Set();
      for(const rec of records){
        if(!(rec.event && rec.time)) continue;
        const fp = fingerprint(rec.__key, rec);
        if(!fp) continue;
        const m = meetName || rec.meet || 'Unknown Meet';
        (incomingByMeet[m] = incomingByMeet[m] || new Set()).add(fp);
        seasonsTouched.add(meetName ? season : ((rec.season || '').toString().trim() || season));
      }
      // Existing swims (same seasons, real times only) grouped by meet, across
      // the swimmers this file mentions.
      const existingByMeet = {};
      const seenKeys = new Set(records.map(r => r.__key));
      seenKeys.forEach(k => {
        const sw = existing[k];
        if(!sw || !Array.isArray(sw.results)) return;
        for(const r of sw.results){
          if(!r || r.timeTrial || !isFinite(r.seconds)) continue;
          if(!seasonsTouched.has((r.season || '').toString())) continue;
          const stroke = r.stroke || extractStroke(r.event || '');
          if(!stroke) continue;
          const m = r.meet || 'Unknown Meet';
          (existingByMeet[m] = existingByMeet[m] || new Set())
            .add(`${k}|${stroke}|${(+r.seconds).toFixed(2)}`);
        }
      });
      for(const inMeet of Object.keys(incomingByMeet)){
        const inSet = incomingByMeet[inMeet];
        let best = '', bestMatch = 0;
        for(const exMeet of Object.keys(existingByMeet)){
          if(exMeet === inMeet) continue; // same name already merges in place
          let match = 0;
          inSet.forEach(fp => { if(existingByMeet[exMeet].has(fp)) match++; });
          if(match > bestMatch){ bestMatch = match; best = exMeet; }
        }
        if(!best) continue;
        const overlap = bestMatch / Math.min(inSet.size, existingByMeet[best].size);
        // "Same meet" = at least 3 identical swims AND most of the smaller
        // side matches. A couple of coincidentally equal times across two
        // genuinely different meets can't clear this bar.
        if(bestMatch >= 3 && overlap >= 0.6){
          meetAlias[inMeet] = best;
          mergedMeets.push({ from: inMeet, to: best, matched: bestMatch });
        }
      }
    }

    // ---- Fold into the original file's "Uploaded files" entry ----
    // When this file's rows land on a meet an EARLIER upload already owns —
    // the same meet name re-uploaded, or a renamed file the content detection
    // above recognized — those rows are stamped with the ORIGINAL file's
    // uploadId, and this file's contribution is added onto that original
    // registry entry instead of creating a second row in the panel. One meet
    // = one file entry: re-drops and fuller exports merge into the original,
    // and deleting that one entry takes the whole merged meet back out.
    const meetOwner = {};   // final meet name -> owning (original) uploadId
    const ownerDocs = {};   // owning uploadId -> its registry doc data
    if(mode === 'results' && !timeTrial && uploadId){
      const wantMeets = new Set();
      for(const rec of records){
        if(!(rec.event && rec.time)) continue;
        const m = meetName || rec.meet || 'Unknown Meet';
        wantMeets.add(meetAlias[m] || m);
      }
      wantMeets.delete('Unknown Meet'); // the placeholder is never "owned"
      for(const m of wantMeets){
        try {
          const snap = await FB.db.collection('hhst_uploads')
            .where('meetNames', 'array-contains', m).get();
          // Earliest matching upload (same season, results, not a time trial)
          // is the original owner.
          let best = null, bestMs = Infinity;
          snap.forEach(d => {
            if(d.id === uploadId) return;
            const u = d.data() || {};
            if(u.mode === 'roster' || u.timeTrial) return;
            if((u.season || '') !== season) return;
            const t = u.uploadedAt;
            const ms = (t && typeof t.toMillis === 'function') ? t.toMillis()
                     : (t && typeof t.seconds === 'number') ? t.seconds * 1000 : 0;
            if(ms < bestMs){ bestMs = ms; best = { id: d.id, data: u }; }
          });
          if(best){ meetOwner[m] = best.id; ownerDocs[best.id] = best.data; }
        } catch(e){
          // Lookup is best-effort — worst case this file just gets its own row.
        }
      }
      // Let the admin page name the file each recognized meet merged into.
      for(const mm of mergedMeets){
        const oid = meetOwner[mm.to];
        if(oid && ownerDocs[oid]) mm.intoFile = ownerDocs[oid].fileName || '';
      }
    }
    // Load the current team-records book once for this upload (results mode
    // only — a roster upload writes no times, so records can't change). Time
    // trials are excluded per-row inside checkRecord.
    if(mode === 'results' && !timeTrial){
      await loadExistingRecords();
    }
    // Per-uploadId contribution ledger (results rows only). contrib[uploadId]
    // is this file's OWN share; contrib[<owner id>] is what it folded into an
    // original file. Drives the registry bookkeeping below.
    const contrib = {};
    const contribFor = id => contrib[id] = contrib[id] || { added:0, updated:0, keys:new Set(), meets:new Set() };

    const skippedSwimmers = new Set();
    const writtenKeys = new Set();
    const meetTimeWrites = [];
    // Team-records detection: read the current record book ONCE so every row
    // in this upload can be compared against it (and against records this same
    // file just set — the Map is updated in place, so if two swims in one
    // upload both beat the record, the faster wins). Time trials, DQs, and
    // rows with no known gender or age group are skipped inside checkRecord.
    // Loaded lazily below so a roster-only upload never hits Firestore for records.
    let existingRecords = null;
    const newRecordWrites = [];
    const newRecordsForCaller = [];
    async function loadExistingRecords(){
      if(existingRecords) return;
      existingRecords = new Map();
      try {
        const rSnap = await FB.db.collection('hhst_records').get();
        rSnap.forEach(d => existingRecords.set(d.id, d.data() || {}));
      } catch(e){ /* best-effort — missing collection = every time is a first record */ }
    }
    function checkRecord({ sw, key, name, mi, eventLabel, seconds, timeStr, meet, date, season }){
      if(!isFinite(seconds)) return;
      const genderCode = mi.gender || sw.gender || '';
      if(genderCode !== 'M' && genderCode !== 'F') return; // records split by gender
      const bracket = mi.bracket || getAgeGroup(mi.age);
      if(!bracket || bracket === 'Unknown') return;
      const normEvent = normalizeRecordEvent({ event: eventLabel, distance: extractDistance(eventLabel), stroke: extractStroke(eventLabel) });
      if(!normEvent) return;
      const recId = recordDocId(genderCode, bracket, normEvent);
      const existing = existingRecords.get(recId);
      const prevSec = existing && isFinite(existing.seconds) ? existing.seconds : Infinity;
      if(seconds >= prevSec) return; // not a new record
      const payload = {
        recordId: recId,
        ageGroup: bracket,
        gender: genderCode,
        genderLabel: genderLabel(genderCode),
        event: normEvent,
        swimmerKey: key,
        swimmerName: name,
        time: timeStr,
        seconds,
        meet: meet || '',
        date: date || '',
        season: season || '',
        previousSeconds: existing ? (existing.seconds != null ? existing.seconds : null) : null,
        previousTime: existing ? (existing.time || '') : '',
        previousSwimmerName: existing ? (existing.swimmerName || '') : '',
        previousSwimmerKey: existing ? (existing.swimmerKey || '') : ''
      };
      // In-memory update so later rows in this same upload compare against the
      // pending new record (avoids two "NEW RECORD" hits for the same event
      // when a swimmer beats the standing record twice in one file).
      existingRecords.set(recId, { ...payload });
      // Only ONE write per record per upload — the latest (fastest) staged win.
      const at = newRecordWrites.findIndex(w => w.id === recId);
      const notifyEntry = { ...payload };
      if(at >= 0){
        newRecordWrites[at] = { id: recId, data: payload };
        // Replace the notification too so the caller reports the fastest one.
        const nAt = newRecordsForCaller.findIndex(n => n.recordId === recId);
        if(nAt >= 0) newRecordsForCaller[nAt] = notifyEntry;
        else newRecordsForCaller.push(notifyEntry);
      } else {
        newRecordWrites.push({ id: recId, data: payload });
        newRecordsForCaller.push(notifyEntry);
      }
    }
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
      // A named-meet upload is one meet in the one season the coach picked, so
      // attributes must land on THAT season — mirror the rowSeason guard below,
      // or a stray Season/Year column would scatter age/group/membership into a
      // different season than the result it describes.
      const sSeason = meetName ? season : ((rec.season || '').toString().trim() || season);
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
        const seconds = timeToSeconds(timeStr);
        // A "time" cell that isn't a real time is a status code. DQ / DNF means
        // the swimmer RACED but earned no official time — keep it as a logged
        // race (stored WITHOUT a `seconds` field, so `isFinite(r.seconds)` is
        // false everywhere and it's invisible to every time-based board:
        // leaderboards, Fastest Five, PRs, Most Improved). This is what makes
        // every racer get counted. The other non-time codes (NS / DNS = no-show,
        // SCR = scratch, NT = seed placeholder, DFS, blank) are NOT races, so
        // they're still skipped — otherwise they'd be phantom races (NaN
        // seconds, a junk event label) cluttering the meet-history table.
        const racedNoTime = !isFinite(seconds) && isRacedStatus(rec.time);
        if(!isFinite(seconds) && !racedNoTime) continue;
        // Same-meet detection (above) may have recognized this file's meet as
        // an existing one under a different name — relabel so the rows merge.
        // And when an earlier upload already owns the (final) meet, stamp the
        // row with THAT file's uploadId so the meet stays one deletable unit.
        const rawMeet = meetName || rec.meet || 'Unknown Meet';
        const finalMeet = meetAlias[rawMeet] || rawMeet;
        const rowUploadId = meetOwner[finalMeet] || uploadId;
        const result = {
          event: eventLabel,
          distance,
          stroke,
          time: racedNoTime ? 'DQ' : timeStr,
          meet: finalMeet,
          date: meetDate || rec.date || '',
          place: racedNoTime ? '' : (rec.place || ''),
          split: rec.split || '',
          season: rowSeason,
          uploadId: rowUploadId || ''
        };
        const rowContrib = (mode === 'results' && uploadId) ? contribFor(rowUploadId) : null;
        if(rowContrib) rowContrib.keys.add(key);
        // A DQ carries no comparable time, so it never gets a `seconds` value.
        if(racedNoTime) result.dq = true;
        else result.seconds = seconds;
        if(timeTrial) result.timeTrial = true;
        // De-dupe on swimmer + meet + event + season (NOT time). Re-uploading the
        // season's times then UPDATES the existing race in place (newest upload
        // wins — good for corrections) instead of stacking a duplicate, while a
        // genuinely new (meet, event) for this swimmer is appended. The timeTrial
        // flag is part of the key so a meet time never overwrites a practice
        // time-trial of the same event (their `meet` differs anyway — this is
        // belt-and-suspenders). This is what lets a coach drop the current
        // season's file over and over as meets are added without duplicating.
        const dupIdx = sw.results.findIndex(r =>
          r && r.meet === result.meet && (r.season || '') === (result.season || '')
          && r.event === result.event && (!!r.timeTrial === !!result.timeTrial));
        if(dupIdx >= 0){
          const prev = sw.results[dupIdx] || {};
          // A real swum time always beats "no time": if this row is a DQ but the
          // existing race already has a clock time for the same event, keep the
          // real time (don't let row order downgrade a swimmer's result to a DQ).
          if(result.dq && isFinite(prev.seconds)){
            // nothing to change — the existing real time stands
          } else {
            // Only count an UPDATE when something actually changed, so re-uploading
            // an unchanged file is a true no-op (added:0, updated:0).
            const changed = (prev.time !== result.time)
              || ((prev.place || '') !== (result.place || ''))
              || ((prev.date || '') !== (result.date || ''))
              || (prev.seconds !== result.seconds)
              || (!!prev.dq !== !!result.dq);
            sw.results[dupIdx] = result; // newest upload wins (re-stamps time/place/date/uploadId)
            if(changed){ updated++; if(rowContrib) rowContrib.updated++; }
          }
        } else {
          sw.results.push(result);
          added++;
          if(rowContrib) rowContrib.added++;
        }
        // Record the meet for the registry/summary (new OR updated rows) — but
        // don't register the synthetic 'Unknown Meet' placeholder (matches the
        // pre-named-meet behavior).
        if(meetName || rec.meet){
          meetNames.add(result.meet);
          if(rowContrib) rowContrib.meets.add(result.meet);
        }
        // The hhst_meet_times mirror backs the ranked leaderboards, so it only
        // holds swims with a real time. A DQ race lives on the swimmer's
        // profile + races-logged count (via sw.results) but is skipped here.
        if(!racedNoTime){
          // Stage a mirror write to hhst_meet_times. Doc id = swimmer + event +
          // MEET + season (deterministic, NO uploadId): re-uploading a meet's
          // times OVERWRITES the same mirror doc instead of piling up a new doc
          // per upload, while two different meets' same event stay distinct
          // (meet is in the id). The uploadId still rides along as a FIELD below,
          // so deleteUpload's where('uploadId','==',…) wipe still finds this
          // file's docs (the field tracks the latest writer = the owning upload).
          const mirrorMeet = slugify(result.meet || 'unknown-meet');
          const mirrorId = rowSeason
            ? `${meetTimeDocId(key, eventLabel)}__${mirrorMeet}__${slugify(rowSeason)}`
            : `${meetTimeDocId(key, eventLabel)}__${mirrorMeet}`;
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
              uploadId: rowUploadId || ''
            }
          });
          // Team-records check: a real, non-timeTrial swim with a known
          // gender + age group is a candidate for the record book. New/faster
          // times are staged for write below and returned in `newRecords`
          // so the admin UI can flash "NEW RECORD!" for each.
          if(!timeTrial && existingRecords){
            checkRecord({
              sw, key, name,
              mi: {
                gender: mi.gender || sw.gender || '',
                bracket: mi.bracket || getAgeGroup(mi.age),
                age: mi.age || ''
              },
              eventLabel,
              seconds: result.seconds,
              timeStr,
              meet: result.meet,
              date: result.date,
              season: rowSeason
            });
          }
        }
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

    // Write any staged team-records updates. One doc per record id (gender +
    // age group + normalized event) — the latest-staged fastest wins because
    // checkRecord dedupes in place. setAt uses a server timestamp so the
    // records page can order most-recent-first.
    for(let i=0;i<newRecordWrites.length;i+=400){
      const batch = FB.db.batch();
      newRecordWrites.slice(i, i+400).forEach(w => {
        batch.set(FB.db.collection('hhst_records').doc(w.id),
          { ...w.data, setAt: FB.FieldValue.serverTimestamp() }, { merge: true });
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
    // Fold this file's owned-meet contributions onto the ORIGINAL files'
    // registry rows (counts grow, swimmer keys union, and the new filename is
    // recorded) — the panel keeps showing one entry per meet.
    const mergedIntoFiles = [];
    for(const ownerId of Object.keys(ownerDocs)){
      const c = contrib[ownerId];
      if(!c) continue; // owner matched but no row actually landed on its meet
      const prev = ownerDocs[ownerId] || {};
      const prevKeys = Array.isArray(prev.touchedSwimmerKeys) ? prev.touchedSwimmerKeys : [];
      const allKeys = Array.from(new Set([...prevKeys, ...c.keys]));
      const mergedNames = Array.isArray(prev.mergedFileNames) ? prev.mergedFileNames.slice() : [];
      if(fileName && fileName !== prev.fileName && !mergedNames.includes(fileName)) mergedNames.push(fileName);
      // Rich per-merge audit log so the Uploaded Files panel can show EVERY
      // re-uploaded file as its own visible line under the meet it folded into
      // — name, when, and what it changed. serverTimestamp() can't live inside
      // an array element (it's a field-level sentinel), so each entry carries a
      // client ISO timestamp instead. Deduped by filename: a repeat re-upload
      // of the same file refreshes that file's entry rather than stacking.
      const stamp = new Date().toISOString();
      const mergedFiles = Array.isArray(prev.mergedFiles) ? prev.mergedFiles.slice() : [];
      if(fileName && fileName !== prev.fileName){
        const entry = { fileName, uploadId, addedResults: c.added, updatedResults: c.updated, uploadedAt: stamp };
        const at = mergedFiles.findIndex(m => m && m.fileName === fileName);
        if(at >= 0) mergedFiles[at] = entry; else mergedFiles.push(entry);
      }
      try {
        await FB.db.collection('hhst_uploads').doc(ownerId).set({
          addedResults: (prev.addedResults || 0) + c.added,
          updatedResults: (prev.updatedResults || 0) + c.updated,
          swimmerCount: allKeys.length,
          touchedSwimmerKeys: allKeys,
          mergedFileNames: mergedNames,
          mergedFiles,
          lastMergedAt: FB.FieldValue.serverTimestamp()
        }, { merge: true });
        mergedIntoFiles.push(prev.fileName || ownerId);
      } catch(e){
        errors.push(`Merged times into "${prev.fileName || ownerId}" but could not update its uploaded-files entry: ${e && e.message || e}`);
      }
    }

    if(uploadId){
      // When EVERYTHING this file brought folded into original files, don't
      // create a row of its own — the panel shows just the original entry.
      const own = contrib[uploadId];
      const foldedSomething = mergedIntoFiles.length > 0;
      const skipOwnRow = mode === 'results' && foldedSomething
        && !(own && (own.added || own.updated || own.keys.size));
      if(!skipOwnRow) try {
        // In results mode the ledger has this file's OWN share (folded rows are
        // counted on the original's row instead); roster mode keeps the totals.
        const ownAdded   = (mode === 'results') ? (own ? own.added : 0) : added;
        const ownUpdated = (mode === 'results') ? (own ? own.updated : 0) : updated;
        const ownMeets   = (mode === 'results' && foldedSomething && own) ? Array.from(own.meets) : Array.from(meetNames);
        await FB.db.collection('hhst_uploads').doc(uploadId).set({
          uploadId,
          fileName: fileName || '',
          season,
          mode,
          timeTrial,
          meetName: meetName || '',
          meetDate: meetDate || '',
          addedResults: ownAdded,
          updatedResults: ownUpdated,
          swimmerCount: writtenKeys.size,
          newSwimmerKeys: Array.from(newSwimmerKeys),
          touchedSwimmerKeys: Array.from(writtenKeys),
          meetNames: ownMeets,
          mergedMeets,
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
      updated,
      swimmers: writtenKeys.size,
      newSwimmers: newSwimmerKeys.size,
      profileUpdates: profileUpdated.size,
      skippedSwimmers: Array.from(skippedSwimmers),
      meets: meetNames.size,
      mergedMeets,
      mergedIntoFiles,
      newRecords: newRecordsForCaller,
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
    // Practice meets are normally excluded (they aren't real competition). But
    // early in a season — before two real meets are on record — the caller can
    // opt them IN so the board isn't empty/thin when all a swimmer has is a
    // practice swim. Time trials stay excluded regardless.
    const includePractice = !!(opts && opts.includePracticeMeets);
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
        if(!includePractice && isPracticeMeet(r.meet)) return false; // practice sessions excluded once 2 real meets exist
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
  // Team decision (2026): practice meets ARE real competition for our stats.
  // A "Practice Meet vs. ..." is a scored dual/scrimmage with real race times,
  // so those times now count EVERYWHERE — Fastest Five, every swimmer's profile,
  // leaderboards, Most Improved, records and the meet recap — exactly like any
  // other meet. This single chokepoint is what every surface routes through, so
  // returning false here promotes practice-meet times to full meet status site
  // wide. Informal practice swims are still excluded, but via the separate
  // r.timeTrial flag (time trials), not by meet name.
  function isPracticeMeet(meet){
    return false;
  }

  // Distinct ACTUAL meets within a season (practice meets + time trials
  // excluded), each with a representative (latest) date, sorted OLDEST → NEWEST.
  function meetsInSeason(swimmers, season){
    const byMeet = new Map();
    let seq = 0;
    swimmers.forEach(sw => (sw.results||[]).forEach(r => {
      if(!r || !r.meet) return;
      if(r.timeTrial) return; // time trials never count as a meet (keeps them out of Fastest Five / Most Improved targeting)
      if(isPracticeMeet(r.meet)) return; // practice/best-times sessions aren't actual meets
      if(season && r.season !== season) return;
      const ts = parseFlexibleDate(r.date);
      const cur = byMeet.get(r.meet);
      if(!cur){ byMeet.set(r.meet, { meet: r.meet, ts: isFinite(ts) ? ts : -Infinity, dateStr: r.date || '', seq: seq++ }); }
      else if(isFinite(ts) && ts > cur.ts){ cur.ts = ts; cur.dateStr = r.date || cur.dateStr; }
    }));
    // Sort oldest → newest by date. Dateless meets (ts === -Infinity) sort
    // earliest. On a TIE (same date, or both dateless) break on the meet NAME —
    // a data-intrinsic, deterministic key — NOT first-seen `seq` (iteration
    // order). With `seq`, a season holding two dateless meets picked its "most
    // recent meet" (and therefore the whole Most Improved board) from whichever
    // swimmer happened to be processed first; the name tiebreak makes the board
    // identical regardless of swimmer order.
    return Array.from(byMeet.values()).sort((a, b) => {
      if(a.ts !== b.ts){
        if(!isFinite(a.ts)) return -1;
        if(!isFinite(b.ts)) return 1;
        return a.ts - b.ts;
      }
      return a.meet < b.meet ? -1 : a.meet > b.meet ? 1 : 0;
    });
  }
  // ---- PR drops at one meet, vs the swimmer's own previous best ----------
  // For each stroke+distance the swimmer raced at `meetName`, compare their
  // best swim AT that meet to their previous best at earlier real meets. When
  // opts.season is set (the normal case), the baseline is scoped to THAT season
  // only — last season's times never count, so an in-season improvement reads
  // as a real drop even if the swimmer was faster a year ago. Omit the season
  // (e.g. the Time Trial dashboard) to span the full passed-in history.
  // Time trials and practice sessions never count on either side.
  // Only positive drops (true PRs) are returned, biggest first.
  // This is THE shared definition behind every "Most Improved" surface, and
  // it is deliberately independent of which meets the swimmer attended:
  // the old previous-meet pairing silently hid any swimmer who skipped the
  // baseline meet, no matter how much they PR'd (e.g. the 15-18 boys who
  // missed one meet, then PR'd in every event at the next).
  function prDropsAtMeet(sw, meetName, opts){
    const includeTimeTrials = !!(opts && opts.includeTimeTrials);
    const season = (opts && opts.season) || '';
    const rows = (sw.results || []).filter(r =>
      r && isFinite(r.seconds) &&
      (includeTimeTrials || (!r.timeTrial && !isPracticeMeet(r.meet))) &&
      (!season || (r.season || '') === season));
    const strokeOf = r => (r.stroke || extractStroke(r.event) || '').trim();
    const distOf   = r => ((r.distance != null ? String(r.distance) : '').trim() || extractDistance(r.event) || '');
    // Latest date seen at the target meet — only swims at or before it can be
    // a baseline. Dateless legacy rows count as earlier.
    let targetTs = -Infinity;
    rows.forEach(r => {
      if(r.meet !== meetName) return;
      const t = parseFlexibleDate(r.date);
      if(isFinite(t) && t > targetTs) targetTs = t;
    });
    const tgt = {}, prior = {};
    rows.forEach(r => {
      const st = strokeOf(r);
      if(!st) return;                      // unstroked legacy row — can't match
      const k = st + '|' + distOf(r);
      if(r.meet === meetName){
        if(!tgt[k] || r.seconds < tgt[k].seconds) tgt[k] = r;
      } else {
        const t = parseFlexibleDate(r.date);
        if(isFinite(targetTs) && isFinite(t) && t > targetTs) return; // future meet — not a baseline
        if(!prior[k] || r.seconds < prior[k].seconds) prior[k] = r;
      }
    });
    // Freestyle times at the target meet, by distance — for the plausibility
    // guard below (no stroke beats freestyle over the same distance).
    const freeAt = {};
    Object.keys(tgt).forEach(k => {
      const [st, d] = k.split('|');
      if(st === 'Freestyle') freeAt[d] = tgt[k].seconds;
    });
    const drops = [];
    Object.keys(tgt).forEach(k => {
      const tr = tgt[k];
      const [stroke, dist] = k.split('|');
      // Guessed-distance guard: a non-free target time IMPOSSIBLY faster
      // (>30%) than the swimmer's own free at that distance is a mislabeled
      // distance — drop it rather than report a fake plunge.
      if(stroke !== 'Freestyle' && freeAt[dist] && tr.seconds < freeAt[dist] * 0.70) return;
      let br = prior[k];
      // Distance-label rescue: when this stroke has exactly ONE distance on
      // each side and the baseline's distance is one the ingest could have
      // INFERRED from an age bracket (15/25/50), pair them — but only when
      // the target race is at least as long, so a shorter target can't
      // manufacture a bogus drop.
      if(!br){
        const priorKeys = Object.keys(prior).filter(x => x.split('|')[0] === stroke);
        const tgtKeys   = Object.keys(tgt).filter(x => x.split('|')[0] === stroke);
        if(priorKeys.length === 1 && tgtKeys.length === 1){
          const bNum = parseInt(priorKeys[0].split('|')[1], 10);
          const tNum = parseInt(dist, 10);
          if(isFinite(tNum) && isFinite(bNum) && tNum >= bNum &&
             (bNum === 15 || bNum === 25 || bNum === 50)) br = prior[priorKeys[0]];
        }
      }
      if(!br) return;                      // never raced this stroke before — a debut, not a drop
      const drop = br.seconds - tr.seconds;
      if(drop > 0.0001){
        drops.push({
          event: tr.event, stroke, dist,
          drop,
          fromSec: br.seconds, toSec: tr.seconds,
          fromTime: br.time || fmtTime(br.seconds),
          toTime:   tr.time || fmtTime(tr.seconds),
          fromMeet: br.meet || ''
        });
      }
    });
    drops.sort((a,b)=> b.drop - a.drop);
    return { drops, total: drops.reduce((s,d)=> s + d.drop, 0) };
  }

  // ---- Most Improved (latest meet vs the meet before it) ----------------
  // Ranks swimmers by total seconds dropped between the current season's most
  // recent meet (the "target") and the meet immediately before it within the
  // SAME season (the "baseline" — "compare the second meet to the first meet").
  // The season needs at least two ACTUAL meets in the current year (practice
  // meets + time trials don't count): with fewer, there's nothing to compare
  // against and the function returns empty (the board stays hidden). It never
  // reaches into a previous season. For each (swimmer, event) swum at BOTH
  // meets, drop = baseline time − target time, counted ONLY when the target swim
  // is a PERSONAL RECORD — the swimmer's fastest-ever time for that stroke+
  // distance across actual meets (practice meets + time trials excluded). A swim
  // that beat the previous meet but is still slower than an earlier real-meet
  // time is an improvement, not a PR, so it does not count.
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

    // 2) Per-swimmer drops: each swimmer's best at the target meet vs their own
    //    previous best at earlier real meets IN THIS SEASON (prDropsAtMeet is
    //    scoped to `season`, so last year's times never count). No baseline meet
    //    is required, so the board works for a season's very first meet and NEVER
    //    hides a swimmer who skipped the previous meet.
    const drops = [];
    swimmers.forEach(sw => {
      // People filter: only rank swimmers on this season's roster (legacy
      // swimmers with no seasons array still match).
      if(season){
        const sws = Array.isArray(sw.seasons) ? sw.seasons : [];
        if(sws.length && !sws.includes(season)) return;
      }
      const { drops: eventsDropped, total } = prDropsAtMeet(sw, target.meet, { season });
      if(!(total > 0)) return;
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
        totalDrop: total,
        eventsDropped: eventsDropped.map(d => ({
          event: d.event, stroke: d.stroke, dist: d.dist, drop: d.drop,
          fromSec: d.fromSec, toSec: d.toSec,
          fromTime: d.fromTime, toTime: d.toTime,
          fromMeet: d.fromMeet
        })),
        eventCount: eventsDropped.length
      });
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
      // Baselines are now per-swimmer previous bests, not one meet — kept as
      // empty strings so existing callers render nothing rather than break.
      baselineMeet: '',
      baselineSeason: '',
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
    // Collect EVERY name-matching swimmer, tagged by match strength. We must not
    // commit to the first substring hit: when one normalized name is a substring
    // of another ("Nathan Reed" inside "Jonathan Reed", "Ann Lee" inside "Mary
    // Ann Lee"), the first-seen one would win and then fail the email/parent
    // check — locking out the real family, or (if those fields were blank)
    // handing back the wrong child. So gather all, prefer EXACT name matches, and
    // let the email/parent check pick among them.
    const targetsToCheck = [targetName, swapped].filter(Boolean);
    const exactMatches = [];
    const looseMatches = [];
    snap.forEach(doc => {
      const sw = doc.data();
      const swName = norm(sw.name);
      // Preferred-name variant (e.g. "Maddy Cakerice" when sw.name is "Madelyn Cakerice")
      let swPref = '';
      if(sw.preferredName){
        const lastWord = (sw.name||'').split(' ').filter(Boolean).pop() || '';
        swPref = norm(`${sw.preferredName} ${lastWord}`);
      }
      const candidates = [swName, swPref].filter(Boolean);
      let exact = false, loose = false;
      for(const cand of candidates){
        for(const t of targetsToCheck){
          if(cand === t) exact = true;
          else if(cand.includes(t) || t.includes(cand)) loose = true;
        }
      }
      if(exact) exactMatches.push(sw);
      else if(loose) looseMatches.push(sw);
    });
    if(!exactMatches.length && !looseMatches.length){
      return { ok:false, reason:'We couldn\'t find a swimmer with that name. Double-check the spelling.' };
    }
    // Verify a candidate against the family's email/parent (the real
    // authenticator). A swimmer with no email AND no parent on file passes by
    // name alone, preserving legacy records.
    function verify(sw){
      if(sw.emails && sw.emails.length && targetEmail
         && !sw.emails.some(e => e.toLowerCase() === targetEmail)) return false;
      if(sw.parents && sw.parents.length && targetParent && !sw.parents.some(p => {
        const np = norm(p);
        return np === targetParent || np.includes(targetParent) || targetParent.includes(np);
      })) return false;
      return true;
    }
    // Prefer exact-name matches; within a tier return the one the family's
    // email/parent verifies, so a name collision can't hand back the wrong swimmer.
    for(const tier of [exactMatches, looseMatches]){
      const verified = tier.filter(verify);
      if(verified.length) return { ok:true, swimmer: verified[0] };
    }
    // A name matched but no candidate's email/parent lined up.
    return { ok:false, reason:'The email or parent name you entered doesn\'t match our records for that swimmer.' };
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
    const removedTimes = []; // full payloads of every time this delete strips — for the audit/restore log

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
          removedTimes.push(timeAuditPayload(d.id, sw.name || d.id, r));
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

    // Log every removed time to the immutable audit trail so the coach can see
    // it (and restore it) later, even though this file is now gone. Best-effort:
    // a failure here must never block the delete that already committed.
    if(removedTimes.length){
      const label = (meta && (meta.meetName || (Array.isArray(meta.meetNames) && meta.meetNames[0]) || meta.fileName)) || 'Deleted meet file';
      try {
        await logTimeAudit({
          action: 'remove', source: 'file-delete',
          label, season: (meta && meta.season) || '', times: removedTimes
        });
      } catch(e){ /* audit is best-effort */ }
    }

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

  // ============ Time-edit audit trail (hhst_time_audit) ============
  // An append-only log of every time ADDED by hand or REMOVED in bulk, each
  // entry carrying the FULL payload of the affected times. That copy is what
  // lets a coach see — and one-click restore — a time even after the file that
  // brought it in has been deleted. Capped per entry so one giant clear can't
  // blow past Firestore's 1 MB document limit.
  const TIME_AUDIT_CAP = 1500;
  // Snapshot one result row into a self-contained, restorable payload.
  function timeAuditPayload(swimmerKey, swimmerName, r){
    return {
      swimmerKey, swimmerName: swimmerName || swimmerKey,
      event: (r && r.event) || '',
      stroke: (r && r.stroke) || '',
      distance: (r && r.distance != null) ? String(r.distance) : '',
      time: (r && r.time) || '',
      seconds: (r && isFinite(r.seconds)) ? r.seconds : null,
      meet: (r && r.meet) || '',
      date: (r && r.date) || '',
      season: (r && r.season) || '',
      timeTrial: !!(r && r.timeTrial),
      place: (r && r.place != null) ? r.place : null
    };
  }
  async function logTimeAudit({ action, source, label, season, times }){
    const list = Array.isArray(times) ? times.filter(Boolean) : [];
    if(!list.length) return null;
    const ref = await FB.db.collection('hhst_time_audit').add({
      action: action || 'edit',
      source: source || '',
      label: label || '',
      season: season || '',
      count: list.length,
      truncated: list.length > TIME_AUDIT_CAP,
      times: list.slice(0, TIME_AUDIT_CAP),
      at: FB.FieldValue.serverTimestamp()
    });
    return ref.id;
  }
  // Public hook the admin's manual-time form calls after a successful add, so
  // every by-hand time entry shows in the history (and can be restored if a
  // later season-clear or file-delete removes it).
  async function recordManualTimeAudit(payload){
    try {
      return await logTimeAudit({
        action: 'add', source: 'manual',
        label: (payload && payload.meet) || 'Manual entry',
        season: (payload && payload.season) || '',
        times: [payload]
      });
    } catch(e){ return null; }
  }
  // List the whole audit trail, newest first.
  async function getTimeAudit(){
    const snap = await FB.db.collection('hhst_time_audit').get();
    const out = [];
    snap.forEach(d => out.push({ id: d.id, ...d.data() }));
    const ms = u => {
      const t = u && u.at;
      if(t && typeof t.toMillis === 'function') return t.toMillis();
      if(t && typeof t.seconds === 'number') return t.seconds * 1000;
      return 0;
    };
    out.sort((a,b) => ms(b) - ms(a) || (b.id||'').localeCompare(a.id||''));
    return out;
  }
  // Put an audit entry's times back onto their swimmers. Idempotent: a time
  // that's already present is skipped, so restoring twice is harmless. A time
  // whose swimmer no longer exists is reported as "missing" (can't be placed).
  async function restoreTimeEvent(auditId){
    auditId = (auditId || '').toString().trim();
    if(!auditId) return { restored:0, skipped:0, missing:0 };
    const doc = await FB.db.collection('hhst_time_audit').doc(auditId).get();
    if(!doc.exists) return { restored:0, skipped:0, missing:0 };
    const data = doc.data() || {};
    const times = Array.isArray(data.times) ? data.times : [];
    const byKey = {};
    times.forEach(t => { if(t && t.swimmerKey){ (byKey[t.swimmerKey] = byKey[t.swimmerKey] || []).push(t); } });
    let restored = 0, skipped = 0, missing = 0;
    for(const key of Object.keys(byKey)){
      const ref = FB.db.collection('swimmers').doc(key);
      const snap = await ref.get();
      if(!snap.exists){ missing += byKey[key].length; continue; }
      const sw = snap.data() || {};
      const results = Array.isArray(sw.results) ? sw.results.slice() : [];
      const seasons = Array.isArray(sw.seasons) ? sw.seasons.slice() : [];
      let changed = false;
      byKey[key].forEach(t => {
        const present = results.some(r => r && r.event === t.event && r.meet === t.meet &&
          r.date === t.date && (r.season||'') === (t.season||'') &&
          Math.abs((r.seconds||0) - (t.seconds||0)) < 0.005);
        if(present){ skipped++; return; }
        const rebuilt = {
          stroke: t.stroke || extractStroke(t.event || ''),
          distance: t.distance || extractDistance(t.event || ''),
          event: t.event || '',
          time: t.time || (isFinite(t.seconds) ? fmtTime(t.seconds) : ''),
          seconds: isFinite(t.seconds) ? t.seconds : NaN,
          meet: t.meet || '', date: t.date || '', season: t.season || '',
          timeTrial: !!t.timeTrial,
          restoredAt: new Date().toISOString()
        };
        if(t.place != null) rebuilt.place = t.place;
        results.push(rebuilt);
        if(t.season && !seasons.includes(t.season)) seasons.push(t.season);
        changed = true; restored++;
      });
      if(changed){
        await ref.set({ results, seasons, updatedAt: FB.FieldValue.serverTimestamp() }, { merge:true });
      }
    }
    try { await FB.db.collection('hhst_time_audit').doc(auditId).set({ restoredAt: FB.FieldValue.serverTimestamp() }, { merge:true }); } catch(e){}
    return { restored, skipped, missing };
  }

  // ============ Clear all meets from one season ============
  // Strips every NON-time-trial result tagged with `season` from every swimmer
  // (so the roster, time trials, and every OTHER season stay put), then cleans
  // the meet-times mirror + this season's meet-upload rows. Every removed time
  // is copied into the audit trail first, so the whole clear is restorable.
  async function clearSeasonMeetTimes(season){
    season = (season || '').toString();
    if(!season) return { season:'', removedResults:0, updatedSwimmers:0 };
    const snap = await FB.db.collection('swimmers').get();
    const toWrite = [];
    const removedTimes = [];
    let removedResults = 0;
    snap.forEach(d => {
      const sw = d.data() || {};
      const results = Array.isArray(sw.results) ? sw.results : [];
      const kept = [];
      let changed = false;
      results.forEach(r => {
        // "Meets" = real, non-time-trial results in this season. Time trials
        // live on the Time Trial dashboard and are left untouched.
        if(r && r.season === season && !r.timeTrial){
          removedResults++;
          removedTimes.push(timeAuditPayload(d.id, sw.name || d.id, r));
          changed = true;
        } else {
          kept.push(r);
        }
      });
      if(changed){ sw.results = kept; toWrite.push({ key:d.id, results:kept }); }
    });

    // Audit BEFORE deleting so a mid-way failure still leaves a record.
    if(removedTimes.length){
      try {
        await logTimeAudit({ action:'remove', source:'season-clear',
          label:`All meets · ${season}`, season, times: removedTimes });
      } catch(e){ /* best-effort */ }
    }

    for(let i=0;i<toWrite.length;i+=400){
      const batch = FB.db.batch();
      toWrite.slice(i, i+400).forEach(w => {
        batch.set(FB.db.collection('swimmers').doc(w.key),
          { results: w.results, updatedAt: FB.FieldValue.serverTimestamp() }, { merge:true });
      });
      await batch.commit();
    }
    // Best-effort mirror + upload-registry cleanup for this season.
    try {
      const mt = await FB.db.collection('hhst_meet_times').where('season','==',season).get();
      const refs = []; mt.forEach(x => refs.push(x.ref));
      while(refs.length){ const b = FB.db.batch(); refs.splice(0,400).forEach(r => b.delete(r)); await b.commit(); }
    } catch(e){}
    try {
      const up = await FB.db.collection('hhst_uploads').where('season','==',season).get();
      const refs = []; up.forEach(x => { const dd = x.data() || {}; if(dd.mode !== 'roster') refs.push(x.ref); });
      while(refs.length){ const b = FB.db.batch(); refs.splice(0,400).forEach(r => b.delete(r)); await b.commit(); }
    } catch(e){}
    // Recompute distinct meet count from the post-clear state we already hold.
    try {
      const writeMap = new Map(toWrite.map(w => [w.key, w.results]));
      const allMeets = new Set();
      snap.forEach(d => {
        const results = writeMap.get(d.id) || (d.data().results || []);
        results.forEach(r => { if(r && r.meet) allMeets.add(r.meet); });
      });
      await FB.db.collection('meta').doc('stats').set({ meetCount: allMeets.size }, { merge:true });
    } catch(e){}
    return { season, removedResults, updatedSwimmers: toWrite.length };
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
      const bestByEvent = new Map(); // "<dist>|<stroke>" -> { idx, seconds }
      results.forEach((r, i) => {
        if(!r || r.meet !== meetName) return;
        if(season && r.season !== season) return;
        resultsScanned++;
        matchIdx.push(i);
        const stroke = r.stroke || extractStroke(r.event) || '';
        const dist = (r.distance != null && String(r.distance).trim() !== '')
          ? String(r.distance).trim() : (extractDistance(r.event) || '');
        // Key by the FULL event identity (distance + stroke), never stroke alone:
        // a swimmer who raced two distances of one stroke at this meet (e.g. 50
        // Free AND 100 Free) must keep BOTH. Only genuine duplicates — the same
        // distance+stroke logged more than once from a double upload — collapse
        // to the fastest. An unidentifiable row (no stroke/distance/event label)
        // gets a per-row key so it's never merged away.
        const key = (dist || stroke) ? `${dist}|${stroke}` : (r.event || `__row${i}`);
        const sec = (typeof r.seconds === 'number' && isFinite(r.seconds))
          ? r.seconds : timeToSeconds(r.time);
        const cur = bestByEvent.get(key);
        const better = !cur || (isFinite(sec) && (!isFinite(cur.seconds) || sec < cur.seconds));
        if(better) bestByEvent.set(key, { idx:i, seconds: isFinite(sec) ? sec : Infinity });
      });
      if(!matchIdx.length) return;
      const keepIdx = new Set(Array.from(bestByEvent.values()).map(v => v.idx));
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
    const wipeRoster = opts.roster !== false;
    const wipeTimes  = opts.meetTimes !== false;
    if(wipeRoster && wipeTimes){
      // Full reset: swimmer docs (with their embedded results) and every mirror.
      await clearCollection('swimmers');
      await clearCollection('hhst_rosters');
      await clearCollection('hhst_meet_times');
      await clearCollection('hhst_uploads');
      try{ await FB.db.collection('meta').doc('stats').delete(); }catch(e){}
    } else if(wipeRoster){
      // Roster-only wipe — honor the "meet times will be kept" promise. Times
      // live EMBEDDED in swimmers/{key}, so we must NOT delete those docs (the
      // old code did `clearCollection('swimmers')` here, wiping every result
      // despite meetTimes:false). Instead strip the roster-identity fields but
      // keep name/key/results and the meet-times mirror.
      const snap = await FB.db.collection('swimmers').get();
      const docs = [];
      snap.forEach(d => docs.push({ ref: d.ref, data: d.data() || {} }));
      while(docs.length){
        const batch = FB.db.batch();
        docs.splice(0,400).forEach(({ ref, data }) => {
          batch.set(ref, {
            key: data.key || ref.id,
            name: data.name || '',
            preferredName: data.preferredName || '',
            results: Array.isArray(data.results) ? data.results : [],
            address:'', emails:[], parents:[], age:'', group:'', ageGroup:'',
            gender:'', bracket:'', seasons:[], seasonInfo:{}, rosterUploads:{},
            updatedAt: FB.FieldValue.serverTimestamp()
          });
        });
        await batch.commit();
      }
      await clearCollection('hhst_rosters');
      // Drop only the roster upload rows; meet-times upload rows stay.
      await deleteUploadsByMode('roster');
    } else if(wipeTimes){
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
  }
  async function clearRoster(){ return clearAll({ roster:true, meetTimes:false }); }
  async function clearMeetTimes(){ return clearAll({ roster:false, meetTimes:true }); }
  // -------- Team records (hhst_records) --------
  // Read every team record, sorted for display: age group ascending, then
  // event stroke/distance, then gender (girls before boys). Empty array
  // when nothing's on record yet.
  async function getRecords(){
    const snap = await FB.db.collection('hhst_records').get();
    const out = [];
    snap.forEach(d => out.push({ id: d.id, ...d.data() }));
    out.sort((a, b) => {
      const aBr = AGE_GROUP_ORDER.indexOf(a.ageGroup);
      const bBr = AGE_GROUP_ORDER.indexOf(b.ageGroup);
      if(aBr !== bBr) return (aBr < 0 ? 999 : aBr) - (bBr < 0 ? 999 : bBr);
      const ev = compareEventLabel(a.event || '', b.event || '');
      if(ev) return ev;
      return (a.gender === 'F' ? 0 : 1) - (b.gender === 'F' ? 0 : 1);
    });
    return out;
  }
  // Wipe every team record — the "Clear All Records" admin button. Doesn't
  // touch swimmers or meet times; a subsequent upload will re-establish
  // records from whatever times survive.
  async function clearAllRecords(){ await clearCollection('hhst_records'); }
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
    // Most Improved normally ignores time trials (they don't count competitively).
    // The Time Trial dashboard passes includeTimeTrials so it CAN rank trial-to-
    // trial improvement, where excluding them would leave nothing to compare.
    const includeTimeTrials = !!(opts && opts.includeTimeTrials);
    const results = season
      ? (sw.results||[]).filter(r => r && r.season === season)
      : (sw.results||[]);
    const total = results.length;
    const events = {};
    const meets = new Set();
    results.forEach(r=>{
      if(r.meet) meets.add(r.meet); // guard so a blank meet doesn't inflate meetCount vs recentMeets
    });
    // PR & time-drop math runs on REAL meet swims ONLY — time trials and
    // practice/best-times sessions are never personal records and never count
    // as time dropped, anywhere on the site. They still show in meet history
    // and still count toward races/meets attended above. The Time Trial
    // dashboard opts back in via includeTimeTrials to analyze trial progress.
    const realResults = includeTimeTrials
      ? results
      : results.filter(r => r && !r.timeTrial && !isPracticeMeet(r.meet));
    realResults.forEach(r=>{
      const evKey = r.event;
      if(!events[evKey]) events[evKey] = [];
      events[evKey].push(r);
    });
    // Finite-safe sort key: DQ rows carry no comparable seconds. Number.MAX_VALUE
    // instead of Infinity — with two no-time rows an Infinity-Infinity comparator
    // returns NaN, which makes Array.sort's behavior undefined and can corrupt
    // the whole ordering (wrong "best" picked).
    const secOf = r => isFinite(r.seconds) ? r.seconds : Number.MAX_VALUE;
    const bestTimes = Object.entries(events)
      // An event the swimmer has only ever DQ'd in has no best time — it stays
      // in meet history but must never render as a "Personal Best" card.
      .filter(([, arr]) => arr.some(r => isFinite(r.seconds)))
      .map(([event, arr])=>{
      const sorted = arr.slice().sort((a,b)=> secOf(a)-secOf(b));
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

    // "PRs held" = events where the swimmer's LATEST swim is their fastest —
    // exactly what the dashboard and Season Stats labels promise. (This used
    // to compare the latest swim against the FIRST swim, which over-counted:
    // a kid who went 30.0 → 25.0 → 27.0 "beat their first time" but is not
    // currently at their best.) latestIsPR already encodes the labelled rule.
    const prCount = bestTimes.filter(b => b.latestIsPR).length;

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

    // Favorite (most-raced) event + cumulative improvement.
    const favorite = bestTimes.slice().sort((a,b)=> b.count - a.count)[0] || null;

    // Time dropped = how much the swimmer's PB per event improved WITHIN THIS
    // SEASON — first real swim of the season → best real swim of the season.
    // Last season never factors in: a swimmer who was faster last year still
    // shows their honest in-season improvement (and a single-meet season shows
    // 0 until they've raced an event twice). `firstSeconds` is already the
    // first swim inside the season-filtered set, so the baseline is purely the
    // current season's opener. (season:'' all-time view spans everything.)
    const totalTimeDropSec = bestTimes.reduce((sum, b) => {
      const baseline = b.firstSeconds;
      return sum + (isFinite(baseline) ? Math.max(0, baseline - b.seconds) : 0);
    }, 0);

    // ---- Most Improved: PRs at the swimmer's MOST RECENT meet --------------
    // recentMeetDropSec = total seconds this swimmer beat their own previous
    // bests by at their latest real meet; mostImproved = the single biggest of
    // those PR drops. Baselines come from their best at earlier real meets IN
    // THIS SEASON only (passed through to prDropsAtMeet below), so last season's
    // faster time never suppresses an in-season PR. A swimmer who skipped a meet
    // still gets full credit. Time trials and practice sessions never count on
    // either side; the Time Trial dashboard opts back in via includeTimeTrials.
    let recentMeetDropSec = 0;
    let mostImproved = null;
    {
      // Latest real meet within the (season-filtered) results…
      const meetTs = {};
      results.forEach(r => {
        if(!r || !r.meet || (!includeTimeTrials && (r.timeTrial || isPracticeMeet(r.meet)))) return;
        const ts = parseFlexibleDate(r.date);
        const t = isFinite(ts) ? ts : -Infinity;
        if(meetTs[r.meet] === undefined || t > meetTs[r.meet]) meetTs[r.meet] = t;
      });
      // Newest → oldest; tie-break on meet name so the pick is deterministic.
      const order = Object.keys(meetTs).sort((a,b) =>
        meetTs[b] !== meetTs[a] ? meetTs[b] - meetTs[a] : (a < b ? 1 : a > b ? -1 : 0));
      if(order.length){
        // Baselines are scoped to THIS season (see prDropsAtMeet's season opt),
        // so the "drop" is measured against an earlier swim this season, never
        // last year's time.
        const targetMeet = order[0];
        const { drops, total } = prDropsAtMeet(sw, targetMeet, { includeTimeTrials, season });
        recentMeetDropSec = total;
        if(drops.length){
          const top = drops[0];
          mostImproved = {
            event: top.event,
            improvement: top.drop,
            firstTime: top.fromTime,
            time: top.toTime,
            fromMeet: top.fromMeet,
            toMeet: targetMeet
          };
        }
      }
    }

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
      totalTimeDropSec, recentMeetDropSec,
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
    // Times are SEASON BESTS — each swimmer's fastest real swim of the
    // selected season per event, so the board reflects current-season form.
    const myEvents = {};
    (sw.results||[]).forEach(r => {
      if(!isFinite(r.seconds) || !inSeason(r) || r.timeTrial || isPracticeMeet(r.meet)) return;
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
          if(r.event === event && isFinite(r.seconds) && inSeason(r) && !r.timeTrial && !isPracticeMeet(r.meet) && r.seconds < best) best = r.seconds;
        });
        if(isFinite(best)) competitors.push({ key: other.key, sec: best });
      });
      competitors.sort((a,b)=> a.sec - b.sec);
      const idx = competitors.findIndex(c => c.key === sw.key);
      ranks[event] = {
        rank: idx + 1, total: competitors.length, mySec,
        // Chase data for the dashboard: how far to the swimmer one place up,
        // and (for the leader) how big the cushion to second place is.
        gapAhead: idx > 0 ? mySec - competitors[idx - 1].sec : 0,
        gapBehind: (idx >= 0 && idx < competitors.length - 1) ? competitors[idx + 1].sec - mySec : 0
      };
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
        if(isPracticeMeet(r.meet)) return; // practice sessions excluded too
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
    let recentDropSec = 0;
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
        // Team aggregates promise "time trials excluded" — strip them before
        // the per-swimmer roll-up. (A swimmer's own dashboard keeps trials on
        // their profile; the TEAM boards must not count them toward PRs or
        // time dropped.)
        const s = statsForSwimmer(
          { ...sw, results: (sw.results||[]).filter(r => r && !r.timeTrial) },
          { season });
        gold += s.gold; silver += s.silver; bronze += s.bronze;
        totalDropSec += s.totalTimeDropSec;
        recentDropSec += s.recentMeetDropSec;
        prRaces += s.prCount;
      }
      filtered.forEach(r => meetsSet.add(r.meet));
    });
    return {
      swimmerCount: (season || meet) ? activeSwimmers : swimmers.length,
      totalRaces, meetCount: meetsSet.size,
      gold, silver, bronze,
      podium: gold + silver + bronze,
      totalDropSec, recentDropSec, prRaces,
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
    // Light is the product default; dark is the opt-in night-meet theme.
    const saved = localStorage.getItem('hhst.theme') || 'light';
    document.documentElement.setAttribute('data-theme', saved);
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
    parseCSV, parseHy3, parseSd3, parseResultsFile, ingestCSV, ingestRows,
    findSwimmer,
    deleteSwimmer, pruneNonRosterSwimmers, addSwimmerManual, updateSwimmer,
    getUploads, deleteUpload,
    getTimeAudit, restoreTimeEvent, recordManualTimeAudit, clearSeasonMeetTimes,
    migrateSeasonAges, countSwimmersNeedingSeasonMigration, inferMissingDistances, renameMeet, dedupeMeetByStroke,
    clearAll, clearRoster, clearMeetTimes,
    getRecords, clearAllRecords, normalizeRecordEvent, recordDocId,
    isAdminLoggedIn, loginAdmin, logoutAdmin, onAuthChanged,
    statsForSwimmer, rankSwimmerInAgeGroup, buildLeaderboards, teamStats, teamStatsBySeason,
    getAllSeasons, currentSeason, currentSeasonWithTimes, filterSwimmerToSeason, getAllMeets,
    getAgeGroup, AGE_GROUP_ORDER, STROKE_ORDER, extractStroke, extractDistance, distanceNum, compareEventLabel,
    fmtTime, timeToSeconds, swimmerKey, slugify, meetTimeDocId, norm,
    mapHeader, normHeaderKey,
    fixNameOrder, isValidEmail, ageFromDob,
    normalizeEventLabel,
    leaderboardsByEvent, mostImprovedAtMeet, meetsInSeason, isPracticeMeet, sortAgeGroups,
    groupByBracket,
    parseGender, parseGenderFromAgeGroup, genderLabel, competitionGroup,
    swimmerSeasonInfo, mostRecentSeasonOf,
    initTheme, toggleTheme
  };
})(window);
