/**
 * Midnight Counter Bindings for Unity WebGL
 * ------------------------------------------------------------
 * This file provides the browser-side bindings for interacting with
 * a deployed Midnight Counter contract via the DApp Connector API.
 *
 * IMPORTANT: This file requires the Midnight JS SDK packages to be loaded
 * in the browser BEFORE this script. You must bundle or include:
 *   - @midnight-ntwrk/compact-runtime
 *   - @midnight-ntwrk/counter-contract (compiled contract bindings)
 *   - @midnight-ntwrk/midnight-js-contracts
 *   - @midnight-ntwrk/midnight-js-indexer-public-data-provider
 *
 * For a minimal browser setup, you can use a bundler (webpack/rollup/esbuild)
 * to create a single JS file that includes these dependencies.
 *
 * This script exposes: window.MidnightCounter
 *   - buildIncrementTransaction(contractAddress, serviceUriConfig) -> UnbalancedTransaction
 *   - getCount(contractAddress, serviceUriConfig) -> bigint
 *
 * Usage from Unity .jslib:
 *   var tx = await window.MidnightCounter.buildIncrementTransaction(contractAddress, serviceCfg);
 *   var count = await window.MidnightCounter.getCount(contractAddress, serviceCfg);
 */

(function (global) {
  "use strict";

  /**
   * Configuration for the counter contract.
   * Update these values based on your compiled contract output.
   */
  var CONFIG = {
    // The private state ID used by the counter contract
    privateStateId: "counterPrivateState",
    // Initial private state when joining a contract
    initialPrivateState: { privateCounter: 0 },
  };

  /**
   * Internal: Creates an indexer public data provider from serviceUriConfig.
   * This mirrors the official example-counter pattern.
   *
   * @param {Object} serviceUriConfig - { indexer, indexerWS, node, proofServer }
   * @returns {Object} publicDataProvider
   */
  function createPublicDataProvider(serviceUriConfig) {
    if (!serviceUriConfig || !serviceUriConfig.indexer) {
      throw new Error(
        "serviceUriConfig.indexer is required. Ensure wallet is connected and serviceUriConfig() was called."
      );
    }

    // Check if the Midnight SDK is available
    if (
      typeof window.MidnightSDK === "undefined" ||
      typeof window.MidnightSDK.indexerPublicDataProvider !== "function"
    ) {
      throw new Error(
        "Midnight SDK not loaded. Ensure @midnight-ntwrk/midnight-js-indexer-public-data-provider is bundled and exposed as window.MidnightSDK.indexerPublicDataProvider"
      );
    }

    return window.MidnightSDK.indexerPublicDataProvider(
      serviceUriConfig.indexer,
      serviceUriConfig.indexerWS || serviceUriConfig.indexer.replace("http", "ws")
    );
  }

  /**
   * Internal: Gets the Counter contract instance.
   * This requires the compiled counter contract bindings to be loaded.
   *
   * @returns {Object} Counter contract class
   */
  function getCounterContract() {
    if (
      typeof window.MidnightSDK === "undefined" ||
      typeof window.MidnightSDK.Counter === "undefined"
    ) {
      throw new Error(
        "Counter contract bindings not loaded. Ensure @midnight-ntwrk/counter-contract is bundled and exposed as window.MidnightSDK.Counter"
      );
    }
    return window.MidnightSDK.Counter;
  }

  /**
   * Internal: Gets the findDeployedContract function.
   *
   * @returns {Function} findDeployedContract
   */
  function getFindDeployedContract() {
    if (
      typeof window.MidnightSDK === "undefined" ||
      typeof window.MidnightSDK.findDeployedContract !== "function"
    ) {
      throw new Error(
        "Midnight SDK not loaded. Ensure @midnight-ntwrk/midnight-js-contracts is bundled and exposed as window.MidnightSDK.findDeployedContract"
      );
    }
    return window.MidnightSDK.findDeployedContract;
  }

  /**
   * Queries the current counter value from the blockchain.
   * This mirrors the getCounterLedgerState function from the official example.
   *
   * @param {string} contractAddress - The deployed contract address
   * @param {Object} serviceUriConfig - { indexer, indexerWS, node, proofServer }
   * @returns {Promise<bigint|null>} The current counter value, or null if not found
   */
  async function getCount(contractAddress, serviceUriConfig) {
    console.log("[MidnightCounter] getCount() called");
    console.log("[MidnightCounter]   contractAddress:", contractAddress);

    if (!contractAddress || contractAddress.trim() === "") {
      throw new Error("contractAddress is required");
    }

    var publicDataProvider = createPublicDataProvider(serviceUriConfig);
    var Counter = getCounterContract();

    try {
      var contractState = await publicDataProvider.queryContractState(contractAddress);

      if (contractState === null || contractState === undefined) {
        console.log("[MidnightCounter] Contract state not found");
        return null;
      }

      // Parse the ledger state using the Counter contract's ledger parser
      var ledgerState = Counter.ledger(contractState.data);
      var count = ledgerState.round;

      console.log("[MidnightCounter] Current count:", count);
      return count;
    } catch (err) {
      console.error("[MidnightCounter] getCount error:", err);
      throw err;
    }
  }

  /**
   * Builds an unbalanced increment transaction for the counter contract.
   * This transaction must then be passed to the wallet's balanceAndProveTransaction()
   * and submitTransaction() methods.
   *
   * This mirrors the increment function from the official example, but returns
   * the unbalanced transaction instead of finalizing it (since the DApp Connector
   * handles balancing/proving/submitting).
   *
   * @param {string} contractAddress - The deployed contract address
   * @param {Object} serviceUriConfig - { indexer, indexerWS, node, proofServer }
   * @returns {Promise<Object>} Unbalanced transaction ready for balanceAndProveTransaction()
   */
  async function buildIncrementTransaction(contractAddress, serviceUriConfig) {
    console.log("[MidnightCounter] buildIncrementTransaction() called");
    console.log("[MidnightCounter]   contractAddress:", contractAddress);

    if (!contractAddress || contractAddress.trim() === "") {
      throw new Error("contractAddress is required");
    }

    var Counter = getCounterContract();
    var findDeployedContract = getFindDeployedContract();

    // Build minimal providers for finding the deployed contract
    var publicDataProvider = createPublicDataProvider(serviceUriConfig);

    // We need a minimal provider set to find and call the contract
    // The actual balancing/proving is done by the wallet via DApp Connector
    if (
      typeof window.MidnightSDK === "undefined" ||
      typeof window.MidnightSDK.witnesses === "undefined"
    ) {
      throw new Error(
        "Counter contract witnesses not loaded. Ensure @midnight-ntwrk/counter-contract witnesses are bundled and exposed as window.MidnightSDK.witnesses"
      );
    }

    var witnesses = window.MidnightSDK.witnesses;
    var counterContractInstance = new Counter.Contract(witnesses);

    try {
      // Find the deployed contract
      // Note: This requires additional providers that may not be available in browser context
      // For a pure DApp Connector flow, we need to build the transaction differently

      // The DApp Connector API expects an UnbalancedTransaction
      // In the official SDK, this is created by calling contract.callTx.increment()
      // which internally builds the transaction

      // For browser DApp Connector usage, we need to:
      // 1. Query the current contract state
      // 2. Build the circuit call for increment()
      // 3. Return the unbalanced transaction

      var contractState = await publicDataProvider.queryContractState(contractAddress);
      if (!contractState) {
        throw new Error("Contract not found at address: " + contractAddress);
      }

      // Build the increment transaction using the contract's circuit
      // This is a simplified version - the full SDK handles this internally
      if (typeof window.MidnightSDK.buildCircuitTransaction !== "function") {
        throw new Error(
          "buildCircuitTransaction not available. Ensure the Midnight SDK transaction builder is bundled and exposed as window.MidnightSDK.buildCircuitTransaction"
        );
      }

      var tx = await window.MidnightSDK.buildCircuitTransaction({
        contractAddress: contractAddress,
        circuitName: "increment",
        circuitArgs: [],
        currentState: contractState,
        contract: counterContractInstance,
      });

      console.log("[MidnightCounter] Built increment transaction");
      return tx;
    } catch (err) {
      console.error("[MidnightCounter] buildIncrementTransaction error:", err);
      throw err;
    }
  }

  /**
   * Alternative: Stub implementation for when full SDK is not available.
   * This provides clear error messages about what's needed.
   */
  var MidnightCounterStub = {
    buildIncrementTransaction: function (contractAddress, serviceUriConfig) {
      return Promise.reject(
        new Error(
          "MidnightCounter.buildIncrementTransaction requires the Midnight JS SDK to be bundled. " +
            "Please bundle @midnight-ntwrk/counter-contract and related packages, then expose them via window.MidnightSDK. " +
            "See: https://github.com/midnightntwrk/example-counter for the official implementation."
        )
      );
    },
    getCount: function (contractAddress, serviceUriConfig) {
      return Promise.reject(
        new Error(
          "MidnightCounter.getCount requires the Midnight JS SDK to be bundled. " +
            "Please bundle @midnight-ntwrk/counter-contract and related packages, then expose them via window.MidnightSDK. " +
            "See: https://github.com/midnightntwrk/example-counter for the official implementation."
        )
      );
    },
  };

  /**
   * Check if SDK is available and expose the appropriate implementation.
   */
  function createMidnightCounter() {
    // Check if the full SDK is available
    var sdkAvailable =
      typeof window.MidnightSDK !== "undefined" &&
      typeof window.MidnightSDK.Counter !== "undefined" &&
      typeof window.MidnightSDK.indexerPublicDataProvider === "function";

    if (sdkAvailable) {
      console.log("[MidnightCounter] Full SDK detected, using real implementation");
      return {
        buildIncrementTransaction: buildIncrementTransaction,
        getCount: getCount,
        _sdkAvailable: true,
      };
    } else {
      console.warn(
        "[MidnightCounter] Midnight SDK not detected. Using stub implementation. " +
          "To enable full functionality, bundle the Midnight JS SDK packages and expose them via window.MidnightSDK"
      );
      return {
        buildIncrementTransaction: MidnightCounterStub.buildIncrementTransaction,
        getCount: MidnightCounterStub.getCount,
        _sdkAvailable: false,
      };
    }
  }

  // Expose to global scope
  global.MidnightCounter = createMidnightCounter();

  // Allow re-initialization if SDK is loaded later
  global.MidnightCounter.reinitialize = function () {
    global.MidnightCounter = createMidnightCounter();
    global.MidnightCounter.reinitialize = arguments.callee;
    console.log("[MidnightCounter] Reinitialized. SDK available:", global.MidnightCounter._sdkAvailable);
  };

  console.log("[MidnightCounter] Bindings loaded. SDK available:", global.MidnightCounter._sdkAvailable);
})(typeof window !== "undefined" ? window : this);
