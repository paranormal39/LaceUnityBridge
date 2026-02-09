/**
 * CSL Loader for Unity WebGL
 * 
 * Loads cardano-serialization-lib 12.1.0 WASM properly in browser.
 * Fetches WASM, instantiates it, and injects into the bundled JS glue code.
 */
(async function() {
  'use strict';
  
  const WASM_PATH = 'TemplateData/cardano_serialization_lib_bg.wasm';
  
  console.log('[CSL Loader] Starting CSL 12.1.0 initialization...');
  
  try {
    // Check if CardanoWasm bundle is loaded
    if (typeof CardanoWasm === 'undefined') {
      throw new Error('CardanoWasm not found. Ensure csl.bundle.js is loaded first.');
    }
    
    // Fetch the WASM file
    console.log('[CSL Loader] Fetching WASM from:', WASM_PATH);
    const wasmResponse = await fetch(WASM_PATH);
    
    if (!wasmResponse.ok) {
      throw new Error('Failed to fetch WASM: ' + wasmResponse.status + ' ' + wasmResponse.statusText);
    }
    
    const wasmBytes = await wasmResponse.arrayBuffer();
    console.log('[CSL Loader] WASM loaded, size:', wasmBytes.byteLength, 'bytes');
    
    // Verify WASM size matches CSL 12.1.0 (approximately 2.7MB)
    if (wasmBytes.byteLength < 2000000) {
      console.warn('[CSL Loader] WARNING: WASM file seems too small, may be wrong version');
    }
    
    // Build the imports object that wasm-bindgen expects
    // The bundle has __wbg_* functions that need to be passed to WASM
    const imports = {};
    
    // Collect all __wbg_* and __wbindgen_* functions from CardanoWasm
    const wasmImports = {};
    for (const key of Object.keys(CardanoWasm)) {
      if (key.startsWith('__wbg_') || key.startsWith('__wbindgen_')) {
        wasmImports[key] = CardanoWasm[key];
      }
    }
    imports['./cardano_serialization_lib_bg.js'] = wasmImports;
    
    console.log('[CSL Loader] Found', Object.keys(wasmImports).length, 'WASM import functions');
    
    // Instantiate WASM
    let wasmInstance;
    if (typeof WebAssembly.instantiateStreaming === 'function' && wasmResponse.headers) {
      // Can't use streaming since we already consumed the response
      const result = await WebAssembly.instantiate(wasmBytes, imports);
      wasmInstance = result.instance;
    } else {
      const result = await WebAssembly.instantiate(wasmBytes, imports);
      wasmInstance = result.instance;
    }
    
    console.log('[CSL Loader] WASM instantiated');
    
    // Set the WASM instance in the glue code
    if (typeof CardanoWasm.__wbg_set_wasm === 'function') {
      CardanoWasm.__wbg_set_wasm(wasmInstance.exports);
      console.log('[CSL Loader] WASM exports injected via __wbg_set_wasm');
    } else {
      console.error('[CSL Loader] __wbg_set_wasm not found in CardanoWasm');
      throw new Error('Cannot inject WASM - __wbg_set_wasm not found');
    }
    
    // Expose globally
    window.CSL = CardanoWasm;
    window.CardanoSerializationLib = CardanoWasm;
    window.CSLReady = true;
    
    // Verify it works
    try {
      const testAddr = CardanoWasm.Address.from_bech32('addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj83ws8lhrn648jjxtwq2ytjqp');
      console.log('[CSL Loader] ✓ CSL 12.1.0 initialized and verified!');
      console.log('[CSL Loader] Sample exports:', Object.keys(CardanoWasm).filter(function(k) { return !k.startsWith('__'); }).slice(0, 10));
    } catch (e) {
      console.error('[CSL Loader] CSL verification failed:', e.message);
      throw e;
    }
    
    // Dispatch ready event
    window.dispatchEvent(new Event('csl-ready'));
    
  } catch (err) {
    console.error('[CSL Loader] Failed to initialize CSL:', err);
    window.CSLError = err.message;
  }
})();
