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
- **Read on-chain state** — query UTxOs, balances, and inline datums from Blockfrost
- **Aiken counter dApp** included as a working reference implementation

> **Confirmed on-chain:** Plutus V3 increment tx [`484b2f6a...`](https://preprod.cardanoscan.io/transaction/484b2f6a612c8d2a94cf122dde4d4f194bb5310f068103b5423bc877332c2186) on Cardano Preprod

---

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| **Unity** | 6000.0.33f1+ (Unity 6) | WebGL build support must be installed |
| **Browser** | Chrome or Firefox | Wallet extensions require a desktop browser |
| **Lace Wallet** | Latest | Install from [lace.io](https://www.lace.io/) |
| **Network** | Cardano Preprod | Switch Lace to Preprod testnet for testing |
| **Test ADA** | — | Get from [Cardano Faucet](https://docs.cardano.org/cardano-testnets/tools/faucet/) |

No Node.js or npm is required to use the project. The CSL WASM bundle is pre-built and included.

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

This template loads the Cardano Serialization Library (CSL), the wallet bridge scripts, and the Plutus V3 increment logic.

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

Open `http://localhost:8080` in Chrome/Firefox with Lace installed.

### 6. Connect and Interact

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

### MidnightBridge

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

### Milestone 3 — Midnight Network Integration 🔜
Connect to Midnight via Lace's Midnight DApp connector. Shielded addresses and tDUST/tNIGHT workflows.

### Milestone 4 — Counter Smart Contract on Midnight 🔜
Deploy the counter on Midnight using Compact. Compare Plutus V3 vs Compact developer experience.

### Milestone 5 — Expanded Cardano System 🔜
Multi-asset support, reference scripts, proper coin selection, stake delegation, multi-wallet.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| **"Lace Not Installed"** | Install Lace browser extension from [lace.io](https://www.lace.io/) |
| **Nothing happens on Connect** | Check browser console (F12). Must be served over HTTP, not `file://` |
| **"User rejected"** | User declined in the Lace popup — expected behavior |
| **Stale JS after rebuild** | Clear browser cache or use incognito. WebGL aggressively caches |
| **Transaction fails** | Open DevTools (F12), look for `[IncrementCSL]` logs. See error table above |
| **"No UTxOs available"** | Fund your wallet from the [Preprod faucet](https://docs.cardano.org/cardano-testnets/tools/faucet/) |
| **Wrong network** | Switch Lace to Preprod testnet in wallet settings |

### Console Log Prefixes

| Prefix | Source |
|--------|--------|
| `[IncrementCSL]` | Plutus V3 transaction flow |
| `[Evaluate]` | Blockfrost tx evaluation |
| `[CardanoBridge]` | Simple payment bridge |
| `[MidnightWebGL]` | Wallet connection |
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
