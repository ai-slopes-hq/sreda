// Repeated STACK / FIX on a frame must keep the margins: FIX = 32 px channels around and between modules,
// STACK = 16 px padding, flush between modules; nothing overlaps, and repeating a press changes nothing.
const { c } = require("./holes.js");
const S = c.state;
function place(type, x, y) { c.setState({ search: { sx: 0, sy: 0, cx: x, cy: y, from: null, q: '', idx: 0, tab: 'MODULES' } }); c.place(type); return c.state.doc.mods[c.state.doc.mods.length - 1].id; }
c.newSeed();
const a = place('chance', 0, 0), b = place('spread', 300, 0), d = place('att', 0, 300);
c.setState({ sel: [a, b, d] }); c.group();
const gid = c.state.doc.groups[0].id;
const SZ = { chance: [3, 1], spread: [4, 2], att: [6, 2] };   // a panel is exactly n × 1U (144 px) high
function report(label) {
  const doc = c.state.doc, g = doc.groups.find(x => x.id === gid);
  const R = doc.mods.map(m => ({ t: m.type, x: m.x, y: m.y, w: SZ[m.type][0] * 56, h: SZ[m.type][1] * 144 }));
  let minGap = 1e9, ov = 0;
  for (let i = 0; i < R.length; i++) for (let j = i + 1; j < R.length; j++) {
    const p = R[i], q = R[j]; const gx = Math.max(q.x - (p.x + p.w), p.x - (q.x + q.w)), gy = Math.max(q.y - (p.y + p.h), p.y - (q.y + q.h));
    if (gx < 0 && gy < 0) ov++; else minGap = Math.min(minGap, Math.max(gx, gy));
  }
  const left = Math.min(...R.map(r => r.x)) - g.x, top = Math.min(...R.map(r => r.y)) - (g.y + 28), right = g.x + g.w - Math.max(...R.map(r => r.x + r.w)), bottom = g.y + g.h - Math.max(...R.map(r => r.y + r.h));
  console.log(label.padEnd(16), g.layout.padEnd(5), 'margins L/T/R/B', left, top, right, bottom, ' min gap', minGap, ' overlaps', ov, ' frame', g.w + '×' + g.h);
}
report('framed (G)');
for (let i = 0; i < 3; i++) { c.frameStack(gid); report('STACK ' + (i + 1)); }
for (let i = 0; i < 4; i++) { c.frameRoute(gid); report('FIX ' + (i + 1)); }
for (let i = 0; i < 3; i++) { c.frameStack(gid); report('STACK again ' + (i + 1)); c.frameRoute(gid); report('FIX again ' + (i + 1)); }
