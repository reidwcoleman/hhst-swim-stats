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
  function fmtTime(t){
    if(t==null) return '';
    let s = t.toString().trim();
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
    const s = t.toString().trim();
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
    'event':'event','stroke':'event','eventname':'event',
    'distance':'distance',
    'time':'time','finaltime':'time','result':'time','swimtime':'time','seedtime':'time',
    'meet':'meet','meetname':'meet','competition':'meet',
    'date':'date','meetdate':'date','sessiondate':'date',
    // Age / DOB
    'age':'age','swimmerage':'age','athleteage':'age',
    'dob':'dob','dateofbirth':'dob','birthdate':'dob','birthday':'dob','athletebirthdate':'dob',
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

  function buildEventLabel(rec){
    const dist = rec.distance || '';
    const ev = rec.event || '';
    if(dist && !/\d/.test(ev)) return `${dist} ${ev}`.trim();
    return ev || dist || 'Unknown';
  }
  function extractDistance(s){
    const m = (s||'').match(/(\d+)\s*(?:yd|y|m|meter|yard)?/i);
    return m ? m[1] : '';
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
  async function ingestCSV(text){
    const rows = parseCSV(text);
    if(rows.length < 2) return { added:0, swimmers:0, profileUpdates:0, errors:['Empty CSV'] };
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
    // Fetch existing
    const existing = {};
    await Promise.all(Array.from(touchedKeys).map(async k => {
      const sw = await getSwimmer(k);
      existing[k] = sw;
    }));

    for(const rec of records){
      const key = rec.__key;
      const name = rec.__name;
      if(!updates[key]){
        updates[key] = existing[key] || {
          key, name,
          address: '',
          emails: [],
          parents: [],
          age: '',
          group: '',
          results: []
        };
        // ensure shape
        updates[key].emails = updates[key].emails || [];
        updates[key].parents = updates[key].parents || [];
        updates[key].results = updates[key].results || [];
      }
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
      // Group: prefer the team's training group (RosterGroup), fall back to age class
      if(!sw.group){
        const g = (rec.rostergroup && rec.rostergroup.trim()) || (rec.group && rec.group.trim()) || (rec.agegroup && rec.agegroup.trim()) || '';
        if(g){ sw.group = g; touched = true; }
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
      if(touched) profileUpdated.add(key);
      if(rec.event && rec.time){
        const ev = buildEventLabel(rec);
        sw.results.push({
          event: ev,
          distance: rec.distance || extractDistance(rec.event),
          stroke: extractStroke(rec.event),
          time: fmtTime(rec.time),
          seconds: timeToSeconds(fmtTime(rec.time)),
          meet: rec.meet || 'Unknown Meet',
          date: rec.date || '',
          place: rec.place || '',
          split: rec.split || ''
        });
        added++;
        if(rec.meet) meetNames.add(rec.meet);
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

    return { added, swimmers: touchedKeys.size, profileUpdates: profileUpdated.size, meets: meetNames.size, errors };
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
  }
  async function addSwimmerManual({name, address, email, parent, age, group}){
    const key = swimmerKey(fixNameOrder(name));
    const existing = await getSwimmer(key);
    const next = existing || { key, name: fixNameOrder(name), address:'', emails:[], parents:[], age:'', group:'', results:[] };
    next.emails = next.emails || [];
    next.parents = next.parents || [];
    next.results = next.results || [];
    if(address) next.address = address;
    if(age) next.age = age;
    if(group) next.group = group;
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
    next.emails = next.emails || [];
    next.parents = next.parents || [];
    next.results = next.results || [];
    await FB.db.collection('swimmers').doc(key).set({
      ...next, updatedAt: FB.FieldValue.serverTimestamp()
    }, { merge: true });
    return next;
  }
  async function clearAll(){
    // Delete every swimmer doc + the meta/stats doc.
    const snap = await FB.db.collection('swimmers').get();
    const docs = [];
    snap.forEach(d => docs.push(d.ref));
    while(docs.length){
      const batch = FB.db.batch();
      docs.splice(0,400).forEach(ref => batch.delete(ref));
      await batch.commit();
    }
    try{ await FB.db.collection('meta').doc('stats').delete(); }catch(e){}
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
  function statsForSwimmer(sw){
    const results = sw.results||[];
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
      return { event, time: sorted[0].time, seconds: sorted[0].seconds, count: arr.length, history: arr };
    }).sort((a,b)=>{
      const da = parseInt((a.event.match(/\d+/)||[0])[0],10);
      const db = parseInt((b.event.match(/\d+/)||[0])[0],10);
      return da-db;
    });
    let prCount = 0;
    bestTimes.forEach(b=>{
      if(b.history.length >= 2){
        const sorted = b.history.slice().sort((a,b)=> new Date(a.date)-new Date(b.date));
        if(sorted[sorted.length-1].seconds <= sorted[0].seconds) prCount++;
      }
    });
    return {
      totalRaces: total,
      meetCount: meets.size,
      eventCount: bestTimes.length,
      prCount,
      bestTimes
    };
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

  global.HHST = {
    readAll, getSwimmer,
    parseCSV, ingestCSV,
    findSwimmer,
    deleteSwimmer, addSwimmerManual, updateSwimmer, clearAll,
    isAdminLoggedIn, loginAdmin, logoutAdmin, onAuthChanged,
    statsForSwimmer,
    fmtTime, timeToSeconds, swimmerKey, norm,
    fixNameOrder, isValidEmail, ageFromDob,
    initTheme, toggleTheme
  };
})(window);
