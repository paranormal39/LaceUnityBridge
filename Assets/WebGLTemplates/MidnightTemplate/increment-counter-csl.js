/**
 * IncrementCounterCSL - Pure CSL + CIP-30 + Blockfrost implementation
 * For Unity WebGL - No backend, no Mesh/Lucid/Blaze
 * 
 * Prerequisites:
 * - window.CSL loaded (from csl.bundle.js)
 * - window.__walletApi connected (CIP-30 wallet)
 */

(function() {
  'use strict';

  // ============================================================
  // Helper Functions
  // ============================================================

  function hexToBytes(hex) {
    if (hex.length % 2 !== 0) hex = '0' + hex;
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return bytes;
  }

  function bytesToHex(bytes) {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Decode CBOR integer from PlutusData inline datum
   * Supports both plain Int and Constr 0 [Int] (Counter newtype) formats
   * 
   * Constr 0 [Int n] format: d8799f <int> ff  (tag 121 + indefinite array)
   * Plain Int format: 00-1b... (CBOR major type 0)
   */
  function decodeDatumInteger(cborHex) {
    if (!cborHex || cborHex.length < 2) return 0n;
    
    // Check for Constr 0 format: d8799f...ff (tag 121 = 0xd879, indefinite array 0x9f, break 0xff)
    // Or definite array: d87981... (tag 121, array of 1)
    if (cborHex.startsWith('d8799f') && cborHex.endsWith('ff')) {
      // Constr 0 with indefinite array: d8799f <int> ff
      const innerHex = cborHex.substring(6, cborHex.length - 2); // strip d8799f and ff
      console.log('[decodeDatum] Constr 0 indefinite array, inner:', innerHex);
      return decodeRawCborInt(innerHex);
    } else if (cborHex.startsWith('d87981')) {
      // Constr 0 with definite array of 1: d87981 <int>
      const innerHex = cborHex.substring(6); // strip d87981
      console.log('[decodeDatum] Constr 0 definite array[1], inner:', innerHex);
      return decodeRawCborInt(innerHex);
    } else if (cborHex.startsWith('d879')) {
      // Some other Constr 0 format
      console.warn('[decodeDatum] Unknown Constr 0 format:', cborHex);
      // Try to find the int after the array marker
      const afterTag = cborHex.substring(4);
      if (afterTag.length >= 2) {
        const arrayMarker = parseInt(afterTag.substring(0, 2), 16);
        if (arrayMarker >= 0x80 && arrayMarker <= 0x97) {
          // Definite array 0-23 elements
          return decodeRawCborInt(afterTag.substring(2));
        }
      }
      return 0n;
    }
    
    // Plain integer format (legacy/fallback)
    console.log('[decodeDatum] Plain int format:', cborHex);
    return decodeRawCborInt(cborHex);
  }
  
  /**
   * Decode raw CBOR integer (major type 0)
   */
  function decodeRawCborInt(cborHex) {
    if (!cborHex || cborHex.length < 2) return 0n;
    
    const firstByte = parseInt(cborHex.substring(0, 2), 16);
    
    // CBOR unsigned integers (major type 0)
    if (firstByte <= 0x17) {
      // 0-23: value is the byte itself
      return BigInt(firstByte);
    } else if (firstByte === 0x18) {
      // 24: 1-byte uint follows
      return BigInt(parseInt(cborHex.substring(2, 4), 16));
    } else if (firstByte === 0x19) {
      // 25: 2-byte uint follows
      return BigInt(parseInt(cborHex.substring(2, 6), 16));
    } else if (firstByte === 0x1a) {
      // 26: 4-byte uint follows
      return BigInt(parseInt(cborHex.substring(2, 10), 16));
    } else if (firstByte === 0x1b) {
      // 27: 8-byte uint follows
      return BigInt('0x' + cborHex.substring(2, 18));
    }
    
    return 0n;
  }

  /**
   * Encode raw integer as CBOR (major type 0)
   */
  function encodeRawCborInt(value) {
    const n = BigInt(value);
    
    if (n < 0n) {
      throw new Error('Negative integers not supported');
    }
    
    if (n <= 23n) {
      return n.toString(16).padStart(2, '0');
    } else if (n <= 255n) {
      return '18' + n.toString(16).padStart(2, '0');
    } else if (n <= 65535n) {
      return '19' + n.toString(16).padStart(4, '0');
    } else if (n <= 4294967295n) {
      return '1a' + n.toString(16).padStart(8, '0');
    } else {
      return '1b' + n.toString(16).padStart(16, '0');
    }
  }
  
  /**
   * Encode integer as CBOR for PlutusData inline datum
   * V3 validator uses plain Int datum format (not Constr 0 [Int])
   */
  function encodeDatumInteger(value) {
    const result = encodeRawCborInt(value);
    console.log('[encodeDatum] Encoding', value.toString(), 'as plain Int:', result);
    return result;
  }

  /**
   * Build Redeemer CBOR for "Increment" action
   * Constructor 0 with no fields = d87980 (Constr 0 [])
   */
  function buildIncrementRedeemerCbor() {
    // d8 79 80 = tag 121 (constructor 0) + empty array
    return 'd87980';
  }

  /**
   * Safely convert CSL index value to string
   * Handles: number, bigint, objects with to_str(), objects with toString()
   */
  function idxToString(idx) {
    if (idx === null || idx === undefined) return '0';
    if (typeof idx === 'number' || typeof idx === 'bigint') return String(idx);
    if (typeof idx.to_str === 'function') return idx.to_str();
    if (typeof idx.toString === 'function') return idx.toString();
    return String(idx);
  }

  /**
   * Get input index from TransactionInput (handles CSL version differences)
   * Some versions use .index(), others use .output_index()
   */
  function getInputIndex(input) {
    if (typeof input.index === 'function') {
      return idxToString(input.index());
    }
    if (typeof input.output_index === 'function') {
      return idxToString(input.output_index());
    }
    return '0';
  }

  /**
   * Extract payment credential from a CSL Address
   * CSL Address.from_bech32() returns a generic Address without payment_cred() method.
   * We need to downcast to the correct address type:
   * - addr_test1w... / addr1w... = EnterpriseAddress (script-only, no staking)
   * - addr_test1q... / addr1q... = BaseAddress (payment + staking)
   * - addr_test1g... / addr1g... = PointerAddress
   * 
   * @param {CSL} CSL - The CSL library
   * @param {Address} addr - The generic CSL Address
   * @returns {Credential} The payment credential
   */
  function getPaymentCredFromAddress(CSL, addr) {
    // Try EnterpriseAddress first (addr_test1w... / addr1w...)
    if (typeof CSL.EnterpriseAddress !== 'undefined') {
      const enterprise = CSL.EnterpriseAddress.from_address(addr);
      if (enterprise) {
        console.log('[IncrementCSL] Address is EnterpriseAddress');
        return enterprise.payment_cred();
      }
    }
    
    // Try BaseAddress (addr_test1q... / addr1q...)
    if (typeof CSL.BaseAddress !== 'undefined') {
      const base = CSL.BaseAddress.from_address(addr);
      if (base) {
        console.log('[IncrementCSL] Address is BaseAddress');
        return base.payment_cred();
      }
    }
    
    // Try PointerAddress (addr_test1g... / addr1g...)
    if (typeof CSL.PointerAddress !== 'undefined') {
      const pointer = CSL.PointerAddress.from_address(addr);
      if (pointer) {
        console.log('[IncrementCSL] Address is PointerAddress');
        return pointer.payment_cred();
      }
    }
    
    // Try RewardAddress (stake addresses)
    if (typeof CSL.RewardAddress !== 'undefined') {
      const reward = CSL.RewardAddress.from_address(addr);
      if (reward) {
        console.log('[IncrementCSL] Address is RewardAddress');
        return reward.payment_cred();
      }
    }
    
    throw new Error('Unable to extract payment credential from address. Unknown address type.');
  }

  /**
   * Detect if bytes are double-CBOR encoded and unwrap if needed.
   * 
   * Aiken's plutus.json contains the "compiledCode" which is the script bytes
   * CBOR-encoded as a bytestring. When you hex-decode that, you get CBOR bytes
   * that start with 0x58 or 0x59 (CBOR bytestring tag).
   * 
   * CSL's PlutusScript.from_bytes() expects the RAW script bytes, not CBOR-wrapped.
   * 
   * Detection:
   * - 0x58 XX = CBOR bytes, 1-byte length (XX is length)
   * - 0x59 XX XX = CBOR bytes, 2-byte length
   * - 0x5a XX XX XX XX = CBOR bytes, 4-byte length
   * 
   * @param {Uint8Array} bytes - The input bytes (possibly CBOR-wrapped)
   * @returns {Object} { unwrapped: Uint8Array, wasWrapped: boolean, info: string }
   */
  function unwrapCborBytes(bytes) {
    if (!bytes || bytes.length < 2) {
      return { unwrapped: bytes, wasWrapped: false, info: 'too short' };
    }
    
    const firstByte = bytes[0];
    
    // Check for CBOR bytestring tags
    if (firstByte === 0x58 && bytes.length > 2) {
      // 0x58 = bytes with 1-byte length
      const len = bytes[1];
      if (bytes.length === 2 + len) {
        return { 
          unwrapped: bytes.slice(2), 
          wasWrapped: true, 
          info: `CBOR 0x58 (1-byte len=${len})` 
        };
      }
    } else if (firstByte === 0x59 && bytes.length > 3) {
      // 0x59 = bytes with 2-byte length
      const len = (bytes[1] << 8) | bytes[2];
      if (bytes.length === 3 + len) {
        return { 
          unwrapped: bytes.slice(3), 
          wasWrapped: true, 
          info: `CBOR 0x59 (2-byte len=${len})` 
        };
      }
    } else if (firstByte === 0x5a && bytes.length > 5) {
      // 0x5a = bytes with 4-byte length
      const len = (bytes[1] << 24) | (bytes[2] << 16) | (bytes[3] << 8) | bytes[4];
      if (bytes.length === 5 + len) {
        return { 
          unwrapped: bytes.slice(5), 
          wasWrapped: true, 
          info: `CBOR 0x5a (4-byte len=${len})` 
        };
      }
    }
    
    // Also check for 0x82 which is CBOR array of 2 elements (Plutus script envelope)
    // Format: [version, script_bytes] where version is 1 (V1), 2 (V2), or 3 (V3)
    if (firstByte === 0x82 && bytes.length > 2) {
      // This might be a Plutus script envelope [version, bytes]
      // We'd need more complex CBOR parsing here
      return { unwrapped: bytes, wasWrapped: false, info: 'possible envelope (0x82)' };
    }
    
    return { unwrapped: bytes, wasWrapped: false, info: 'not CBOR-wrapped' };
  }

  /**
   * Normalize validator bytes for CSL PlutusScript parsing.
   * Handles double-CBOR encoding from Aiken's plutus.json compiledCode.
   * 
   * @param {string} validatorHex - The validator CBOR hex string
   * @returns {Object} { bytes: Uint8Array, info: string }
   */
  function normalizeValidatorBytes(validatorHex) {
    const rawBytes = hexToBytes(validatorHex);
    
    console.log('[IncrementCSL] Script bytes analysis:', {
      inputHexLength: validatorHex.length,
      inputBytesLength: rawBytes.length,
      firstBytes: bytesToHex(rawBytes.slice(0, 16)),
      firstByte: '0x' + rawBytes[0].toString(16).padStart(2, '0')
    });
    
    // Try unwrapping once
    const result1 = unwrapCborBytes(rawBytes);
    console.log('[IncrementCSL] First unwrap:', result1.info);
    
    if (result1.wasWrapped) {
      // Check if it's double-wrapped
      const result2 = unwrapCborBytes(result1.unwrapped);
      console.log('[IncrementCSL] Second unwrap:', result2.info);
      
      if (result2.wasWrapped) {
        return { 
          bytes: result2.unwrapped, 
          info: `double-wrapped: ${result1.info} -> ${result2.info}` 
        };
      }
      return { bytes: result1.unwrapped, info: `single-wrapped: ${result1.info}` };
    }
    
    return { bytes: rawBytes, info: 'not wrapped' };
  }

  /**
   * Extract script hash from a CSL Address (for script addresses)
   * @param {CSL} CSL - The CSL library
   * @param {Address} addr - The generic CSL Address
   * @returns {ScriptHash} The script hash, or null if not a script address
   */
  function getScriptHashFromAddress(CSL, addr) {
    const cred = getPaymentCredFromAddress(CSL, addr);
    
    // Try to_scripthash() first (newer CSL versions)
    if (typeof cred.to_scripthash === 'function') {
      const sh = cred.to_scripthash();
      if (sh) return sh;
    }
    
    // Try script_hash() (some CSL versions)
    if (typeof cred.script_hash === 'function') {
      const sh = cred.script_hash();
      if (sh) return sh;
    }
    
    // Check if it's a script credential via kind()
    if (typeof cred.kind === 'function') {
      const kind = cred.kind();
      // kind 1 = script, kind 0 = key
      if (kind === 1 || kind === 'Script') {
        // Try to get the hash via to_scripthash or similar
        if (typeof cred.to_scripthash === 'function') {
          return cred.to_scripthash();
        }
      }
    }
    
    throw new Error('Address does not contain a script credential, or unable to extract script hash.');
  }

  /**
   * Log validity interval from a transaction for debugging
   * @param {string} tag - Label for the log
   * @param {Transaction} tx - CSL Transaction object
   */
  function logValidity(tag, tx) {
    try {
      const body = tx.body();
      
      // CSL has two TTL accessors:
      // - ttl() returns number | undefined
      // - ttl_bignum() returns BigNum | undefined
      let ttlValue = 'NULL';
      if (typeof body.ttl_bignum === 'function') {
        const ttlBn = body.ttl_bignum();
        ttlValue = ttlBn ? ttlBn.to_str() : 'NULL';
      } else if (typeof body.ttl === 'function') {
        const ttlNum = body.ttl();
        ttlValue = (ttlNum !== undefined && ttlNum !== null) ? String(ttlNum) : 'NULL';
      }
      
      // Validity start interval
      let validityStartValue = 'NULL';
      if (typeof body.validity_start_interval_bignum === 'function') {
        const vsi = body.validity_start_interval_bignum();
        validityStartValue = vsi ? vsi.to_str() : 'NULL';
      } else if (typeof body.validity_start_interval === 'function') {
        const vsi = body.validity_start_interval();
        validityStartValue = (vsi !== undefined && vsi !== null) ? String(vsi) : 'NULL';
      }
      
      console.log(`[IncrementCSL] ${tag} validity:`, {
        ttl: ttlValue,
        validity_start: validityStartValue
      });
    } catch (e) {
      console.log(`[IncrementCSL] ${tag} validity: ERROR -`, e.message);
    }
  }

  /**
   * Convert Blockfrost rational value to { num, den } bigints
   * Handles three formats:
   * - number: 0.0577 → approximate rational
   * - string: "577/10000" → parse directly
   * - object: { numerator: 577, denominator: 10000 }
   */
  function toRational(value) {
    // Object format: { numerator, denominator }
    if (value && typeof value === 'object' && 'numerator' in value) {
      return {
        num: BigInt(value.numerator),
        den: BigInt(value.denominator)
      };
    }
    
    // String format: "numerator/denominator"
    if (typeof value === 'string' && value.includes('/')) {
      const parts = value.split('/');
      return {
        num: BigInt(parts[0]),
        den: BigInt(parts[1])
      };
    }
    
    // Number format: convert decimal to rational
    // e.g., 0.0577 → 577/10000
    if (typeof value === 'number') {
      const str = value.toString();
      const decimalIndex = str.indexOf('.');
      if (decimalIndex === -1) {
        return { num: BigInt(value), den: 1n };
      }
      const decimals = str.length - decimalIndex - 1;
      const den = 10n ** BigInt(decimals);
      const num = BigInt(Math.round(value * Number(den)));
      return { num, den };
    }
    
    // Fallback: try to parse as string number
    if (typeof value === 'string') {
      return toRational(parseFloat(value));
    }
    
    // Default fallback
    console.warn('[toRational] Unknown format, using default:', value);
    return { num: 1n, den: 1n };
  }

  // ============================================================
  // Blockfrost API Helpers
  // ============================================================

  async function blockfrostFetch(endpoint, blockfrostKey, method = 'GET', body = null) {
    const baseUrl = 'https://cardano-preprod.blockfrost.io/api/v0';
    const options = {
      method,
      headers: {
        'project_id': blockfrostKey,
        'Content-Type': 'application/json'
      }
    };
    if (body) options.body = JSON.stringify(body);
    
    const response = await fetch(`${baseUrl}${endpoint}`, options);
    
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Blockfrost ${response.status}: ${text}`);
    }
    
    return response.json();
  }

  async function getScriptUtxos(scriptAddress, blockfrostKey) {
    return blockfrostFetch(`/addresses/${scriptAddress}/utxos`, blockfrostKey);
  }

  async function getProtocolParameters(blockfrostKey) {
    return blockfrostFetch('/epochs/latest/parameters', blockfrostKey);
  }

  async function getLatestBlock(blockfrostKey) {
    return blockfrostFetch('/blocks/latest', blockfrostKey);
  }

  async function evaluateTx(txCborHex, blockfrostKey) {
    // Blockfrost tx evaluation endpoint requires raw CBOR bytes with Content-Type: application/cbor
    const baseUrl = 'https://cardano-preprod.blockfrost.io/api/v0';
    
    // DEBUG: Log what we're sending
    console.log('[IncrementCSL] Evaluate request:', {
      url: `${baseUrl}/utils/txs/evaluate`,
      txHexLength: txCborHex.length,
      txBytesLength: txCborHex.length / 2,
      txHexFirst50: txCborHex.substring(0, 50),
      txHexLast50: txCborHex.substring(txCborHex.length - 50)
    });
    
    const txBytes = hexToBytes(txCborHex);
    
    const response = await fetch(`${baseUrl}/utils/txs/evaluate`, {
      method: 'POST',
      headers: {
        'project_id': blockfrostKey,
        'Content-Type': 'application/cbor'
      },
      body: txBytes
    });
    
    const responseText = await response.text();
    console.log('[IncrementCSL] Evaluate response:', response.status, responseText.substring(0, 500));
    
    if (!response.ok) {
      throw new Error(`Blockfrost evaluate ${response.status}: ${responseText}`);
    }
    
    return JSON.parse(responseText);
  }

  async function submitTxBlockfrost(txCborHex, blockfrostKey) {
    const baseUrl = 'https://cardano-preprod.blockfrost.io/api/v0';
    const response = await fetch(`${baseUrl}/tx/submit`, {
      method: 'POST',
      headers: {
        'project_id': blockfrostKey,
        'Content-Type': 'application/cbor'
      },
      body: hexToBytes(txCborHex)
    });
    
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Submit failed ${response.status}: ${text}`);
    }
    
    return response.text(); // Returns tx hash
  }

  // ============================================================
  // Configurable Fallback Evaluators
  // Set these URLs to enable fallback evaluation when Blockfrost fails
  // ============================================================
  const OGMIOS_URL = null; // e.g., 'ws://localhost:1337' or 'wss://ogmios.example.com'
  const KOIOS_URL = null;  // e.g., 'https://preprod.koios.rest/api/v1'

  // ============================================================
  // ExUnits Evaluation with Retry and Fallback
  // ============================================================

  /**
   * Sleep helper for retry delays
   */
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Evaluate transaction ExUnits via Blockfrost with retry on 5xx errors
   * @param {string} txCborHex - Transaction CBOR hex
   * @param {string} blockfrostKey - Blockfrost API key
   * @param {number[]} retryDelays - Array of retry delays in ms (default: [250, 750, 2000])
   * @returns {Promise<object>} - Evaluation result with ExUnits
   */
  async function evaluateWithBlockfrostRetry(txCborHex, blockfrostKey, retryDelays = [250, 750, 2000]) {
    const baseUrl = 'https://cardano-preprod.blockfrost.io/api/v0';
    
    let lastError = null;
    
    for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
      try {
        console.log(`[Evaluate] Blockfrost attempt ${attempt + 1}/${retryDelays.length + 1}`);
        
        // DEBUG: Log txHex details
        console.log('[Evaluate] txCborHex length:', txCborHex.length, 'chars (', txCborHex.length / 2, 'bytes)');
        console.log('[Evaluate] txCborHex first 20 chars:', txCborHex.substring(0, 20));
        
        // Use ?version=6 for Ogmios v6 protocol (Conway era)
        // Body must be base16 (hex) string of CBOR tx, NOT JSON, NOT raw bytes
        const response = await fetch(`${baseUrl}/utils/txs/evaluate?version=6`, {
          method: 'POST',
          headers: {
            'project_id': blockfrostKey,
            'Content-Type': 'application/cbor',
            'Accept': 'application/json'
          },
          body: txCborHex  // Send hex string, not bytes
        });
        
        // Read as text first for debugging
        const text = await response.text();
        let json;
        try { json = JSON.parse(text); } catch (e) { json = null; }
        
        console.log('[Evaluate] HTTP', response.status, response.statusText);
        console.log('[Evaluate] Raw response text (full):', text);
        
        if (!json) {
          throw new Error('EvaluateTx returned non-JSON. See raw response above.');
        }
        
        // Normalize for both response shapes (Blockfrost vs Ogmios)
        const result = json.result ?? json;
        const failure = result?.EvaluationFailure ?? result?.result?.EvaluationFailure;
        
        console.log('[Evaluate] Parsed json:', json);
        console.log('[Evaluate] Normalized result:', result);
        
        if (failure) {
          // CRITICAL: Print full failure JSON for debugging
          console.log('[Evaluate] ❌ EvaluationFailure:', JSON.stringify(failure, null, 2));
          throw new Error('EvaluateTx EvaluationFailure:\n' + JSON.stringify(failure, null, 2));
        }
        
        const success = result?.EvaluationResult ?? result?.result?.EvaluationResult ?? result;
        console.log('[Evaluate] ✅ EvaluationResult:', JSON.stringify(success, null, 2));
        return { result: { EvaluationResult: success } };
        
      } catch (err) {
        if (err.message.includes('EvaluationFailure') || err.message.includes('Blockfrost evaluate')) {
          throw err; // Re-throw evaluation failures immediately
        }
        
        lastError = err;
        console.warn(`[Evaluate] Blockfrost attempt ${attempt + 1} failed:`, err.message);
        
        if (attempt < retryDelays.length) {
          const delay = retryDelays[attempt];
          console.log(`[Evaluate] Waiting ${delay}ms before retry...`);
          await sleep(delay);
        }
      }
    }
    
    throw lastError || new Error('Blockfrost evaluation failed after all retries');
  }

  /**
   * Find the index of a specific input in the transaction body's inputs (canonical ordering)
   * This is critical for correct redeemer index computation
   */
  function findInputIndexInTxBody(txBody, targetTxHashHex, targetIndex) {
    const ins = txBody.inputs();
    
    // DEBUG: Print txBody.inputs ordering
    console.log('[DEBUG] txBody.inputs() count:', ins.len());
    for (let i = 0; i < ins.len(); i++) {
      const input = ins.get(i);
      const h = bytesToHex(input.transaction_id().to_bytes());
      // CSL TransactionInput.index() returns u32 (JS number), NOT BigNum
      const ix = input.index();
      console.log(`[DEBUG] txBody.inputs[${i}] = ${h.substring(0, 16)}...#${ix}`);
    }
    
    for (let i = 0; i < ins.len(); i++) {
      const input = ins.get(i);
      const h = bytesToHex(input.transaction_id().to_bytes());
      // CSL TransactionInput.index() returns u32 (JS number), NOT BigNum
      const ix = input.index();
      if (h === targetTxHashHex && ix === targetIndex) {
        return i;
      }
    }
    return -1;
  }

  /**
   * Evaluate transaction ExUnits via Ogmios (WebSocket)
   * @param {string} txCborHex - Transaction CBOR hex
   * @returns {Promise<object>} - Evaluation result with ExUnits
   */
  async function evaluateWithOgmios(txCborHex) {
    if (!OGMIOS_URL) {
      throw new Error('Ogmios URL not configured');
    }
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('Ogmios evaluation timeout (10s)'));
      }, 10000);
      
      const ws = new WebSocket(OGMIOS_URL);
      
      ws.onopen = () => {
        console.log('[Evaluate] Ogmios connected, sending evaluateTx request');
        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          method: 'evaluateTransaction',
          params: {
            transaction: { cbor: txCborHex }
          },
          id: 'eval-1'
        }));
      };
      
      ws.onmessage = (event) => {
        clearTimeout(timeout);
        try {
          const response = JSON.parse(event.data);
          ws.close();
          
          if (response.error) {
            reject(new Error(`Ogmios error: ${JSON.stringify(response.error)}`));
            return;
          }
          
          // Convert Ogmios response to Blockfrost-like format
          const result = response.result;
          if (result && result.length > 0) {
            const evalResult = { result: { EvaluationResult: {} } };
            result.forEach((item, idx) => {
              if (item.budget) {
                evalResult.result.EvaluationResult[`spend:${idx}`] = {
                  memory: item.budget.memory,
                  steps: item.budget.cpu
                };
              }
            });
            console.log('[Evaluate] Ogmios success:', evalResult);
            resolve(evalResult);
          } else {
            reject(new Error('Ogmios returned empty evaluation result'));
          }
        } catch (err) {
          reject(new Error(`Ogmios parse error: ${err.message}`));
        }
      };
      
      ws.onerror = (err) => {
        clearTimeout(timeout);
        reject(new Error(`Ogmios WebSocket error: ${err.message || 'connection failed'}`));
      };
    });
  }

  /**
   * Evaluate transaction ExUnits via Koios
   * @param {string} txCborHex - Transaction CBOR hex
   * @returns {Promise<object>} - Evaluation result with ExUnits
   */
  async function evaluateWithKoios(txCborHex) {
    if (!KOIOS_URL) {
      throw new Error('Koios URL not configured');
    }
    
    console.log('[Evaluate] Trying Koios at', KOIOS_URL);
    
    const response = await fetch(`${KOIOS_URL}/ogmios`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'evaluateTransaction',
        params: { transaction: { cbor: txCborHex } },
        id: 'eval-koios'
      })
    });
    
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Koios ${response.status}: ${text}`);
    }
    
    const result = await response.json();
    if (result.error) {
      throw new Error(`Koios error: ${JSON.stringify(result.error)}`);
    }
    
    // Convert to Blockfrost-like format
    const evalResult = { result: { EvaluationResult: {} } };
    if (result.result && result.result.length > 0) {
      result.result.forEach((item, idx) => {
        if (item.budget) {
          evalResult.result.EvaluationResult[`spend:${idx}`] = {
            memory: item.budget.memory,
            steps: item.budget.cpu
          };
        }
      });
    }
    
    console.log('[Evaluate] Koios success:', evalResult);
    return evalResult;
  }

  /**
   * Evaluate ExUnits with retry and fallback to alternative providers
   * @param {string} txCborHex - Transaction CBOR hex
   * @param {string} blockfrostKey - Blockfrost API key
   * @returns {Promise<object>} - Evaluation result with ExUnits
   */
  async function evaluateExUnitsWithRetryAndFallback(txCborHex, blockfrostKey) {
    // Log tx info for debugging
    console.log('[Evaluate] Tx CBOR length:', txCborHex.length / 2, 'bytes');
    console.log('[Evaluate] Tx CBOR first byte:', txCborHex.substring(0, 2));
    
    // Check if it's a full transaction (starts with 84 = array of 4)
    const firstByte = parseInt(txCborHex.substring(0, 2), 16);
    const isTxArray = (firstByte & 0xf0) === 0x80; // Major type 4 (array)
    const arrayLen = firstByte & 0x0f;
    console.log('[Evaluate] Tx CBOR format:', isTxArray ? `array of ${arrayLen}` : 'not an array', 
      '(expected: array of 4 for full tx)');
    
    // Try Blockfrost with retry
    try {
      return await evaluateWithBlockfrostRetry(txCborHex, blockfrostKey);
    } catch (blockfrostErr) {
      console.warn('[Evaluate] Blockfrost failed after retries:', blockfrostErr.message);
      
      // Try Ogmios fallback
      if (OGMIOS_URL) {
        try {
          console.log('[Evaluate] Trying Ogmios fallback...');
          return await evaluateWithOgmios(txCborHex);
        } catch (ogmiosErr) {
          console.warn('[Evaluate] Ogmios fallback failed:', ogmiosErr.message);
        }
      }
      
      // Try Koios fallback
      if (KOIOS_URL) {
        try {
          console.log('[Evaluate] Trying Koios fallback...');
          return await evaluateWithKoios(txCborHex);
        } catch (koiosErr) {
          console.warn('[Evaluate] Koios fallback failed:', koiosErr.message);
        }
      }
      
      // All evaluators failed
      throw new Error(
        'ExUnits evaluation failed with all providers. ' +
        'Blockfrost: ' + blockfrostErr.message + '. ' +
        (OGMIOS_URL ? 'Ogmios configured but failed. ' : 'Ogmios not configured. ') +
        (KOIOS_URL ? 'Koios configured but failed.' : 'Koios not configured.')
      );
    }
  }

  // ============================================================
  // TransactionBuilder Config from Blockfrost Protocol Params
  // ============================================================

  /**
   * Build complete TransactionBuilderConfig from Blockfrost protocol parameters
   * Includes all Conway-era parameters needed for proper script_data_hash computation
   * @param {object} pp - Protocol parameters from Blockfrost /epochs/latest/parameters
   * @param {object} CSL - Cardano Serialization Library
   * @returns {object} - { config: TransactionBuilderConfig, costModels: Costmdls }
   */
  function buildTxBuilderConfigFromBlockfrost(pp, CSL) {
    console.log('[TxConfig] Building TransactionBuilderConfig from Blockfrost params');
    console.log('[TxConfig] Era: Conway (Preprod)');
    
    // Log all protocol params being used
    console.log('[TxConfig] Protocol params:', {
      min_fee_a: pp.min_fee_a,
      min_fee_b: pp.min_fee_b,
      max_tx_size: pp.max_tx_size,
      max_val_size: pp.max_val_size,
      key_deposit: pp.key_deposit,
      pool_deposit: pp.pool_deposit,
      coins_per_utxo_size: pp.coins_per_utxo_size,
      collateral_percent: pp.collateral_percent,
      max_collateral_inputs: pp.max_collateral_inputs,
      price_mem: pp.price_mem,
      price_step: pp.price_step,
      max_tx_ex_mem: pp.max_tx_ex_mem,
      max_tx_ex_steps: pp.max_tx_ex_steps,
      cost_models_keys: pp.cost_models ? Object.keys(pp.cost_models) : 'none'
    });
    
    // Convert price rationals
    const memPrice = toRational(pp.price_mem);
    const stepPrice = toRational(pp.price_step);
    
    // Build ExUnitPrices
    const exUnitPrices = CSL.ExUnitPrices.new(
      CSL.UnitInterval.new(
        CSL.BigNum.from_str(memPrice.num.toString()),
        CSL.BigNum.from_str(memPrice.den.toString())
      ),
      CSL.UnitInterval.new(
        CSL.BigNum.from_str(stepPrice.num.toString()),
        CSL.BigNum.from_str(stepPrice.den.toString())
      )
    );
    
    // Build config
    let configBuilder = CSL.TransactionBuilderConfigBuilder.new()
      .fee_algo(CSL.LinearFee.new(
        CSL.BigNum.from_str(pp.min_fee_a.toString()),
        CSL.BigNum.from_str(pp.min_fee_b.toString())
      ))
      .pool_deposit(CSL.BigNum.from_str(pp.pool_deposit))
      .key_deposit(CSL.BigNum.from_str(pp.key_deposit))
      .max_value_size(parseInt(pp.max_val_size))
      .max_tx_size(parseInt(pp.max_tx_size))
      .coins_per_utxo_byte(CSL.BigNum.from_str(pp.coins_per_utxo_size))
      .ex_unit_prices(exUnitPrices)
      .prefer_pure_change(true);
    
    // Add ref_script_coins_per_byte if available (Conway)
    if (pp.min_fee_ref_script_cost_per_byte && typeof configBuilder.ref_script_coins_per_byte === 'function') {
      const refScriptPrice = toRational(pp.min_fee_ref_script_cost_per_byte);
      configBuilder = configBuilder.ref_script_coins_per_byte(
        CSL.UnitInterval.new(
          CSL.BigNum.from_str(refScriptPrice.num.toString()),
          CSL.BigNum.from_str(refScriptPrice.den.toString())
        )
      );
      console.log('[TxConfig] Added ref_script_coins_per_byte');
    }
    
    const config = configBuilder.build();
    console.log('[TxConfig] TransactionBuilderConfig built successfully');
    
    return config;
  }

  // ============================================================
  // Main Implementation
  // ============================================================

  /**
   * IncrementCounterCSL - Build, sign, and submit a Plutus V2/V3 increment transaction
   * 
   * Supports both Plutus V2 and V3 scripts. The script version is auto-detected:
   * - V3 is tried first (Aiken v1.1.x uses V3 4-arg spend signature)
   * - Falls back to V2 if V3 parsing fails
   * 
   * The appropriate cost model (PlutusV2 or PlutusV3) is automatically selected
   * based on the detected script version.
   * 
   * @param {string} gameObjectName - Unity GameObject for SendMessage callback
   * @param {string} successCallback - Success callback method name
   * @param {string} errorCallback - Error callback method name
   * @param {string} scriptAddress - Bech32 script address
   * @param {string} blockfrostKey - Blockfrost API key (preprod)
   * @param {string} validatorCborHex - Plutus V2/V3 script CBOR hex
   */
  async function IncrementCounterCSL(
    gameObjectName,
    successCallback,
    errorCallback,
    scriptAddress,
    blockfrostKey,
    validatorCborHex
  ) {
    try {
      const CSL = window.CSL;
      const walletApi = window.__walletApi;

      if (!CSL) throw new Error('CSL not loaded. Ensure csl.bundle.js is loaded.');
      if (!walletApi) throw new Error('Wallet not connected. Connect via CIP-30 first.');

      console.log('[IncrementCSL] Starting...');
      console.log('[IncrementCSL] Script address:', scriptAddress);

      // ========================================
      // 1. Fetch script UTxO with datum
      // ========================================
      console.log('[IncrementCSL] Fetching script UTxOs...');
      const scriptUtxos = await getScriptUtxos(scriptAddress, blockfrostKey);
      
      if (!scriptUtxos || scriptUtxos.length === 0) {
        throw new Error('No UTxOs at script address');
      }

      // Log all UTxOs at script address for debugging
      console.log('[IncrementCSL] Found', scriptUtxos.length, 'UTxOs at script address:');
      scriptUtxos.forEach((u, i) => {
        console.log(`  [${i}] ${u.tx_hash}#${u.tx_index} datum: ${u.inline_datum || 'none'}`);
      });

      // Find UTxO with inline datum (plain Int format for V3 validator)
      // V3 validator uses plain CBOR integer: 00, 01, 02, 1818, etc.
      const scriptUtxo = scriptUtxos.find(u => u.inline_datum);
      if (!scriptUtxo) {
        throw new Error('No UTxO with inline datum found at script address');
      }

      console.log('[IncrementCSL] ✅ Selected UTxO:', scriptUtxo.tx_hash, '#', scriptUtxo.tx_index);
      console.log('[IncrementCSL] Inline datum:', scriptUtxo.inline_datum);

      // Decode current value
      const currentValue = decodeDatumInteger(scriptUtxo.inline_datum);
      const newValue = currentValue + 1n;
      console.log('[IncrementCSL] Current:', currentValue.toString(), '-> New:', newValue.toString());

      // Get lovelace amount at script
      const scriptLovelace = scriptUtxo.amount.find(a => a.unit === 'lovelace')?.quantity || '0';

      // ========================================
      // 2. Get wallet UTxOs and collateral
      // ========================================
      console.log('[IncrementCSL] Getting wallet UTxOs...');
      const walletUtxosHex = await walletApi.getUtxos();
      const changeAddressHex = await walletApi.getChangeAddress();
      
      let collateralHex;
      try {
        collateralHex = await walletApi.getCollateral();
      } catch (e) {
        throw new Error('Collateral not set. Configure collateral in wallet settings.');
      }
      
      if (!collateralHex || collateralHex.length === 0) {
        throw new Error('No collateral available');
      }

      console.log('[IncrementCSL] Wallet UTxOs:', walletUtxosHex.length);
      console.log('[IncrementCSL] Collateral UTxOs:', collateralHex.length);

      // ========================================
      // 3. Get protocol parameters
      // ========================================
      console.log('[IncrementCSL] Fetching protocol parameters...');
      const pp = await getProtocolParameters(blockfrostKey);

      // ========================================
      // 4. Build transaction with CSL
      // ========================================
      console.log('[IncrementCSL] Building transaction...');
      console.log('[IncrementCSL] Era: Conway (ShelleyBasedEraConway)');
      console.log('[IncrementCSL] Script type: Plutus V2');

      // Parse addresses
      const scriptAddr = CSL.Address.from_bech32(scriptAddress);
      const changeAddr = CSL.Address.from_bytes(hexToBytes(changeAddressHex));

      // Build TransactionBuilder config using helper (logs all params)
      const txBuilderConfig = buildTxBuilderConfigFromBlockfrost(pp, CSL);
      const txBuilder = CSL.TransactionBuilder.new(txBuilderConfig);

      // Add script input
      const scriptInputTxHash = CSL.TransactionHash.from_bytes(hexToBytes(scriptUtxo.tx_hash));
      const scriptInput = CSL.TransactionInput.new(
        scriptInputTxHash,
        CSL.BigNum.from_str(scriptUtxo.tx_index.toString())
      );

      // Create PlutusData for new datum
      const newDatumCbor = encodeDatumInteger(newValue);
      const newDatum = CSL.PlutusData.from_bytes(hexToBytes(newDatumCbor));

      // Create redeemer data (placeholder ExUnits - will be updated after evaluation)
      const redeemerCbor = buildIncrementRedeemerCbor();
      const redeemerData = CSL.PlutusData.from_bytes(hexToBytes(redeemerCbor));
      
      // Placeholder ExUnits (will be replaced after tx evaluation)
      // Use generous defaults for simple counter script - these should be enough
      // Memory: 1,000,000 units, Steps: 500,000,000 units
      const placeholderExUnits = CSL.ExUnits.new(
        CSL.BigNum.from_str('1000000'),      // mem (generous for simple script)
        CSL.BigNum.from_str('500000000')     // steps (generous for simple script)
      );
      console.log('[IncrementCSL] Placeholder ExUnits: mem=1000000, steps=500000000');

      // NOTE: Redeemer index will be computed AFTER all inputs are added
      // The index must match the position of the script input in the SORTED list of all inputs
      // Cardano sorts inputs lexicographically by (tx_hash, output_index)

      // Parse Plutus script
      // IMPORTANT: Handle different CBOR encoding formats:
      // - Aiken's plutus.json "compiledCode" is CBOR-wrapped bytes
      // - cardano-cli script files may be double-CBOR-wrapped
      // - CSL expects raw script bytes for PlutusScript.from_bytes()
      
      const expectedScriptHash = getScriptHashFromAddress(CSL, scriptAddr);
      console.log('[IncrementCSL] Expected script hash (from address):', expectedScriptHash.to_hex());
      
      let plutusScript;
      let scriptLanguage = 'V2'; // Default
      let scriptHashMatched = false;
      
      // Try multiple parsing strategies to find the correct one
      const parseStrategies = [];
      
      // Strategy 1: Raw bytes (no unwrapping)
      parseStrategies.push({
        name: 'raw',
        bytes: hexToBytes(validatorCborHex)
      });
      
      // Strategy 2: Normalize (unwrap CBOR if needed)
      const normalized = normalizeValidatorBytes(validatorCborHex);
      if (normalized.info !== 'not wrapped') {
        parseStrategies.push({
          name: `normalized (${normalized.info})`,
          bytes: normalized.bytes
        });
      }
      
      // Strategy 3: If starts with 0x82, try parsing as envelope [version, bytes]
      const rawBytes = hexToBytes(validatorCborHex);
      if (rawBytes[0] === 0x82) {
        // Try to extract bytes from [version, bytes] envelope
        // 0x82 = array of 2, then version (0x01/0x02/0x03), then bytes (0x58/0x59...)
        if (rawBytes.length > 3 && (rawBytes[1] === 0x01 || rawBytes[1] === 0x02 || rawBytes[1] === 0x03)) {
          const version = rawBytes[1];
          const innerResult = unwrapCborBytes(rawBytes.slice(2));
          if (innerResult.wasWrapped) {
            parseStrategies.push({
              name: `envelope V${version} -> ${innerResult.info}`,
              bytes: innerResult.unwrapped,
              version: version
            });
          }
        }
      }
      
      console.log('[IncrementCSL] Trying', parseStrategies.length, 'parsing strategies...');
      
      // Log available CSL PlutusScript methods
      console.log('[IncrementCSL] CSL PlutusScript methods:', {
        from_bytes_with_version: typeof CSL.PlutusScript.from_bytes_with_version,
        from_v3: typeof CSL.PlutusScript.from_v3,
        from_v2: typeof CSL.PlutusScript.from_v2,
        new_v2: typeof CSL.PlutusScript.new_v2,
        new_v1: typeof CSL.PlutusScript.new_v1,
        from_bytes: typeof CSL.PlutusScript.from_bytes
      });
      console.log('[IncrementCSL] CSL Language methods:', {
        new_plutus_v3: typeof CSL.Language?.new_plutus_v3,
        new_plutus_v2: typeof CSL.Language?.new_plutus_v2,
        new_plutus_v1: typeof CSL.Language?.new_plutus_v1
      });
      
      for (const strategy of parseStrategies) {
        try {
          console.log('[IncrementCSL] Trying strategy:', strategy.name, 
            '- bytes length:', strategy.bytes.length,
            '- first 8 bytes:', bytesToHex(strategy.bytes.slice(0, 8)));
          
          let testScript;
          let parseMethod = 'unknown';
          
          // ============================================================
          // PRIORITY: Try V3 FIRST - Aiken v1.1.x uses V3 4-arg spend signature
          // The validator uses (datum, redeemer, own_ref, tx) which is V3 pattern
          // ============================================================
          
          // BEST METHOD for V3: PlutusScript.new_v3() with raw flat bytes
          if (!testScript && typeof CSL.PlutusScript.new_v3 === 'function') {
            try {
              testScript = CSL.PlutusScript.new_v3(strategy.bytes);
              scriptLanguage = 'V3';
              parseMethod = 'new_v3';
              console.log('[IncrementCSL] ✅ Parsed with new_v3, hash:', testScript.hash().to_hex());
            } catch (e) {
              console.log('[IncrementCSL] new_v3 failed:', e.message);
            }
          }
          
          // Also try new_v3 with CBOR-unwrapped bytes
          if (!testScript && strategy.name === 'raw' && typeof CSL.PlutusScript.new_v3 === 'function') {
            const unwrapped = normalizeValidatorBytes(bytesToHex(strategy.bytes));
            if (unwrapped.info !== 'not wrapped') {
              try {
                testScript = CSL.PlutusScript.new_v3(unwrapped.bytes);
                scriptLanguage = 'V3';
                parseMethod = 'new_v3 (unwrapped)';
                console.log('[IncrementCSL] ✅ Parsed with new_v3 (unwrapped), hash:', testScript.hash().to_hex());
              } catch (e) {
                console.log('[IncrementCSL] new_v3 (unwrapped) failed:', e.message);
              }
            }
          }
          
          // Try from_bytes_with_version with V3
          if (!testScript && typeof CSL.PlutusScript.from_bytes_with_version === 'function') {
            if (typeof CSL.Language?.new_plutus_v3 === 'function') {
              try {
                const langV3 = CSL.Language.new_plutus_v3();
                testScript = CSL.PlutusScript.from_bytes_with_version(strategy.bytes, langV3);
                scriptLanguage = 'V3';
                parseMethod = 'from_bytes_with_version(V3)';
                console.log('[IncrementCSL] ✅ Parsed with from_bytes_with_version + Language.new_plutus_v3');
              } catch (e) {
                console.log('[IncrementCSL] from_bytes_with_version(V3) failed:', e.message);
              }
            }
          }
          
          // ============================================================
          // FALLBACK: Try V2 if V3 didn't work
          // ============================================================
          
          if (!testScript && typeof CSL.PlutusScript.new_v2 === 'function') {
            try {
              testScript = CSL.PlutusScript.new_v2(strategy.bytes);
              scriptLanguage = 'V2';
              parseMethod = 'new_v2';
              console.log('[IncrementCSL] Parsed with new_v2, hash:', testScript.hash().to_hex());
            } catch (e) {
              console.log('[IncrementCSL] new_v2 failed:', e.message);
            }
          }
          
          // Also try new_v2 with the CBOR-unwrapped bytes if this is the raw strategy
          if (!testScript && strategy.name === 'raw' && typeof CSL.PlutusScript.new_v2 === 'function') {
            const unwrapped = normalizeValidatorBytes(bytesToHex(strategy.bytes));
            if (unwrapped.info !== 'not wrapped') {
              try {
                testScript = CSL.PlutusScript.new_v2(unwrapped.bytes);
                scriptLanguage = 'V2';
                parseMethod = 'new_v2 (unwrapped)';
                console.log('[IncrementCSL] Parsed with new_v2 (unwrapped), hash:', testScript.hash().to_hex());
              } catch (e) {
                console.log('[IncrementCSL] new_v2 (unwrapped) failed:', e.message);
              }
            }
          }
          
          // Try from_bytes_with_version with V2
          if (!testScript && typeof CSL.PlutusScript.from_bytes_with_version === 'function') {
            if (typeof CSL.Language?.new_plutus_v2 === 'function') {
              try {
                const langV2 = CSL.Language.new_plutus_v2();
                testScript = CSL.PlutusScript.from_bytes_with_version(strategy.bytes, langV2);
                scriptLanguage = 'V2';
                parseMethod = 'from_bytes_with_version(V2)';
                console.log('[IncrementCSL] Parsed with from_bytes_with_version + Language.new_plutus_v2');
              } catch (e) {
                console.log('[IncrementCSL] from_bytes_with_version(V2) failed:', e.message);
              }
            }
          }
          
          // Fallback: Try from_v3 if available
          if (!testScript && typeof CSL.PlutusScript.from_v3 === 'function') {
            try {
              testScript = CSL.PlutusScript.from_v3(strategy.bytes);
              scriptLanguage = 'V3';
              parseMethod = 'from_v3';
              console.log('[IncrementCSL] Parsed with from_v3');
            } catch (e) {
              console.log('[IncrementCSL] from_v3 failed:', e.message);
            }
          }
          
          // Fallback: Try from_v2 if available
          if (!testScript && typeof CSL.PlutusScript.from_v2 === 'function') {
            try {
              testScript = CSL.PlutusScript.from_v2(strategy.bytes);
              scriptLanguage = 'V2';
              parseMethod = 'from_v2';
              console.log('[IncrementCSL] Parsed with from_v2');
            } catch (e) {
              console.log('[IncrementCSL] from_v2 failed:', e.message);
            }
          }
          
          // Last resort: generic from_bytes
          if (!testScript) {
            testScript = CSL.PlutusScript.from_bytes(strategy.bytes);
            scriptLanguage = 'V2';
            parseMethod = 'from_bytes (generic)';
            console.log('[IncrementCSL] Parsed with from_bytes (generic)');
          }
          
          const computedHash = testScript.hash();
          console.log('[IncrementCSL] Strategy', strategy.name, '(', parseMethod, ') -> hash:', computedHash.to_hex());
          
          if (computedHash.to_hex() === expectedScriptHash.to_hex()) {
            console.log('[IncrementCSL] ✓ MATCH! Using strategy:', strategy.name);
            plutusScript = testScript;
            scriptHashMatched = true;
            break;
          }
        } catch (parseErr) {
          console.log('[IncrementCSL] Strategy', strategy.name, 'failed:', parseErr.message);
        }
      }
      
      // If no strategy matched, the validator bytes are WRONG - HARD FAIL
      if (!scriptHashMatched) {
        console.error('[IncrementCSL] ═══════════════════════════════════════════════════════════════');
        console.error('[IncrementCSL] ❌ FATAL: SCRIPT HASH MISMATCH - WRONG VALIDATOR BYTES!');
        console.error('[IncrementCSL] ═══════════════════════════════════════════════════════════════');
        console.error('[IncrementCSL] Target script address:', scriptAddress);
        console.error('[IncrementCSL] Expected hash (from address):', expectedScriptHash.to_hex());
        console.error('[IncrementCSL]');
        
        // Compute what address the current validator WOULD produce
        let validatorHash = 'unknown';
        let validatorAddr = 'unknown';
        try {
          let testScript;
          if (typeof CSL.PlutusScript.from_v2 === 'function') {
            testScript = CSL.PlutusScript.from_v2(hexToBytes(validatorCborHex));
          } else {
            testScript = CSL.PlutusScript.from_bytes(hexToBytes(validatorCborHex));
          }
          validatorHash = testScript.hash().to_hex();
          
          // Compute the address this validator WOULD have
          const testCred = CSL.StakeCredential.from_scripthash(testScript.hash());
          const testAddr = CSL.EnterpriseAddress.new(0, testCred); // 0 = testnet
          validatorAddr = testAddr.to_address().to_bech32();
        } catch (e) {
          console.error('[IncrementCSL] Could not compute validator info:', e.message);
        }
        
        console.error('[IncrementCSL] Your validatorCborHex produces:');
        console.error('[IncrementCSL]   - Hash:', validatorHash);
        console.error('[IncrementCSL]   - Address (testnet):', validatorAddr);
        console.error('[IncrementCSL]');
        console.error('[IncrementCSL] ═══════════════════════════════════════════════════════════════');
        console.error('[IncrementCSL] TO FIX: Choose ONE of these options:');
        console.error('[IncrementCSL] ═══════════════════════════════════════════════════════════════');
        console.error('[IncrementCSL]');
        console.error('[IncrementCSL] OPTION 1: Get correct validator for target address');
        console.error('[IncrementCSL]   Find the Aiken project that deployed to:', scriptAddress);
        console.error('[IncrementCSL]   In plutus.json, find the validator with hash:', expectedScriptHash.to_hex());
        console.error('[IncrementCSL]   Use its "compiledCode" field as validatorCborHex');
        console.error('[IncrementCSL]');
        console.error('[IncrementCSL] OPTION 2: Use the address matching your current validator');
        console.error('[IncrementCSL]   Change scriptAddress to:', validatorAddr);
        console.error('[IncrementCSL]   (Make sure a UTxO exists at this address first!)');
        console.error('[IncrementCSL]');
        console.error('[IncrementCSL] ═══════════════════════════════════════════════════════════════');
        console.error('[IncrementCSL] ABORTING - Will not build invalid transaction');
        console.error('[IncrementCSL] ═══════════════════════════════════════════════════════════════');
        
        throw new Error(
          `Script hash mismatch! ` +
          `Target address expects hash ${expectedScriptHash.to_hex()}, ` +
          `but validatorCborHex produces hash ${validatorHash}. ` +
          `Either use the correct validator CBOR for ${scriptAddress}, ` +
          `or change scriptAddress to ${validatorAddr}.`
        );
      }
      
      console.log('[IncrementCSL] Final script language:', scriptLanguage);

      // Add script input to builder using PlutusWitness
      // CSL 12.x uses add_plutus_script_input(witness, input, amount)
      // Create a placeholder redeemer with index 0 - CSL will handle the correct index
      const placeholderRedeemer = CSL.Redeemer.new(
        CSL.RedeemerTag.new_spend(),
        CSL.BigNum.from_str('0'), // placeholder index
        redeemerData,
        placeholderExUnits
      );
      
      const plutusWitness = CSL.PlutusWitness.new(
        plutusScript,
        CSL.PlutusData.from_bytes(hexToBytes(scriptUtxo.inline_datum)), // datum
        placeholderRedeemer
      );
      
      txBuilder.add_plutus_script_input(
        plutusWitness,
        scriptInput,
        CSL.Value.new(CSL.BigNum.from_str(scriptLovelace))
      );

      // Add output back to script with new inline datum
      const outputBuilder = CSL.TransactionOutputBuilder.new()
        .with_address(scriptAddr)
        .with_plutus_data(newDatum);
      
      const scriptOutput = outputBuilder
        .next()
        .with_value(CSL.Value.new(CSL.BigNum.from_str(scriptLovelace)))
        .build();
      
      txBuilder.add_output(scriptOutput);

      // Collect all inputs to determine redeemer index
      // Cardano sorts inputs lexicographically by (tx_hash, output_index)
      const allInputs = [];
      
      // Script input
      allInputs.push({
        txHash: scriptUtxo.tx_hash,
        index: scriptUtxo.tx_index,
        isScript: true
      });
      
      // Add wallet inputs for fees
      for (const utxoHex of walletUtxosHex) {
        const utxo = CSL.TransactionUnspentOutput.from_bytes(hexToBytes(utxoHex));
        const input = utxo.input();
        allInputs.push({
          txHash: input.transaction_id().to_hex(),
          index: parseInt(getInputIndex(input)),
          isScript: false
        });
        // CSL 12.x: use add_regular_input for non-script inputs
        if (typeof txBuilder.add_regular_input === 'function') {
          txBuilder.add_regular_input(
            utxo.output().address(),
            utxo.input(),
            utxo.output().amount()
          );
        } else {
          txBuilder.add_input(
            utxo.output().address(),
            utxo.input(),
            utxo.output().amount()
          );
        }
      }
      
      // Sort inputs lexicographically (same as Cardano ledger)
      allInputs.sort((a, b) => {
        const hashCmp = a.txHash.localeCompare(b.txHash);
        if (hashCmp !== 0) return hashCmp;
        return a.index - b.index;
      });
      
      // Find the index of the script input in the sorted list
      const scriptInputIndex = allInputs.findIndex(inp => inp.isScript);
      console.log('[IncrementCSL] Script input index in sorted inputs:', scriptInputIndex);
      console.log('[IncrementCSL] All inputs (sorted):', allInputs.map(i => `${i.txHash.substring(0,8)}...#${i.index}${i.isScript ? ' (SCRIPT)' : ''}`));
      
      // NOW create the redeemer with the correct index
      const redeemer = CSL.Redeemer.new(
        CSL.RedeemerTag.new_spend(),
        CSL.BigNum.from_str(scriptInputIndex.toString()),
        redeemerData,
        placeholderExUnits
      );
      console.log('[IncrementCSL] Redeemer created with index:', scriptInputIndex);

      // ========================================
      // Set collateral using TxInputsBuilder
      // CIP-30 getCollateral() returns CBOR hex TransactionUnspentOutput[]
      // CSL TransactionBuilder.set_collateral() expects TxInputsBuilder
      // ========================================
      console.log('[IncrementCSL] Setting collateral, UTxOs:', collateralHex.length);
      
      let totalCollateralLovelace = 0n;
      
      // Check which CSL collateral API is available
      if (typeof CSL.TxInputsBuilder !== 'undefined' && typeof CSL.TxInputsBuilder.new === 'function') {
        // CSL 11.x+ uses TxInputsBuilder
        console.log('[IncrementCSL] Using TxInputsBuilder for collateral');
        const colBuilder = CSL.TxInputsBuilder.new();
        
        for (const colHex of collateralHex) {
          const tu = CSL.TransactionUnspentOutput.from_bytes(hexToBytes(colHex));
          const input = tu.input();
          const output = tu.output();
          const addr = output.address();
          const val = output.amount();
          const coin = val.coin();
          
          console.log('[IncrementCSL] Collateral UTxO:', 
            input.transaction_id().to_hex().substring(0, 16) + '...#' + getInputIndex(input),
            'lovelace:', coin.to_str()
          );
          
          totalCollateralLovelace += BigInt(coin.to_str());
          // CSL 12.x: TxInputsBuilder uses add_regular_input, not add_input
          if (typeof colBuilder.add_regular_input === 'function') {
            colBuilder.add_regular_input(addr, input, val);
          } else if (typeof colBuilder.add_input === 'function') {
            colBuilder.add_input(addr, input, val);
          } else {
            throw new Error('No compatible add_input method on TxInputsBuilder');
          }
        }
        
        console.log('[IncrementCSL] colBuilder type:', colBuilder.constructor?.name || typeof colBuilder);
        txBuilder.set_collateral(colBuilder);
        
      } else {
        // Fallback for older CSL versions that use TransactionInputs directly
        // or have a different API
        console.log('[IncrementCSL] TxInputsBuilder not found, trying fallback methods');
        
        const collateralInputs = CSL.TransactionInputs.new();
        for (const colHex of collateralHex) {
          const tu = CSL.TransactionUnspentOutput.from_bytes(hexToBytes(colHex));
          const coin = tu.output().amount().coin();
          totalCollateralLovelace += BigInt(coin.to_str());
          collateralInputs.add(tu.input());
          
          console.log('[IncrementCSL] Collateral UTxO (fallback):', 
            tu.input().transaction_id().to_hex().substring(0, 16) + '...#' + getInputIndex(tu.input())
          );
        }
        
        // Try different setter methods depending on CSL version
        if (typeof txBuilder.set_collateral_inputs === 'function') {
          txBuilder.set_collateral_inputs(collateralInputs);
        } else if (typeof txBuilder.add_collateral === 'function') {
          // Some versions have add_collateral for individual inputs
          for (const colHex of collateralHex) {
            const tu = CSL.TransactionUnspentOutput.from_bytes(hexToBytes(colHex));
            txBuilder.add_collateral(tu.output().address(), tu.input(), tu.output().amount());
          }
        } else {
          throw new Error('No compatible collateral setter found in this CSL version');
        }
      }
      
      // NOTE: We'll set total_collateral and collateral_return AFTER calculating the fee
      // The total_collateral must be >= fee * collateral_percentage / 100
      // We store the collateral info for later use
      const collateralInfo = {
        totalLovelace: totalCollateralLovelace,
        changeAddr: changeAddr
      };
      console.log('[IncrementCSL] Collateral UTxO total:', totalCollateralLovelace.toString(), 'lovelace');
      
      console.log('[IncrementCSL] Collateral configured successfully');

      // ========================================
      // Fetch current tip slot from Blockfrost for accurate TTL
      // ========================================
      console.log('[IncrementCSL] Fetching latest block for TTL...');
      const latestBlock = await getLatestBlock(blockfrostKey);
      const tipSlot = latestBlock.slot;
      console.log('[IncrementCSL] Chain tip slot:', tipSlot);
      
      // Set TTL (tip slot + 600 slots = ~10 minutes)
      const ttlSlot = tipSlot + 600;
      console.log('[IncrementCSL] Setting TTL to slot:', ttlSlot);
      
      // CSL has two TTL methods:
      // - set_ttl(number) - takes plain number
      // - set_ttl_bignum(BigNum) - takes BigNum
      // Use set_ttl_bignum if available, otherwise set_ttl with number
      if (typeof txBuilder.set_ttl_bignum === 'function') {
        const ttlBigNum = CSL.BigNum.from_str(ttlSlot.toString());
        txBuilder.set_ttl_bignum(ttlBigNum);
        console.log('[IncrementCSL] TTL set via set_ttl_bignum:', ttlBigNum.to_str());
      } else {
        // Fallback: set_ttl expects a number, not BigNum
        txBuilder.set_ttl(ttlSlot);
        console.log('[IncrementCSL] TTL set via set_ttl(number):', ttlSlot);
      }
      
      // Store TTL for later use in case we need to rebuild
      const savedTtlSlot = ttlSlot;

      // Add change output
      txBuilder.add_change_if_needed(changeAddr);

      // CRITICAL: Calculate script_data_hash for Plutus transactions
      // This requires cost models from protocol parameters
      // Conway era: Only include the cost model for the language version being used
      let costModels = null;
      
      // Canonical PlutusV2 cost model parameter names in the EXACT order required by the ledger
      // This is the Conway-era order (175 parameters for PlutusV2)
      const PLUTUS_V2_COST_MODEL_KEYS = [
        "addInteger-cpu-arguments-intercept",
        "addInteger-cpu-arguments-slope",
        "addInteger-memory-arguments-intercept",
        "addInteger-memory-arguments-slope",
        "appendByteString-cpu-arguments-intercept",
        "appendByteString-cpu-arguments-slope",
        "appendByteString-memory-arguments-intercept",
        "appendByteString-memory-arguments-slope",
        "appendString-cpu-arguments-intercept",
        "appendString-cpu-arguments-slope",
        "appendString-memory-arguments-intercept",
        "appendString-memory-arguments-slope",
        "bData-cpu-arguments",
        "bData-memory-arguments",
        "blake2b_256-cpu-arguments-intercept",
        "blake2b_256-cpu-arguments-slope",
        "blake2b_256-memory-arguments",
        "cekApplyCost-exBudgetCPU",
        "cekApplyCost-exBudgetMemory",
        "cekBuiltinCost-exBudgetCPU",
        "cekBuiltinCost-exBudgetMemory",
        "cekConstCost-exBudgetCPU",
        "cekConstCost-exBudgetMemory",
        "cekDelayCost-exBudgetCPU",
        "cekDelayCost-exBudgetMemory",
        "cekForceCost-exBudgetCPU",
        "cekForceCost-exBudgetMemory",
        "cekLamCost-exBudgetCPU",
        "cekLamCost-exBudgetMemory",
        "cekStartupCost-exBudgetCPU",
        "cekStartupCost-exBudgetMemory",
        "cekVarCost-exBudgetCPU",
        "cekVarCost-exBudgetMemory",
        "chooseData-cpu-arguments",
        "chooseData-memory-arguments",
        "chooseList-cpu-arguments",
        "chooseList-memory-arguments",
        "chooseUnit-cpu-arguments",
        "chooseUnit-memory-arguments",
        "consByteString-cpu-arguments-intercept",
        "consByteString-cpu-arguments-slope",
        "consByteString-memory-arguments-intercept",
        "consByteString-memory-arguments-slope",
        "constrData-cpu-arguments",
        "constrData-memory-arguments",
        "decodeUtf8-cpu-arguments-intercept",
        "decodeUtf8-cpu-arguments-slope",
        "decodeUtf8-memory-arguments-intercept",
        "decodeUtf8-memory-arguments-slope",
        "divideInteger-cpu-arguments-constant",
        "divideInteger-cpu-arguments-model-arguments-intercept",
        "divideInteger-cpu-arguments-model-arguments-slope",
        "divideInteger-memory-arguments-intercept",
        "divideInteger-memory-arguments-minimum",
        "divideInteger-memory-arguments-slope",
        "encodeUtf8-cpu-arguments-intercept",
        "encodeUtf8-cpu-arguments-slope",
        "encodeUtf8-memory-arguments-intercept",
        "encodeUtf8-memory-arguments-slope",
        "equalsByteString-cpu-arguments-constant",
        "equalsByteString-cpu-arguments-intercept",
        "equalsByteString-cpu-arguments-slope",
        "equalsByteString-memory-arguments",
        "equalsData-cpu-arguments-intercept",
        "equalsData-cpu-arguments-slope",
        "equalsData-memory-arguments",
        "equalsInteger-cpu-arguments-intercept",
        "equalsInteger-cpu-arguments-slope",
        "equalsInteger-memory-arguments",
        "equalsString-cpu-arguments-constant",
        "equalsString-cpu-arguments-intercept",
        "equalsString-cpu-arguments-slope",
        "equalsString-memory-arguments",
        "fstPair-cpu-arguments",
        "fstPair-memory-arguments",
        "headList-cpu-arguments",
        "headList-memory-arguments",
        "iData-cpu-arguments",
        "iData-memory-arguments",
        "ifThenElse-cpu-arguments",
        "ifThenElse-memory-arguments",
        "indexByteString-cpu-arguments",
        "indexByteString-memory-arguments",
        "lengthOfByteString-cpu-arguments",
        "lengthOfByteString-memory-arguments",
        "lessThanByteString-cpu-arguments-intercept",
        "lessThanByteString-cpu-arguments-slope",
        "lessThanByteString-memory-arguments",
        "lessThanEqualsByteString-cpu-arguments-intercept",
        "lessThanEqualsByteString-cpu-arguments-slope",
        "lessThanEqualsByteString-memory-arguments",
        "lessThanEqualsInteger-cpu-arguments-intercept",
        "lessThanEqualsInteger-cpu-arguments-slope",
        "lessThanEqualsInteger-memory-arguments",
        "lessThanInteger-cpu-arguments-intercept",
        "lessThanInteger-cpu-arguments-slope",
        "lessThanInteger-memory-arguments",
        "listData-cpu-arguments",
        "listData-memory-arguments",
        "mapData-cpu-arguments",
        "mapData-memory-arguments",
        "mkCons-cpu-arguments",
        "mkCons-memory-arguments",
        "mkNilData-cpu-arguments",
        "mkNilData-memory-arguments",
        "mkNilPairData-cpu-arguments",
        "mkNilPairData-memory-arguments",
        "mkPairData-cpu-arguments",
        "mkPairData-memory-arguments",
        "modInteger-cpu-arguments-constant",
        "modInteger-cpu-arguments-model-arguments-intercept",
        "modInteger-cpu-arguments-model-arguments-slope",
        "modInteger-memory-arguments-intercept",
        "modInteger-memory-arguments-minimum",
        "modInteger-memory-arguments-slope",
        "multiplyInteger-cpu-arguments-intercept",
        "multiplyInteger-cpu-arguments-slope",
        "multiplyInteger-memory-arguments-intercept",
        "multiplyInteger-memory-arguments-slope",
        "nullList-cpu-arguments",
        "nullList-memory-arguments",
        "quotientInteger-cpu-arguments-constant",
        "quotientInteger-cpu-arguments-model-arguments-intercept",
        "quotientInteger-cpu-arguments-model-arguments-slope",
        "quotientInteger-memory-arguments-intercept",
        "quotientInteger-memory-arguments-minimum",
        "quotientInteger-memory-arguments-slope",
        "remainderInteger-cpu-arguments-constant",
        "remainderInteger-cpu-arguments-model-arguments-intercept",
        "remainderInteger-cpu-arguments-model-arguments-slope",
        "remainderInteger-memory-arguments-intercept",
        "remainderInteger-memory-arguments-minimum",
        "remainderInteger-memory-arguments-slope",
        "serialiseData-cpu-arguments-intercept",
        "serialiseData-cpu-arguments-slope",
        "serialiseData-memory-arguments-intercept",
        "serialiseData-memory-arguments-slope",
        "sha2_256-cpu-arguments-intercept",
        "sha2_256-cpu-arguments-slope",
        "sha2_256-memory-arguments",
        "sha3_256-cpu-arguments-intercept",
        "sha3_256-cpu-arguments-slope",
        "sha3_256-memory-arguments",
        "sliceByteString-cpu-arguments-intercept",
        "sliceByteString-cpu-arguments-slope",
        "sliceByteString-memory-arguments-intercept",
        "sliceByteString-memory-arguments-slope",
        "sndPair-cpu-arguments",
        "sndPair-memory-arguments",
        "subtractInteger-cpu-arguments-intercept",
        "subtractInteger-cpu-arguments-slope",
        "subtractInteger-memory-arguments-intercept",
        "subtractInteger-memory-arguments-slope",
        "tailList-cpu-arguments",
        "tailList-memory-arguments",
        "trace-cpu-arguments",
        "trace-memory-arguments",
        "unBData-cpu-arguments",
        "unBData-memory-arguments",
        "unConstrData-cpu-arguments",
        "unConstrData-memory-arguments",
        "unIData-cpu-arguments",
        "unIData-memory-arguments",
        "unListData-cpu-arguments",
        "unListData-memory-arguments",
        "unMapData-cpu-arguments",
        "unMapData-memory-arguments",
        "verifyEcdsaSecp256k1Signature-cpu-arguments",
        "verifyEcdsaSecp256k1Signature-memory-arguments",
        "verifyEd25519Signature-cpu-arguments-intercept",
        "verifyEd25519Signature-cpu-arguments-slope",
        "verifyEd25519Signature-memory-arguments",
        "verifySchnorrSecp256k1Signature-cpu-arguments-intercept",
        "verifySchnorrSecp256k1Signature-cpu-arguments-slope",
        "verifySchnorrSecp256k1Signature-memory-arguments"
      ];
      
      // ============================================================
      // Manual script_data_hash computation for Conway era
      // CSL 12.x hash_script_data is broken for PlutusV3 cost models
      // Per Alonzo CDDL spec: hash = blake2b_256(redeemers || language_views || datums)
      // For PlutusV2/V3: language_views = canonical CBOR map {lang_id: [cost_model_values]}
      // ============================================================

      // ============================================================
      // INLINE BLAKE2b-256 (ported from blakejs by DC - https://github.com/dcposch/blakejs)
      // Embedded here to avoid stale cached external blake2b.js
      // ============================================================
      var _b2b = (function() {
        function ADD64AA(v, a, b) {
          var o0 = v[a] + v[b];
          var o1 = v[a + 1] + v[b + 1];
          if (o0 >= 0x100000000) o1++;
          v[a] = o0;
          v[a + 1] = o1;
        }
        function ADD64AC(v, a, b0, b1) {
          var o0 = v[a] + b0;
          if (b0 < 0) o0 += 0x100000000;
          var o1 = v[a + 1] + b1;
          if (o0 >= 0x100000000) o1++;
          v[a] = o0;
          v[a + 1] = o1;
        }
        function B2B_GET32(arr, i) {
          return arr[i] ^ (arr[i + 1] << 8) ^ (arr[i + 2] << 16) ^ (arr[i + 3] << 24);
        }
        var BLAKE2B_IV32 = new Uint32Array([
          0xf3bcc908, 0x6a09e667, 0x84caa73b, 0xbb67ae85, 0xfe94f82b, 0x3c6ef372,
          0x5f1d36f1, 0xa54ff53a, 0xade682d1, 0x510e527f, 0x2b3e6c1f, 0x9b05688c,
          0xfb41bd6b, 0x1f83d9ab, 0x137e2179, 0x5be0cd19
        ]);
        var SIGMA8 = [
          0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,14,10,4,8,9,15,13,6,1,12,0,2,11,7,5,3,
          11,8,12,0,5,2,15,13,10,14,3,6,7,1,9,4,7,9,3,1,13,12,11,14,2,6,5,10,4,0,15,8,
          9,0,5,7,2,4,10,15,14,1,11,12,6,8,3,13,2,12,6,10,0,11,8,3,4,13,7,5,15,14,1,9,
          12,5,1,15,14,13,4,10,0,7,6,3,9,2,8,11,13,11,7,14,12,1,3,9,5,0,15,4,8,6,2,10,
          6,15,14,9,11,3,0,8,12,2,13,7,1,4,10,5,10,2,8,4,7,6,1,5,15,11,9,14,3,12,13,0,
          0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,14,10,4,8,9,15,13,6,1,12,0,2,11,7,5,3
        ];
        var SIGMA82 = new Uint8Array(SIGMA8.map(function(x) { return x * 2; }));
        var v = new Uint32Array(32);
        var m = new Uint32Array(32);
        function B2B_G(a, b, c, d, ix, iy) {
          var x0 = m[ix], x1 = m[ix + 1], y0 = m[iy], y1 = m[iy + 1];
          ADD64AA(v, a, b); ADD64AC(v, a, x0, x1);
          var xor0 = v[d] ^ v[a], xor1 = v[d + 1] ^ v[a + 1];
          v[d] = xor1; v[d + 1] = xor0;
          ADD64AA(v, c, d);
          xor0 = v[b] ^ v[c]; xor1 = v[b + 1] ^ v[c + 1];
          v[b] = (xor0 >>> 24) ^ (xor1 << 8); v[b + 1] = (xor1 >>> 24) ^ (xor0 << 8);
          ADD64AA(v, a, b); ADD64AC(v, a, y0, y1);
          xor0 = v[d] ^ v[a]; xor1 = v[d + 1] ^ v[a + 1];
          v[d] = (xor0 >>> 16) ^ (xor1 << 16); v[d + 1] = (xor1 >>> 16) ^ (xor0 << 16);
          ADD64AA(v, c, d);
          xor0 = v[b] ^ v[c]; xor1 = v[b + 1] ^ v[c + 1];
          v[b] = (xor1 >>> 31) ^ (xor0 << 1); v[b + 1] = (xor0 >>> 31) ^ (xor1 << 1);
        }
        function compress(ctx, last) {
          var i;
          for (i = 0; i < 16; i++) { v[i] = ctx.h[i]; v[i + 16] = BLAKE2B_IV32[i]; }
          v[24] = v[24] ^ ctx.t; v[25] = v[25] ^ (ctx.t / 0x100000000);
          if (last) { v[28] = ~v[28]; v[29] = ~v[29]; }
          for (i = 0; i < 32; i++) m[i] = B2B_GET32(ctx.b, 4 * i);
          for (i = 0; i < 12; i++) {
            B2B_G(0,8,16,24, SIGMA82[i*16+0], SIGMA82[i*16+1]);
            B2B_G(2,10,18,26, SIGMA82[i*16+2], SIGMA82[i*16+3]);
            B2B_G(4,12,20,28, SIGMA82[i*16+4], SIGMA82[i*16+5]);
            B2B_G(6,14,22,30, SIGMA82[i*16+6], SIGMA82[i*16+7]);
            B2B_G(0,10,20,30, SIGMA82[i*16+8], SIGMA82[i*16+9]);
            B2B_G(2,12,22,24, SIGMA82[i*16+10], SIGMA82[i*16+11]);
            B2B_G(4,14,16,26, SIGMA82[i*16+12], SIGMA82[i*16+13]);
            B2B_G(6,8,18,28, SIGMA82[i*16+14], SIGMA82[i*16+15]);
          }
          for (i = 0; i < 16; i++) ctx.h[i] = ctx.h[i] ^ v[i] ^ v[i + 16];
        }
        function init(outlen) {
          var ctx = { b: new Uint8Array(128), h: new Uint32Array(16), t: 0, c: 0, outlen: outlen };
          for (var i = 0; i < 16; i++) ctx.h[i] = BLAKE2B_IV32[i];
          ctx.h[0] ^= 0x01010000 ^ outlen;
          return ctx;
        }
        function update(ctx, input) {
          for (var i = 0; i < input.length; i++) {
            if (ctx.c === 128) { ctx.t += ctx.c; compress(ctx, false); ctx.c = 0; }
            ctx.b[ctx.c++] = input[i];
          }
        }
        function final(ctx) {
          ctx.t += ctx.c;
          while (ctx.c < 128) ctx.b[ctx.c++] = 0;
          compress(ctx, true);
          var out = new Uint8Array(ctx.outlen);
          for (var i = 0; i < ctx.outlen; i++) out[i] = ctx.h[i >> 2] >> (8 * (i & 3));
          return out;
        }
        function blake2b256(input) {
          var ctx = init(32); update(ctx, input); return final(ctx);
        }
        function bytesToHex(bytes) {
          var hex = '';
          for (var i = 0; i < bytes.length; i++) hex += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
          return hex;
        }
        return { hash: blake2b256, toHex: bytesToHex };
      })();
      // Override window globals to use inline version
      window.blake2b256 = _b2b.hash;
      window.blake2bBytesToHex = _b2b.toHex;
      console.log('[IncrementCSL] Using INLINE blake2b-256 (embedded in increment-counter-csl.js)');
      // ============================================================

      // Encode a single unsigned integer as canonical CBOR bytes
      function cborEncodeUint(n) {
        if (n < 0) return cborEncodeNint(-1 - n);
        if (n <= 23) return [n];
        if (n <= 0xFF) return [0x18, n];
        if (n <= 0xFFFF) return [0x19, (n >> 8) & 0xFF, n & 0xFF];
        if (n <= 0xFFFFFFFF) return [0x1A, (n >> 24) & 0xFF, (n >> 16) & 0xFF, (n >> 8) & 0xFF, n & 0xFF];
        // 64-bit
        var hi = Math.floor(n / 0x100000000);
        var lo = n >>> 0;
        return [0x1B,
          (hi >> 24) & 0xFF, (hi >> 16) & 0xFF, (hi >> 8) & 0xFF, hi & 0xFF,
          (lo >> 24) & 0xFF, (lo >> 16) & 0xFF, (lo >> 8) & 0xFF, lo & 0xFF];
      }
      
      // Encode a negative integer as canonical CBOR (major type 1)
      function cborEncodeNint(n) {
        // n is the absolute offset: CBOR nint encodes -(n+1), so we pass n = abs(value) - 1
        if (n <= 23) return [0x20 + n];
        if (n <= 0xFF) return [0x38, n];
        if (n <= 0xFFFF) return [0x39, (n >> 8) & 0xFF, n & 0xFF];
        if (n <= 0xFFFFFFFF) return [0x3A, (n >> 24) & 0xFF, (n >> 16) & 0xFF, (n >> 8) & 0xFF, n & 0xFF];
        var hi = Math.floor(n / 0x100000000);
        var lo = n >>> 0;
        return [0x3B,
          (hi >> 24) & 0xFF, (hi >> 16) & 0xFF, (hi >> 8) & 0xFF, hi & 0xFF,
          (lo >> 24) & 0xFF, (lo >> 16) & 0xFF, (lo >> 8) & 0xFF, lo & 0xFF];
      }
      
      // Encode an integer (positive or negative) as canonical CBOR
      function cborEncodeInt(n) {
        if (n >= 0) return cborEncodeUint(n);
        return cborEncodeNint(-1 - n);
      }
      
      // Encode a CBOR array header (definite length)
      function cborArrayHeader(len) {
        if (len <= 23) return [0x80 + len];
        if (len <= 0xFF) return [0x98, len];
        if (len <= 0xFFFF) return [0x99, (len >> 8) & 0xFF, len & 0xFF];
        return [0x9A, (len >> 24) & 0xFF, (len >> 16) & 0xFF, (len >> 8) & 0xFF, len & 0xFF];
      }
      
      // Encode a CBOR map header (definite length)
      function cborMapHeader(len) {
        if (len <= 23) return [0xA0 + len];
        if (len <= 0xFF) return [0xB8, len];
        if (len <= 0xFFFF) return [0xB9, (len >> 8) & 0xFF, len & 0xFF];
        return [0xBA, (len >> 24) & 0xFF, (len >> 16) & 0xFF, (len >> 8) & 0xFF, len & 0xFF];
      }
      
      // Build canonical CBOR language views encoding for V2/V3
      // Per Alonzo CDDL: language_views = { language_id => [cost_model_values] }
      // For V3: { 2: [v0, v1, v2, ...] } encoded canonically
      function buildLanguageViewsCbor(languageId, costModelArray) {
        var bytes = [];
        // Map with 1 entry
        bytes.push.apply(bytes, cborMapHeader(1));
        // Key: language id (uint)
        bytes.push.apply(bytes, cborEncodeUint(languageId));
        // Value: array of integers
        bytes.push.apply(bytes, cborArrayHeader(costModelArray.length));
        for (var i = 0; i < costModelArray.length; i++) {
          bytes.push.apply(bytes, cborEncodeInt(costModelArray[i]));
        }
        return new Uint8Array(bytes);
      }
      
      // Compute script_data_hash manually using blake2b-256
      // Preimage: redeemers_cbor || language_views_cbor || datums_cbor_or_empty
      function computeScriptDataHash(redeemers, languageId, costModelArray, datums) {
        // Self-test blake2b on first call: blake2b-256("abc") = bddd813c634239723171ef3fee98579b94964e3bb1cb3e427262c8c068d52319
        if (!computeScriptDataHash._tested) {
          var testInput = new Uint8Array([0x61, 0x62, 0x63]); // "abc"
          var testHash = _b2b.toHex(_b2b.hash(testInput));
          var expected = 'bddd813c634239723171ef3fee98579b94964e3bb1cb3e427262c8c068d52319';
          console.log('[IncrementCSL] blake2b-256 self-test: input="abc" hash=' + testHash + ' expected=' + expected + ' PASS=' + (testHash === expected));
          if (testHash !== expected) {
            throw new Error('blake2b-256 self-test FAILED! Got ' + testHash);
          }
          computeScriptDataHash._tested = true;
        }
        
        // Get redeemers CBOR from CSL
        var redeemerBytes = redeemers.to_bytes();
        
        // Build language views CBOR
        var langViewBytes = buildLanguageViewsCbor(languageId, costModelArray);
        
        // Per Alonzo CDDL spec:
        // Preimage is: redeemers || datums || language_views
        // If no datums, the datums part is omitted entirely
        
        var preimageLen = redeemerBytes.length + langViewBytes.length;
        var datumBytes = null;
        if (datums) {
          datumBytes = datums.to_bytes();
          preimageLen += datumBytes.length;
        }
        
        var preimage = new Uint8Array(preimageLen);
        var offset = 0;
        preimage.set(redeemerBytes, offset); offset += redeemerBytes.length;
        if (datumBytes) {
          preimage.set(datumBytes, offset); offset += datumBytes.length;
        }
        preimage.set(langViewBytes, offset);
        
        // Compute blake2b-256
        var hashBytes = _b2b.hash(preimage);
        var hashHex = _b2b.toHex(hashBytes);
        
        var redeemerHex = _b2b.toHex(redeemerBytes);
        var langViewHex = _b2b.toHex(langViewBytes);
        
        console.log('[IncrementCSL] Manual script_data_hash preimage size:', preimage.length);
        console.log('[IncrementCSL] Manual script_data_hash:', hashHex);
        console.log('[IncrementCSL] Redeemers CBOR hex (' + redeemerHex.length/2 + ' bytes):', redeemerHex);
        console.log('[IncrementCSL] Language views CBOR (first 80 hex chars):', langViewHex.substring(0, 80) + '...');
        console.log('[IncrementCSL] Language views CBOR length:', langViewHex.length/2, 'bytes');
        
        return CSL.ScriptDataHash.from_hex(hashHex);
      }
      
      // Store the raw cost model array for manual hash computation
      var v3CostModelArray = null;
      var v3LanguageId = 2; // PlutusV3 = language 2
      
      try {
        // DEBUG: Log CSL capabilities and Blockfrost response
        console.log('[IncrementCSL] CSL CostModel.from_json available:', typeof CSL.CostModel?.from_json);
        console.log('[IncrementCSL] CSL Costmdls.from_json available:', typeof CSL.Costmdls?.from_json);
        console.log('[IncrementCSL] Protocol params cost_models type:', typeof pp.cost_models);
        console.log('[IncrementCSL] Protocol params cost_models keys:', pp.cost_models ? Object.keys(pp.cost_models) : 'none');
        console.log('[IncrementCSL] Script language detected:', scriptLanguage);
        
        // Helper to create CSL Int from a number (handles large values and negatives)
        const toCSLInt = (val) => {
          const num = Number(val);
          if (num >= 0) {
            return CSL.Int.new(CSL.BigNum.from_str(Math.floor(num).toString()));
          } else {
            return CSL.Int.new_negative(CSL.BigNum.from_str(Math.floor(Math.abs(num)).toString()));
          }
        };
        
        // Helper: convert Blockfrost cost model (object or array) to a plain integer array
        const costModelToArray = (model, expectedKeys) => {
          const isArray = Array.isArray(model);
          if (isArray) return model.map(n => Number(n));
          
          const firstKey = typeof model === 'object' ? Object.keys(model)[0] : null;
          const isNumericKeys = firstKey && /^\d+$/.test(firstKey);
          
          if (isNumericKeys) {
            return Object.entries(model)
              .sort((a, b) => Number(a[0]) - Number(b[0]))
              .map(([, v]) => Number(v));
          }
          
          // Named keys - use expectedKeys if provided, otherwise preserve insertion order
          // CRITICAL: Blockfrost returns named keys in canonical ledger order.
          // Do NOT sort alphabetically - that breaks the canonical ordering.
          if (expectedKeys) {
            return expectedKeys.map(key => (key in model) ? Number(model[key]) : 0);
          }
          
          // Preserve Blockfrost's insertion order (canonical ledger order)
          return Object.values(model).map(n => Number(n));
        };
        
        // Helper: build CSL CostModel from integer array using from_json for correctness
        const buildCostModel = (intArray) => {
          // Use CostModel.from_json which expects a JSON array of integers
          // This is more reliable than manually calling set() for each index
          try {
            const jsonStr = JSON.stringify(intArray);
            const cm = CSL.CostModel.from_json(jsonStr);
            console.log('[IncrementCSL] Built CostModel via from_json:', cm.len(), 'params');
            return cm;
          } catch (jsonErr) {
            console.warn('[IncrementCSL] CostModel.from_json failed:', jsonErr.message, '- falling back to manual set()');
            // Fallback to manual construction
            const cm = CSL.CostModel.new();
            for (let i = 0; i < intArray.length; i++) {
              cm.set(i, toCSLInt(intArray[i]));
            }
            return cm;
          }
        };
        
        costModels = CSL.Costmdls.new();
        
        // ============================================================
        // Build cost model based on detected script language
        // V3 scripts need PlutusV3 cost model, V2 scripts need PlutusV2
        // ============================================================
        
        if (scriptLanguage === 'V3') {
          const v3Model = pp.cost_models?.PlutusV3;
          if (v3Model) {
            const isArr = Array.isArray(v3Model);
            const keyCount = isArr ? v3Model.length : Object.keys(v3Model).length;
            console.log('[IncrementCSL] PlutusV3 cost model format:', isArr ? 'array' : 'object', 'count:', keyCount);
            if (isArr) {
              console.log('[IncrementCSL] V3 raw array first 10:', v3Model.slice(0, 10));
            } else {
              const keys = Object.keys(v3Model);
              console.log('[IncrementCSL] V3 first 5 keys:', keys.slice(0, 5).join(', '));
              console.log('[IncrementCSL] V3 last 5 keys:', keys.slice(-5).join(', '));
              console.log('[IncrementCSL] V3 first 5 values:', keys.slice(0, 5).map(k => v3Model[k]));
            }
            
            const v3Array = costModelToArray(v3Model, null);
            console.log('[IncrementCSL] V3 array length:', v3Array.length, 'first 10 values:', v3Array.slice(0, 10));
            console.log('[IncrementCSL] V3 array last 5 values:', v3Array.slice(-5));
            
            // CRITICAL: Save the raw array for manual script_data_hash computation
            v3CostModelArray = v3Array;
            v3LanguageId = 2; // PlutusV3
            
            const costModel = buildCostModel(v3Array);
            
            if (typeof CSL.Language?.new_plutus_v3 === 'function') {
              costModels.insert(CSL.Language.new_plutus_v3(), costModel);
              console.log('[IncrementCSL] ✅ Inserted PlutusV3 cost model');
            } else {
              throw new Error('CSL.Language.new_plutus_v3 not available');
            }
          } else {
            throw new Error('PlutusV3 cost model not found in protocol params. Available: ' + 
              (pp.cost_models ? Object.keys(pp.cost_models).join(', ') : 'none'));
          }
        } else {
          const v2Model = pp.cost_models?.PlutusV2;
          if (v2Model) {
            console.log('[IncrementCSL] Building PlutusV2 cost model...');
            const v2Array = costModelToArray(v2Model, PLUTUS_V2_COST_MODEL_KEYS);
            console.log('[IncrementCSL] V2 array length:', v2Array.length);
            const costModel = buildCostModel(v2Array);
            
            costModels.insert(CSL.Language.new_plutus_v2(), costModel);
            console.log('[IncrementCSL] ✅ Inserted PlutusV2 cost model');
          } else {
            throw new Error('PlutusV2 cost model not found. Available: ' + 
              (pp.cost_models ? Object.keys(pp.cost_models).join(', ') : 'none'));
          }
        }
        
        console.log('[IncrementCSL] Costmdls now has', costModels.len(), 'language(s)');
        // Debug: log the costmdls hex for comparison
        try {
          console.log('[IncrementCSL] Costmdls hex (first 80):', costModels.to_hex().substring(0, 80) + '...');
        } catch(e) {}
        
      } catch (cmErr) {
        console.error('[IncrementCSL] CRITICAL: Failed to build cost models:', cmErr.message);
        console.error('[IncrementCSL] Stack:', cmErr.stack);
        throw new Error('Cannot build Plutus tx without valid cost models: ' + cmErr.message);
      }
      
      // ========================================
      // 5. Calculate script_data_hash and build transaction
      // ========================================
      // CRITICAL: For Plutus transactions, script_data_hash MUST be set in the tx body.
      // It's computed from: redeemers + datums (if any in witness) + cost models
      // CSL 12.x: calc_script_data_hash uses the builder's internal redeemers from add_plutus_script_input
      
      // For V3: use CSL's calc_script_data_hash for initial build (will be overridden later with manual hash)
      // For V2: CSL handles it correctly
      if (costModels && costModels.len() > 0 && typeof txBuilder.calc_script_data_hash === 'function') {
        try {
          txBuilder.calc_script_data_hash(costModels);
          console.log('[IncrementCSL] script_data_hash calculated via txBuilder (initial - may be overridden for V3)');
        } catch (hashErr) {
          console.error('[IncrementCSL] CRITICAL: Failed to calc script_data_hash:', hashErr.message);
          throw new Error('Failed to calculate script_data_hash: ' + hashErr.message);
        }
      } else {
        console.error('[IncrementCSL] CRITICAL: No cost models or calc_script_data_hash unavailable');
        console.error('[IncrementCSL] costModels:', costModels, 'len:', costModels ? costModels.len() : 'null');
        throw new Error('Cannot build Plutus tx without cost models for script_data_hash');
      }

      // Use build_tx() to get full transaction with witness set from builder
      // This ensures script_data_hash, redeemers, and scripts are all consistent
      let unsignedTx;
      try {
        // build_tx() creates Transaction with body + witness set from builder's internal state
        unsignedTx = txBuilder.build_tx();
        console.log('[IncrementCSL] Transaction built via build_tx()');
        
        // CRITICAL: build_tx() may add plutus_data to witness set even for inline datums
        // We must strip it to avoid NotAllowedSupplementalDatums error
        const builtWs = unsignedTx.witness_set();
        const builtPd = builtWs.plutus_data();
        if (builtPd && builtPd.len() > 0) {
          console.warn('[IncrementCSL] ⚠ build_tx() added', builtPd.len(), 'plutus_data to witness - STRIPPING for inline datum tx');
          
          // Rebuild witness set WITHOUT plutus_data
          const cleanWitnessSet = CSL.TransactionWitnessSet.new();
          
          // Copy plutus_scripts
          if (builtWs.plutus_scripts()) {
            cleanWitnessSet.set_plutus_scripts(builtWs.plutus_scripts());
          }
          
          // Copy redeemers
          if (builtWs.redeemers()) {
            cleanWitnessSet.set_redeemers(builtWs.redeemers());
          }
          
          // Copy vkeys if any
          if (builtWs.vkeys()) {
            cleanWitnessSet.set_vkeys(builtWs.vkeys());
          }
          
          // Copy native_scripts if any
          if (builtWs.native_scripts()) {
            cleanWitnessSet.set_native_scripts(builtWs.native_scripts());
          }
          
          // Copy bootstraps if any
          if (builtWs.bootstraps()) {
            cleanWitnessSet.set_bootstraps(builtWs.bootstraps());
          }
          
          // DO NOT copy plutus_data - this is the fix!
          
          // Rebuild transaction with clean witness set
          unsignedTx = CSL.Transaction.new(unsignedTx.body(), cleanWitnessSet);
          console.log('[IncrementCSL] ✅ Rebuilt tx with stripped witness set (no plutus_data)');
        }
        
      } catch (buildErr) {
        console.warn('[IncrementCSL] build_tx() failed, falling back to manual build:', buildErr.message);
        // Fallback: build body and witness set separately
        const txBody = txBuilder.build();
        
        const witnessSet = CSL.TransactionWitnessSet.new();
        
        // Add Plutus script
        const plutusScripts = CSL.PlutusScripts.new();
        plutusScripts.add(plutusScript);
        witnessSet.set_plutus_scripts(plutusScripts);
        
        // Add redeemer with correct index
        const redeemers = CSL.Redeemers.new();
        redeemers.add(redeemer);
        witnessSet.set_redeemers(redeemers);
        
        // NOTE: Do NOT add datums for inline datums
        console.log('[IncrementCSL] Using inline datums - NOT adding datums to witness set');
        
        unsignedTx = CSL.Transaction.new(txBody, witnessSet);
      }
      
      // DEBUG: Print redeemer and datum CBOR
      console.log('[DEBUG] Redeemer CBOR hex:', redeemerCbor);
      console.log('[DEBUG] New output datum CBOR hex:', newDatumCbor);
      
      // DEBUG: Verify witness counts AFTER stripping (must show plutus_data: 0)
      const wsAfterStrip = unsignedTx.witness_set();
      console.log('[DEBUG] Witness counts AFTER strip:', {
        plutus_scripts: wsAfterStrip.plutus_scripts()?.len() || 0,
        redeemers: wsAfterStrip.redeemers()?.len() || 0,
        plutus_data: wsAfterStrip.plutus_data()?.len() || 0
      });
      if ((wsAfterStrip.plutus_data()?.len() || 0) > 0) {
        console.error('[DEBUG] ❌ STILL HAS plutus_data IN WITNESS SET - will fail with NotAllowedSupplementalDatums');
      } else {
        console.log('[DEBUG] ✅ No plutus_data in witness set (correct for inline datum tx)');
      }
      
      // Verify script_data_hash is present and override for V3 if needed
      const txBody = unsignedTx.body();
      let scriptDataHash = txBody.script_data_hash();
      if (!scriptDataHash) {
        console.error('[IncrementCSL] CRITICAL: script_data_hash is NULL after build!');
        throw new Error('Transaction missing script_data_hash - will fail with PPViewHashesDontMatch');
      }
      console.log('[IncrementCSL] script_data_hash (from CSL):', scriptDataHash.to_hex());
      
      // For V3: override with manually computed hash (CSL 12.x is broken for V3)
      if (scriptLanguage === 'V3' && v3CostModelArray) {
        const builtRedeemers = unsignedTx.witness_set().redeemers();
        if (builtRedeemers) {
          const manualHash = computeScriptDataHash(builtRedeemers, v3LanguageId, v3CostModelArray, null);
          txBody.set_script_data_hash(manualHash);
          unsignedTx = CSL.Transaction.new(txBody, unsignedTx.witness_set());
          console.log('[IncrementCSL] ✅ Overrode script_data_hash with manual V3 computation:', manualHash.to_hex());
          scriptDataHash = manualHash;
        }
      }
      
      // DEBUG: Verify redeemer index matches txBody.inputs() canonical ordering
      const canonicalScriptIndex = findInputIndexInTxBody(txBody, scriptUtxo.tx_hash, scriptUtxo.tx_index);
      console.log('[DEBUG] Redeemer index used:', scriptInputIndex);
      console.log('[DEBUG] Script input index from txBody.inputs():', canonicalScriptIndex);
      if (canonicalScriptIndex !== scriptInputIndex) {
        console.error('[DEBUG] ❌ REDEEMER INDEX MISMATCH! Used:', scriptInputIndex, 'but txBody has:', canonicalScriptIndex);
        console.error('[DEBUG] This will cause EvaluationFailure with extraneousRedeemers or missingRedeemers');
      } else {
        console.log('[DEBUG] ✅ Redeemer index matches txBody.inputs() ordering');
      }
      
      // DEBUG: Print script hash comparison
      const attachedScriptHash = plutusScript.hash().to_hex();
      console.log('[DEBUG] Attached script hash:', attachedScriptHash);
      console.log('[DEBUG] Script UTxO address:', scriptAddress);
      
      // DEBUG: Print witness set counts
      const ws = unsignedTx.witness_set();
      console.log('[DEBUG] Witness set counts:', {
        plutus_scripts: ws.plutus_scripts()?.len() || 0,
        redeemers: ws.redeemers()?.len() || 0,
        plutus_data: ws.plutus_data()?.len() || 0
      });
      
      // DEBUG: Verify TTL
      let builtTtl = 'NULL';
      if (typeof txBody.ttl_bignum === 'function') {
        const bn = txBody.ttl_bignum();
        builtTtl = bn ? bn.to_str() : 'NULL';
      } else if (typeof txBody.ttl === 'function') {
        const num = txBody.ttl();
        builtTtl = (num !== undefined && num !== null) ? String(num) : 'NULL';
      }
      console.log('[IncrementCSL] TTL in built txBody:', builtTtl);
      
      const unsignedTxHex = bytesToHex(unsignedTx.to_bytes());

      // DEBUG: Log validity after build
      logValidity('After build()', unsignedTx);
      console.log('[IncrementCSL] Unsigned tx built, size:', unsignedTxHex.length / 2, 'bytes');

      // ========================================
      // 6. Evaluate ExUnits with retry and fallback
      // ========================================
      console.log('[IncrementCSL] Evaluating ExUnits (with retry and fallback)...');
      
      let evalResult;
      try {
        evalResult = await evaluateExUnitsWithRetryAndFallback(unsignedTxHex, blockfrostKey);
        console.log('[IncrementCSL] Evaluation result:', evalResult);
      } catch (evalErr) {
        // CRITICAL: Do NOT proceed without evaluated ExUnits
        console.error('[IncrementCSL] CRITICAL: ExUnits evaluation failed:', evalErr.message);
        throw new Error('Cannot submit Plutus tx without evaluated ExUnits: ' + evalErr.message);
      }

      // Evaluation succeeded - rebuild with correct ExUnits
      let finalTxHex = unsignedTxHex;
      
      if (evalResult && evalResult.result && evalResult.result.EvaluationResult) {
        const evalData = evalResult.result.EvaluationResult;
        console.log('[IncrementCSL] evalData type:', typeof evalData, 'isArray:', Array.isArray(evalData));
        console.log('[IncrementCSL] evalData:', JSON.stringify(evalData));
        
        // Handle both formats:
        // 1. Object format: { "spend:0": { memory: N, steps: N } }
        // 2. Array format:  [{ validator: { index: N, purpose: "spend" }, budget: { memory: N, cpu: N } }]
        let exUnits = null;
        
        if (Array.isArray(evalData)) {
          // Array format (Blockfrost/Ogmios newer format)
          const spendEntry = evalData.find(e => e.validator && e.validator.purpose === 'spend');
          if (spendEntry && spendEntry.budget) {
            exUnits = {
              memory: spendEntry.budget.memory,
              steps: spendEntry.budget.cpu || spendEntry.budget.steps
            };
          }
        } else {
          // Object format (legacy Ogmios format)
          const spendKey = Object.keys(evalData).find(k => k.startsWith('spend:'));
          if (spendKey && evalData[spendKey]) {
            exUnits = evalData[spendKey];
          }
        }
        
        if (exUnits) {
          console.log('[IncrementCSL] ExUnits from evaluation:', exUnits);
          
          // Rebuild redeemer with correct ExUnits
          const correctExUnits = CSL.ExUnits.new(
            CSL.BigNum.from_str(exUnits.memory.toString()),
            CSL.BigNum.from_str(exUnits.steps.toString())
          );
          
          const correctRedeemer = CSL.Redeemer.new(
            CSL.RedeemerTag.new_spend(),
            CSL.BigNum.from_str(scriptInputIndex.toString()),
            redeemerData,
            correctExUnits
          );
          
          // Rebuild witness set with correct redeemer
          const finalRedeemers = CSL.Redeemers.new();
          finalRedeemers.add(correctRedeemer);
          
          // CRITICAL: Recompute script_data_hash with updated redeemers
          // For V3: use manual computation (CSL 12.x hash_script_data is broken for V3)
          // For V2: use CSL's hash_script_data
          let newScriptDataHash;
          if (scriptLanguage === 'V3' && v3CostModelArray) {
            console.log('[IncrementCSL] Using MANUAL script_data_hash for V3 (bypassing broken CSL hash_script_data)');
            newScriptDataHash = computeScriptDataHash(finalRedeemers, v3LanguageId, v3CostModelArray, null);
          } else {
            newScriptDataHash = CSL.hash_script_data(finalRedeemers, costModels, null);
          }
          console.log('[IncrementCSL] Recomputed script_data_hash:', newScriptDataHash.to_hex());
          
          // Get plutus scripts from the built transaction
          const builtWitness = unsignedTx.witness_set();
          const plutusScriptsFromTx = builtWitness.plutus_scripts() || CSL.PlutusScripts.new();
          if (plutusScriptsFromTx.len() === 0) {
            plutusScriptsFromTx.add(plutusScript);
          }
          
          // CRITICAL: TransactionBody from .body() is IMMUTABLE in CSL 12.x
          // We must rebuild the body by serializing to CBOR, patching fee + script_data_hash, and deserializing
          
          // Step 1: Compute the new fee
          // Estimate tx size using current body + new witness set
          const tempWitnessSet = CSL.TransactionWitnessSet.new();
          tempWitnessSet.set_plutus_scripts(plutusScriptsFromTx);
          tempWitnessSet.set_redeemers(finalRedeemers);
          const oldBody = unsignedTx.body();
          const tempTx = CSL.Transaction.new(oldBody, tempWitnessSet);
          // Estimate signed tx size (add ~150 bytes for vkey witness)
          const estimatedSize = tempTx.to_bytes().length + 150;
          
          const minFeeA = BigInt(pp.min_fee_a);
          const minFeeB = BigInt(pp.min_fee_b);
          const priceMem = parseFloat(pp.price_mem);
          const priceStep = parseFloat(pp.price_step);
          
          const sizeFee = minFeeA * BigInt(estimatedSize) + minFeeB;
          const exUnitsFee = BigInt(Math.ceil(priceMem * exUnits.memory)) + BigInt(Math.ceil(priceStep * exUnits.steps));
          const computedFee = sizeFee + exUnitsFee;
          // Add 10% safety margin
          const newFee = computedFee + computedFee / 10n;
          console.log('[IncrementCSL] Fee computed: sizeFee=' + sizeFee.toString() + ' exUnitsFee=' + exUnitsFee.toString() + ' total(+10%)=' + newFee.toString());
          
          // Step 2: Rebuild the TransactionBody with new fee and script_data_hash
          // TransactionBody from .body() has setters for most fields EXCEPT fee.
          // Fee can only be set via the constructor, so we rebuild from components.
          const newScriptDataHashHex = newScriptDataHash.to_hex();
          
          function rebuildBodyWithFeeAndHash(oldBody, newFeeStr, scriptDataHashHex, walletAddr) {
            // TransactionBody from .body() has setters for most fields EXCEPT fee.
            // Fee can only be set via the constructor. So we rebuild from components.
            var inputs = oldBody.inputs();
            var oldOutputs = oldBody.outputs();
            var oldFee = oldBody.fee();
            var newFeeBN = CSL.BigNum.from_str(newFeeStr);
            
            // CRITICAL: When fee changes, we must adjust the change output so that
            // sum(inputs) = sum(outputs) + fee  (value conservation rule)
            // feeDiff = oldFee - newFee (positive means new fee is smaller, change gets more)
            var feeDiff = BigInt(oldFee.to_str()) - BigInt(newFeeStr);
            console.log('[IncrementCSL] Fee adjustment: oldFee=' + oldFee.to_str() + ' newFee=' + newFeeStr + ' diff=' + feeDiff.toString());
            
            // Find the change output (wallet address, not script address) and adjust it
            var newOutputs = CSL.TransactionOutputs.new();
            var changeAdjusted = false;
            for (var i = 0; i < oldOutputs.len(); i++) {
              var out = oldOutputs.get(i);
              var outAddr = out.address().to_bech32();
              // The change output goes to the wallet address (not the script address)
              if (!changeAdjusted && walletAddr && outAddr === walletAddr) {
                // Adjust change amount by fee difference
                var oldAmount = BigInt(out.amount().coin().to_str());
                var newAmount = oldAmount + feeDiff;
                console.log('[IncrementCSL] Adjusting change output[' + i + ']: ' + oldAmount.toString() + ' -> ' + newAmount.toString());
                var newValue = CSL.Value.new(CSL.BigNum.from_str(newAmount.toString()));
                var newOutAmount = CSL.TransactionOutput.new(out.address(), newValue);
                newOutputs.add(newOutAmount);
                changeAdjusted = true;
              } else {
                newOutputs.add(out);
              }
            }
            if (!changeAdjusted && feeDiff !== 0n) {
              console.warn('[IncrementCSL] WARNING: Could not find change output to adjust! Value conservation may fail.');
            }
            
            var newBody = CSL.TransactionBody.new_tx_body(inputs, newOutputs, newFeeBN);
            
            // Copy TTL
            var ttl = oldBody.ttl_bignum ? oldBody.ttl_bignum() : undefined;
            if (ttl) {
              newBody.set_ttl(ttl);
              console.log('[IncrementCSL] Rebuilt body TTL:', ttl.to_str());
            }
            
            // Copy collateral
            var collateral = oldBody.collateral();
            if (collateral) newBody.set_collateral(collateral);
            var collateralReturn = oldBody.collateral_return ? oldBody.collateral_return() : undefined;
            if (collateralReturn) newBody.set_collateral_return(collateralReturn);
            var totalCollateral = oldBody.total_collateral ? oldBody.total_collateral() : undefined;
            if (totalCollateral) newBody.set_total_collateral(totalCollateral);
            
            // Copy required signers
            var requiredSigners = oldBody.required_signers ? oldBody.required_signers() : undefined;
            if (requiredSigners) newBody.set_required_signers(requiredSigners);
            
            // Set script_data_hash
            newBody.set_script_data_hash(CSL.ScriptDataHash.from_hex(scriptDataHashHex));
            
            return newBody;
          }
          
          // Get wallet address as bech32 for change output identification
          const walletBech32 = changeAddr.to_bech32();
          const newBody = rebuildBodyWithFeeAndHash(oldBody, newFee.toString(), newScriptDataHashHex, walletBech32);
          
          // Rebuild witness set
          const finalWitnessSet = CSL.TransactionWitnessSet.new();
          finalWitnessSet.set_plutus_scripts(plutusScriptsFromTx);
          finalWitnessSet.set_redeemers(finalRedeemers);
          // NOTE: Do NOT add datums - using inline datums
          
          const finalTx = CSL.Transaction.new(newBody, finalWitnessSet);
          finalTxHex = bytesToHex(finalTx.to_bytes());
          
          // Verify script_data_hash in final tx
          const finalScriptDataHash = finalTx.body().script_data_hash();
          console.log('[IncrementCSL] Final tx script_data_hash:', finalScriptDataHash ? finalScriptDataHash.to_hex() : 'NULL');
          
          // DEBUG: Log validity after rebuild
          logValidity('After ExUnits rebuild', finalTx);
          console.log('[IncrementCSL] Rebuilt tx with correct ExUnits');
        } else {
          console.error('[IncrementCSL] CRITICAL: Could not extract ExUnits from evaluation result');
          console.error('[IncrementCSL] evalData:', JSON.stringify(evalData));
          throw new Error('Cannot extract ExUnits from evaluation result - unexpected format');
        }
      } else {
        // Evaluation failed - DO NOT proceed with placeholder ExUnits
        console.error('[IncrementCSL] CRITICAL: Evaluation failed and no ExUnits available');
        throw new Error('Cannot submit Plutus tx without evaluated ExUnits - Blockfrost evaluate failed');
      }

      // ========================================
      // 7. Sign via CIP-30
      // ========================================
      console.log('[IncrementCSL] Requesting wallet signature...');
      const signedWitnessHex = await walletApi.signTx(finalTxHex, true);
      
      console.log('[IncrementCSL] Signature received');

      // Merge witness sets
      const signedWitness = CSL.TransactionWitnessSet.from_bytes(hexToBytes(signedWitnessHex));
      
      // Get the final tx body
      const finalTxForSigning = CSL.Transaction.from_bytes(hexToBytes(finalTxHex));
      const finalTxBody = finalTxForSigning.body();
      const existingWitness = finalTxForSigning.witness_set();
      
      // DEBUG: Log validity after deserializing
      logValidity('After deserialize finalTxHex', finalTxForSigning);
      
      // Combine witnesses
      const combinedWitness = CSL.TransactionWitnessSet.new();
      
      // Copy Plutus components
      if (existingWitness.plutus_scripts()) {
        combinedWitness.set_plutus_scripts(existingWitness.plutus_scripts());
      }
      if (existingWitness.redeemers()) {
        combinedWitness.set_redeemers(existingWitness.redeemers());
      }
      // NOTE: Do NOT copy plutus_data - using inline datums, no witness datums needed
      // if (existingWitness.plutus_data()) {
      //   combinedWitness.set_plutus_data(existingWitness.plutus_data());
      // }
      
      // Add vkey witnesses from signing
      if (signedWitness.vkeys()) {
        combinedWitness.set_vkeys(signedWitness.vkeys());
      }

      // Create final signed transaction
      const signedTx = CSL.Transaction.new(finalTxBody, combinedWitness);
      const signedTxHex = bytesToHex(signedTx.to_bytes());

      // DEBUG: Log validity before submit
      logValidity('Before submit', signedTx);
      console.log('[IncrementCSL] Signed tx size:', signedTxHex.length / 2, 'bytes');
      
      // ========================================
      // SANITY CHECKS before submit
      // ========================================
      console.log('[IncrementCSL] === PRE-SUBMIT SANITY CHECKS ===');
      
      const diagBody = signedTx.body();
      const diagWitness = signedTx.witness_set();
      let sanityPassed = true;
      
      // Check 1: script_data_hash must exist for Plutus tx
      const finalScriptDataHashCheck = diagBody.script_data_hash();
      if (!finalScriptDataHashCheck) {
        console.error('[IncrementCSL] ❌ FAIL: script_data_hash is NULL - will cause PPViewHashesDontMatch');
        sanityPassed = false;
      } else {
        console.log('[IncrementCSL] ✓ script_data_hash:', finalScriptDataHashCheck.to_hex());
      }
      
      // Check 2: Redeemers must exist and have real ExUnits (not placeholder)
      const diagRedeemers = diagWitness.redeemers();
      if (!diagRedeemers || diagRedeemers.len() === 0) {
        console.error('[IncrementCSL] ❌ FAIL: No redeemers in witness set');
        sanityPassed = false;
      } else {
        const r = diagRedeemers.get(0);
        const rExUnits = r.ex_units();
        const mem = parseInt(rExUnits.mem().to_str());
        const steps = parseInt(rExUnits.steps().to_str());
        console.log('[IncrementCSL] ✓ Redeemer[0]: tag=' + r.tag().kind() + ', index=' + r.index().to_str());
        console.log('[IncrementCSL]   ExUnits: mem=' + mem + ', steps=' + steps);
        if (mem === 1000000 && steps === 500000000) {
          console.warn('[IncrementCSL] ⚠ WARNING: ExUnits are placeholder values - evaluation may have failed');
        }
      }
      
      // Check 3: Plutus scripts must exist
      const diagScripts = diagWitness.plutus_scripts();
      if (!diagScripts || diagScripts.len() === 0) {
        console.error('[IncrementCSL] ❌ FAIL: No Plutus scripts in witness set');
        sanityPassed = false;
      } else {
        console.log('[IncrementCSL] ✓ Plutus scripts:', diagScripts.len());
      }
      
      // Check 4: Collateral must exist and be sufficient
      const diagCollateral = diagBody.collateral();
      if (!diagCollateral || diagCollateral.len() === 0) {
        console.error('[IncrementCSL] ❌ FAIL: No collateral inputs');
        sanityPassed = false;
      } else {
        console.log('[IncrementCSL] ✓ Collateral inputs:', diagCollateral.len());
      }
      
      // Check 5: Fee must be reasonable (> 0)
      const fee = parseInt(diagBody.fee().to_str());
      if (fee <= 0) {
        console.error('[IncrementCSL] ❌ FAIL: Fee is zero or negative');
        sanityPassed = false;
      } else {
        console.log('[IncrementCSL] ✓ Fee:', fee, 'lovelace');
      }
      
      // Check 6: TTL must exist and be in the future
      let ttlValue = null;
      if (typeof diagBody.ttl_bignum === 'function') {
        const bn = diagBody.ttl_bignum();
        ttlValue = bn ? parseInt(bn.to_str()) : null;
      } else if (typeof diagBody.ttl === 'function') {
        ttlValue = diagBody.ttl();
      }
      if (!ttlValue || ttlValue === 0) {
        console.error('[IncrementCSL] ❌ FAIL: TTL is missing or zero');
        sanityPassed = false;
      } else {
        console.log('[IncrementCSL] ✓ TTL:', ttlValue);
      }
      
      // Check 7: VKey witnesses (signature) must exist
      const diagVkeys = diagWitness.vkeys();
      if (!diagVkeys || diagVkeys.len() === 0) {
        console.error('[IncrementCSL] ❌ FAIL: No VKey witnesses (signatures)');
        sanityPassed = false;
      } else {
        console.log('[IncrementCSL] ✓ VKey witnesses:', diagVkeys.len());
      }
      
      // Check 8: Inputs and outputs
      console.log('[IncrementCSL] ✓ Inputs:', diagBody.inputs().len());
      console.log('[IncrementCSL] ✓ Outputs:', diagBody.outputs().len());
      
      // Check 9: No supplemental datums (for inline datum tx)
      const diagDatums = diagWitness.plutus_data();
      if (diagDatums && diagDatums.len() > 0) {
        console.warn('[IncrementCSL] ⚠ WARNING: Witness set contains', diagDatums.len(), 'datums - may cause NotAllowedSupplementalDatums for inline datum inputs');
      } else {
        console.log('[IncrementCSL] ✓ No supplemental datums (correct for inline datum tx)');
      }
      
      console.log('[IncrementCSL] === END SANITY CHECKS ===');
      
      if (!sanityPassed) {
        throw new Error('Pre-submit sanity checks failed - see console for details');
      }
      
      // Log tx hex for debugging
      console.log('[IncrementCSL] Tx hex (first 100):', signedTxHex.substring(0, 100));
      console.log('[IncrementCSL] Tx size:', signedTxHex.length / 2, 'bytes');

      // ========================================
      // 8. Submit via CIP-30 wallet
      // ========================================
      console.log('[IncrementCSL] Submitting transaction...');
      let txHash;
      try {
        txHash = await walletApi.submitTx(signedTxHex);
      } catch (submitErr) {
        // Extract full error details from TxSendError
        console.error('[IncrementCSL] Submit failed! Full error object:', submitErr);
        console.error('[IncrementCSL] Error type:', typeof submitErr);
        console.error('[IncrementCSL] Error keys:', submitErr ? Object.keys(submitErr) : 'null');
        if (submitErr.info) {
          console.error('[IncrementCSL] Error info (full):', submitErr.info);
        }
        if (submitErr.code) {
          console.error('[IncrementCSL] Error code:', submitErr.code);
        }
        // Try to parse info as JSON if it's a string
        if (typeof submitErr.info === 'string') {
          try {
            const parsed = JSON.parse(submitErr.info);
            console.error('[IncrementCSL] Parsed error info:', JSON.stringify(parsed, null, 2));
          } catch (e) {
            // Not JSON, already logged
          }
        }
        throw submitErr;
      }

      console.log('[IncrementCSL] SUCCESS! TxHash:', txHash);

      // ========================================
      // 9. Return result to Unity
      // ========================================
      const result = JSON.stringify({
        txHash: txHash,
        oldValue: currentValue.toString(),
        newValue: newValue.toString()
      });

      if (typeof SendMessage === 'function') {
        SendMessage(gameObjectName, successCallback, result);
      }

      return { txHash, oldValue: currentValue, newValue };

    } catch (err) {
      const errorMsg = err.message || String(err);
      console.error('[IncrementCSL] ERROR:', errorMsg);

      // Check for user rejection
      const lower = errorMsg.toLowerCase();
      const finalMsg = (lower.includes('reject') || lower.includes('cancel') || lower.includes('denied'))
        ? 'User rejected the transaction'
        : errorMsg;

      if (typeof SendMessage === 'function') {
        SendMessage(gameObjectName, errorCallback, finalMsg);
      }

      throw err;
    }
  }

  // ============================================================
  // Expose globally
  // ============================================================
  window.IncrementCounterCSL = IncrementCounterCSL;
  
  // Also expose helpers for debugging
  window.CSLHelpers = {
    hexToBytes,
    bytesToHex,
    decodeDatumInteger,
    encodeDatumInteger,
    buildIncrementRedeemerCbor,
    toRational,
    logValidity,
    idxToString,
    getInputIndex,
    getPaymentCredFromAddress,
    getScriptHashFromAddress,
    unwrapCborBytes,
    normalizeValidatorBytes
  };

  console.log('[IncrementCSL] Loaded. Call IncrementCounterCSL() to increment counter.');

})();
