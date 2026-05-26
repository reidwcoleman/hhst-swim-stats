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
  function normAddr(s){
    return (s||'').toString().trim().toLowerCase()
      .replace(/\b(apt|apartment|unit|suite|ste|#)\b/g,'')
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

  const HEADER_MAP = {
    'swimmer':'name','name':'name','full name':'name','swimmer name':'name','athlete':'name',
    'first':'first','first name':'first',
    'last':'last','last name':'last','surname':'last',
    'address':'address','street':'address','home address':'address',
    'parent':'parent','parent name':'parent','parent 1':'parent','guardian':'parent','parent/guardian':'parent',
    'event':'event','stroke':'event',
    'distance':'distance',
    'time':'time','final time':'time','result':'time',
    'meet':'meet','meet name':'meet','competition':'meet',
    'date':'date','meet date':'date',
    'age':'age','swimmer age':'age',
    'group':'group','training group':'group','squad':'group',
    'place':'place','finish':'place','rank':'place',
    'split':'split','splits':'split'
  };
  function mapHeader(h){
    const key = (h||'').toString().trim().toLowerCase();
    return HEADER_MAP[key] || key.replace(/[^a-z0-9]+/g,'_');
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
    if(rows.length < 2) return { added:0, swimmers:0, errors:['Empty CSV'] };
    const headers = rows[0].map(mapHeader);

    // Stage updates per swimmer (so we batch writes)
    const updates = {}; // key -> swimmer object
    const errors = [];
    let added = 0;
    const meetNames = new Set();

    // First pass: pull existing swimmers we'll touch (so we merge, not overwrite)
    const touchedKeys = new Set();
    const records = [];
    for(let r=1; r<rows.length; r++){
      const cells = rows[r];
      if(!cells || !cells.length) continue;
      const rec = {};
      for(let i=0;i<headers.length;i++) rec[headers[i]] = (cells[i]||'').trim();
      let name = rec.name;
      if(!name && (rec.first || rec.last)) name = `${rec.first||''} ${rec.last||''}`.trim();
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
          parents: [],
          age: '',
          group: '',
          results: []
        };
        // ensure shape
        updates[key].parents = updates[key].parents || [];
        updates[key].results = updates[key].results || [];
      }
      const sw = updates[key];
      if(rec.address && !sw.address) sw.address = rec.address;
      if(rec.age && !sw.age) sw.age = rec.age;
      if(rec.group && !sw.group) sw.group = rec.group;
      if(rec.parent){
        const p = rec.parent.trim();
        if(p && !sw.parents.map(norm).includes(norm(p))) sw.parents.push(p);
      }
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

    return { added, swimmers: touchedKeys.size, meets: meetNames.size, errors };
  }

  // -------- Lookup --------
  async function findSwimmer({ name, address, parent }){
    const targetName = norm(name);
    const targetAddr = normAddr(address);
    const targetParent = norm(parent);
    if(!targetName) return { ok:false, reason:'Please enter the swimmer\'s name.' };
    const snap = await FB.db.collection('swimmers').get();
    let match = null;
    snap.forEach(doc => {
      if(match) return;
      const sw = doc.data();
      const swName = norm(sw.name);
      if(swName === targetName || swName.includes(targetName) || targetName.includes(swName)){
        match = sw;
      }
    });
    if(!match) return { ok:false, reason:'We couldn\'t find a swimmer with that name. Double-check the spelling.' };
    if(match.address){
      const swAddr = normAddr(match.address);
      const addrOk = !targetAddr || swAddr.includes(targetAddr) || targetAddr.includes(swAddr);
      if(!addrOk) return { ok:false, reason:'The address you entered doesn\'t match our records.' };
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
  async function addSwimmerManual({name, address, parent, age, group}){
    const key = swimmerKey(name);
    const existing = await getSwimmer(key);
    const next = existing || { key, name, address:'', parents:[], age:'', group:'', results:[] };
    next.parents = next.parents || [];
    next.results = next.results || [];
    if(address) next.address = address;
    if(age) next.age = age;
    if(group) next.group = group;
    if(parent && !next.parents.map(norm).includes(norm(parent))) next.parents.push(parent);
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
    deleteSwimmer, addSwimmerManual, clearAll,
    isAdminLoggedIn, loginAdmin, logoutAdmin, onAuthChanged,
    statsForSwimmer,
    fmtTime, timeToSeconds, swimmerKey, norm,
    initTheme, toggleTheme
  };
})(window);
