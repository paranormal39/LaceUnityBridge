/**
 * init-counter-csl.js - Counter Initialization Script
 * 
 * Creates a valid counter UTxO at the script address with the correct datum format.
 * The validator expects datum type: Constr 0 [Int] (not plain Int)
 * 
 * Valid datum for counter=0: CBOR hex d8799f00ff
 * 
 * This is a simple payment transaction (no script execution), so:
 * - No collateral required
 * - No redeemer required
 * - No script witness required
 * 
 * Usage (browser with Lace):
 *   await InitCounterCSL(gameObjectName, successCallback, errorCallback, scriptAddress, blockfrostKey, initialValue);
 */

(function() {
  'use strict';

  // ============================================================
  // Utility Functions
  // ============================================================

  function hexToBytes(hex) {
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
   * Encode integer as Counter datum (plain CBOR integer)
   * V3 validator uses plain Int datum: 00, 01, 02, 1818, etc.
   */
  function encodeCounterDatum(value) {
    const result = encodeRawCborInt(value);
    console.log('[InitCounter] Encoding counter', value.toString(), 'as plain Int:', result);
    return result;
  }

  /**
   * Check if a datum is valid Counter format (plain CBOR integer)
   */
  function isValidCounterDatum(datumHex) {
    if (!datumHex || datumHex.length < 2) return false;
    // Valid plain CBOR integer: first byte 0x00-0x1b
    const firstByte = parseInt(datumHex.substring(0, 2), 16);
    return firstByte <= 0x1b;
  }

  /**
   * Classify UTxOs at script address as valid or poisoned
   */
  function classifyUtxos(utxos) {
    const valid = [];
    const poisoned = [];
    
    for (const u of utxos) {
      if (!u.inline_datum) {
        continue; // Skip UTxOs without inline datum
      }
      
      if (isValidCounterDatum(u.inline_datum)) {
        valid.push(u);
      } else {
        poisoned.push({
          ...u,
          reason: `plain integer or invalid format: ${u.inline_datum}`
        });
      }
    }
    
    return { valid, poisoned };
  }

  // ============================================================
  // Blockfrost API Helpers
  // ============================================================

  const BLOCKFROST_BASE_URL = 'https://cardano-preprod.blockfrost.io/api/v0';

  async function blockfrostFetch(endpoint, blockfrostKey, options = {}) {
    const response = await fetch(`${BLOCKFROST_BASE_URL}${endpoint}`, {
      ...options,
      headers: {
        'project_id': blockfrostKey,
        'Content-Type': 'application/json',
        ...options.headers
      }
    });
    
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Blockfrost ${response.status}: ${text}`);
    }
    
    return response.json();
  }

  async function getUtxosAtAddress(address, blockfrostKey) {
    try {
      return await blockfrostFetch(`/addresses/${address}/utxos`, blockfrostKey);
    } catch (err) {
      if (err.message.includes('404')) {
        return []; // No UTxOs at address
      }
      throw err;
    }
  }

  async function getProtocolParameters(blockfrostKey) {
    return blockfrostFetch('/epochs/latest/parameters', blockfrostKey);
  }

  async function submitTransaction(txCborHex, blockfrostKey) {
    const response = await fetch(`${BLOCKFROST_BASE_URL}/tx/submit`, {
      method: 'POST',
      headers: {
        'project_id': blockfrostKey,
        'Content-Type': 'application/cbor'
      },
      body: hexToBytes(txCborHex)
    });
    
    const text = await response.text();
    
    if (!response.ok) {
      throw new Error(`Submit failed ${response.status}: ${text}`);
    }
    
    return text.replace(/"/g, ''); // Remove quotes from tx hash
  }

  // ============================================================
  // Main Implementation
  // ============================================================

  /**
   * InitCounterCSL - Initialize a counter UTxO at the script address
   * 
   * Creates a simple payment transaction that sends ADA to the script address
   * with an inline datum in the correct Constr 0 [Int] format.
   * 
   * @param {string} gameObjectName - Unity GameObject for SendMessage callback
   * @param {string} successCallback - Success callback method name
   * @param {string} errorCallback - Error callback method name
   * @param {string} scriptAddress - Bech32 script address
   * @param {string} blockfrostKey - Blockfrost API key (preprod)
   * @param {number} initialValue - Initial counter value (default: 0)
   */
  async function InitCounterCSL(
    gameObjectName,
    successCallback,
    errorCallback,
    scriptAddress,
    blockfrostKey,
    initialValue = 0
  ) {
    try {
      console.log('============================================================');
      console.log('COUNTER INITIALIZATION SCRIPT (CSL)');
      console.log('============================================================');
      console.log('');
      console.log('Script Address:', scriptAddress);
      console.log('Initial Value:', initialValue);
      
      const expectedDatum = encodeCounterDatum(initialValue);
      console.log('Expected datum for counter=' + initialValue + ':', expectedDatum);
      console.log('');

      // ========================================
      // 1. Check existing UTxOs at script address
      // ========================================
      console.log('[InitCounter] Fetching UTxOs at script address...');
      const scriptUtxos = await getUtxosAtAddress(scriptAddress, blockfrostKey);
      console.log('[InitCounter] Found', scriptUtxos.length, 'UTxO(s) at script address');
      
      const { valid, poisoned } = classifyUtxos(scriptUtxos);
      
      console.log('');
      console.log('============================================================');
      console.log('UTXO CLASSIFICATION REPORT');
      console.log('============================================================');
      console.log('');
      
      console.log('✅ VALID UTxOs:', valid.length);
      valid.forEach(u => {
        console.log(`   ${u.tx_hash.substring(0, 16)}...#${u.tx_index}`);
        console.log(`      datum: ${u.inline_datum}`);
      });
      
      console.log('');
      console.log('❌ POISONED/INVALID UTxOs:', poisoned.length);
      poisoned.forEach(u => {
        console.log(`   ${u.tx_hash.substring(0, 16)}...#${u.tx_index}`);
        console.log(`      datum: ${u.inline_datum}`);
        console.log(`      reason: ${u.reason}`);
      });
      
      console.log('');
      console.log('============================================================');
      console.log('');

      // If valid UTxO already exists, we're done
      if (valid.length > 0) {
        const msg = `✅ Valid counter UTxO already exists! UTxO: ${valid[0].tx_hash}#${valid[0].tx_index}`;
        console.log(msg);
        
        if (typeof UnityInstance !== 'undefined' && gameObjectName && successCallback) {
          UnityInstance.SendMessage(gameObjectName, successCallback, JSON.stringify({
            status: 'already_exists',
            txHash: valid[0].tx_hash,
            txIndex: valid[0].tx_index,
            datum: valid[0].inline_datum
          }));
        }
        return;
      }

      console.log('⚠️  No valid counter UTxO found. Creating one...');
      console.log('');

      // ========================================
      // 2. Connect to wallet
      // ========================================
      console.log('[InitCounter] Connecting to Lace wallet...');
      
      if (!window.cardano?.lace) {
        throw new Error('Lace wallet not found. Please install Lace extension.');
      }
      
      const walletApi = await window.cardano.lace.enable();
      console.log('[InitCounter] Wallet connected');

      // ========================================
      // 3. Get wallet UTxOs and change address
      // ========================================
      console.log('[InitCounter] Fetching wallet UTxOs...');
      const walletUtxosHex = await walletApi.getUtxos();
      const changeAddressHex = await walletApi.getChangeAddress();
      
      if (!walletUtxosHex || walletUtxosHex.length === 0) {
        throw new Error('No UTxOs in wallet. Please fund your wallet first.');
      }
      
      console.log('[InitCounter] Found', walletUtxosHex.length, 'UTxO(s) in wallet');

      // ========================================
      // 4. Get protocol parameters
      // ========================================
      console.log('[InitCounter] Fetching protocol parameters...');
      const pp = await getProtocolParameters(blockfrostKey);

      // ========================================
      // 5. Build initialization transaction
      // ========================================
      console.log('[InitCounter] Building initialization transaction...');
      
      const CSL = window.CardanoSerializationLib;
      if (!CSL) {
        throw new Error('CardanoSerializationLib not loaded');
      }

      // Parse addresses
      const scriptAddr = CSL.Address.from_bech32(scriptAddress);
      const changeAddr = CSL.Address.from_bytes(hexToBytes(changeAddressHex));

      // Build TransactionBuilder config
      const linearFee = CSL.LinearFee.new(
        CSL.BigNum.from_str(pp.min_fee_a.toString()),
        CSL.BigNum.from_str(pp.min_fee_b.toString())
      );

      const txBuilderConfig = CSL.TransactionBuilderConfigBuilder.new()
        .fee_algo(linearFee)
        .pool_deposit(CSL.BigNum.from_str(pp.pool_deposit))
        .key_deposit(CSL.BigNum.from_str(pp.key_deposit))
        .max_value_size(parseInt(pp.max_val_size))
        .max_tx_size(parseInt(pp.max_tx_size))
        .coins_per_utxo_byte(CSL.BigNum.from_str(pp.coins_per_utxo_size || pp.coins_per_utxo_word || '4310'))
        .prefer_pure_change(true)
        .build();

      const txBuilder = CSL.TransactionBuilder.new(txBuilderConfig);

      // Add wallet inputs
      console.log('[InitCounter] Adding wallet inputs...');
      for (const utxoHex of walletUtxosHex) {
        const tu = CSL.TransactionUnspentOutput.from_bytes(hexToBytes(utxoHex));
        const input = tu.input();
        const output = tu.output();
        
        console.log('[InitCounter] Added input:', 
          bytesToHex(input.transaction_id().to_bytes()).substring(0, 16) + '...#' + input.index(),
          'lovelace:', output.amount().coin().to_str()
        );
        
        if (typeof txBuilder.add_regular_input === 'function') {
          txBuilder.add_regular_input(output.address(), input, output.amount());
        } else {
          txBuilder.add_input(output.address(), input, output.amount());
        }
      }

      // Create datum PlutusData
      const datumCborHex = encodeCounterDatum(initialValue);
      const datumPlutusData = CSL.PlutusData.from_bytes(hexToBytes(datumCborHex));
      
      console.log('[InitCounter] Building transaction with datum:', datumCborHex);

      // Add script output with inline datum
      // Minimum ADA for script output (2 ADA should be safe)
      const scriptOutputLovelace = '2000000';
      
      const outputBuilder = CSL.TransactionOutputBuilder.new()
        .with_address(scriptAddr)
        .with_plutus_data(datumPlutusData);
      
      const scriptOutput = outputBuilder
        .next()
        .with_coin(CSL.BigNum.from_str(scriptOutputLovelace))
        .build();
      
      txBuilder.add_output(scriptOutput);
      console.log('[InitCounter] Added script output:', scriptOutputLovelace, 'lovelace with inline datum');

      // Add change output
      txBuilder.add_change_if_needed(changeAddr);

      // Build transaction
      const unsignedTx = txBuilder.build_tx();
      const unsignedTxHex = bytesToHex(unsignedTx.to_bytes());
      
      console.log('[InitCounter] Unsigned tx built, size:', unsignedTxHex.length / 2, 'bytes');

      // ========================================
      // 6. Sign via CIP-30
      // ========================================
      console.log('[InitCounter] Requesting wallet signature...');
      const signedWitnessHex = await walletApi.signTx(unsignedTxHex, false);
      console.log('[InitCounter] Signature received');

      // Merge witness sets
      const signedWitness = CSL.TransactionWitnessSet.from_bytes(hexToBytes(signedWitnessHex));
      const existingWitness = unsignedTx.witness_set();
      
      const combinedWitness = CSL.TransactionWitnessSet.new();
      
      // Copy vkey witnesses from signing
      if (signedWitness.vkeys()) {
        combinedWitness.set_vkeys(signedWitness.vkeys());
      }
      
      // Build final transaction
      const signedTx = CSL.Transaction.new(unsignedTx.body(), combinedWitness);
      const signedTxHex = bytesToHex(signedTx.to_bytes());
      
      console.log('[InitCounter] Signed tx size:', signedTxHex.length / 2, 'bytes');

      // ========================================
      // 7. Submit transaction
      // ========================================
      console.log('[InitCounter] Submitting transaction...');
      const txHash = await submitTransaction(signedTxHex, blockfrostKey);
      
      console.log('');
      console.log('============================================================');
      console.log('✅ TRANSACTION SUBMITTED SUCCESSFULLY!');
      console.log('============================================================');
      console.log('');
      console.log('Transaction hash:', txHash);
      console.log('');
      console.log('View on explorer:');
      console.log(`https://preprod.cardanoscan.io/transaction/${txHash}`);
      console.log('');
      console.log('The counter UTxO will be available after confirmation (~20 seconds).');
      console.log('');

      // Success callback
      if (typeof UnityInstance !== 'undefined' && gameObjectName && successCallback) {
        UnityInstance.SendMessage(gameObjectName, successCallback, JSON.stringify({
          status: 'created',
          txHash: txHash,
          datum: datumCborHex,
          initialValue: initialValue
        }));
      }

    } catch (err) {
      console.error('[InitCounter] ERROR:', err.message);
      console.error('[InitCounter] Stack:', err.stack);
      
      if (typeof UnityInstance !== 'undefined' && gameObjectName && errorCallback) {
        UnityInstance.SendMessage(gameObjectName, errorCallback, err.message);
      }
      
      throw err;
    }
  }

  // ============================================================
  // Exports
  // ============================================================

  window.InitCounterCSL = InitCounterCSL;
  
  // Also export helper functions for use in other modules
  window.CounterHelpers = {
    hexToBytes,
    bytesToHex,
    encodeCounterDatum,
    isValidCounterDatum,
    classifyUtxos,
    getUtxosAtAddress
  };

  console.log('[InitCounterCSL] Module loaded. Call InitCounterCSL() to initialize a counter.');

})();
