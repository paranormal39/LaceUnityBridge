/**
 * CSL Entry Point for Browser Bundle
 * Exports all CSL functions to window.CardanoWasm
 */

import * as CSL from '@emurgo/cardano-serialization-lib-browser';

// Export everything
export * from '@emurgo/cardano-serialization-lib-browser';

// Also attach to window for non-module scripts
if (typeof window !== 'undefined') {
  window.CardanoWasm = CSL;
  window.CSLReady = true;
  console.log('[CSL] Loaded and attached to window.CardanoWasm');
  
  // Dispatch ready event
  window.dispatchEvent(new Event('csl-ready'));
}
