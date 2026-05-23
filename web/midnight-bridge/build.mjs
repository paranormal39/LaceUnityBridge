import * as esbuild from 'esbuild';
import { createRequire } from 'module';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Recursively find all .js files in a directory
 */
function findJsFiles(dir, base = dir) {
  const results = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...findJsFiles(full, base));
    } else if (entry.endsWith('.js')) {
      results.push({ path: full, rel: './' + relative(base, full).replace(/\\/g, '/') });
    }
  }
  return results;
}

// Plugin to handle wasm-bindgen WASM modules for browser bundling.
//
// wasm-bindgen entry files (e.g. midnight_ledger_wasm.js) do:
//   import * as wasm from "./xxx_bg.wasm";
//   import { __wbg_set_wasm } from "./xxx_bg.js";
//   __wbg_set_wasm(wasm);
//   wasm.__wbindgen_start();
//
// This fails in a browser bundle because the .wasm import returns a proxy
// that doesn't have exports ready synchronously.
//
// Fix: intercept the wasm-bindgen entry files and rewrite them to do
// async WASM init. Also intercept .wasm files to inline as base64.
const wasmBindgenPlugin = {
  name: 'wasm-bindgen-browser',
  setup(build) {
    // 1) Intercept wasm-bindgen entry files (xxx_wasm.js that import .wasm)
    //    and rewrite them to do async init.
    build.onLoad({ filter: /midnight_\w+_wasm\.js$/ }, async (args) => {
      const src = readFileSync(args.path, 'utf8');
      // Only rewrite if this is a wasm-bindgen entry (has the characteristic pattern)
      if (!src.includes('__wbg_set_wasm') || !src.includes('__wbindgen_start')) {
        return undefined; // let esbuild handle normally
      }

      // Extract the bg.wasm and bg.js paths from the source
      const wasmImportMatch = src.match(/from\s+["'](\.[^"']+_bg\.wasm)["']/);
      const bgJsImportMatch = src.match(/from\s+["'](\.[^"']+_bg\.js)["']/);

      if (!wasmImportMatch || !bgJsImportMatch) {
        return undefined;
      }

      const wasmPath = wasmImportMatch[1];
      const bgJsPath = bgJsImportMatch[1];
      const moduleName = args.path.replace(/\\/g, '/').split('/').pop().replace('.js', '');

      console.log(`  [wasm-bindgen] Rewriting ${moduleName} for async browser init`);

      // Find snippet files in the package's snippets directory
      const pkgDir = dirname(args.path);
      const snippetsDir = join(pkgDir, 'snippets');
      const snippetFiles = findJsFiles(snippetsDir, pkgDir);
      
      // Build snippet module code - each snippet exports functions that need wasm
      // Snippets use `import * as wasm from '#self'` which we replace with our exports
      let snippetCode = '';
      let snippetImportsCode = '';
      
      for (const snippet of snippetFiles) {
        const snippetSrc = readFileSync(snippet.path, 'utf8');
        // Replace '#self' import with a reference to our wasm exports
        // The snippet pattern is: import * as wasm from '#self'; export function Foo() { return wasm.Foo; }
        const sanitizedName = snippet.rel.replace(/[^a-zA-Z0-9]/g, '_');
        
        // Extract the export functions from the snippet
        const exportMatches = snippetSrc.matchAll(/export\s+function\s+(\w+)\s*\(\s*\)\s*\{\s*return\s+wasm\.(\w+);\s*\}/g);
        const exports = [...exportMatches];
        
        if (exports.length > 0) {
          // Generate a snippet module object that references wasm exports
          snippetCode += `
// Snippet: ${snippet.rel}
const ${sanitizedName} = {
${exports.map(m => `  ${m[1]}: function() { return __bg.${m[2]}; }`).join(',\n')}
};
`;
          snippetImportsCode += `  imports['${snippet.rel}'] = ${sanitizedName};\n`;
        }
      }
      
      console.log(`  [wasm-bindgen] Found ${snippetFiles.length} snippet files for ${moduleName}`);

      // Rewrite: export everything from _bg.js, but replace the sync init
      // with an async init that compiles+instantiates the WASM properly.
      const contents = `
// Rewritten wasm-bindgen entry: ${moduleName}
// Original did sync init which crashes in browser bundles.
// This version does async init with base64-inlined WASM.

export * from "${bgJsPath}";
import { __wbg_set_wasm } from "${bgJsPath}";
import * as __bg from "${bgJsPath}";

// Import the inlined WASM bytes (handled by the .wasm loader below)
import { __wasm_bytes, __wasm_base64_ready } from "${wasmPath}";

let __wasm_initialized = false;
let __wasm_init_promise = null;
let __wasm_init_error = null;
let __wasm_exports = null;

${snippetCode}

// Build the wasm-bindgen import object from the _bg.js exports + snippets
function __build_imports() {
  const imports = { './${moduleName}_bg.js': {} };
  for (const key of Object.keys(__bg)) {
    if (key.startsWith('__wbg_') || key.startsWith('__wbindgen_')) {
      imports['./${moduleName}_bg.js'][key] = __bg[key];
    }
  }
${snippetImportsCode}
  return imports;
}

function __init() {
  if (__wasm_initialized) return;
  if (__wasm_init_promise) return __wasm_init_promise;

  const isLarge = __wasm_bytes.length >= 4 * 1024 * 1024;

  if (isLarge) {
    // Async init for large WASM (>4MB safety threshold).
    // Chrome blocks sync WebAssembly.Module() on the main thread for >8MB.
    // The esm wrapper ignores the returned promise; waitForWasmInit() awaits it later.
    __wasm_init_promise = (async () => {
      try {
        const imports = __build_imports();
        const mod = await WebAssembly.compile(__wasm_bytes);
        const instance = await WebAssembly.instantiate(mod, imports);
        __wasm_exports = instance.exports;
        __wbg_set_wasm(instance.exports);
        if (typeof instance.exports.__wbindgen_start === 'function') {
          instance.exports.__wbindgen_start();
        }
        __wasm_initialized = true;
        console.log('[wasm-bindgen] ${moduleName} initialized successfully');
      } catch (e) {
        __wasm_init_error = e;
        console.error('[wasm-bindgen] ${moduleName} init failed:', e);
        throw e;
      }
    })();
  } else {
    // Sync init for small WASM — safe on main thread, needed because some
    // esm modules (e.g. constants.js) synchronously access exports after init.
    try {
      const imports = __build_imports();
      const mod = new WebAssembly.Module(__wasm_bytes);
      const instance = new WebAssembly.Instance(mod, imports);
      __wasm_exports = instance.exports;
      __wbg_set_wasm(instance.exports);
      if (typeof instance.exports.__wbindgen_start === 'function') {
        instance.exports.__wbindgen_start();
      }
      __wasm_initialized = true;
      console.log('[wasm-bindgen] ${moduleName} initialized successfully');
    } catch (e) {
      __wasm_init_error = e;
      console.error('[wasm-bindgen] ${moduleName} init failed:', e);
      throw e;
    }
  }
  return __wasm_init_promise;
}

// Auto-init and export the promise for external await
__init();

// Export the init promise so callers can await WASM readiness
export const __wasm_ready = __wasm_init_promise;
export function isWasmReady() { return __wasm_initialized; }
`;
      return { contents, loader: 'js', resolveDir: dirname(args.path) };
    });

    // 2) Intercept .wasm files: inline as base64 bytes
    build.onLoad({ filter: /\.wasm$/ }, async (args) => {
      const wasmBuffer = readFileSync(args.path);
      const base64 = wasmBuffer.toString('base64');
      const contents = `
// Inlined WASM: ${args.path.replace(/\\/g, '/').split('/').pop()}
const __b64 = "${base64}";
function __decode(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
export const __wasm_bytes = __decode(__b64);
export const __wasm_base64_ready = true;
// Default export for any other importers
export default __wasm_bytes;
`;
      return { contents, loader: 'js' };
    });
  }
};

// Buffer polyfill banner (same pattern as mesh-bridge)
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

console.log('Building Midnight SDK bundle...');

try {
  const result = await esbuild.build({
    entryPoints: ['src/midnight-unity-bridge.ts'],
    bundle: true,
    format: 'iife',
    globalName: 'MidnightSDKBundle',
    outfile: 'dist/midnight-sdk.bundle.js',
    platform: 'browser',
    target: 'es2020',
    minify: false,
    sourcemap: true,
    define: {
      'process.env.NODE_ENV': '"production"',
      'global': 'globalThis',
    },
    alias: {
      'stream': 'stream-browserify',
      'buffer': 'buffer/',
      'events': 'events/',
      'fs': __dirname.replace(/\\/g, '/') + '/src/shims/fs.js',
      'path': __dirname.replace(/\\/g, '/') + '/src/shims/path.js',
      'assert': __dirname.replace(/\\/g, '/') + '/src/shims/assert.js',
      // Full Node-crypto polyfill for the browser. Provides createHash, createHmac,
      // pbkdf2Sync, createCipheriv, createDecipheriv, randomBytes, etc. Required by
      // @midnight-ntwrk/midnight-js-level-private-state-provider for storage encryption.
      'crypto': 'crypto-browserify',
    },
    banner: {
      js: bufferBanner,
    },
    plugins: [wasmBindgenPlugin],
    logLevel: 'info',
  });

  console.log('Build complete!');
  console.log('Output:', join(__dirname, 'dist', 'midnight-sdk.bundle.js'));

} catch (error) {
  console.error('Build failed:', error);

  // If the full bundle fails, try a lightweight build without the heavy providers
  console.log('\nAttempting lightweight build (connector-only, no provider deps)...');

  try {
    const lightResult = await esbuild.build({
      entryPoints: ['src/midnight-unity-bridge.ts'],
      bundle: true,
      format: 'iife',
      globalName: 'MidnightSDKBundle',
      outfile: 'dist/midnight-sdk.bundle.js',
      platform: 'browser',
      target: 'es2020',
      minify: false,
      sourcemap: true,
      define: {
        'process.env.NODE_ENV': '"production"',
        'global': 'globalThis',
      },
      alias: {
        'stream': 'stream-browserify',
        'buffer': 'buffer/',
        'events': 'events/',
        'fs': __dirname.replace(/\\/g, '/') + '/src/shims/fs.js',
        'path': __dirname.replace(/\\/g, '/') + '/src/shims/path.js',
        'assert': __dirname.replace(/\\/g, '/') + '/src/shims/assert.js',
        'crypto': 'crypto-browserify',
      },
      banner: {
        js: bufferBanner,
      },
      plugins: [wasmBindgenPlugin],
      // Mark the heavy midnight packages as external for the fallback build
      external: [
        '@meshsdk/midnight-setup',
        '@midnight-ntwrk/midnight-js-fetch-zk-config-provider',
        '@midnight-ntwrk/midnight-js-http-client-proof-provider',
        '@midnight-ntwrk/midnight-js-indexer-public-data-provider',
        '@midnight-ntwrk/midnight-js-level-private-state-provider',
        '@midnight-ntwrk/midnight-js-network-id',
      ],
      logLevel: 'info',
    });

    console.log('Lightweight build complete! (provider imports will fail at runtime but connector works)');
    console.log('Output:', join(__dirname, 'dist', 'midnight-sdk.bundle.js'));

  } catch (lightError) {
    console.error('Lightweight build also failed:', lightError);
    process.exit(1);
  }
}
