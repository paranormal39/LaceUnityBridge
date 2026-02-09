# Midnight Lace Wallet Connector - Unity WebGL (v0)

A Unity WebGL plugin that connects your game to Lace in the browser, detects wallet availability, connects on user request, displays the connected address, and exposes transaction/signing entry points via the Lace DApp Connector.

## Overview

This plugin provides:
- **Wallet Detection**: Detect whether Lace is injected into the page
- **Wallet Connection**: Trigger `enable()` and handle user approval/denial
- **Address Display**: Display the connected address
- **Copy Address**: Copy the full address to the clipboard from WebGL
- **Transaction/Signing Hooks**: Expose `signTx`, `submitTx`, `signData`, `getBalance`, `getUtxos`

Important: Lace can expose **two different APIs** depending on mode/extension:
- **Cardano CIP-30**: `window.cardano.lace` (standard Lace DApp connector)
- **Midnight DApp connector**: typically `window.midnight.<walletName>` (Midnight-specific API)

This project currently connects reliably via **Cardano CIP-30** (because `window.cardano.lace.enable()` is present in your environment). If the Midnight API is available, the JS bridge will use it automatically.

**WebGL only** - This will not work in the Unity Editor or native builds.

---

## Files

```
Assets/
├── Plugins/
│   └── WebGL/
│       └── MidnightWebGL.jslib    # JavaScript bridge (wallet API calls)
└── Scripts/
    └── Midnight/
        ├── MidnightBridge.cs      # C# bindings and UI logic
        ├── MidnightUISetup.cs     # Runtime UI creation helper
        └── README_MidnightSetup.md
```

---

## Features (Current)

### Connection

- Detects Lace injected API.
- Connects only after a user gesture (button click).
- Reports connection result back to Unity.
- Tracks **API mode** used:
  - `cardano`: connected via CIP-30 (`getUsedAddresses`, `signTx`, etc.)
  - `midnight`: connected via Midnight API (`state()` returning shielded address)

### UI (MidnightUISetup)

- Connect/Disconnect button.
- Status text.
- Address display + Copy button.
- Send section:
  - Recipient address
  - Amount (lovelace)
  - Send button

Note: The “Send” button is wired, but **transaction building** is limited (explained below).

## Setup Instructions

### Option A: Automatic UI (Quick Start)

1. Create an empty GameObject in your scene
2. Add the `MidnightUISetup` component to it
3. Build for WebGL
4. The UI will be created automatically at runtime

### Option B: Manual UI Setup

1. Create a Canvas in your scene
2. Add the following UI elements:
   - **Text** for status display
   - **Text** for address display
   - **Button** for connect action
3. Create an empty GameObject named "MidnightBridge"
4. Add the `MidnightBridge` component
5. Assign the UI references in the Inspector:
   - `Status Text` → Your status Text component
   - `Address Text` → Your address Text component
   - `Connect Button` → Your Button component
   - `Connect Button Text` → The Text child of your Button
6. Wire the Button's `OnClick` event to `MidnightBridge.OnConnectButtonClicked()`

---

## Building for WebGL

1. **File → Build Settings**
2. Select **WebGL** platform
3. Click **Switch Platform** (if not already on WebGL)
4. Click **Build** or **Build and Run**

### Recommended WebGL Settings

In **Player Settings → WebGL**:
- **Compression Format**: Gzip (for production) or Disabled (for testing)
- **Memory Size**: 256 MB minimum
- **Enable Exceptions**: Full (for debugging) or None (for production)

---

## Testing

### Prerequisites

1. **Chrome or Firefox** browser
2. **Lace Wallet** browser extension installed
   - Download from: https://www.lace.io/
3. Lace configured for **Midnight testnet**

### Testing Steps

1. Build your WebGL project
2. Host the build on a local server (required for wallet injection):
   ```bash
   # Using Python
   cd Build
   python -m http.server 8080
   
   # Using Node.js
   npx serve Build
   ```
3. Open `http://localhost:8080` in your browser
4. The UI should show "Lace Detected" if the extension is installed
5. Click "Connect Lace" to initiate connection
6. Approve the connection in the Lace popup
7. Your shield address should appear in the UI

If you see a Cardano hex address (and the UI says `Connected (Cardano)`), that’s expected when Lace is exposing the CIP-30 API.

### Common Issues

| Issue | Solution |
|-------|----------|
| "Lace Not Installed" | Install Lace browser extension |
| Connection popup doesn't appear | Check browser popup blocker |
| "User rejected" error | User declined in Lace popup |
| Nothing happens | Check browser console (F12) for errors |

---

## Architecture

```
Unity C# (MidnightBridge.cs)
        ↓
    DllImport
        ↓
WebGL .jslib (MidnightWebGL.jslib)
        ↓
    window.cardano.lace OR window.midnight.*
        ↓
Lace Wallet Extension
        ↓
Midnight Network
```

**Key Points:**
- Unity never handles private keys
- All signing happens in Lace wallet
- Communication is async (JS → Unity via `SendMessage`)

### Data flow (Connect)

- Unity calls JS: `ConnectLace(gameObjectName, successCallback, errorCallback)`
- JS:
  - selects a connector (`window.midnight.*` first if usable, else `window.cardano.lace`)
  - calls `enable()`
  - determines mode:
    - `midnight`: `api.state()` exists
    - `cardano`: `api.getUsedAddresses()` exists
  - returns JSON to Unity:
    - `{ "address": "...", "mode": "cardano|midnight" }`
- JS calls Unity callback via `SendMessage`

---

## API Modes: Cardano vs Midnight

### Cardano CIP-30 mode (`window.cardano.lace`)

- You can:
  - get addresses via `getUsedAddresses()` / `getChangeAddress()`
  - fetch UTXOs via `getUtxos()`
  - sign transactions via `signTx()`
  - submit signed transactions via `submitTx()`
  - sign data via `signData()`

- You cannot (via CIP-30 alone):
  - build a transaction from scratch (UTXO selection + fee calculation + CBOR serialization)

### Midnight mode (`window.midnight.*`)

When Lace exposes the Midnight connector API, it typically includes:
- `enable()` for authorization
- `state()` for wallet state (including shielded address)

This is the mode you want for **tDUST / tNIGHT** workflows and Midnight-specific addresses (shielded/unshielded/DUST addresses).

## API Reference

### MidnightBridge (C#)

```csharp
// Check wallet availability (called automatically on Start)
public void CheckWalletAvailability()

// Initiate connection (call from button)
public void OnConnectButtonClicked()

// Disconnect from wallet
public void Disconnect()

// Properties
public bool IsWalletAvailable { get; }
public bool IsConnectedToWallet { get; }
public string ShieldAddress { get; }
public string WalletMode { get; } // "cardano" or "midnight"
public bool IsMidnightMode { get; }
```

### JavaScript Functions (jslib)

```javascript
// Returns 1 if Lace detected, 0 if not
IsLaceAvailable()

// Async connection - callbacks via SendMessage
ConnectLace(gameObjectName, successCallback, errorCallback)

// Clear wallet reference
DisconnectLace()

// Returns 1 if connected, 0 if not
IsWalletConnected()

// Clipboard helper for WebGL
CopyToClipboard(text)

// Cardano API helpers
GetBalance(gameObjectName, successCallback, errorCallback)
GetUtxos(gameObjectName, successCallback, errorCallback)
SignTransaction(gameObjectName, successCallback, errorCallback, txCborHex, partialSign)
SubmitTransaction(gameObjectName, successCallback, errorCallback, signedTxCborHex)
SignData(gameObjectName, successCallback, errorCallback, addressHex, payloadHex)

// UI convenience helper (best-effort)
BuildAndSendTransaction(gameObjectName, successCallback, errorCallback, recipientAddress, amountLovelace)
```

---

## Transactions: What “Make a Transaction Call” Means Here

There are two separate tasks:

### 1) Build a transaction (create CBOR)

To send funds programmatically you must construct a valid transaction body:
- choose inputs (UTXOs)
- calculate fees
- set outputs + change
- set TTL/validity interval
- serialize CBOR

The CIP-30 connector **does not** define a standard “build tx for me” method. Transaction building is handled by `cardano-serialization-lib` (CSL) 12.x running in the browser.

**Simple payments** are handled by `cardano-bridge.js` using CSL's `TransactionBuilder`.

**Plutus V3 script interactions** (e.g., the Aiken counter dApp) are handled by `increment-counter-csl.js`, which includes:
- Manual `script_data_hash` computation (CSL 12.x is broken for V3)
- Immutable `TransactionBody` reconstruction
- Blockfrost-based ExUnits evaluation
- Proper fee calculation with value conservation

**See:** `Assets/WebGLTemplates/MidnightTemplate/README_PlutusV3_Transaction.md` for the full technical deep-dive on Plutus V3 transaction building.

### 2) Sign + submit a transaction

Once you already have CBOR hex for a transaction:
- call `SignTransaction(...)` → returns signed tx (CBOR hex)
- call `SubmitTransaction(...)` → returns tx hash

This is supported by the current plugin.

## Copy Address

The Copy button calls `CopyToClipboard(...)` in WebGL (using `navigator.clipboard.writeText` with a DOM fallback).

---

## Getting tDUST on Midnight Preview

Midnight Preview token model notes:
- Transactions are paid with **DUST**.
- Holding **NIGHT** generates **DUST**.
- Wallets can have multiple address types (shielded/unshielded/DUST).

To request **tDUST**:

1. Copy your receiving address from Lace.
2. Visit the Midnight faucet:
   - https://midnight.network/test-faucet/
3. Paste your address and request tokens.

If you only see `Connected (Cardano)` in the Unity UI, you’re likely copying a **Cardano** address (hex), which may not be what the Midnight faucet expects. In that case, copy the Midnight address directly from the Lace UI (or ensure Midnight connector injection is available).

Reference:
- https://docs.midnight.network/develop/tutorial/using/faucet

## Troubleshooting

### Browser Console

Open DevTools (F12) and check the Console tab. All plugin messages are prefixed with `[MidnightWebGL]`.

### Unity Console

In the Editor, messages are prefixed with `[MidnightBridge]`. Note that actual wallet functions only work in WebGL builds.

### Wallet API Changes

The Midnight/Lace API may evolve. If connection fails after a Lace update, check:
1. `window.midnight` object structure in browser console
2. Available methods on the API object
3. Update `MidnightWebGL.jslib` accordingly

### Common runtime messages

- `The AudioContext was not allowed to start...`
  - This is a browser autoplay policy warning. It’s unrelated to wallet integration. Ensure audio starts after a user gesture.
- `Wallet API missing state()`
  - Means you connected via CIP-30 (Cardano) API, not Midnight’s API.
- Clipboard failures
  - Some browsers require HTTPS or user gesture for clipboard operations. The plugin includes a fallback, but policies vary.

---

## License

MIT - Use freely in your projects.
