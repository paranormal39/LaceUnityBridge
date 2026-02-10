# Plutus V3 Transaction Building — Unity WebGL + CSL 12.x

## Overview

This document explains how the **Aiken counter dApp** increment transaction is built and submitted from a Unity WebGL game using **Cardano Serialization Library (CSL) 12.x** and the **CIP-30 wallet API** (Lace). It covers every stage of the pipeline, the critical workarounds required for CSL 12.x + PlutusV3, and the lessons learned.

**Confirmed working** — TxHash `484b2f6a612c8d2a94cf122dde4d4f194bb5310f068103b5423bc877332c2186` on Preprod.

---

## Table of Contents

1. [Architecture](#architecture)
2. [On-Chain Contract](#on-chain-contract)
3. [Transaction Flow (Step by Step)](#transaction-flow-step-by-step)
4. [Critical Workarounds for CSL 12.x + PlutusV3](#critical-workarounds-for-csl-12x--plutusv3)
5. [File Reference](#file-reference)
6. [Key Constants](#key-constants)
7. [Debugging Guide](#debugging-guide)
8. [Common Errors and Fixes](#common-errors-and-fixes)

---

## Architecture

```
Unity C# (MidnightBridge.cs)
    │
    │  DllImport: CardanoBridge_IncrementCounter(scriptAddr, scriptCborHex)
    ▼
CardanoBridgeWebGL.jslib
    │
    │  Calls: window.IncrementCounterCSL(scriptAddress, scriptCborHex)
    ▼
increment-counter-csl.js          ◄── Main transaction building logic
    │
    ├── CIP-30 Wallet API (Lace)   ◄── getUtxos, getCollateral, signTx, submitTx
    ├── Blockfrost API              ◄── Protocol params, UTxO queries, tx evaluation
    ├── CSL 12.x (csl.bundle.js)    ◄── CBOR serialization, address parsing, tx building
    └── Inline blake2b-256          ◄── Manual script_data_hash computation
```

### Data Flow

```
1. Unity calls JS with (scriptAddress, scriptCborHex)
2. JS fetches script UTxO from Blockfrost (finds current datum = counter value)
3. JS fetches wallet UTxOs and collateral via CIP-30
4. JS fetches protocol parameters from Blockfrost
5. JS builds unsigned transaction with placeholder ExUnits
6. JS evaluates transaction via Blockfrost (gets real ExUnits)
7. JS rebuilds transaction with correct ExUnits, fee, and script_data_hash
8. Wallet signs the transaction (CIP-30 signTx)
9. Wallet submits the transaction (CIP-30 submitTx)
10. Unity receives the txHash
```

---

## On-Chain Contract

The counter is an **Aiken** smart contract compiled to **Plutus V3**, deployed on Cardano Preprod testnet.

| Property | Value |
|----------|-------|
| **Script Address** | `addr_test1wq0666pyk48q4v2zgjgdd4fuzn3xg2lzhsvueduvjxjuksqc7yh2n` |
| **Script Hash** | `1fad6824b54e0ab1424490d6d53c14e2642be2bc19ccb78c91a5cb40` |
| **Plutus Version** | V3 (Aiken v1.1.21) |
| **Datum Format** | Plain CBOR integer (e.g., `02` = 2, `03` = 3). **NOT** `Constr 0 [Int]` |
| **Redeemer** | `d87980` = `Constr 0 []` (empty constructor, meaning "Increment") |
| **Datum Storage** | Inline datum (stored directly in the UTxO, not as a hash) |

### Contract Logic

The validator checks:
1. The redeemer is `Constr 0 []` (Increment action)
2. The output datum equals `input datum + 1`
3. The value is preserved (lovelace stays at the script address)

---

## Transaction Flow (Step by Step)

### Step 1: Find the Script UTxO

```javascript
// Query Blockfrost for UTxOs at the script address
const utxos = await fetch(`${blockfrostUrl}/addresses/${scriptAddress}/utxos`, ...);
```

The script UTxO contains:
- **2 ADA** locked at the script address
- **Inline datum**: a plain CBOR integer (the counter value)

We read the `inline_datum` field and decode it:
- `02` → counter is currently 2
- New value will be 3, encoded as `03`

### Step 2: Get Wallet UTxOs and Collateral

```javascript
const walletUtxosHex = await walletApi.getUtxos();
const collateralHex = await walletApi.getCollateral();
const changeAddressHex = await walletApi.getChangeAddress();
```

- **Wallet UTxOs**: Used as inputs to pay the fee
- **Collateral**: Required for Plutus script transactions (locked ADA returned if script fails)
- **Change Address**: Where leftover ADA goes after paying the fee

### Step 3: Parse the Plutus Script

The script CBOR hex (passed from Unity) must be parsed into a CSL `PlutusScript` object:

```javascript
// The script bytes are CBOR-wrapped: 0x59 prefix = 2-byte length CBOR bytestring
// First unwrap: strip the outer CBOR wrapper
// Then create: CSL.PlutusScript.from_bytes_with_version(scriptBytes, CSL.Language.new_plutus_v3())
```

**Script hash verification**: After parsing, we compute the script hash and verify it matches the expected hash derived from the script address. This prevents "Script hash mismatch" errors.

The code tries multiple parsing strategies (raw bytes, single-unwrapped, double-unwrapped) and picks the one whose hash matches the address.

### Step 4: Build the Transaction

Using CSL's `TransactionBuilder`:

```javascript
const txBuilder = CSL.TransactionBuilder.new(txBuilderConfig);

// 1. Add the script input (the counter UTxO)
txBuilder.add_plutus_script_input(
    witnessSource,    // PlutusWitness(script, datum, redeemer)
    scriptTxInput,    // TransactionInput pointing to the counter UTxO
    inputValue        // Value (2 ADA)
);

// 2. Add the script output (counter UTxO with incremented datum)
txBuilder.add_output(
    TransactionOutputBuilder.new()
        .with_address(scriptAddr)
        .with_plutus_data(newDatumPlutusData)  // datum = counter + 1
        .next()
        .with_coin(BigNum.from_str("2000000"))
        .build()
);

// 3. Add wallet input (to pay the fee)
txBuilder.add_input(walletAddr, walletTxInput, walletValue);

// 4. Set collateral
txBuilder.set_collateral(collateralBuilder);

// 5. Set TTL (current slot + 600)
txBuilder.set_ttl_bignum(BigNum.from_str(ttlSlot));

// 6. Add change output (leftover ADA back to wallet)
txBuilder.add_change_if_needed(changeAddr);
```

**Placeholder ExUnits**: At this stage, we use large placeholder ExUnits (`mem=1000000, steps=500000000`) because we don't know the real execution cost yet. The fee will be recalculated after evaluation.

### Step 5: Compute script_data_hash (Manual — CSL is Broken for V3)

> **CRITICAL**: CSL 12.x's `hash_script_data()` produces incorrect hashes for PlutusV3 cost models. This causes `PPViewHashesDontMatch` errors. We compute it manually.

The `script_data_hash` is defined by the Alonzo CDDL spec as:

```
script_data_hash = blake2b-256(redeemers_cbor || language_views_cbor)
```

For inline datum transactions, there are **no supplemental datums** in the witness set, so the preimage is just `redeemers || language_views`.

#### Language Views Encoding (V3)

```
language_views = CBOR_map { 2: [cost_model_values...] }
```

Where:
- Key `2` = PlutusV3 language ID
- Value = CBOR array of 297 integers (the V3 cost model parameters)

**Cost model ordering is critical**: Blockfrost returns named keys in canonical ledger order. Do **NOT** sort alphabetically — use `Object.values(model)` to preserve insertion order.

#### Blake2b-256 Implementation

We embed a pure JavaScript blake2b-256 implementation (ported from the official `blakejs` npm package) directly in `increment-counter-csl.js`. This avoids external script loading issues and WebGL caching problems.

Self-test vector: `blake2b-256("abc") = bddd813c634239723171ef3fee98579b94964e3bb1cb3e427262c8c068d52319`

### Step 6: Strip Supplemental Datums

CSL's `build_tx()` automatically adds `plutus_data` to the witness set (the datum). For inline datum transactions, this is **wrong** — the datum lives in the UTxO output, not in the witness set.

```javascript
// Check if build_tx() added unwanted plutus_data
if (builtWitness.plutus_data() && builtWitness.plutus_data().len() > 0) {
    // Rebuild witness set WITHOUT plutus_data
    const cleanWitness = CSL.TransactionWitnessSet.new();
    cleanWitness.set_plutus_scripts(builtWitness.plutus_scripts());
    cleanWitness.set_redeemers(builtWitness.redeemers());
    // Do NOT set plutus_data
    unsignedTx = CSL.Transaction.new(txBody, cleanWitness);
}
```

### Step 7: Evaluate ExUnits via Blockfrost

```javascript
const evalResult = await fetch(`${blockfrostUrl}/utils/txs/evaluate/utxos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/cbor', 'project_id': apiKey },
    body: txCborBytes
});
```

Blockfrost returns the actual execution units:
```json
{
  "validator": { "index": 1, "purpose": "spend" },
  "budget": { "memory": 46278, "cpu": 19065560 }
}
```

### Step 8: Rebuild the Transaction (The Hard Part)

After getting real ExUnits, we must rebuild the transaction with:
1. **Correct ExUnits** in the redeemer
2. **Recomputed script_data_hash** (because redeemer CBOR changed)
3. **Correct fee** (based on actual tx size + ExUnits cost)
4. **Adjusted change output** (to maintain value conservation)

#### Why Rebuilding is Complex in CSL 12.x

**`TransactionBody` is immutable** — objects returned by `unsignedTx.body()` do not have a `set_fee()` method. Fee can only be set via the constructor. This means we must reconstruct the entire body from scratch.

```javascript
function rebuildBodyWithFeeAndHash(oldBody, newFeeStr, scriptDataHashHex, walletAddr) {
    var inputs = oldBody.inputs();
    var oldOutputs = oldBody.outputs();
    var oldFee = oldBody.fee();
    var newFeeBN = CSL.BigNum.from_str(newFeeStr);

    // 1. Compute fee difference
    var feeDiff = BigInt(oldFee.to_str()) - BigInt(newFeeStr);

    // 2. Adjust change output (value conservation: sum(inputs) = sum(outputs) + fee)
    var newOutputs = CSL.TransactionOutputs.new();
    for (var i = 0; i < oldOutputs.len(); i++) {
        var out = oldOutputs.get(i);
        if (out.address().to_bech32() === walletAddr) {
            // Add fee difference to change output
            var newAmount = BigInt(out.amount().coin().to_str()) + feeDiff;
            var newValue = CSL.Value.new(CSL.BigNum.from_str(newAmount.toString()));
            newOutputs.add(CSL.TransactionOutput.new(out.address(), newValue));
        } else {
            newOutputs.add(out);
        }
    }

    // 3. Create new body with correct fee
    var newBody = CSL.TransactionBody.new_tx_body(inputs, newOutputs, newFeeBN);

    // 4. Copy TTL (use set_ttl with BigNum, NOT constructor param)
    var ttl = oldBody.ttl_bignum();
    if (ttl) newBody.set_ttl(ttl);

    // 5. Copy collateral, required signers
    if (oldBody.collateral()) newBody.set_collateral(oldBody.collateral());
    if (oldBody.collateral_return()) newBody.set_collateral_return(oldBody.collateral_return());
    if (oldBody.total_collateral()) newBody.set_total_collateral(oldBody.total_collateral());
    if (oldBody.required_signers()) newBody.set_required_signers(oldBody.required_signers());

    // 6. Set the manually computed script_data_hash
    newBody.set_script_data_hash(CSL.ScriptDataHash.from_hex(scriptDataHashHex));

    return newBody;
}
```

#### Fee Calculation

```javascript
const sizeFee = minFeeA * BigInt(estimatedSize) + minFeeB;
const exUnitsFee = BigInt(Math.ceil(priceMem * exUnits.memory))
                 + BigInt(Math.ceil(priceStep * exUnits.steps));
const computedFee = sizeFee + exUnitsFee;
const newFee = computedFee + computedFee / 10n;  // +10% safety margin
```

Protocol parameters used:
- `min_fee_a` = 44 (lovelace per byte)
- `min_fee_b` = 155381 (constant)
- `price_mem` = 0.0577 (lovelace per memory unit)
- `price_step` = 0.0000721 (lovelace per CPU step)

### Step 9: Sign and Submit

```javascript
// Sign via CIP-30 (wallet popup)
const witnessSetHex = await walletApi.signTx(finalTxHex, true);  // partialSign=true

// Merge wallet's vkey witness into the transaction
const signedTx = mergeWitnessIntoTx(finalTxHex, witnessSetHex);

// Submit via CIP-30
const txHash = await walletApi.submitTx(signedTx);
```

`partialSign=true` is required because the transaction already has script witnesses — the wallet only adds its vkey signature.

---

## Critical Workarounds for CSL 12.x + PlutusV3

### 1. Manual script_data_hash (PPViewHashesDontMatch)

**Problem**: CSL 12.x `hash_script_data()` produces wrong hashes for PlutusV3 cost models.

**Solution**: Compute `blake2b-256(redeemers_cbor || language_views_cbor)` manually using an embedded pure-JS blake2b implementation.

**Files**: `computeScriptDataHash()` in `increment-counter-csl.js`

### 2. Immutable TransactionBody (set_fee not a function)

**Problem**: `TransactionBody` objects from `tx.body()` are read-only in CSL 12.x. There is no `set_fee()` method.

**Solution**: Reconstruct the body using `TransactionBody.new_tx_body(inputs, outputs, fee)`, then copy TTL, collateral, required signers, and script_data_hash via their respective setters.

### 3. TTL Lost During Rebuild (TTL is 0)

**Problem**: `TransactionBody.new(inputs, outputs, fee, ttl)` takes TTL as a raw number, but `ttl_bignum()` returns a `BigNum`. Large slot numbers may overflow or be passed incorrectly.

**Solution**: Use `new_tx_body()` (no TTL param) then `set_ttl(bignum)` separately.

### 4. Value Conservation (ValueNotConservedUTxO)

**Problem**: When the fee changes (from placeholder to computed), the outputs still reflect the old fee. The ledger requires `sum(inputs) = sum(outputs) + fee`.

**Solution**: Find the change output (wallet address), compute `feeDiff = oldFee - newFee`, and add the difference to the change output amount.

### 5. Cost Model Ordering (PPViewHashesDontMatch)

**Problem**: Blockfrost returns V3 cost model parameters as a named object. Sorting keys alphabetically produces the wrong hash.

**Solution**: Blockfrost returns keys in canonical ledger order. Use `Object.values(model)` to preserve insertion order. Do NOT sort.

### 6. Inline Datum Stripping (NonOutputSupplimentaryDatums)

**Problem**: CSL's `build_tx()` adds the datum to the witness set's `plutus_data`. For inline datum transactions, this causes `NonOutputSupplimentaryDatums` errors.

**Solution**: After `build_tx()`, check if `plutus_data` was added. If so, rebuild the witness set without it.

### 7. ExUnits Parsing (Array vs Object Format)

**Problem**: Blockfrost's evaluation endpoint returns ExUnits in array format `[{validator:{index,purpose}, budget:{memory,cpu}}]`, not the legacy object format `{"spend:0": {memory, steps}}`.

**Solution**: Handle both formats in the ExUnits extraction code.

### 8. Blake2b-256 Caching (Wrong Hash)

**Problem**: WebGL aggressively caches JavaScript files. An external `blake2b.js` with a bug was being served from cache even after fixing it.

**Solution**: Embed blake2b-256 directly in `increment-counter-csl.js` as an IIFE. Remove the external script tag from `index.html`. Use local `_b2b.hash()` and `_b2b.toHex()` references instead of `window.blake2b256`.

---

## File Reference

| File | Purpose |
|------|---------|
| `increment-counter-csl.js` | **Main file** — all transaction building, blake2b, script_data_hash, fee calc |
| `index.html` | WebGL template — loads CSL bundle and increment script |
| `TemplateData/csl.bundle.js` | CSL 12.x WASM bundle (esbuild'd from @emurgo/cardano-serialization-lib-browser) |
| `CardanoBridgeWebGL.jslib` | Unity ↔ JS interop bridge |
| `MidnightBridge.cs` | Unity C# — calls `CardanoBridge_IncrementCounter` |

### increment-counter-csl.js Structure

| Section | Lines (approx) | Purpose |
|---------|----------------|---------|
| `decodeDatum` / `encodeDatum` | 50–140 | CBOR integer encoding for counter datum |
| `evaluateTx` | 560–640 | Blockfrost tx evaluation with retry |
| `logValidity` | 390–400 | Debug helper for TTL/validity |
| `buildTxBuilderConfigFromBlockfrost` | 850–920 | Protocol params → TransactionBuilderConfig |
| `blake2b-256 IIFE (_b2b)` | 1733–1846 | Embedded pure-JS blake2b-256 |
| `computeScriptDataHash` | 1850–1970 | Manual script_data_hash per Alonzo spec |
| `costModelToArray` | 1874–1915 | Convert cost model object → array |
| `buildCostModel` | 1970–2100 | Build CSL CostModel/Costmdls objects |
| `IncrementCounterCSL` | 930–2700 | Main entry point — full tx flow |

---

## Key Constants

```javascript
// Script
const SCRIPT_ADDRESS = "addr_test1wq0666pyk48q4v2zgjgdd4fuzn3xg2lzhsvueduvjxjuksqc7yh2n";
const SCRIPT_HASH    = "1fad6824b54e0ab1424490d6d53c14e2642be2bc19ccb78c91a5cb40";

// Blockfrost
const BLOCKFROST_URL = "https://cardano-preprod.blockfrost.io/api/v0";
const BLOCKFROST_KEY = "YOUR_BLOCKFROST_PROJECT_ID"; // Get from https://blockfrost.io

// Redeemer (Increment action)
const REDEEMER_CBOR = "d87980";  // Constr 0 []

// PlutusV3 language ID for script_data_hash
const V3_LANGUAGE_ID = 2;

// V3 cost model: 297 parameters (Preprod Conway era)

// Blake2b-256 test vector
// blake2b-256("abc") = bddd813c634239723171ef3fee98579b94964e3bb1cb3e427262c8c068d52319
```

---

## Debugging Guide

### Console Log Prefixes

| Prefix | Source |
|--------|--------|
| `[IncrementCSL]` | Main transaction flow |
| `[Evaluate]` | Blockfrost tx evaluation |
| `[TxConfig]` | Protocol params / TransactionBuilderConfig |
| `[DEBUG]` | Detailed diagnostic info |
| `[decodeDatum]` / `[encodeDatum]` | Datum CBOR encoding |

### Key Checkpoints in Console

A successful run shows these in order:

1. `✅ Selected UTxO: ...` — Found the counter UTxO
2. `Current: N -> New: N+1` — Datum decoded correctly
3. `✅ Parsed with new_v3, hash: 1fad6824...` — Script parsed and hash matches
4. `Final script language: V3` — Correctly detected as V3
5. `Redeemer created with index: X` — Redeemer index matches sorted input position
6. `blake2b-256 self-test: ... PASS=true` — Blake2b implementation is correct
7. `Manual script_data_hash: ...` — Computed manually (bypassing broken CSL)
8. `✅ Overrode script_data_hash with manual V3 computation` — Applied to tx body
9. `✅ EvaluationResult: [...]` — Blockfrost returned real ExUnits
10. `ExUnits from evaluation: {memory: 46278, steps: 19065560}` — Parsed correctly
11. `Fee adjustment: oldFee=X newFee=Y diff=Z` — Change output adjusted
12. `Rebuilt body TTL: ...` — TTL preserved during rebuild
13. `=== PRE-SUBMIT SANITY CHECKS ===` — All ✓ checks pass
14. `SUCCESS! TxHash: ...` — Transaction confirmed on-chain

### Sanity Checks (Pre-Submit)

Before submitting, the code verifies:
- ✓ `script_data_hash` is present
- ✓ Redeemer tag=0 (Spend), correct index
- ✓ ExUnits are non-zero
- ✓ Plutus scripts count = 1
- ✓ Collateral inputs present
- ✓ Fee is reasonable (> 0)
- ✓ TTL is non-zero and in the future
- ✓ VKey witnesses present (after signing)
- ✓ Correct number of inputs and outputs
- ✓ No supplemental datums (inline datum tx)

---

## Common Errors and Fixes

### PPViewHashesDontMatch

**Cause**: `script_data_hash` in the transaction doesn't match what the ledger computes.

**Fix**: Use manual `computeScriptDataHash()`. Ensure:
- Cost model values are in canonical order (don't sort alphabetically)
- Redeemers CBOR matches exactly (check ExUnits values)
- No extra datums in the preimage (inline datum tx has no supplemental datums)

### ValueNotConservedUTxO

**Cause**: `sum(inputs) ≠ sum(outputs) + fee`

**Fix**: When changing the fee during rebuild, adjust the change output by `oldFee - newFee`.

### FeeTooSmallUTxO

**Cause**: Fee is lower than the minimum required.

**Fix**: Use proper fee calculation: `min_fee_a * tx_size + min_fee_b + price_mem * mem + price_step * steps`, plus a 10% safety margin.

### NonOutputSupplimentaryDatums

**Cause**: Datum is in the witness set but not referenced by any output's datum hash.

**Fix**: For inline datum transactions, strip `plutus_data` from the witness set after `build_tx()`.

### Script hash mismatch

**Cause**: The script bytes were parsed incorrectly (wrong CBOR unwrapping level).

**Fix**: Try multiple parsing strategies and verify the hash matches the expected script hash from the address.

### oldBody.set_fee is not a function

**Cause**: `TransactionBody` from `tx.body()` is immutable in CSL 12.x.

**Fix**: Reconstruct the body using `TransactionBody.new_tx_body()` constructor, then copy all fields.

### TTL is missing or zero

**Cause**: TTL was lost during body reconstruction. `TransactionBody.new()` takes TTL as a raw number, but `ttl_bignum()` returns a `BigNum`.

**Fix**: Use `new_tx_body()` (no TTL) then `set_ttl(bignum)` separately.

---

## Unity C# Integration

### Calling the Increment Function

```csharp
// In MidnightBridge.cs
[DllImport("__Internal")]
private static extern void CardanoBridge_IncrementCounter(string scriptAddress, string scriptCborHex);

public void IncrementCounter()
{
    string scriptAddr = "addr_test1wq0666pyk48q4v2zgjgdd4fuzn3xg2lzhsvueduvjxjuksqc7yh2n";
    string scriptCbor = "59016901010029800aba2..."; // Full CBOR hex of the compiled Aiken script
    CardanoBridge_IncrementCounter(scriptAddr, scriptCbor);
}
```

### Receiving the Result

The JS bridge calls back to Unity via `SendMessage`:

```csharp
// Success callback
public void OnIncrementSuccess(string txHash)
{
    Debug.Log($"Counter incremented! TxHash: {txHash}");
}

// Error callback
public void OnIncrementError(string error)
{
    Debug.LogError($"Increment failed: {error}");
}
```

### Reading the Counter

The counter value is read separately by querying the script UTxO's inline datum:

```csharp
// CounterReader queries Blockfrost for the script UTxO
// and decodes the inline_datum field (plain CBOR integer)
```

---

## Rebuilding the WebGL Build

After making changes to `increment-counter-csl.js`:

1. **Unity Editor** → File → Build Settings → WebGL → Build
2. The WebGL template files are copied from `Assets/WebGLTemplates/MidnightTemplate/`
3. **Important**: Clear browser cache or use incognito mode — WebGL aggressively caches JS files
4. Test with browser DevTools open (F12) to see console logs

---

## Summary of the Transaction Lifecycle

```
┌─────────────────────────────────────────────────────────────────┐
│  1. QUERY: Fetch script UTxO, wallet UTxOs, protocol params     │
├─────────────────────────────────────────────────────────────────┤
│  2. BUILD: Construct tx with placeholder ExUnits                │
│     - Script input + wallet input                               │
│     - Script output (new datum) + change output                 │
│     - Collateral, TTL, redeemer                                 │
│     - Manual script_data_hash (V3 workaround)                   │
│     - Strip supplemental datums (inline datum workaround)       │
├─────────────────────────────────────────────────────────────────┤
│  3. EVALUATE: Send to Blockfrost for ExUnits estimation         │
│     - Returns actual memory + CPU steps                         │
├─────────────────────────────────────────────────────────────────┤
│  4. REBUILD: Reconstruct tx with real ExUnits                   │
│     - New redeemer with real ExUnits                             │
│     - Recompute script_data_hash                                │
│     - Calculate proper fee                                      │
│     - Adjust change output for value conservation               │
│     - Rebuild immutable TransactionBody from scratch             │
│     - Copy TTL, collateral, required signers                    │
├─────────────────────────────────────────────────────────────────┤
│  5. SIGN: Wallet adds vkey witness (CIP-30 signTx)             │
├─────────────────────────────────────────────────────────────────┤
│  6. SUBMIT: Wallet submits to network (CIP-30 submitTx)        │
│     - Returns txHash on success                                 │
└─────────────────────────────────────────────────────────────────┘
```
