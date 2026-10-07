// Static check of a .dc.html artboard: every {{hole}} in the template must resolve in renderVals() output,
// inside sc-for scopes too, across several UI states. Also drives a few gestures to catch runtime errors.
const fs = require('fs');
const file = process.argv[2];
const s = fs.readFileSync(file, 'utf8');
const tpl = s.slice(s.indexOf('<x-dc>'), s.indexOf('</x-dc>'));
let js = s.slice(s.indexOf('data-props=')).replace(/^[^>]*>/, '').split('</script>')[0];
const store = {};
const ls = { getItem: k => store[k] || null, setItem: (k, v) => { store[k] = v; } };
global.requestAnimationFrame = () => 0; global.document = { elementFromPoint: () => null };
const Base = class { constructor(p) { this.props = p || {}; } setState(o) { Object.assign(this.state, typeof o === 'function' ? o(this.state) : o); } forceUpdate() {} };
const C = new Function('DCLogic', 'performance', 'localStorage', js.replace('class Component extends DCLogic', 'return class Component extends DCLogic'))(Base, { now: () => Date.now() }, ls);
const c = new C({});
const R = { left: 0, top: 0, right: 1440, bottom: 900, width: 1440, height: 900 };
c.root = { getBoundingClientRect: () => R, focus() {}, querySelector() { return null; }, addEventListener() {}, removeEventListener() {} };
if (c.componentDidMount) { try { c.componentDidMount(); } catch (e) { console.log('componentDidMount threw:', e.message); } }

// walk the template: track sc-for scopes
function check(vals, label) {
  // sc-for opens a scope over its items; sc-if narrows the items of the scope it refers to (or, for a top-level
  // value, switches the region off when falsy) — holes are checked only where they would be rendered
  const re = /<sc-for\s+list="\{\{([^}]+)\}\}"\s+as="([^"]+)"|<\/sc-for>|<sc-if\s+value="\{\{([^}]+)\}\}"[^>]*>|<\/sc-if>|\{\{([^}]+)\}\}/g;
  let m; const missing = new Set(); const stack = [];   // entries: {kind:'for', name, items} | {kind:'if', saved}
  const get = (o, parts) => { let v = o; for (const p of parts) { if (v == null) return undefined; v = v[p]; } return v; };
  const scopes = () => stack.filter(x => x.kind === 'for');
  const off = () => stack.some(x => x.kind === 'if' && x.off);
  function resolve(path) {
    const parts = path.trim().split('.');
    if (parts[0] === 'true' || parts[0] === 'false') return { ok: true };
    const sc = scopes();
    for (let i = sc.length - 1; i >= 0; i--) if (sc[i].name === parts[0]) return { scope: sc[i], rest: parts.slice(1) };
    return { top: get(vals, parts) };
  }
  while ((m = re.exec(tpl))) {
    if (m[1]) {
      const r = resolve(m[1]); let items;
      if (r.scope) { items = []; r.scope.items.forEach(it => { const v = get(it, r.rest); if (Array.isArray(v)) items.push(...v); }); }
      else { items = Array.isArray(r.top) ? r.top : null; if (items === null && !off()) missing.add('LIST ' + m[1].trim()); }
      stack.push({ kind: 'for', name: m[2], items: items || [] });
    } else if (m[0] === '</sc-for>') { while (stack.length && stack[stack.length - 1].kind !== 'for') stack.pop(); stack.pop(); }
    else if (m[3]) {
      const r = resolve(m[3]);
      if (r.scope) { const saved = r.scope.items; r.scope.items = saved.filter(it => get(it, r.rest)); stack.push({ kind: 'if', scope: r.scope, saved }); }
      else stack.push({ kind: 'if', off: !r.ok && !r.top });
    } else if (m[0] === '</sc-if>') { const e = stack.pop(); if (e && e.scope) e.scope.items = e.saved; }
    else if (m[4] && !off()) {
      const r = resolve(m[4]);
      if (r.ok) continue;
      if (r.scope) { if (r.scope.items.length && !r.scope.items.every(it => get(it, r.rest) !== undefined)) missing.add(m[4].trim() + ' (in ' + r.scope.name + ')'); }
      else if (r.top === undefined) missing.add(m[4].trim());
    }
  }
  console.log(label.padEnd(28), missing.size ? 'MISSING: ' + [...missing].join(', ') : 'all holes resolve');
}
function rv(label) { try { check(c.renderVals(), label); } catch (e) { console.log(label.padEnd(28), 'renderVals THREW:', e.stack.split('\n').slice(0, 2).join(' | ')); } }
module.exports = { c, rv, R };
if (require.main === module) rv('default');
