/**
 * Midnight Bridge - Midnight Preprod Network Integration
 * ========================================================
 * 
 * This module provides connection to the Midnight Preprod network
 * via the Lace Midnight Preview wallet (window.midnight.mnLace).
 * 
 * IMPORTANT: This is COMPLETELY SEPARATE from the Cardano integration.
 * Cardano uses: window.cardano.lace + CIP-30 + CSL + Blockfrost
 * Midnight uses: window.midnight.mnLace + DApp Connector + Compact contracts
 * 
 * API Flow:
 *   1. Detect: window.midnight.mnLace
 *   2. Connect: await mnLace.connect('preprod')
 *   3. Query: getShieldedAddresses(), getConnectionStatus(), getConfiguration()
 * 
 * All endpoints (node, indexer, proof server) come from wallet configuration.
 * We do NOT hardcode any service URIs.
 */

(function() {
  'use strict';

  const LOG_PREFIX = '[MidnightBridge]';

  // ============================================================
  // State
  // ============================================================
  let connectedApi = null;
  let walletState = null;
  let configuration = null;
  let connectionStatus = null;
  let shieldedAddresses = [];

  // ============================================================
  // Utility Functions
  // ============================================================

  function log(...args) {
    console.log(LOG_PREFIX, ...args);
  }

  function warn(...args) {
    console.warn(LOG_PREFIX, ...args);
  }

  function error(...args) {
    console.error(LOG_PREFIX, ...args);
  }

  // ============================================================
  // Detection Functions
  // ============================================================

  /**
   * Check if the Midnight connector (mnLace) is available.
   * @returns {boolean}
   */
  function isMidnightConnectorAvailable() {
    try {
      if (typeof window.midnight === 'undefined' || !window.midnight) {
        return false;
      }
      if (typeof window.midnight.mnLace === 'undefined' || !window.midnight.mnLace) {
        return false;
      }
      // Check for connect method (Midnight DApp Connector API)
      if (typeof window.midnight.mnLace.connect !== 'function') {
        // Fallback: check for enable method (older API)
        if (typeof window.midnight.mnLace.enable !== 'function') {
          return false;
        }
      }
      return true;
    } catch (e) {
      warn('Error checking connector availability:', e);
      return false;
    }
  }

  /**
   * Get the mnLace connector object.
   * @returns {object|null}
   */
  function getMnLaceConnector() {
    if (!isMidnightConnectorAvailable()) {
      return null;
    }
    return window.midnight.mnLace;
  }

  // ============================================================
  // Connection Functions
  // ============================================================

  /**
   * Connect to Midnight Preprod network via mnLace.
   * 
   * @param {string} network - Network to connect to ('preprod' or 'mainnet')
   * @returns {Promise<object>} Connection result with wallet info
   */
  async function connect(network = 'preprod') {
    log('=== MIDNIGHT PREPROD CONNECT ===');
    log('Network:', network);
    log('Time:', new Date().toISOString());

    // Step 1: Check connector availability
    log('[Step 1] Checking for window.midnight.mnLace...');
    
    if (!window.midnight) {
      throw new Error('window.midnight not found. Is Lace Midnight Preview wallet installed?');
    }
    log('  window.midnight exists');
    log('  Keys:', Object.keys(window.midnight));

    if (!window.midnight.mnLace) {
      throw new Error('window.midnight.mnLace not found. Make sure Lace Midnight Preview is enabled.');
    }
    log('  window.midnight.mnLace exists');
    
    const mnLace = window.midnight.mnLace;
    log('  mnLace keys:', Object.keys(mnLace));
    log('  mnLace.name:', mnLace.name);
    log('  mnLace.apiVersion:', mnLace.apiVersion);

    // Step 2: Connect to the specified network
    log('[Step 2] Calling mnLace.connect("' + network + '")...');
    
    let api;
    if (typeof mnLace.connect === 'function') {
      // New Midnight DApp Connector API
      api = await mnLace.connect(network);
    } else if (typeof mnLace.enable === 'function') {
      // Fallback to older enable() API
      log('  Using fallback enable() method');
      api = await mnLace.enable();
    } else {
      throw new Error('mnLace has no connect() or enable() method');
    }

    if (!api) {
      throw new Error('connect() returned null - user may have rejected the connection');
    }

    log('  Connection successful!');
    log('  API keys:', Object.keys(api));
    connectedApi = api;

    // Step 3: Get connection status
    log('[Step 3] Getting connection status...');
    connectionStatus = null;
    if (typeof api.getConnectionStatus === 'function') {
      try {
        connectionStatus = await api.getConnectionStatus();
        log('  Connection status:', connectionStatus);
      } catch (e) {
        warn('  getConnectionStatus() error:', e.message);
      }
    } else {
      log('  getConnectionStatus() not available');
      // Infer status from successful connection
      connectionStatus = { connected: true, network: network };
    }

    // Step 4: Get shielded addresses
    log('[Step 4] Getting shielded addresses...');
    shieldedAddresses = [];
    if (typeof api.getShieldedAddresses === 'function') {
      try {
        shieldedAddresses = await api.getShieldedAddresses();
        log('  Shielded addresses:', shieldedAddresses);
      } catch (e) {
        warn('  getShieldedAddresses() error:', e.message);
      }
    } else if (typeof api.state === 'function') {
      // Fallback: try state() method
      log('  Using fallback state() method');
      try {
        walletState = await api.state();
        log('  Wallet state:', walletState);
        if (walletState && walletState.address) {
          shieldedAddresses = [walletState.address];
        }
      } catch (e) {
        warn('  state() error:', e.message);
      }
    } else {
      log('  No address method available');
    }

    // Step 5: Get configuration (endpoints)
    log('[Step 5] Getting configuration...');
    configuration = null;
    if (typeof api.getConfiguration === 'function') {
      try {
        configuration = await api.getConfiguration();
        log('  Configuration:', configuration);
      } catch (e) {
        warn('  getConfiguration() error:', e.message);
      }
    } else if (typeof api.serviceUriConfig === 'function') {
      // Fallback: try serviceUriConfig() method
      log('  Using fallback serviceUriConfig() method');
      try {
        configuration = await api.serviceUriConfig();
        log('  Service URI config:', configuration);
      } catch (e) {
        warn('  serviceUriConfig() error:', e.message);
      }
    } else if (typeof mnLace.serviceUriConfig === 'function') {
      // Try on connector itself
      log('  Using connector.serviceUriConfig()');
      try {
        configuration = await mnLace.serviceUriConfig();
        log('  Service URI config:', configuration);
      } catch (e) {
        warn('  connector.serviceUriConfig() error:', e.message);
      }
    } else {
      log('  No configuration method available');
    }

    // Build result object
    const result = {
      success: true,
      walletName: mnLace.name || 'mnLace',
      apiVersion: mnLace.apiVersion || 'unknown',
      network: network,
      connectionStatus: connectionStatus,
      shieldedAddress: shieldedAddresses.length > 0 ? shieldedAddresses[0] : null,
      shieldedAddresses: shieldedAddresses,
      configuration: configuration
    };

    log('=== CONNECTION COMPLETE ===');
    log('Result:', JSON.stringify(result, null, 2));

    return result;
  }

  /**
   * Disconnect from the wallet.
   */
  function disconnect() {
    log('Disconnecting...');
    connectedApi = null;
    walletState = null;
    configuration = null;
    connectionStatus = null;
    shieldedAddresses = [];
    log('Disconnected');
  }

  /**
   * Check if currently connected.
   * @returns {boolean}
   */
  function isConnected() {
    return connectedApi !== null;
  }

  /**
   * Get the connected API object.
   * @returns {object|null}
   */
  function getConnectedApi() {
    return connectedApi;
  }

  /**
   * Get the current shielded address.
   * @returns {string|null}
   */
  function getShieldedAddress() {
    return shieldedAddresses.length > 0 ? shieldedAddresses[0] : null;
  }

  /**
   * Get all shielded addresses.
   * @returns {string[]}
   */
  function getAllShieldedAddresses() {
    return shieldedAddresses;
  }

  /**
   * Get the wallet configuration (endpoints).
   * @returns {object|null}
   */
  function getConfig() {
    return configuration;
  }

  /**
   * Get the connection status.
   * @returns {object|null}
   */
  function getStatus() {
    return connectionStatus;
  }

  // ============================================================
  // Diagnostic Functions
  // ============================================================

  /**
   * Run full diagnostic and log everything to console.
   * This is for debugging connection issues.
   */
  async function runDiagnostic() {
    log('=== MIDNIGHT PREPROD DIAGNOSTIC ===');
    log('Time:', new Date().toISOString());
    log('URL:', window.location.href);
    log('Protocol:', window.location.protocol);

    // Check window.midnight
    log('');
    log('[1] Checking window.midnight...');
    if (!window.midnight) {
      error('  window.midnight NOT FOUND');
      error('  Possible causes:');
      error('    - Lace Midnight Preview not installed');
      error('    - Extension disabled');
      error('    - Page on file:// URL (must use http:// or https://)');
      log('=== END DIAGNOSTIC ===');
      return { success: false, error: 'window.midnight not found' };
    }
    log('  window.midnight EXISTS');
    log('  Keys:', Object.keys(window.midnight));

    // Check mnLace
    log('');
    log('[2] Checking window.midnight.mnLace...');
    if (!window.midnight.mnLace) {
      error('  window.midnight.mnLace NOT FOUND');
      log('  Available connectors:', Object.keys(window.midnight));
      log('=== END DIAGNOSTIC ===');
      return { success: false, error: 'window.midnight.mnLace not found' };
    }
    
    const mnLace = window.midnight.mnLace;
    log('  window.midnight.mnLace EXISTS');
    log('  Keys:', Object.keys(mnLace));
    log('  name:', mnLace.name);
    log('  apiVersion:', mnLace.apiVersion);

    // Check methods
    log('');
    log('[3] Checking available methods...');
    const methods = ['connect', 'enable', 'isEnabled', 'getConnectionStatus', 
                     'getShieldedAddresses', 'getConfiguration', 'serviceUriConfig',
                     'state', 'balanceAndProveTransaction', 'submitTransaction'];
    for (const method of methods) {
      const available = typeof mnLace[method] === 'function';
      log(`  ${method}(): ${available ? '✓ available' : '✗ not available'}`);
    }

    // Try to connect
    log('');
    log('[4] Attempting connection to preprod...');
    try {
      const result = await connect('preprod');
      log('  Connection successful!');
      log('=== END DIAGNOSTIC ===');
      return { success: true, result: result };
    } catch (e) {
      error('  Connection failed:', e.message);
      log('=== END DIAGNOSTIC ===');
      return { success: false, error: e.message };
    }
  }

  // ============================================================
  // Unity Integration Helpers
  // ============================================================

  /**
   * Connect and send result to Unity via SendMessage.
   * @param {string} gameObjectName - Unity GameObject name
   * @param {string} successCallback - Success callback method name
   * @param {string} errorCallback - Error callback method name
   * @param {string} network - Network to connect to
   */
  async function connectForUnity(gameObjectName, successCallback, errorCallback, network = 'preprod') {
    try {
      const result = await connect(network);
      const payload = JSON.stringify(result);
      log('Sending success to Unity:', gameObjectName, successCallback);
      if (typeof SendMessage === 'function') {
        SendMessage(gameObjectName, successCallback, payload);
      } else if (typeof unityInstance !== 'undefined' && unityInstance.SendMessage) {
        unityInstance.SendMessage(gameObjectName, successCallback, payload);
      } else {
        warn('SendMessage not available - Unity not loaded?');
      }
    } catch (e) {
      const errorMsg = e.message || String(e);
      error('Connection error:', errorMsg);
      if (typeof SendMessage === 'function') {
        SendMessage(gameObjectName, errorCallback, errorMsg);
      } else if (typeof unityInstance !== 'undefined' && unityInstance.SendMessage) {
        unityInstance.SendMessage(gameObjectName, errorCallback, errorMsg);
      }
    }
  }

  /**
   * Run diagnostic and send result to Unity.
   * @param {string} gameObjectName - Unity GameObject name
   * @param {string} callback - Callback method name
   */
  async function diagnosticForUnity(gameObjectName, callback) {
    const result = await runDiagnostic();
    const payload = JSON.stringify(result);
    if (typeof SendMessage === 'function') {
      SendMessage(gameObjectName, callback, payload);
    } else if (typeof unityInstance !== 'undefined' && unityInstance.SendMessage) {
      unityInstance.SendMessage(gameObjectName, callback, payload);
    }
  }

  // ============================================================
  // Page-level detection functions (called from jslib)
  // ============================================================

  // These are called from MidnightWebGL.jslib to check wallet availability
  // from the main thread where extensions inject.

  window.MidnightBridge_IsMidnightPreprodAvailable = function() {
    return isMidnightConnectorAvailable();
  };

  window.MidnightBridge_GetMnLaceInfo = function() {
    if (!isMidnightConnectorAvailable()) {
      return null;
    }
    const mnLace = window.midnight.mnLace;
    return {
      name: mnLace.name || 'mnLace',
      apiVersion: mnLace.apiVersion || 'unknown',
      hasConnect: typeof mnLace.connect === 'function',
      hasEnable: typeof mnLace.enable === 'function'
    };
  };

  // ============================================================
  // Export to window
  // ============================================================

  window.MidnightBridge = {
    // Detection
    isMidnightConnectorAvailable: isMidnightConnectorAvailable,
    getMnLaceConnector: getMnLaceConnector,

    // Connection
    connect: connect,
    disconnect: disconnect,
    isConnected: isConnected,
    getConnectedApi: getConnectedApi,

    // State
    getShieldedAddress: getShieldedAddress,
    getAllShieldedAddresses: getAllShieldedAddresses,
    getConfig: getConfig,
    getStatus: getStatus,

    // Diagnostics
    runDiagnostic: runDiagnostic,

    // Unity helpers
    connectForUnity: connectForUnity,
    diagnosticForUnity: diagnosticForUnity,

    // Version
    version: '1.0.0'
  };

  log('Midnight Bridge loaded (v1.0.0)');
  log('Connector available:', isMidnightConnectorAvailable());

})();
