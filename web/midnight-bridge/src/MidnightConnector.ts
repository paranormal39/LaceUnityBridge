/**
 * MidnightConnector.ts
 * 
 * Single source of truth for Midnight wallet connection via Lace.
 * 
 * Updated for @midnight-ntwrk/dapp-connector-api v4.0.4
 * 
 * Supports BOTH injection patterns:
 * 1. Lace injection: window.midnight.mnLace
 * 2. Lace injection with UUID keys: window.midnight[uuid] where provider.name === "lace"
 * 
 * NEVER uses window.cardano (CIP-30 is completely separate from Midnight)
 * 
 * v4.0.0 API Changes:
 * - connect(networkId) replaces enable()/isEnabled()
 * - InitialAPI type for pre-connection provider
 * - WalletConnectedAPI type for post-connection API
 * - Granular methods: getShieldedAddresses(), getShieldedBalances(), etc.
 * - balanceUnsealedTransaction() / balanceSealedTransaction() replace balanceAndProveTransaction()
 * - getProvingProvider() for ZK proof delegation
 * - getConnectionStatus() for connection checks
 * - New error codes: PermissionRejected, Disconnected
 * 
 * Features:
 * - detectMidnightProvider(): Check for any Lace Midnight provider
 * - discoverLaceProvider(): Robust provider discovery with UUID scanning
 * - connectMidnight(): Connect with single-flight guard and rejection cooldown
 * - waitForMidnightProvider(): Retry/wait helper for late injection
 * - Normalized error types for easy diagnosis
 * - Detailed logging for debugging
 */

// ============================================================
// Types (v4.0.0 compatible)
// ============================================================

export type MidnightNetwork = 'mainnet' | 'preview' | 'preprod' | 'devnet';

export type ConnectionErrorType = 
  | 'userRejected'        // User clicked reject or closed popup (PermissionRejected)
  | 'notInstalled'        // window.midnight missing entirely
  | 'notEnabled'          // No provider with connect found
  | 'multipleProviders'   // Found >1 provider, selected one (warning)
  | 'popupBlocked'        // Browser blocked the popup
  | 'disconnected'        // Connection was disconnected (v4.0.0 Disconnected error)
  | 'cooldown'            // Recently rejected, waiting before retry
  | 'alreadyConnecting'   // Connection already in progress
  | 'connectFailed'       // connect() threw an error
  | 'apiError'            // DAppConnectorAPIError
  | 'unknown';            // Other errors

export interface ConnectorInfo {
  exists: boolean;
  name: string;
  apiVersion: string;
  hasConnect: boolean;
  rdns?: string;
  icon?: string;
  connectLocation: 'own' | 'prototype' | 'none';
}

/**
 * Detailed detection result with diagnostic info
 */
export interface DetectionResult {
  // Overall status
  detected: boolean;
  
  // window.midnight status
  midnightExists: boolean;
  midnightKeys: string[];
  
  // mnLace status (legacy path)
  mnLaceExists: boolean;
  mnLaceHasConnect: boolean;
  
  // UUID provider scanning
  candidateProviders: CandidateProvider[];
  candidateCount: number;
  
  // Selected provider
  selectedProvider: DiscoveredProvider | null;
  selectedKey: string | null;
  selectedApiVersion: string | null;
  connectOnPrototype: boolean;
  
  // CIP-30 detection (for logging only - NOT used)
  cardanoLaceExists: boolean;
}

/**
 * Candidate provider found during UUID scanning
 */
export interface CandidateProvider {
  key: string;
  name: string;
  apiVersion: string;
  hasConnect: boolean;
  connectOnPrototype: boolean;
  rdns?: string;
}

/**
 * Normalized connector object returned by discovery
 */
export interface DiscoveredProvider {
  provider: any;
  connectFn: (network: string) => Promise<any>;
  meta: {
    key: string;
    name: string;
    apiVersion: string;
    connectLocation: 'own' | 'prototype';
    source: 'mnLace' | 'uuid';
  };
}

export interface ConnectionResult {
  success: boolean;
  api: any | null;
  error: ConnectionErrorType | null;
  errorMessage: string | null;
  walletInfo: {
    name: string;
    apiVersion: string;
    network: MidnightNetwork;
  } | null;
}

export interface ConnectorState {
  detected: boolean;
  connected: boolean;
  connecting: boolean;
  api: any | null;
  lastError: ConnectionErrorType | null;
  lastErrorMessage: string | null;
  lastErrorTime: number | null;
  lastConnectAttempt: number | null;
  rejectionCooldownUntil: number | null;
  // Track which provider we're using
  selectedProviderKey: string | null;
  selectedProviderSource: 'mnLace' | 'uuid' | null;
}

// ============================================================
// State
// ============================================================

const state: ConnectorState = {
  detected: false,
  connected: false,
  connecting: false,
  api: null,
  lastError: null,
  lastErrorMessage: null,
  lastErrorTime: null,
  lastConnectAttempt: null,
  rejectionCooldownUntil: null,
  selectedProviderKey: null,
  selectedProviderSource: null,
};

// Cooldown period after rejection (30 seconds)
const REJECTION_COOLDOWN_MS = 30000;

// Cache the discovered provider (cleared on disconnect)
let _cachedProvider: DiscoveredProvider | null = null;

// ============================================================
// Logging
// ============================================================

const LOG_PREFIX = '[MidnightConnector]';

function log(...args: any[]) {
  console.log(LOG_PREFIX, ...args);
}

function warn(...args: any[]) {
  console.warn(LOG_PREFIX, ...args);
}

function error(...args: any[]) {
  console.error(LOG_PREFIX, ...args);
}

// ============================================================
// Semver Comparison Helper
// ============================================================

/**
 * Compare two semver strings. Returns:
 * - positive if a > b
 * - negative if a < b
 * - 0 if equal
 */
function compareSemver(a: string, b: string): number {
  const parseVersion = (v: string): number[] => {
    const parts = v.replace(/^v/, '').split('.').map(p => parseInt(p, 10) || 0);
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

// ============================================================
// Provider Discovery
// ============================================================

/**
 * Check if a provider object has a connect method (own or prototype).
 * Returns { hasConnect, onPrototype, debugInfo }
 */
function checkConnectMethod(provider: any, debugKey?: string): { hasConnect: boolean; onPrototype: boolean; debugInfo?: string } {
  if (!provider || typeof provider !== 'object') {
    return { hasConnect: false, onPrototype: false, debugInfo: 'not an object' };
  }

  const prefix = debugKey ? `[${debugKey}] ` : '';

  // Check direct property
  if (typeof provider.connect === 'function') {
    const isOwn = Object.prototype.hasOwnProperty.call(provider, 'connect');
    log(`${prefix}connect() found: ${isOwn ? 'own property' : 'inherited'}`);
    return { hasConnect: true, onPrototype: !isOwn, debugInfo: isOwn ? 'own' : 'inherited' };
  }

  // Check 'in' operator (catches prototype chain)
  if ('connect' in provider) {
    try {
      if (typeof provider.connect === 'function') {
        log(`${prefix}connect() found via 'in' operator (prototype)`);
        return { hasConnect: true, onPrototype: true, debugInfo: 'in-operator' };
      }
    } catch (e) {
      log(`${prefix}connect 'in' check threw: ${e}`);
    }
  }

  // Walk prototype chain explicitly
  try {
    let proto = Object.getPrototypeOf(provider);
    let level = 0;
    const protoChain: string[] = [];
    while (proto && proto !== Object.prototype && level < 5) {
      const protoProps = Object.getOwnPropertyNames(proto);
      protoChain.push(`L${level}: [${protoProps.join(', ')}]`);
      if (typeof proto.connect === 'function') {
        log(`${prefix}connect() found on prototype level ${level}`);
        return { hasConnect: true, onPrototype: true, debugInfo: `proto-L${level}` };
      }
      proto = Object.getPrototypeOf(proto);
      level++;
    }
    if (protoChain.length > 0) {
      log(`${prefix}prototype chain: ${protoChain.join(' -> ')}`);
    }
  } catch (e) {
    log(`${prefix}prototype walk error: ${e}`);
  }

  return { hasConnect: false, onPrototype: false, debugInfo: 'not found' };
}

/**
 * Check if a provider looks like a v4-compliant Midnight wallet provider.
 *
 * Known providers:
 *   - Lace:  name === "lace",  rdns contains "lace"
 *   - 1AM:   name === "1AM",   rdns === "com.midnight.1am"
 *
 * Generic fallback: any object with apiVersion starting with "4." and a
 * `connect` function (own or prototype) is treated as a valid v4 Midnight
 * wallet. This makes the bridge work with future wallets that follow the
 * DApp Connector v4 standard without code changes.
 */
function isLaceProvider(provider: any): boolean {
  if (!provider || typeof provider !== 'object') return false;

  // Known-name matches (case-insensitive)
  const name = typeof provider.name === 'string' ? provider.name.toLowerCase() : '';
  if (name === 'lace' || name === '1am') {
    return true;
  }

  // Known-rdns matches
  const rdns = typeof provider.rdns === 'string' ? provider.rdns.toLowerCase() : '';
  if (rdns.includes('lace') || rdns.includes('1am') || rdns.includes('midnight')) {
    return true;
  }

  // Generic v4 detection: any provider exposing v4.x apiVersion + connect
  const apiVersion = typeof provider.apiVersion === 'string' ? provider.apiVersion : '';
  const hasConnect = typeof provider.connect === 'function'
    || (provider && typeof Object.getPrototypeOf(provider)?.connect === 'function');
  if (apiVersion.startsWith('4.') && hasConnect) {
    return true;
  }

  return false;
}

/**
 * Log detailed info about all providers under window.midnight.
 * Useful for debugging when connect() is not found.
 */
export function logMidnightProviders(): void {
  const midnight = (window as any).midnight;
  
  console.log('[MidnightConnector] ══════════════════════════════════════');
  console.log('[MidnightConnector] PROVIDER DISCOVERY DEBUG');
  console.log('[MidnightConnector] ══════════════════════════════════════');
  
  if (!midnight) {
    console.log('[MidnightConnector] window.midnight: NOT PRESENT');
    return;
  }
  
  console.log('[MidnightConnector] window.midnight: EXISTS');
  const keys = Object.keys(midnight);
  console.log('[MidnightConnector] Keys:', keys);
  
  for (const key of keys) {
    let provider: any;
    try {
      provider = midnight[key];
    } catch (e) {
      console.log(`[MidnightConnector] ${key}: ERROR accessing - ${e}`);
      continue;
    }
    
    if (!provider || typeof provider !== 'object') {
      console.log(`[MidnightConnector] ${key}: ${typeof provider}`);
      continue;
    }
    
    // Get all properties including non-enumerable
    const ownProps = Object.getOwnPropertyNames(provider);
    const ownKeys = Object.keys(provider);
    
    // Check prototype
    let protoProps: string[] = [];
    try {
      const proto = Object.getPrototypeOf(provider);
      if (proto && proto !== Object.prototype) {
        protoProps = Object.getOwnPropertyNames(proto).filter(p => p !== 'constructor');
      }
    } catch (e) {}
    
    // Check for methods
    const hasConnect = typeof provider.connect === 'function';
    const hasEnable = typeof provider.enable === 'function';
    const connectInProto = 'connect' in provider && !ownProps.includes('connect');
    
    console.log(`[MidnightConnector] ── ${key} ──`);
    console.log(`[MidnightConnector]   name: ${provider.name || '(none)'}`);
    console.log(`[MidnightConnector]   apiVersion: ${provider.apiVersion || '(none)'}`);
    console.log(`[MidnightConnector]   rdns: ${provider.rdns || '(none)'}`);
    console.log(`[MidnightConnector]   enumerable keys: [${ownKeys.join(', ')}]`);
    if (ownProps.length !== ownKeys.length) {
      console.log(`[MidnightConnector]   all own props: [${ownProps.join(', ')}]`);
    }
    if (protoProps.length > 0) {
      console.log(`[MidnightConnector]   prototype props: [${protoProps.join(', ')}]`);
    }
    console.log(`[MidnightConnector]   hasConnect: ${hasConnect}${connectInProto ? ' (on prototype)' : ''}`);
    console.log(`[MidnightConnector]   hasEnable: ${hasEnable}`);
    console.log(`[MidnightConnector]   isLaceProvider: ${isLaceProvider(provider)}`);
    
    // Deep check for connect
    const connectCheck = checkConnectMethod(provider, key);
    console.log(`[MidnightConnector]   connectCheck: ${JSON.stringify(connectCheck)}`);
  }
  
  console.log('[MidnightConnector] ══════════════════════════════════════');
}

/**
 * Bind connect function to provider if it's on prototype.
 * Returns a callable function.
 */
function bindConnectFn(provider: any): (network: string) => Promise<any> {
  const connectFn = provider.connect;
  if (typeof connectFn !== 'function') {
    throw new Error('Provider does not have connect method');
  }
  
  // Bind to provider to ensure correct 'this' context
  return connectFn.bind(provider);
}

/**
 * Discover the best Lace Midnight provider.
 * 
 * Discovery order:
 * 1. window.midnight.mnLace (if present and has connect)
 * 2. Scan window.midnight[key] for providers where:
 *    - provider.name === "lace" (case-insensitive) OR rdns contains "lace"
 *    - provider.connect exists (own or prototype)
 * 
 * Selection criteria for multiple providers:
 * - Prefer providers with working connect function
 * - Prefer higher apiVersion (semver compare)
 * - Otherwise first by stable key ordering
 * 
 * @returns DiscoveredProvider or null if none found
 */
export function discoverLaceProvider(): DiscoveredProvider | null {
  const midnight = (window as any).midnight;
  
  if (!midnight || typeof midnight !== 'object') {
    log('discoverLaceProvider: window.midnight not found');
    return null;
  }

  const candidates: CandidateProvider[] = [];

  // === Check mnLace first (preferred path) ===
  const mnLace = midnight.mnLace;
  if (mnLace && typeof mnLace === 'object') {
    const { hasConnect, onPrototype } = checkConnectMethod(mnLace);
    if (hasConnect) {
      log('discoverLaceProvider: Found window.midnight.mnLace with connect()');
      
      const provider: DiscoveredProvider = {
        provider: mnLace,
        connectFn: bindConnectFn(mnLace),
        meta: {
          key: 'mnLace',
          name: mnLace.name || 'lace',
          apiVersion: mnLace.apiVersion || 'unknown',
          connectLocation: onPrototype ? 'prototype' : 'own',
          source: 'mnLace',
        },
      };
      
      // mnLace is preferred - return immediately
      return provider;
    } else {
      log('discoverLaceProvider: window.midnight.mnLace exists but has no connect()');
    }
  }

  // === Scan UUID keys for Lace providers ===
  const keys = Object.keys(midnight);
  log(`discoverLaceProvider: Scanning ${keys.length} keys under window.midnight:`, keys);

  for (const key of keys) {
    // Skip mnLace (already checked) and non-object values
    if (key === 'mnLace') continue;
    
    let provider: any;
    try {
      provider = midnight[key];
    } catch (e) {
      // Getter error
      continue;
    }
    
    if (!provider || typeof provider !== 'object') continue;

    // Check if this looks like a Lace provider
    if (!isLaceProvider(provider)) {
      log(`discoverLaceProvider: Skipping ${key} - not a Lace provider (name: ${provider.name})`);
      continue;
    }

    const { hasConnect, onPrototype } = checkConnectMethod(provider);
    
    const candidate: CandidateProvider = {
      key,
      name: provider.name || 'unknown',
      apiVersion: provider.apiVersion || '0.0.0',
      hasConnect,
      connectOnPrototype: onPrototype,
      rdns: provider.rdns,
    };
    
    candidates.push(candidate);
    
    log(`discoverLaceProvider: Found candidate ${key}:`, {
      name: candidate.name,
      apiVersion: candidate.apiVersion,
      hasConnect: candidate.hasConnect,
      connectOnPrototype: candidate.connectOnPrototype,
    });
  }

  if (candidates.length === 0) {
    log('discoverLaceProvider: No Lace providers found under UUID keys');
    return null;
  }

  // === Select best provider ===
  // Filter to those with connect
  const withConnect = candidates.filter(c => c.hasConnect);
  
  if (withConnect.length === 0) {
    // Log which providers we found but couldn't use
    warn(`discoverLaceProvider: Found ${candidates.length} Lace provider(s) but NONE have connect():`);
    for (const c of candidates) {
      warn(`  - ${c.key}: ${c.name} v${c.apiVersion} (hasConnect: ${c.hasConnect})`);
    }
    warn('This may indicate:');
    warn('  1. Provider is metadata-only and connect() appears later');
    warn('  2. Lace needs to be unlocked or Midnight mode enabled');
    warn('  3. Page needs to be reloaded after enabling Midnight mode');
    return null;
  }

  if (withConnect.length > 1) {
    warn(`discoverLaceProvider: Found ${withConnect.length} Lace providers with connect(). Selecting best...`);
  }

  // Sort by apiVersion (descending), then by key (ascending for stability)
  withConnect.sort((a, b) => {
    const versionCmp = compareSemver(b.apiVersion, a.apiVersion);
    if (versionCmp !== 0) return versionCmp;
    return a.key.localeCompare(b.key);
  });

  const selected = withConnect[0];
  const selectedProvider = midnight[selected.key];

  log(`discoverLaceProvider: Selected provider ${selected.key} (${selected.name} v${selected.apiVersion})`);

  const result: DiscoveredProvider = {
    provider: selectedProvider,
    connectFn: bindConnectFn(selectedProvider),
    meta: {
      key: selected.key,
      name: selected.name,
      apiVersion: selected.apiVersion,
      connectLocation: selected.connectOnPrototype ? 'prototype' : 'own',
      source: 'uuid',
    },
  };

  return result;
}

/**
 * Detect Midnight Preview provider with detailed diagnostics.
 * 
 * Reports:
 * - whether window.midnight exists
 * - whether mnLace exists
 * - how many candidate providers were found under UUID keys
 * - which provider was selected (key + apiVersion)
 * - whether connect was on instance or prototype
 * - whether CIP-30 cardano.lace exists (for logging only)
 * 
 * @returns DetectionResult with full diagnostic info
 */
export function detectMidnightPreview(): DetectionResult {
  const result: DetectionResult = {
    detected: false,
    midnightExists: false,
    midnightKeys: [],
    mnLaceExists: false,
    mnLaceHasConnect: false,
    candidateProviders: [],
    candidateCount: 0,
    selectedProvider: null,
    selectedKey: null,
    selectedApiVersion: null,
    connectOnPrototype: false,
    cardanoLaceExists: false,
  };

  // Check CIP-30 (for logging only - NOT used for Midnight)
  const cardanoLace = (window as any).cardano?.lace;
  result.cardanoLaceExists = !!cardanoLace;
  if (result.cardanoLaceExists) {
    log('detectMidnightPreview: Cardano Lace detected (CIP-30) — not used for Midnight connect');
  }

  // Check window.midnight
  const midnight = (window as any).midnight;
  if (!midnight || typeof midnight !== 'object') {
    log('detectMidnightPreview: window.midnight not found');
    state.detected = false;
    return result;
  }

  result.midnightExists = true;
  result.midnightKeys = Object.keys(midnight);
  log('detectMidnightPreview: window.midnight exists with keys:', result.midnightKeys);

  // Check mnLace
  const mnLace = midnight.mnLace;
  result.mnLaceExists = !!mnLace && typeof mnLace === 'object';
  if (result.mnLaceExists) {
    const { hasConnect } = checkConnectMethod(mnLace);
    result.mnLaceHasConnect = hasConnect;
    log(`detectMidnightPreview: mnLace exists, hasConnect: ${hasConnect}`);
  } else {
    log('detectMidnightPreview: mnLace is missing - will scan UUID keys');
  }

  // Scan for candidate providers
  for (const key of result.midnightKeys) {
    if (key === 'mnLace') continue;
    
    let provider: any;
    try {
      provider = midnight[key];
    } catch (e) {
      continue;
    }
    
    if (!provider || typeof provider !== 'object') continue;
    if (!isLaceProvider(provider)) continue;

    const { hasConnect, onPrototype } = checkConnectMethod(provider);
    
    result.candidateProviders.push({
      key,
      name: provider.name || 'unknown',
      apiVersion: provider.apiVersion || '0.0.0',
      hasConnect,
      connectOnPrototype: onPrototype,
      rdns: provider.rdns,
    });
  }
  
  result.candidateCount = result.candidateProviders.length;
  
  if (result.candidateCount > 0) {
    log(`detectMidnightPreview: Found ${result.candidateCount} candidate providers under UUID keys`);
  }

  // Discover the best provider
  const discovered = discoverLaceProvider();
  
  if (discovered) {
    result.detected = true;
    result.selectedProvider = discovered;
    result.selectedKey = discovered.meta.key;
    result.selectedApiVersion = discovered.meta.apiVersion;
    result.connectOnPrototype = discovered.meta.connectLocation === 'prototype';
    
    state.detected = true;
    state.selectedProviderKey = discovered.meta.key;
    state.selectedProviderSource = discovered.meta.source;
    
    log('detectMidnightPreview: Selected provider:', {
      key: result.selectedKey,
      apiVersion: result.selectedApiVersion,
      source: discovered.meta.source,
      connectOnPrototype: result.connectOnPrototype,
    });
  } else {
    state.detected = false;
    log('detectMidnightPreview: No usable Lace provider found');
  }

  return result;
}

/**
 * Get the raw mnLace connector object (legacy compatibility).
 * Returns null if not available.
 * 
 * NOTE: Prefer using discoverLaceProvider() for new code.
 */
export function getMnLaceConnector(): any | null {
  const midnight = (window as any).midnight;
  if (!midnight?.mnLace) return null;
  return midnight.mnLace;
}

/**
 * Get the currently discovered/cached provider.
 * Returns null if no provider has been discovered yet.
 */
export function getDiscoveredProvider(): DiscoveredProvider | null {
  if (_cachedProvider) return _cachedProvider;
  
  // Try to discover
  const discovered = discoverLaceProvider();
  if (discovered) {
    _cachedProvider = discovered;
  }
  return _cachedProvider;
}

// ============================================================
// Wait for Provider Helper
// ============================================================

/**
 * Wait for a Midnight provider to be injected.
 * 
 * Use this when connect is triggered to handle late injection.
 * NOT recommended for page load (extensions inject asynchronously).
 * 
 * @param options.timeoutMs - Maximum time to wait (default: 3000ms)
 * @param options.intervalMs - Poll interval (default: 100ms)
 * @returns Promise with success status and discovered provider
 */
export async function waitForMidnightProvider(options: {
  timeoutMs?: number;
  intervalMs?: number;
} = {}): Promise<{
  success: boolean;
  elapsed: number;
  provider: DiscoveredProvider | null;
  detection: DetectionResult | null;
  errorMessage: string | null;
}> {
  const { timeoutMs = 3000, intervalMs = 100 } = options;
  const startTime = Date.now();
  let lastLogTime = 0;

  log(`waitForMidnightProvider: Starting (timeout: ${timeoutMs}ms, interval: ${intervalMs}ms)`);

  return new Promise((resolve) => {
    function check() {
      const elapsed = Date.now() - startTime;
      
      // Log progress every second
      if (elapsed - lastLogTime >= 1000) {
        const midnightExists = typeof (window as any).midnight !== 'undefined';
        log(`waitForMidnightProvider: ${elapsed}ms elapsed, window.midnight exists: ${midnightExists}`);
        lastLogTime = elapsed;
      }

      const detection = detectMidnightPreview();
      
      if (detection.detected && detection.selectedProvider) {
        log(`waitForMidnightProvider: Provider found after ${elapsed}ms`);
        _cachedProvider = detection.selectedProvider;
        resolve({
          success: true,
          elapsed,
          provider: detection.selectedProvider,
          detection,
          errorMessage: null,
        });
        return;
      }

      if (elapsed >= timeoutMs) {
        // Build actionable error message
        let errorMessage = 'Midnight provider not found.\n\n';
        
        if (!detection.midnightExists) {
          errorMessage += 'window.midnight is missing. Check:\n';
          errorMessage += '• Lace wallet extension is installed\n';
          errorMessage += '• Midnight mode is enabled in Lace settings\n';
          errorMessage += '• Page was reloaded after enabling Midnight mode\n';
        } else if (!detection.mnLaceExists && detection.candidateCount === 0) {
          errorMessage += 'window.midnight exists but no Lace providers found.\n';
          errorMessage += `Keys present: [${detection.midnightKeys.join(', ')}]\n`;
          errorMessage += 'This may indicate Lace is in Cardano-only mode.\n';
        } else {
          errorMessage += 'Lace providers found but none have connect() method.\n';
        }

        if (location.protocol === 'file:') {
          errorMessage += '\n⚠️ file:// protocol - extensions cannot inject here.\n';
        }
        if (window.top !== window.self) {
          errorMessage += '\n⚠️ Page is in an iframe - extension injection may be blocked.\n';
        }

        warn(`waitForMidnightProvider: Timeout after ${timeoutMs}ms`);
        resolve({
          success: false,
          elapsed,
          provider: null,
          detection,
          errorMessage,
        });
        return;
      }

      setTimeout(check, intervalMs);
    }

    check();
  });
}

// ============================================================
// Error Classification
// ============================================================

/**
 * Classify errors according to v4.0.0 error types.
 * 
 * v4.0.0 error codes:
 * - PermissionRejected: User rejected the connection
 * - Disconnected: Connection was lost
 * - DAppConnectorAPIError: General API error with code
 */
function classifyError(err: any): { type: ConnectionErrorType; message: string } {
  const msg = (err?.message || String(err)).toLowerCase();
  const errType = err?.type;
  const errCode = err?.code;

  // v4.0.0: Check for DAppConnectorAPIError type
  if (errType === 'DAppConnectorAPIError') {
    if (errCode === 'PermissionRejected' || msg.includes('rejected') || msg.includes('denied')) {
      return {
        type: 'userRejected',
        message: 'User rejected the connection request. Click Connect again and approve in the Lace popup.',
      };
    }
    if (errCode === 'Disconnected' || msg.includes('disconnected')) {
      return {
        type: 'disconnected',
        message: 'Wallet connection was disconnected. Please reconnect.',
      };
    }
    return {
      type: 'apiError',
      message: `API Error (${errCode}): ${err?.message || 'Unknown error'}`,
    };
  }

  // Legacy error classification
  if (msg.includes('rejected') || msg.includes('denied') || msg.includes('user rejected') || msg.includes('permissionrejected')) {
    return {
      type: 'userRejected',
      message: 'User rejected the connection request. Click Connect again and approve in the Lace popup.',
    };
  }

  if (msg.includes('disconnected')) {
    return {
      type: 'disconnected',
      message: 'Wallet connection was disconnected. Please reconnect.',
    };
  }

  if (msg.includes('popup') || msg.includes('blocked')) {
    return {
      type: 'popupBlocked',
      message: 'Wallet popup was blocked. Ensure popups are allowed and click Connect from a button.',
    };
  }

  if (msg.includes('not found') || msg.includes('not installed') || msg.includes('missing')) {
    return {
      type: 'notEnabled',
      message: 'Midnight connector not found. Install Lace wallet with Midnight mode enabled.',
    };
  }

  return {
    type: 'unknown',
    message: err?.message || String(err),
  };
}

// ============================================================
// Connection
// ============================================================

/**
 * Connect to Midnight wallet via Lace.
 * 
 * Supports BOTH injection patterns:
 * 1. window.midnight.mnLace (preferred if present)
 * 2. window.midnight[uuid] where provider.name === "lace"
 * 
 * NEVER uses window.cardano (CIP-30 is completely separate)
 * 
 * Guards:
 * - Single-flight: If already connecting, returns immediately
 * - Rejection cooldown: If recently rejected, waits 30s before allowing retry
 * - User gesture: Logs warning if not in user gesture context
 * 
 * Error codes:
 * - notInstalled: window.midnight missing
 * - notEnabled: no provider with connect found
 * - multipleProviders: found >1, selected one (warning only)
 * - connectFailed: connect() threw, includes original error
 * 
 * @param network - Network to connect to (default: 'preview')
 * @returns ConnectionResult with success status and API or error
 */
export async function connectMidnightPreview(network: MidnightNetwork = 'preview'): Promise<ConnectionResult> {
  const now = Date.now();
  state.lastConnectAttempt = now;

  log(`connectMidnightPreview('${network}') - ${location.origin}`);

  // Guard: Already connected
  if (state.connected && state.api) {
    log('Already connected, returning cached API');
    return {
      success: true,
      api: state.api,
      error: null,
      errorMessage: null,
      walletInfo: null,
    };
  }

  // Guard: Already connecting (single-flight)
  if (state.connecting) {
    warn('Connection already in progress, ignoring duplicate call');
    return {
      success: false,
      api: null,
      error: 'alreadyConnecting',
      errorMessage: 'Connection already in progress. Please wait.',
      walletInfo: null,
    };
  }

  // Guard: Rejection cooldown
  if (state.rejectionCooldownUntil && now < state.rejectionCooldownUntil) {
    const remainingSec = Math.ceil((state.rejectionCooldownUntil - now) / 1000);
    warn(`Rejection cooldown active. ${remainingSec}s remaining.`);
    return {
      success: false,
      api: null,
      error: 'cooldown',
      errorMessage: `Recently rejected. Please wait ${remainingSec} seconds before trying again.`,
      walletInfo: null,
    };
  }

  // Check user gesture context
  try {
    const ua = (navigator as any).userActivation;
    if (ua && !ua.isActive && !ua.hasBeenActive) {
      warn('⚠️ Not in user gesture context! Popup may be blocked.');
      warn('Call connectMidnightPreview() from a button click handler.');
    } else {
      log('User gesture context: OK');
    }
  } catch (e) {
    // Can't detect, proceed anyway
  }

  // Detect and discover provider
  const detection = detectMidnightPreview();
  
  if (!detection.detected) {
    log('Detection:', { midnightExists: detection.midnightExists, keys: detection.midnightKeys });
  }

  // Check if window.midnight exists
  if (!detection.midnightExists) {
    const errMsg = 'window.midnight not found. Install Lace wallet with Midnight mode enabled.';
    error(errMsg);
    state.lastError = 'notInstalled';
    state.lastErrorMessage = errMsg;
    state.lastErrorTime = now;
    return {
      success: false,
      api: null,
      error: 'notInstalled',
      errorMessage: errMsg,
      walletInfo: null,
    };
  }

  // Check if we found a usable provider
  if (!detection.detected || !detection.selectedProvider) {
    let errMsg = 'No Lace Midnight provider with connect() found.\n';
    
    if (!detection.mnLaceExists && detection.candidateCount === 0) {
      errMsg += `window.midnight exists with keys: [${detection.midnightKeys.join(', ')}]\n`;
      errMsg += 'But no Lace providers were found. Ensure Midnight mode is enabled in Lace.';
    } else if (detection.candidateCount > 0) {
      errMsg += `Found ${detection.candidateCount} Lace provider(s) but none have connect() method.`;
    } else {
      errMsg += 'mnLace exists but has no connect() method.';
    }
    
    error(errMsg);
    state.lastError = 'notEnabled';
    state.lastErrorMessage = errMsg;
    state.lastErrorTime = now;
    return {
      success: false,
      api: null,
      error: 'notEnabled',
      errorMessage: errMsg,
      walletInfo: null,
    };
  }

  const discovered = detection.selectedProvider;
  _cachedProvider = discovered;

  // Warn if multiple providers found
  if (detection.candidateCount > 1) {
    warn(`Found ${detection.candidateCount} Lace providers. Selected: ${discovered.meta.key} v${discovered.meta.apiVersion}`);
  }

  log(`Using provider: ${discovered.meta.key} (${discovered.meta.name} v${discovered.meta.apiVersion})`);
  log(`Source: ${discovered.meta.source}, connect() location: ${discovered.meta.connectLocation}`);

  // Start connection
  state.connecting = true;
  state.selectedProviderKey = discovered.meta.key;
  state.selectedProviderSource = discovered.meta.source;

  try {
    log(`Calling ${discovered.meta.key}.connect('${network}')...`);
    log('NOTE: If you see a CARDANO popup instead of MIDNIGHT:');
    log('  → Open Lace settings → Enable Midnight mode');
    log('  → Restart browser and reload page');

    // Use the bound connect function (handles prototype binding)
    const api = await discovered.connectFn(network);

    if (!api) {
      throw new Error('connect() returned null - user may have rejected or popup was blocked');
    }

    // Success!
    state.connected = true;
    state.connecting = false;
    state.api = api;
    state.lastError = null;
    state.lastErrorMessage = null;
    state.rejectionCooldownUntil = null;

    log(`✓ Connected to ${discovered.meta.name} v${discovered.meta.apiVersion}`);

    return {
      success: true,
      api,
      error: null,
      errorMessage: null,
      walletInfo: {
        name: discovered.meta.name,
        apiVersion: discovered.meta.apiVersion,
        network,
      },
    };

  } catch (err: any) {
    state.connecting = false;
    
    const classified = classifyError(err);
    state.lastError = classified.type;
    state.lastErrorMessage = classified.message;
    state.lastErrorTime = now;

    error(`✗ Connection failed: ${classified.type} - ${classified.message}`);

    if (classified.type === 'userRejected') {
      state.rejectionCooldownUntil = now + REJECTION_COOLDOWN_MS;
      error(`Cooldown: ${REJECTION_COOLDOWN_MS / 1000}s. Check: popup visible? Lace in Midnight mode?`);
    }

    return {
      success: false,
      api: null,
      error: classified.type,
      errorMessage: classified.message,
      walletInfo: null,
    };
  }
}

// ============================================================
// Disconnect
// ============================================================

/**
 * Disconnect from the wallet and reset state.
 */
export function disconnect(): void {
  log('disconnect() called');
  state.connected = false;
  state.connecting = false;
  state.api = null;
  state.selectedProviderKey = null;
  state.selectedProviderSource = null;
  // Clear cached provider so next connect re-discovers
  _cachedProvider = null;
  // Don't clear lastError - keep for diagnostics
  log('Disconnected');
}

// ============================================================
// State Access
// ============================================================

/**
 * Get current connector state.
 */
export function getState(): Readonly<ConnectorState> {
  return { ...state };
}

/**
 * Get connected API (or null if not connected).
 */
export function getApi(): any | null {
  return state.api;
}

/**
 * Check if connected.
 */
export function isConnected(): boolean {
  return state.connected && state.api !== null;
}

/**
 * Check if connector is detected.
 */
export function isDetected(): boolean {
  return state.detected;
}

/**
 * Clear rejection cooldown (for testing).
 */
export function clearCooldown(): void {
  state.rejectionCooldownUntil = null;
  log('Cooldown cleared');
}

// ============================================================
// API Introspection
// ============================================================

/**
 * Introspect the connected wallet API to discover available methods.
 * Returns detailed info about what the API supports.
 */
export interface ApiIntrospection {
  connected: boolean;
  providerKey: string | null;
  apiVersion: string | null;
  methods: {
    name: string;
    type: 'function' | 'property' | 'getter';
    location: 'own' | 'prototype';
  }[];
  categories: {
    connection: string[];
    wallet: string[];
    transaction: string[];
    contract: string[];
    other: string[];
  };
  raw: {
    ownProperties: string[];
    prototypeProperties: string[];
    allKeys: string[];
  };
}

export function introspectApi(): ApiIntrospection {
  const result: ApiIntrospection = {
    connected: state.connected,
    providerKey: state.selectedProviderKey,
    apiVersion: null,
    methods: [],
    categories: {
      connection: [],
      wallet: [],
      transaction: [],
      contract: [],
      other: [],
    },
    raw: {
      ownProperties: [],
      prototypeProperties: [],
      allKeys: [],
    },
  };

  if (!state.api) {
    return result;
  }

  const api = state.api;

  // Get API version from cached provider
  if (_cachedProvider) {
    result.apiVersion = _cachedProvider.meta.apiVersion;
  }

  // Collect own properties
  try {
    result.raw.ownProperties = Object.getOwnPropertyNames(api);
  } catch (e) {
    // Proxy or restricted object
  }

  // Collect prototype properties (walk up to 3 levels)
  try {
    let proto = Object.getPrototypeOf(api);
    let level = 0;
    while (proto && proto !== Object.prototype && level < 3) {
      const protoProps = Object.getOwnPropertyNames(proto);
      for (const prop of protoProps) {
        if (!result.raw.prototypeProperties.includes(prop) && prop !== 'constructor') {
          result.raw.prototypeProperties.push(prop);
        }
      }
      proto = Object.getPrototypeOf(proto);
      level++;
    }
  } catch (e) {
    // Prototype access error
  }

  // Combine all keys
  result.raw.allKeys = [...new Set([...result.raw.ownProperties, ...result.raw.prototypeProperties])];

  // Analyze each property
  for (const key of result.raw.allKeys) {
    try {
      const value = api[key];
      const isOwn = result.raw.ownProperties.includes(key);
      const type = typeof value === 'function' ? 'function' : 
                   (Object.getOwnPropertyDescriptor(api, key)?.get ? 'getter' : 'property');
      
      result.methods.push({
        name: key,
        type,
        location: isOwn ? 'own' : 'prototype',
      });

      // Categorize methods
      if (typeof value === 'function') {
        const lowerKey = key.toLowerCase();
        if (lowerKey.includes('connect') || lowerKey.includes('enable') || lowerKey.includes('status')) {
          result.categories.connection.push(key);
        } else if (lowerKey.includes('address') || lowerKey.includes('balance') || lowerKey.includes('coin') || 
                   lowerKey.includes('wallet') || lowerKey.includes('state') || lowerKey.includes('config')) {
          result.categories.wallet.push(key);
        } else if (lowerKey.includes('transaction') || lowerKey.includes('tx') || lowerKey.includes('submit') || 
                   lowerKey.includes('sign') || lowerKey.includes('prove') || lowerKey.includes('balance')) {
          result.categories.transaction.push(key);
        } else if (lowerKey.includes('contract') || lowerKey.includes('call') || lowerKey.includes('deploy')) {
          result.categories.contract.push(key);
        } else {
          result.categories.other.push(key);
        }
      }
    } catch (e) {
      // Property access error
    }
  }

  return result;
}

/**
 * Print API introspection to console in a readable format.
 */
export function logApiMethods(): void {
  const info = introspectApi();
  
  console.log('[MidnightConnector] ══════════════════════════════════════');
  console.log('[MidnightConnector] API INTROSPECTION');
  console.log('[MidnightConnector] ══════════════════════════════════════');
  console.log('[MidnightConnector] Connected:', info.connected);
  console.log('[MidnightConnector] Provider:', info.providerKey);
  console.log('[MidnightConnector] API Version:', info.apiVersion);
  console.log('[MidnightConnector] Total methods:', info.methods.filter(m => m.type === 'function').length);
  
  if (info.categories.connection.length > 0) {
    console.log('[MidnightConnector] ── Connection ──');
    info.categories.connection.forEach(m => console.log(`[MidnightConnector]   ${m}()`));
  }
  
  if (info.categories.wallet.length > 0) {
    console.log('[MidnightConnector] ── Wallet ──');
    info.categories.wallet.forEach(m => console.log(`[MidnightConnector]   ${m}()`));
  }
  
  if (info.categories.transaction.length > 0) {
    console.log('[MidnightConnector] ── Transaction ──');
    info.categories.transaction.forEach(m => console.log(`[MidnightConnector]   ${m}()`));
  }
  
  if (info.categories.contract.length > 0) {
    console.log('[MidnightConnector] ── Contract ──');
    info.categories.contract.forEach(m => console.log(`[MidnightConnector]   ${m}()`));
  }
  
  if (info.categories.other.length > 0) {
    console.log('[MidnightConnector] ── Other ──');
    info.categories.other.forEach(m => console.log(`[MidnightConnector]   ${m}()`));
  }
  
  console.log('[MidnightConnector] ══════════════════════════════════════');
}

// ============================================================
// Debug
// ============================================================

/**
 * Print comprehensive debug info to console.
 */
export function debugDump(): void {
  console.log('[MidnightConnector] ╔══════════════════════════════════════════════════════════════╗');
  console.log('[MidnightConnector] ║                    DEBUG DUMP                                ║');
  console.log('[MidnightConnector] ╚══════════════════════════════════════════════════════════════╝');
  console.log('[MidnightConnector] Time:', new Date().toISOString());

  // Environment
  console.log('[MidnightConnector] ── Environment ──');
  console.log('[MidnightConnector]   origin:', location.origin);
  console.log('[MidnightConnector]   protocol:', location.protocol);
  console.log('[MidnightConnector]   isSecureContext:', (window as any).isSecureContext);
  console.log('[MidnightConnector]   top === self:', window.top === window.self);

  // Run full detection
  const detection = detectMidnightPreview();

  // Midnight namespace
  console.log('[MidnightConnector] ── window.midnight ──');
  console.log('[MidnightConnector]   exists:', detection.midnightExists);
  if (detection.midnightExists) {
    console.log('[MidnightConnector]   keys:', detection.midnightKeys);
  }

  // mnLace status
  console.log('[MidnightConnector] ── mnLace (legacy path) ──');
  console.log('[MidnightConnector]   exists:', detection.mnLaceExists);
  console.log('[MidnightConnector]   hasConnect:', detection.mnLaceHasConnect);
  
  if (detection.mnLaceExists) {
    const mnLace = (window as any).midnight.mnLace;
    console.log('[MidnightConnector]   name:', mnLace.name || '(not set)');
    console.log('[MidnightConnector]   apiVersion:', mnLace.apiVersion || '(not set)');
    
    // Check if same as cardano.lace (bad!)
    const isSameAsCardano = (window as any).cardano?.lace === mnLace;
    console.log('[MidnightConnector]   === cardano.lace:', isSameAsCardano, 
      isSameAsCardano ? '⚠️ BAD!' : '✓ Good');
  }

  // UUID providers
  console.log('[MidnightConnector] ── UUID Providers ──');
  console.log('[MidnightConnector]   candidateCount:', detection.candidateCount);
  if (detection.candidateProviders.length > 0) {
    for (const candidate of detection.candidateProviders) {
      console.log(`[MidnightConnector]   ${candidate.key}:`, {
        name: candidate.name,
        apiVersion: candidate.apiVersion,
        hasConnect: candidate.hasConnect,
        connectOnPrototype: candidate.connectOnPrototype,
        rdns: candidate.rdns,
      });
    }
  }

  // Selected provider
  console.log('[MidnightConnector] ── Selected Provider ──');
  console.log('[MidnightConnector]   detected:', detection.detected);
  if (detection.selectedProvider) {
    console.log('[MidnightConnector]   key:', detection.selectedKey);
    console.log('[MidnightConnector]   source:', detection.selectedProvider.meta.source);
    console.log('[MidnightConnector]   apiVersion:', detection.selectedApiVersion);
    console.log('[MidnightConnector]   connectOnPrototype:', detection.connectOnPrototype);
  } else {
    console.log('[MidnightConnector]   (none selected)');
  }

  // Cardano CIP-30 (for comparison - NOT used)
  console.log('[MidnightConnector] ── Cardano CIP-30 (NOT used) ──');
  console.log('[MidnightConnector]   window.cardano.lace exists:', detection.cardanoLaceExists);
  if (detection.cardanoLaceExists) {
    console.log('[MidnightConnector]   ℹ️ CIP-30 Lace detected but NOT used for Midnight connect');
  }

  // Connection state
  console.log('[MidnightConnector] ── Connection State ──');
  console.log('[MidnightConnector]   detected:', state.detected);
  console.log('[MidnightConnector]   connected:', state.connected);
  console.log('[MidnightConnector]   connecting:', state.connecting);
  console.log('[MidnightConnector]   selectedProviderKey:', state.selectedProviderKey);
  console.log('[MidnightConnector]   selectedProviderSource:', state.selectedProviderSource);
  console.log('[MidnightConnector]   api exists:', state.api !== null);
  console.log('[MidnightConnector]   lastError:', state.lastError);
  console.log('[MidnightConnector]   lastErrorMessage:', state.lastErrorMessage);

  if (state.rejectionCooldownUntil) {
    const remaining = Math.max(0, state.rejectionCooldownUntil - Date.now());
    console.log('[MidnightConnector]   rejectionCooldown:', `${Math.ceil(remaining / 1000)}s remaining`);
  }

  if (state.api) {
    console.log('[MidnightConnector] ── Connected API ──');
    try {
      console.log('[MidnightConnector]   API keys:', Object.keys(state.api));
    } catch (e) {
      console.log('[MidnightConnector]   API keys: (could not enumerate)');
    }
  }

  // Cached provider
  console.log('[MidnightConnector] ── Cached Provider ──');
  if (_cachedProvider) {
    console.log('[MidnightConnector]   key:', _cachedProvider.meta.key);
    console.log('[MidnightConnector]   source:', _cachedProvider.meta.source);
    console.log('[MidnightConnector]   apiVersion:', _cachedProvider.meta.apiVersion);
  } else {
    console.log('[MidnightConnector]   (none cached)');
  }

  console.log('[MidnightConnector] ╔══════════════════════════════════════════════════════════════╗');
  console.log('[MidnightConnector] ║                  END DEBUG DUMP                              ║');
  console.log('[MidnightConnector] ╚══════════════════════════════════════════════════════════════╝');
}

// ============================================================
// v4.0.0 Wallet API Methods
// ============================================================

/**
 * Get shielded addresses from connected wallet (v4.0.0).
 * Replaces state().address with granular method.
 * 
 * @returns { shieldedAddress, shieldedCoinPublicKey, shieldedEncryptionPublicKey }
 */
export async function getShieldedAddresses(): Promise<{
  shieldedAddress: string;
  shieldedCoinPublicKey: string;
  shieldedEncryptionPublicKey: string;
} | null> {
  if (!state.api) {
    warn('getShieldedAddresses: Not connected');
    return null;
  }
  
  try {
    if (typeof state.api.getShieldedAddresses === 'function') {
      const result = await state.api.getShieldedAddresses();
      log('getShieldedAddresses:', result);
      return result;
    } else {
      warn('getShieldedAddresses: Method not available on API');
      return null;
    }
  } catch (err: any) {
    error('getShieldedAddresses failed:', err.message || err);
    return null;
  }
}

/**
 * Get unshielded address from connected wallet (v4.0.0).
 * 
 * @returns Bech32m encoded unshielded address
 */
export async function getUnshieldedAddress(): Promise<string | null> {
  if (!state.api) {
    warn('getUnshieldedAddress: Not connected');
    return null;
  }
  
  try {
    if (typeof state.api.getUnshieldedAddress === 'function') {
      const result = await state.api.getUnshieldedAddress();
      log('getUnshieldedAddress:', result);
      return result;
    } else {
      warn('getUnshieldedAddress: Method not available on API');
      return null;
    }
  } catch (err: any) {
    error('getUnshieldedAddress failed:', err.message || err);
    return null;
  }
}

/**
 * Get shielded balances from connected wallet (v4.0.0).
 * Replaces state().balances with granular method.
 */
export async function getShieldedBalances(): Promise<any | null> {
  if (!state.api) {
    warn('getShieldedBalances: Not connected');
    return null;
  }
  
  try {
    if (typeof state.api.getShieldedBalances === 'function') {
      const result = await state.api.getShieldedBalances();
      log('getShieldedBalances:', result);
      return result;
    } else {
      warn('getShieldedBalances: Method not available on API');
      return null;
    }
  } catch (err: any) {
    error('getShieldedBalances failed:', err.message || err);
    return null;
  }
}

/**
 * Get unshielded balances from connected wallet (v4.0.0).
 */
export async function getUnshieldedBalances(): Promise<any | null> {
  if (!state.api) {
    warn('getUnshieldedBalances: Not connected');
    return null;
  }
  
  try {
    if (typeof state.api.getUnshieldedBalances === 'function') {
      const result = await state.api.getUnshieldedBalances();
      log('getUnshieldedBalances:', result);
      return result;
    } else {
      warn('getUnshieldedBalances: Method not available on API');
      return null;
    }
  } catch (err: any) {
    error('getUnshieldedBalances failed:', err.message || err);
    return null;
  }
}

/**
 * Get dust balance from connected wallet (v4.0.0).
 */
export async function getDustBalance(): Promise<string | null> {
  if (!state.api) {
    warn('getDustBalance: Not connected');
    return null;
  }
  
  try {
    if (typeof state.api.getDustBalance === 'function') {
      const result = await state.api.getDustBalance();
      log('getDustBalance:', result);
      return result;
    } else {
      warn('getDustBalance: Method not available on API');
      return null;
    }
  } catch (err: any) {
    error('getDustBalance failed:', err.message || err);
    return null;
  }
}

/**
 * Get connection status from connected wallet (v4.0.0).
 * 
 * @returns { connected: boolean, networkId: string }
 */
export async function getConnectionStatus(): Promise<{
  connected: boolean;
  networkId: string;
} | null> {
  if (!state.api) {
    return { connected: false, networkId: '' };
  }
  
  try {
    if (typeof state.api.getConnectionStatus === 'function') {
      const result = await state.api.getConnectionStatus();
      log('getConnectionStatus:', result);
      return result;
    } else {
      // Fallback: assume connected if we have an API
      return { connected: true, networkId: 'unknown' };
    }
  } catch (err: any) {
    error('getConnectionStatus failed:', err.message || err);
    return { connected: false, networkId: '' };
  }
}

/**
 * Get wallet configuration (v4.0.0).
 * Returns Configuration object with indexerUri, indexerWsUri, networkId, etc.
 */
export async function getConfiguration(): Promise<any | null> {
  if (!state.api) {
    warn('getConfiguration: Not connected');
    return null;
  }
  
  try {
    if (typeof state.api.getConfiguration === 'function') {
      const result = await state.api.getConfiguration();
      log('getConfiguration:', result);
      return result;
    } else {
      warn('getConfiguration: Method not available on API');
      return null;
    }
  } catch (err: any) {
    error('getConfiguration failed:', err.message || err);
    return null;
  }
}

/**
 * Balance an unsealed transaction (v4.0.0).
 * Replaces balanceAndProveTransaction() for contract interactions.
 * 
 * @param tx - Serialized transaction string
 * @returns { tx: string } - Balanced transaction
 */
export async function balanceUnsealedTransaction(tx: string): Promise<{ tx: string } | null> {
  if (!state.api) {
    warn('balanceUnsealedTransaction: Not connected');
    return null;
  }
  
  try {
    if (typeof state.api.balanceUnsealedTransaction === 'function') {
      const result = await state.api.balanceUnsealedTransaction(tx);
      log('balanceUnsealedTransaction: success');
      return result;
    } else {
      warn('balanceUnsealedTransaction: Method not available on API');
      return null;
    }
  } catch (err: any) {
    error('balanceUnsealedTransaction failed:', err.message || err);
    throw err;
  }
}

/**
 * Balance a sealed transaction (v4.0.0).
 * Used for completing atomic swaps.
 * 
 * @param tx - Serialized transaction string
 * @returns { tx: string } - Balanced transaction
 */
export async function balanceSealedTransaction(tx: string): Promise<{ tx: string } | null> {
  if (!state.api) {
    warn('balanceSealedTransaction: Not connected');
    return null;
  }
  
  try {
    if (typeof state.api.balanceSealedTransaction === 'function') {
      const result = await state.api.balanceSealedTransaction(tx);
      log('balanceSealedTransaction: success');
      return result;
    } else {
      warn('balanceSealedTransaction: Method not available on API');
      return null;
    }
  } catch (err: any) {
    error('balanceSealedTransaction failed:', err.message || err);
    throw err;
  }
}

/**
 * Submit a transaction (v4.0.0).
 * 
 * @param tx - Serialized transaction string
 * @returns Transaction hash
 */
export async function submitTransaction(tx: string): Promise<string | null> {
  if (!state.api) {
    warn('submitTransaction: Not connected');
    return null;
  }
  
  try {
    if (typeof state.api.submitTransaction === 'function') {
      const result = await state.api.submitTransaction(tx);
      log('submitTransaction: success, hash:', result);
      return result;
    } else {
      warn('submitTransaction: Method not available on API');
      return null;
    }
  } catch (err: any) {
    error('submitTransaction failed:', err.message || err);
    throw err;
  }
}

/**
 * Get proving provider for ZK proof delegation (v4.0.0).
 * 
 * @param keyMaterialProvider - Provider for key material resolution
 * @returns ProvingProvider compatible with Midnight Ledger
 */
export async function getProvingProvider(keyMaterialProvider: any): Promise<any | null> {
  if (!state.api) {
    warn('getProvingProvider: Not connected');
    return null;
  }
  
  try {
    if (typeof state.api.getProvingProvider === 'function') {
      const result = await state.api.getProvingProvider(keyMaterialProvider);
      log('getProvingProvider: success');
      return result;
    } else {
      warn('getProvingProvider: Method not available on API');
      return null;
    }
  } catch (err: any) {
    error('getProvingProvider failed:', err.message || err);
    return null;
  }
}

/**
 * Hint usage to the wallet (v4.0.0).
 * Proactively tells the wallet which API methods we intend to use,
 * allowing wallets to request user permissions upfront for better UX.
 * 
 * @param methods - Array of method names we intend to use
 * @returns true if hint was accepted
 */
export async function hintUsage(methods: string[]): Promise<boolean> {
  if (!state.api) {
    warn('hintUsage: Not connected');
    return false;
  }
  
  try {
    if (typeof (state.api as any).hintUsage === 'function') {
      await (state.api as any).hintUsage(methods);
      log('hintUsage: success for methods:', methods.join(', '));
      return true;
    } else {
      warn('hintUsage: Method not available on API (requires v4.0.0+)');
      return false;
    }
  } catch (err: any) {
    error('hintUsage failed:', err.message || err);
    return false;
  }
}

// ============================================================
// Legacy Compatibility
// ============================================================

/**
 * Check if connector is available (legacy compatibility).
 * Uses new provider discovery internally.
 */
export function isConnectorAvailable(): boolean {
  const discovered = discoverLaceProvider();
  return discovered !== null;
}

// ============================================================
// Export for window
// ============================================================

// Attach to window for easy console access
(window as any).MidnightConnector = {
  // Detection
  detectMidnightPreview,
  discoverLaceProvider,
  getDiscoveredProvider,
  isConnectorAvailable,
  logMidnightProviders,
  
  // Connection
  connectMidnightPreview,
  disconnect,
  
  // Wait helpers
  waitForMidnightProvider,
  
  // State
  getState,
  getApi,
  isConnected,
  isDetected,
  clearCooldown,
  
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
  submitTransaction,
  getProvingProvider,
  hintUsage,
  
  // API Introspection
  introspectApi,
  logApiMethods,
  
  // Debug
  debugDump,
  
  // Legacy
  getMnLaceConnector,
};

log('MidnightConnector v4.0.0 loaded. Use logMidnightProviders() for provider debug.');
