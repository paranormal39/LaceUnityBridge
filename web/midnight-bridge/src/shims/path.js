// Browser shim for Node.js path module
export function join(...args) {
  return args.join('/').replace(/\/+/g, '/');
}
export function dirname(p) {
  const parts = p.replace(/\\/g, '/').split('/');
  parts.pop();
  return parts.join('/') || '.';
}
export function basename(p, ext) {
  const base = p.replace(/\\/g, '/').split('/').pop();
  if (ext && base.endsWith(ext)) return base.slice(0, -ext.length);
  return base;
}
export function relative(from, to) {
  return to;
}
export function resolve(...args) {
  let result = '';
  for (const arg of args) {
    if (arg.startsWith('/')) result = arg;
    else result = join(result || '.', arg);
  }
  return result || '.';
}
export function extname(p) {
  const base = basename(p);
  const idx = base.lastIndexOf('.');
  return idx === -1 || idx === 0 ? '' : base.slice(idx);
}
export function isAbsolute(p) {
  return p.startsWith('/') || /^[a-zA-Z]:/.test(p);
}
export function normalize(p) {
  return p.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '') || '.';
}
export function parse(p) {
  const base = basename(p);
  const dir = dirname(p);
  const idx = base.lastIndexOf('.');
  const ext = idx === -1 || idx === 0 ? '' : base.slice(idx);
  const name = idx === -1 ? base : base.slice(0, idx);
  return { root: '', dir, base, ext, name };
}
export function format(obj) {
  return join(obj.dir || '', obj.base || '');
}
export default { join, dirname, basename, relative, resolve, extname, isAbsolute, normalize, parse, format, sep: '/', delimiter: ':' };
