/**
 * Midnight Network Unity WebGL Bridge
 * 
 * Updated for @midnight-ntwrk/dapp-connector-api v4.0.4
 * 
 * Bundles @meshsdk/midnight-setup + Midnight DApp Connector API
 * for browser use in Unity WebGL.
 * 
 * Exposes window.MidnightSDK with:
 *  - DApp connector wrapper supporting BOTH injection patterns:
 *    1. window.midnight.mnLace (Lace)
 *    2. window.midnight[uuid] where provider.name === "lace"
 *  - MeshJS Midnight setup utilities
 *  - Provider configuration helpers
 * 
 * v4.0.0 API Changes:
 * - connect(networkId) replaces enable()/isEnabled()
 * - Granular methods: getShieldedAddresses(), getShieldedBalances(), etc.
 * - balanceUnsealedTransaction() / balanceSealedTransaction() replace balanceAndProveTransaction()
 * - getConnectionStatus() for connection checks
 * 
 * The Lace wallet extension must be installed with Midnight mode enabled.
 * 
 * NEVER uses window.cardano (CIP-30 is completely separate from Midnight)
 */

// BUILD_STAMP for cache verification - this changes on every build
const BUILD_STAMP = "2026-02-21T23:10:00.000Z";
console.log("[MidnightSDK] BUILD_STAMP:", BUILD_STAMP);

// ---- Buffer polyfill upgrade ----
// build.mjs's bufferBanner installs a plain-object `globalThis.Buffer` with
// from/alloc/concat helpers, but it's NOT a constructor. crypto-browserify's
// deps (browserify-aes, browserify-cipher) do `new Buffer(size)` internally
// and crash with "Buffer is not a constructor". Overwrite the banner stub
// with the real Buffer class from the `buffer` npm package before any
// provider code runs.
import { Buffer as NodeBuffer } from 'buffer';
(globalThis as any).Buffer = NodeBuffer;
if (typeof window !== 'undefined') (window as any).Buffer = NodeBuffer;

// Import MidnightConnector as single source of truth for wallet connection
import * as MidnightConnector from './MidnightConnector';

// ---- WASM modules MUST be lazy-loaded (they crash on eager init) ----
// @midnight-ntwrk/ledger-v8, zswap, onchain-runtime contain wasm-bindgen.
// Pure-JS packages (indexer, contracts) can be imported statically.

import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import * as ledgerV8 from '@midnight-ntwrk/ledger-v8';
import { setNetworkId as setMidnightNetworkId, getNetworkId as getMidnightNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import * as onchainRuntimeV3 from '@midnight-ntwrk/onchain-runtime-v3';
import * as counterContract from '@midnight-ntwrk/counter-contract';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';

const _indexerPublicDataProvider: any = indexerPublicDataProvider;
const _findDeployedContract: any = findDeployedContract;
let _midnightPkgsLoaded = false;
let _midnightPkgsError: string | null = null;
let _lastSubmittedTxHash: string | null = null;

/**
 * Wait for all WASM modules to finish initializing.
 * The wasm-bindgen modules export __wasm_ready promises.
 */
async function waitForWasmInit(): Promise<void> {
  console.log('[MidnightSDK] Waiting for WASM modules to initialize...');

  // Static imports above trigger WASM init at module load time.
  // We just await their readiness promises.
  const wasmModules = await Promise.allSettled([
    Promise.resolve((ledgerV8 as any).__wasm_ready || Promise.resolve()),
    Promise.resolve((onchainRuntimeV3 as any).__wasm_ready || Promise.resolve()),
  ]);

  // Log results
  wasmModules.forEach((result, i) => {
    const names = ['ledger-v8', 'onchain-runtime-v3'];
    if (result.status === 'fulfilled') {
      console.log(`[MidnightSDK] ${names[i]} WASM ready`);
    } else {
      console.warn(`[MidnightSDK] ${names[i]} WASM failed:`, result.reason);
    }
  });

  // Check if critical modules succeeded (onchain-runtime is required for compact-runtime)
  const onchainResult = wasmModules[1];
  if (onchainResult.status === 'rejected') {
    throw new Error(`onchain-runtime WASM init failed: ${onchainResult.reason}`);
  }

  console.log('[MidnightSDK] All critical WASM modules initialized');
}

/**
 * Lazily load the heavy @midnight-ntwrk packages (indexer, contracts).
 * MUST await WASM init first, otherwise compact-runtime crashes on maxField.
 */
async function loadMidnightPackages(): Promise<{ indexerPublicDataProvider: any; findDeployedContract: any }> {
  if (_midnightPkgsLoaded) return { indexerPublicDataProvider: _indexerPublicDataProvider, findDeployedContract: _findDeployedContract };
  try {
    // CRITICAL: Wait for WASM modules to initialize FIRST
    await waitForWasmInit();

    console.log('[MidnightSDK] indexerPublicDataProvider available:', typeof indexerPublicDataProvider);
    console.log('[MidnightSDK] findDeployedContract available:', typeof findDeployedContract);

    // Verify static imports resolved correctly
    if (typeof indexerPublicDataProvider !== 'function') {
      console.warn('[MidnightSDK] indexerPublicDataProvider may not be a function, got:', typeof indexerPublicDataProvider);
    }
    if (typeof findDeployedContract !== 'function') {
      console.warn('[MidnightSDK] findDeployedContract may not be a function, got:', typeof findDeployedContract);
    }

    // Load vendored counter-contract bindings (optional — only if present)
    let counterMod: any = null;
    try {
      console.log('[MidnightSDK] Loading @midnight-ntwrk/counter-contract...');
      counterMod = counterContract;
      console.log('[MidnightSDK] counter-contract loaded, exports:', Object.keys(counterMod));
      // The package exports: { Counter: { Contract, ledger, ... }, witnesses }
      const CounterNs = counterMod.Counter;
      if (CounterNs && CounterNs.Contract) {
        console.log('[MidnightSDK] counter-contract.Counter.Contract found');
      }
      if (counterMod.witnesses) {
        console.log('[MidnightSDK] counter-contract.witnesses found');
      }
    } catch (counterErr: any) {
      console.warn('[MidnightSDK] counter-contract not available:', counterErr.message);
    }

    _midnightPkgsLoaded = true;
    console.log('[MidnightSDK] @midnight-ntwrk packages loaded successfully');

    // Patch onto the global SDK object so midnight-counter-bindings.js can see them
    if ((window as any).MidnightSDK) {
      (window as any).MidnightSDK.indexerPublicDataProvider = _indexerPublicDataProvider;
      (window as any).MidnightSDK.findDeployedContract = _findDeployedContract;
      if (counterMod) {
        const ContractClass = counterMod.Counter?.Contract || counterMod.Contract;
        const witnessesObj = counterMod.witnesses || {};
        (window as any).MidnightSDK.Contract = ContractClass;
        (window as any).MidnightSDK.witnesses = witnessesObj;
        (window as any).MidnightSDK.Counter = counterMod.Counter || counterMod;
        console.log('[MidnightSDK] Contract class stored:', !!ContractClass);
        console.log('[MidnightSDK] witnesses stored:', !!witnessesObj);
      }
    }
    return { indexerPublicDataProvider: _indexerPublicDataProvider, findDeployedContract: _findDeployedContract };
  } catch (e: any) {
    _midnightPkgsError = e.message || String(e);
    console.error('[MidnightSDK] Failed to load @midnight-ntwrk packages:', _midnightPkgsError);
    if (e.stack) console.error('[MidnightSDK] Stack trace:', e.stack);
    throw e;
  }
}

// ---- Midnight DApp Connector (direct wallet interaction) ----
// Supports BOTH injection patterns:
// 1. window.midnight.mnLace (Lace)
// 2. window.midnight[uuid] where provider.name === "lace"
// NEVER references window.cardano (CIP-30 is completely separate)

/**
 * Wallet connector state - tracks the current connection
 */
interface WalletState {
  connected: boolean;
  network: string;
  connector: any | null;
  api: any | null;
  walletState: any | null;
  serviceUriConfig: any | null;
  connectorPath: string;
}

const state: WalletState = {
  connected: false,
  network: '',
  connector: null,
  api: null,
  walletState: null,
  serviceUriConfig: null,
  connectorPath: '',
};

// ---- Single-Flight Guard ----
// Prevents multiple simultaneous connect attempts
let _connectInProgress: Promise<any> | null = null;

/**
 * Check if an object has a method, searching prototype chain.
 * Handles non-enumerable methods like connect() on Midnight connectors.
 */
function hasMethodDeep(obj: any, methodName: string, maxProtoLevels = 3): boolean {
  if (!obj || typeof obj !== 'object') return false;

  // Check 1: Direct typeof (catches both own and inherited)
  try {
    if (typeof obj[methodName] === 'function') {
      return true;
    }
  } catch (e) {
    // continue
  }

  // Check 2: 'in' operator (catches non-enumerable and prototype)
  try {
    if (methodName in obj && typeof obj[methodName] === 'function') {
      return true;
    }
  } catch (e) {
    // continue
  }

  // Check 3: Explicit prototype chain walk
  try {
    let proto = Object.getPrototypeOf(obj);
    let level = 1;
    while (proto && level <= maxProtoLevels) {
      if (typeof proto[methodName] === 'function') {
        return true;
      }
      proto = Object.getPrototypeOf(proto);
      level++;
    }
  } catch (e) {
    // continue
  }

  return false;
}

/**
 * Find the Midnight DApp connector.
 * 
 * Supports BOTH injection patterns:
 * 1. window.midnight.mnLace (preferred if present)
 * 2. window.midnight[uuid] where provider.name === "lace"
 * 
 * NEVER reads from window.cardano (that's CIP-30, not Midnight)
 * 
 * This function uses the MidnightConnector discovery system.
 * 
 * Returns the connector object and its path, or null.
 */
function findMidnightConnector(): { connector: any; path: string; hasConnect: boolean; hasEnable: boolean; name: string; apiVersion: string } | null {
  // Use the new provider discovery from MidnightConnector
  const discovered = MidnightConnector.discoverLaceProvider();
  
  if (!discovered) {
    return null;
  }
  
  // Check for enable method
  const hasEnable = hasMethodDeep(discovered.provider, 'enable');
  
  return { 
    connector: discovered.provider, 
    path: `window.midnight.${discovered.meta.key}`, 
    hasConnect: true, // discoverLaceProvider only returns providers with connect
    hasEnable,
    name: discovered.meta.name,
    apiVersion: discovered.meta.apiVersion
  };
}

/**
 * Check if the Midnight DApp connector is available.
 * 
 * Supports BOTH injection patterns:
 * 1. window.midnight.mnLace
 * 2. window.midnight[uuid] where provider.name === "lace"
 * 
 * Uses the MidnightConnector discovery system.
 */
function isConnectorAvailable(): boolean {
  return MidnightConnector.isConnectorAvailable();
}

/**
 * Connect to Midnight wallet via Lace.
 * 
 * Supports BOTH injection patterns:
 * 1. window.midnight.mnLace (preferred if present)
 * 2. window.midnight[uuid] where provider.name === "lace"
 * 
 * NEVER uses window.cardano (CIP-30 is completely separate)
 * 
 * @param network - Network to connect to (default: 'preview')
 * @returns The API object returned by provider.connect()
 * @throws Error('NO_CONNECTOR') if connector not found
 * @throws Error('USER_REJECTED') if user rejected
 * @throws Original error for other failures
 */
/**
 * Supported Midnight networks
 */
const MIDNIGHT_NETWORKS = ['mainnet', 'preprod', 'preview'] as const;
type MidnightNetwork = typeof MIDNIGHT_NETWORKS[number];

/**
 * Connect to Lace wallet using Midnight DApp Connector API v4.0.x
 * 
 * This function:
 * 1. First tries to connect with the requested network
 * 2. If network mismatch, tries other networks automatically
 * 3. Returns the connected API with network info
 * 
 * Uses ONLY window.midnight (Midnight DApp Connector API)
 * NEVER uses window.cardano (CIP-30 is completely separate)
 * 
 * @param preferredNetwork - Preferred network (default: 'preview'), or 'auto' to try all
 * @returns Object with API, connected network, and wallet info
 * @throws Error('NO_CONNECTOR') if connector not found
 * @throws Error('USER_REJECTED') if user rejected
 * @throws Original error for other failures
 */
async function connectMidnightPreview(preferredNetwork: string = 'preview'): Promise<any> {
  console.log(`[MidnightSDK] ═══════════════════════════════════════════`);
  console.log(`[MidnightSDK] connectMidnightPreview('${preferredNetwork}')`);
  console.log(`[MidnightSDK] Origin: ${location.origin}`);
  console.log(`[MidnightSDK] Using: Midnight DApp Connector API v4.0.x`);
  console.log(`[MidnightSDK] ═══════════════════════════════════════════`);
  
  // First check if wallet is already available
  let detection = MidnightConnector.detectMidnightPreview();
  
  // If not found, wait for it (wallet extensions inject asynchronously)
  if (!detection.midnightExists || !detection.detected) {
    console.log('[MidnightSDK] Wallet not detected immediately, waiting up to 5 seconds...');
    
    const waitResult = await MidnightConnector.waitForMidnightProvider({
      timeoutMs: 5000,
      intervalMs: 200,
    });
    
    if (waitResult.success) {
      console.log(`[MidnightSDK] ✓ Wallet detected after ${waitResult.elapsed}ms`);
      detection = MidnightConnector.detectMidnightPreview();
    } else {
      console.error('[MidnightSDK] ✗ NO_CONNECTOR: window.midnight not found after waiting');
      console.error('[MidnightSDK] Troubleshooting:');
      console.error('[MidnightSDK]   1. Is Lace wallet extension installed?');
      console.error('[MidnightSDK]   2. Is Midnight mode enabled in Lace settings?');
      console.error('[MidnightSDK]   3. Is the wallet unlocked?');
      console.error('[MidnightSDK]   4. Try refreshing the page');
      throw new Error('NO_CONNECTOR');
    }
  }
  
  if (!detection.detected || !detection.selectedProvider) {
    console.error('[MidnightSDK] ✗ NO_CONNECTOR: No Lace provider with connect() found');
    if (!detection.mnLaceExists && detection.candidateCount === 0) {
      console.error(`[MidnightSDK] window.midnight keys: [${detection.midnightKeys.join(', ')}]`);
      console.error('[MidnightSDK] No Lace providers found. Ensure Midnight mode is enabled.');
    }
    throw new Error('NO_CONNECTOR');
  }
  
  const discovered = detection.selectedProvider;
  console.log(`[MidnightSDK] ✓ Found provider: ${discovered.meta.key}`);
  console.log(`[MidnightSDK]   Name: ${discovered.meta.name}`);
  console.log(`[MidnightSDK]   API Version: ${discovered.meta.apiVersion}`);
  console.log(`[MidnightSDK]   Source: ${discovered.meta.source}`);
  
  // Build list of networks to try
  // 'auto' = try preview, then preprod (use whichever the wallet accepts).
  // Otherwise: try the requested one first, then fall back to the other.
  let networksToTry: string[];
  if (preferredNetwork === 'auto' || !preferredNetwork) {
    networksToTry = ['preview', 'preprod'];
  } else if (preferredNetwork === 'preview') {
    networksToTry = ['preview', 'preprod'];
  } else if (preferredNetwork === 'preprod') {
    networksToTry = ['preprod', 'preview'];
  } else {
    networksToTry = [preferredNetwork];
  }

  console.log(`[MidnightSDK] Networks to try: [${networksToTry.join(', ')}]`);
  
  let lastError: Error | null = null;
  let connectedNetwork: string | null = null;
  
  for (const network of networksToTry) {
    console.log(`[MidnightSDK] ───────────────────────────────────────────`);
    console.log(`[MidnightSDK] Trying network: ${network}`);
    
    try {
      const api = await discovered.connectFn(network);
      
      if (!api) {
        console.warn(`[MidnightSDK] connect('${network}') returned null`);
        continue;
      }
      
      // Success!
      connectedNetwork = network;
      state.connected = true;
      state.connector = discovered.provider;
      state.api = api;
      state.connectorPath = `window.midnight.${discovered.meta.key}`;
      
      console.log(`[MidnightSDK] ═══════════════════════════════════════════`);
      console.log(`[MidnightSDK] ✓ CONNECTED!`);
      console.log(`[MidnightSDK]   Network: ${network}`);
      console.log(`[MidnightSDK]   Provider: ${discovered.meta.name} v${discovered.meta.apiVersion}`);
      console.log(`[MidnightSDK] ═══════════════════════════════════════════`);
      
      // Try to get additional info from the API
      let walletInfo: any = { network };
      
      try {
        // Get configuration to confirm network
        if (typeof api.getConfiguration === 'function') {
          const config = await api.getConfiguration();
          console.log(`[MidnightSDK] Configuration:`, config);
          walletInfo.config = config;
          // CRITICAL: persist to module state so setupProviders() can use the
          // wallet-supplied URIs (indexer, prover, etc.) instead of falling back
          // to the hardcoded defaults. Without this assignment the prover URL
          // defaults to a non-existent host and tx submission fails with
          // ERR_NAME_NOT_RESOLVED.
          state.serviceUriConfig = config;
          if (config?.networkId) {
            walletInfo.network = config.networkId;
            connectedNetwork = config.networkId;
          }
        }
        
        // Get shielded address
        if (typeof api.getShieldedAddresses === 'function') {
          const shielded = await api.getShieldedAddresses();
          console.log(`[MidnightSDK] Shielded addresses:`, shielded);
          if (shielded?.shieldedAddress) {
            walletInfo.shieldedAddress = shielded.shieldedAddress;
            walletInfo.address = shielded.shieldedAddress;
          }
        }
        
        // Get unshielded address
        if (typeof api.getUnshieldedAddress === 'function') {
          const unshielded = await api.getUnshieldedAddress();
          console.log(`[MidnightSDK] Unshielded address:`, unshielded);
          if (unshielded?.unshieldedAddress) {
            walletInfo.unshieldedAddress = unshielded.unshieldedAddress;
          }
        }
      } catch (infoErr) {
        console.warn(`[MidnightSDK] Could not get wallet info:`, infoErr);
      }
      
      // Mark as authorized since we successfully connected
      _authorized = true;
      state.network = connectedNetwork || 'preview';
      console.log(`[MidnightSDK] ✓ Authorized for API calls`);
      
      // Return success result
      return {
        success: true,
        api,
        network: connectedNetwork,
        address: walletInfo.address || walletInfo.shieldedAddress || '',
        walletInfo,
        provider: discovered.meta.name,
        apiVersion: discovered.meta.apiVersion,
      };
      
    } catch (err: any) {
      const msg = (err?.message || String(err)).toLowerCase();
      lastError = err;
      
      console.warn(`[MidnightSDK] ✗ Failed on ${network}: ${err.message || err}`);
      
      // If user rejected, don't try other networks
      if (msg.includes('rejected') || msg.includes('denied') || msg.includes('user rejected')) {
        console.error('[MidnightSDK] User rejected connection');
        throw new Error('USER_REJECTED');
      }
      
      // If network mismatch, try next network
      if (msg.includes('network') && msg.includes('mismatch')) {
        console.log(`[MidnightSDK] Network mismatch, trying next...`);
        continue;
      }
      
      // For other errors, try next network
      console.log(`[MidnightSDK] Will try next network...`);
    }
  }
  
  // All networks failed
  console.error(`[MidnightSDK] ✗ All networks failed`);
  console.error(`[MidnightSDK] Last error: ${lastError?.message || lastError}`);
  console.error(`[MidnightSDK] Please check your Lace wallet network settings`);
  
  throw lastError || new Error('CONNECTION_FAILED');
}

/**
 * Wait for a Midnight Lace provider to be injected.
 * 
 * Supports BOTH injection patterns:
 * 1. window.midnight.mnLace
 * 2. window.midnight[uuid] where provider.name === "lace"
 * 
 * NEVER checks window.cardano (CIP-30 is separate).
 * 
 * @param timeoutMs - Maximum time to wait (default: 20000ms)
 * @param intervalMs - Poll interval (default: 250ms)
 * @returns Promise with success status and connector info
 */
async function waitForMnLace(timeoutMs = 20000, intervalMs = 250): Promise<{
  success: boolean;
  elapsed: number;
  connector: ReturnType<typeof findMidnightConnector>;
  errorMessage: string | null;
}> {
  console.log(`[MidnightSDK] waitForMnLace() starting (timeout: ${timeoutMs}ms, interval: ${intervalMs}ms)`);
  console.log(`[MidnightSDK]   Waiting for: Lace Midnight provider (mnLace or UUID key)`);
  console.log(`[MidnightSDK]   NOT checking: window.cardano (CIP-30 is separate)`);
  
  // Use MidnightConnector's wait helper
  const result = await MidnightConnector.waitForMidnightProvider({
    timeoutMs,
    intervalMs,
  });
  
  if (result.success && result.provider) {
    // Convert to legacy format
    const connector = findMidnightConnector();
    return {
      success: true,
      elapsed: result.elapsed,
      connector,
      errorMessage: null,
    };
  }
  
  return {
    success: false,
    elapsed: result.elapsed,
    connector: null,
    errorMessage: result.errorMessage,
  };
}

/**
 * Get detailed connector availability info for debugging.
 * Uses MidnightConnector's detection system.
 */
function getConnectorInfo(): {
  available: boolean;
  midnightExists: boolean;
  midnightKeys: string[];
  providerKey: string | null;
  hasConnect: boolean;
  hasEnable: boolean;
  whereConnectFound: string;
} {
  const detection = MidnightConnector.detectMidnightPreview();
  
  if (!detection.midnightExists) {
    return {
      available: false,
      midnightExists: false,
      midnightKeys: [],
      providerKey: null,
      hasConnect: false,
      hasEnable: false,
      whereConnectFound: 'not-found',
    };
  }

  if (!detection.detected || !detection.selectedProvider) {
    return {
      available: false,
      midnightExists: true,
      midnightKeys: detection.midnightKeys,
      providerKey: null,
      hasConnect: false,
      hasEnable: false,
      whereConnectFound: 'not-found',
    };
  }

  const provider = detection.selectedProvider;
  const whereConnectFound = detection.connectOnPrototype ? 'prototype' : 'direct';

  return {
    available: true,
    midnightExists: true,
    midnightKeys: detection.midnightKeys,
    providerKey: provider.meta.key,
    hasConnect: true,
    hasEnable: hasMethodDeep(provider.provider, 'enable'),
    whereConnectFound,
  };
}

/**
 * Wait for Midnight connector to be injected.
 * Polls until connector is available or timeout.
 * 
 * Default timeout: 20000ms (20 seconds) - extensions can be slow to inject
 * Poll interval: 250ms
 */
async function waitForConnector(timeoutMs = 20000, intervalMs = 250): Promise<{
  success: boolean;
  elapsed: number;
  info: ReturnType<typeof getConnectorInfo>;
  errorMessage: string | null;
}> {
  const startTime = Date.now();
  let lastLogTime = 0;
  
  console.log(`[MidnightSDK] waitForConnector() starting (timeout: ${timeoutMs}ms, interval: ${intervalMs}ms)`);
  
  return new Promise((resolve) => {
    function check() {
      const elapsed = Date.now() - startTime;
      const info = getConnectorInfo();
      
      // Log progress every 5 seconds
      if (elapsed - lastLogTime >= 5000) {
        console.log(`[MidnightSDK] Still waiting for connector... ${elapsed}ms elapsed`);
        console.log(`[MidnightSDK]   window.midnight exists: ${info.midnightExists}`);
        if (info.midnightExists) {
          console.log(`[MidnightSDK]   window.midnight keys: ${info.midnightKeys?.join(', ') || 'none'}`);
        }
        lastLogTime = elapsed;
      }
      
      if (info.available) {
        console.log(`[MidnightSDK] ✓ Connector detected after ${elapsed}ms`);
        console.log(`[MidnightSDK]   Provider: ${info.providerKey}`);
        console.log(`[MidnightSDK]   hasConnect: ${info.hasConnect} (${info.whereConnectFound})`);
        console.log(`[MidnightSDK]   hasEnable: ${info.hasEnable}`);
        resolve({ success: true, elapsed, info, errorMessage: null });
        return;
      }
      
      if (elapsed >= timeoutMs) {
        console.error(`[MidnightSDK] ✗ Connector not found after ${timeoutMs}ms timeout`);
        console.error(`[MidnightSDK]   window.midnight exists: ${info.midnightExists}`);
        
        // Build actionable error message
        let errorMessage = 'Lace wallet not injected into this page.\n\n';
        errorMessage += 'Check:\n';
        errorMessage += '• Correct Chrome profile with Lace installed\n';
        errorMessage += '• Extension enabled (not disabled)\n';
        errorMessage += '• Site authorized for localhost (extension settings)\n';
        errorMessage += '• Midnight mode enabled in Lace settings\n';
        errorMessage += '• Reload the page after enabling\n';
        
        if (location.protocol === 'file:') {
          errorMessage += '\n⚠️ You are using file:// protocol - extensions cannot inject here.\n';
          errorMessage += 'Serve the page over HTTP (e.g., localhost:8080).\n';
        }
        
        if (window.top !== window.self) {
          errorMessage += '\n⚠️ Page is in an iframe - extension injection may be blocked.\n';
        }
        
        console.error('[MidnightSDK] ' + errorMessage.replace(/\n/g, '\n[MidnightSDK] '));
        
        resolve({ success: false, elapsed, info, errorMessage });
        return;
      }
      
      setTimeout(check, intervalMs);
    }
    
    check();
  });
}

/**
 * Check if we're in a user gesture context (click, keypress, etc.)
 * This is important because wallet popups may be blocked outside user gestures.
 */
function isUserGestureContext(): boolean {
  // Check if we have a recent user activation
  // Note: This is a heuristic - browsers don't expose this directly
  try {
    // navigator.userActivation is available in modern browsers
    if ((navigator as any).userActivation) {
      const ua = (navigator as any).userActivation;
      return ua.isActive || ua.hasBeenActive;
    }
  } catch (e) {
    // Fallback: assume we're in a user gesture if called from event handler
  }
  return true; // Assume true if we can't detect
}

/**
 * Classify connection errors for better user feedback.
 */
function classifyConnectionError(error: any): {
  type: 'rejected' | 'popup_blocked' | 'unauthorized' | 'not_found' | 'unknown';
  message: string;
  userAction: string;
} {
  const msg = (error?.message || String(error)).toLowerCase();
  
  if (msg.includes('rejected') || msg.includes('denied') || msg.includes('user rejected')) {
    return {
      type: 'rejected',
      message: 'User rejected the connection request in the wallet popup.',
      userAction: 'Click Connect again and approve the request in the Lace wallet popup.',
    };
  }
  
  if (msg.includes('popup') || msg.includes('blocked') || msg.includes('not allowed to open')) {
    return {
      type: 'popup_blocked',
      message: 'Wallet popup was blocked by the browser.',
      userAction: 'Allow popups for this site, or click Connect from a user-initiated action (button click).',
    };
  }
  
  if (msg.includes('unauthorized') || msg.includes('enable')) {
    return {
      type: 'unauthorized',
      message: 'Connection succeeded but API calls are unauthorized.',
      userAction: 'The wallet may require additional authorization. Try disconnecting and reconnecting.',
    };
  }
  
  if (msg.includes('not found') || msg.includes('not installed') || msg.includes('missing')) {
    return {
      type: 'not_found',
      message: 'Midnight connector not found.',
      userAction: 'Install Lace wallet with Midnight mode enabled, then reload the page.',
    };
  }
  
  return {
    type: 'unknown',
    message: error?.message || String(error),
    userAction: 'Check the browser console for details. Try reloading the page.',
  };
}

/**
 * Connect to the Midnight wallet via the DApp connector.
 * 
 * Supports BOTH injection patterns:
 * 1. window.midnight.mnLace (preferred if present)
 * 2. window.midnight[uuid] where provider.name === "lace"
 * 
 * NEVER references window.cardano (CIP-30 is separate)
 * 
 * Features:
 * - Single-flight guard: prevents multiple simultaneous connect attempts
 * - Returns existing API if already connected
 * - Waits for mnLace injection if not immediately available
 * - Calls enable() after connect() if authorization is required
 * - Provides clear error classification
 * 
 * @param network - Network to connect to (default: 'preview')
 */
async function connect(network: string = 'preview'): Promise<{
  api: any;
  walletState: any;
  serviceUriConfig: any;
  connectorPath: string;
  connectionMethod: string;
}> {
  // Single-flight guard: if already connected, return existing API
  if (state.connected && state.api) {
    console.log('[MidnightSDK] connect(): Already connected, returning existing API');
    return {
      api: state.api,
      walletState: state.walletState,
      serviceUriConfig: state.serviceUriConfig,
      connectorPath: state.connectorPath,
      connectionMethod: 'cached',
    };
  }
  
  // Single-flight guard: if connect is in progress, return the same promise
  if (_connectInProgress) {
    console.log('[MidnightSDK] connect(): Connection already in progress, waiting...');
    return _connectInProgress;
  }
  
  // Start new connection attempt
  _connectInProgress = (async () => {
    try {
      console.log('[MidnightSDK] ════════════════════════════════════════════════════════');
      console.log('[MidnightSDK] connect(): Starting new connection attempt');
      console.log('[MidnightSDK] ════════════════════════════════════════════════════════');
      console.log('[MidnightSDK] Supports: mnLace + UUID-keyed Lace providers');
      console.log(`[MidnightSDK] Network: ${network}`);
      console.log(`[MidnightSDK] Origin: ${location.origin}`);
      console.log(`[MidnightSDK] Time: ${new Date().toISOString()}`);
      
      // Check user gesture context
      const inUserGesture = isUserGestureContext();
      console.log(`[MidnightSDK] User gesture context: ${inUserGesture}`);
      if (!inUserGesture) {
        console.warn('[MidnightSDK] ⚠️ WARNING: Not in user gesture context!');
        console.warn('[MidnightSDK] Wallet popup may be blocked by browser.');
        console.warn('[MidnightSDK] Call connect() from a button click handler.');
      }
      
      // Wait for mnLace to be injected (5 second timeout for user-gesture context)
      const waitResult = await waitForMnLace(5000, 100);
      
      if (!waitResult.success || !waitResult.connector) {
        const err = new Error(waitResult.errorMessage || 'Midnight connector not found');
        const classified = classifyConnectionError(err);
        console.error(`[MidnightSDK] ${classified.type}: ${classified.message}`);
        console.error(`[MidnightSDK] User action: ${classified.userAction}`);
        throw err;
      }
      
      const connectorInfo = waitResult.connector;
      const provider = connectorInfo.connector;
      
      console.log(`[MidnightSDK] Found: ${connectorInfo.name} v${connectorInfo.apiVersion}`);
      console.log(`[MidnightSDK] hasConnect: ${connectorInfo.hasConnect}, hasEnable: ${connectorInfo.hasEnable}`);
      
      state.connector = provider;
      state.connectorPath = connectorInfo.path;
      
      // Call connect(network)
      console.log(`[MidnightSDK] Calling mnLace.connect('${network}')...`);
      console.log('[MidnightSDK] NOTE: If you see a CARDANO popup instead of MIDNIGHT:');
      console.log('[MidnightSDK]   → Open Lace settings → Enable Midnight mode');
      console.log('[MidnightSDK]   → Restart browser and reload page');
      
      let api: any;
      try {
        api = await provider.connect(network);
      } catch (connectErr: any) {
        const classified = classifyConnectionError(connectErr);
        console.error('[MidnightSDK] ════════════════════════════════════════════════════════');
        console.error(`[MidnightSDK] connect() FAILED: ${classified.type}`);
        console.error('[MidnightSDK] ════════════════════════════════════════════════════════');
        console.error(`[MidnightSDK] Raw error: ${connectErr.message || connectErr}`);
        console.error(`[MidnightSDK] Classified: ${classified.message}`);
        console.error(`[MidnightSDK] User action: ${classified.userAction}`);
        
        // Additional diagnostics for rejection
        if (classified.type === 'rejected') {
          console.error('[MidnightSDK] ────────────────────────────────────────────────────────');
          console.error('[MidnightSDK] REJECTION DIAGNOSTICS:');
          console.error('[MidnightSDK]   1. Did you see a wallet popup? If not, popup may be blocked.');
          console.error('[MidnightSDK]   2. Did you click "Reject" or close the popup?');
          console.error('[MidnightSDK]   3. Is Lace in Midnight mode (not Cardano mode)?');
          console.error('[MidnightSDK]   4. Is this origin whitelisted in Lace settings?');
          console.error(`[MidnightSDK]   Current origin: ${location.origin}`);
          console.error('[MidnightSDK] ────────────────────────────────────────────────────────');
        }
        
        throw new Error(`${classified.message} (${classified.userAction})`);
      }
      
      if (!api) {
        throw new Error('connect() returned null - user may have rejected or popup was blocked');
      }
      
      state.api = api;
      console.log(`[MidnightSDK] connect('${network}') succeeded`);
      
      // Log API keys
      try {
        const apiKeys = Object.keys(api);
        const apiOwnProps = Object.getOwnPropertyNames(api);
        console.log('[MidnightSDK] API keys:', apiKeys.length > 0 ? apiKeys : apiOwnProps);
      } catch (e) {
        console.log('[MidnightSDK] Could not enumerate API keys');
      }
      
      // Test authorization and call enable() if needed
      const authResult = await authorizeIfRequired(provider, api);
      _authorized = authResult.authorized;
      
      if (authResult.enableCalled) {
        console.log('[MidnightSDK] enable() was called for authorization');
      }
      
      if (!authResult.authorized && authResult.error) {
        console.warn(`[MidnightSDK] Authorization warning: ${authResult.error}`);
      }
      
      // Get wallet state
      if (_authorized && hasMethodDeep(api, 'getShieldedAddresses')) {
        try {
          const addresses = await api.getShieldedAddresses();
          state.walletState = { shieldedAddresses: addresses };
          console.log('[MidnightSDK] Shielded addresses:', addresses);
        } catch (e: any) {
          console.warn('[MidnightSDK] getShieldedAddresses() failed:', e.message);
        }
      }
      
      // Get configuration
      if (_authorized && hasMethodDeep(api, 'getConfiguration')) {
        try {
          state.serviceUriConfig = await api.getConfiguration();
          console.log('[MidnightSDK] Configuration:', state.serviceUriConfig);
        } catch (e: any) {
          console.warn('[MidnightSDK] getConfiguration() failed:', e.message);
        }
      }
      
      state.connected = true;
      state.network = network;
      console.log('[MidnightSDK] Connection complete. authorized:', _authorized);
      
      return {
        api: state.api,
        walletState: state.walletState,
        serviceUriConfig: state.serviceUriConfig,
        connectorPath: state.connectorPath,
        connectionMethod: `connect('${network}')`,
      };
    } finally {
      _connectInProgress = null;
    }
  })();
  
  return _connectInProgress;
}

/**
 * Disconnect from the wallet.
 */
function disconnect(): void {
  state.connected = false;
  state.network = '';
  state.connector = null;
  state.api = null;
  state.walletState = null;
  state.serviceUriConfig = null;
  state.connectorPath = '';
  _authorized = false;
  console.log('[MidnightSDK] Disconnected');
}

// ---- Two-Phase Authorization State ----
let _authorized = false;

/**
 * Authorize API calls if required.
 * 
 * After connect('preview'), some API calls may fail with:
 * "Unauthorized request origin: http://localhost:XXXX. Call midnight.{walletName}.enable() first"
 * 
 * This function detects that error and calls enable() to authorize.
 * 
 * @param provider - The provider object (window.midnight.mnLace)
 * @param api - The API object returned from connect()
 * @returns Object with authorized status and any errors
 */
async function authorizeIfRequired(provider: any, api: any): Promise<{
  authorized: boolean;
  enableCalled: boolean;
  error: string | null;
}> {
  console.log('[MidnightSDK] authorizeIfRequired: Testing authorization...');
  
  // Try a cheap API call to test authorization
  try {
    if (hasMethodDeep(api, 'getConnectionStatus')) {
      const status = await api.getConnectionStatus();
      console.log('[MidnightSDK] authorizeIfRequired: getConnectionStatus() succeeded:', status);
      return { authorized: true, enableCalled: false, error: null };
    } else if (hasMethodDeep(api, 'getConfiguration')) {
      const cfg = await api.getConfiguration();
      console.log('[MidnightSDK] authorizeIfRequired: getConfiguration() succeeded');
      return { authorized: true, enableCalled: false, error: null };
    } else {
      // No test method available, assume authorized
      console.log('[MidnightSDK] authorizeIfRequired: No test method available, assuming authorized');
      return { authorized: true, enableCalled: false, error: null };
    }
  } catch (testErr: any) {
    const msg = testErr.message || String(testErr);
    console.warn('[MidnightSDK] authorizeIfRequired: Test call failed:', msg);
    
    // Check if this is an authorization error
    const isAuthError = msg.toLowerCase().includes('unauthorized') || 
                        msg.toLowerCase().includes('enable') ||
                        msg.toLowerCase().includes('origin');
    
    if (!isAuthError) {
      // Not an auth error - something else went wrong
      console.error('[MidnightSDK] authorizeIfRequired: Non-authorization error');
      return { authorized: false, enableCalled: false, error: msg };
    }
    
    // Authorization required - try enable()
    console.log('[MidnightSDK] authorizeIfRequired: Authorization required, calling enable()...');
    
    // Try provider.enable() first (most common)
    if (hasMethodDeep(provider, 'enable')) {
      try {
        console.log('[MidnightSDK] authorizeIfRequired: Calling provider.enable()...');
        await provider.enable();
        console.log('[MidnightSDK] authorizeIfRequired: provider.enable() succeeded');
        
        // Retry the test call
        try {
          if (hasMethodDeep(api, 'getConnectionStatus')) {
            await api.getConnectionStatus();
            console.log('[MidnightSDK] authorizeIfRequired: Retry succeeded after enable()');
            return { authorized: true, enableCalled: true, error: null };
          } else if (hasMethodDeep(api, 'getConfiguration')) {
            await api.getConfiguration();
            console.log('[MidnightSDK] authorizeIfRequired: Retry succeeded after enable()');
            return { authorized: true, enableCalled: true, error: null };
          } else {
            return { authorized: true, enableCalled: true, error: null };
          }
        } catch (retryErr: any) {
          console.error('[MidnightSDK] authorizeIfRequired: Retry failed after enable():', retryErr.message);
          return { authorized: false, enableCalled: true, error: `Retry failed: ${retryErr.message}` };
        }
      } catch (enableErr: any) {
        console.error('[MidnightSDK] authorizeIfRequired: provider.enable() failed:', enableErr.message);
        return { authorized: false, enableCalled: true, error: `enable() failed: ${enableErr.message}` };
      }
    }
    
    // Try api.enable() as fallback
    if (hasMethodDeep(api, 'enable')) {
      try {
        console.log('[MidnightSDK] authorizeIfRequired: Calling api.enable()...');
        await api.enable();
        console.log('[MidnightSDK] authorizeIfRequired: api.enable() succeeded');
        return { authorized: true, enableCalled: true, error: null };
      } catch (enableErr: any) {
        console.error('[MidnightSDK] authorizeIfRequired: api.enable() failed:', enableErr.message);
        return { authorized: false, enableCalled: true, error: `api.enable() failed: ${enableErr.message}` };
      }
    }
    
    console.error('[MidnightSDK] authorizeIfRequired: No enable() method found on provider or api');
    return { authorized: false, enableCalled: false, error: 'No enable() method available for authorization' };
  }
}

/**
 * Canonical Midnight Preview connect with two-phase authorization.
 *
 * Supports BOTH injection patterns:
 * 1. window.midnight.mnLace (preferred if present)
 * 2. window.midnight[uuid] where provider.name === "lace"
 *
 * NEVER touches window.cardano (CIP-30 is separate)
 *
 * Phase 1: connect('preview') - establishes connection
 * Phase 2: enable() - authorizes API calls (if needed)
 *
 * Some API calls (getConnectionStatus, getShieldedAddresses, getConfiguration)
 * may throw "Unauthorized request origin" after connect(). In that case,
 * we call provider.enable() to authorize, then retry.
 *
 * NOTE: Function name kept as connectPreprod for C# jslib compat.
 * It now defaults to Preview. Pass 'preprod' explicitly for Preprod.
 */
async function connectPreprod(): Promise<{
  success: boolean;
  connected: boolean;
  authorized: boolean;
  providerKey: string;
  apiVersion: string;
  walletName: string;
  errors: string[];
}> {
  const errors: string[] = [];
  let connected = false;
  let authorized = false;
  let providerKey = '';
  let apiVersion = '';
  let walletName = '';

  console.log('[MidnightSDK] connectPreprod() starting...');
  console.log('[MidnightSDK] Supports: mnLace and UUID-keyed Lace providers');

  // === EXPLICIT LOGGING: Log connector existence ===
  const detection = MidnightConnector.detectMidnightPreview();
  console.log('[MidnightSDK] === Connector Existence Check ===');
  console.log('[MidnightSDK]   window.midnight exists:', detection.midnightExists);
  console.log('[MidnightSDK]   window.midnight keys:', detection.midnightKeys);
  console.log('[MidnightSDK]   mnLace exists:', detection.mnLaceExists);
  console.log('[MidnightSDK]   UUID candidates:', detection.candidateCount);
  console.log('[MidnightSDK]   window.cardano.lace exists:', detection.cardanoLaceExists, '(CIP-30, NOT used)');
  console.log('[MidnightSDK] === End Existence Check ===');

  // Step 1: Wait for provider injection (20 second timeout)
  console.log('[MidnightSDK] Step 1: Waiting for Lace Midnight provider (20s timeout)...');
  const waitResult = await waitForMnLace(20000, 250);
  
  if (!waitResult.success) {
    const err = waitResult.errorMessage || 'Midnight provider not found.';
    console.error('[MidnightSDK]', err);
    errors.push(err);
    return { success: false, connected, authorized, providerKey, apiVersion, walletName, errors };
  }

  // Use connector info from waitForMnLace
  const connectorInfo = waitResult.connector!;
  walletName = connectorInfo.name;
  apiVersion = connectorInfo.apiVersion;
  providerKey = connectorInfo.path.replace('window.midnight.', '');
  const provider = connectorInfo.connector;
  
  console.log(`[MidnightSDK] Step 1 SUCCESS: Found ${walletName} v${apiVersion} at ${providerKey}`);
  console.log(`[MidnightSDK]   hasConnect: ${connectorInfo.hasConnect}`);
  console.log(`[MidnightSDK]   hasEnable: ${connectorInfo.hasEnable}`);

  // Step 2: Verify provider - ensure it's NOT CIP-30
  console.log('[MidnightSDK] Step 2: Verifying provider is not CIP-30...');
  
  // CIP-30 GUARD: Throw error if somehow we got CIP-30 connector
  if (provider === (window as any).cardano?.lace) {
    const guardErr = 'FATAL: Midnight connect accidentally grabbed CIP-30 connector (window.cardano.lace). This is a bug.';
    console.error('[MidnightSDK]', guardErr);
    console.error('[MidnightSDK] Stack trace:', new Error().stack);
    errors.push(guardErr);
    return { success: false, connected, authorized, providerKey, apiVersion, walletName, errors };
  }
  
  if (!provider) {
    const err = 'Provider object is null after successful detection';
    console.error('[MidnightSDK]', err);
    errors.push(err);
    return { success: false, connected, authorized, providerKey, apiVersion, walletName, errors };
  }

  console.log(`[MidnightSDK] Step 2 SUCCESS: Provider verified at window.midnight.${providerKey}`);

  // Step 3: Call connect('preview')
  console.log('[MidnightSDK] Step 3: Calling connect("preview")...');
  let api: any;
  try {
    if (!hasMethodDeep(provider, 'connect')) {
      throw new Error('Provider does not have connect() method');
    }
    api = await provider.connect('preview');
    if (!api) {
      throw new Error('connect() returned null - user may have rejected');
    }
    connected = true;
    state.api = api;
    state.connector = provider;
    state.connectorPath = `window.midnight.${providerKey}`;
    state.connected = true;
    console.log('[MidnightSDK] Step 3 SUCCESS: Connected to Preview');
  } catch (e: any) {
    const err = `connect() failed: ${e.message}`;
    console.error('[MidnightSDK]', err);
    errors.push(err);
    return { success: false, connected, authorized, providerKey, apiVersion, walletName, errors };
  }

  // Step 4: Test and authorize if needed
  console.log('[MidnightSDK] Step 4: Testing authorization (will call enable() if needed)...');
  const authResult = await authorizeIfRequired(provider, api);
  authorized = authResult.authorized;
  
  if (authResult.enableCalled) {
    console.log('[MidnightSDK] Step 4: enable() was called');
  }
  
  if (authResult.error) {
    console.warn('[MidnightSDK] Step 4: Authorization error:', authResult.error);
    errors.push(authResult.error);
  }
  
  if (authorized) {
    console.log('[MidnightSDK] Step 4 SUCCESS: Authorized');
  } else {
    console.warn('[MidnightSDK] Step 4: Not fully authorized, some API calls may fail');
  }

  _authorized = authorized;

  // Step 6: Get wallet state and service config
  console.log('[MidnightSDK] Step 6: Getting wallet state and config...');
  
  if (authorized) {
    // Try to get shielded addresses
    if (hasMethodDeep(api, 'getShieldedAddresses')) {
      try {
        const addrs = await api.getShieldedAddresses();
        state.walletState = { shieldedAddresses: addrs };
        console.log('[MidnightSDK] Shielded addresses:', addrs);
      } catch (e: any) {
        console.warn('[MidnightSDK] getShieldedAddresses() failed:', e.message);
      }
    } else if (hasMethodDeep(api, 'state')) {
      try {
        state.walletState = await api.state();
        console.log('[MidnightSDK] Wallet state:', state.walletState);
      } catch (e: any) {
        console.warn('[MidnightSDK] state() failed:', e.message);
      }
    }

    // Try to get service config
    if (!state.serviceUriConfig && hasMethodDeep(api, 'getConfiguration')) {
      try {
        state.serviceUriConfig = await api.getConfiguration();
        console.log('[MidnightSDK] Configuration:', state.serviceUriConfig);
      } catch (e: any) {
        console.warn('[MidnightSDK] getConfiguration() failed:', e.message);
      }
    }
  }

  const success = connected && authorized;
  console.log(`[MidnightSDK] connectPreprod() complete: success=${success}, connected=${connected}, authorized=${authorized}`);

  return {
    success,
    connected,
    authorized,
    providerKey,
    apiVersion,
    walletName,
    errors,
  };
}

/**
 * Get the current wallet state (requires connection).
 * 
 * v4.0.0: Uses granular methods (getShieldedAddresses, getShieldedBalances, etc.)
 * Falls back to legacy state() method if new methods not available.
 */
async function getWalletState(): Promise<any> {
  if (!state.api) throw new Error('Not connected');
  
  // v4.0.0: Use granular methods
  if (typeof state.api.getShieldedAddresses === 'function') {
    console.log('[MidnightSDK] Using v4.0.0 granular wallet state methods');
    
    const walletState: any = {};
    
    // Get shielded addresses
    try {
      const addresses = await state.api.getShieldedAddresses();
      walletState.shieldedAddress = addresses.shieldedAddress;
      walletState.shieldedCoinPublicKey = addresses.shieldedCoinPublicKey;
      walletState.shieldedEncryptionPublicKey = addresses.shieldedEncryptionPublicKey;
      // Legacy compatibility
      walletState.address = addresses.shieldedAddress;
      walletState.coinPublicKey = addresses.shieldedCoinPublicKey;
      walletState.encryptionPublicKey = addresses.shieldedEncryptionPublicKey;
    } catch (e: any) {
      console.warn('[MidnightSDK] getShieldedAddresses() failed:', e.message);
    }
    
    // Get unshielded address
    if (typeof state.api.getUnshieldedAddress === 'function') {
      try {
        walletState.unshieldedAddress = await state.api.getUnshieldedAddress();
      } catch (e: any) {
        console.warn('[MidnightSDK] getUnshieldedAddress() failed:', e.message);
      }
    }
    
    // Get shielded balances
    if (typeof state.api.getShieldedBalances === 'function') {
      try {
        walletState.shieldedBalances = await state.api.getShieldedBalances();
      } catch (e: any) {
        console.warn('[MidnightSDK] getShieldedBalances() failed:', e.message);
      }
    }
    
    // Get unshielded balances
    if (typeof state.api.getUnshieldedBalances === 'function') {
      try {
        walletState.unshieldedBalances = await state.api.getUnshieldedBalances();
      } catch (e: any) {
        console.warn('[MidnightSDK] getUnshieldedBalances() failed:', e.message);
      }
    }
    
    // Get dust balance
    if (typeof state.api.getDustBalance === 'function') {
      try {
        walletState.dustBalance = await state.api.getDustBalance();
      } catch (e: any) {
        console.warn('[MidnightSDK] getDustBalance() failed:', e.message);
      }
    }
    
    state.walletState = walletState;
    return walletState;
  }
  
  // Fallback to legacy state() method
  if (typeof state.api.state === 'function') {
    console.log('[MidnightSDK] Using legacy state() method');
    state.walletState = await state.api.state();
    return state.walletState;
  }
  
  throw new Error('API does not have getShieldedAddresses() or state()');
}

/**
 * Get shielded addresses (v4.0.0).
 */
async function getShieldedAddresses(): Promise<{
  shieldedAddress: string;
  shieldedCoinPublicKey: string;
  shieldedEncryptionPublicKey: string;
}> {
  if (!state.api) throw new Error('Not connected');
  if (typeof state.api.getShieldedAddresses !== 'function') {
    throw new Error('API does not have getShieldedAddresses() - requires v4.0.0');
  }
  return await state.api.getShieldedAddresses();
}

/**
 * Get unshielded address (v4.0.0).
 */
async function getUnshieldedAddress(): Promise<string> {
  if (!state.api) throw new Error('Not connected');
  if (typeof state.api.getUnshieldedAddress !== 'function') {
    throw new Error('API does not have getUnshieldedAddress() - requires v4.0.0');
  }
  return await state.api.getUnshieldedAddress();
}

/**
 * Get shielded balances (v4.0.0).
 */
async function getShieldedBalances(): Promise<any> {
  if (!state.api) throw new Error('Not connected');
  if (typeof state.api.getShieldedBalances !== 'function') {
    throw new Error('API does not have getShieldedBalances() - requires v4.0.0');
  }
  return await state.api.getShieldedBalances();
}

/**
 * Get unshielded balances (v4.0.0).
 */
async function getUnshieldedBalances(): Promise<any> {
  if (!state.api) throw new Error('Not connected');
  if (typeof state.api.getUnshieldedBalances !== 'function') {
    throw new Error('API does not have getUnshieldedBalances() - requires v4.0.0');
  }
  return await state.api.getUnshieldedBalances();
}

/**
 * Get dust balance (v4.0.0).
 */
async function getDustBalance(): Promise<string> {
  if (!state.api) throw new Error('Not connected');
  if (typeof state.api.getDustBalance !== 'function') {
    throw new Error('API does not have getDustBalance() - requires v4.0.0');
  }
  return await state.api.getDustBalance();
}

/**
 * Get connection status (v4.0.0).
 */
async function getConnectionStatus(): Promise<{ connected: boolean; networkId: string }> {
  if (!state.api) {
    return { connected: false, networkId: '' };
  }
  if (typeof state.api.getConnectionStatus !== 'function') {
    // Fallback: assume connected if we have an API
    return { connected: true, networkId: 'unknown' };
  }
  return await state.api.getConnectionStatus();
}

/**
 * Get wallet configuration (v4.0.0).
 */
async function getConfiguration(): Promise<any> {
  if (!state.api) throw new Error('Not connected');
  if (typeof state.api.getConfiguration !== 'function') {
    throw new Error('API does not have getConfiguration()');
  }
  return await state.api.getConfiguration();
}

/**
 * Balance and prove a transaction (requires connection).
 * 
 * v4.0.0: Uses balanceUnsealedTransaction() instead of balanceAndProveTransaction()
 * Falls back to legacy method if new method not available.
 */
async function balanceAndProveTransaction(tx: any, newCoins?: any): Promise<any> {
  if (!state.api) throw new Error('Not connected');
  
  // v4.0.0: Try new balanceUnsealedTransaction first
  if (typeof state.api.balanceUnsealedTransaction === 'function') {
    console.log('[MidnightSDK] Using v4.0.0 balanceUnsealedTransaction()');
    const result = await state.api.balanceUnsealedTransaction(tx);
    return result.tx || result;
  }
  
  // Fallback to legacy method
  if (typeof state.api.balanceAndProveTransaction === 'function') {
    console.log('[MidnightSDK] Using legacy balanceAndProveTransaction()');
    return await state.api.balanceAndProveTransaction(tx, newCoins);
  }
  
  throw new Error('API does not have balanceUnsealedTransaction() or balanceAndProveTransaction()');
}

/**
 * Balance an unsealed transaction (v4.0.0).
 * Use this for contract interactions.
 */
async function balanceUnsealedTransaction(tx: string): Promise<{ tx: string }> {
  if (!state.api) throw new Error('Not connected');
  if (typeof state.api.balanceUnsealedTransaction !== 'function') {
    throw new Error('API does not have balanceUnsealedTransaction() - requires v4.0.0');
  }
  return await state.api.balanceUnsealedTransaction(tx);
}

/**
 * Balance a sealed transaction (v4.0.0).
 * Use this for completing atomic swaps.
 */
async function balanceSealedTransaction(tx: string): Promise<{ tx: string }> {
  if (!state.api) throw new Error('Not connected');
  if (typeof state.api.balanceSealedTransaction !== 'function') {
    throw new Error('API does not have balanceSealedTransaction() - requires v4.0.0');
  }
  return await state.api.balanceSealedTransaction(tx);
}

/**
 * Submit a transaction (requires connection).
 */
async function submitTransaction(tx: any): Promise<any> {
  if (!state.api) throw new Error('Not connected');
  if (typeof state.api.submitTransaction !== 'function') {
    throw new Error('API does not have submitTransaction()');
  }
  return await state.api.submitTransaction(tx);
}

// ---- Counter Contract Operations ----

// Default Counter contract address on Preview
// Deployed via counter-cli npm run preview-ps (2026-05-16)
const DEFAULT_COUNTER_ADDRESS = '8c31306d717dd2b79f30785ae7f0f5241f6f891d63441827395d8be1fecd88dd';

/**
 * Read the current counter value from a deployed Counter contract.
 * Uses the indexer to fetch public ledger state.
 * 
 * @param contractAddress - The deployed contract address (hex string)
 * @returns Object with success, counter value, and any errors
 */
async function readCounter(contractAddress: string = DEFAULT_COUNTER_ADDRESS): Promise<{
  success: boolean;
  counter: number | null;
  contractAddress: string;
  error: string | null;
}> {
  console.log('[MidnightSDK] readCounter() starting...');
  console.log('[MidnightSDK] Contract address:', contractAddress);

  try {
    // Ensure packages are loaded
    if (!_midnightPkgsLoaded) {
      console.log('[MidnightSDK] Loading Midnight packages...');
      await loadMidnightPackages();
    }

    // Get service config for indexer URI
    let indexerUri = '';
    if (state.serviceUriConfig?.indexerUri) {
      indexerUri = state.serviceUriConfig.indexerUri;
    } else if (state.serviceUriConfig?.indexer) {
      indexerUri = state.serviceUriConfig.indexer;
    } else {
      // Default Preview indexer (v4 GraphQL path)
      indexerUri = 'https://indexer.preview.midnight.network/api/v4/graphql';
    }
    console.log('[MidnightSDK] Using indexer:', indexerUri);

    // Try SDK path first if indexerPublicDataProvider is available
    if (_indexerPublicDataProvider && typeof _indexerPublicDataProvider === 'function') {
      console.log('[MidnightSDK] Querying contract public state via SDK...');
      try {
        const indexerWsUri = indexerUri.replace('https://', 'wss://').replace('/graphql', '/graphql/ws');
        const publicDataProvider = _indexerPublicDataProvider(indexerUri, indexerWsUri);
        const contractState = await publicDataProvider.queryContractState(contractAddress);
        console.log('[MidnightSDK] Contract state:', contractState);
        let counterValue = 0;
        if (contractState && contractState.publicLedgerState) {
          const publicState = contractState.publicLedgerState;
          if (typeof publicState.round === 'number') {
            counterValue = publicState.round;
          } else if (typeof publicState.round === 'bigint') {
            counterValue = Number(publicState.round);
          } else if (publicState.round !== undefined) {
            counterValue = parseInt(String(publicState.round), 10);
          }
        }
        console.log('[MidnightSDK] Counter value:', counterValue);
        return { success: true, counter: counterValue, contractAddress, error: null };
      } catch (queryErr: any) {
        console.warn('[MidnightSDK] SDK queryContractState failed:', queryErr.message);
        // Fall through to GraphQL
      }
    } else {
      console.log('[MidnightSDK] indexerPublicDataProvider not available, using direct GraphQL');
    }

    // Fallback: direct GraphQL query to indexer
    console.log('[MidnightSDK] Trying direct indexer query...');
    const query = `
      query GetContractState($address: HexEncoded!) {
        contractAction(address: $address) {
          state
        }
      }
    `;

    const response = await fetch(indexerUri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        variables: { address: contractAddress },
      }),
    });

    if (!response.ok) {
      throw new Error(`Indexer HTTP error: ${response.status}`);
    }

    const result = await response.json();
    console.log('[MidnightSDK] Indexer response:', result);

    if (result.errors) {
      throw new Error(`Indexer error: ${JSON.stringify(result.errors)}`);
    }

    let counterValue = 0;
    if (result.data?.contractAction?.state) {
      const state = result.data.contractAction.state;
      console.log('[MidnightSDK] Raw contract state:', state);
      // The state may be a JSON string or an object
      if (typeof state === 'string') {
        try {
          const parsed = JSON.parse(state);
          counterValue = parsed.round || parsed.counter || 0;
        } catch {
          counterValue = 0;
        }
      } else if (typeof state === 'object') {
        counterValue = state.round || state.counter || 0;
      } else if (typeof state === 'number') {
        counterValue = state;
      }
    } else {
      console.log('[MidnightSDK] No state found in response');
    }

    console.log('[MidnightSDK] Counter value:', counterValue);
    return {
      success: true,
      counter: counterValue,
      contractAddress,
      error: null,
    };

  } catch (e: any) {
    const errorMsg = e.message || String(e);
    console.error('[MidnightSDK] readCounter() failed:', errorMsg);
    return {
      success: false,
      counter: null,
      contractAddress,
      error: errorMsg,
    };
  }
}

/**
 * Proxy wrapper for compiled contract to satisfy compact-js internal TypeId32 symbol check.
 * The counter-contract vendored package does not include the compiled contract descriptor
 * that midnight-js-contracts expects. This proxy intercepts anonymous symbol property
 * accesses and returns the contract constructor + witnesses, allowing findDeployedContract
 * to instantiate the Contract class.
 */
function createCompiledContractProxy(ContractClass: any, witnesses: any): any {
  return new Proxy(ContractClass, {
    get(target, prop, receiver) {
      // Intercept anonymous symbol accesses (like compact-js TypeId32)
      if (typeof prop === 'symbol' && prop.description === undefined) {
        return { ctor: ContractClass, witnesses };
      }
      return Reflect.get(target, prop, receiver);
    }
  });
}

async function incrementCounter(contractAddress: string = DEFAULT_COUNTER_ADDRESS): Promise<{
  success: boolean;
  txHash: string | null;
  previousCounter: number | null;
  newCounter: number | null;
  contractAddress: string;
  timedOut: boolean;
  error: string | null;
}> {
  console.log('[MidnightSDK] incrementCounter() starting...');
  console.log('[MidnightSDK] Contract address:', contractAddress);

  try {
    // Check connection and authorization
    if (!state.connected || !state.api) {
      throw new Error('Not connected. Call connectPreview() first.');
    }
    if (!_authorized) {
      throw new Error('Not authorized. Call connectPreview() first.');
    }

    // Read current counter value first
    console.log('[MidnightSDK] Reading current counter value...');
    const readResult = await readCounter(contractAddress);
    const previousCounter = readResult.success ? readResult.counter : null;
    console.log('[MidnightSDK] Previous counter:', previousCounter);

    // Ensure packages are loaded
    if (!_midnightPkgsLoaded) {
      console.log('[MidnightSDK] Loading Midnight packages...');
      await loadMidnightPackages();
    }

    // Get Contract class and witnesses from loaded package
    const ContractClass = (window as any).MidnightSDK?.Contract;
    const witnesses = (window as any).MidnightSDK?.witnesses || {};
    if (!ContractClass) {
      throw new Error('Counter contract bindings not loaded. Ensure counter-contract is vendored and bundle rebuilt.');
    }
    console.log('[MidnightSDK] Contract class available:', !!ContractClass);
    console.log('[MidnightSDK] Witnesses available:', Object.keys(witnesses).length);

    // Set up providers (indexer, ZK config, proof server, private state, wallet)
    console.log('[MidnightSDK] Setting up providers...');
    const providers = await setupProviders('unity-counter-state');
    console.log('[MidnightSDK] Providers ready');

    // Create compiled contract proxy for findDeployedContract
    console.log('[MidnightSDK] Creating compiled contract proxy...');
    const compiledContract = createCompiledContractProxy(ContractClass, witnesses);

    // Find the deployed contract
    console.log('[MidnightSDK] Finding deployed contract...');
    const deployed = await _findDeployedContract(providers, {
      compiledContract,
      contractAddress,
      privateStateId: 'counterPrivateState',
      initialPrivateState: { privateCounter: 0 },
    });
    console.log('[MidnightSDK] Deployed contract found');

    // DEBUG: Test ZK config provider directly
    console.log('[MidnightSDK] DEBUG: Testing ZK config provider...');
    try {
      const zkBaseUrl = `${window.location.origin}/zk/counter/`;
      console.log('[MidnightSDK] DEBUG: Creating FetchZkConfigProvider with URL:', zkBaseUrl);
      const testZkConfig = new FetchZkConfigProvider(zkBaseUrl, fetch.bind(window));
      console.log('[MidnightSDK] DEBUG: FetchZkConfigProvider created, checking methods...');
      const providerMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(testZkConfig));
      console.log('[MidnightSDK] DEBUG: Provider methods:', providerMethods);

      // Fetch individual ZK components using the correct method names
      console.log('[MidnightSDK] DEBUG: Fetching prover key...');
      const proverKey = await (testZkConfig as any).getProverKey('increment');
      console.log('[MidnightSDK] DEBUG: Prover key fetched:', !!proverKey, 'size:', proverKey?.length || 0);

      console.log('[MidnightSDK] DEBUG: Fetching verifier key...');
      const verifierKey = await (testZkConfig as any).getVerifierKey('increment');
      console.log('[MidnightSDK] DEBUG: Verifier key fetched:', !!verifierKey, 'size:', verifierKey?.length || 0);

      console.log('[MidnightSDK] DEBUG: Fetching ZKIR (.bzkir - compact format)...');
      const zkirCompact = await (testZkConfig as any).getZKIR('increment');
      console.log('[MidnightSDK] DEBUG: ZKIR (.bzkir) fetched:', !!zkirCompact, 'size:', zkirCompact?.length || 0);

      // The WASM prover needs the full .zkir file (784 bytes), not .bzkir (64 bytes)
      // Let's fetch it manually
      console.log('[MidnightSDK] DEBUG: Fetching full .zkir file manually...');
      const zkirResponse = await fetch(`${zkBaseUrl}zkir/increment.zkir`);
      const zkirFull = new Uint8Array(await zkirResponse.arrayBuffer());
      console.log('[MidnightSDK] DEBUG: Full .zkir fetched:', !!zkirFull, 'size:', zkirFull?.length || 0);

      const allLoaded = proverKey && verifierKey && zkirFull?.length > 100;
      console.log('[MidnightSDK] DEBUG: All ZK components loaded (using full .zkir):', allLoaded);
    } catch (zkTestErr: any) {
      console.error('[MidnightSDK] DEBUG: ZK config fetch failed:', zkTestErr.message);
      console.error('[MidnightSDK] DEBUG: Error stack:', zkTestErr.stack);
    }

    // DEBUG: Install network request interceptor
    console.log('[MidnightSDK] DEBUG: Installing network request interceptor...');
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const [url, init] = args;
      console.log(`[MidnightSDK] DEBUG: Network request -> ${url}`);
      const response = await originalFetch.apply(window, args);
      console.log(`[MidnightSDK] DEBUG: Network response <- ${response.status} ${url}`);
      return response;
    };

    // Call the increment circuit — this builds, balances, proves, and submits the tx
    // The SDK internally calls watchForTxData() which can hang for 30-90s on Preview.
    // We wrap it in a timeout so the UI never freezes forever.
    console.log('[MidnightSDK] Calling increment circuit...');
    const INCREMENT_TIMEOUT_MS = 120000; // 2 minutes
    let result: any;
    let timedOut = false;
    try {
      result = await Promise.race([
        deployed.callTx.increment(),
        new Promise((_resolve, reject) =>
          setTimeout(() => reject(new Error('INCREMENT_TIMEOUT')), INCREMENT_TIMEOUT_MS)
        ),
      ]);
      console.log('[MidnightSDK] Increment result:', result);
    } catch (incrementErr: any) {
      if (incrementErr?.message === 'INCREMENT_TIMEOUT') {
        timedOut = true;
        console.warn('[MidnightSDK] increment circuit timed out after', INCREMENT_TIMEOUT_MS, 'ms');
        console.warn('[MidnightSDK] Tx was submitted; watcher may still resolve later.');
      } else {
        throw incrementErr;
      }
    }

    // Restore original fetch
    window.fetch = originalFetch;

    // Extract tx hash from result or fallback to module variable captured in submitTx
    const txHash =
      result?.public?.txId ||
      result?.public?.transactionHash ||
      result?.public?.hash ||
      _lastSubmittedTxHash ||
      'unknown';

    // If we timed out, poll readCounter manually for a short while instead of
    // relying on the hung watchForTxData promise.
    let newCounter: number | null = null;
    if (timedOut) {
      console.log('[MidnightSDK] Polling counter manually after timeout...');
      for (let i = 0; i < 12; i++) { // poll every 10s for 2 minutes
        await new Promise(r => setTimeout(r, 10000));
        const pollResult = await readCounter(contractAddress);
        if (pollResult.success && pollResult.counter !== previousCounter) {
          newCounter = pollResult.counter;
          console.log('[MidnightSDK] Manual poll detected counter update:', newCounter);
          break;
        }
        console.log(`[MidnightSDK] Manual poll ${i + 1}/12: counter still ${pollResult.success ? pollResult.counter : 'ERR'}`);
      }
    } else {
      // Normal path: wait briefly for indexer to update then read
      await new Promise(resolve => setTimeout(resolve, 3000));
      const newReadResult = await readCounter(contractAddress);
      newCounter = newReadResult.success ? newReadResult.counter : null;
    }

    console.log('[MidnightSDK] incrementCounter() complete');
    console.log('[MidnightSDK] Previous:', previousCounter, '-> New:', newCounter, '| txHash:', txHash);

    return {
      success: true,
      txHash,
      previousCounter,
      newCounter,
      contractAddress,
      timedOut,
      error: null,
    };

  } catch (e: any) {
    const errorMsg = e.message || String(e);
    console.error('[MidnightSDK] incrementCounter() failed:', errorMsg);
    if (e.stack) console.error('[MidnightSDK] Stack:', e.stack);
    // Unwrap nested causes — scoped4 wraps original errors with { cause: err }.
    // The wrapper's own stack points to scoped4; the REAL stack is on the cause.
    let cause: any = e.cause;
    let depth = 0;
    while (cause && depth < 8) {
      console.error(`[MidnightSDK] Cause[${depth}]:`, cause?.constructor?.name, '-', cause?.message ?? String(cause));
      if (cause?.stack) console.error(`[MidnightSDK] Cause[${depth}] stack:`, cause.stack);
      // Also try to dump the offending value if it's a TypeError from Buffer.from
      try {
        if (cause && typeof cause === 'object') {
          const keys = Object.keys(cause);
          if (keys.length) console.error(`[MidnightSDK] Cause[${depth}] keys:`, keys);
        }
      } catch {}
      cause = cause?.cause;
      depth++;
    }
    return {
      success: false,
      txHash: null,
      previousCounter: null,
      newCounter: null,
      contractAddress,
      timedOut: false,
      error: errorMsg,
    };
  }
}

/**
 * Debug: dump all connector info to console.
 * 
 * Prints comprehensive diagnostics:
 * - Environment: origin, isSecureContext, top===self
 * - Midnight connector: window.midnight.mnLace existence and methods
 * - Cardano connector: window.cardano.lace existence (for comparison, NOT used)
 * - Connection state: connected, authorized, API keys
 */
function debugDump(): void {
  console.log('[MidnightSDK] ╔══════════════════════════════════════════════════════════════╗');
  console.log('[MidnightSDK] ║                    DEBUG DUMP                                ║');
  console.log('[MidnightSDK] ╚══════════════════════════════════════════════════════════════╝');
  console.log('[MidnightSDK] Time:', new Date().toISOString());
  
  // Environment
  console.log('[MidnightSDK] ── Environment ──');
  console.log('[MidnightSDK]   origin:', location.origin);
  console.log('[MidnightSDK]   protocol:', location.protocol);
  console.log('[MidnightSDK]   isSecureContext:', (window as any).isSecureContext);
  console.log('[MidnightSDK]   top === self:', window.top === window.self);
  console.log('[MidnightSDK]   userAgent:', navigator.userAgent.substring(0, 80) + '...');
  
  if (window.top !== window.self) {
    console.warn('[MidnightSDK]   ⚠️ Running in iframe - extension injection may be blocked');
  }
  if (location.protocol === 'file:') {
    console.warn('[MidnightSDK]   ⚠️ file:// protocol - extensions cannot inject here');
  }
  
  // Midnight connector (supports mnLace + UUID providers)
  console.log('[MidnightSDK] ── Midnight Connector (mnLace + UUID providers) ──');
  const midnightExists = typeof (window as any).midnight !== 'undefined';
  console.log('[MidnightSDK]   window.midnight exists:', midnightExists);
  
  if (midnightExists) {
    const midnight = (window as any).midnight;
    console.log('[MidnightSDK]   window.midnight keys:', Object.keys(midnight));
    
    const mnLace = midnight.mnLace;
    const mnLaceExists = typeof mnLace !== 'undefined' && mnLace !== null;
    console.log('[MidnightSDK]   window.midnight.mnLace exists:', mnLaceExists);
    
    if (mnLaceExists) {
      console.log('[MidnightSDK]   mnLace.name:', mnLace.name || '(not set)');
      console.log('[MidnightSDK]   mnLace.apiVersion:', mnLace.apiVersion || '(not set)');
      
      // Method detection (the key diagnostics)
      console.log('[MidnightSDK]   "connect" in mnLace:', 'connect' in mnLace);
      console.log('[MidnightSDK]   typeof mnLace.connect:', typeof mnLace.connect);
      console.log('[MidnightSDK]   hasMethodDeep(connect):', hasMethodDeep(mnLace, 'connect'));
      console.log('[MidnightSDK]   "enable" in mnLace:', 'enable' in mnLace);
      console.log('[MidnightSDK]   typeof mnLace.enable:', typeof mnLace.enable);
      console.log('[MidnightSDK]   hasMethodDeep(enable):', hasMethodDeep(mnLace, 'enable'));
      
      // Check where connect is found (prototype vs own)
      const hasOwnConnect = mnLace.hasOwnProperty && mnLace.hasOwnProperty('connect');
      console.log('[MidnightSDK]   connect is own property:', hasOwnConnect);
      if (!hasOwnConnect && 'connect' in mnLace) {
        console.log('[MidnightSDK]   connect is on PROTOTYPE (this is normal for Lace)');
      }
      
      // Check if mnLace === cardano.lace (should be FALSE)
      const isSameAsCardano = (window as any).cardano?.lace === mnLace;
      console.log('[MidnightSDK]   mnLace === cardano.lace:', isSameAsCardano, isSameAsCardano ? '⚠️ BAD - same object!' : '✓ Good - different objects');
    }
  }
  
  // Cardano connector (for comparison - NOT used in Midnight flow)
  console.log('[MidnightSDK] ── Cardano Connector (CIP-30, NOT used in Midnight) ──');
  const cardanoExists = typeof (window as any).cardano !== 'undefined';
  console.log('[MidnightSDK]   window.cardano exists:', cardanoExists, '(NOT used)');
  if (cardanoExists) {
    const cardano = (window as any).cardano;
    console.log('[MidnightSDK]   window.cardano keys:', Object.keys(cardano));
    console.log('[MidnightSDK]   window.cardano.lace exists:', typeof cardano.lace !== 'undefined', '(NOT used)');
  }
  
  // Connection state
  console.log('[MidnightSDK] ── Connection State ──');
  console.log('[MidnightSDK]   connected:', state.connected);
  console.log('[MidnightSDK]   authorized:', _authorized);
  console.log('[MidnightSDK]   connectorPath:', state.connectorPath || '(none)');
  console.log('[MidnightSDK]   connectInProgress:', _connectInProgress !== null);
  
  if (state.api) {
    console.log('[MidnightSDK]   API exists: true');
    try {
      const apiKeys = Object.keys(state.api);
      const apiOwnProps = Object.getOwnPropertyNames(state.api);
      console.log('[MidnightSDK]   API enumerable keys:', apiKeys);
      if (apiOwnProps.length !== apiKeys.length) {
        console.log('[MidnightSDK]   API own properties:', apiOwnProps);
      }
    } catch (e) {
      console.log('[MidnightSDK]   API keys: (could not enumerate)');
    }
  } else {
    console.log('[MidnightSDK]   API exists: false');
  }
  
  if (state.walletState) {
    console.log('[MidnightSDK]   walletState:', JSON.stringify(state.walletState));
  }
  
  if (state.serviceUriConfig) {
    console.log('[MidnightSDK]   serviceUriConfig:', JSON.stringify(state.serviceUriConfig));
  }
  
  // isConnectorAvailable check (fresh, no cache)
  console.log('[MidnightSDK] ── Fresh Availability Check ──');
  const available = isConnectorAvailable();
  console.log('[MidnightSDK]   isConnectorAvailable():', available);
  
  console.log('[MidnightSDK] ╔══════════════════════════════════════════════════════════════╗');
  console.log('[MidnightSDK] ║                  END DEBUG DUMP                              ║');
  console.log('[MidnightSDK] ╚══════════════════════════════════════════════════════════════╝');
}

// ---- Contract Readiness Check ----

/**
 * Check if the SDK is ready for contract interactions.
 * 
 * This checks:
 * 1. Wallet is connected
 * 2. MidnightSDK packages are loaded (WASM)
 * 3. findDeployedContract is available
 * 4. Counter bindings are available (if needed)
 * 
 * @param contractAddress - Optional contract address to look up
 */
async function checkContractReadiness(contractAddress?: string): Promise<{
  ready: boolean;
  walletConnected: boolean;
  packagesLoaded: boolean;
  findDeployedContractAvailable: boolean;
  counterBindingsAvailable: boolean;
  contractFound: boolean | null;
  walletInfo: any;
  errors: string[];
  instructions: string[];
}> {
  console.log('[MidnightSDK] ════════════════════════════════════════════════════════');
  console.log('[MidnightSDK] checkContractReadiness()');
  console.log('[MidnightSDK] ════════════════════════════════════════════════════════');

  const result = {
    ready: false,
    walletConnected: false,
    packagesLoaded: false,
    findDeployedContractAvailable: false,
    counterBindingsAvailable: false,
    contractFound: null as boolean | null,
    walletInfo: null as any,
    errors: [] as string[],
    instructions: [] as string[],
  };

  // Check 1: Wallet connected
  console.log('[MidnightSDK] Step 1: Checking wallet connection...');
  const connectorState = MidnightConnector.getState();
  result.walletConnected = connectorState.connected && connectorState.api !== null;
  
  if (result.walletConnected) {
    console.log('[MidnightSDK]   ✓ Wallet connected');
    result.walletInfo = {
      detected: connectorState.detected,
      connected: connectorState.connected,
    };
    
    // Log wallet API info
    if (connectorState.api) {
      try {
        const apiKeys = Object.keys(connectorState.api);
        console.log('[MidnightSDK]   API keys:', apiKeys);
      } catch (e) {
        console.log('[MidnightSDK]   API keys: (could not enumerate)');
      }
    }
  } else {
    console.log('[MidnightSDK]   ✗ Wallet not connected');
    result.errors.push('Wallet not connected');
    result.instructions.push('Click "Connect (Preview)" button to connect wallet');
  }

  // Check 2: Packages loaded
  console.log('[MidnightSDK] Step 2: Checking @midnight-ntwrk packages...');
  result.packagesLoaded = _midnightPkgsLoaded;
  
  if (result.packagesLoaded) {
    console.log('[MidnightSDK]   ✓ @midnight-ntwrk packages loaded');
  } else {
    console.log('[MidnightSDK]   ✗ @midnight-ntwrk packages not loaded');
    if (_midnightPkgsError) {
      console.log('[MidnightSDK]   Error:', _midnightPkgsError);
      result.errors.push(`Package load error: ${_midnightPkgsError}`);
    }
    result.instructions.push('Wait for MidnightSDK.whenReady() to complete');
  }

  // Check 3: findDeployedContract available
  console.log('[MidnightSDK] Step 3: Checking findDeployedContract...');
  result.findDeployedContractAvailable = _findDeployedContract !== null;
  
  if (result.findDeployedContractAvailable) {
    console.log('[MidnightSDK]   ✓ findDeployedContract available');
  } else {
    console.log('[MidnightSDK]   ✗ findDeployedContract not available');
    result.errors.push('findDeployedContract not loaded');
  }

  // Check 4: Counter bindings
  console.log('[MidnightSDK] Step 4: Checking Counter contract bindings...');
  const counterAvailable = MidnightSDKExports.Counter !== null;
  const witnessesAvailable = MidnightSDKExports.witnesses !== null;
  result.counterBindingsAvailable = counterAvailable && witnessesAvailable;
  
  if (result.counterBindingsAvailable) {
    console.log('[MidnightSDK]   ✓ Counter bindings available');
  } else {
    console.log('[MidnightSDK]   ✗ Counter bindings not available');
    result.errors.push('Counter contract bindings not bundled');
    result.instructions.push('Compile & expose Counter contract JS bindings (see @midnight-ntwrk/counter-contract)');
  }

  // Check 5: Try to find contract (if address provided and findDeployedContract available)
  if (contractAddress && result.findDeployedContractAvailable && result.packagesLoaded) {
    console.log('[MidnightSDK] Step 5: Looking up contract at', contractAddress);
    try {
      // This would require indexer config - just log for now
      console.log('[MidnightSDK]   Contract lookup requires indexer configuration');
      console.log('[MidnightSDK]   Use wallet.getConfiguration() to get indexer URI');
      result.contractFound = null; // Unknown - would need to actually query
    } catch (e: any) {
      console.log('[MidnightSDK]   Contract lookup failed:', e.message);
      result.contractFound = false;
    }
  }

  // Summary
  result.ready = result.walletConnected && result.packagesLoaded;
  
  console.log('[MidnightSDK] ────────────────────────────────────────────────────────');
  console.log('[MidnightSDK] SUMMARY:');
  console.log('[MidnightSDK]   ready:', result.ready);
  console.log('[MidnightSDK]   walletConnected:', result.walletConnected);
  console.log('[MidnightSDK]   packagesLoaded:', result.packagesLoaded);
  console.log('[MidnightSDK]   counterBindingsAvailable:', result.counterBindingsAvailable);
  
  if (result.errors.length > 0) {
    console.log('[MidnightSDK]   errors:', result.errors);
  }
  if (result.instructions.length > 0) {
    console.log('[MidnightSDK]   instructions:', result.instructions);
  }
  console.log('[MidnightSDK] ════════════════════════════════════════════════════════');

  return result;
}

// ---- MeshJS Midnight Setup (optional, for contract deployment) ----

let MidnightSetupAPI: any = null;
let meshSetupLoaded = false;

/**
 * Lazily load @meshsdk/midnight-setup.
 * This is done lazily because the package has heavy deps.
 */
async function loadMeshMidnightSetup(): Promise<any> {
  if (meshSetupLoaded) return MidnightSetupAPI;
  // @meshsdk/midnight-setup dist files are missing in the installed package.
  // This package was only used for mesh-specific helpers; we use the wallet API directly.
  console.log('[MidnightSDK] @meshsdk/midnight-setup skipped (dist missing), using wallet API directly');
  meshSetupLoaded = true;
  return null;
}

/**
 * Set up Midnight providers using the connected wallet.
 * Requires: connect() called first, @meshsdk/midnight-setup loaded.
 * 
 * v4.0.0: Uses getProvingProvider() for ZK proof delegation if available.
 */
async function setupProviders(privateStateStoreName: string = 'unity-midnight-state'): Promise<any> {
  if (!state.connected || !state.api || !state.walletState) {
    throw new Error('Must connect() first');
  }

  // Default network URIs when wallet doesn't expose getConfiguration (common in Lace v4.0.x)
  const network = state.network || 'preview';
  const defaultUris: Record<string, any> = {
    preview: {
      indexerUri: 'https://indexer.preview.midnight.network/api/v4/graphql',
      indexerWsUri: 'wss://indexer.preview.midnight.network/api/v4/graphql',
      proverServerUri: 'https://proof-server.preview.midnight.network',
      zkConfigBaseUrl: 'https://indexer.preview.midnight.network/api/v4/zk',
    },
    preprod: {
      indexerUri: 'https://indexer.preprod.midnight.network/api/v4/graphql',
      indexerWsUri: 'wss://indexer.preprod.midnight.network/api/v4/graphql',
      proverServerUri: 'https://proof-server.preprod.midnight.network',
      zkConfigBaseUrl: 'https://indexer.preprod.midnight.network/api/v4/zk',
    },
  };
  const uris = state.serviceUriConfig || defaultUris[network] || defaultUris.preview;
  if (!state.serviceUriConfig) {
    console.log('[MidnightSDK] Wallet did not provide serviceUriConfig, using defaults for', network);
  }

  // ---- Configure the module-level NetworkId singleton ----
  // @midnight-ntwrk/midnight-js-network-id stores a single string at module scope.
  // ledger-v8, onchain-runtime, contracts, and address-format all call getNetworkId()
  // internally; if it was never set, `findDeployedContract` → `callTx` throws:
  //   "Network ID has not been configured. Call setNetworkId() before any wallet or contract operation."
  //
  // CRITICAL: Lace v4.0.1 expects the literal deployment environment name ('preview', 'preprod')
  // NOT the underlying ledger network_id ('testnet'). Passing 'testnet' causes:
  //   "Expected testnet address, got preview one"
  // The valid values are the deployment names: 'undeployed' | 'devnet' | 'preview' | 'preprod' | 'mainnet'.
  // We pass the wallet's reported network through directly (lowercased for safety).
  const midnightNetworkId = network.toLowerCase();
  try {
    setMidnightNetworkId(midnightNetworkId);
    console.log('[MidnightSDK] NetworkId set to:', midnightNetworkId, '(wallet network:', network + ')');
  } catch (e: any) {
    console.error('[MidnightSDK] setNetworkId failed:', e?.message || e);
    throw e;
  }
  // Sanity: confirm the singleton retained it.
  try {
    const verifyId = getMidnightNetworkId();
    console.log('[MidnightSDK] NetworkId verified via getNetworkId():', verifyId);
  } catch (e: any) {
    console.error('[MidnightSDK] getNetworkId() check failed:', e?.message || e);
  }

  const mesh = await loadMeshMidnightSetup();

  // Provider packages are imported statically at the top of the file

  const ws = state.walletState;
  const api = state.api;

  // DEBUG: enumerate wallet API capabilities
  if (api) {
    const apiMethods = Object.getOwnPropertyNames(api).filter(k => typeof api[k] === 'function');
    console.log('[MidnightSDK] Wallet API methods:', apiMethods);
    if (typeof api.getConfiguration === 'function') {
      try {
        const config = await api.getConfiguration();
        console.log('[MidnightSDK] Wallet API config:', config);
      } catch (e: any) {
        console.warn('[MidnightSDK] api.getConfiguration failed:', e?.message || String(e));
      }
    }
  }

  // v4.0.0: Use shielded keys from new API format
  const coinPublicKey = ws.shieldedCoinPublicKey || ws.coinPublicKey;
  const encryptionPublicKey = ws.shieldedEncryptionPublicKey || ws.encryptionPublicKey;
  const accountId = ws.shieldedAddress || ws.unshieldedAddress || 'default-account';

  // ----- v4.0.0 wallet API serialization helpers -----
  // The Lace dApp connector v4 expects HEX-ENCODED serialized transaction
  // strings for balanceUnsealedTransaction / balanceSealedTransaction /
  // submitTransaction (see @midnight-ntwrk/dapp-connector-api/dist/api.d.ts).
  // Passing wasm-bindgen Transaction objects directly causes the wallet's
  // internal `Buffer.from(tx)` to throw:
  //   "TypeError: The first argument must be one of type string, Buffer,
  //    ArrayBuffer, Array, or Array-like Object. Received type object"
  // so we serialize on our side before every wallet call.
  const txToHex = (tx: any): string => {
    if (typeof tx === 'string') return tx;
    if (tx && typeof tx.serialize === 'function') {
      const bytes: Uint8Array = tx.serialize();
      let hex = '';
      for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
      return hex;
    }
    throw new Error('[MidnightSDK] txToHex: tx is neither a string nor a Transaction with serialize()');
  };

  // Deserialize hex back to a wasm Transaction so we can compute its hash
  // (used for tx-id tracking, since wallet.submitTransaction returns void).
  const hexToTransaction = (hex: string): any => {
    const len = hex.length / 2;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    const txClass = (ledgerV8 as any).Transaction;
    // Try the simplest signature first (static deserialize(bytes))
    if (typeof txClass.deserialize === 'function') {
      try {
        return txClass.deserialize(bytes);
      } catch (e) {
        // Fallback: some ledger-v8 versions use deserialize(sig, prf, bind, bytes)
        console.warn('[MidnightSDK] hexToTransaction: simple deserialize failed, trying with sig/prf/bind args');
        return txClass.deserialize('signature', 'proof', 'binding', bytes);
      }
    }
    throw new Error('[MidnightSDK] Transaction.deserialize not available on ledger-v8');
  };

  // Closure-shared hash captured from wallet during balanceTx, used by submitTx
  // when the locally computed hash is unreliable.
  let _walletReturnedHash: string | null = null;

  // v4.0.0: Use balanceUnsealedTransaction if available
  const balanceTx = typeof api.balanceUnsealedTransaction === 'function'
    ? async (tx: any) => {
        const txHex = txToHex(tx);
        console.log('[MidnightSDK] balanceUnsealedTransaction: passing hex tx, length:', txHex.length);
        const result = await api.balanceUnsealedTransaction(txHex);
        const resultKeys = result && typeof result === 'object' ? Object.keys(result) : 'N/A';
        console.log('[MidnightSDK] balanceUnsealedTransaction raw result type:', typeof result, 'keys:', resultKeys);
        // Log full result structure for debugging (but truncate long hex strings)
        if (result && typeof result === 'object') {
          const resultSummary: any = {};
          for (const key of Object.keys(result)) {
            const val = (result as any)[key];
            if (typeof val === 'string' && val.length > 100) {
              resultSummary[key] = val.substring(0, 50) + '...' + val.substring(val.length - 20) + ` (${val.length} chars)`;
            } else {
              resultSummary[key] = val;
            }
          }
          console.log('[MidnightSDK] balanceUnsealedTransaction result summary (JSON):', JSON.stringify(resultSummary));
        }
        // Search ALL keys for anything that looks like a 64-char hex hash
        if (result && typeof result === 'object') {
          for (const key of Object.keys(result)) {
            const val = (result as any)[key];
            if (typeof val === 'string' && /^[0-9a-fA-F]{64}$/.test(val)) {
              console.log(`[MidnightSDK] balanceUnsealedTransaction: candidate hash in field "${key}":`, val);
              _walletReturnedHash = val;
            }
          }
        }
        // The output of balanceUnsealedTransaction IS already a fully sealed tx
        // (note: hex roughly doubles in size, indicating sig/balance commitments
        // have been added). Despite the misleading name, we do NOT need to call
        // balanceSealedTransaction afterwards — that method is for adding MORE
        // balance to an already-sealed tx, and calling it shuts down the wallet's
        // RemoteApi channel ("Remote API with channel 'midnight-wallet' was shutdown").
        const sealedHex: string = (result && (result.tx || result)) as string;
        console.log('[MidnightSDK] balanceUnsealedTransaction sealed hex length:', sealedHex?.length);
        return sealedHex;
      }
    : (tx: any, newCoins: any) => api.balanceAndProveTransaction(tx, newCoins);

  // ZK config provider: point to TemplateData/zk where ZK keys are served
  // Unity WebGL dev server serves TemplateData from the root
  const zkBaseUrl = `${window.location.origin}/zk/counter/`;
  console.log('[MidnightSDK] ZK config base URL:', zkBaseUrl);

  // Proof server: wallet config first, then local Docker fallback
  const proofServerUri = uris.proverServerUri || uris.proofServerUri || 'http://127.0.0.1:6300';
  console.log('[MidnightSDK] Proof server URI:', proofServerUri);

  // Wrapper to fix all ZK config fetching - FetchZkConfigProvider returns wrong data
  // (wrong sizes for prover/verifier keys, .bzkir instead of .zkir)
  // EXTENDS FetchZkConfigProvider to ensure SDK recognizes it as valid ZKConfigProvider
  class FixedZkConfigProvider extends FetchZkConfigProvider<string> {
    private customBaseUrl: string;
    private customFetchFn: typeof fetch;

    constructor(baseUrl: string, fetchFn: typeof fetch) {
      // Call parent constructor with same params
      super(baseUrl, fetchFn);
      this.customBaseUrl = baseUrl;
      this.customFetchFn = fetchFn;
      console.log('[MidnightSDK] FixedZkConfigProvider: Created with baseUrl:', baseUrl);
    }

    // Helper to fetch binary data from URL
    private async fetchBytes(url: string, description: string): Promise<Uint8Array> {
      console.log(`[MidnightSDK] FixedZkConfigProvider: Fetching ${description} from ${url}`);
      const response = await this.customFetchFn(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch ${description} from ${url}: ${response.status}`);
      }
      const buffer = await response.arrayBuffer();
      const result = new Uint8Array(buffer);
      // Log first 16 bytes as hex for debugging
      const hexPreview = Array.from(result.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' ');
      console.log(`[MidnightSDK] FixedZkConfigProvider: Fetched ${description} size: ${result.length}, first 16 bytes: ${hexPreview}`);
      return result;
    }

    // Fetch prover key directly from keys/ folder
    async getProverKey(circuitName: string): Promise<any> {
      console.log(`[MidnightSDK] FixedZkConfigProvider.getProverKey called: ${circuitName}`);
      const url = `${this.customBaseUrl}keys/${circuitName}.prover`;
      return this.fetchBytes(url, `prover key for ${circuitName}`) as any;
    }

    // Fetch verifier key directly from keys/ folder
    async getVerifierKey(circuitName: string): Promise<any> {
      console.log(`[MidnightSDK] FixedZkConfigProvider.getVerifierKey called: ${circuitName}`);
      const url = `${this.customBaseUrl}keys/${circuitName}.verifier`;
      return this.fetchBytes(url, `verifier key for ${circuitName}`) as any;
    }

    // getVerifierKeys handles both single string and array of circuit IDs
    // Returns array of tuples [circuitId, verifierKey][] for SDK compatibility
    async getVerifierKeys(circuitIds: string | string[]): Promise<any> {
      console.log(`[MidnightSDK] FixedZkConfigProvider.getVerifierKeys called with:`, circuitIds);
      const ids = Array.isArray(circuitIds) ? circuitIds : [circuitIds];
      const result: [string, any][] = [];
      for (const id of ids) {
        const key = await this.getVerifierKey(id);
        result.push([id, key]);
      }
      console.log(`[MidnightSDK] FixedZkConfigProvider.getVerifierKeys returning array with ${result.length} entries`);
      return result as any;
    }

    // Fetch COMPACT .bzkir file for WASM PreTranscript creation
    // The WASM runtime needs the compact binary format, not the full JSON IR
    async getZKIR(circuitName: string): Promise<any> {
      console.log(`[MidnightSDK] FixedZkConfigProvider.getZKIR called: ${circuitName}`);
      // NOTE: Return .bzkir (compact binary) for WASM transaction creation
      // The prover gets the full .zkir via get() method instead
      const url = `${this.customBaseUrl}zkir/${circuitName}.bzkir`;
      console.log(`[MidnightSDK] FixedZkConfigProvider.getZKIR fetching compact .bzkir from: ${url}`);
      return this.fetchBytes(url, `ZKIR compact for ${circuitName}`) as any;
    }

    // Fetch FULL .zkir for prover (used by get() method)
    private async getZKIRFull(circuitName: string): Promise<Uint8Array> {
      console.log(`[MidnightSDK] FixedZkConfigProvider.getZKIRFull called: ${circuitName}`);
      const url = `${this.customBaseUrl}zkir/${circuitName}.zkir`;
      console.log(`[MidnightSDK] FixedZkConfigProvider.getZKIRFull fetching from: ${url}`);
      return this.fetchBytes(url, `ZKIR full for ${circuitName}`);
    }

    // Override get to return full ZK artifacts using our methods
    // This is called by httpClientProofProvider via asKeyMaterialProvider()
    async get(circuitId: string): Promise<any> {
      // IMMEDIATE LOG - should appear before any await
      console.log(`[MidnightSDK] >>>>> FixedZkConfigProvider.get ENTER: circuitId="${circuitId}" type=${typeof circuitId}`);
      try {
        const result = {
          circuitId,
          proverKey: await this.getProverKey(circuitId),
          verifierKey: await this.getVerifierKey(circuitId),
          // The proof server's /check endpoint (createCheckPayload in ledger-v8 WASM)
          // expects the COMPACT binary .bzkir, NOT the full JSON .zkir. Sending
          // .zkir produced 400 Bad Request. The default FetchZkConfigProvider also
          // uses .bzkir (see ZKIR_EXT in @midnight-ntwrk/midnight-js-fetch-zk-config-provider).
          zkir: await this.getZKIR(circuitId)
        };
        console.log(`[MidnightSDK] <<<<< FixedZkConfigProvider.get EXIT: ${circuitId} ->`, {
          proverKeySize: result.proverKey.length,
          verifierKeySize: result.verifierKey.length,
          zkirSize: result.zkir.length
        });
        return result as any;
      } catch (e) {
        console.error(`[MidnightSDK] !!!!! FixedZkConfigProvider.get ERROR for ${circuitId}:`, e);
        throw e;
      }
    }

    // Return this provider as the key material provider
    // This allows the SDK to fetch prover keys and ZKIR via the get() method
    asKeyMaterialProvider(): any {
      console.log('[MidnightSDK] FixedZkConfigProvider.asKeyMaterialProvider called - returning this');
      return this;
    }

  }

  const fixedZkConfig = new FixedZkConfigProvider(zkBaseUrl, fetch.bind(window));

  return {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName,
      // Password requirements (enforced by storage-encryption):
      //   - >= 16 characters
      //   - >= 3 of: uppercase, lowercase, digits, special chars
      // 'Midnight-2026!' (14 chars) failed silently and aborted incrementCounter.
      privateStoragePasswordProvider: async () => 'Midnight-Unity-Bridge-2026!',
      accountId,
    } as any),
    zkConfigProvider: fixedZkConfig,
    proofProvider: (() => {
      // v4 idiomatic path: try wallet-provided proving first.
      // If the wallet handles proving internally, it can also ensure the
      // transaction is correctly formatted for its own submitTransaction.
      let walletProver: any = null;
      if (typeof (api as any).getProvingProvider === 'function') {
        console.log('[MidnightSDK] proofProvider: api.getProvingProvider available, attempting wallet proving...');
        try {
          // v4.0.0 idiomatic: pass keyMaterialProvider to delegate proving to wallet
          // The wallet can then choose local/remote/hardware proving based on user prefs
          const keyMaterialProvider = fixedZkConfig.asKeyMaterialProvider();
          walletProver = (api as any).getProvingProvider(keyMaterialProvider);
          console.log('[MidnightSDK] proofProvider: wallet proving provider obtained:', typeof walletProver);
        } catch (e: any) {
          console.warn('[MidnightSDK] proofProvider: wallet getProvingProvider failed:', e?.message || String(e));
        }
      }

      const remoteProver = httpClientProofProvider(proofServerUri, fixedZkConfig);

      return {
        proveTx: async (tx: any) => {
          console.log('[MidnightSDK] proofProvider.proveTx called, tx type:', tx?.constructor?.name || typeof tx);

          // Try wallet prover first (idiomatic v4)
          if (walletProver && typeof walletProver.proveTx === 'function') {
            console.log('[MidnightSDK] proofProvider: trying wallet proveTx...');
            try {
              const result = await walletProver.proveTx(tx);
              console.log('[MidnightSDK] proofProvider: wallet proveTx succeeded, result type:', result?.constructor?.name || typeof result);
              return result;
            } catch (e: any) {
              console.warn('[MidnightSDK] proofProvider: wallet proveTx failed:', e?.message || String(e));
            }
          }

          // Fall back to remote proof server
          console.log('[MidnightSDK] proofProvider: falling back to remote proof server...');
          try {
            const result = await remoteProver.proveTx(tx);
            console.log('[MidnightSDK] proofProvider.proveTx succeeded (remote), result type:', result?.constructor?.name || typeof result);
            return result;
          } catch (e: any) {
            console.error('[MidnightSDK] proofProvider.proveTx FAILED (remote):', e.message || String(e));
            throw e;
          }
        },
      };
    })(),
    publicDataProvider: indexerPublicDataProvider(
      uris.indexerUri,
      uris.indexerWsUri,
    ),
    walletProvider: {
      getCoinPublicKey: () => coinPublicKey,
      getEncryptionPublicKey: () => encryptionPublicKey,
      balanceTx,
    },
    midnightProvider: {
      // v4.0.0: api.submitTransaction expects a HEX string and returns void.
      // The SDK however expects submitTx to return a tx-id (used by
      // publicDataProvider.watchForTxData), so we compute the tx hash
      // ourselves from the deserialized Transaction.
      submitTx: async (tx: any) => {
        const txHex = txToHex(tx);
        let txId = '';
        let localHashOk = false;
        try {
          const txObj = hexToTransaction(txHex);
          txId = txObj.transactionHash();
          // Only trust the local hash if the simple deserialize path worked
          // (the fallback path uses bogus sig/prf/bind args and produces garbage)
          localHashOk = !!txId && /^[0-9a-fA-F]{64}$/.test(txId);
          console.log('[MidnightSDK] submitTx: computed txHash:', txId, '(trusted:', localHashOk, ')');
        } catch (e) {
          console.warn('[MidnightSDK] submitTx: could not compute tx hash:', e);
        }

        // Prefer the wallet-returned hash captured during balanceTx
        if (_walletReturnedHash) {
          console.log('[MidnightSDK] submitTx: using wallet-captured hash from balanceTx:', _walletReturnedHash);
          txId = _walletReturnedHash;
        }

        // DEBUG: enumerate wallet API methods (use JSON so Chrome doesn't collapse)
        const apiMethods = Object.getOwnPropertyNames(api).filter(k => typeof (api as any)[k] === 'function');
        // Walk prototype chain too — Lace puts methods on prototype
        let proto = Object.getPrototypeOf(api);
        while (proto && proto !== Object.prototype) {
          for (const k of Object.getOwnPropertyNames(proto)) {
            if (k !== 'constructor' && typeof (api as any)[k] === 'function' && !apiMethods.includes(k)) {
              apiMethods.push(k);
            }
          }
          proto = Object.getPrototypeOf(proto);
        }
        console.log('[MidnightSDK] submitTx: wallet API methods (JSON):', JSON.stringify(apiMethods));

        console.log('[MidnightSDK] submitTx: posting hex tx to wallet, length:', txHex.length);

        // Try alternative submission methods if available
        let submitResult: any;
        if (typeof (api as any).submitSealedTransaction === 'function') {
          console.log('[MidnightSDK] submitTx: trying api.submitSealedTransaction...');
          try {
            submitResult = await (api as any).submitSealedTransaction(txHex);
            console.log('[MidnightSDK] submitTx: submitSealedTransaction returned:', submitResult);
          } catch (e: any) {
            console.warn('[MidnightSDK] submitTx: submitSealedTransaction failed:', e?.message || String(e));
          }
        }

        let submitSucceeded = false;
        if (typeof api.submitTransaction === 'function') {
          console.log('[MidnightSDK] submitTx: trying api.submitTransaction (hex string)...');
          try {
            submitResult = await api.submitTransaction(txHex);
            console.log('[MidnightSDK] submitTx: submitTransaction returned:', submitResult);
            // undefined is the expected void return — treat as success
            submitSucceeded = true;
          } catch (e: any) {
            console.error('[MidnightSDK] submitTx: submitTransaction (hex) FAILED:', e?.message || String(e));
          }

          // Only try fallback if the hex string threw, not if it returned undefined
          if (!submitSucceeded) {
            console.log('[MidnightSDK] submitTx: trying api.submitTransaction ({ tx: hex })...');
            try {
              submitResult = await (api as any).submitTransaction({ tx: txHex });
              console.log('[MidnightSDK] submitTx: submitTransaction (object) returned:', submitResult);
              submitSucceeded = true;
            } catch (e: any) {
              console.error('[MidnightSDK] submitTx: submitTransaction (object) FAILED:', e?.message || String(e));
            }
          }

          // If all attempts failed, throw
          if (!submitSucceeded) {
            throw new Error('All wallet submission methods failed');
          }
        }

        // If the wallet returned a tx hash, use it instead of our computed one
        if (submitResult && typeof submitResult === 'string') {
          txId = submitResult;
          console.log('[MidnightSDK] submitTx: using wallet-returned txHash:', txId);
        } else if (submitResult && submitResult.txId) {
          txId = submitResult.txId;
          console.log('[MidnightSDK] submitTx: using wallet-returned txId:', txId);
        }

        // Query getTxHistory() for the canonical wallet-recorded txHash —
        // submitTransaction returns void, so this is the only reliable way
        // to obtain the on-chain hash without depending on our local
        // hexToTransaction round-trip (which uses a fallback deserialize
        // path that produces incorrect hashes).
        if (typeof (api as any).getTxHistory === 'function') {
          try {
            const history: any = await (api as any).getTxHistory();
            const entries = Array.isArray(history) ? history
              : (history && Array.isArray(history.transactions)) ? history.transactions
              : (history && Array.isArray(history.history)) ? history.history
              : [];
            console.log('[MidnightSDK] submitTx: getTxHistory returned', entries.length, 'entries');
            if (entries.length > 0) {
              // The most recent entry is our submission. Log full structure
              // of the first entry so we know which field holds the hash.
              const newest = entries[0];
              const summary: any = {};
              if (newest && typeof newest === 'object') {
                for (const key of Object.keys(newest)) {
                  const val = newest[key];
                  summary[key] = (typeof val === 'string' && val.length > 100)
                    ? `${val.substring(0, 30)}...(${val.length} chars)`
                    : val;
                }
              }
              console.log('[MidnightSDK] submitTx: newest history entry (JSON):', JSON.stringify(summary));
              // Find any 64-char hex hash
              if (newest && typeof newest === 'object') {
                for (const key of Object.keys(newest)) {
                  const val = newest[key];
                  if (typeof val === 'string' && /^[0-9a-fA-F]{64}$/.test(val)) {
                    console.log(`[MidnightSDK] submitTx: history hash candidate field "${key}":`, val);
                    txId = val;
                    _walletReturnedHash = val;
                    break;
                  }
                }
              }
            }
          } catch (e: any) {
            console.warn('[MidnightSDK] submitTx: getTxHistory failed:', e?.message || String(e));
          }
        }

        console.log('[MidnightSDK] submitTx: wallet accepted tx, returning txId:', txId);
        _lastSubmittedTxHash = txId || null;
        return txId;
      },
    },
  };
}

// ---- Exports ----

declare global {
  interface Window {
    MidnightSDK: typeof MidnightSDKExports;
    MidnightSDKReady: boolean;
    MidnightSDKReadyPromise: Promise<void>;
    MidnightSDKError?: string;
  }
}

const MidnightSDKExports = {
  // Primary connection function - supports mnLace AND UUID-keyed providers
  connectMidnightPreview,  // Main connect function
  isConnectorAvailable,    // Returns true if any Lace provider with connect exists
  
  // Aliases for compatibility
  connect: connectMidnightPreview,  // Alias to connectMidnightPreview
  
  // Detection and waiting
  findMidnightConnector,
  getConnectorInfo,
  waitForConnector,
  waitForMnLace,  // Waits for any Lace Midnight provider
  waitForMidnightProvider: MidnightConnector.waitForMidnightProvider,  // New helper
  connectPreprod,  // Legacy connect with two-phase auth
  authorizeIfRequired,  // Helper for enable() flow
  disconnect,
  
  // Provider discovery (from MidnightConnector)
  discoverLaceProvider: MidnightConnector.discoverLaceProvider,
  detectMidnightPreview: MidnightConnector.detectMidnightPreview,
  logMidnightProviders: MidnightConnector.logMidnightProviders,

  // Wallet API wrappers (legacy)
  getWalletState,
  balanceAndProveTransaction,
  submitTransaction,

  // v4.0.0 Wallet API Methods
  getShieldedAddresses,
  getUnshieldedAddress,
  getShieldedBalances,
  getUnshieldedBalances,
  getDustBalance,
  getConnectionStatus,
  getConfiguration,
  balanceUnsealedTransaction,
  balanceSealedTransaction,
  hintUsage: MidnightConnector.hintUsage,

  // Counter contract operations
  readCounter,
  incrementCounter,
  DEFAULT_COUNTER_ADDRESS,

  // Provider setup (MeshJS)
  loadMeshMidnightSetup,
  setupProviders,

  // @midnight-ntwrk package re-exports (loaded lazily to avoid WASM crash)
  // These start as null and get populated after loadMidnightPackages() succeeds.
  indexerPublicDataProvider: null as any,
  findDeployedContract: null as any,
  loadMidnightPackages,

  // Counter contract bindings — loaded lazily if @midnight-ntwrk/counter-contract is available
  Contract: null as any,
  Counter: null as any,
  witnesses: null as any,
  buildCircuitTransaction: null as any,

  // Status
  midnightPkgsLoaded: () => _midnightPkgsLoaded,
  midnightPkgsError: () => _midnightPkgsError,
  isAuthorized: () => _authorized,

  // API Introspection (from MidnightConnector)
  introspectApi: MidnightConnector.introspectApi,
  logApiMethods: MidnightConnector.logApiMethods,

  // Debug
  debugDump,
  
  // Contract readiness check
  checkContractReadiness,

  // State access
  getState: () => ({ ...state }),
  isConnected: () => state.connected,
  getAddress: () => state.walletState?.shieldedAddress || state.walletState?.address || null,
  getCoinPublicKey: () => state.walletState?.shieldedCoinPublicKey || state.walletState?.coinPublicKey || null,
  getShieldedAddress: () => state.walletState?.shieldedAddress || null,

  // Version
  version: '2.2.0',
  apiVersion: '4.0.4',
  buildTag: 'v1.2.0-midnight-counter-end-to-end',
  buildTime: new Date().toISOString(),
};

// Attach to window immediately — connector functions work right away
// Merge with any existing MidnightSDK to avoid clobbering
(window as any).MidnightSDK = { ...((window as any).MidnightSDK || {}), ...MidnightSDKExports };

// REDUNDANT: explicitly assign incrementCounter to avoid any bundler/scope issues
if (typeof incrementCounter === 'function') {
  (window as any).MidnightSDK.incrementCounter = incrementCounter;
}
if (typeof readCounter === 'function') {
  (window as any).MidnightSDK.readCounter = readCounter;
}

// Propagate to parent/top in case Unity runs in an iframe (itch.io, etc.)
try {
  if (typeof parent !== 'undefined' && parent !== window && parent.window) {
    parent.window.MidnightSDK = (window as any).MidnightSDK;
    console.log('[MidnightSDK] Propagated to parent.window.MidnightSDK');
  }
} catch (e) {
  // Cross-origin iframe — ignore
}
try {
  if (typeof top !== 'undefined' && top !== window && top.window) {
    top.window.MidnightSDK = (window as any).MidnightSDK;
    console.log('[MidnightSDK] Propagated to top.window.MidnightSDK');
  }
} catch (e) {
  // Cross-origin iframe — ignore
}

// Verify assignment
console.log('[MidnightSDK] Export verification:');
console.log('[MidnightSDK]   incrementCounter:', typeof (window as any).MidnightSDK.incrementCounter);
console.log('[MidnightSDK]   readCounter:', typeof (window as any).MidnightSDK.readCounter);
console.log('[MidnightSDK]   connectMidnightPreview:', typeof (window as any).MidnightSDK.connectMidnightPreview);

(window as any).MidnightSDKReady = false;        // true once init attempt completes (success or fail)
(window as any).MidnightSDKFullReady = false;    // true only if packages loaded successfully
(window as any).MidnightSDKError = null;         // error message if packages failed

// Initialize — connector functions are available immediately (no WASM needed).
console.log(`[MidnightSDK] Loaded (${BUILD_STAMP}). Use logApiMethods() after connect.`);

// Quick startup check
const connectorAvailable = isConnectorAvailable();
if (connectorAvailable) {
  console.log('[MidnightSDK] Lace wallet detected');
} else {
  console.log('[MidnightSDK] Lace not detected yet (will check on connect)');
}

// Background: try to load heavy @midnight-ntwrk packages (WASM).
// If this fails, connector functions still work — only contract operations are unavailable.
let _whenReadyResolve: () => void = () => {};
const _whenReadyPromise = new Promise<void>((resolve) => { _whenReadyResolve = resolve; });

(window as any).MidnightSDKReadyPromise = (async () => {
  try {
    await loadMidnightPackages();
    (window as any).MidnightSDKFullReady = true;
    console.log('[MidnightSDK] Full SDK ready (including @midnight-ntwrk packages)');
  } catch (e: any) {
    console.warn('[MidnightSDK] @midnight-ntwrk packages failed to load:', e.message);
    console.warn('[MidnightSDK] Connector/wallet functions still work. Contract operations unavailable.');
    (window as any).MidnightSDKError = e.message || String(e);
    (window as any).MidnightSDKFullReady = false;
  }
  (window as any).MidnightSDKReady = true;
  _whenReadyResolve();
})();

// Expose whenReady for external code to await
(window as any).MidnightSDK.whenReady = _whenReadyPromise;
