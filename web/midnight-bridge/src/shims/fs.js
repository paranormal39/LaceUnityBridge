// Browser shim for Node.js fs module
// Used by @midnight-ntwrk/midnight-js-contracts and wasm-bindgen _fs entry files
export function readFileSync() { throw new Error('fs.readFileSync not available in browser'); }
export function readFile() { throw new Error('fs.readFile not available in browser'); }
export function existsSync() { return false; }
export function readdirSync() { return []; }
export function statSync() { throw new Error('fs.statSync not available in browser'); }
export function mkdirSync() { throw new Error('fs.mkdirSync not available in browser'); }
export function writeFileSync() { throw new Error('fs.writeFileSync not available in browser'); }
export default { readFileSync, readFile, existsSync, readdirSync, statSync, mkdirSync, writeFileSync };
