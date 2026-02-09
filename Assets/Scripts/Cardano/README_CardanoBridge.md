# Cardano CIP-30 Bridge for Unity WebGL

Pure CSL + CIP-30 implementation for Cardano wallet interactions in Unity WebGL.
**No MeshJS dependency** - uses cardano-serialization-lib (CSL) directly from CDN.

## Architecture

```
Unity C# (CardanoBridge.cs)
    ↓ DllImport
CardanoBridgeWebGL.jslib
    ↓ window.CardanoBridge
cardano-bridge.js (CSL + CIP-30)
    ↓
Lace/Eternl/Nami wallet (CIP-30 API)
```

## Files

| File | Location | Purpose |
|------|----------|---------|
| `cardano-bridge.js` | WebGLTemplates/MidnightTemplate/ | JS bridge with CSL tx building |
| `CardanoBridgeWebGL.jslib` | Plugins/WebGL/ | Unity ↔ JS interop |
| `CardanoBridge.cs` | Scripts/Cardano/ | C# API for Unity |

## Script Load Order (index.html)

```html
<!-- 1. CSL WASM from CDN -->
<script src="https://unpkg.com/@emurgo/cardano-serialization-lib-browser@12.0.0/cardano_serialization_lib.js"></script>

<!-- 2. Cardano Bridge -->
<script src="cardano-bridge.js"></script>

<!-- 3. Initialize -->
<script>
  await window.CardanoBridge.init();
</script>

<!-- 4. Unity loader (last) -->
```

## Unity C# Usage

### Setup

Add `CardanoBridge` component to a GameObject in your scene:

```csharp
// CardanoBridge is a singleton - access via Instance
var bridge = CardanoBridge.Instance;

// Subscribe to events
bridge.OnWalletConnected += OnConnected;
bridge.OnWalletConnectionFailed += OnConnectionFailed;
bridge.OnTransactionSuccess += OnTxSuccess;
bridge.OnTransactionFailed += OnTxFailed;
```

### Connect Wallet (MUST be from button click)

```csharp
public void OnConnectButtonClick()
{
    // Must be called from user gesture to avoid browser permission issues
    CardanoBridge.Instance.ConnectWallet("lace");
}

private void OnConnected(CardanoBridge.WalletConnectionResult result)
{
    Debug.Log($"Connected to {result.wallet} on {result.networkName}");
    Debug.Log($"Change address: {result.changeAddress}");
}
```

### Send Payment

```csharp
public void OnPayButtonClick()
{
    string recipient = "addr_test1qz...";
    decimal adaAmount = 5.0m; // 5 ADA
    
    CardanoBridge.Instance.SendAda(recipient, adaAmount);
}

private void OnTxSuccess(CardanoBridge.TransactionResult result)
{
    Debug.Log($"Transaction submitted: {result.txHash}");
    // View on explorer: https://preprod.cardanoscan.io/transaction/{result.txHash}
}
```

### Get Balance

```csharp
CardanoBridge.Instance.OnBalanceReceived += (balance) => {
    long lovelace = long.Parse(balance);
    decimal ada = lovelace / 1_000_000m;
    Debug.Log($"Balance: {ada} ADA");
};

CardanoBridge.Instance.GetBalance();
```

## JavaScript API (window.CardanoBridge)

### Wallet Detection

```javascript
CardanoBridge.isLaceAvailable()        // boolean
CardanoBridge.getAvailableWallets()    // ["lace", "eternl", ...]
CardanoBridge.isConnected()            // boolean
```

### Connection

```javascript
await CardanoBridge.connectWallet("lace")  // Returns connection info
CardanoBridge.disconnectWallet()
```

### Addresses & UTxOs

```javascript
await CardanoBridge.getUsedAddressesBech32()  // ["addr_test1...", ...]
await CardanoBridge.getChangeAddressBech32()  // "addr_test1..."
await CardanoBridge.getUtxos()                // [{txHash, outputIndex, lovelace}, ...]
await CardanoBridge.getBalance()              // "5000000" (lovelace as string)
```

### Transactions

```javascript
await CardanoBridge.buildAndSendPayment(
  "addr_test1qz...",  // recipient
  "5000000"           // lovelace amount
)
// Returns: { txHash: "abc123..." }
```

## Limitations

### 1. Balance Accuracy

**Problem:** `getBalance()` sums UTxOs returned by the wallet, which may not include all UTxOs.

**Why:** CIP-30 wallets may paginate UTxOs or exclude certain types. For accurate balance, use a chain indexer (Blockfrost, Koios).

**Workaround:** Use balance for display only; don't rely on it for critical logic.

### 2. UTxO Selection

**Problem:** Current implementation uses all available UTxOs as inputs, which is inefficient.

**Why:** Proper coin selection (random-improve, largest-first) requires knowing all UTxOs and their values.

**Impact:** 
- Transactions may be larger than necessary
- May fail if UTxOs are locked or spent

**Future:** Implement proper coin selection or use Blockfrost for UTxO queries.

### 3. Fee Estimation

**Problem:** Uses hardcoded protocol parameters.

**Why:** Fetching current parameters requires an indexer API.

**Current values (Preprod):**
- Linear fee: 44 lovelace/byte + 155381 constant
- Min UTxO: 4310 lovelace/byte

**Risk:** If protocol parameters change, transactions may fail.

### 4. TTL (Time-to-Live)

**Problem:** TTL is estimated from system time, not actual slot.

**Why:** Getting current slot requires node/indexer query.

**Workaround:** TTL is set to ~2 hours in the future, which is usually safe.

### 5. Multi-Asset Support

**Problem:** Only ADA transfers are supported; no native tokens.

**Why:** Multi-asset handling adds complexity to UTxO selection and output building.

**Future:** Add token support if needed.

### 6. Plutus Scripts

**Status: WORKING** — Plutus V3 script interactions are fully implemented and tested.

The `IncrementCounterCSL` function in `increment-counter-csl.js` handles:
- Correct datum/redeemer CBOR encoding
- Proper collateral selection via CIP-30
- Accurate execution unit estimation via Blockfrost evaluation
- Manual `script_data_hash` computation (required workaround for CSL 12.x + PlutusV3)
- Immutable `TransactionBody` reconstruction with fee adjustment

**See:** `Assets/WebGLTemplates/MidnightTemplate/README_PlutusV3_Transaction.md` for full technical documentation.

## Browser Compatibility

- **Chrome/Edge:** ✅ Full support
- **Firefox:** ✅ Full support  
- **Safari:** ⚠️ May have WebAssembly issues
- **Mobile:** ❌ Wallet extensions not available

## Security Notes

1. **Never hardcode private keys** - All signing happens in the wallet
2. **Validate addresses** - Check address format before sending
3. **User gesture required** - `connectWallet()` must be called from button click
4. **HTTPS required** - CIP-30 wallets require secure context

## Debugging

### Console Commands

```javascript
// Check bridge loaded
window.CardanoBridge

// Check CSL loaded
typeof CardanoWasm

// Check wallet available
window.cardano.lace

// Manual connect test
await CardanoBridge.connectWallet("lace")

// Get balance
await CardanoBridge.getBalance()
```

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| "CardanoBridge not loaded" | Script load order wrong | Check index.html order |
| "CSL not found" | CSL CDN failed | Check network, try different CDN |
| "Wallet not found" | Extension not installed | Install Lace/Eternl |
| "User rejected" | User declined in wallet | Expected behavior |
| "No UTxOs available" | Wallet has no funds | Fund wallet on testnet faucet |

## Milestones & Roadmap

### Milestone 1 — Cardano CIP-30 Wallet Connection ✅

- Detect and connect to Lace/Eternl/Nami via CIP-30
- Display wallet address, balance, UTxOs
- Simple ADA payments (build tx → sign → submit)
- Unity C# ↔ JavaScript bridge via `.jslib`

### Milestone 2 — Plutus V3 Smart Contract Interaction ✅

- **Aiken counter dApp** deployed on Preprod (PlutusV3)
- Full increment transaction flow from Unity WebGL
- Manual `script_data_hash` computation (CSL 12.x workaround for V3)
- Immutable `TransactionBody` reconstruction with fee/change adjustment
- Blockfrost ExUnits evaluation + proper fee calculation
- Inline datum handling (strip supplemental datums from witness set)
- Embedded blake2b-256 for hash computation
- **Confirmed on-chain:** `484b2f6a612c8d2a94cf122dde4d4f194bb5310f068103b5423bc877332c2186`
- Full technical docs: `Assets/WebGLTemplates/MidnightTemplate/README_PlutusV3_Transaction.md`

### Milestone 3 — Midnight Network Integration 🔜

- Connect to Midnight network via Lace's Midnight DApp connector
- Interact with Midnight smart contracts (Compact language)
- Shielded address support and tDUST/tNIGHT token workflows
- Bridge between Cardano and Midnight state

### Milestone 4 — Counter Smart Contract on Midnight 🔜

- Deploy the counter contract on Midnight using Compact
- Read/write shielded state from Unity
- Compare Cardano Plutus V3 vs Midnight Compact developer experience

### Milestone 5 — Expanded Cardano System 🔜

- Multi-asset (native token) support
- Proper coin selection algorithms (random-improve, largest-first)
- Multiple script interactions in a single transaction
- Reference script support (avoid attaching full script to every tx)
- Stake delegation and rewards querying
- Multi-wallet support (Eternl, Nami, Flint, etc.)

---

## Testnet Faucet

Get test ADA for Preprod: https://docs.cardano.org/cardano-testnets/tools/faucet/

## Explorer Links

- **Preprod:** https://preprod.cardanoscan.io/transaction/{txHash}
- **Preview:** https://preview.cardanoscan.io/transaction/{txHash}
