/**
 * Wallet Injection Diagnostic Script
 * ===================================
 * 
 * DIAGNOSTIC ONLY - Does NOT connect to any wallet (unless midnightConnectDiagnostic called).
 * 
 * Detects and reports:
 * 1. Cardano CIP-30 wallets (window.cardano.*)
 * 2. Midnight DApp Connector wallets (window.midnight.*)
 * 
 * Handles non-enumerable methods and prototype chain detection.
 * 
 * Run this in browser console or include in page to diagnose
 * which wallet connectors are available.
 */

(function() {
  'use strict';

  const DIVIDER = '='.repeat(50);

  function log(...args) {
    console.log(...args);
  }

  function safeKeys(obj) {
    try {
      return Object.keys(obj || {});
    } catch (e) {
      return ['[ERROR: ' + e.message + ']'];
    }
  }

  function safeOwnPropertyNames(obj) {
    try {
      return Object.getOwnPropertyNames(obj || {});
    } catch (e) {
      return ['[ERROR: ' + e.message + ']'];
    }
  }

  function safeGet(obj, prop) {
    try {
      return obj[prop];
    } catch (e) {
      return '[ERROR: ' + e.message + ']';
    }
  }

  /**
   * Check if an object has a method, searching prototype chain.
   * Returns: { found: boolean, where: 'direct'|'in-operator'|'prototype-N'|'not-found' }
   */
  function findMethodDeep(obj, methodName, maxProtoLevels = 3) {
    if (!obj || typeof obj !== 'object') {
      return { found: false, where: 'not-found' };
    }

    // Check 1: Direct typeof
    try {
      if (typeof obj[methodName] === 'function') {
        // Determine if it's own property or inherited
        if (Object.prototype.hasOwnProperty.call(obj, methodName)) {
          return { found: true, where: 'direct' };
        }
        // It's accessible but not own - check prototype
        let proto = Object.getPrototypeOf(obj);
        let level = 1;
        while (proto && level <= maxProtoLevels) {
          if (Object.prototype.hasOwnProperty.call(proto, methodName)) {
            return { found: true, where: 'prototype-' + level };
          }
          proto = Object.getPrototypeOf(proto);
          level++;
        }
        return { found: true, where: 'in-operator' };
      }
    } catch (e) {
      // continue to other checks
    }

    // Check 2: 'in' operator (catches non-enumerable and prototype)
    try {
      if (methodName in obj && typeof obj[methodName] === 'function') {
        return { found: true, where: 'in-operator' };
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
          return { found: true, where: 'prototype-' + level };
        }
        proto = Object.getPrototypeOf(proto);
        level++;
      }
    } catch (e) {
      // continue
    }

    return { found: false, where: 'not-found' };
  }

  function isConnectorLike(obj) {
    if (!obj || typeof obj !== 'object') return false;
    const hasEnable = findMethodDeep(obj, 'enable').found;
    const hasConnect = findMethodDeep(obj, 'connect').found;
    return hasEnable || hasConnect;
  }

  function getMethods(obj) {
    if (!obj || typeof obj !== 'object') return [];
    try {
      return Object.keys(obj).filter(k => typeof obj[k] === 'function');
    } catch (e) {
      return ['[ERROR]'];
    }
  }

  function getProperties(obj) {
    if (!obj || typeof obj !== 'object') return [];
    try {
      return Object.keys(obj).filter(k => typeof obj[k] !== 'function');
    } catch (e) {
      return ['[ERROR]'];
    }
  }

  // ============================================================
  // TASK A: detectMidnightProvider()
  // ============================================================

  /**
   * Check if a provider looks like a Lace Midnight provider.
   * Matches: name === "lace" (case-insensitive) OR rdns contains "lace"
   */
  function isLaceProvider(provider) {
    if (!provider || typeof provider !== 'object') return false;
    
    const name = safeGet(provider, 'name');
    if (typeof name === 'string' && name.toLowerCase() === 'lace') {
      return true;
    }
    
    const rdns = safeGet(provider, 'rdns');
    if (typeof rdns === 'string' && rdns.toLowerCase().includes('lace')) {
      return true;
    }
    
    return false;
  }

  /**
   * Compare two semver strings. Returns positive if a > b, negative if a < b, 0 if equal.
   */
  function compareSemver(a, b) {
    const parseVersion = (v) => {
      const parts = String(v).replace(/^v/, '').split('.').map(p => parseInt(p, 10) || 0);
      while (parts.length < 3) parts.push(0);
      return parts;
    };
    
    const aParts = parseVersion(a);
    const bParts = parseVersion(b);
    
    for (let i = 0; i < 3; i++) {
      if (aParts[i] > bParts[i]) return 1;
      if (aParts[i] < bParts[i]) return -1;
    }
    return 0;
  }

  /**
   * Detect Midnight provider.
   * 
   * Supports BOTH injection patterns:
   * 1. window.midnight.mnLace (preferred if present)
   * 2. window.midnight[uuid] where provider.name === "lace"
   * 
   * NEVER reads from window.cardano (that's CIP-30, not Midnight)
   */
  function detectMidnightProvider() {
    // Check if window.midnight exists
    if (typeof window.midnight === 'undefined' || window.midnight === null) {
      return { ok: false, reason: 'window.midnight missing', providers: [], candidateCount: 0 };
    }

    const midnight = window.midnight;
    const midnightKeys = safeKeys(midnight);
    const candidates = [];

    // === Check mnLace first (preferred path) ===
    const mnLace = midnight.mnLace;
    if (mnLace && typeof mnLace === 'object') {
      const connectCheck = findMethodDeep(mnLace, 'connect');
      const enableCheck = findMethodDeep(mnLace, 'enable');
      
      if (connectCheck.found) {
        const report = {
          key: 'mnLace',
          name: safeGet(mnLace, 'name') || 'lace',
          apiVersion: safeGet(mnLace, 'apiVersion') || '(not set)',
          enumerableKeys: safeKeys(mnLace),
          ownProps: safeOwnPropertyNames(mnLace),
          hasConnect: connectCheck.found,
          whereConnectFound: connectCheck.where,
          hasEnable: enableCheck.found,
          whereEnableFound: enableCheck.where,
          source: 'mnLace'
        };

        log('[detectMidnightProvider] Found window.midnight.mnLace with connect()');
        log(`  name: ${report.name}`);
        log(`  apiVersion: ${report.apiVersion}`);
        log(`  hasConnect: ${report.hasConnect} (${report.whereConnectFound})`);

        // mnLace is preferred - return immediately
        return {
          ok: true,
          key: 'mnLace',
          providerMeta: {
            name: report.name,
            apiVersion: report.apiVersion,
            hasConnect: report.hasConnect,
            whereConnectFound: report.whereConnectFound,
            hasEnable: report.hasEnable,
            whereEnableFound: report.whereEnableFound,
            source: 'mnLace'
          },
          providers: [report],
          candidateCount: 1,
          midnightKeys: midnightKeys
        };
      } else {
        log('[detectMidnightProvider] window.midnight.mnLace exists but has no connect()');
      }
    }

    // === Scan UUID keys for Lace providers ===
    log(`[detectMidnightProvider] Scanning ${midnightKeys.length} keys under window.midnight:`, midnightKeys);

    for (const key of midnightKeys) {
      if (key === 'mnLace') continue;
      
      let provider;
      try {
        provider = midnight[key];
      } catch (e) {
        continue;
      }
      
      if (!provider || typeof provider !== 'object') continue;
      if (!isLaceProvider(provider)) {
        log(`[detectMidnightProvider] Skipping ${key} - not a Lace provider (name: ${safeGet(provider, 'name')})`);
        continue;
      }

      const connectCheck = findMethodDeep(provider, 'connect');
      const enableCheck = findMethodDeep(provider, 'enable');
      
      const report = {
        key: key,
        name: safeGet(provider, 'name') || 'unknown',
        apiVersion: safeGet(provider, 'apiVersion') || '0.0.0',
        rdns: safeGet(provider, 'rdns'),
        enumerableKeys: safeKeys(provider),
        ownProps: safeOwnPropertyNames(provider),
        hasConnect: connectCheck.found,
        whereConnectFound: connectCheck.where,
        hasEnable: enableCheck.found,
        whereEnableFound: enableCheck.where,
        source: 'uuid'
      };
      
      candidates.push(report);
      
      log(`[detectMidnightProvider] Found candidate ${key}:`);
      log(`  name: ${report.name}`);
      log(`  apiVersion: ${report.apiVersion}`);
      log(`  hasConnect: ${report.hasConnect} (${report.whereConnectFound})`);
    }

    if (candidates.length === 0) {
      log('[detectMidnightProvider] No Lace providers found');
      return { 
        ok: false, 
        reason: 'No Lace Midnight provider found. Ensure Midnight mode is enabled in Lace.', 
        providers: [],
        candidateCount: 0,
        midnightKeys: midnightKeys
      };
    }

    // Filter to those with connect
    const withConnect = candidates.filter(c => c.hasConnect);
    
    if (withConnect.length === 0) {
      log('[detectMidnightProvider] Found Lace providers but none have connect()');
      return { 
        ok: false, 
        reason: 'Found Lace providers but none have connect() method.', 
        providers: candidates,
        candidateCount: candidates.length,
        midnightKeys: midnightKeys
      };
    }

    if (withConnect.length > 1) {
      log(`[detectMidnightProvider] Found ${withConnect.length} Lace providers with connect(). Selecting best...`);
    }

    // Sort by apiVersion (descending), then by key (ascending for stability)
    withConnect.sort((a, b) => {
      const versionCmp = compareSemver(b.apiVersion, a.apiVersion);
      if (versionCmp !== 0) return versionCmp;
      return a.key.localeCompare(b.key);
    });

    const selected = withConnect[0];
    log(`[detectMidnightProvider] Selected provider: ${selected.key} (${selected.name} v${selected.apiVersion})`);

    return {
      ok: true,
      key: selected.key,
      providerMeta: {
        name: selected.name,
        apiVersion: selected.apiVersion,
        hasConnect: selected.hasConnect,
        whereConnectFound: selected.whereConnectFound,
        hasEnable: selected.hasEnable,
        whereEnableFound: selected.whereEnableFound,
        source: selected.source
      },
      providers: candidates,
      candidateCount: candidates.length,
      midnightKeys: midnightKeys
    };
  }

  // ============================================================
  // TASK B: waitForMidnightInjection()
  // ============================================================

  /**
   * Poll until Midnight connector is injected and detected.
   * 
   * Default timeout: 20000ms (20 seconds) - extensions can be slow to inject
   * Poll interval: 250ms
   */
  function waitForMidnightInjection(timeoutMs = 20000, intervalMs = 250) {
    return new Promise((resolve) => {
      const startTime = Date.now();
      let lastSnapshot = null;
      let lastLogTime = 0;

      log(`[waitForMidnightInjection] Starting (timeout: ${timeoutMs}ms, interval: ${intervalMs}ms)`);

      function check() {
        const elapsed = Date.now() - startTime;
        const result = detectMidnightProvider();
        lastSnapshot = result;

        // Log progress every 5 seconds
        if (elapsed - lastLogTime >= 5000) {
          log(`[waitForMidnightInjection] Still waiting... ${elapsed}ms elapsed`);
          log(`[waitForMidnightInjection]   window.midnight exists: ${typeof window.midnight !== 'undefined'}`);
          if (typeof window.midnight !== 'undefined') {
            log(`[waitForMidnightInjection]   window.midnight keys: [${safeKeys(window.midnight).join(', ')}]`);
          }
          lastLogTime = elapsed;
        }

        if (result.ok) {
          log(`[waitForMidnightInjection] ✓ Detected after ${elapsed}ms`);
          log(`[waitForMidnightInjection]   Provider: ${result.key}`);
          log(`[waitForMidnightInjection]   hasConnect: ${result.providerMeta.hasConnect} (${result.providerMeta.whereConnectFound})`);
          resolve({ success: true, elapsed: elapsed, detection: result });
          return;
        }

        if (elapsed >= timeoutMs) {
          log(`[waitForMidnightInjection] ✗ Timeout after ${timeoutMs}ms`);
          
          // Build actionable error message
          let errorMessage = 'Lace Midnight Preview not injected into this page.\n\n';
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
          
          log('[waitForMidnightInjection] ' + errorMessage.replace(/\n/g, '\n[waitForMidnightInjection] '));
          
          resolve({
            success: false,
            elapsed: elapsed,
            reason: 'timeout',
            errorMessage: errorMessage,
            midnightExists: typeof window.midnight !== 'undefined',
            keysFound: typeof window.midnight !== 'undefined' ? safeKeys(window.midnight) : [],
            lastDetection: lastSnapshot
          });
          return;
        }

        setTimeout(check, intervalMs);
      }

      check();
    });
  }

  // ============================================================
  // TASK C: midnightConnectDiagnostic()
  // ============================================================

  /**
   * Minimal connect diagnostic - proves wallet connection works.
   * Does NOT implement contract operations.
   * 
   * Supports BOTH injection patterns:
   * 1. window.midnight.mnLace (preferred if present)
   * 2. window.midnight[uuid] where provider.name === "lace"
   */
  async function midnightConnectDiagnostic(network = 'preprod') {
    log('');
    log(DIVIDER);
    log('[MidnightTest] MIDNIGHT CONNECT DIAGNOSTIC');
    log('[MidnightTest] Network:', network);
    log('[MidnightTest] Time:', new Date().toISOString());
    log('[MidnightTest] NOTE: Supports mnLace + UUID-keyed Lace providers - NOT Cardano CIP-30');
    log(DIVIDER);

    // Environment sanity check
    log('[MidnightTest] === Environment Sanity Check ===');
    log('[MidnightTest]   userAgent:', navigator.userAgent);
    log('[MidnightTest]   origin:', location.origin);
    log('[MidnightTest]   isSecureContext:', window.isSecureContext);
    log('[MidnightTest]   top === self:', window.top === window.self);
    log('[MidnightTest]   protocol:', location.protocol);
    
    if (window.top !== window.self) {
      log('[MidnightTest]   ⚠️ Running in iframe - extension injection may be blocked');
    }
    if (location.protocol === 'file:') {
      log('[MidnightTest]   ⚠️ file:// protocol - extensions cannot inject here');
    }
    log('[MidnightTest] === End Environment Check ===');
    log('');

    // === EXPLICIT LOGGING: Log connector existence ===
    log('[MidnightTest] === Connector Existence Check ===');
    log('[MidnightTest]   window.midnight exists:', typeof window.midnight !== 'undefined');
    if (typeof window.midnight !== 'undefined') {
      log('[MidnightTest]   window.midnight keys:', safeKeys(window.midnight));
    }
    log('[MidnightTest]   window.midnight.mnLace exists:', typeof window.midnight?.mnLace !== 'undefined');
    log('[MidnightTest]   window.cardano.lace exists:', typeof window.cardano?.lace !== 'undefined', '(CIP-30, NOT used here)');
    log('[MidnightTest] === End Existence Check ===');
    log('');

    // Step 1: Wait for injection (20 second timeout - extensions can be slow)
    log('[MidnightTest] Step 1: Waiting for Midnight injection (20s timeout)...');
    const waitResult = await waitForMidnightInjection(20000, 250);

    if (!waitResult.success) {
      log('[MidnightTest] Step 1 FAILED - Midnight not detected');
      log('  Reason:', waitResult.reason);
      log('  window.midnight exists:', waitResult.midnightExists);
      log('  Keys found:', waitResult.keysFound);
      if (waitResult.errorMessage) {
        log('');
        log('[MidnightTest] ' + waitResult.errorMessage.replace(/\n/g, '\n[MidnightTest] '));
      }
      log(DIVIDER);
      return { 
        success: false, 
        step: 1, 
        error: waitResult.errorMessage || 'Midnight not detected', 
        details: waitResult 
      };
    }

    const detection = waitResult.detection;
    log('[MidnightTest] Step 1 SUCCESS - Provider detected:', detection.key);
    log('  Name:', detection.providerMeta.name);
    log('  API Version:', detection.providerMeta.apiVersion);
    log('  Source:', detection.providerMeta.source || 'unknown');
    log('  hasConnect:', detection.providerMeta.hasConnect, '(' + detection.providerMeta.whereConnectFound + ')');
    if (detection.candidateCount > 1) {
      log('  ⚠️ Found', detection.candidateCount, 'providers, selected:', detection.key);
    }

    // Step 2: Get provider object using detected key
    log('');
    log('[MidnightTest] Step 2: Getting provider object...');
    
    // Get provider from detected key (supports both mnLace and UUID keys)
    const providerKey = detection.key;
    const provider = window.midnight[providerKey];

    if (!provider) {
      log('[MidnightTest] Step 2 FAILED - window.midnight.' + providerKey + ' is null');
      return { success: false, step: 2, error: 'Provider ' + providerKey + ' is null' };
    }
    
    // CIP-30 GUARD: Throw error if somehow we got CIP-30 connector
    if (window.cardano && window.cardano.lace && provider === window.cardano.lace) {
      const guardErr = 'FATAL: Midnight connect accidentally grabbed CIP-30 connector (window.cardano.lace). This is a bug.';
      log('[MidnightTest] ' + guardErr);
      console.error('[MidnightTest] Stack trace:', new Error().stack);
      return { success: false, step: 2, error: guardErr };
    }
    
    log('[MidnightTest] Step 2 SUCCESS - Using window.midnight.' + providerKey);

    // Step 3: Call connect() - MIDNIGHT ONLY, NO enable() fallback
    log('');
    log('[MidnightTest] Step 3: Calling ' + providerKey + '.connect("' + network + '")...');
    
    // DIAGNOSTIC: Verify we're NOT accidentally using Cardano connector
    log('[MidnightTest] === CONNECTOR IDENTITY CHECK ===');
    log('[MidnightTest]   provider key:', providerKey);
    log('[MidnightTest]   provider === window.cardano?.lace:', provider === window.cardano?.lace);
    log('[MidnightTest]   provider.name:', provider.name);
    log('[MidnightTest]   provider.apiVersion:', provider.apiVersion);
    log('[MidnightTest]   provider.constructor.name:', provider.constructor?.name || '(none)');
    log('[MidnightTest] === END IDENTITY CHECK ===');
    
    // FATAL CHECK: If provider IS the Cardano connector, abort immediately
    if (window.cardano && window.cardano.lace && provider === window.cardano.lace) {
      const fatalErr = 'FATAL: provider is window.cardano.lace! This is a Lace extension bug or misconfiguration.';
      log('[MidnightTest] ' + fatalErr);
      return { success: false, step: 3, error: fatalErr };
    }
    
    let api;
    try {
      // IMPORTANT: Only use connect() for Midnight - never fall back to enable()
      // enable() is for Cardano CIP-30, not Midnight
      if (!detection.providerMeta.hasConnect) {
        throw new Error('Midnight provider does not have connect() method. This is required for Midnight Preprod.');
      }
      
      // Bind connect if on prototype
      let connectFn = provider.connect;
      if (typeof connectFn === 'function') {
        connectFn = connectFn.bind(provider);
      } else {
        throw new Error('connect is not a function');
      }
      
      log('[MidnightTest] Calling window.midnight.' + providerKey + '.connect("' + network + '")...');
      log('[MidnightTest] connect location:', detection.providerMeta.whereConnectFound);
      log('[MidnightTest] NOTE: If you see a CARDANO popup instead of MIDNIGHT, your Lace extension is misconfigured.');
      log('[MidnightTest] FIX: Open Lace settings > Enable "Midnight Preview" mode');
      api = await connectFn(network);

      if (!api) {
        throw new Error('connect() returned null - user may have rejected');
      }

      log('[MidnightTest] SUCCESS - Connected via connect("' + network + '")!');
      log('  API type:', typeof api);
      log('  API keys:', safeKeys(api));
      log('  API ownProps:', safeOwnPropertyNames(api));
    } catch (e) {
      const msg = e.message || String(e);
      log('[MidnightTest] Step 3 FAILED -', msg);
      
      if (msg.toLowerCase().includes('reject') || msg.toLowerCase().includes('denied')) {
        log('  User rejected the connection request');
      }
      
      return { success: false, step: 3, error: msg };
    }

    // Step 4: Query diagnostic methods
    log('');
    log('[MidnightTest] Step 4: Querying diagnostic methods...');

    const result = {
      success: true,
      provider: detection.key,
      providerMeta: detection.providerMeta,
      network: network,
      connectionStatus: null,
      shieldedAddresses: null,
      configuration: null
    };

    // getConnectionStatus
    const statusCheck = findMethodDeep(api, 'getConnectionStatus');
    if (statusCheck.found) {
      try {
        result.connectionStatus = await api.getConnectionStatus();
        log('  getConnectionStatus():', result.connectionStatus);
      } catch (e) {
        log('  getConnectionStatus() error:', e.message);
      }
    } else {
      log('  getConnectionStatus: not available');
    }

    // getShieldedAddresses
    const addrCheck = findMethodDeep(api, 'getShieldedAddresses');
    if (addrCheck.found) {
      try {
        result.shieldedAddresses = await api.getShieldedAddresses();
        log('  getShieldedAddresses():', result.shieldedAddresses);
      } catch (e) {
        log('  getShieldedAddresses() error:', e.message);
      }
    } else {
      // Fallback: try state()
      const stateCheck = findMethodDeep(api, 'state');
      if (stateCheck.found) {
        try {
          const state = await api.state();
          log('  state():', state);
          if (state && state.address) {
            result.shieldedAddresses = [state.address];
          }
        } catch (e) {
          log('  state() error:', e.message);
        }
      } else {
        log('  getShieldedAddresses: not available');
      }
    }

    // getConfiguration
    const cfgCheck = findMethodDeep(api, 'getConfiguration');
    if (cfgCheck.found) {
      try {
        result.configuration = await api.getConfiguration();
        log('  getConfiguration():', result.configuration);
      } catch (e) {
        log('  getConfiguration() error:', e.message);
      }
    } else {
      // Fallback: try serviceUriConfig
      const svcCheck = findMethodDeep(api, 'serviceUriConfig');
      if (svcCheck.found) {
        try {
          result.configuration = await api.serviceUriConfig();
          log('  serviceUriConfig():', result.configuration);
        } catch (e) {
          log('  serviceUriConfig() error:', e.message);
        }
      } else {
        // Try on provider itself
        const provSvcCheck = findMethodDeep(provider, 'serviceUriConfig');
        if (provSvcCheck.found) {
          try {
            result.configuration = await provider.serviceUriConfig();
            log('  provider.serviceUriConfig():', result.configuration);
          } catch (e) {
            log('  provider.serviceUriConfig() error:', e.message);
          }
        } else {
          log('  getConfiguration: not available');
        }
      }
    }

    log('');
    log(DIVIDER);
    log('[MidnightTest] DIAGNOSTIC COMPLETE');
    log(DIVIDER);
    log('[MidnightTest] Result:', JSON.stringify(result, null, 2));

    return result;
  }

  // ============================================================
  // MAIN DIAGNOSTIC
  // ============================================================

  function runDiagnostic() {
    log('');
    log(DIVIDER);
    log('WALLET INJECTION DIAGNOSTIC');
    log('Time:', new Date().toISOString());
    log('URL:', window.location.href);
    log('Protocol:', window.location.protocol);
    log(DIVIDER);

    // ============================================================
    // CARDANO CIP-30 WALLETS
    // ============================================================
    log('');
    log('=== CARDANO CONNECTORS (CIP-30) ===');
    log('');

    const cardanoExists = typeof window.cardano !== 'undefined' && window.cardano !== null;
    log('window.cardano:', cardanoExists ? 'EXISTS' : 'NOT FOUND');

    if (!cardanoExists) {
      log('  No Cardano wallets detected.');
      log('  Possible reasons:');
      log('    - No CIP-30 wallet extension installed');
      log('    - Page loaded before extension injected');
      log('    - Running on file:// URL');
    } else {
      const cardanoKeys = safeKeys(window.cardano);
      log('Detected wallets:', cardanoKeys.length > 0 ? cardanoKeys.join(', ') : '(none)');
      log('');

      for (const walletName of cardanoKeys) {
        const wallet = safeGet(window.cardano, walletName);
        
        if (!wallet || typeof wallet !== 'object') {
          log(`- ${walletName}: [not an object]`);
          continue;
        }

        log(`--- ${walletName} ---`);
        log(`  typeof: ${typeof wallet}`);
        log(`  apiVersion: ${safeGet(wallet, 'apiVersion') || '(not set)'}`);
        log(`  name: ${safeGet(wallet, 'name') || '(not set)'}`);
        log(`  icon: ${safeGet(wallet, 'icon') ? '[present]' : '(not set)'}`);
        
        const extensions = safeGet(wallet, 'supportedExtensions');
        if (extensions) {
          log(`  supportedExtensions: ${JSON.stringify(extensions)}`);
        } else {
          log(`  supportedExtensions: (not set)`);
        }

        const methods = getMethods(wallet);
        log(`  methods: [${methods.join(', ')}]`);
        
        const props = getProperties(wallet);
        log(`  properties: [${props.join(', ')}]`);

        // Key method checks
        log(`  hasEnable: ${typeof wallet.enable === 'function'}`);
        log(`  hasIsEnabled: ${typeof wallet.isEnabled === 'function'}`);
        log('');
      }
    }

    // ============================================================
    // MIDNIGHT CONNECTORS
    // ============================================================
    log('');
    log('=== MIDNIGHT CONNECTORS ===');
    log('');

    const midnightExists = typeof window.midnight !== 'undefined' && window.midnight !== null;
    log('window.midnight:', midnightExists ? 'EXISTS' : 'NOT FOUND');

    if (!midnightExists) {
      log('  No Midnight connectors detected.');
      log('  Possible reasons:');
      log('    - Lace Midnight Preview not installed');
      log('    - Midnight mode not enabled in Lace');
      log('    - Page loaded before extension injected');
      log('    - Running on file:// URL');
    } else {
      const midnightKeys = safeKeys(window.midnight);
      log('Detected providers:', midnightKeys.length > 0 ? midnightKeys.join(', ') : '(none)');
      log('');

      // Check if window.midnight itself is a connector
      if (isConnectorLike(window.midnight)) {
        log('--- window.midnight (root) ---');
        log('  ⚡ window.midnight itself appears to be a connector');
        log(`  name: ${safeGet(window.midnight, 'name') || '(not set)'}`);
        log(`  apiVersion: ${safeGet(window.midnight, 'apiVersion') || '(not set)'}`);
        const rootMethods = getMethods(window.midnight);
        log(`  methods: [${rootMethods.join(', ')}]`);
        log(`  hasConnect: ${typeof window.midnight.connect === 'function'}`);
        log(`  hasEnable: ${typeof window.midnight.enable === 'function'}`);
        log('');
      }

      // Check each key under window.midnight
      for (const providerName of midnightKeys) {
        const provider = safeGet(window.midnight, providerName);
        
        if (!provider || typeof provider !== 'object') {
          log(`- ${providerName}: ${typeof provider}`);
          continue;
        }

        log(`--- ${providerName} ---`);
        log(`  typeof: ${typeof provider}`);
        log(`  name: ${safeGet(provider, 'name') || '(not set)'}`);
        log(`  apiVersion: ${safeGet(provider, 'apiVersion') || '(not set)'}`);
        log(`  icon: ${safeGet(provider, 'icon') ? '[present]' : '(not set)'}`);

        const methods = getMethods(provider);
        log(`  methods: [${methods.join(', ')}]`);

        const props = getProperties(provider);
        log(`  properties: [${props.join(', ')}]`);

        // Key method checks for Midnight (with deep prototype check)
        const connectCheck = findMethodDeep(provider, 'connect');
        const enableCheck = findMethodDeep(provider, 'enable');
        const isEnabledCheck = findMethodDeep(provider, 'isEnabled');
        const stateCheck = findMethodDeep(provider, 'state');
        const svcCheck = findMethodDeep(provider, 'serviceUriConfig');
        
        log(`  hasConnect: ${connectCheck.found} (${connectCheck.where})`);
        log(`  hasEnable: ${enableCheck.found} (${enableCheck.where})`);
        log(`  hasIsEnabled: ${isEnabledCheck.found}`);
        log(`  hasState: ${stateCheck.found}`);
        log(`  hasServiceUriConfig: ${svcCheck.found}`);

        // Check for nested connectors
        const nestedKeys = safeKeys(provider);
        for (const nestedKey of nestedKeys) {
          const nested = safeGet(provider, nestedKey);
          if (nested && typeof nested === 'object' && isConnectorLike(nested)) {
            log(`  ⚡ NESTED CONNECTOR: ${providerName}.${nestedKey}`);
            log(`    hasConnect: ${typeof nested.connect === 'function'}`);
            log(`    hasEnable: ${typeof nested.enable === 'function'}`);
          }
        }

        log('');
      }
    }

    // ============================================================
    // SUMMARY & RECOMMENDATION
    // ============================================================
    log('');
    log('=== SUMMARY ===');
    log('');

    // Cardano summary
    if (cardanoExists) {
      const cardanoWallets = safeKeys(window.cardano).filter(k => {
        const w = window.cardano[k];
        return w && typeof w === 'object' && typeof w.enable === 'function';
      });
      log(`Cardano CIP-30 wallets found: ${cardanoWallets.length}`);
      if (cardanoWallets.length > 0) {
        log(`  Wallets: ${cardanoWallets.join(', ')}`);
        log(`  Connection method: window.cardano.<wallet>.enable()`);
      }
    } else {
      log('Cardano CIP-30 wallets found: 0');
    }

    log('');

    // Midnight summary - use deep detection
    const midnightDetection = detectMidnightProvider();
    
    if (midnightDetection.ok) {
      const connectLocation = midnightDetection.providerMeta.whereConnectFound;
      const source = midnightDetection.providerMeta.source || 'unknown';
      
      log(`Midnight connectors found: ${midnightDetection.candidateCount || 1} (connect on ${connectLocation})`);
      log(`  Selected provider: ${midnightDetection.key}`);
      log(`  Source: ${source}`);
      log(`  Name: ${midnightDetection.providerMeta.name}`);
      log(`  API Version: ${midnightDetection.providerMeta.apiVersion}`);
      log(`  hasConnect: ${midnightDetection.providerMeta.hasConnect} (${connectLocation})`);
      log(`  hasEnable: ${midnightDetection.providerMeta.hasEnable} (${midnightDetection.providerMeta.whereEnableFound})`);
      
      if (midnightDetection.candidateCount > 1) {
        log(`  ⚠️ Multiple providers found (${midnightDetection.candidateCount}), using: ${midnightDetection.key}`);
      }
      
      log('');
      log('  ⭐ RECOMMENDED for Midnight Preprod:');
      if (midnightDetection.providerMeta.hasConnect) {
        log(`     await window.midnight.${midnightDetection.key}.connect('preprod')`);
        if (connectLocation.includes('prototype')) {
          log(`     // Note: connect() is on prototype - binding handled automatically`);
        }
      } else if (midnightDetection.providerMeta.hasEnable) {
        log(`     await window.midnight.${midnightDetection.key}.enable()`);
      }
      
      log('');
      log('  To run full connect diagnostic:');
      log("     await midnightConnectDiagnostic('preprod')");
    } else if (midnightExists) {
      log(`Midnight connectors found: 0 (with connect/enable)`);
      log(`  Reason: ${midnightDetection.reason}`);
      log(`  Providers scanned: ${midnightDetection.candidateCount || 0}`);
      if (midnightDetection.midnightKeys) {
        log(`  window.midnight keys: [${midnightDetection.midnightKeys.join(', ')}]`);
      }
    } else {
      log('Midnight connectors found: 0');
      log('  window.midnight does not exist');
    }

    log('');
    log(DIVIDER);
    log('END DIAGNOSTIC');
    log(DIVIDER);
    log('');

    // Return structured result for programmatic use
    return {
      cardano: {
        exists: cardanoExists,
        wallets: cardanoExists ? safeKeys(window.cardano) : []
      },
      midnight: {
        exists: midnightExists,
        detection: midnightDetection,
        connectorAvailable: midnightDetection.ok,
        bestProvider: midnightDetection.ok ? midnightDetection.key : null,
        providerMeta: midnightDetection.ok ? midnightDetection.providerMeta : null
      }
    };
  }

  // ============================================================
  // AUTO-RUN & EXPORT
  // ============================================================

  // Run immediately
  const result = runDiagnostic();

  // Export for manual re-run and programmatic access
  window.WalletDiagnostic = {
    run: runDiagnostic,
    lastResult: result,
    // Task A
    detectMidnightProvider: detectMidnightProvider,
    // Task B
    waitForMidnightInjection: waitForMidnightInjection,
    // Task C
    midnightConnectDiagnostic: midnightConnectDiagnostic,
    // Utilities
    findMethodDeep: findMethodDeep,
    isConnectorLike: isConnectorLike
  };

  // Also expose midnightConnectDiagnostic at top level for easy console access
  window.midnightConnectDiagnostic = midnightConnectDiagnostic;
  window.detectMidnightProvider = detectMidnightProvider;
  window.waitForMidnightInjection = waitForMidnightInjection;

  log('[WalletDiagnostic] Script loaded.');
  log('[WalletDiagnostic] Run detection: WalletDiagnostic.run()');
  log('[WalletDiagnostic] Run connect test: await midnightConnectDiagnostic("preprod")');

})();
