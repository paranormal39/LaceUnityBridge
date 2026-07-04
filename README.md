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

> **Technical details moved** — Transaction flow, C# API reference, configuration, CSL workarounds, and Midnight bridge architecture are in [`documents/technical_documents.md`](documents/technical_documents.md) (local-only, git-ignored).

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

- `documents/technical_documents.md` — Transaction flow, C# API reference, configuration, CSL 12.x workarounds, Midnight bridge dependencies & architecture
- `documents/MILESTONES.md` — historical milestone / progress log
- `documents/ARCHIVE_Midnight_Preprod.md` — pre-Preview "Midnight Preprod Integration" and "Preprod Counter Demo" sections

---

## License

MIT — Use freely in your projects.
