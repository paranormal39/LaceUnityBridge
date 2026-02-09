/**
 * MeshJS Unity WebGL Bridge
 * 
 * Bundles MeshJS SDK for browser use in Unity WebGL.
 * Exposes window.MeshSDK with all necessary functions.
 * libsodium is loaded externally from CDN before this bundle.
 */

// Import core MeshJS functionality
import {
  BlockfrostProvider,
  MeshTxBuilder,
  deserializeAddress,
  serializeAddressObj,
  resolveScriptHash,
  resolvePlutusScriptAddress,
  resolvePaymentKeyHash,
  resolveStakeKeyHash,
  mConStr0,
  mConStr1,
  mConStr,
  stringToHex,
  hexToString,
} from '@meshsdk/core';

// Declare window extensions
declare global {
  interface Window {
    MeshSDK: typeof MeshSDKExports;
    MeshSDKReady: boolean;
    MeshSDKReadyPromise: Promise<void>;
    MeshSDKError?: string;
    libsodiumReady?: Promise<any>;
    sodium?: any;
  }
}

// Export object that will be attached to window
const MeshSDKExports = {
  // Providers
  BlockfrostProvider,
  
  // Transaction building
  MeshTxBuilder,
  
  // Address utilities
  deserializeAddress,
  serializeAddressObj,
  resolveScriptHash,
  resolvePlutusScriptAddress,
  resolvePaymentKeyHash,
  resolveStakeKeyHash,
  
  // Data construction (for Plutus datums/redeemers)
  mConStr0,
  mConStr1,
  mConStr,
  stringToHex,
  hexToString,
  
  // Version info
  version: '1.0.0',
  buildTime: new Date().toISOString(),
};

// Initialize SDK
async function initializeMeshSDK(): Promise<void> {
  console.log('[MeshSDK] Initializing...');
  
  // Wait for libsodium if it's being loaded
  if (window.libsodiumReady) {
    try {
      await window.libsodiumReady;
      console.log('[MeshSDK] libsodium ready');
    } catch (e) {
      console.warn('[MeshSDK] libsodium init warning:', e);
    }
  }
  
  // Test address parsing
  try {
    const testAddress = 'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj83ws8lhrn648jjxtwq2ytjqp';
    deserializeAddress(testAddress);
    console.log('[MeshSDK] Address parsing test passed');
  } catch (e) {
    console.warn('[MeshSDK] Address parsing test failed:', e);
  }
  
  console.log('[MeshSDK] Initialization complete');
}

// Set up the global immediately
window.MeshSDK = MeshSDKExports;
window.MeshSDKReady = false;

// Create the ready promise
window.MeshSDKReadyPromise = initializeMeshSDK()
  .then(() => {
    window.MeshSDKReady = true;
    console.log('[MeshSDK] Ready! Exports:', Object.keys(MeshSDKExports));
  })
  .catch((error) => {
    window.MeshSDKError = error?.message || String(error);
    console.error('[MeshSDK] Failed to initialize:', window.MeshSDKError);
    window.MeshSDKReady = true;
  });

console.log('[MeshSDK] Script loaded, awaiting initialization...');
