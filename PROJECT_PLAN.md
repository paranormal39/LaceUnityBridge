# LaceUnityBridge — Analysis, Cut List & Phased Plan

_Last updated: **2026-05-19** (after Midnight v4 hex-tx fix — first successful on-chain submit from Unity WebGL)_

This document is the single source of truth for **what works, what is dead weight, and what comes next**. `README.md` describes the project; `SETUP.md` gets you running; this file plans the future.

> **2026-05-19 update — Midnight `incrementCounter()` reaches the wallet and submits a hex-encoded transaction.** The user signs in the Lace popup, the wallet accepts, the SDK computes the tx hash, and our `midnightProvider.submitTx` returns it to the SDK's `watchForTxData`. **First successful tx: [`2f0ee3e3…e8f4`](https://explorer.preview.midnight.network/transactions/2f0ee3e3fb0d5c57622797a45493709210e9b27cec44b3dac6b432d74fc0e8f4).** Root cause of the previous "Received type object" wall: **Lace dApp connector v4 expects hex-encoded transaction *strings*** — not the raw wasm-bindgen `Transaction` object. Fix added `txToHex` / `hexToTransaction` helpers and rewrote `balanceTx` + `submitTx` to (de)serialize at the wallet boundary. Cache-bust `?v=20260519-0905`. **New**: `incrementCounter()` now has a 2-minute timeout around the internal `watchForTxData` call + manual `readCounter()` polling fallback so the UI never freezes forever. See `handover_01.md` §⭐ Session 03 for the full root-cause + debugging methodology (cause-chain unwrap is the new permanent debugging plumbing).
>
> **2026-05-16 update — Counter is now live on Midnight _Preview_** (not Preprod). Deployed contract address `8c31306d717dd2b79f30785ae7f0f5241f6f891d63441827395d8be1fecd88dd`. Phase 1 below has been rewritten to target Preview and to pin against the Midnight support matrix. The CLI side (deploy + verify) works today; what remains is wiring those compiled artifacts into the Unity WebGL bundle. See §1.5 for the binding-version matrix that **must** match end-to-end.
>
> **2026-05-17 update — Increment hang root-caused.** Connect / read flows are stable. `incrementCounter()` silently aborted right after `setupProviders()` because `@midnight-ntwrk/midnight-js-level-private-state-provider` v4.0.4 enforces a **`MIN_PASSWORD_LENGTH = 16`** + ≥3 character classes on the LevelDB encryption password (see `dist/index.mjs:175,238`). The old `'Midnight-2026!'` (14 chars) threw on the first private-state read; the rejection was hidden by Unity's rAF loop spam. Fixed by raising the password to `'Midnight-Unity-Bridge-2026!'` in `midnight-unity-bridge.ts:2051`, bundle rebuilt, cache-bust `?v=20260517-1430`. See §5 (Risks) for the new sub-bullet about silent SDK pre-conditions.
>
> **2026-05-17 update — Increment now reaches `callTx` ; four further blockers fixed.** After the password fix, four more browser-environment errors were surfaced and resolved in sequence. We now make it all the way to **`Calling increment circuit...`** before the SDK throws. Tracking matrix:
>
> | # | Error | Fix | Cache-bust |
> |---|---|---|---|
> | 1 | `crypto.pbkdf2Sync not available in browser` (from level provider PBKDF2 key derivation) | Replaced hand-rolled `src/shims/crypto.js` stubs with full **`crypto-browserify`** npm package; switched `build.mjs` alias `crypto` → `crypto-browserify`. | `?v=20260517-1530` |
> | 2 | `Buffer is not a constructor` (from `crypto-browserify`'s `xor()` → `StreamCipher._update`) | The inline `bufferBanner` in `build.mjs` was setting `globalThis.Buffer` to a plain-object literal, not a class. Added a prelude in `midnight-unity-bridge.ts:31-40` that imports the real `Buffer` from the `buffer` npm package and overwrites `globalThis.Buffer` + `window.Buffer` before any provider code runs. | `?v=20260517-1550` |
> | 3 | `Network ID has not been configured. Call setNetworkId() before any wallet or contract operation.` (from `findDeployedContract` → `callTx` → `scoped4`) | `@midnight-ntwrk/midnight-js-network-id` keeps a **module-scope singleton** that ledger-v8 / onchain-runtime / contracts / address-format all call `getNetworkId()` on. Added `setMidnightNetworkId(...)` call inside `setupProviders()` after URI defaults. **CRITICAL FIX**: Changed from mapping `'preview' → 'testnet'` to **passing `'preview'` directly** — Lace v4.0.1 expects the literal deployment environment name, not the ledger network ID. | `?v=20260517-1610` |
>
> Current flow as of `?v=20260517-1610`: Connect → Balance → ReadCounter → IncrementCounter → setupProviders → **NetworkId set to `'preview'`** → findDeployedContract → Deployed contract found → Calling increment circuit → (next gate: proof generation against `https://proving.preview.midnight.network` + Lace `balanceAndProveTransaction` + `submitTransaction`). The NetworkId is now passed through directly from the wallet (lowercased) rather than mapped to `'testnet'`. See §5 sub-bullets 11–13 for the runtime-environment risks introduced by these fixes.

---

## 1. Current state — what actually works

| Subsystem | Status | Evidence |
|-----------|--------|----------|
| **Cardano CIP-30 connect (Lace/Eternl/Nami)** | ✅ working | `CardanoBridge.cs` + `cardano-bridge.js`, confirmed tx on Preprod |
| **Cardano ADA send** | ✅ working | `CardanoBridge.SendAda()` |
| **Cardano Plutus V3 increment (Aiken counter)** | ✅ working on-chain | tx `484b2f6a…` |
| **Cardano DAO scaffolding (`dao-csl.js`)** | 🟡 partial | wired in `index.html`; no Unity-side API yet |
| **Midnight wallet detection (mnLace + UUID)** | ✅ working | `MidnightConnector.ts`, `logMidnightProviders()` |
| **Midnight `connect(network)` + `getShieldedAddresses()`** | ✅ working on Preview | `MidnightConnector.ts`, returns `mn_shield-addr_preview1…` plus shielded/encryption pubkeys |
| **Midnight `serviceUriConfig()` retrieval** | ⚠️ wallet does NOT expose it (Lace v4.0.1) — bridge falls back to hard-coded Preview defaults in `setupProviders()` | console shows `Wallet did not provide serviceUriConfig, using defaults for preview` |
| **Counter contract deployed on Preview** | ✅ live | `8c31306d…cd88dd`, deployed via `npm run preview-ps` in `example-counter` |
| **Counter CLI flow (deploy + increment + read)** | ✅ working (out-of-Unity) | `counter-cli` against Preview with local Docker proof server `:6300` |
| **Midnight Counter `readCounter()` from Unity** | ✅ working on Preview | Indexer v4 GraphQL → `Counter.ledger(state.data).round`; logs `Counter value: 0` on the live contract |
| **Midnight Counter `incrementCounter()` from Unity — pre-flight (providers, contract lookup)** | ✅ working | Reaches `Calling increment circuit...` after the 2026-05-17 afternoon fixes (password / crypto-browserify / Buffer class / setNetworkId) |
| **Midnight Counter `incrementCounter()` — proof, balance, sign, submit** | ✅ working as of **2026-05-19** | Hex-encoded tx accepted by Lace v4; user signs in popup; wallet returns. First tx hash: [`2f0ee3e3…e8f4`](https://explorer.preview.midnight.network/transactions/2f0ee3e3fb0d5c57622797a45493709210e9b27cec44b3dac6b432d74fc0e8f4). |
| **Midnight Counter `incrementCounter()` — finalize + read-back** | 🟡 mitigated | `publicDataProvider.watchForTxData(txId)` can hang indefinitely. Added 2-minute timeout + manual `readCounter()` polling fallback. Need to observe either (a) watcher resolves normally, or (b) manual poll detects `N+1` after timeout. |
| **Midnight tDUST balance display** | ✅ working | `dustBalance.balance` parsed and surfaced (`0.463613 tDUST` observed) |
| **Web bundle on Midnight JS 4.0.4 / ledger-v8 8.0.3** | ✅ done | `web/midnight-bridge/package.json` is on `midnight-js-* ^4.0.4`, `ledger-v8 8.0.3` exact, `compact-runtime 0.15.0` exact, `wallet-sdk-address-format 3.1.1` with `overrides` |
| **Browser polyfills (Buffer / crypto / stream / events)** | ✅ done | `crypto-browserify` + `buffer` + `stream-browserify` + `events/` aliased in `build.mjs`; `globalThis.Buffer` upgraded to real class in entry-point prelude |
| **NetworkId singleton configured before contract ops** | ✅ done | `setupProviders()` calls `setMidnightNetworkId('testnet')` for Preview/Preprod |

### The “connect to the counter” gap — status as of 2026-05-17 afternoon

The Midnight Counter pipeline now reaches the `Calling increment circuit...` line from inside Unity WebGL. What's left is **runtime verification** of the post-`callTx` path (proof generation, balance, submit) — no further code changes are believed necessary on the bridge side until the next error surfaces.

| Past blocker | Resolution |
|---|---|
| `window.MidnightSDK.Counter = null`, `witnesses = null` | Vendored `@midnight-ntwrk/counter-contract` into `web/midnight-bridge/vendor/counter-contract/`; static import in `midnight-unity-bridge.ts:54`. |
| Bundle on Midnight JS 2.x | `package.json` now on `^4.0.4` line with exact pins per §1.5; install uses `--legacy-peer-deps` because of `@meshsdk/midnight-setup`'s outdated peer range. |
| Indexer v3 vs v4 | All providers now talk `/api/v4/graphql` (HTTP + WS). |
| Wrong demo contract address | All defaults now point at the live Preview address `8c31306d…cd88dd`. |
| `crypto.createHash`, `crypto.pbkdf2Sync` not available | Full `crypto-browserify` aliased via `build.mjs`. |
| Buffer global stub not a constructor | Real `Buffer` class from `buffer` npm package installed in entry-point prelude. |
| LevelDB encryption password rejected silently | Password upgraded to `'Midnight-Unity-Bridge-2026!'` (≥16 chars, 4 char classes). |
| `Network ID has not been configured` / `Expected testnet address, got preview one` | `setupProviders()` now calls `setMidnightNetworkId(...)` before any contract operation, **passing the wallet's network name directly** (`'preview'` or `'preprod'`) instead of mapping to `'testnet'`. Lace v4.0.1 expects the literal deployment environment name. |
| Wallet does not expose `serviceUriConfig` | Hard-coded Preview defaults in `setupProviders()`. |
| ZK keys served at 404 | Vendored `keys/increment.{prover,verifier}` + `zkir/increment.{bzkir,zkir}` into `Assets/StreamingAssets/zk/counter/`. |

### Immediate next debugging step (as of 2026-05-19, cache-bust `?v=20260519-0905`)

The full Midnight `incrementCounter()` pipeline now reaches `submitTx: wallet accepted tx` and returns a computed tx hash. **Outstanding verification:**

1. **Submit a fresh increment** and watch the console for:
   - `[MidnightSDK] proofProvider.proveTx called` — confirms proving step is reached.
   - `[MidnightSDK] submitTx: wallet accepted tx` — tx is on chain.
   - `[MidnightSDK] increment circuit timed out` — if `watchForTxData` hangs beyond 2 min; the new **manual polling fallback** will then poll `readCounter()` every 10 s for 2 minutes.
   - `[MidnightSDK] Manual poll detected counter update: N` — confirms the tx finalized even though the SDK watcher hung.
2. **If the watcher resolves normally** (within ~30–90 s), `incrementCounter()` returns `{ success: true, timedOut: false, newCounter: N+1 }`.
3. **If the watcher hangs**, it returns `{ success: true, timedOut: true, newCounter: N+1 }` after the manual poll detects the update. The Unity UI can use `timedOut` to show a "confirmed after delay" message.
4. ~~Proof server / balanceUnsealed / submit~~ — **all RESOLVED 2026-05-19** by hex-encoding the tx at the wallet boundary. Lace dApp connector v4 is string-based; passing the raw wasm Transaction object triggered `Buffer.from(object)` inside the wallet's service worker. See `handover_01.md` §⭐ Session 03.

After step 1 or 2 succeeds, the loop is end-to-end green and we can tag a milestone (see Phase 1.7 below).

There is **no canonical pre-deployed Counter on Midnight Preview** — the official example expects each developer to deploy their own. The address in our repo is one we deployed earlier and which is still live as of 2026-05-19.

---

## 1.5 Version pin matrix (mandatory)

These versions are dictated by the [Midnight support matrix](https://docs.midnight.network/relnotes/support-matrix) and validated end-to-end by the working CLI. Anything outside this matrix breaks proof acceptance or wallet-address symbol identity.

| Layer | Package / Image | Pin | Why |
|------|------------------|-----|-----|
| Ledger | `@midnight-ntwrk/ledger-v8` | **`8.0.3` exact** | 8.1.0 (published 2026-05-13) is rejected by the live network. |
| Proof server | `midnightntwrk/proof-server` (Docker) | **`8.0.3` exact** | Must match ledger. |
| Compact compiler | `compactc` via `compact compile +0.30.0` | **`+0.30.0`** | 0.31.0 emits runtime-0.16.0 artifacts our SDK can't load. |
| Compact runtime | `@midnight-ntwrk/compact-runtime` | **`0.15.0` exact** | Matches `compactc +0.30.0` output. No caret. |
| Midnight JS suite | `@midnight-ntwrk/midnight-js-*` | **`^4.0.4`** | All providers + contracts aligned on 4.0.4. |
| DApp connector API | `@midnight-ntwrk/dapp-connector-api` | **`^4.0.4`** | Currently pinned at `4.0.1` — bump. |
| Address format | `@midnight-ntwrk/wallet-sdk-address-format` | **`3.1.1` exact + `overrides`** | Module-load `Symbol('MidnightBech32m')` ⇒ different copies = different identities = `printWalletSummary` crash. **Must dedupe via npm `overrides`.** |
| Wallet SDK facade | `@midnight-ntwrk/wallet-sdk-*` | `^3.0.0` | |
| Node.js | — | **`24.x`** (tested 24.8.0) | Inside WSL. |
| Indexer GraphQL path | — | **`/api/v4/graphql`** + `wss://…/api/v4/graphql/ws` | v3 endpoints are gone. |

Proposed `web/midnight-bridge/package.json` `dependencies` + `overrides` patch (Phase 1 will apply this verbatim):

```jsonc
{
  "dependencies": {
    "@midnight-ntwrk/compact-runtime": "0.15.0",
    "@midnight-ntwrk/dapp-connector-api": "^4.0.4",
    "@midnight-ntwrk/ledger-v8": "8.0.3",
    "@midnight-ntwrk/midnight-js-contracts": "^4.0.4",
    "@midnight-ntwrk/midnight-js-fetch-zk-config-provider": "^4.0.4",
    "@midnight-ntwrk/midnight-js-http-client-proof-provider": "^4.0.4",
    "@midnight-ntwrk/midnight-js-indexer-public-data-provider": "^4.0.4",
    "@midnight-ntwrk/midnight-js-level-private-state-provider": "^4.0.4",
    "@midnight-ntwrk/midnight-js-network-id": "^4.0.4",
    "@midnight-ntwrk/midnight-js-types": "^4.0.4",
    "@midnight-ntwrk/wallet-sdk-address-format": "3.1.1",
    "counter-contract": "file:../../vendor/counter-contract"
  },
  "overrides": {
    "@midnight-ntwrk/wallet-sdk-address-format": "3.1.1",
    "@midnight-ntwrk/ledger-v8": "8.0.3",
    "@midnight-ntwrk/compact-runtime": "0.15.0"
  }
}
```

Note the package rename: `@midnight-ntwrk/ledger` (2.x line) → `@midnight-ntwrk/ledger-v8` (4.x line). The dynamic `import('@midnight-ntwrk/ledger')` in `midnight-unity-bridge.ts:54` MUST be updated; same for `zswap`/`onchain-runtime` imports if their package names changed.

### Network endpoints (Preview, current)

| Service | URL |
|---------|-----|
| RPC node | `https://rpc.preview.midnight.network` |
| Indexer HTTP | `https://indexer.preview.midnight.network/api/v4/graphql` |
| Indexer WS | `wss://indexer.preview.midnight.network/api/v4/graphql/ws` |
| Proof server | `http://127.0.0.1:6300` (local Docker, `midnightntwrk/proof-server:8.0.3`) |
| Faucet | `https://faucet.preview.midnight.network/` |

Preprod endpoints (kept for parity in `config.ts`) just swap `preview` → `preprod`.

---

## 2. Dead / cuttable code

Goal: shrink the repo without breaking Cardano (per user request, **keep all Cardano paths intact** for future dual-chain support).

### Cut list — high confidence (safe to delete)

| Path | Size | Why cut |
|------|------|---------|
| `Assets/Scripts/Midnight/MidnightBridge.cs.bak` | 56 KB | `.bak` of replaced class, never compiled |
| `Assets/Scripts/Midnight/MidnightUISetup.cs.bak` | 52 KB | same |
| `Assets/Scripts/Midnight/MidnightBridge.cs.bak.meta` | — | orphan meta |
| `Assets/Scripts/Midnight/MidnightUISetup.cs.bak.meta` | — | orphan meta |
| `Assets/Plugins/WebGL/mesh-sdk.bundle.js` | **12 MB** | Mesh JS bundle never `<script>`-tagged anywhere; replaced by `midnight-sdk.bundle.js` |
| `Assets/Plugins/WebGL/mesh-sdk.bundle.js.map` | 8.7 MB | matching sourcemap |
| `Assets/WebGLTemplates/MidnightTemplate/TemplateData/mesh-sdk.bundle.js` | **12 MB** | duplicate copy in template |
| `Assets/WebGLTemplates/MidnightTemplate/TemplateData/mesh-sdk.bundle.js.map` | 8.7 MB | duplicate sourcemap |
| `Assets/WebGLTemplates/MidnightTest/` | 28 KB | legacy minimal test template; superseded by `MidnightTemplate` |
| `Assets/WebGLTemplates/MidnightTemplate/test-cardano-bridge.html` | 9 KB | dev-only smoke test page |
| `Assets/WebGLTemplates/MidnightTemplate/wallet-diagnostic.js` | 35 KB | flagged as `TEMPORARY` in `index.html`; debugging is now in `MidnightConnector.logMidnightProviders()` |
| `web/mesh-bridge/` (entire folder) | ~350 MB w/ `node_modules` | Mesh experiment, never bundled into Unity build |
| `web/midnight-bundle/` | a few MB | Earlier scaffolding bundle replaced by `web/midnight-bridge/`; only exports a stub `MidnightSDKImpl` |

### Cut list — keep but mark deprecated

| Path | Action |
|------|--------|
| `Assets/WebGLTemplates/MidnightTemplate/midnight-counter.js` | superseded by `midnight-counter-bindings.js`; keep until bindings file proves stable, then delete |
| `Assets/WebGLTemplates/MidnightTemplate/init-counter-csl.js` | only used once for Cardano counter init; keep, document |
| `implementation-guide.md` | rolled into this file; either delete or archive into `docs/legacy/` |

### Keep (per user’s “keep Cardano intact” rule)

- `Assets/Scripts/Cardano/CardanoBridge.cs` + meta
- `Assets/Plugins/WebGL/CardanoBridgeWebGL.jslib`
- `Assets/WebGLTemplates/MidnightTemplate/cardano-bridge.js`
- `Assets/WebGLTemplates/MidnightTemplate/increment-counter-csl.js`
- `Assets/WebGLTemplates/MidnightTemplate/dao-csl.js`
- `Assets/WebGLTemplates/MidnightTemplate/TemplateData/csl.bundle.js` + WASM
- `web/csl-bundle/`

### Estimated win

Cutting just the high-confidence list reclaims **~42 MB** in `Assets/` (which Unity ships into every WebGL build) and removes ~350 MB of dev-time `node_modules` from `web/mesh-bridge/`. WebGL build size drop: roughly **40 MB → 22 MB** for the JS payload.

---

## 3. Phased roadmap

Each phase is independently shippable. Ordering reflects dependencies and risk.

### Phase 0 — Hygiene (½ day, no behaviour change)

- [ ] Delete the high-confidence cut list above.
- [ ] Move `implementation-guide.md` → `docs/legacy/implementation-guide.md` (or delete).
- [ ] Add a top-level `CHANGELOG.md`.
- [ ] Add `web/.gitignore` if not present (exclude `node_modules`, `dist/*.map`).
- [ ] Verify Unity still compiles + WebGL build still runs (Cardano increment as smoke test).

**Definition of done:** repo size drops, all existing flows unchanged.

### Phase 1 — Connect to the live Counter on Midnight **Preview** (2–3 days)

> Target: `8c31306d717dd2b79f30785ae7f0f5241f6f891d63441827395d8be1fecd88dd` on Preview. Versions per §1.5. Local Docker proof server `:6300`.

**1.1 — Bring up versions (½ day)** — ✅ done 2026-05-17
- [x] Rewrite `web/midnight-bridge/package.json` per §1.5 (ledger-v8, compact-runtime 0.15.0 exact, midnight-js ^4.0.4, address-format override).
- [x] Update package imports in `web/midnight-bridge/src/midnight-unity-bridge.ts`: `@midnight-ntwrk/ledger` → `@midnight-ntwrk/ledger-v8`; audit `zswap`/`onchain-runtime` imports against the 4.0.4 line.
- [x] `npm install --legacy-peer-deps` (needed for `@meshsdk/midnight-setup` peer range) and verify dedupe of `wallet-sdk-address-format`.
- [x] Build & sanity-load: `npm run build` produces a bundle that does not throw on WASM init (custom `wasmBindgenPlugin` does hybrid sync/async init).

**1.2 — Bundle the Counter contract (½ day)** — ✅ done
- [x] `web/midnight-bridge/vendor/counter-contract/` contains the compiled output (`Contract`, `witnesses`, `ledger`, plus ZK keys).
- [x] `package.json` references it via `"counter-contract": "file:vendor/counter-contract"`.
- [x] Static import in `midnight-unity-bridge.ts:54` — `import * as counterContract from '@midnight-ntwrk/counter-contract'`.

**1.3 — Ship ZK keys with the WebGL build (½ day)** — ✅ done
- [x] `keys/increment.{prover,verifier}` + `zkir/increment.{bzkir,zkir}` copied into `Assets/StreamingAssets/zk/counter/`.
- [x] `setupProviders()` builds ZK config URL from `${window.location.origin}/StreamingAssets/zk/counter/` (visible in logs as `ZK config base URL: …/StreamingAssets/zk/counter/`).
- [ ] Add a runtime warm-up log so first-call latency is visible. *(deferred — not blocking)*

**1.4 — Switch the bridge to Preview + v4 indexer (¼ day)** — ✅ done
- [x] Default `network` parameter `'preprod'` → `'preview'`.
- [x] Indexer URL constants on `/api/v4/graphql` (HTTP + WS).
- [x] Demo contract address replaced with `8c31306d…cd88dd`.
- [x] Proof server defaults to `https://proving.preview.midnight.network` (remote); local Docker `http://127.0.0.1:6300` override remains documented in SETUP.

**1.5 — Real read + increment (½ day)** — � _submit works, finalization read-back pending_
- [x] `readCounter()` returns `Counter.ledger(state.data).round` via the 4.0.4 indexer provider — confirmed returning `0` on the live contract.
- [x] `incrementCounter()` builds and reaches `Calling increment circuit...` via `findDeployedContract({ contractAddress, contract, privateStateId, initialPrivateState })` → `contract.callTx.increment()`.
- [x] **DONE 2026-05-19:** Post-`callTx` path verified — wallet `balanceUnsealedTransaction(hex)` returns sealed hex, our `submitTx` computes `tx.transactionHash()` and forwards to `api.submitTransaction(hex)`. First on-chain submit `2f0ee3e3…e8f4`.
- [ ] **NEXT:** observe `watchForTxData` resolution → `readCounter()` returns `round + 1` after finalization (~30–90 s).
- [x] C# `MidnightSDK.IncrementCounter` + `MidnightSDK.ReadCounter` callbacks wired through.

**Sequence of runtime fixes that got us end-to-end (2026-05-17 → 2026-05-19):**

| Cache-bust | Fix |
|---|---|
| `?v=20260517-1430` | Password ≥16 chars + 3 char classes for `levelPrivateStateProvider`. |
| `?v=20260517-1530` | `crypto-browserify` replaces hand-rolled `crypto` shim → `pbkdf2Sync` works. |
| `?v=20260517-1550` | Real `Buffer` class from `buffer` package overwrites `globalThis.Buffer` stub. |
| `?v=20260517-1600` | `setMidnightNetworkId('preview')` called inside `setupProviders()` before `findDeployedContract`. |
| `?v=20260518-1300` | `wasmBindgenPlugin` snippet rewriter swaps `wasm.X` → `__bg.X` (JS class), not `__wasm_exports.X` — fixes "Expected PreTranscript". |
| `?v=20260518-1410` | Persist `state.serviceUriConfig = config` after `getConfiguration()`; correct hardcoded fallback `proving.<net>` → `proof-server.<net>`. |
| `?v=20260518-1500` | `FixedZkConfigProvider.get()` returns compact `.bzkir` (not full `.zkir`) — matches canonical `FetchZkConfigProvider`. |
| `?v=20260519-0830` | **Hex-encode tx at the wallet boundary.** `balanceTx` + `midnightProvider.submitTx` now serialize wasm Transaction → hex before calling Lace v4 string-based API. Computes `txId` via `tx.transactionHash()` for SDK `watchForTxData`. |

**1.6 — Verify out-of-Unity (¼ day)**
- [ ] Add `web/midnight-bridge/test.html` that loads the bundle and calls read/increment against Preview using a real Lace Midnight wallet.
- [ ] Document quick verification commands in `SETUP.md` (already partially in §6).

**1.7 — Verify in Unity and ship (¼ day)** — 🟡 _last mile_
- [x] Build WebGL with `MidnightTemplate`. Connect → read → submit-increment all green.
- [ ] Confirm: `watchForTxData` resolves and HUD updates `round + 1` after finalization.
- [ ] **Push tag `v1.2.0-midnight-counter-end-to-end`** once the above is observed.
- [ ] Add a HUD label for `network`, `contract address`, `proof server`, `last tx hash` so misconfig is visible at a glance.

**1.8 — (Idiomatic v4) Migrate to wallet `getProvingProvider` (½ day, optional)** — ⏳ open

The dApp connector v4.0.0 release notes **deprecate `proverServerUri`** and recommend `api.getProvingProvider(keyMaterialProvider)`. Letting the wallet pick proving modality (local / remote / hardware-accelerated) is the v4-native flow.

- [ ] Feature-detect: if `typeof api.getProvingProvider === 'function'`, use it; else keep `httpClientProofProvider` for older wallets.
- [ ] Implementation sketch:
  ```ts
  const walletProvingProvider = await api.getProvingProvider(fixedZkConfig); // KeyMaterialProvider
  const proofProvider = {
    async proveTx(unprovenTx) {
      const costModel = (ledgerV8 as any).CostModel.initialCostModel();
      return unprovenTx.prove(walletProvingProvider, costModel);
    }
  };
  ```
- [ ] Remove the `proofServerUri` fallback URL plumbing once feature-detection is in place for both Preview and Preprod Lace builds.
- [ ] Smoke-test in Unity; if proving silently delegates to a wallet-managed local proof server, the bundle no longer needs to hit `proof-server.preview.midnight.network` directly.

**Definition of done:** clicking **Increment Counter** in the Unity build produces a confirmed **Midnight Preview** tx against `8c31306d…cd88dd`, `watchForTxData` resolves, and the `round` value updates in the HUD — all without any network call to `proof-server.preview.midnight.network` (after 1.8).

### Phase 2 — Configurable contracts at runtime (2–3 days)

- [ ] Add a `Network` dropdown (Preprod / Preview) to the runtime UI; thread through `connect(network)`.
- [ ] Add a `Contract Address` input field; persist in `PlayerPrefs`.
- [ ] Refactor `MidnightDiagnostics.cs` so the address is no longer a compile-time string.
- [ ] Allow JSON config file `StreamingAssets/midnight-config.json` for headless overrides:
  ```json
  {
    "network": "preprod",
    "indexer": "...",
    "proofServer": "...",
    "contracts": { "counter": "..." }
  }
  ```
- [ ] Surface `serviceUriConfig` in the Unity Inspector for debugging.

**Definition of done:** zero hard-coded contract addresses or RPC URLs in C# or in shipped JS.

### Phase 3 — Multi-contract / “bring your own Compact” framework (3–5 days)

This is the foundation for letting third parties drop in their compiled `.compact` outputs.

- [ ] Define a `IMidnightContract` C# abstraction:
  ```csharp
  public interface IMidnightContract {
      string Name { get; }
      string Address { get; set; }
      Task<JObject> ReadState();
      Task<TxResult> CallCircuit(string name, params object[] args);
  }
  ```
- [ ] JS-side contract registry on `window.MidnightSDK.contracts[name] = { Contract, witnesses, zkPath }`.
- [ ] A loader pattern:
  ```ts
  MidnightSDK.registerContract({
    name: 'counter',
    module: () => import('counter-contract'),
    zkConfigPath: '/TemplateData/zk/counter'
  });
  ```
- [ ] Generic `CallCircuitForUnity(contractName, circuitName, jsonArgs)` jslib entry point — **one** entry point for any contract.
- [ ] Documented “add your contract” flow in `SETUP.md` §8 (already drafted) **plus** a working second example (e.g. `coin-flip` or `voting`) that proves it’s not Counter-specific.
- [ ] Auto-discovery: scan `Assets/StreamingAssets/contracts/*.json` manifests at boot.

**Definition of done:** dropping a folder `StreamingAssets/contracts/my-thing/` containing the `.json` manifest + ZK keys, and a registered npm pkg, makes the contract callable from C# without touching Unity-side code.

### Phase 4 — Midnight settings UX (1 day)

- [ ] In-game settings panel: network, indexer, proof server, contract address, “use local proof server” toggle.
- [ ] “Test connection” button that pings indexer GraphQL and the proof server `/health`.
- [ ] Visual indicator: red/amber/green badges per provider.
- [ ] Persist via `PlayerPrefs`; reset-to-defaults button.

### Phase 5 — Cardano expansion (parallel track, 3–5 days)

Per user request, keep this as a separate track that doesn’t block Midnight work.

- [ ] Multi-asset support in `CardanoBridge.SendAda` → `SendAssets`.
- [ ] Reference scripts (CIP-33) for the counter (smaller txs).
- [ ] Proper coin selection (largest-first → branch-and-bound).
- [ ] Stake delegation API.
- [ ] Unity-side wrapper around `dao-csl.js` for the DAO demo.

### Phase 6 — Production hardening (1–2 days)

- [ ] Replace hard-coded Blockfrost `project_id` with a build-time env var (`#define`-style or `StreamingAssets/secrets.json` not committed).
- [ ] Ship a slim `cardano-only` and `midnight-only` build flag (Unity scripting define) so games not using both chains don’t pay the full payload cost.
- [ ] CI: GitHub Actions building both bundles + headless Unity WebGL build.
- [ ] Tagged release (`v1.0.0-cardano-plutus-v3`, `v1.1.0-midnight-counter`).

---

## 4. “Bring-your-own Compact” — design notes & step-by-step playbook

These are the technical decisions Phase 3 has to nail down. The end-of-section playbook (§4.5) is the **actual step-by-step** another developer can follow today to drop their own Compact contract into this bridge — even before Phase 3 lands the auto-discovery layer.

### 4.1 Where ZK artifacts live

Compact contracts produce `keys/`, `zkir/`, `verifier-keys/`. They are **multi-MB** binary blobs and must be served over HTTP. Two choices:

| Option | Pros | Cons |
|--------|------|------|
| Bundle into `Assets/WebGLTemplates/MidnightTemplate/TemplateData/zk/<name>/` | Always available with the build | Inflates every WebGL build, forces rebuild per contract |
| Serve from `StreamingAssets/zk/<name>/` | Hot-swappable per environment, smaller core build | Needs `Application.streamingAssetsPath` URL plumbing in `createFetchZkConfigProvider` |

Plan: **default to StreamingAssets**, with the template path as a fallback for dev.

### 4.2 Contract package shape (convention)

A drop-in contract package must export:

```ts
// Compact compiler already produces these
export const Contract;            // class with .Contract(witnesses)
export function ledger(data);     // public-state parser
export const witnesses;           // default empty witnesses object
export const circuitNames: string[];  // optional, makes UI dynamic
```

Plus a sibling `manifest.json`:

```json
{
  "name": "counter",
  "version": "1.0.0",
  "circuits": [{ "name": "increment", "args": [] }],
  "publicState": [{ "name": "round", "type": "Counter" }],
  "zkPath": "zk/counter"
}
```

The Unity loader reads the manifest and auto-builds default UI per circuit.

### 4.3 Proof server

Two modes:

- **Wallet-provided** — `serviceUriConfig().proofServer` returns Lace’s built-in proof server. Default for Preprod.
- **Local Docker** — for dev or load-heavy use; documented in `SETUP.md` §9. Override via the settings panel (Phase 4).

### 4.4 Networks

Midnight currently exposes **`preprod`** and **`preview`**. We plumb a `MidnightNetwork` enum end-to-end:

```csharp
public enum MidnightNetwork { Preprod, Preview, Mainnet /* future */ }
```

The string is forwarded to `api.connect(network)` in JS. No mainnet support until officially released.

---

### 4.5 Implementation playbook — adding your own Compact contract today

This is the **step-by-step** for a developer who wants to drop a new Compact contract into this bridge **right now** (before Phase 3 lands the dynamic registry). Counter is the worked example; replace `counter` / `increment` with your names.

#### Step 1 — Compile your `.compact` contract

In a sibling folder (outside this repo, e.g. `~/dev/my-contract/`):

```bash
git clone <your-contract-repo> my-contract
cd my-contract/contract
npm install
npm run build           # invokes compactc +0.30.0
```

This produces:

| Artifact | Path |
|---|---|
| JS bindings (`Contract`, `ledger`, `witnesses`) | `dist/` (CommonJS + ESM) |
| Prover keys | `managed/<name>/keys/<circuit>.prover` |
| Verifier keys | `managed/<name>/keys/<circuit>.verifier` |
| Compact ZKIR | `managed/<name>/zkir/<circuit>.bzkir` (compact binary — **this is what the proof server's `/check` expects**) |
| Full ZKIR | `managed/<name>/zkir/<circuit>.zkir` (full JSON — for tooling, not the proof server) |

> Pin to `compactc +0.30.0` and `@midnight-ntwrk/compact-runtime 0.15.0`. Newer versions emit incompatible artifacts (see §1.5).

#### Step 2 — Vendor the compiled package into the bridge

Copy the build output into `web/midnight-bridge/vendor/<my-contract>/` so it lives inside our esbuild root (cross-filesystem `file:` URLs from WSL break esbuild on Windows):

```bash
# from project root
mkdir -p web/midnight-bridge/vendor/my-contract
cp -r ~/dev/my-contract/contract/dist           web/midnight-bridge/vendor/my-contract/
cp -r ~/dev/my-contract/contract/managed        web/midnight-bridge/vendor/my-contract/
cp    ~/dev/my-contract/contract/package.json   web/midnight-bridge/vendor/my-contract/
```

Add to `web/midnight-bridge/package.json`:

```json
"dependencies": {
  "my-contract": "file:vendor/my-contract"
}
```

Run `npm install --legacy-peer-deps`.

#### Step 3 — Copy ZK artifacts so Unity serves them

```bash
# From repo root
mkdir -p Assets/StreamingAssets/zk/my-contract/{keys,zkir}
cp web/midnight-bridge/vendor/my-contract/managed/my-contract/keys/*       Assets/StreamingAssets/zk/my-contract/keys/
cp web/midnight-bridge/vendor/my-contract/managed/my-contract/zkir/*.bzkir Assets/StreamingAssets/zk/my-contract/zkir/
cp web/midnight-bridge/vendor/my-contract/managed/my-contract/zkir/*.zkir  Assets/StreamingAssets/zk/my-contract/zkir/
```

Unity's WebGL server hosts `StreamingAssets/` at `${origin}/StreamingAssets/`, which is what `FixedZkConfigProvider` already expects.

#### Step 4 — Wire the contract into `midnight-unity-bridge.ts`

```ts
// Top of file
import * as myContract from 'my-contract';
const MyContract = (myContract as any).Contract;
const myWitnesses = (myContract as any).witnesses ?? {};
```

In `setupProviders()`, point the ZK base URL at your contract's folder:

```ts
const zkBaseUrl = `${window.location.origin}/StreamingAssets/zk/my-contract/`;
```

> **TODO Phase 3:** make `zkBaseUrl` a per-contract argument so multiple contracts can coexist. Until then, change the constant when switching contracts.

#### Step 5 — Add a new circuit caller

Model on the existing `incrementCounter()` (`midnight-unity-bridge.ts:~1628`). Pattern:

```ts
export async function myCircuit(): Promise<MyResult> {
  const state = MidnightConnector.getState();
  if (!state.api || !state.walletState) throw new Error('Not connected');

  const providers = await setupProviders();
  const deployed = await (_findDeployedContract as any)({
    contractAddress: MY_CONTRACT_ADDRESS,
    contract: new MyContract(myWitnesses),
    privateStateId: 'myContractPrivateState',
    initialPrivateState: {}
  });
  // call your circuit — args after the circuit name
  const result = await (deployed.callTx as any).myCircuit(...args);
  return { txHash: result.public.txHash, /* ...your fields... */ };
}
```

Export it from `MidnightSDKExports` so Unity can call it via `window.MidnightSDK.myCircuit(...)`.

#### Step 6 — Expose to Unity (C# side)

In `Assets/Plugins/WebGL/MidnightWebGL.jslib` add a new function modeled on `Midnight_IncrementCounter`. In `Assets/Scripts/Midnight/MidnightSDK.cs` add a static `MyCircuit(onSuccess, onError)` that `DllImport`s it. Mirror the existing `IncrementCounter` callback plumbing.

#### Step 7 — Build & smoke test

```bash
cd web/midnight-bridge
npm run build:copy                # bundles + copies into Assets/WebGLTemplates/.../TemplateData/
```

Then in Unity: **File → Build Settings → WebGL → Build**. Serve over HTTP, hard-refresh, connect wallet, call your circuit. Expected console flow (mirrors Counter):

```
[MidnightSDK] FixedZkConfigProvider: Fetched prover key for myCircuit size: …
[MidnightSDK] Calling myCircuit circuit…
[MidnightSDK] balanceUnsealedTransaction: passing hex tx, length: …
[MidnightSDK] submitTx: computed txHash: …
[MidnightSDK] submitTx: wallet accepted tx
```

#### Step 8 — Common gotchas (learned the hard way)

| Symptom | Likely cause |
|---|---|
| `Expected PreTranscript` at `partitionTranscripts` | `build.mjs` `wasmBindgenPlugin` mis-rewrote a snippet — make sure `wasm.X` references resolve to `__bg.X`, not `__wasm_exports.X`. |
| `404` on `.prover` / `.verifier` / `.bzkir` | ZK artifacts not in `Assets/StreamingAssets/zk/<name>/`, or `zkBaseUrl` points at the wrong folder. |
| `400 Bad Request` from proof server `/check` | Sending full `.zkir` JSON instead of compact `.bzkir`. The `get()` method must return `.bzkir` bytes. |
| `Buffer is not a constructor` mid-flight | Some new dependency is calling `new Buffer(n)` and the `globalThis.Buffer` prelude didn't load before that path. Add the polyfill at the top of `midnight-unity-bridge.ts`. |
| `TypeError: ... Received type object` from inside the Lace SW | You forgot to hex-encode the wasm `Transaction` before calling `api.balanceUnsealedTransaction` / `api.submitTransaction`. Use `txToHex(tx)`. |
| `incrementCounter() hangs silently` after `Setting up providers...` | `levelPrivateStateProvider` password too short — must be ≥16 chars + 3 character classes. |
| `Network ID has not been configured` | Call `setNetworkId(...)` once in `setupProviders()` **before** any provider construction, passing the literal wallet network (`'preview'` / `'preprod'`), not `'testnet'`. |
| HUD never shows new state after submit | `watchForTxData` blocks until indexer reports finalization — wait 30–90 s on Preview. If it never resolves, suspect tx flavor mismatch on serialize side; debug with `tx.transactionHash()` + explorer lookup. |

#### Step 9 — (Phase 3) Make it dynamic

The above flow requires touching TS/C#/jslib for each contract. Phase 3 will introduce a registry so a new contract is just:

```ts
MidnightSDK.registerContract({
  name: 'my-contract',
  module: () => import('my-contract'),
  zkConfigPath: '/StreamingAssets/zk/my-contract',
  privateStateId: 'myContractPrivateState'
});
// and from C#:
MidnightSDK.CallCircuit("my-contract", "myCircuit", new object[] { /* args */ });
```

See Phase 3 in §3 for the full spec.

---

## 5. Risks & open questions

1. **Network is Preview, not Preprod.** Live address: `8c31306d…cd88dd`. The old Preprod demo address is dead. All defaults flip to Preview in Phase 1.4.
2. **Version-matrix fragility** (see §1.5). Three known traps validated by the CLI debug session:
   - `^8.x` ledger resolves to 8.1.0 → proofs rejected. Pin to **`8.0.3` exact**.
   - `compactc 0.31.0` (default) emits runtime-0.16.0 artifacts our SDK can't load. Pin to **`+0.30.0`**.
   - `wallet-sdk-address-format` ships a module-load `Symbol`. Multiple npm copies = identity mismatch = `printWalletSummary` crash. **Add `overrides` and verify single copy after `npm install`.**
3. **Indexer path bumped v3 → v4** at the SDK 4.0.4 boundary. Our 2.x bundle still talks v3 — must change before Phase 1 wallet calls land.
4. **Lace API drift** — `dapp-connector-api` 4.0.x; bumps to 4.1+ may rename `balanceUnsealedTransaction` / `balanceTransaction`. Pin minor and pin in `overrides`.
5. **WSL boundary** — the `example-counter` CLI must run in WSL. The Unity bundle is built on Windows. Cross-FS dependencies (`file:\\wsl.localhost\...`) break npm + esbuild — Phase 1.2 vendors compiled artifacts into the Windows repo as a workaround.
6. **WASM bundle size** — `midnight-sdk.bundle.js` is 15 MB. With ledger-v8 it may grow. Look at `esbuild --splitting` + dynamic imports in Phase 6.
7. **ZK key download time** in WebGL — first-time Counter call streams `keys/` + `zkir/` over HTTP. Add a loading UI + cache-busting strategy in Phase 1.3.
8. **Compactc/runtime upgrade path** — when the network moves to ledger 8.1.0 / runtime 0.16.0, drop the `+0.30.0` pin in the vendored contract and bump in lockstep. Track via the support matrix.
9. **Mainnet readiness** — Midnight mainnet APIs / NIGHT economics may shift; do not bake mainnet endpoints in until launch.
10. **Silent SDK pre-conditions (added 2026-05-17).** Several v4.0.4 provider constructors validate inputs lazily and throw asynchronously, where the rejection is then drowned by Unity's rAF loop. Notable: `levelPrivateStateProvider` requires `password.length ≥ 16` **and** ≥3 character classes (uppercase / lowercase / digits / special) — failures look exactly like a hang. **Always wrap provider construction + `findDeployedContract` in a try/catch that pushes errors back to Unity via `SendMessage`**, and surface any pre-condition strings in the HUD. See §3.1 of `handover_01.md` for the password fix.
11. **Browser-vs-Node `Buffer` global (added 2026-05-17 PM).** The esbuild `bufferBanner` we install for Node compatibility creates `globalThis.Buffer` as a plain-object literal exposing `from`/`alloc`/`concat`. Several transitive deps (`browserify-aes`, `browserify-cipher`) call `new Buffer(size)` and explode with `Buffer is not a constructor`. **Mitigation:** import the real `Buffer` class from the `buffer` npm package in the entry-point prelude and overwrite `globalThis.Buffer`. Do not remove the banner — it must run *before* esbuild's import-resolved code, so it serves as a bootstrap that the prelude then upgrades.
12. **Hand-rolled `crypto` shim is a permanent foot-gun (added 2026-05-17 PM).** Our original `src/shims/crypto.js` implemented `createHash('sha256')` + `randomBytes` only. Every new midnight-js minor release adds more node-`crypto` API surface (PBKDF2, HMAC, ciphers, …) and the bundle silently stub-throws at runtime. **Mitigation:** keep `crypto-browserify` as the alias target, never the hand-rolled file. The hand-rolled file is retained only for archaeological reference and should NOT be linked into builds.
13. **Module-singleton `NetworkId` (added 2026-05-17 PM).** `@midnight-ntwrk/midnight-js-network-id` keeps `currentNetworkId` at module scope. **All** downstream packages (ledger-v8, onchain-runtime, contracts, address-format) call `getNetworkId()` and throw if it was never set, with the error surfacing deep inside `findDeployedContract → callTx → scoped4` as a totally unrelated-looking "scoped transaction" failure. **Mitigation:** call `setNetworkId(...)` exactly once, before any provider construction, inside `setupProviders()`. The canonical midnight-js value for the public Preview test network is `'testnet'` — NOT `'preview'`, which is the deployment / env name only.
14. **Lace v4.0.1 omits `getConfiguration()` (added 2026-05-17 PM).** Despite the dApp connector API typings advertising `serviceUriConfig`, the Lace browser extension we tested against (`window.midnight.<uuid>`, provider name `lace`) returns `undefined`. **Mitigation:** `setupProviders()` falls back to hard-coded Preview / Preprod URI defaults. Treat any future `serviceUriConfig` presence as a bonus, not a requirement.
15. **Lace v4 dApp connector is string-based (added 2026-05-19).** All transaction-carrying methods — `balanceUnsealedTransaction`, `balanceSealedTransaction`, `submitTransaction` — take **hex-encoded transaction strings**, not wasm-bindgen `Transaction` objects. Passing the object causes the wallet's internal `Buffer.from(object)` to throw `TypeError: ... Received type object` _from inside the extension's service worker_, with the real stack hidden by `scoped4`'s `{ cause: err }` wrapper. **Mitigation:** the bridge now has `txToHex` / `hexToTransaction` helpers and always serializes at the wallet boundary. Also: `api.submitTransaction(tx: string): Promise<void>` returns `void` while the SDK needs a tx-id for `watchForTxData` — we compute it ourselves via `tx.transactionHash()`. See `handover_01.md` §⭐ Session 03. **Permanent debugging plumbing:** always unwrap `err.cause` recursively in our top-level catch so wrapper frames can't hide the real origin (already added to `incrementCounter()`).
16. **`watchForTxData` finalization wait (added 2026-05-19).** After `submitTx` returns, the SDK blocks the calling promise on `publicDataProvider.watchForTxData(txId)` until the indexer reports the tx finalized. On Preview that's typically 30–90 s. The IncrementCounter button correctly stays disabled and `readCounter()` returns the old value during this window. Surface a **"submitting / awaiting confirmation"** state in the HUD so users don't think the click was lost — Phase 1.7 to-do.

---

## 6. Recommended order of execution

```
Phase 0  ──►  Phase 1  ──►  Phase 2  ──►  Phase 3  ──►  Phase 4
                              │
                              └──►  Phase 5 (Cardano, parallel)
                                            │
                              Phase 6 (hardening, last)
```

If you only have 1 day this week: do **Phase 0** + start **Phase 1** (the bindings hook-up). Everything else can land incrementally.
