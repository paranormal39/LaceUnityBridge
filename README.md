# MidnightUnityConnector

A Unity WebGL plugin that connects your game to **Cardano** and **Midnight** blockchains via DApp-Connector v4 wallets (**1AM** or **Lace**). Build, sign, and submit transactions — including **Plutus V3 smart contracts on Cardano** and **Compact ZK smart contracts on Midnight** — directly from a Unity WebGL game.

> **Recommended Midnight wallet: [1AM](https://1am.xyz/)** — built natively for Midnight, ships its own hosted proof server, and works out of the box on Preview. Lace is also supported but historically had dust-balancing issues that are fixed in v1.1.0.

> **Confirmed on-chain (Midnight Preview, 2026-05-26):** Counter increment tx [`fcdb34478f…db64`](https://explorer.1am.xyz/tx/fcdb34478f37273a7117301e044954e438d16872f33a1bf716889a4be485db64?network=preview) — built, proved, signed, and submitted from a Unity WebGL build via the 1AM wallet. Counter contract `8c31306d…cd88dd`, increment landed at block 907291.

![Unity](https://img.shields.io/badge/Unity-6000.0.33f1-black?logo=unity)
![Cardano](https://img.shields.io/badge/Cardano-Preprod-blue)
![PlutusV3](https://img.shields.io/badge/Plutus-V3-green)
![License](https://img.shields.io/badge/License-MIT-yellow)

---

## What This Does

- **Connect** to any **DApp-Connector v4 Midnight wallet** (1AM, Lace) — auto-discovery, no wallet hard-coding
- **Connect** to CIP-30 Cardano wallets (Lace, Eternl, Nami) for ADA + Plutus V3
- **Send ADA** payments with automatic UTxO selection and fee calculation
- **Interact with Plutus V3 smart contracts** — full transaction building, ExUnits evaluation, signing, and submission
- **Interact with Midnight ZK smart contracts** — Compact contracts with zero-knowledge proofs, end-to-end build → prove → sign → submit
- **Read on-chain state** — query UTxOs / inline datums from Blockfrost; query Midnight contract state via the indexer's v4 GraphQL API
- **Reference dApps included** — Aiken counter on Cardano, Compact counter on Midnight

> **Cardano on-chain proof:** Plutus V3 increment tx [`484b2f6a…`](https://preprod.cardanoscan.io/transaction/484b2f6a612c8d2a94cf122dde4d4f194bb5310f068103b5423bc877332c2186)  
> **Midnight on-chain proof:** Compact increment tx [`fcdb34478f…`](https://explorer.1am.xyz/tx/fcdb34478f37273a7117301e044954e438d16872f33a1bf716889a4be485db64?network=preview)

---

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| **Unity** | 6000.0.33f1+ (Unity 6) | WebGL build support must be installed |
| **Browser** | Chrome or Firefox | Wallet extensions require a desktop browser |
| **1AM Wallet** | Beta | **Recommended for Midnight.** Install from [1am.xyz](https://1am.xyz/). Native Midnight build, in-browser ZK proving, hosted proof server. |
| **Lace Wallet** | 1.1.0+ | Recommended for Cardano. Install from [lace.io](https://www.lace.io/). Also supports Midnight but pre-1.1.0 versions have a dust-balancer bug (issue #383). |
| **Network** | Cardano Preprod / Midnight Preview | Switch the wallet to the desired testnet in Settings |
| **Test ADA** | — | Get from [Cardano Faucet](https://docs.cardano.org/cardano-testnets/tools/faucet/) |
| **Test tNIGHT / tDUST** | — | Get tNIGHT from [Midnight Faucet](https://midnight.network/test-faucet/). Dust regenerates automatically once NIGHT lands (~5 min cap fill). |
| **Node.js + npm** | 18+ | Required to build `midnight-sdk.bundle.js` from source |

The CSL WASM bundle is pre-built and included. The Midnight SDK bundle (`midnight-sdk.bundle.js`) must be rebuilt from source if you change `web/midnight-bridge/src/midnight-unity-bridge.ts`.

---

## Quick Start

### 1. Clone and Open in Unity

```bash
git clone https://github.com/paranormal39/MidnightUnityConnector.git
```

Open the project in **Unity 6** (6000.0.33f1 or later). If prompted about a version mismatch, click "Continue" — minor version differences are fine.

### 2. Add Components to Your Scene

> **Note:** The project ships with `MidnightTemplate` pre-selected. If you don't see the WebGL tab in Player Settings, ensure WebGL Build Support is installed via Unity Hub.

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

### 3. Rebuild the Midnight SDK Bundle (if needed)

If you modify `web/midnight-bridge/src/midnight-unity-bridge.ts` or any of its dependencies:

```bash
cd web/midnight-bridge
npm install --legacy-peer-deps
npm run build:copy   # builds dist/midnight-sdk.bundle.js + copies to Unity assets
```

Then bump the cache-bust `?v=` in `Assets/WebGLTemplates/MidnightTemplate/index.html` to force browser reload.

### 4. Build for WebGL

1. **File → Build Settings → WebGL → Switch Platform**
2. Click **Build** (or **Build and Run**)
3. Choose an output folder

### 5. Serve and Test

WebGL builds must be served over HTTP (wallet extensions won't inject on `file://`):

```bash
# Python
cd YourBuildFolder
python -m http.server 8080

# Node.js
npx serve YourBuildFolder
```

Open `http://localhost:8080` in Chrome/Firefox with **1AM and/or Lace** installed.

### 6. Connect and Interact

1. Click **Connect Midnight** — approve in the 1AM (or Lace) popup
2. Your shielded address and balances appear in the UI
3. Click **Read Counter** — current on-chain value is displayed
4. Click **Increment Counter** — wallet pops, you sign, tx submits, counter increments
5. Click Read again to verify the on-chain state moved

**For Cardano:** click **Connect Wallet** (Cardano section), approve, then **Increment Counter** for the Plutus V3 path.

---

## Project Structure

```
MidnightUnityConnector/
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

> All pinned to the **Midnight 4.0.x line** because the live Midnight Preview network requires exact versions: ledger-v8 `8.0.3` and compact-runtime `0.15.0`.

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
| Proof server | `https://proof-server.preview.midnight.network` _(public)_ — wallet-provided URI takes precedence. `proverServerUri` is deprecated in v4 in favour of `api.getProvingProvider()` |
| Current build tag | `v1.2.0-midnight-counter-end-to-end` |
| Wallets | Any DApp-Connector v4 wallet under `window.midnight.<key>` — currently **1AM** (recommended) and **Lace 1.1.0+**. All tx methods are **hex-string-based** (DApp-Connector v4 spec) |
| Live counter contract | `8c31306d717dd2b79f30785ae7f0f5241f6f891d63441827395d8be1fecd88dd` |
| Latest successful increment tx | [`fcdb34478f37273a7117301e044954e438d16872f33a1bf716889a4be485db64`](https://explorer.1am.xyz/tx/fcdb34478f37273a7117301e044954e438d16872f33a1bf716889a4be485db64?network=preview) (2026-05-26, block 907291) |

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

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| **No Midnight wallet detected** | Install [1AM](https://1am.xyz/) (recommended) or [Lace 1.1.0+](https://www.lace.io/). After installing, hard-refresh (`Ctrl+Shift+R`) so `window.midnight.*` populates |
| **Nothing happens on Connect** | Check browser console (F12). Must be served over HTTP, not `file://` |
| **"User rejected"** | User declined in the wallet popup — expected behavior |
| **Cardano tx fails** | Open DevTools (F12), look for `[IncrementCSL]` logs. See CSL workarounds table above |
| **"No UTxOs available"** | Fund your wallet from the [Cardano Preprod faucet](https://docs.cardano.org/cardano-testnets/tools/faucet/) |
| **`dustBalance: { cap: 0 }`** | NIGHT not yet registered for dust generation. Top up tNIGHT from the [Midnight faucet](https://midnight.network/test-faucet/) and wait 2–5 min for cap to fill. Dust generates from registered NIGHT UTxOs. |
| **Lace dust shows 0 despite NIGHT balance** | Lace pre-1.1.0 has a dust-balancer bug (issue #383) — upgrade Lace, or switch to **1AM** which is unaffected |
| **`readCounter` returns wrong value** | Hard-refresh and bump `?v=` in `index.html`. The decoder uses `Counter.ledger(contractState.data)` — if you've vendored a different contract, ensure your contract package exports a top-level or namespaced `ledger` function |
| **Stale JS after rebuild** | Bump `?v=` in `index.html` or hard-refresh. WebGL aggressively caches |
| **Wrong network** | Switch the wallet to Preprod (Cardano) or Preview (Midnight) in wallet settings |

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

- [`CUSTOM_CONTRACTS.md`](CUSTOM_CONTRACTS.md) — **Plan & guide** for adding your own Compact contracts to the bridge (status: design proposal, partial implementation)
- [`Assets/Scripts/Cardano/README_CardanoBridge.md`](Assets/Scripts/Cardano/README_CardanoBridge.md) — Cardano bridge API, limitations, milestones
- [`Assets/Scripts/Midnight/README_MidnightSetup.md`](Assets/Scripts/Midnight/README_MidnightSetup.md) — Wallet/Midnight connection setup
- [`Assets/WebGLTemplates/MidnightTemplate/README_PlutusV3_Transaction.md`](Assets/WebGLTemplates/MidnightTemplate/README_PlutusV3_Transaction.md) — Full Plutus V3 transaction building technical deep-dive

**Internal / archived notes** (local-only — the `documents/` folder is git-ignored and not distributed):

- `documents/MILESTONES.md` — historical milestone / progress log
- `documents/ARCHIVE_Midnight_Preprod.md` — pre-Preview "Midnight Preprod Integration" and "Preprod Counter Demo" sections

---

## License

MIT — Use freely in your projects.
