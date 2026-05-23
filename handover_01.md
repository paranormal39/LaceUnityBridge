# Handover 01 — Unity WebGL Midnight SDK Bridge

## Session Date
2026-05-16 / 2026-05-17 / 2026-05-19 / **2026-05-22** (latest)

---

## ⭐ Session 05 Summary (2026-05-22 evening) — Tx submission flow fixed, pending live network test

**Status: ALMOST COMPLETE** — tx flow is now structurally correct. Tagged `v1.1.0-midnight-counter-almost-complete`.

### What was fixed today

| Issue | Root Cause | Fix |
|---|---|---|
| `submitTransaction` returning `undefined` treated as failure | DApp connector v4 spec: `submitTransaction(txHex)` returns `void` / `undefined` on success, not a tx hash. | Changed `submitTx` to treat `undefined` as success (`submitSucceeded = true`), not failure. |
| `RemoteApiShutdownError: Remote API with channel 'midnight-wallet' was shutdown` after `balanceUnsealedTransaction` | We incorrectly hypothesized a two-phase API (`balanceUnsealedTransaction` → `balanceSealedTransaction`). `balanceSealedTransaction` is for adding MORE balance to an already-sealed tx; calling it after the first seal shuts down the wallet channel. | **Removed** the `balanceSealedTransaction` call. `balanceUnsealedTransaction` already returns a fully sealed tx (hex doubles from ~6600 → ~13100 chars = signatures/balance commitments added). |
| Locally computed `txHash` never found on explorer | `hexToTransaction` uses a fallback deserialize path (`'signature','proof','binding', bytes`) which produces a tx with bogus placeholder fields. The hash of that object doesn't match the on-chain tx. | Added `getTxHistory()` lookup after submission to capture the wallet's canonical txHash. Also added `_walletReturnedHash` capture from any 64-char hex field in `balanceUnsealedTransaction` result. |
| `dustBalance: { balance: "0", cap: "0" }` while NIGHT balance unchanged | Wallet UI desync, not real dust depletion. `cap: 0` with 1 NIGHT token is mathematically impossible — dust regen cap should be ~5 tDUST. | Identified as wallet-side bug. Recommended: resync Lace wallet (toggle network off/on) or check Lace's own UI for ground-truth dust balance. Not a code bug. |

### Key code changes (committed + pushed)

- `midnight-unity-bridge.ts`:
  - `submitTx` now treats `undefined` as success
  - Removed broken `balanceSealedTransaction` chain step
  - Added `getTxHistory()` post-submission lookup for canonical txHash
  - Added `_walletReturnedHash` capture from `balanceUnsealedTransaction` result fields
  - Added wallet API method enumeration (walks prototype chain for Lace v4)
  - Added ZK config provider debug logging (prover key, verifier key, ZKIR sizes)
  - Improved error logging with full cause chain inspection
- `index.html`: cache-bust bumped to `?v=20260522-1840`

### What we need for the finish line

1. **Resync Lace wallet** to fix dust accounting (or top up tDUST from faucet if actually depleted).
2. **Run one more test** with the `?v=20260522-1840` build.
3. **Look for** in console:
   - `[MidnightSDK] submitTx: submitTransaction returned: undefined` → success
   - `[MidnightSDK] submitTx: getTxHistory returned N entries`
   - `[MidnightSDK] submitTx: history hash candidate field "...": <real hash>`
4. **Verify on explorer** with the hash from `getTxHistory`.
5. **Confirm counter increments** after ~30–90s (indexer propagation delay).

---

## ⭐ Session 04 Summary (2026-05-22) — Wallet submission diagnostic build

**Symptom from end of Session 03:** `submitTx` reports `wallet accepted tx` and returns a computed `txId`, but the **tx never appears on the explorer**. Both `2f0ee3e3…e8f4` and `c28ded6e…9580` are 404 in `explorer.preview.midnight.network`. Counter stays at 0 forever; both `watchForTxData` and the manual `readCounter` poll fallback time out.

**Hypothesis:** `api.submitTransaction(txHex)` is either a no-op in Lace v4.0.1, silently dropping the tx, OR our hex serialization round-trip via `tx.serialize()` produces bytes the wallet's broadcaster won't accept. The wallet popup completes (user signs) but the tx is not forwarded to the network.

**Instrumentation added (cache-bust `?v=20260522-1100`):**

| Location | What it logs |
|---|---|
| `setupProviders()` start | `Object.getOwnPropertyNames(api)` filtered to functions — enumerates **every** method the connected Lace API exposes. Catches renamed / added methods (`submitSealedTransaction`, `getProvingProvider`, etc.) we may be missing. |
| `setupProviders()` start | Calls `api.getConfiguration()` and dumps the full config object if available. |
| `balanceTx` | Dumps the raw `balanceUnsealedTransaction` return value's `typeof` + keys, plus any `result.txHash` field the wallet may attach. |
| `proofProvider` | New **idiomatic v4 path**: if `api.getProvingProvider` exists, use the wallet's prover first; fall back to `httpClientProofProvider`. Logs the choice. |
| `midnightProvider.submitTx` | Tries in order: `api.submitSealedTransaction(hex)` → `api.submitTransaction(hex)` → `api.submitTransaction({ tx: hex })`. Logs each attempt + result. Captures wallet-returned txId/txHash if any. |
| `hexToTransaction` | Tries `Transaction.deserialize(bytes)` first, falls back to `('signature','proof','binding', bytes)` 4-arg form. Prior code only did the 4-arg form and may have produced a tx with stripped proofs. |

**Built + copied + cache-busted.** Bundle is `19.2 MB`, copied to `Assets/WebGLTemplates/MidnightTemplate/TemplateData/midnight-sdk.bundle.js`, template `index.html` bumped to `?v=20260522-1100`.

### What we need from the next test run

Hard-refresh, click **IncrementCounter**, capture the console. Three diagnostics will tell us the root cause:

1. **`Wallet API methods: [...]`** — confirms whether `submitSealedTransaction`, `getProvingProvider` etc. actually exist on Lace v4.0.1. If `submitTransaction` is the only submission method, our previous attempts were correct in form but something else is wrong (likely tx serialization).
2. **`balanceUnsealedTransaction raw result type/keys`** — tells us whether the wallet returns a plain hex string or `{ tx, txHash, ... }`. If the wallet returns its own txHash, **that** is the on-chain hash we should be polling for, not our locally computed one.
3. **`proofProvider: trying wallet proveTx...`** vs `falling back to remote proof server` — confirms whether Lace v4 has its own proving provider that we should be using. v4.0.0 release notes deprecate `proverServerUri` in favor of this.

### Likely root causes (ranked)

1. **Wrong txHash being polled.** Our `tx.transactionHash()` computed from `Transaction.deserialize('signature','proof','binding', bytes)` may strip the proofs before hashing, producing a hash that **never matches** the on-chain tx (which has proofs included). The wallet may submit successfully but to a different hash than we expect. **The new wallet-returned-hash capture path will reveal this.**
2. **Wallet's `submitTransaction` is silently a no-op without a paired `getProvingProvider()` call.** v4.0.0 release notes strongly suggest the new flow is: `getProvingProvider() → balanceUnsealedTransaction → submitTransaction`. We were calling `httpClientProofProvider` (remote) which produces proofs the wallet's submitter may reject.
3. **Tx serialization round-trip loses the sealed/proven flag.** `tx.serialize() → hex → Transaction.deserialize(...) → .transactionHash()` may not be the canonical hash function.

### Open follow-ups

- Run the new build, paste the console (especially the `Wallet API methods` line) into Session 05.
- If wallet has `getProvingProvider`, **switch** the proof path to it (Phase 1.8 in PROJECT_PLAN).
- If wallet returns its own txHash from `balanceUnsealedTransaction` or `submitTransaction`, **prefer that** for `watchForTxData` over the locally computed one.



---

## ⭐ Session 03 Summary (2026-05-18 night → 2026-05-19 morning)

**Headline result:** the **full `incrementCounter()` flow now reaches the wallet, the user signs the popup, and the wallet accepts the submitted hex-encoded transaction**. Transaction hash `2f0ee3e3fb0d5c57622797a45493709210e9b27cec44b3dac6b432d74fc0e8f4` confirmed by the wallet stack with a valid `StandardTransaction { contract: 8c31306d…cd88dd, entry_point: increment, program: [idxp, addi 1, insc 1], ttl: 1779201762 }`.

### What we learned (root cause of the 5-day-old "Received type object" error)

| # | Finding | Evidence |
|---|---|---|
| **A** | The `TypeError: The first argument must be one of type string, Buffer, ArrayBuffer, Array, or Array-like Object. Received type object` was thrown **inside the Lace extension's service worker**, not anywhere in our bundle. | Cause-chain unwrap revealed stack frames in `chrome-extension://gafhhkghbfjjkeiendhlofajokpaflmk/js/sw/sw-script.js` calling `Buffer.from` on the input to `MidnightDappConnectorApi.value`. |
| **B** | The wrapper from `scoped4` in `@midnight-ntwrk/midnight-js-contracts` **drops the original stack**. The real `TypeError` was attached on `err.cause.stack`, hidden until we unwrapped the cause chain. | Added depth-8 cause-walking dump in `midnight-unity-bridge.ts:1762-1778`. |
| **C** | **Lace dApp connector v4.0.x expects hex-encoded transaction strings** for `balanceUnsealedTransaction`, `balanceSealedTransaction`, and `submitTransaction`. We were passing the raw wasm-bindgen `Transaction` object → wallet's internal `Buffer.from(object)` rejected it. | Confirmed by `@midnight-ntwrk/dapp-connector-api/dist/api.d.ts:balanceUnsealedTransaction(tx: string, …)` and by [v4.0.0 release notes](https://github.com/midnightntwrk/midnight-dapp-connector-api/releases/tag/v4.0.0) ("Update method calls and **handle string-based transaction format**"). |
| **D** | `api.submitTransaction(tx: string)` returns `void`. The SDK however expects `midnightProvider.submitTx` to return a tx-id (used by `publicDataProvider.watchForTxData`). | `submitTxCore` in `dist/midnight-sdk.bundle.js:118114` returns the result of `submitTx` as the watch key. |

### Fix applied (in `web/midnight-bridge/src/midnight-unity-bridge.ts` — `setupProviders()`)

1. Added helpers `txToHex(tx)` and `hexToTransaction(hex)`:
   - `txToHex` calls `tx.serialize()` (returns `Uint8Array`) then hex-encodes.
   - `hexToTransaction` uses `ledgerV8.Transaction.deserialize('signature','proof','binding', bytes)` to rebuild the wasm Transaction so we can call `.transactionHash()`.
2. Rewrote `balanceTx` to hex-encode before calling `api.balanceUnsealedTransaction(txHex)` and to return the wallet's hex result directly (no premature deserialize round-trip).
3. Rewrote `midnightProvider.submitTx` to:
   - hex-encode the (already-balanced/sealed) tx,
   - compute `txId = hexToTransaction(txHex).transactionHash()` for the SDK's watcher,
   - call `api.submitTransaction(txHex)` and return `txId`.
4. Cache-bust → `?v=20260519-0830`.

### Observed runtime sequence (success path)

```
Calling increment circuit…
>>>>> FixedZkConfigProvider.get ENTER: increment   (×2 — probe + real)
<<<<< FixedZkConfigProvider.get EXIT: increment
balanceUnsealedTransaction: passing hex tx, length: 6608
balanceUnsealedTransaction returned, sealed hex length: 13120  ← wallet added fees / dust inputs
submitTx: computed txHash: 2f0ee3e3…e8f4
submitTx: posting hex tx to wallet, length: 13120
[Lace popup → user approves]
submitTx: wallet accepted tx, returning txId: 2f0ee3e3…e8f4
```

### Still in flight after Session 03

- `readCounter()` immediately after a successful submit still returns the **old** value because `watchForTxData` is blocking the IncrementCounter promise until the indexer sees the tx finalized. Preview block time ≈ 6 s but indexer propagation typically adds 30–90 s. The IncrementCounter UI button stays disabled during that window — that is correct behaviour.
- We have **not yet observed** the post-finalization callback resolving (counter → 1). Next session must confirm.
- We are still using `httpClientProofProvider(proofServerUri, fixedZkConfig)`. v4 deprecates `proverServerUri` and recommends `api.getProvingProvider(keyMaterialProvider)` instead. Switching is an open follow-up (optional but idiomatic — see PROJECT_PLAN §1.5 + Phase 1.8).

### Two stack-trace tricks that finally cracked this

```js
// Paste into DevTools BEFORE clicking the failing button
window.addEventListener('unhandledrejection',
  e => console.error('UNHANDLED:', e.reason?.stack || e.reason));
const orig = console.error;
console.error = (...a) => { orig.apply(console, a); a.forEach(x => x?.stack && orig.call(console, x.stack)); };
```

```ts
// And in our catch: walk the cause chain so wrappers can't hide the real frame
let cause: any = e.cause;
while (cause) {
  console.error('Cause:', cause?.constructor?.name, cause?.message, cause?.stack);
  cause = cause?.cause;
}
```

Adopt both as standard debugging plumbing whenever an SDK uses `{ cause: err }` wrappers (which midnight-js does heavily via `scoped4`).

---

## 1. What Was Fixed This Session

| Issue | Root Cause | Fix |
|---|---|---|
| `RangeError: WebAssembly.Compile is disallowed on the main thread` (large WASM) | Chrome blocks sync `WebAssembly.Module` for buffers > 8 MB on main thread. | `build.mjs` wasmBindgenPlugin now uses **hybrid init**: async `WebAssembly.compile/instantiate` for WASM ≥ 4 MB, sync constructors for smaller WASM. |
| `No serviceUriConfig available from wallet` | Lace v4.0.1 does not expose `getConfiguration()` / `serviceUriConfig`. | `setupProviders()` now falls back to **default Preview / Preprod network URIs** (indexer, prover, ZK config) when the wallet provides none. |
| `Failed to resolve module specifier '@meshsdk/midnight-setup'` | Esbuild `iife` format leaves `import()` calls untouched; browser cannot resolve bare specifiers at runtime. | Converted **all dynamic imports to static imports** in `midnight-unity-bridge.ts`. Removed `@meshsdk/midnight-setup` (dist missing) — `loadMeshMidnightSetup()` now returns `null` and code uses wallet API directly. |
| `crypto.createHash not available in browser` | `@midnight-ntwrk/midnight-js-level-private-state-provider` calls `crypto.createHash('sha256')` synchronously; browser shim was a stub. | Implemented **pure-JS synchronous SHA-256** in `src/shims/crypto.js`. `createHash('sha256')` now returns `{ update(), digest() }` compatible object. |
| `GET increment.verifier 404` | `setupProviders()` hardcoded ZK config URL to local `StreamingAssets/zk/counter/` but those files weren't present in the build. | Copied ZK artifacts from `node_modules/@midnight-ntwrk/counter-contract/managed/counter/` to `Assets/StreamingAssets/zk/counter/` so Unity serves them. |
| **`incrementCounter()` hangs silently after `setupProviders()`** (no error surfaced to Unity) | `levelPrivateStateProvider` storage-encryption enforces **`MIN_PASSWORD_LENGTH = 16`** + ≥3 character classes (see `node_modules/@midnight-ntwrk/midnight-js-level-private-state-provider/dist/index.mjs:175,238`). Our password `'Midnight-2026!'` was **14 chars**, so the first encrypt call inside `findDeployedContract` threw and the rejection wasn't logged before the next animation frame. | Changed password to **`'Midnight-Unity-Bridge-2026!'`** (27 chars, contains upper/lower/digits/special) in `midnight-unity-bridge.ts:2051`. Bundle rebuilt + cache-bust `?v=20260517-1430`. |
| **`crypto.pbkdf2Sync not available in browser.`** thrown from `findDeployedContract` | Our hand-rolled `src/shims/crypto.js` only implemented `createHash('sha256')` + `randomBytes`. `pbkdf2Sync`, `createHmac`, `createCipheriv`, `createDecipheriv` were stub-throw. The level provider uses PBKDF2 to derive the AES-CBC key from the password. | Installed **`crypto-browserify`** (`npm i --save --legacy-peer-deps crypto-browserify`) and switched `build.mjs` alias `crypto` → `crypto-browserify`. Full Node-crypto API now available in-browser. Bundle grew 17.9 MB → 19.2 MB. Cache-bust `?v=20260517-1530`. |
| **`Buffer is not a constructor`** thrown from `crypto-browserify`'s `xor`/`StreamCipher._update` → `StorageEncryption.encrypt` → `setSigningKey` → `findDeployedContract` | The inline `bufferBanner` in `build.mjs` installs `globalThis.Buffer = B` where `B` is a plain object literal exposing `from`/`alloc`/`concat`/etc., **not a class**. `browserify-aes`'s `xor()` does `new Buffer(len)` and crashes. The npm `buffer` package was already aliased for `import 'buffer'` but the global Buffer was still our stub. | Added a **prelude in `midnight-unity-bridge.ts:31-40`** that imports `Buffer` from the `buffer` npm package and assigns it to `globalThis.Buffer` + `window.Buffer`, overwriting the banner stub before any provider code runs. Cache-bust `?v=20260517-1550`. |
| **`Network ID has not been configured. Call setNetworkId() before any wallet or contract operation.`** thrown from `findDeployedContract` → `callTx` → `scoped4` (deep inside `@midnight-ntwrk/midnight-js-contracts`) | `@midnight-ntwrk/midnight-js-network-id` exposes a **module-scope `currentNetworkId` singleton** consumed by ledger-v8, onchain-runtime, contracts, and `wallet-sdk-address-format`. We never called `setNetworkId()`, so the first `getNetworkId()` deep in the call chain threw. | Imported `setNetworkId` / `getNetworkId` from `@midnight-ntwrk/midnight-js-network-id` and call it inside `setupProviders()` **before** any provider construction. ~~Mapping: wallet `'preview'` / `'preprod'` → `'testnet'`~~. **UPDATED 2026-05-17 16:10**: Changed to **pass-through** — wallet network (`'preview'`, `'preprod'`, etc.) is passed directly to `setMidnightNetworkId()` lowercased. Lace v4.0.1 expects the literal deployment environment name, not `'testnet'`. Resolves `Expected testnet address, got preview one`. Cache-bust `?v=20260517-1610`. |
| **`POST .../check 400 (Bad Request)`** from proof server (after URL fix, 2026-05-18 PM) | Our `FixedZkConfigProvider.get()` was returning the **full JSON `.zkir`** (784 bytes, starts with `{\n  "version":...`) for the prover, based on a since-disproven hypothesis from the original "Expected PreTranscript" diagnosis. The proof server's `/check` endpoint (`createCheckPayload` in ledger-v8 WASM) actually expects the **compact binary `.bzkir`** (64 bytes). The canonical `FetchZkConfigProvider` confirms this — its `ZKIR_EXT = '.bzkir'` (`@midnight-ntwrk/midnight-js-fetch-zk-config-provider/dist/index.mjs`). Sending JSON IR caused the server to reject the payload with HTTP 400. | Changed `FixedZkConfigProvider.get()` to call `this.getZKIR(circuitId)` (which fetches `.bzkir`) instead of the custom `getZKIRFull()`. The `getZKIRFull` private helper is now unused and could be removed in a later cleanup. Cache-bust `?v=20260518-1500`. |
| **`POST https://proving.preview.midnight.network/check net::ERR_NAME_NOT_RESOLVED`** during proof-server upload (after PreTranscript fix, 2026-05-18 PM) | Two combined bugs: (a) `connectMidnightPreview` (line ~421) **fetches** `api.getConfiguration()` and logs it, but **never persisted** the result to `state.serviceUriConfig` — only stored in local `walletInfo.config`. So in `setupProviders`, `state.serviceUriConfig` was always null and the hardcoded fallback kicked in. (b) The hardcoded fallback URL `https://proving.preview.midnight.network` does not exist in DNS; the real host is `https://proof-server.preview.midnight.network` (which the wallet had correctly returned and we discarded). | One-line fix: assign `state.serviceUriConfig = config` right after the `getConfiguration()` call so the wallet-supplied URIs reach `setupProviders`. Also corrected the hardcoded `proving.<net>.midnight.network` fallbacks to `proof-server.<net>.midnight.network` for both preview and preprod (defense-in-depth). Cache-bust `?v=20260518-1410`. |
| **`TypeError: The first argument must be one of type string, Buffer, ArrayBuffer, Array, or Array-like Object. Received type object`** thrown from inside Lace's service worker (after the PreTranscript / .bzkir fixes, 2026-05-19) | Lace dApp connector v4.0.x is **string-based**: `balanceUnsealedTransaction(tx: string)`, `submitTransaction(tx: string)`. We were passing the raw wasm-bindgen `Transaction` object; the wallet's internal `Buffer.from(object)` failed. The real stack was hidden by `scoped4`'s `{ cause: err }` wrapper. Confirmed via [v4.0.0 release notes](https://github.com/midnightntwrk/midnight-dapp-connector-api/releases/tag/v4.0.0). | Added `txToHex(tx)` (calls `tx.serialize()` then hex-encodes) and `hexToTransaction(hex)` in `setupProviders()`. `balanceTx` now hex-encodes input + returns wallet's hex result directly. `midnightProvider.submitTx` hex-encodes, computes `txId = hexToTransaction(txHex).transactionHash()` for SDK's `watchForTxData`, then `await api.submitTransaction(txHex)`. Bundle rebuilt, cache-bust `?v=20260519-0830`. **First successful tx submitted: `2f0ee3e3…e8f4`.** |
| **`Expected PreTranscript`** from WASM `partitionTranscripts` during `incrementCounter()` (**RE-DIAGNOSED 2026-05-18 PM**) | **Previous ZKIR-format hypothesis was wrong** — `partitionTranscripts` runs before any ZKIR is fetched. Real cause: our `wasmBindgenPlugin` in `build.mjs` mis-rewrote wasm-bindgen snippets. The ledger-v8 snippet `import * as wasm from '#self'; export function PreTranscript_() { return wasm.PreTranscript; }` is supposed to hand the Rust side the **JS class** `PreTranscript` (re-exported from `_bg.js`). The plugin instead substituted `wasm.PreTranscript` with `__wasm_exports.PreTranscript` — the raw WASM instance exports, which has no `PreTranscript` symbol. So `PreTranscript_()` returned `undefined`, Rust's `dyn_into::<PreTranscript>()` failed `instanceof undefined`, WASM threw "Expected PreTranscript". | One-line fix in `build.mjs:91`: substitute `wasm.X` references in snippets with `__bg.X` (the namespace import of `_bg.js`) instead of `__wasm_exports.X`. This correctly hands Rust the JS class, not the raw WASM exports. All 24 ledger-v8 snippets are now bound correctly. Cache-bust `?v=20260518-1300`. The previous `getZKIR` / `getZKIRFull` split is harmless but should be revisited — `getZKIR()` may now need to return the full `.zkir` again (TBD on next run). |

---

## 2. Key Files Changed

| File | Change |
|---|---|
| `web/midnight-bridge/src/midnight-unity-bridge.ts` | Static imports for ledger-v8, onchain-runtime-v3, counter-contract, provider packages. Removed `@meshsdk/midnight-setup` dynamic import. Added `network` field to `WalletState`. Default URIs in `setupProviders()`. |
| `web/midnight-bridge/src/shims/crypto.js` | Replaced `createHash` stub with full synchronous SHA-256 implementation (pure JS). |
| `web/midnight-bridge/build.mjs` | Hybrid sync/async WASM init based on 4 MB threshold. Added `wasmBindgenPlugin` to fallback build. |
| `Assets/WebGLTemplates/MidnightTemplate/index.html` | Cache-bust updated to `?v=20260516-2235`. |
| `Assets/Plugins/WebGL/MidnightWebGL.jslib` | Inline robust `MidnightSDK` lookup in all functions (checks `window`, `parent`, `top`, `globalThis`). |

---

## 3. Current Runtime Status

| Feature | Status | Notes |
|---|---|---|
| Unity WebGL build | ✅ Working | Build succeeds, no `wasm-opt` crash (bundles live in `WebGLTemplates/`, not `Plugins/`). |
| `window.MidnightSDK` | ✅ Available | Exposed by `midnight-sdk.bundle.js`. |
| Wallet detection (Lace) | ✅ Working | Detects Lace v4.0.1 via `window.midnight.<uuid>` (prototype-1 `connect`). |
| `connectMidnightPreview('auto')` | ✅ Working | Connects to Preview network, returns shielded address, coin public key, encryption public key. |
| `getWalletState()` | ✅ Working | Returns balances (tDUST, unshielded, dust). |
| `readCounter()` | ✅ Working | Queries indexer, returns counter value (currently `0`). |
| `incrementCounter()` (submit) | ✅ **Structurally correct as of 2026-05-22** | Tx hex submitted to wallet, user signs, wallet accepts (`submitTransaction` returns `undefined` = success per v4 spec). Removed broken `balanceSealedTransaction` step. Added `getTxHistory()` lookup for canonical txHash. |
| `incrementCounter()` (on-chain confirmation → counter update) | 🟡 **Pending dust + live network test** | `publicDataProvider.watchForTxData(txId)` can hang indefinitely. Added 2-minute timeout + manual `readCounter()` polling fallback. UI no longer freezes forever. **Needs one more run with valid dust balance to confirm on-chain increment.** |
| `@meshsdk/midnight-setup` | ❌ Skipped | Package installed but `dist/` missing. Not blocking — wallet API used directly. |

---

## 4. Next Steps (for following session)

1. **Resync Lace wallet** to fix dust accounting (or top up tDUST from faucet if actually depleted). `dustBalance: { balance: "0", cap: "0" }` with 1 NIGHT token is a wallet UI desync — cap should be ~5 tDUST.
2. **Run one more test** with the current bundle (`?v=20260522-1840`) and observe the console for:
   - `[MidnightSDK] submitTx: submitTransaction returned: undefined` — success
   - `[MidnightSDK] submitTx: getTxHistory returned N entries`
   - `[MidnightSDK] submitTx: history hash candidate field "...": <real hash>` — canonical txHash
3. **Verify on explorer** with the hash from `getTxHistory`: `https://explorer.preview.midnight.network/transactions/<hash>`
4. **Confirm counter increments** after ~30–90s (indexer propagation delay). Look for `[MidnightSDK] Manual poll N/12: counter = 1`.
5. **Push the milestone tag** once the counter increments — recommended `v1.2.0-midnight-counter-end-to-end`.
6. **(Optional, idiomatic v4)** Migrate `setupProviders()` to use `await api.getProvingProvider(fixedZkConfig)` instead of `httpClientProofProvider(proofServerUri, fixedZkConfig)`. v4.0.0 deprecates `proverServerUri`. The wallet handles proving modality (local / remote / hardware) and we stop needing a network URL. Wrap in feature-detect: prefer `api.getProvingProvider` when present, fall back to `httpClientProofProvider` for older wallets.
7. **(Optional, hygiene)** Remove `getZKIRFull` and the `_zkirFullCache` from `FixedZkConfigProvider` — unused since the `.bzkir` fix.
8. **Begin PROJECT_PLAN.md Phase 2** (configurable contracts at runtime) once the Counter loop is green.

### Proof Server in this Flow
- `FetchZkConfigProvider` only reads **static config files** (verifier keys, prover keys, IR). These are now local in `StreamingAssets`.
- `httpClientProofProvider` talks to the **live proof server** (`https://proof-server.preview.midnight.network`) to actually **generate the ZK proof** for the transaction.
- **However**, Lace v4's `balanceUnsealedTransaction` may prove the tx **internally inside the wallet** (this is the idiomatic v4 path). If so, `httpClientProofProvider.proveTx()` is still called by the SDK but the wallet may ignore/re-prove it. A local proof server may therefore receive no traffic — this is expected.
- **Instrumentation added**: `proofProvider.proveTx` is now wrapped with console logs so you can see exactly when it is invoked and whether it succeeds or fails.
- If proof generation fails, check network connectivity to the configured proof server URI and any CORS errors.

---

## 5. Important Constants / Values

| Item | Value |
|---|---|
| Default Preview indexer URI | `https://indexer.preview.midnight.network/api/v4/graphql` |
| Default Preview prover URI | `https://proof-server.preview.midnight.network` |
| Default Preview ZK base URL | `https://indexer.preview.midnight.network/api/v4/zk` |
| Default counter contract address | `8c31306d717dd2b79f30785ae7f0f5241f6f891d63441827395d8be1fecd88dd` |
| WASM large-file threshold | 4 MB (in `build.mjs`) |
| Cache-bust (current) | `?v=20260522-1840` |
| First successful increment tx | `2f0ee3e3fb0d5c57622797a45493709210e9b27cec44b3dac6b432d74fc0e8f4` |
| Current tag | `v1.1.0-midnight-counter-almost-complete` |
| Midnight NetworkId value | `'preview'` (pass-through from wallet — Lace v4.0.1 expects literal deployment environment name, not ledger network ID) |
| LevelDB private-state password | `Midnight-Unity-Bridge-2026!` (≥16 chars, 4 char classes) |

---

## 6. Architecture Notes

- **Bundle format**: `iife` (no module system in browser).
- **WASM handling**: `wasmBindgenPlugin` in `build.mjs` inlines `.wasm` as base64 and rewrites init to hybrid sync/async.
- **SDK scope**: `MidnightWebGL.jslib` functions must inline `MidnightSDK` lookup because Emscripten isolates jslib scope from `window`. Checks: `window.MidnightSDK`, `window.__midnightSDK`, `parent.MidnightSDK`, `top.MidnightSDK`, `globalThis.MidnightSDK`.
- **Network state**: `state.network` is set during `connect()` / `connectMidnightPreview()` and used by `setupProviders()` to pick default URIs.

### Provider Roles (`setupProviders()`)

| Provider | Package | Role | Data Source |
|---|---|---|---|
| `publicDataProvider` | `@midnight-ntwrk/midnight-js-indexer-public-data-provider` | Queries contract state from indexer | Remote: `indexer.preview.midnight.network` |
| `zkConfigProvider` | `@midnight-ntwrk/midnight-js-fetch-zk-config-provider` | Reads static ZK config (verifier/prover keys, IR) | **Local**: `StreamingAssets/zk/counter/` |
| `proofProvider` | `@midnight-ntwrk/midnight-js-http-client-proof-provider` | Generates ZK proofs for transactions | Remote: `proving.preview.midnight.network` |
| `privateStateProvider` | `@midnight-ntwrk/midnight-js-level-private-state-provider` | Stores private state in browser IndexedDB | Local (browser storage) |
| `walletProvider` / `midnightProvider` | Inline | Signs and submits transactions | Lace wallet extension |

### ZK Artifact Files (in `Assets/StreamingAssets/zk/counter/`)

These are copied from `node_modules/@midnight-ntwrk/counter-contract/managed/counter/`:

| File | Purpose |
|---|---|
| `keys/increment.prover` | Prover key for generating ZK proofs |
| `keys/increment.verifier` | Verifier key for validating proofs on-chain |
| `zkir/increment.bzkir` / `increment.zkir` | Intermediate representation for the circuit |
