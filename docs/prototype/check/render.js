// Renders a .dc.html artboard to plain HTML: renderVals() into {{holes}}, sc-for / sc-if expanded.
const fs = require('fs');
const [, , file, out] = process.argv;
const s = fs.readFileSync(file, 'utf8');
const xdc = s.slice(s.indexOf('<x-dc>') + 6, s.indexOf('</x-dc>'));
const helmet = (xdc.match(/<helmet>([\s\S]*?)<\/helmet>/) || [, ''])[1];
let tpl = xdc.replace(/<helmet>[\s\S]*?<\/helmet>/, '');
let js = s.slice(s.indexOf('data-props=')).replace(/^[^>]*>/, '').split('</script>')[0];
const Base = class { constructor(p) { this.props = p || {}; this.state = this.state || {}; } setState() {} forceUpdate() {} };
const C = new Function('DCLogic', 'performance', 'localStorage', js.replace('class Component extends DCLogic', 'return class Component extends DCLogic'))(Base, { now: () => 0 }, { getItem: () => null, setItem() {} });
const c = new C({}); const vals = c.renderVals ? c.renderVals() : {};
const get = (scopes, path) => { const parts = path.trim().split('.'); if (parts[0] === 'true') return true; if (parts[0] === 'false') return false;
  for (let i = scopes.length - 1; i >= 0; i--) if (parts[0] in scopes[i]) { let v = scopes[i]; for (const p of parts) v = v == null ? undefined : v[p]; return v; } return undefined; };
// find matching close tag for sc-for / sc-if starting at index i (after open tag)
function block(str, i, tag) { const re = new RegExp(`<${tag}\\b|</${tag}>`, 'g'); re.lastIndex = i; let d = 1, m; while ((m = re.exec(str))) { d += m[0][1] === '/' ? -1 : 1; if (!d) return [str.slice(i, m.index), m.index + m[0].length]; } throw new Error('unclosed ' + tag); }
function render(str, scopes) {
  let outS = '', i = 0; const re = /<sc-for\s+list="\{\{([^}]+)\}\}"\s+as="([^"]+)"[^>]*>|<sc-if\s+value="\{\{([^}]+)\}\}"[^>]*>/g; let m;
  while ((m = re.exec(str))) {
    outS += holes(str.slice(i, m.index), scopes);
    const tag = m[1] ? 'sc-for' : 'sc-if'; const [inner, end] = block(str, re.lastIndex, tag);
    if (m[1]) { const list = get(scopes, m[1]) || []; for (const it of list) outS += render(inner, [...scopes, { [m[2]]: it }]); }
    else if (get(scopes, m[3])) outS += render(inner, scopes);
    i = end; re.lastIndex = end;
  }
  return outS + holes(str.slice(i), scopes);
}
function holes(str, scopes) { return str.replace(/\{\{([^}]+)\}\}/g, (_, p) => { const v = get(scopes, p); return v == null ? '' : String(v); }); }
const body = render(tpl, [vals]);
fs.writeFileSync(out, `<!doctype html><html><head><meta charset="utf-8">${helmet}</head><body style="margin:0">${body}</body></html>`);
console.log('ok', out);
