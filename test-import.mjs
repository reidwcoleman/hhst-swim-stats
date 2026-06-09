// Offline test harness for the SwimTopia/Hy-Tek/SDIF/CSV import parsers in assets/data.js.
// Loads data.js in a VM with a window stub and exercises the pure parsing functions.
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('./assets/data.js', import.meta.url), 'utf8');
const sandbox = { window: {}, console };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'data.js' });
const H = sandbox.window.HHST;
if (!H) { console.error('FAILED: window.HHST not exported'); process.exit(1); }

let pass = 0, fail = 0;
const fails = [];
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; }
  else { fail++; fails.push(`${name}\n   got:  ${g}\n   want: ${w}`); }
}
function ok(name, cond, detail) {
  if (cond) pass++; else { fail++; fails.push(`${name}${detail ? '\n   ' + detail : ''}`); }
}

// Helper: place 1-indexed fixed-width fields into a line (mirrors fw()).
function fwLine(fields) { // fields: [{at, val}]  at = 1-indexed start
  let line = '';
  for (const { at, val } of fields) {
    const idx = at - 1;
    while (line.length < idx) line += ' ';
    line = line.slice(0, idx) + val + line.slice(idx + val.length);
  }
  return line;
}

// ----------------------------------------------------------------------------
// 1. CSV parsing
// ----------------------------------------------------------------------------
eq('CSV basic', H.parseCSV('a,b,c\n1,2,3\n'), [['a','b','c'],['1','2','3']]);
eq('CSV quoted comma', H.parseCSV('name,city\n"Carter, Riley",Raleigh\n'),
   [['name','city'],['Carter, Riley','Raleigh']]);
eq('CSV escaped quote', H.parseCSV('a\n"He said ""hi"""\n'), [['a'],['He said "hi"']]);
eq('CSV embedded newline', H.parseCSV('a,b\n"line1\nline2",x\n'), [['a','b'],['line1\nline2','x']]);
eq('CSV CRLF', H.parseCSV('a,b\r\n1,2\r\n'), [['a','b'],['1','2']]);
eq('CSV no trailing newline', H.parseCSV('a,b\n1,2'), [['a','b'],['1','2']]);
eq('CSV drops blank rows', H.parseCSV('a,b\n\n1,2\n,\n'), [['a','b'],['1','2']]);

// ----------------------------------------------------------------------------
// 2. Time formatting / parsing round-trips (the heart of result ingest)
// ----------------------------------------------------------------------------
eq('fmt 28.42', H.fmtTime('28.42'), '0:28.42');
eq('fmt course code Y', H.fmtTime('28.42Y'), '0:28.42');
eq('fmt colon', H.fmtTime('1:02.18'), '1:02.18');
eq('fmt colon course code', H.fmtTime('1:02.18 L'), '1:02.18');
eq('fmt 1:05 (no frac)', H.fmtTime('1:05'), '1:05.00');
eq('fmt 1:5 (single sec digit)', H.fmtTime('1:5'), '1:05.00');
eq('fmt tenths only', H.fmtTime('1:4.5'), '1:04.50');
eq('sec 28.42', H.timeToSeconds('28.42'), 28.42);
eq('sec 1:02.18', H.timeToSeconds('1:02.18'), 62.18);
eq('sec 1:05 == 65', H.timeToSeconds('1:05'), 65);
eq('sec course code', H.timeToSeconds('1:00.42Y'), 60.42);
ok('sec NS is NaN', Number.isNaN(H.timeToSeconds('NS')));
ok('sec DFS not mangled to number', Number.isNaN(H.timeToSeconds('DFS')));
// round-trip: format then re-parse must agree
for (const t of ['28.42','1:02.18','1:05','2:30.9','59.99','1:00.00']) {
  const a = H.timeToSeconds(t), b = H.timeToSeconds(H.fmtTime(t));
  ok(`roundtrip ${t}`, Math.abs(a-b) < 0.005, `${a} vs ${b}`);
}

// ----------------------------------------------------------------------------
// 3. Header alias mapping (SwimTopia column names)
// ----------------------------------------------------------------------------
const hdr = (h) => H.mapHeader(h);
eq('hdr Athlete Last Name', hdr('Athlete Last Name'), 'last');
eq('hdr Athlete First Name', hdr('Athlete First Name'), 'first');
eq('hdr converted_time', hdr('converted_time'), 'time');
eq('hdr original_time', hdr('original_time'), 'time');
eq('hdr swim_meet', hdr('swim_meet'), 'meet');
eq('hdr age_group', hdr('age_group'), 'agegroup');
eq('hdr Account Name', hdr('Account Name'), 'parent');
eq('hdr plain Email', hdr('Email'), 'email');
// "Parent 1 Email" is captured by ingestRows' /email/i column scan, not the alias map.
ok('Parent 1 Email matches email-column regex', /email/i.test('Parent 1 Email'));
eq('hdr Date of Birth', hdr('Date of Birth'), 'dob');
eq('hdr Group Name', hdr('Group Name'), 'group');

// ----------------------------------------------------------------------------
// 4. Name order flip ("Last, First" -> "First Last")
// ----------------------------------------------------------------------------
eq('name flip', H.fixNameOrder('Carter, Riley'), 'Riley Carter');
eq('name plain', H.fixNameOrder('Riley Carter'), 'Riley Carter');
eq('name extra spaces', H.fixNameOrder('  Carter ,  Riley '), 'Riley Carter');

// ----------------------------------------------------------------------------
// 5. Hy-Tek (.hy3) parsing — synthetic meet
// ----------------------------------------------------------------------------
// Layout per parseHy3: B1 name@3(45) date@93(8); D1 gender@3, code@4(5), last@9(20), first@29(20);
// E1 code@4(5), distance@16(6), stroke@22; E2 type@3, time@4(8), place@30(4), date@88(8)
const hy3 = [
  fwLine([{at:1,val:'B1'},{at:3,val:'Spring Invitational'},{at:93,val:'03142026'}]),
  fwLine([{at:1,val:'D1'},{at:3,val:'F'},{at:4,val:'00001'},{at:9,val:'Carter'},{at:29,val:'Riley'}]),
  fwLine([{at:1,val:'E1'},{at:4,val:'00001'},{at:16,val:'50'},{at:22,val:'1'}]),            // 50 Free
  fwLine([{at:1,val:'E2'},{at:3,val:'F'},{at:4,val:'28.42'},{at:30,val:'3'},{at:88,val:'03142026'}]),
  fwLine([{at:1,val:'E1'},{at:4,val:'00001'},{at:16,val:'100'},{at:22,val:'2'}]),           // 100 Back
  fwLine([{at:1,val:'E2'},{at:3,val:'P'},{at:4,val:'1:10.0'},{at:30,val:'5'}]),             // prelim
  fwLine([{at:1,val:'E2'},{at:3,val:'F'},{at:4,val:'1:08.55'},{at:30,val:'2'}]),            // final wins
  fwLine([{at:1,val:'D1'},{at:3,val:'M'},{at:4,val:'00002'},{at:9,val:'Nguyen'},{at:29,val:'Sam'}]),
  fwLine([{at:1,val:'E1'},{at:4,val:'00002'},{at:16,val:'50'},{at:22,val:'4'}]),            // 50 Fly
  fwLine([{at:1,val:'E2'},{at:3,val:'F'},{at:4,val:''},{at:30,val:''}]),                    // DQ (no time)
].join('\n');
const hy3rows = H.parseHy3(hy3);
eq('hy3 header', hy3rows[0], ['first','last','gender','event','distance','time','place','date','meet']);
// Riley 50 Free
const r1 = hy3rows.find(r => r[0]==='Riley' && r[3]==='50 Free');
ok('hy3 Riley 50 Free present', !!r1, JSON.stringify(hy3rows));
if (r1) {
  eq('hy3 Riley 50 Free time', r1[5], '28.42');
  eq('hy3 Riley 50 Free place', r1[6], '3');
  eq('hy3 Riley 50 Free gender', r1[2], 'F');
  eq('hy3 Riley 50 Free date', r1[7], '03/14/2026');
  eq('hy3 Riley 50 Free meet', r1[8], 'Spring Invitational');
}
// Riley 100 Back — final (1:08.55) must beat prelim (1:10.0)
const r2 = hy3rows.find(r => r[0]==='Riley' && r[3]==='100 Back');
ok('hy3 100 Back present', !!r2);
if (r2) eq('hy3 100 Back uses FINAL not prelim', r2[5], '1:08.55');
// Sam 50 Fly — DQ row (raced, no time)
const r3 = hy3rows.find(r => r[0]==='Sam' && r[3]==='50 Fly');
ok('hy3 Sam 50 Fly DQ present', !!r3, JSON.stringify(hy3rows));
if (r3) eq('hy3 Sam DQ time', r3[5], 'DQ');
// exactly one row per entry (3 entries -> 3 data rows)
eq('hy3 row count', hy3rows.length - 1, 3);

// ----------------------------------------------------------------------------
// 6. SDIF (.sd3) parsing — synthetic meet
// ----------------------------------------------------------------------------
// D0: name@12(28), gender@66, distance@68(4), stroke@72, date@81(8),
//     prelim@98(8), swimoff@107(8), finals@116(8), place(finals)@136(3)
const sd3 = [
  fwLine([{at:1,val:'B1'},{at:12,val:'Hurricane Classic'},{at:122,val:'04192026'}]),
  fwLine([{at:1,val:'D0'},{at:12,val:'Carter, Riley'},{at:66,val:'F'},{at:68,val:'50'},{at:72,val:'1'},
          {at:81,val:'04192026'},{at:116,val:'27.91'},{at:136,val:'2'}]),                 // 50 Free finals
  fwLine([{at:1,val:'D0'},{at:12,val:'Nguyen, Sam'},{at:66,val:'M'},{at:68,val:'100'},{at:72,val:'2'},
          {at:81,val:'04192026'},{at:98,val:'1:15.00'},{at:133,val:'4'}]),                // 100 Back prelim only
  fwLine([{at:1,val:'D0'},{at:12,val:'Empty, Entry'},{at:66,val:'M'},{at:68,val:'50'},{at:72,val:'3'}]), // no time -> skip
].join('\n');
const sd3rows = H.parseSd3(sd3);
eq('sd3 header', sd3rows[0], ['name','gender','event','distance','time','place','date','meet']);
const s1 = sd3rows.find(r => r[0].includes('Carter'));
ok('sd3 Carter present', !!s1, JSON.stringify(sd3rows));
if (s1) {
  eq('sd3 Carter event', s1[2], '50 Free');
  eq('sd3 Carter finals time', s1[4], '27.91');
  eq('sd3 Carter place', s1[5], '2');
  eq('sd3 Carter date', s1[6], '04/19/2026');
  eq('sd3 Carter meet', s1[7], 'Hurricane Classic');
}
const s2 = sd3rows.find(r => r[0].includes('Nguyen'));
ok('sd3 Nguyen prelim-only present', !!s2);
if (s2) eq('sd3 Nguyen uses prelim time', s2[4], '1:15.00');
eq('sd3 skips no-time entry', sd3rows.length - 1, 2);

// ----------------------------------------------------------------------------
// 7. parseResultsFile dispatch (extension + content sniffing)
// ----------------------------------------------------------------------------
ok('dispatch .hy3 by ext', H.parseResultsFile('meet.hy3', hy3) !== null);
ok('dispatch .sd3 by ext', H.parseResultsFile('meet.sd3', sd3) !== null);
ok('dispatch hy3 by sniff (no ext)', H.parseResultsFile('download', hy3) !== null);
ok('dispatch sd3 by sniff (no ext)', H.parseResultsFile('download', sd3) !== null);
ok('dispatch CSV returns null (not a results file)',
   H.parseResultsFile('roster.csv', 'name,event,time\nA,50 Free,28.0') === null);
// sniff picks the right one
const disp = H.parseResultsFile('x', hy3);
eq('sniffed hy3 has hy3 header', disp[0][0], 'first');

// ----------------------------------------------------------------------------
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('\nFAILURES:\n' + fails.map(f => '✗ ' + f).join('\n')); process.exit(1); }
else console.log('All import parser tests passed.');
