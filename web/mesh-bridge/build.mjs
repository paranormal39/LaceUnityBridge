import * as esbuild from 'esbuild';
import { createRequire } from 'module';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

// Plugin to properly handle wasm-bindgen WASM files
const wasmBindgenPlugin = {
  name: 'wasm-bindgen',
  setup(build) {
    build.onLoad({ filter: /\.wasm$/ }, async (args) => {
      const wasmBuffer = readFileSync(args.path);
      const base64 = wasmBuffer.toString('base64');
      const wasmPath = args.path.replace(/\\/g, '/');
      const wasmName = wasmPath.split('/').pop().replace('.wasm', '');
      
      // Generate async initialization code for wasm-bindgen modules
      const contents = `
// WASM module: ${wasmName}
const __wasm_base64 = "${base64}";

function __decode_base64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

const __wasm_bytes = __decode_base64(__wasm_base64);

// Create a deferred WASM module that will be initialized
let __wasm_module = null;
let __wasm_instance = null;
let __wasm_memory = null;

// Placeholder exports that will be populated after init
const __exports = {
  __wasm_initialized: false,
  memory: null,
};

// Create proxy that waits for initialization
const __proxy = new Proxy(__exports, {
  get(target, prop) {
    if (prop === '__wasm_initialized' || prop === 'memory') {
      return target[prop];
    }
    if (__wasm_instance && __wasm_instance.exports[prop]) {
      return __wasm_instance.exports[prop];
    }
    // Return a function that throws if WASM not ready
    return function(...args) {
      if (!__wasm_instance) {
        throw new Error('WASM not initialized. Call initWasm() first.');
      }
      return __wasm_instance.exports[prop](...args);
    };
  }
});

// Async init function
async function __init_wasm(imports) {
  if (__wasm_instance) return __wasm_instance.exports;
  
  const wasmModule = await WebAssembly.compile(__wasm_bytes);
  __wasm_instance = await WebAssembly.instantiate(wasmModule, imports || {});
  __wasm_memory = __wasm_instance.exports.memory;
  __exports.memory = __wasm_memory;
  __exports.__wasm_initialized = true;
  
  return __wasm_instance.exports;
}

// Try sync init for smaller modules
try {
  if (__wasm_bytes.length < 4 * 1024 * 1024) { // < 4MB
    const mod = new WebAssembly.Module(__wasm_bytes);
    // Can't instantiate without proper imports, skip sync init
  }
} catch (e) {
  // Sync compilation not supported or module too large
}

export default __proxy;
export { __init_wasm as initWasm };
`;
      
      return { contents, loader: 'js' };
    });
  }
};

// Buffer polyfill banner with full hex support
const bufferBanner = `
(function() {
  function hexToBytes(hex) {
    if (hex.length % 2 !== 0) hex = '0' + hex;
    var bytes = new Uint8Array(hex.length / 2);
    for (var i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return bytes;
  }
  function bytesToHex(bytes) {
    var hex = '';
    for (var i = 0; i < bytes.length; i++) {
      hex += bytes[i].toString(16).padStart(2, '0');
    }
    return hex;
  }
  function createBuffer(arr) {
    arr._isBuffer = true;
    arr.toString = function(enc) {
      if (enc === 'hex') return bytesToHex(this);
      return new TextDecoder().decode(this);
    };
    arr.slice = function(s, e) { return createBuffer(new Uint8Array(this.buffer, this.byteOffset + (s||0), (e||this.length) - (s||0))); };
    arr.subarray = function(s, e) { return createBuffer(Uint8Array.prototype.subarray.call(this, s, e)); };
    arr.copy = function(t, ts, ss, se) { ts=ts||0; ss=ss||0; se=se||this.length; for(var i=ss;i<se;i++) t[ts+i-ss]=this[i]; };
    arr.readUInt8 = function(o) { return this[o]; };
    arr.readUInt16BE = function(o) { return (this[o]<<8)|this[o+1]; };
    arr.readUInt32BE = function(o) { return (this[o]<<24)|(this[o+1]<<16)|(this[o+2]<<8)|this[o+3]; };
    arr.writeUInt8 = function(v,o) { this[o]=v&0xff; };
    return arr;
  }
  var B = {
    isBuffer: function(o) { return o && o._isBuffer === true; },
    from: function(d, enc) {
      var a;
      if (typeof d === 'string') {
        if (enc === 'hex') a = hexToBytes(d);
        else if (enc === 'base64') { var b = atob(d); a = new Uint8Array(b.length); for(var i=0;i<b.length;i++) a[i]=b.charCodeAt(i); }
        else a = new TextEncoder().encode(d);
      } else if (d instanceof ArrayBuffer) a = new Uint8Array(d);
      else if (ArrayBuffer.isView(d)) a = new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
      else if (Array.isArray(d)) a = new Uint8Array(d);
      else a = new Uint8Array(0);
      return createBuffer(a);
    },
    alloc: function(s,f) { var a = new Uint8Array(s); if(f!==undefined) a.fill(typeof f==='number'?f:0); return createBuffer(a); },
    allocUnsafe: function(s) { return createBuffer(new Uint8Array(s)); },
    concat: function(l,len) { if(!l.length) return createBuffer(new Uint8Array(0)); if(len===undefined) { len=0; for(var i=0;i<l.length;i++) len+=l[i].length; } var r=new Uint8Array(len),o=0; for(var i=0;i<l.length;i++) { r.set(l[i],o); o+=l[i].length; } return createBuffer(r); },
    byteLength: function(s,e) { if(e==='hex') return s.length/2; return new TextEncoder().encode(s).length; }
  };
  if(typeof globalThis.Buffer==='undefined') globalThis.Buffer = B;
  if(typeof window!=='undefined' && typeof window.Buffer==='undefined') window.Buffer = B;
  if(typeof globalThis.process==='undefined') globalThis.process = { env:{NODE_ENV:'production'}, browser:true, nextTick:function(fn){Promise.resolve().then(fn);}, version:'v16.0.0' };
  if(typeof window!=='undefined' && typeof window.process==='undefined') window.process = globalThis.process;
  if(typeof globalThis.global==='undefined') globalThis.global = globalThis;
})();
`;

console.log('Building MeshSDK bundle...');

try {
  const result = await esbuild.build({
    entryPoints: ['src/mesh-unity-bridge.ts'],
    bundle: true,
    format: 'iife',
    globalName: 'MeshSDKBundle',
    outfile: 'dist/mesh-sdk.bundle.js',
    platform: 'browser',
    target: 'es2020',
    minify: false,
    sourcemap: true,
    define: {
      'process.env.NODE_ENV': '"production"',
      'global': 'globalThis',
    },
    alias: {
      'crypto': require.resolve('crypto-browserify'),
      'stream': require.resolve('stream-browserify'),
      'buffer': require.resolve('buffer/'),
      'events': require.resolve('events/'),
    },
    plugins: [wasmExternalPlugin],
    banner: {
      js: bufferBanner,
    },
    // Mark libsodium as external - we'll load it from CDN
    external: ['libsodium-wrappers-sumo', 'libsodium-sumo', 'libsodium-wrappers', 'libsodium'],
    logLevel: 'info',
  });

  console.log('Build complete!');
  console.log('Output:', join(__dirname, 'dist', 'mesh-sdk.bundle.js'));

} catch (error) {
  console.error('Build failed:', error);
  process.exit(1);
}
