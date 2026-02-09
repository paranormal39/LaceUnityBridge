# MeshJS Unity WebGL Bridge

Bundles MeshJS SDK for browser use in Unity WebGL, exposing `window.MeshSDK`.

## File Structure

```
web/mesh-bridge/
├── src/
│   └── mesh-unity-bridge.ts   # Entry point with exports
├── scripts/
│   └── copy-to-unity.js       # Copies bundle to Unity
├── build.mjs                  # esbuild configuration
├── package.json
├── tsconfig.json
└── dist/
    └── mesh-sdk.bundle.js     # Output bundle (11.5MB)
```

## Build Commands

```bash
cd web/mesh-bridge
npm install
npm run build           # Build only
npm run build:copy      # Build and copy to Unity
```

## Output Locations

After `npm run build:copy`, the bundle is copied to:
- `Assets/WebGLTemplates/MidnightTemplate/TemplateData/mesh-sdk.bundle.js`
- `Assets/Plugins/WebGL/mesh-sdk.bundle.js`

## Unity WebGL Template Integration

### Script Load Order in index.html

```html
<!-- 1. CBOR decoder -->
<script src="https://cdn.jsdelivr.net/npm/cbor-js@0.1.0/cbor.min.js"></script>

<!-- 2. libsodium (required by MeshJS) -->
<script src="https://cdn.jsdelivr.net/npm/libsodium-sumo@0.7.13/dist/modules-sumo/libsodium-sumo.js"></script>
<script src="https://cdn.jsdelivr.net/npm/libsodium-wrappers-sumo@0.7.13/dist/modules-sumo/libsodium-wrappers.js"></script>
<script>
  window.libsodiumReady = new Promise(function(resolve, reject) {
    if (typeof sodium !== 'undefined' && sodium.ready) {
      sodium.ready.then(function() {
        window.sodium = sodium;
        resolve(sodium);
      }).catch(reject);
    } else {
      resolve(null);
    }
  });
</script>

<!-- 3. MeshJS SDK bundle -->
<script src="TemplateData/mesh-sdk.bundle.js"></script>

<!-- 4. Unity loader (last) -->
<script src="Build/{{{ LOADER_FILENAME }}}"></script>
```

## Exposed Globals

| Global | Type | Description |
|--------|------|-------------|
| `window.MeshSDK` | Object | All MeshJS exports |
| `window.MeshSDKReady` | Boolean | True when fully initialized |
| `window.MeshSDKReadyPromise` | Promise | Resolves when ready |
| `window.MeshSDKError` | String? | Error message if init failed |

## Available Exports

```javascript
window.MeshSDK = {
  // Providers
  BlockfrostProvider,
  
  // Transaction building
  MeshTxBuilder,
  
  // Address utilities
  deserializeAddress,
  serializeAddressObj,
  resolveScriptHash,
  resolvePlutusScriptAddress,
  resolvePaymentKeyHash,
  resolveStakeKeyHash,
  
  // Data construction (Plutus datums/redeemers)
  mConStr0,
  mConStr1,
  mConStr,
  stringToHex,
  hexToString,
  
  // Metadata
  version: '1.0.0',
  buildTime: '...'
};
```

## Usage in .jslib

```javascript
// In MidnightWebGL.jslib
MeshIncrementCounter: function(...) {
  (async function() {
    // Wait for SDK to be ready
    await window.MeshSDKReadyPromise;
    
    if (!window.MeshSDK) {
      throw new Error("MeshSDK not loaded");
    }
    
    var SDK = window.MeshSDK;
    var provider = new SDK.BlockfrostProvider(blockfrostKey);
    var txBuilder = new SDK.MeshTxBuilder({ fetcher: provider });
    
    // Build transaction...
  })();
}
```

## Console Validation

Run these in browser console after page loads:

```javascript
// Check MeshSDK loaded
typeof window.MeshSDK
// Expected: "object"

// Check ready state
window.MeshSDKReady
// Expected: true

// List exports
Object.keys(window.MeshSDK)
// Expected: ["BlockfrostProvider", "MeshTxBuilder", ...]

// Check BlockfrostProvider
typeof window.MeshSDK.BlockfrostProvider
// Expected: "function"

// Check MeshTxBuilder
typeof window.MeshSDK.MeshTxBuilder
// Expected: "function"
```

## Troubleshooting

### "Dynamic require of 'crypto' is not supported"
- The bundle aliases `crypto` to `crypto-browserify`
- If this error appears, rebuild with `npm run build`

### "libsodium was not correctly initialized"
- Ensure libsodium CDN scripts load BEFORE mesh-sdk.bundle.js
- Check that `window.libsodiumReady` promise resolves

### "MeshSDK is undefined"
- Check browser console for script loading errors
- Verify mesh-sdk.bundle.js is in TemplateData/
- Check network tab for 404 errors

### Bundle too large
- Current size: ~11.5MB (unminified for debugging)
- To minify, set `minify: true` in build.mjs
- Expected minified size: ~4-5MB

## Architecture Notes

### Why libsodium is external
The `libsodium-wrappers-sumo` npm package has broken ESM exports (empty dist folders).
Loading from CDN is more reliable and allows caching across page loads.

### Why esbuild instead of Vite
Vite's library mode had issues with:
- WASM module resolution
- libsodium ESM imports
- Node polyfill ordering

esbuild handles these edge cases better with explicit configuration.

### Buffer Polyfill
A custom Buffer polyfill with hex encoding support is injected as a banner.
This is required because `@cardano-sdk` uses `Buffer.from(hex, 'hex')` at module load time.
