# LaceUnityBridge

A Unity WebGL plugin that connects your game to **Cardano** and **Midnight** blockchains via the **Lace wallet** browser extension. Build, sign, and submit transactions — including **Plutus V3 smart contract interactions** — directly from a Unity WebGL game.

![Unity](https://img.shields.io/badge/Unity-6000.0.33f1-black?logo=unity)
![Cardano](https://img.shields.io/badge/Cardano-Preprod-blue)
![PlutusV3](https://img.shields.io/badge/Plutus-V3-green)
![License](https://img.shields.io/badge/License-MIT-yellow)

---

## What This Does

- **Connect** to Lace (or Eternl/Nami) wallet from a Unity WebGL game via CIP-30
- **Send ADA** payments with automatic UTxO selection and fee calculation
- **Interact with Plutus V3 smart contracts** — full transaction building, ExUnits evaluation, signing, and submission
- **Interact with Midnight ZK smart contracts** — Compact counter contract with zero-knowledge proofs on Midnight Preview
- **Read on-chain state** — query UTxOs, balances, and inline datums from Blockfrost / Midnight indexer
- **Aiken counter dApp** included as a working reference implementation

> **Confirmed on-chain:** Plutus V3 increment tx [`484b2f6a...`](https://preprod.cardanoscan.io/transaction/484b2f6a612c8d2a94cf122dde4d4f194bb5310f068103b5423bc877332c2186) on Cardano Preprod

---

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| **Unity** | 6000.0.33f1+ (Unity 6) | WebGL build support must be installed |
| **Browser** | Chrome or Firefox | Wallet extensions require a desktop browser |
| **Lace Wallet** | Latest | Install from [lace.io](https://www.lace.io/) |
| **Network** | Cardano Preprod / Midnight Preview | Switch Lace to the desired testnet |
| **Test ADA** | — | Get from [Cardano Faucet](https://docs.cardano.org/cardano-testnets/tools/faucet/) |
| **Test tDUST** | — | Get from [Midnight Faucet](https://midnight.network/test-faucet/) (for Midnight transactions) |
| **Node.js + npm** | 18+ | Required to build `midnight-sdk.bundle.js` from source |

The CSL WASM bundle is pre-built and included. The Midnight SDK bundle (`midnight-sdk.bundle.js`) must be rebuilt from source if you change `web/midnight-bridge/src/midnight-unity-bridge.ts`.

---

## Quick Start

### 1. Clone and Open in Unity

```bash
git clone https://github.com/paranormal39/LaceUnityBridge.git
```

Open the project in **Unity 6** (6000.0.33f1 or later). If prompted about a version mismatch, click "Continue" — minor version differences are fine.

### 2. Select the WebGL Template

1. **Edit → Project Settings → Player → WebGL tab**
2. Under **Resolution and Presentation**, set **WebGL Template** to `MidnightTemplate`

This template loads the Cardano Serialization Library (CSL), the wallet bridge scripts, the Plutus V3 increment logic, and the Midnight SDK bundle.

### 3. Add Components to Your Scene

Open `Assets/Scenes/SampleScene.unity` (or your own scene) and add:

**Option A — Automatic UI (fastest)**
1. Create an empty GameObject
2. Add the `MidnightUISetup` component — it creates all UI at runtime

**Option B — Manual setup**
1. Create a GameObject named `MidnightBridge`
2. Add the `MidnightBridge` component (handles wallet connection)
3. Create another GameObject named `CardanoBridge`
4. Add the `CardanoBridge` component (handles transactions)
5. Optionally add `CounterReader` to read the on-chain counter value

### 4. Rebuild the Midnight SDK Bundle (if needed)

If you modify `web/midnight-bridge/src/midnight-unity-bridge.ts` or any of its dependencies:

```bash
cd web/midnight-bridge
npm install --legacy-peer-deps
npm run build:copy   # builds dist/midnight-sdk.bundle.js + copies to Unity assets
```

Then bump the cache-bust `?v=` in `Assets/WebGLTemplates/MidnightTemplate/index.html` to force browser reload.

### 5. Build for WebGL

1. **File → Build Settings → WebGL → Switch Platform**
2. Click **Build** (or **Build and Run**)
3. Choose an output folder

### 6. Serve and Test

WebGL builds must be served over HTTP (wallet extensions won't inject on `file://`):

```bash
# Python
cd YourBuildFolder
python -m http.server 8080

# Node.js
npx serve YourBuildFolder
```

Open `http://localhost:8080` in Chrome/Firefox with Lace installed.

### 7. Connect and Interact

1. Click **Connect Wallet** — approve in the Lace popup
2. Your address and balance appear in the UI
3. Click **Increment Counter** to submit a Plutus V3 transaction
4. Watch the counter value update on-chain

---

## Project Structure

```
LaceUnityBridge/
├── Assets/
│   ├── Plugins/WebGL/
│   │   ├── CardanoBridgeWebGL.jslib    # Unity ↔ JS interop (Cardano)
│   │   └── MidnightWebGL.jslib         # Unity ↔ JS interop (Midnight/Lace)
│   ├── Scripts/
│   │   ├── Cardano/
│   │   │   ├── CardanoBridge.cs        # C# API: wallet, payments, Plutus tx
│   │   │   └── README_CardanoBridge.md # Cardano bridge docs + milestones
│   │   └── Midnight/
│   │       ├── MidnightBridge.cs       # C# API: Lace connection, UI callbacks
│   │       ├── MidnightUISetup.cs      # Auto-creates UI at runtime
│   │       ├── CounterReader.cs        # Reads counter datum from Blockfrost
│   │       └── README_MidnightSetup.md # Midnight/Lace setup docs
│   └── WebGLTemplates/
│       └── MidnightTemplate/
│           ├── index.html                      # WebGL template (loads all scripts)
│           ├── cardano-bridge.js               # Simple ADA payments via CSL
│           ├── increment-counter-csl.js        # Plutus V3 increment tx (main logic)
│           ├── init-counter-csl.js             # Counter initialization tx
│           ├── README_PlutusV3_Transaction.md   # Deep-dive technical docs
│           └── TemplateData/
│               ├── csl.bundle.js               # CSL 12.x WASM bundle
│               ├── csl-loader.js               # CSL initialization
│               └── cardano_serialization_lib_bg.wasm  # CSL WASM binary
├── web/
│   ├── csl-bundle/         # Source for building csl.bundle.js (optional)
│   └── mesh-bridge/        # MeshJS bridge (legacy, not used for Plutus V3)
├── ProjectSettings/        # Unity project settings
├── Packages/               # Unity package manifest
└── .gitignore
```

---

## How It Works

```
Unity C# (CardanoBridge.cs / MidnightBridge.cs)
    │  DllImport calls
    ▼
.jslib Plugins (CardanoBridgeWebGL.jslib)
    │  window.CardanoBridge / window.IncrementCounterCSL
    ▼
JavaScript (increment-counter-csl.js / cardano-bridge.js)
    │
    ├── CIP-30 Wallet API ──→ Lace extension (sign, submit)
    ├── Blockfrost API ─────→ UTxO queries, protocol params, tx evaluation
    └── CSL 12.x (WASM) ───→ CBOR serialization, address parsing, tx building
```

**Key principle:** Unity never touches private keys. All signing happens inside the Lace wallet extension. Unity builds the unsigned transaction, the wallet signs it, and the wallet submits it.

### Transaction Flow (Plutus V3)

1. **Query** — Fetch script UTxO (current counter), wallet UTxOs, protocol params
2. **Build** — Construct tx with placeholder ExUnits, manual `script_data_hash`
3. **Evaluate** — Send to Blockfrost for real ExUnits (memory + CPU)
4. **Rebuild** — Reconstruct tx with correct ExUnits, fee, and adjusted change output
5. **Sign** — Wallet adds vkey witness via CIP-30 `signTx`
6. **Submit** — Wallet submits to network via CIP-30 `submitTx`

For the full technical deep-dive, see [`README_PlutusV3_Transaction.md`](Assets/WebGLTemplates/MidnightTemplate/README_PlutusV3_Transaction.md).

---

## C# API Reference

### CardanoBridge

```csharp
// Singleton access
CardanoBridge.Instance

// Connect wallet (must be called from a button click)
CardanoBridge.Instance.ConnectWallet("lace");

// Events
OnWalletConnected      += (result) => { /* result.changeAddress, result.networkName */ };
OnWalletConnectionFailed += (error) => { };
OnTransactionSuccess   += (result) => { /* result.txHash */ };
OnTransactionFailed    += (error) => { };
OnBalanceReceived      += (balance) => { /* lovelace string */ };

// Send ADA
CardanoBridge.Instance.SendAda("addr_test1q...", 5.0m);

// Get balance
CardanoBridge.Instance.GetBalance();

// Increment Plutus V3 counter
CardanoBridge.Instance.IncrementCounter();
```

### MidnightSDK (New Static API)

```csharp
// Initialize and detect wallet
MidnightSDK.Initialize(
    onReady: () => Debug.Log("Wallet detected!"),
    onWalletNotFound: () => Debug.Log("Install Lace")
);

// Connect to Midnight Preprod
MidnightSDK.Connect(
    onSuccess: wallet => Debug.Log($"Connected: {wallet.Address}"),
    onError: error => Debug.LogError(error)
);

// Get tDUST balance
MidnightSDK.GetBalance(
    onSuccess: balance => Debug.Log($"Balance: {balance.NativeFormatted}"),
    onError: error => Debug.LogError(error)
);

// Counter contract operations
MidnightSDK.ReadCounter(
    onSuccess: result => Debug.Log($"Counter: {result.Counter}"),
    onError: error => Debug.LogError(error)
);

MidnightSDK.IncrementCounter(
    onSuccess: result => Debug.Log($"New value: {result.Counter}, TX: {result.TxHash}"),
    onError: error => Debug.LogError(error)
);

// Properties
MidnightSDK.IsConnected        // bool
MidnightSDK.IsWalletAvailable  // bool
MidnightSDK.Wallet             // WalletInfo (Address, Mode, Network)
MidnightSDK.CurrentState       // State enum

// Events
MidnightSDK.OnConnected += wallet => { };
MidnightSDK.OnDisconnected += () => { };
MidnightSDK.OnError += error => { };
```

### MidnightBridge (Legacy UI)

```csharp
// Properties
MidnightBridge.Instance.IsWalletAvailable   // bool
MidnightBridge.Instance.IsConnectedToWallet // bool
MidnightBridge.Instance.WalletMode          // "cardano" or "midnight"

// Connect (from button click)
MidnightBridge.Instance.OnConnectButtonClicked();
```

### CounterReader

```csharp
// Reads the current counter value from the script UTxO's inline datum
// Automatically polls Blockfrost for updates
```

---

## Configuration

### Blockfrost API Key

The project uses a **Preprod** Blockfrost API key hardcoded in `increment-counter-csl.js`. For production or heavy usage, replace it with your own key:

1. Sign up at [blockfrost.io](https://blockfrost.io/)
2. Create a Preprod project
3. Replace the `project_id` value in `increment-counter-csl.js`

### Smart Contract

The Aiken counter contract is already deployed on Preprod:

| Property | Value |
|----------|-------|
| **Script Address** | `addr_test1wq0666pyk48q4v2zgjgdd4fuzn3xg2lzhsvueduvjxjuksqc7yh2n` |
| **Script Hash** | `1fad6824b54e0ab1424490d6d53c14e2642be2bc19ccb78c91a5cb40` |
| **Plutus Version** | V3 (Aiken v1.1.21) |
| **Datum** | Plain CBOR integer (inline datum) |
| **Redeemer** | `Constr 0 []` (Increment action) |

To deploy your own contract, compile with [Aiken](https://aiken-lang.org/) and update the script address and CBOR hex in `MidnightBridge.cs`.

---

## Known CSL 12.x Workarounds

These are critical issues we solved that anyone using CSL 12.x with PlutusV3 will encounter:

| Issue | Symptom | Solution |
|-------|---------|----------|
| **Broken `hash_script_data`** | `PPViewHashesDontMatch` | Manual blake2b-256 computation of `script_data_hash` |
| **Immutable `TransactionBody`** | `set_fee is not a function` | Rebuild body via `new_tx_body()` constructor |
| **TTL lost on rebuild** | `TTL is 0` | Use `set_ttl(BigNum)` instead of constructor param |
| **Fee change breaks value** | `ValueNotConservedUTxO` | Adjust change output by `oldFee - newFee` |
| **Cost model ordering** | Wrong `script_data_hash` | Preserve Blockfrost insertion order, don't sort |
| **Unwanted witness datums** | `NonOutputSupplimentaryDatums` | Strip `plutus_data` from witness set for inline datums |

Full details in [`README_PlutusV3_Transaction.md`](Assets/WebGLTemplates/MidnightTemplate/README_PlutusV3_Transaction.md).

---

## Milestones

### Milestone 1 — Cardano CIP-30 Wallet Connection ✅
Detect and connect to Lace/Eternl/Nami, display address/balance, send ADA payments.

### Milestone 2 — Plutus V3 Smart Contract Interaction ✅
Full Aiken counter dApp increment from Unity WebGL. Confirmed on-chain on Preprod.

### Milestone 3 — Midnight Network Integration ✅
Connect to Midnight Preprod via Lace's Midnight DApp Connector API v4.0.x. Shielded addresses, tDUST balance, and configuration retrieval.

### Milestone 4 — Counter Smart Contract on Midnight � _ALMOST COMPLETE — tx flow fixed, pending dust + live network test_
Read **and** increment the live Counter contract on **Midnight Preview** at `8c31306d…cd88dd`. Unity C# API: `MidnightSDK.ReadCounter()`, `MidnightSDK.IncrementCounter()`.

- ✅ `ReadCounter()` — queries indexer v4 GraphQL, returns the on-chain `round`.
- ✅ `IncrementCounter()` builds → balances → signs → submits a hex-encoded transaction via Lace v4. First on-chain submit (2026-05-19): [`2f0ee3e3…e8f4`](https://explorer.preview.midnight.network/transactions/2f0ee3e3fb0d5c57622797a45493709210e9b27cec44b3dac6b432d74fc0e8f4).
- ✅ **Session 05 fixes (2026-05-22):**
  - `submitTransaction` returning `undefined` = **success** (per v4 spec), not failure
  - Removed broken `balanceSealedTransaction` step — `balanceUnsealedTransaction` already returns a fully sealed tx
  - Added `getTxHistory()` post-submission lookup to capture the wallet's canonical txHash
  - Tagged: `v1.1.0-midnight-counter-almost-complete`
- 🟡 **Pending:** One more live test with valid tDUST balance to confirm the counter increments on-chain. `publicDataProvider.watchForTxData(txId)` can hang indefinitely — **mitigation:** 2-minute timeout + manual `ReadCounter()` polling fallback.

> **Key learning during the 2026-05-19 fix:** Lace dApp connector **v4** is **string-based** — `balanceUnsealedTransaction` / `submitTransaction` take hex-encoded transaction *strings*, not the raw wasm-bindgen `Transaction` object. The bridge serializes (`tx.serialize()` → hex) at the wallet boundary. See `handover_01.md` §⭐ Session 03 for the root-cause walkthrough.

> **Key learning during the 2026-05-22 fix:** `balanceSealedTransaction` is for adding MORE balance to an already-sealed tx, not a required second step. Calling it after `balanceUnsealedTransaction` shuts down the wallet's RemoteApi channel (`RemoteApiShutdownError`).

### Milestone 5 — Expanded Cardano System 🔜
Multi-asset support, reference scripts, proper coin selection, stake delegation, multi-wallet.

---

## Midnight Bridge — Dependencies & Architecture

The Midnight side is the "complex" half of the bridge. This section exists so you can see **exactly what is bundled into `midnight-sdk.bundle.js`** and read up on each piece without spelunking through `web/midnight-bridge/`.

### High-level diagram

```
Unity C# (MidnightSDK.cs / MidnightDiagnostics.cs)
   │  DllImport
   ▼
Assets/Plugins/WebGL/MidnightWebGL.jslib
   │  window.MidnightSDK.<fn>
   ▼
midnight-sdk.bundle.js (built from web/midnight-bridge/src/midnight-unity-bridge.ts)
   │
   ├── Lace wallet (window.midnight.<uuid>)  ← signs + submits tx
   ├── Indexer GraphQL (preview.midnight.network/api/v4/graphql)
   ├── Proof server (proving.preview.midnight.network)
   └── Local StreamingAssets/zk/counter/      ← verifier + prover keys
```

The bundle is a single ~19 MB IIFE that exposes `window.MidnightSDK`. All Node-isms (`Buffer`, `process`, `crypto`, `stream`, `fs`, `path`, `assert`) are polyfilled at build time by `web/midnight-bridge/build.mjs`.

### Midnight Network packages (the actual SDK)

> All pinned to the **Midnight 4.0.x line** because the live Preview network runs ledger-v8 `8.0.3`. See `PROJECT_PLAN.md` §1.5 for why every version below matters.

| Package | Version | Role | Docs |
|---|---|---|---|
| `@midnight-ntwrk/dapp-connector-api` | `4.0.1` | TypeScript types for the wallet ↔ dApp protocol (`connect`, `enable`, `getShieldedAddresses`, `submitTransaction`, etc.). | [docs.midnight.network](https://docs.midnight.network/develop/tutorial/building/dapp-connector) |
| `@midnight-ntwrk/ledger-v8` | **`8.0.3` exact** | Rust→WASM core ledger. CBOR-encodes / signs / hashes transactions. Pinned exact — `^8.x` resolves to 8.1.0 which the live network rejects. | [npm](https://www.npmjs.com/package/@midnight-ntwrk/ledger-v8) |
| `@midnight-ntwrk/onchain-runtime` | (transitive) | Compact circuit execution runtime; bundled via `ledger-v8`. | — |
| `@midnight-ntwrk/compact-runtime` | **`0.15.0` exact** | The runtime Compact circuits target. Must match the `compactc +0.30.0` output our vendored contract was compiled with. | [Compact docs](https://docs.midnight.network/develop/tutorial/building/compact) |
| `@midnight-ntwrk/midnight-js-contracts` | `^4.0.4` | High-level `findDeployedContract` / `callTx` helpers. This is what `incrementCounter()` ultimately drives. | [GitHub](https://github.com/midnightntwrk/midnight-js) |
| `@midnight-ntwrk/midnight-js-indexer-public-data-provider` | `^4.0.4` | Talks v4 GraphQL to `indexer.preview.midnight.network/api/v4/graphql` to read on-chain state. | [GitHub](https://github.com/midnightntwrk/midnight-js) |
| `@midnight-ntwrk/midnight-js-fetch-zk-config-provider` | `^4.0.4` | Loads ZK prover keys + verifier keys + IR over HTTP. We point it at `StreamingAssets/zk/counter/`. | [GitHub](https://github.com/midnightntwrk/midnight-js) |
| `@midnight-ntwrk/midnight-js-http-client-proof-provider` | `^4.0.4` | Sends unproven txs to the remote proof server (`proving.preview.midnight.network`) — proof generation cannot run in-browser. | [GitHub](https://github.com/midnightntwrk/midnight-js) |
| `@midnight-ntwrk/midnight-js-level-private-state-provider` | `^4.0.4` | Persists per-account private state + signing keys in browser **IndexedDB** (via `level`). Encrypts at rest with PBKDF2-derived key. **Requires password ≥ 16 chars + 3 character classes.** | [npm](https://www.npmjs.com/package/@midnight-ntwrk/midnight-js-level-private-state-provider) |
| `@midnight-ntwrk/midnight-js-network-id` | `^4.0.4` | Tiny helper that resolves `preview` / `preprod` / `mainnet` → network-id constants. | — |
| `@midnight-ntwrk/midnight-js-types` | `^4.0.4` | Shared TS interfaces for all the providers above. | — |
| `@midnight-ntwrk/wallet-sdk-address-format` | **`3.1.1` exact (+ npm `overrides`)** | bech32m encoding of Midnight shielded addresses. **Module-load `Symbol`** — must dedupe to one copy or `printWalletSummary` crashes with identity-mismatch. | [npm](https://www.npmjs.com/package/@midnight-ntwrk/wallet-sdk-address-format) |
| `@midnight-ntwrk/counter-contract` | `file:vendor/counter-contract` | The vendored compiled output of the example Compact counter contract — `Contract`, `witnesses`, `ledger`, plus ZK keys. **Compiled with `compactc +0.30.0`.** | [example-counter repo](https://github.com/midnightntwrk/example-counter) |
| `@meshsdk/midnight-setup` | `^1.9.0-beta.98` | Installed but **unused at runtime** (its `dist/` is missing). Code falls back to wallet API directly. Candidate for removal. | [meshjs.dev](https://meshjs.dev/) |

### Browser polyfills (Node std-lib → browser)

These exist purely because the Midnight SDK was written assuming Node. The aliases live in `web/midnight-bridge/build.mjs`.

| Node API | Browser provider | Why we need it |
|---|---|---|
| `crypto` | **`crypto-browserify`** | `pbkdf2Sync`, `createHmac`, `createCipheriv` / `createDecipheriv`, `createHash`, `randomBytes` — all used by the level private-state provider for AES-CBC + PBKDF2 storage encryption. _(Previously a hand-rolled stub — was the cause of `crypto.pbkdf2Sync not available` errors.)_ |
| `stream` | `stream-browserify` | Used by `level` / `abstract-level` for reading IndexedDB streams. |
| `buffer` | `buffer/` | `Buffer.from`, `Buffer.concat`, etc., for CBOR encoding. |
| `events` | `events/` | Node `EventEmitter` for the indexer GraphQL subscription client. |
| `fs`, `path`, `assert` | `src/shims/*.js` | Tiny stubs — only touched on import paths that never actually execute in the browser. |
| `process`, `global` | Banner in `build.mjs` | Tiny inline polyfill: `process.env.NODE_ENV='production'`, `process.browser=true`, `globalThis.global=globalThis`. |

### WASM handling

`@midnight-ntwrk/ledger-v8` ships two wasm-bindgen modules (`midnight_ledger_wasm`, `midnight_onchain_runtime_wasm`). The total inlined size is > 8 MB, which Chrome refuses to compile synchronously on the main thread. The custom `wasmBindgenPlugin` in `build.mjs` rewrites these to:

- **Async** `WebAssembly.compile` / `instantiate` when the wasm is ≥ 4 MB.
- **Sync** `new WebAssembly.Module` / `new WebAssembly.Instance` when smaller (some downstream code reads exports synchronously right after init).
- **Base64-inlined** so there's a single `.bundle.js` file — no separate `.wasm` to host or CORS.

### ZK artifacts (served, not bundled)

The verifier + prover keys are too large to inline and live in `Assets/StreamingAssets/zk/counter/`:

| File | Purpose |
|---|---|
| `keys/increment.prover` | Prover key — used by the remote proof server to generate the ZK proof. |
| `keys/increment.verifier` | Verifier key — checked on-chain. |
| `zkir/increment.bzkir` + `zkir/increment.zkir` | Circuit IR. |

These are copied verbatim from `node_modules/@midnight-ntwrk/counter-contract/managed/counter/`. Unity serves `StreamingAssets/` from the WebGL build root, so the bundle fetches them from `${origin}/StreamingAssets/zk/counter/`.

### Environment endpoints (Preview)

| Service | URL |
|---|---|
| Indexer GraphQL | `https://indexer.preview.midnight.network/api/v4/graphql` |
| Indexer WS | `wss://indexer.preview.midnight.network/api/v4/graphql` |
| Proof server | `https://proof-server.preview.midnight.network` _(public)_ — wallet-provided URI takes precedence. `proverServerUri` is deprecated in v4 in favour of `api.getProvingProvider()` (see PROJECT_PLAN §1.8) |
| Current build tag | `v1.1.0-midnight-counter-almost-complete` |
| Wallet | Lace browser extension (`window.midnight.<uuid>`) — **v4 dApp-connector API: all tx methods are hex-string-based** (see PROJECT_PLAN §5.15) |
| Live counter contract | `8c31306d717dd2b79f30785ae7f0f5241f6f891d63441827395d8be1fecd88dd` |
| First successful increment tx | [`2f0ee3e3fb0d5c57622797a45493709210e9b27cec44b3dac6b432d74fc0e8f4`](https://explorer.preview.midnight.network/transactions/2f0ee3e3fb0d5c57622797a45493709210e9b27cec44b3dac6b432d74fc0e8f4) |

### Build commands

```bash
cd web/midnight-bridge
npm install --legacy-peer-deps   # peer conflict between meshsdk and dapp-connector-api 4.x
npm run build                    # produces dist/midnight-sdk.bundle.js
npm run build:copy               # builds + copies into Assets/WebGLTemplates/MidnightTemplate/TemplateData/
```

After `build:copy`, bump the cache-bust `?v=` in `Assets/WebGLTemplates/MidnightTemplate/index.html` (or hard-refresh).

### Recommended reading order (if you want to actually understand it)

1. [Midnight DApp Connector tutorial](https://docs.midnight.network/develop/tutorial/building/dapp-connector) — what `connect()`, `enable()`, `getShieldedAddresses()` do.
2. [Compact language tour](https://docs.midnight.network/develop/tutorial/building/compact) — how the counter contract is written.
3. [`@midnight-ntwrk/midnight-js` README](https://github.com/midnightntwrk/midnight-js) — providers, `findDeployedContract`, `callTx`.
4. [`example-counter`](https://github.com/midnightntwrk/example-counter) — the reference dApp our bridge mirrors.
5. `PROJECT_PLAN.md` §1.5 (this repo) — version-pin matrix and the traps we've already hit.
6. `handover_01.md` (this repo) — the session-by-session debug log.

---

## Midnight Preprod Integration

> ⚠️ **Note:** The text below predates the 2026-05-16 switch to Midnight **Preview**. The live counter is on **Preview** at `8c31306d…cd88dd`. Treat the "Preprod" references below as illustrative — defaults in code now point at Preview.

This project now supports **Midnight Preprod** network as a completely separate adapter from Cardano.

### Architecture

```
Unity C# (MidnightDiagnostics.cs)
    ↓
MidnightWebGL.jslib (MidnightPreprod_* functions)
    ↓
midnight-bridge.js
    ↓
midnight.bundle.js (bundled npm dependencies)
    ↓
window.midnight.mnLace
    ↓
Midnight Preprod Network
```

**Cardano and Midnight are completely separate pipelines:**

| Aspect | Cardano | Midnight |
|--------|---------|----------|
| **Wallet API** | `window.cardano.lace` (CIP-30) | `window.midnight.mnLace` |
| **Connection** | `enable()` | `connect('preprod')` |
| **Addresses** | `getUsedAddresses()` | `getShieldedAddresses()` |
| **Tx Building** | CSL + Blockfrost | Compact + Wallet Prover |
| **Contract Lang** | Plutus/Aiken | Compact |

### Installing Lace Midnight Preview

1. Install **Lace Wallet** from [lace.io](https://www.lace.io/)
2. Enable **Midnight mode** in Lace settings
3. Switch to **Preprod** network
4. Request **tDUST** from [Midnight Faucet](https://midnight.network/test-faucet/)

### Target Contract

| Property | Value |
|----------|-------|
| **Network** | Preprod |
| **Contract Address** | `d367654634bb80def09c830b373839bd99076c040db135d0d39639d5328a2436` |
| **Contract** | Counter |
| **Public State** | `round` |
| **Circuit** | `increment()` |

### Building midnight.bundle.js

```bash
cd web/midnight-bundle
npm install
npm run build          # builds dist/midnight.bundle.js
npm run build:copy     # builds + copies to Unity assets
```

### Testing in Unity WebGL

1. Add `MidnightDiagnostics` component to a GameObject
2. Build for WebGL with `MidnightTemplate`
3. Serve over HTTP (not `file://`)
4. Click **Connect** to connect to Midnight Preprod
5. Shielded address and configuration will display

### API Flow

```javascript
// 1. Detect wallet
window.midnight.mnLace  // must exist

// 2. Connect to preprod
const api = await window.midnight.mnLace.connect('preprod');

// 3. Get wallet info
const status = await api.getConnectionStatus();
const addresses = await api.getShieldedAddresses();
const config = await api.getConfiguration();

// 4. Contract interaction (requires midnight.bundle.js)
// - Join contract
// - Read state via indexer
// - Build tx, balance & prove via wallet, submit
```

### Security Warning

⚠️ **Never publish wallet seed phrases in repositories or documentation.**

All signing happens inside the Lace wallet extension. Unity never handles private keys.

---

## Midnight Preprod Counter Demo

This demo shows how to interact with a deployed Counter smart contract on Midnight Preprod.

### Contract Details

| Field | Value |
|-------|-------|
| **Network** | Preprod |
| **Contract Address** | `d367654634bb80def09c830b373839bd99076c040db135d0d39639d5328a2436` |
| **Public State** | `round: Counter` |
| **Circuit** | `increment()` |

### Manual Test Steps

1. **Connect to Wallet**
   - Click the **🌙 Midnight Test** button (top-left)
   - Click **Connect Midnight**
   - Approve the connection in Lace Midnight Preview
   - Console should show `[MidnightTest]` logs with `connected: true, authorized: true`

2. **Read Counter**
   - Click **Read Counter** in Unity UI
   - Current `round` value displays
   - No wallet connection required for reading

3. **Increment Counter**
   - Must be connected first
   - Click **Increment Counter**
   - Approve the transaction in Lace
   - Wait for confirmation (~3 seconds)
   - New counter value displays

### Console Commands

```javascript
// Connect with two-phase authorization
await MidnightSDK.connectPreprod()

// Read counter (no connection required)
await MidnightSDK.readCounter()

// Increment counter (requires connection)
await MidnightSDK.incrementCounter()

// Check connection status
MidnightSDK.isConnected()
MidnightSDK.isAuthorized()
```

### Two-Phase Authorization

The Midnight DApp Connector requires two phases:

1. **`connect('preprod')`** - Establishes connection to the network
2. **`enable()`** - Authorizes API calls (if "Unauthorized request origin" error)

`MidnightSDK.connectPreprod()` handles both phases automatically.

### Console Log Prefixes

| Prefix | Source |
|--------|--------|
| `[MidnightSDK]` | TypeScript SDK (midnight-unity-bridge.ts) |
| `[MidnightTest]` | Midnight connect diagnostic |
| `[MidnightWebGL]` | Unity .jslib bridge |
| `[CardanoTest]` | Cardano CIP-30 test (separate) |

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| **"Lace Not Installed"** | Install Lace browser extension from [lace.io](https://www.lace.io/) |
| **Nothing happens on Connect** | Check browser console (F12). Must be served over HTTP, not `file://` |
| **"User rejected"** | User declined in the Lace popup — expected behavior |
| **Transaction fails** | Open DevTools (F12), look for `[IncrementCSL]` logs. See error table above |
| **"No UTxOs available"** | Fund your wallet from the [Preprod faucet](https://docs.cardano.org/cardano-testnets/tools/faucet/) |
| **Dust balance shows 0** | Resync Lace wallet (toggle Midnight Preview off/on) or top up tDUST from the [Midnight faucet](https://midnight.network/test-faucet/). Dust is required for Midnight tx fees |
| **Stale JS after rebuild** | Bump `?v=` in `index.html` or hard-refresh. WebGL aggressively caches |
| **Wrong network** | Switch Lace to Preprod or Preview testnet in wallet settings |

### Console Log Prefixes

| Prefix | Source |
|--------|--------|
| `[MidnightSDK]` | Midnight SDK TypeScript bridge (`midnight-unity-bridge.ts`) |
| `[MidnightWebGL]` | Unity .jslib bridge |
| `[MidnightConnector]` | Lace provider discovery & connection |
| `[IncrementCSL]` | Plutus V3 transaction flow |
| `[Evaluate]` | Blockfrost tx evaluation |
| `[CardanoBridge]` | Simple payment bridge |
| `[CounterReader]` | On-chain counter reading |

---

## Browser Compatibility

| Browser | Status |
|---------|--------|
| **Chrome / Edge** | ✅ Full support |
| **Firefox** | ✅ Full support |
| **Safari** | ⚠️ May have WASM issues |
| **Mobile** | ❌ No wallet extensions |

---

## Further Documentation

- [`Assets/Scripts/Cardano/README_CardanoBridge.md`](Assets/Scripts/Cardano/README_CardanoBridge.md) — Cardano bridge API, limitations, milestones
- [`Assets/Scripts/Midnight/README_MidnightSetup.md`](Assets/Scripts/Midnight/README_MidnightSetup.md) — Lace/Midnight connection setup
- [`Assets/WebGLTemplates/MidnightTemplate/README_PlutusV3_Transaction.md`](Assets/WebGLTemplates/MidnightTemplate/README_PlutusV3_Transaction.md) — Full Plutus V3 transaction building technical deep-dive

---

## License

MIT — Use freely in your projects.
