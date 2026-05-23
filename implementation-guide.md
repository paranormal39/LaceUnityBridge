# Midnight Lace Wallet Connection - Implementation Guide

## Overview
This document tracks the implementation of robust Midnight Lace wallet detection and connection for Unity WebGL, plus UI cleanup and network/contract configuration.

---

## AUDIT RESULTS (2026-03-23)

### Hardcoded Values Found

| File | Value | Type | Risk |
|------|-------|------|------|
| `dao-csl.js:21` | `addr_test1wzgxsphtczfamr2cljp80e48544vwp3p4u9n68702t6psgcnkt88j` | DAO Script Address | **Cardano Preprod** (addr_test prefix) |
| `dao-csl.js:194` | `https://cardano-preprod.blockfrost.io/api/v0` | Blockfrost API | **Cardano Preprod** |
| `midnight-counter.js:31` | `d367654634bb80def09c830b373839bd99076c040db135d0d39639d5328a2436` | Midnight Counter Address | **Midnight Preprod** |
| `midnight-unity-bridge.ts:1091` | Same as above | Midnight Counter Address | **Midnight Preprod** |
| `increment-counter-csl.js:457,491,524,568` | `https://cardano-preprod.blockfrost.io/api/v0` | Blockfrost API | **Cardano Preprod** |
| `midnight-bridge.js:102` | `network = 'preprod'` | Default network param | **Preprod default** |

### Key Finding: **NO MAINNET FORCING**

The app is **NOT forcing mainnet**. All hardcoded values point to **preprod/testnet**:
- DAO address uses `addr_test1w...` prefix (Cardano testnet)
- Blockfrost URLs use `cardano-preprod.blockfrost.io`
- Midnight connect defaults to `'preprod'`
- Counter addresses are Midnight preprod contracts

### Network Selection Architecture

| Component | How Network is Selected |
|-----------|------------------------|
| **Midnight** | `connect(network)` parameter - defaults to `'preprod'` |
| **Cardano DAO** | Hardcoded `BLOCKFROST_BASE` URL determines network |
| **Cardano Counter** | Hardcoded `BLOCKFROST_BASE` URL determines network |

### Files That Control UI

| File | UI Elements |
|------|-------------|
| `index.html:190-260` | Midnight Preview Connect Panel |
| `index.html:261-299` | Cardano CIP-30 Test Panel |
| `index.html:301-520` | MidnightTest + LaceTest JavaScript |

### Transaction Logic Files (DO NOT TOUCH)

| File | Contains |
|------|----------|
| `dao-csl.js:740-1250` | DAO proposal creation, voting tx building |
| `increment-counter-csl.js:938-1300` | Counter increment tx building |
| `midnight-unity-bridge.ts:1244-1410` | Midnight tx building (incrementCounter) |

---

## PATCH PLAN (Minimum Safe Changes)

### Phase 1: Add Config State (LOW RISK)
1. Add a small config object to `index.html` script section
2. Store: `selectedNetwork`, `selectedContractAddress`, `useDefaultContract`
3. No changes to tx logic

### Phase 2: Add UI Controls (LOW RISK)
1. Add network selector dropdown (preprod/preview)
2. Add contract address input field
3. Add status display labels
4. Keep existing panels, just add controls

### Phase 3: Wire Config to Existing Calls (MEDIUM RISK)
1. Pass `selectedNetwork` to `connect()` calls
2. Pass `selectedContractAddress` to contract read/write calls
3. **DO NOT** modify tx building internals

### Phase 4: UI Cleanup (LOW RISK)
1. Improve spacing and grouping
2. Clearer labels
3. Remove "HARD-GATE" messaging (now supports UUID providers)
4. Better status indicators

---

## WHAT WILL NOT BE CHANGED

- `dao-csl.js` transaction building logic (lines 740-1250)
- `increment-counter-csl.js` transaction building logic (lines 938-1300)
- `midnight-unity-bridge.ts` transaction building logic
- Witness building, signing order, submit flow
- CSL serialization code

---

## Problem Statement

The current detection logic **hard-gates on `window.midnight.mnLace`**, but Lace now injects the Midnight provider under a **UUID key** instead:

```
window.midnight = {
  "337d8b7c-4e03-4117-b931-f1c618aeaee8": {
    apiVersion: "4.0.1",
    name: "lace",
    icon: "...",
    rdns: "..."
  }
}
```

The UUID-keyed provider has metadata but **NO `connect()` method visible** - not even on prototype.

---

## Current Architecture

### Files Involved

| File | Purpose |
|------|---------|
| `web/midnight-bridge/src/MidnightConnector.ts` | Core detection & connection logic (TypeScript source) |
| `web/midnight-bridge/src/midnight-unity-bridge.ts` | Unity WebGL bridge wrapper |
| `web/midnight-bridge/dist/midnight-sdk.bundle.js` | Built bundle |
| `Assets/Plugins/WebGL/MidnightWebGL.jslib` | Unity jslib plugin (calls into JS) |
| `Assets/WebGLTemplates/MidnightTemplate/index.html` | Test panel with HARD-GATE UI |

### Detection Flow

1. `MidnightConnector.detectMidnightPreview()` checks:
   - `window.midnight.mnLace` first (preferred)
   - Then scans UUID keys for providers with `name === "lace"`
   - Uses `checkConnectMethod()` to find `connect()` on own or prototype

2. `MidnightConnector.discoverLaceProvider()` returns a `DiscoveredProvider` with bound `connectFn`

3. The test panel in `index.html` displays "HARD-GATE: mnLace only" but actually uses `MidnightConnector` which supports UUID scanning

---

## Changes Log

### Phase 1: Analysis - COMPLETED

**Findings:**
1. `MidnightConnector.ts` already has UUID scanning via `discoverLaceProvider()`
2. `checkConnectMethod()` walks prototype chain up to 5 levels
3. The UUID provider (`337d8b7c-...`) is **metadata-only** - no `connect()` or `enable()` at all
4. The test panel UI says "HARD-GATE" but the code does support UUID scanning

### Phase 2: Enhanced Debugging - COMPLETED (2026-03-23)

**Changes Made:**

1. **Enhanced `checkConnectMethod()`** in `MidnightConnector.ts`:
   - Added `debugKey` parameter for better logging
   - Added `debugInfo` to return value
   - Logs prototype chain contents when walking

2. **Added `logMidnightProviders()`** debug helper:
   - Lists all keys under `window.midnight`
   - For each provider shows: name, apiVersion, rdns, enumerable keys, prototype props
   - Shows hasConnect, hasEnable, isLaceProvider status
   - Runs deep connect check with full debug output

3. **Improved warning messages** when providers found but no `connect()`:
   - Lists all found providers with their details
   - Suggests possible causes (metadata-only, Lace locked, need reload)

4. **Updated exports**:
   - `MidnightConnector.logMidnightProviders()` available on window
   - `MidnightSDK.logMidnightProviders()` available on window

**Files Changed:**
- `web/midnight-bridge/src/MidnightConnector.ts`
- `web/midnight-bridge/src/midnight-unity-bridge.ts`
- `Assets/Plugins/WebGL/midnight-sdk.bundle.js` (rebuilt)
- `Assets/WebGLTemplates/MidnightTemplate/TemplateData/midnight-sdk.bundle.js` (rebuilt)

---

## Key Finding: Provider is Metadata-Only

The UUID provider (`337d8b7c-4e03-4117-b931-f1c618aeaee8`) only has:
- `apiVersion: "4.0.1"`
- `name: "lace"`
- `icon: "..."`
- `rdns: "..."`

**No `connect()` or `enable()` method exists** - not on the object, not on its prototype.

This suggests one of:
1. **Lace wallet is locked** - unlock it and reload
2. **Midnight mode not enabled** - enable in Lace settings and reload
3. **Provider becomes connect-capable later** - need to wait/retry
4. **Different API pattern** - Lace may have changed how Midnight connects

---

## Testing Commands

```javascript
// Run this in browser console to see full provider details:
MidnightConnector.logMidnightProviders();

// Or via MidnightSDK:
MidnightSDK.logMidnightProviders();

// Check detection result:
MidnightConnector.detectMidnightPreview();

// Full debug dump:
MidnightConnector.debugDump();
```

---

## Next Steps

1. **TEST**: Run `MidnightConnector.logMidnightProviders()` to see if `connect()` appears on prototype
2. **VERIFY**: Check if unlocking Lace wallet adds `connect()` to the provider
3. **INVESTIGATE**: Check Lace documentation for current Midnight API pattern
4. **CONSIDER**: May need to use `window.cardano.lace.enable()` first, then access Midnight API differently

---

## Open Questions

1. Is the UUID provider supposed to have `connect()` or is there a different flow now?
2. Does unlocking Lace wallet populate the `connect()` method?
3. Has Lace changed the Midnight connection API in recent versions?
4. Should we try `window.cardano.lace.enable()` and then check for Midnight API on the returned object?

---

## Status

**Current Phase:** 2 - Enhanced Debugging  
**Status:** COMPLETED - Ready for testing  
**Next Action:** Run `MidnightConnector.logMidnightProviders()` in browser to see full provider details  
**Last Updated:** 2026-03-23

