# MidnightUnityConnector — Quick Setup

A short, opinionated guide to get a brand-new clone running end-to-end against **Cardano Preprod** and **Midnight Preview** in under ~20 minutes.

> **Note:** the Midnight side submits real transactions through DApp-Connector v4 wallets (1AM / Lace). If `incrementCounter()` looks stuck after you click it, that's the **`watchForTxData`** awaiting Preview finalization (~30–90 s) — not a hang.

If you only want a high-level project tour, read `README.md` first. This doc is the “do these steps in order” version.

---

## 0. Prereqs (one-time)

| Tool | Version | Why |
|------|---------|-----|
| Unity Hub + Unity **6000.0.33f1** | exact or newer Unity 6 | WebGL build target |
| Node.js | **22.15+** | Needed to (re)build the JS bundles + Compact contracts |
| Docker Desktop | latest | Optional, only required if you want to run a local Midnight proof server |
| Chrome or Firefox | latest | Wallet extension host |
| Lace Wallet | latest | [lace.io](https://www.lace.io/) — enable **Midnight mode** in settings |
| Git | any | Cloning |

Faucets:
- Cardano tADA: <https://docs.cardano.org/cardano-testnets/tools/faucet/>
- Midnight tNIGHT (used to mint tDUST): <https://faucet.preprod.midnight.network>

> The repo ships with **pre-built** JS bundles in `Assets/Plugins/WebGL/` and `Assets/WebGLTemplates/MidnightTemplate/TemplateData/`. You only need Node if you want to rebuild them.

---

## 1. Clone & open in Unity

```powershell
git clone https://github.com/paranormal39/MidnightUnityConnector.git
cd MidnightUnityConnector
```

Open the folder in Unity Hub → it auto-installs WebGL support if missing. If Unity warns about a version mismatch, click **Continue**.

---

## 2. Project Settings (one-time)

> The project ships with **`MidnightTemplate` pre-selected** — you don't need to set it. If you don't see the WebGL tab in Player Settings, install **WebGL Build Support** via Unity Hub.

Optional tweaks for local dev:

1. **Publishing Settings → Compression Format** = `Disabled` (recommended for local dev — avoids `.br` MIME issues)
2. **Other Settings → Color Space** = `Linear` (only if you care about visuals)

---

## 3. Scene wiring

Open `Assets/Scenes/SampleScene.unity`. The fastest path:

1. Create empty GameObject → add component `MidnightUISetup` (auto-builds a runtime UI).
2. Create empty GameObject `MidnightDiagnostics` → add `MidnightDiagnostics` component.
   - Inspector field **Contract Address** is pre-filled with the demo Counter address. Replace once you deploy your own (see §6).
3. (Optional, Cardano) Create `CardanoBridge` GameObject → add `CardanoBridge` component.
4. (Optional) Add `CounterReader` if you want the on-chain Cardano counter polled in the HUD.

---

## 4. Build & serve

```powershell
# Unity → File → Build Settings → WebGL → Switch Platform → Build
# Output to e.g. .\Build\
```

Wallet extensions will not inject on `file://`. Serve over HTTP:

```powershell
# Python
python -m http.server 8080 -d .\Build

# or Node
npx serve .\Build
```

Open <http://localhost:8080> in Chrome/Firefox with Lace installed.

---

## 5. First-run: Cardano Preprod path

1. In Lace, switch to **Preprod** network.
2. Fund the wallet from the Cardano faucet (≥ 10 tADA recommended).
3. In the running build:
   - Click **Connect Wallet (Cardano)** → approve in Lace.
   - Click **Send ADA** to verify a basic CIP-30 tx.
   - Click **Increment Counter** to fire the deployed Plutus V3 Aiken counter (already on-chain — no deploy needed).

Expected console prefixes: `[CardanoBridge]`, `[IncrementCSL]`, `[Evaluate]`.

---

## 6. First-run: Midnight Preprod path

Midnight requires **two** assets you must keep in sync:

1. **A connected Lace wallet in Midnight mode** with tDUST.
2. **A deployed Counter contract address** that the bundle knows about.

### 6.1 Get tDUST

1. Lace → enable Midnight mode → switch to **Preprod**.
2. Copy your Midnight unshielded address (`mn_addr_preprod1...`).
3. Faucet: <https://faucet.preprod.midnight.network> → request tNIGHT.
4. Wait ~5 minutes for tNIGHT → tDUST conversion. Lace shows the balance.

### 6.2 Get a Counter contract

You have two options. **Pick one.**

**Option A — Use the demo contract (fastest, may not be live):**

`d367654634bb80def09c830b373839bd99076c040db135d0d39639d5328a2436`

This is hard-coded in `MidnightDiagnostics.cs`, `midnight-counter.js`, and `midnight-unity-bridge.ts`. If reads fail with “contract not found”, it has been pruned — go to Option B.

**Option B — Deploy your own from the official example (recommended):**

```powershell
# Outside this repo:
git clone https://github.com/midnightntwrk/example-counter.git
cd example-counter

# Install Compact toolchain + deps
npm install
# Build the contract (.compact -> JS bindings + ZK keys)
cd contract
npm run build
cd ../counter-cli
npm install
npm run build

# Start a local proof server (preprod profile)
docker compose -f proof-server.yml up -d

# Run the CLI to deploy
npm start
# Choose: [1] Create wallet → fund from faucet → wait for DUST → [1] Deploy
# Copy the printed contract address.
```

Then in this repo, search-and-replace the demo address everywhere:

```powershell
# (PowerShell) - update the three places
$old = "d367654634bb80def09c830b373839bd99076c040db135d0d39639d5328a2436"
$new = "<YOUR_NEW_ADDRESS>"
(Get-Content Assets\Scripts\Midnight\MidnightDiagnostics.cs) -replace $old,$new | Set-Content Assets\Scripts\Midnight\MidnightDiagnostics.cs
(Get-Content Assets\WebGLTemplates\MidnightTemplate\midnight-counter.js) -replace $old,$new | Set-Content Assets\WebGLTemplates\MidnightTemplate\midnight-counter.js
(Get-Content web\midnight-bridge\src\midnight-unity-bridge.ts) -replace $old,$new | Set-Content web\midnight-bridge\src\midnight-unity-bridge.ts
```

Rebuild the JS bundle (see §7) and re-build the Unity WebGL.

### 6.3 Run

1. In the WebGL build click **🌙 Connect Midnight** → approve in Lace.
2. **Read Counter** → current `round` displays.
3. **Increment Counter** → approve tx in Lace → wait ~3 s → counter updates.

Expected console prefixes: `[MidnightSDK]`, `[MidnightTest]`, `[MidnightWebGL]`, `[MidnightCounter]`.

---

## 7. (Optional) Rebuild the Midnight JS bundle

You only need this if you change `web/midnight-bridge/src/*.ts` or the contract bindings.

```powershell
cd web\midnight-bridge
npm install
npm run build:copy   # builds + copies to Assets/Plugins/WebGL and the WebGL template
```

Other bundles:

| Folder | When to rebuild |
|--------|-----------------|
| `web/midnight-bridge/` | **Active** — Midnight wallet + indexer + counter glue |
| `web/midnight-bundle/` | Legacy/experimental scaffold — slated for removal |
| `web/csl-bundle/` | Only if you upgrade Cardano Serialization Lib |
| `web/mesh-bridge/` | Legacy Mesh experiment — **not used at runtime** |

---

## 8. Wiring your own Compact contract

To swap the Counter for *your* Compact contract:

1. Compile your `.compact` with the Compact toolchain (`npm run build` in your contract folder). This produces:
   - `<MyContract>.cjs` / `.js` with `Contract`, `ledger`, witness types
   - `keys/`, `zkir/`, `verifier-keys/` directories (ZK artifacts)
2. Add it as a dependency in `web/midnight-bridge/package.json`:
   ```json
   "my-contract": "file:../../../my-contract/contract"
   ```
3. In `web/midnight-bridge/src/midnight-unity-bridge.ts`, expose:
   ```ts
   import * as MyContract from 'my-contract';
   (window as any).MidnightSDK.Counter = MyContract;          // or rename to MyContract
   (window as any).MidnightSDK.witnesses = MyContract.witnesses;
   ```
4. `npm run build:copy` to refresh the Unity bundle.
5. Update the contract address in `MidnightDiagnostics.cs` (or wire it through a runtime input field — see [`CUSTOM_CONTRACTS.md`](CUSTOM_CONTRACTS.md)).
6. ZK keys must be **served** by the WebGL host. Place them under `Assets/WebGLTemplates/MidnightTemplate/TemplateData/zk/<contract-name>/` and configure `zkConfigProvider` to read from `/StreamingAssets/zk/...` or the template path.

A worked example (the Counter) lives at `Assets/WebGLTemplates/MidnightTemplate/midnight-counter-bindings.js`.

---

## 9. Network / endpoint configuration

Defaults (Midnight Preprod) are pulled from the Lace wallet itself via `api.serviceUriConfig()` and stored on `window.MidnightBridge.getConfig()`. You can override:

```js
// In browser console after connect:
MidnightBridge.setConfig({
  indexer:    'https://indexer.preprod.midnight.network/api/v1/graphql',
  indexerWS:  'wss://indexer.preprod.midnight.network/api/v1/graphql/ws',
  node:       'https://rpc.preprod.midnight.network',
  proofServer:'http://localhost:6300'   // your local docker proof server
});
```

Cardano endpoints are in `increment-counter-csl.js` (Blockfrost Preprod). Replace the `project_id` with your own from <https://blockfrost.io>.

---

## 10. Troubleshooting cheatsheet

| Symptom | Fix |
|--------|-----|
| `window.midnight` empty | Lace not in Midnight mode — toggle in Lace settings, full reload |
| UUID provider has no `connect()` | Lace is locked, or apiVersion mismatch (we expect `4.0.x`) |
| `Counter contract bindings not bundled` | Re-run `npm run build:copy` in `web/midnight-bridge/` after adding contract pkg |
| `PPViewHashesDontMatch` (Cardano) | Stale CSL bundle — clear browser cache / hard reload |
| Stale JS after rebuild | Use incognito or DevTools → Network → Disable cache |
| `User rejected` | User clicked Reject in Lace — expected |
| `No UTxOs` (Cardano) | Fund from faucet |
| `dust insufficient` (Midnight) | Wait longer for tNIGHT → tDUST, or top up faucet |

Console log prefixes are listed at the bottom of `README.md`.

---

## 11. Where to go next

- `README.md` — full architectural overview
- `CUSTOM_CONTRACTS.md` — guide for wiring your own Compact contracts
- `Assets/WebGLTemplates/MidnightTemplate/README_PlutusV3_Transaction.md` — Cardano deep dive
- `Assets/Scripts/Midnight/README_MidnightSetup.md` — Lace/Midnight specifics
