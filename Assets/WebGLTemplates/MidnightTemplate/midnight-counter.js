/**
 * Midnight Counter - Contract Interaction for Midnight Preview
 * =============================================================
 * 
 * This module handles interaction with the Counter smart contract
 * deployed on Midnight Preview network.
 *
 * Contract Details:
 *   Address: 8c31306d717dd2b79f30785ae7f0f5241f6f891d63441827395d8be1fecd88dd
 *   Contract: Counter
 *   Public state: round
 *   Circuit: increment()
 * 
 * IMPORTANT: This is COMPLETELY SEPARATE from Cardano contracts.
 * Midnight uses Compact language and ZK circuits, not Plutus.
 * 
 * Dependencies:
 *   - midnight-bridge.js (for wallet connection)
 *   - midnight.bundle.js (bundled Midnight SDK)
 */

(function() {
  'use strict';

  const LOG_PREFIX = '[MidnightCounter]';

  // ============================================================
  // Contract Configuration
  // ============================================================

  const DEFAULT_CONTRACT_ADDRESS = '8c31306d717dd2b79f30785ae7f0f5241f6f891d63441827395d8be1fecd88dd';

  // ============================================================
  // State
  // ============================================================

  let contractClient = null;
  let currentContractAddress = null;

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
  // Contract Functions
  // ============================================================

  /**
   * Join (connect to) an existing Counter contract.
   * 
   * @param {string} contractAddress - The deployed contract address
   * @returns {Promise<object>} Join result
   */
  async function joinContract(contractAddress = DEFAULT_CONTRACT_ADDRESS) {
    log('=== JOIN COUNTER CONTRACT ===');
    log('Contract address:', contractAddress);

    // Check if MidnightBridge is connected
    if (!window.MidnightBridge || !window.MidnightBridge.isConnected()) {
      throw new Error('Wallet not connected. Call MidnightBridge.connect() first.');
    }

    const api = window.MidnightBridge.getConnectedApi();
    if (!api) {
      throw new Error('No connected API available');
    }

    const config = window.MidnightBridge.getConfig();
    log('Using wallet configuration:', config);

    // Check for Midnight SDK
    if (!window.MidnightSDK) {
      throw new Error('MidnightSDK not loaded. Include midnight.bundle.js in your page.');
    }

    try {
      // The actual contract joining depends on the Midnight SDK structure
      // This is a placeholder that will be updated based on actual SDK API
      
      log('Initializing contract client...');
      
      // Store contract address
      currentContractAddress = contractAddress;

      // For now, we'll create a simple client wrapper
      // The actual implementation depends on @midnight-ntwrk/midnight-js-contracts
      contractClient = {
        address: contractAddress,
        api: api,
        config: config,
        joined: true
      };

      log('Contract joined successfully');
      
      return {
        success: true,
        contractAddress: contractAddress,
        message: 'Contract joined'
      };

    } catch (e) {
      error('Failed to join contract:', e);
      throw e;
    }
  }

  /**
   * Read the current counter value (round) from the contract.
   * 
   * @returns {Promise<number>} The current counter value
   */
  async function readCounter() {
    log('=== READ COUNTER ===');

    if (!contractClient || !contractClient.joined) {
      throw new Error('Contract not joined. Call joinContract() first.');
    }

    log('Contract address:', currentContractAddress);

    try {
      // The actual state reading depends on the Midnight SDK
      // This will query the public state 'round' from the contract
      
      const config = window.MidnightBridge.getConfig();
      
      if (!config || !config.indexerUri) {
        throw new Error('No indexer URI in wallet configuration');
      }

      log('Querying indexer:', config.indexerUri);

      // Query the contract state via indexer
      // The actual API depends on @midnight-ntwrk/midnight-js-indexer-public-data-provider
      
      // Placeholder: In production, this would use the indexer to fetch state
      // For now, return a mock value to demonstrate the flow
      
      log('Note: Actual state query requires midnight.bundle.js with indexer provider');
      
      // If MidnightSDK has the necessary functions, use them
      if (window.MidnightSDK && typeof window.MidnightSDK.queryContractState === 'function') {
        const state = await window.MidnightSDK.queryContractState(currentContractAddress, 'round');
        log('Counter value:', state);
        return state;
      }

      // Fallback: indicate that full SDK is needed
      throw new Error('Full Midnight SDK required for state queries. Build midnight.bundle.js with indexer support.');

    } catch (e) {
      error('Failed to read counter:', e);
      throw e;
    }
  }

  /**
   * Increment the counter by calling the increment() circuit.
   * 
   * @returns {Promise<object>} Transaction result with tx hash
   */
  async function incrementCounter() {
    log('=== INCREMENT COUNTER ===');

    if (!contractClient || !contractClient.joined) {
      throw new Error('Contract not joined. Call joinContract() first.');
    }

    const api = window.MidnightBridge.getConnectedApi();
    if (!api) {
      throw new Error('No connected API available');
    }

    log('Contract address:', currentContractAddress);

    try {
      // Step 1: Build the increment transaction
      log('[Step 1] Building increment transaction...');
      
      // The actual transaction building depends on the Midnight SDK
      // This uses @midnight-ntwrk/midnight-js-contracts
      
      if (!window.MidnightSDK) {
        throw new Error('MidnightSDK not loaded');
      }

      // Check for required wallet methods
      if (typeof api.balanceAndProveTransaction !== 'function') {
        throw new Error('Wallet API does not support balanceAndProveTransaction()');
      }
      if (typeof api.submitTransaction !== 'function') {
        throw new Error('Wallet API does not support submitTransaction()');
      }

      // Build the transaction (placeholder - actual implementation needs contract artifacts)
      log('[Step 2] Transaction would be built here using Compact contract artifacts');
      
      // The flow would be:
      // 1. Load contract artifacts (circuit definitions)
      // 2. Create transaction calling increment()
      // 3. Balance and prove via wallet
      // 4. Submit via wallet

      // For now, throw informative error
      throw new Error(
        'Full increment implementation requires:\n' +
        '1. Compact contract artifacts (circuit definitions)\n' +
        '2. midnight.bundle.js with @midnight-ntwrk/midnight-js-contracts\n' +
        '3. Proof server access (from wallet configuration)\n\n' +
        'See web/midnight-bundle/ for bundler setup.'
      );

    } catch (e) {
      error('Failed to increment counter:', e);
      throw e;
    }
  }

  /**
   * Check if a contract is currently joined.
   * @returns {boolean}
   */
  function isContractJoined() {
    return contractClient !== null && contractClient.joined === true;
  }

  /**
   * Get the current contract address.
   * @returns {string|null}
   */
  function getContractAddress() {
    return currentContractAddress;
  }

  /**
   * Disconnect from the contract.
   */
  function leaveContract() {
    log('Leaving contract');
    contractClient = null;
    currentContractAddress = null;
  }

  // ============================================================
  // Unity Integration Helpers
  // ============================================================

  /**
   * Join contract and send result to Unity.
   */
  async function joinContractForUnity(gameObjectName, successCallback, errorCallback, contractAddress) {
    try {
      const result = await joinContract(contractAddress || DEFAULT_CONTRACT_ADDRESS);
      const payload = JSON.stringify(result);
      if (typeof SendMessage === 'function') {
        SendMessage(gameObjectName, successCallback, payload);
      }
    } catch (e) {
      const errorMsg = e.message || String(e);
      if (typeof SendMessage === 'function') {
        SendMessage(gameObjectName, errorCallback, errorMsg);
      }
    }
  }

  /**
   * Read counter and send result to Unity.
   */
  async function readCounterForUnity(gameObjectName, successCallback, errorCallback) {
    try {
      const value = await readCounter();
      if (typeof SendMessage === 'function') {
        SendMessage(gameObjectName, successCallback, String(value));
      }
    } catch (e) {
      const errorMsg = e.message || String(e);
      if (typeof SendMessage === 'function') {
        SendMessage(gameObjectName, errorCallback, errorMsg);
      }
    }
  }

  /**
   * Increment counter and send result to Unity.
   */
  async function incrementCounterForUnity(gameObjectName, successCallback, errorCallback) {
    try {
      const result = await incrementCounter();
      const payload = JSON.stringify(result);
      if (typeof SendMessage === 'function') {
        SendMessage(gameObjectName, successCallback, payload);
      }
    } catch (e) {
      const errorMsg = e.message || String(e);
      if (typeof SendMessage === 'function') {
        SendMessage(gameObjectName, errorCallback, errorMsg);
      }
    }
  }

  // ============================================================
  // Export to window
  // ============================================================

  window.MidnightCounter = {
    // Contract management
    joinContract: joinContract,
    leaveContract: leaveContract,
    isContractJoined: isContractJoined,
    getContractAddress: getContractAddress,

    // Contract operations
    readCounter: readCounter,
    incrementCounter: incrementCounter,

    // Unity helpers
    joinContractForUnity: joinContractForUnity,
    readCounterForUnity: readCounterForUnity,
    incrementCounterForUnity: incrementCounterForUnity,

    // Constants
    DEFAULT_CONTRACT_ADDRESS: DEFAULT_CONTRACT_ADDRESS,

    // Version
    version: '1.0.0'
  };

  log('Midnight Counter loaded (v1.0.0)');
  log('Default contract address:', DEFAULT_CONTRACT_ADDRESS);

})();
