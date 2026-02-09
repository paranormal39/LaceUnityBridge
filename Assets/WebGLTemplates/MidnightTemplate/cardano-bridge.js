/**
 * Cardano CIP-30 Bridge for Unity WebGL
 * 
 * Pure CIP-30 + CSL implementation - no MeshJS dependency.
 * Uses cardano-serialization-lib (CSL) from CDN for transaction building.
 * 
 * Required: Load CSL WASM before this script:
 * <script src="https://unpkg.com/@emurgo/cardano-serialization-lib-browser@12.0.0/cardano_serialization_lib.js"></script>
 */

(function() {
  'use strict';

  // ============================================================
  // State
  // ============================================================
  let walletApi = null;
  let walletName = null;
  let networkId = null; // 0 = testnet, 1 = mainnet
  let CSL = null;

  // ============================================================
  // Initialization
  // ============================================================
  
  /**
   * Wait for CSL to be ready (handles async WASM loading race condition)
   * Polls every 100ms for up to 10 seconds
   */
  async function waitForCSL(maxWaitMs = 10000) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitMs) {
      // Check all possible CSL global names
      if (window.CSL && window.CSLReady) {
        console.log('[CardanoBridge] Found window.CSL (CSLReady=true)');
        return window.CSL;
      }
      if (typeof CardanoWasm !== 'undefined') {
        console.log('[CardanoBridge] Found CardanoWasm global');
        return CardanoWasm;
      }
      if (typeof window.CardanoSerializationLib !== 'undefined') {
        console.log('[CardanoBridge] Found CardanoSerializationLib global');
        return window.CardanoSerializationLib;
      }
      
      // Wait 100ms before next check
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    return null; // Timeout
  }

  /**
   * Initialize the bridge. Waits for CSL WASM to be ready.
   */
  async function init() {
    console.log('[CardanoBridge] Waiting for CSL...');
    
    // Wait for CSL to be available (handles race condition)
    const cslModule = await waitForCSL(10000);
    
    if (!cslModule) {
      throw new Error('CSL not loaded after 10s. Ensure csl.bundle.js is loaded before cardano-bridge.js');
    }
    
    // Check if CSL needs async initialization (some CDN versions)
    if (typeof cslModule.default === 'function' && !window.CSLReady) {
      console.log('[CardanoBridge] Initializing CSL WASM...');
      await cslModule.default();
      console.log('[CardanoBridge] CSL WASM initialized');
    }
    
    CSL = cslModule;
    console.log('[CardanoBridge] CSL loaded, exports:', Object.keys(CSL).filter(k => !k.startsWith('__')).length);
    
    window.CardanoBridgeReady = true;
    console.log('[CardanoBridge] Initialized');
    return true;
  }

  // ============================================================
  // Wallet Detection & Connection
  // ============================================================

  /**
   * Check if Lace wallet is available
   */
  function isLaceAvailable() {
    return !!(window.cardano && window.cardano.lace);
  }

  /**
   * Check if any CIP-30 wallet is available
   */
  function getAvailableWallets() {
    if (!window.cardano) return [];
    const wallets = [];
    const known = ['lace', 'eternl', 'nami', 'flint', 'yoroi', 'typhon', 'gerowallet'];
    for (const name of known) {
      if (window.cardano[name]) {
        wallets.push(name);
      }
    }
    return wallets;
  }

  /**
   * Connect to Lace wallet (or specified wallet)
   * MUST be called from user gesture (button click)
   */
  async function connectWallet(walletNameParam) {
    const name = walletNameParam || 'lace';
    
    if (!window.cardano) {
      throw new Error('No Cardano wallet extension detected');
    }
    
    if (!window.cardano[name]) {
      throw new Error(`Wallet "${name}" not found. Available: ${getAvailableWallets().join(', ')}`);
    }

    console.log(`[CardanoBridge] Connecting to ${name}...`);
    
    try {
      walletApi = await window.cardano[name].enable();
      walletName = name;
      networkId = await walletApi.getNetworkId();
      
      const addresses = await walletApi.getUsedAddresses();
      const changeAddr = await walletApi.getChangeAddress();
      
      console.log(`[CardanoBridge] Connected to ${name}, network: ${networkId === 0 ? 'testnet' : 'mainnet'}`);
      
      return {
        success: true,
        wallet: name,
        networkId: networkId,
        networkName: networkId === 0 ? 'testnet' : 'mainnet',
        addressCount: addresses.length,
        changeAddress: changeAddr
      };
    } catch (err) {
      walletApi = null;
      walletName = null;
      throw new Error(`Failed to connect to ${name}: ${err.message}`);
    }
  }

  /**
   * Disconnect wallet
   */
  function disconnectWallet() {
    walletApi = null;
    walletName = null;
    networkId = null;
    console.log('[CardanoBridge] Disconnected');
    return true;
  }

  /**
   * Check if wallet is connected
   */
  function isConnected() {
    return walletApi !== null;
  }

  // ============================================================
  // Address Functions
  // ============================================================

  /**
   * Get used addresses (hex encoded)
   */
  async function getUsedAddresses() {
    if (!walletApi) throw new Error('Wallet not connected');
    return await walletApi.getUsedAddresses();
  }

  /**
   * Get used addresses as bech32
   */
  async function getUsedAddressesBech32() {
    if (!walletApi) throw new Error('Wallet not connected');
    if (!CSL) throw new Error('CSL not initialized');
    
    const hexAddresses = await walletApi.getUsedAddresses();
    return hexAddresses.map(hex => {
      const addr = CSL.Address.from_bytes(hexToBytes(hex));
      return addr.to_bech32();
    });
  }

  /**
   * Get change address (hex)
   */
  async function getChangeAddress() {
    if (!walletApi) throw new Error('Wallet not connected');
    return await walletApi.getChangeAddress();
  }

  /**
   * Get change address as bech32
   */
  async function getChangeAddressBech32() {
    if (!walletApi) throw new Error('Wallet not connected');
    if (!CSL) throw new Error('CSL not initialized');
    
    const hex = await walletApi.getChangeAddress();
    const addr = CSL.Address.from_bytes(hexToBytes(hex));
    return addr.to_bech32();
  }

  // ============================================================
  // UTxO Functions
  // ============================================================

  /**
   * Get UTxOs (raw hex from CIP-30)
   */
  async function getUtxosHex() {
    if (!walletApi) throw new Error('Wallet not connected');
    return await walletApi.getUtxos();
  }

  /**
   * Get UTxOs parsed into readable format
   */
  async function getUtxos() {
    if (!walletApi) throw new Error('Wallet not connected');
    if (!CSL) throw new Error('CSL not initialized');
    
    const utxosHex = await walletApi.getUtxos();
    if (!utxosHex || utxosHex.length === 0) return [];
    
    const utxos = [];
    for (const hex of utxosHex) {
      try {
        const utxo = CSL.TransactionUnspentOutput.from_bytes(hexToBytes(hex));
        const input = utxo.input();
        const output = utxo.output();
        const amount = output.amount();
        
        utxos.push({
          txHash: bytesToHex(input.transaction_id().to_bytes()),
          outputIndex: input.index(),
          address: output.address().to_bech32(),
          lovelace: amount.coin().to_str(),
          // Multi-asset parsing omitted for simplicity
        });
      } catch (e) {
        console.warn('[CardanoBridge] Failed to parse UTxO:', e);
      }
    }
    
    return utxos;
  }

  /**
   * Get total lovelace balance from UTxOs
   * NOTE: This is an approximation - for accurate balance use an indexer
   */
  async function getBalance() {
    const utxos = await getUtxos();
    let total = BigInt(0);
    for (const utxo of utxos) {
      total += BigInt(utxo.lovelace);
    }
    return total.toString();
  }

  // ============================================================
  // Transaction Building
  // ============================================================

  /**
   * Build and send a simple ADA payment
   * @param {string} toAddressBech32 - Recipient address
   * @param {string} lovelaceAmount - Amount in lovelace (as string)
   * @returns {Promise<{txHash: string}>}
   */
  async function buildAndSendPayment(toAddressBech32, lovelaceAmount) {
    if (!walletApi) throw new Error('Wallet not connected');
    if (!CSL) throw new Error('CSL not initialized');

    console.log(`[CardanoBridge] Building payment: ${lovelaceAmount} lovelace to ${toAddressBech32}`);

    // 1. Get UTxOs
    const utxosHex = await walletApi.getUtxos();
    if (!utxosHex || utxosHex.length === 0) {
      throw new Error('No UTxOs available');
    }

    // 2. Parse UTxOs
    const utxos = [];
    for (const hex of utxosHex) {
      utxos.push(CSL.TransactionUnspentOutput.from_bytes(hexToBytes(hex)));
    }

    // 3. Get change address
    const changeAddrHex = await walletApi.getChangeAddress();
    const changeAddr = CSL.Address.from_bytes(hexToBytes(changeAddrHex));

    // 4. Parse recipient address
    const toAddr = CSL.Address.from_bech32(toAddressBech32);

    // 5. Build transaction
    const txBuilder = CSL.TransactionBuilder.new(
      CSL.TransactionBuilderConfigBuilder.new()
        .fee_algo(CSL.LinearFee.new(
          CSL.BigNum.from_str('44'),      // coefficient
          CSL.BigNum.from_str('155381')   // constant
        ))
        .pool_deposit(CSL.BigNum.from_str('500000000'))
        .key_deposit(CSL.BigNum.from_str('2000000'))
        .max_value_size(5000)
        .max_tx_size(16384)
        .coins_per_utxo_byte(CSL.BigNum.from_str('4310'))
        .build()
    );

    // 6. Add output
    txBuilder.add_output(
      CSL.TransactionOutput.new(
        toAddr,
        CSL.Value.new(CSL.BigNum.from_str(lovelaceAmount))
      )
    );

    // 7. Add inputs (simple selection - use all UTxOs)
    for (const utxo of utxos) {
      txBuilder.add_input(
        utxo.output().address(),
        utxo.input(),
        utxo.output().amount()
      );
    }

    // 8. Set TTL (current slot + 2 hours)
    // For testnet, we estimate slot. In production, query from node/indexer.
    const currentSlot = Math.floor(Date.now() / 1000) - 1596491091 + 4924800; // Rough preprod estimate
    txBuilder.set_ttl(CSL.BigNum.from_str(String(currentSlot + 7200)));

    // 9. Add change
    txBuilder.add_change_if_needed(changeAddr);

    // 10. Build transaction body
    const txBody = txBuilder.build();
    
    // 11. Create unsigned transaction
    const tx = CSL.Transaction.new(
      txBody,
      CSL.TransactionWitnessSet.new()
    );

    // 12. Sign via CIP-30
    console.log('[CardanoBridge] Requesting signature...');
    const txHex = bytesToHex(tx.to_bytes());
    const witnessSetHex = await walletApi.signTx(txHex, true);

    // 13. Assemble signed transaction
    const witnessSet = CSL.TransactionWitnessSet.from_bytes(hexToBytes(witnessSetHex));
    const signedTx = CSL.Transaction.new(txBody, witnessSet);
    const signedTxHex = bytesToHex(signedTx.to_bytes());

    // 14. Submit via CIP-30
    console.log('[CardanoBridge] Submitting transaction...');
    const txHash = await walletApi.submitTx(signedTxHex);

    console.log('[CardanoBridge] Transaction submitted:', txHash);
    return { txHash };
  }

  // ============================================================
  // Plutus Script Interaction (for counter contract)
  // ============================================================

  /**
   * Build and send a Plutus script transaction
   * @param {object} params - Transaction parameters
   * @returns {Promise<{txHash: string}>}
   */
  async function buildAndSendPlutusTransaction(params) {
    if (!walletApi) throw new Error('Wallet not connected');
    if (!CSL) throw new Error('CSL not initialized');

    const {
      scriptCbor,        // Plutus script CBOR hex
      scriptAddress,     // Script address bech32
      inputTxHash,       // UTxO to spend from script
      inputIndex,        // UTxO output index
      inputValue,        // Value at script UTxO (lovelace string)
      datumCbor,         // New datum CBOR hex
      redeemerCbor,      // Redeemer CBOR hex
      collateralTxHash,  // Collateral UTxO tx hash
      collateralIndex,   // Collateral UTxO index
    } = params;

    console.log('[CardanoBridge] Building Plutus transaction...');

    // Get wallet UTxOs for fees
    const utxosHex = await walletApi.getUtxos();
    const utxos = utxosHex.map(hex => CSL.TransactionUnspentOutput.from_bytes(hexToBytes(hex)));

    // Get change address
    const changeAddrHex = await walletApi.getChangeAddress();
    const changeAddr = CSL.Address.from_bytes(hexToBytes(changeAddrHex));

    // Parse script address
    const scriptAddr = CSL.Address.from_bech32(scriptAddress);

    // Create transaction builder
    const txBuilder = CSL.TransactionBuilder.new(
      CSL.TransactionBuilderConfigBuilder.new()
        .fee_algo(CSL.LinearFee.new(
          CSL.BigNum.from_str('44'),
          CSL.BigNum.from_str('155381')
        ))
        .pool_deposit(CSL.BigNum.from_str('500000000'))
        .key_deposit(CSL.BigNum.from_str('2000000'))
        .max_value_size(5000)
        .max_tx_size(16384)
        .coins_per_utxo_byte(CSL.BigNum.from_str('4310'))
        .ex_unit_prices(CSL.ExUnitPrices.new(
          CSL.UnitInterval.new(CSL.BigNum.from_str('577'), CSL.BigNum.from_str('10000')),
          CSL.UnitInterval.new(CSL.BigNum.from_str('721'), CSL.BigNum.from_str('10000000'))
        ))
        .build()
    );

    // Add script input
    const scriptInputId = CSL.TransactionInput.new(
      CSL.TransactionHash.from_bytes(hexToBytes(inputTxHash)),
      CSL.BigNum.from_str(String(inputIndex))
    );

    // Create PlutusData for redeemer
    const redeemer = CSL.Redeemer.new(
      CSL.RedeemerTag.new_spend(),
      CSL.BigNum.from_str('0'),
      CSL.PlutusData.from_bytes(hexToBytes(redeemerCbor)),
      CSL.ExUnits.new(
        CSL.BigNum.from_str('500000'),    // mem
        CSL.BigNum.from_str('200000000')  // steps
      )
    );

    // Add Plutus script witness
    const plutusScript = CSL.PlutusScript.from_bytes(hexToBytes(scriptCbor));
    
    // Build witness set with script
    const plutusScripts = CSL.PlutusScripts.new();
    plutusScripts.add(plutusScript);

    const redeemers = CSL.Redeemers.new();
    redeemers.add(redeemer);

    // Add script input with datum
    txBuilder.add_input(
      scriptAddr,
      scriptInputId,
      CSL.Value.new(CSL.BigNum.from_str(inputValue))
    );

    // Add output back to script with new datum
    const newDatum = CSL.PlutusData.from_bytes(hexToBytes(datumCbor));
    const outputBuilder = CSL.TransactionOutputBuilder.new()
      .with_address(scriptAddr)
      .with_data_hash(CSL.hash_plutus_data(newDatum));
    
    txBuilder.add_output(
      outputBuilder.next()
        .with_value(CSL.Value.new(CSL.BigNum.from_str(inputValue)))
        .build()
    );

    // Add wallet inputs for fees
    for (const utxo of utxos) {
      txBuilder.add_input(
        utxo.output().address(),
        utxo.input(),
        utxo.output().amount()
      );
    }

    // Set collateral
    const collateralInput = CSL.TransactionInput.new(
      CSL.TransactionHash.from_bytes(hexToBytes(collateralTxHash)),
      CSL.BigNum.from_str(String(collateralIndex))
    );
    
    const collateralInputs = CSL.TransactionInputs.new();
    collateralInputs.add(collateralInput);
    txBuilder.set_collateral(collateralInputs);

    // Set TTL
    const currentSlot = Math.floor(Date.now() / 1000) - 1596491091 + 4924800;
    txBuilder.set_ttl(CSL.BigNum.from_str(String(currentSlot + 7200)));

    // Add change
    txBuilder.add_change_if_needed(changeAddr);

    // Build transaction
    const txBody = txBuilder.build();

    // Create witness set
    const witnessSet = CSL.TransactionWitnessSet.new();
    witnessSet.set_plutus_scripts(plutusScripts);
    witnessSet.set_redeemers(redeemers);

    // Add datum to witness set
    const datums = CSL.PlutusList.new();
    datums.add(newDatum);
    witnessSet.set_plutus_data(datums);

    // Create unsigned transaction
    const tx = CSL.Transaction.new(txBody, witnessSet);

    // Sign via CIP-30
    console.log('[CardanoBridge] Requesting signature...');
    const txHex = bytesToHex(tx.to_bytes());
    const signedWitnessHex = await walletApi.signTx(txHex, true);

    // Merge witness sets
    const signedWitness = CSL.TransactionWitnessSet.from_bytes(hexToBytes(signedWitnessHex));
    
    // Combine witnesses
    const finalWitness = CSL.TransactionWitnessSet.new();
    finalWitness.set_plutus_scripts(plutusScripts);
    finalWitness.set_redeemers(redeemers);
    finalWitness.set_plutus_data(datums);
    
    if (signedWitness.vkeys()) {
      finalWitness.set_vkeys(signedWitness.vkeys());
    }

    // Create final signed transaction
    const signedTx = CSL.Transaction.new(txBody, finalWitness);
    const signedTxHex = bytesToHex(signedTx.to_bytes());

    // Submit
    console.log('[CardanoBridge] Submitting Plutus transaction...');
    const txHash = await walletApi.submitTx(signedTxHex);

    console.log('[CardanoBridge] Plutus transaction submitted:', txHash);
    return { txHash };
  }

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

  // ============================================================
  // Counter Increment (Pure CSL + Blockfrost)
  // ============================================================

  // Compiled Aiken counter script (Plutus V3)
  const COUNTER_SCRIPT_CBOR = "59016901010029800aba2aba1aba0aab9faab9eaab9dab9a488888896600264653001300800198041804800cc0200092225980099b8748008c01cdd500144ca60026018003300c300d0019b874800122259800980098059baa0078acc004c030dd5003c566002600260166ea800a26464b30013003300d3754003133223259800980318081baa0018992cc004cdc3a400860226ea8006266e1cdd6980a98091baa001337006eb4c054c048dd500424005164040600460226ea8c050c044dd5000c5900f198021bac300130103754012466ebcc050c044dd5000801980898071baa30113012300e37546022601c6ea80048c048c04cc04c0062c8060cc004dd6180818069baa00623375e6022601c6ea800401488c8cc00400400c896600200314c0103d87a80008992cc004c010006266e952000330130014bd7044cc00c00cc05400900f1809800a0228b20148b201a8b201418041baa0028b200c180400098019baa0088a4d13656400401";

  /**
   * Increment an Aiken counter smart contract using pure CSL + Blockfrost
   * @param {string} scriptAddress - Bech32 script address
   * @param {string} blockfrostKey - Blockfrost API key
   * @returns {Promise<{txHash: string, oldValue: string, newValue: string}>}
   */
  async function incrementCounter(scriptAddress, blockfrostKey) {
    // Use window.__walletApi if CardanoBridge's internal walletApi is not set
    // (wallet may have been connected via MidnightWebGL.jslib)
    const activeWalletApi = walletApi || window.__walletApi;
    
    if (!activeWalletApi) throw new Error('Wallet not connected');
    if (!CSL) throw new Error('CSL not initialized');
    if (!blockfrostKey) throw new Error('Blockfrost API key required');

    console.log('[CardanoBridge] Incrementing counter at:', scriptAddress);

    // Determine network from wallet API or window state
    let activeNetworkId = networkId;
    if (activeNetworkId === null && window.__walletNetworkId !== undefined) {
      activeNetworkId = window.__walletNetworkId;
    }
    if (activeNetworkId === null) {
      // Try to get from wallet
      try {
        activeNetworkId = await activeWalletApi.getNetworkId();
      } catch (e) {
        activeNetworkId = 0; // Default to testnet
      }
    }

    // Determine Blockfrost API URL based on network
    const blockfrostUrl = activeNetworkId === 0 
      ? 'https://cardano-preprod.blockfrost.io/api/v0'
      : 'https://cardano-mainnet.blockfrost.io/api/v0';

    // Fetch UTxOs at script address from Blockfrost
    console.log('[CardanoBridge] Fetching script UTxOs from Blockfrost...');
    const utxoResponse = await fetch(`${blockfrostUrl}/addresses/${scriptAddress}/utxos`, {
      headers: { 'project_id': blockfrostKey }
    });

    if (!utxoResponse.ok) {
      const errText = await utxoResponse.text();
      throw new Error(`Blockfrost error: ${utxoResponse.status} - ${errText}`);
    }

    const scriptUtxos = await utxoResponse.json();
    console.log('[CardanoBridge] Found', scriptUtxos.length, 'UTxOs at script');

    if (scriptUtxos.length === 0) {
      throw new Error('No UTxOs found at script address');
    }

    // Find UTxO with inline datum
    let scriptUtxo = null;
    for (const utxo of scriptUtxos) {
      if (utxo.inline_datum) {
        scriptUtxo = utxo;
        console.log('[CardanoBridge] Found UTxO with inline datum:', utxo.tx_hash, utxo.tx_index);
        break;
      }
    }

    if (!scriptUtxo) {
      throw new Error('No UTxO with inline datum found at script');
    }

    // Decode current counter value from inline datum CBOR
    const datumCbor = scriptUtxo.inline_datum;
    let currentValue = 0n;
    try {
      // CBOR integer decoding
      const firstByte = parseInt(datumCbor.substring(0, 2), 16);
      if (firstByte <= 0x17) {
        currentValue = BigInt(firstByte);
      } else if (firstByte === 0x18) {
        currentValue = BigInt(parseInt(datumCbor.substring(2, 4), 16));
      } else if (firstByte === 0x19) {
        currentValue = BigInt(parseInt(datumCbor.substring(2, 6), 16));
      } else if (firstByte === 0x1a) {
        currentValue = BigInt(parseInt(datumCbor.substring(2, 10), 16));
      }
    } catch (e) {
      console.warn('[CardanoBridge] Could not decode datum, assuming 0');
    }

    console.log('[CardanoBridge] Current counter value:', currentValue.toString());
    const newValue = currentValue + 1n;
    console.log('[CardanoBridge] New counter value:', newValue.toString());

    // Get wallet UTxOs and addresses
    const walletUtxosHex = await activeWalletApi.getUtxos();
    const changeAddrHex = await activeWalletApi.getChangeAddress();
    const changeAddr = CSL.Address.from_bytes(hexToBytes(changeAddrHex));

    // Get collateral
    let collateralUtxos;
    try {
      collateralUtxos = await activeWalletApi.getCollateral();
    } catch (e) {
      throw new Error('No collateral available. Please set collateral in your wallet.');
    }

    if (!collateralUtxos || collateralUtxos.length === 0) {
      throw new Error('No collateral set in wallet. Please set collateral in Lace wallet settings.');
    }

    // Parse collateral UTxO
    const collateralUtxo = CSL.TransactionUnspentOutput.from_bytes(hexToBytes(collateralUtxos[0]));

    // Calculate script UTxO value (sum of all amounts)
    let scriptLovelace = '0';
    for (const amt of scriptUtxo.amount) {
      if (amt.unit === 'lovelace') {
        scriptLovelace = amt.quantity;
        break;
      }
    }

    // Create new datum CBOR for incremented value
    let newDatumCbor;
    if (newValue < 24n) {
      newDatumCbor = newValue.toString(16).padStart(2, '0');
    } else if (newValue < 256n) {
      newDatumCbor = '18' + newValue.toString(16).padStart(2, '0');
    } else if (newValue < 65536n) {
      newDatumCbor = '19' + newValue.toString(16).padStart(4, '0');
    } else {
      newDatumCbor = '1a' + newValue.toString(16).padStart(8, '0');
    }

    // Create redeemer CBOR (constructor 0, no fields = Increment)
    // CBOR: d87980 = constructor 0 with empty array
    const redeemerCbor = 'd87980';

    console.log('[CardanoBridge] Building Plutus transaction...');

    // Parse script address
    const scriptAddr = CSL.Address.from_bech32(scriptAddress);

    // Create transaction builder with Plutus V3 parameters
    const txBuilder = CSL.TransactionBuilder.new(
      CSL.TransactionBuilderConfigBuilder.new()
        .fee_algo(CSL.LinearFee.new(
          CSL.BigNum.from_str('44'),
          CSL.BigNum.from_str('155381')
        ))
        .pool_deposit(CSL.BigNum.from_str('500000000'))
        .key_deposit(CSL.BigNum.from_str('2000000'))
        .max_value_size(5000)
        .max_tx_size(16384)
        .coins_per_utxo_byte(CSL.BigNum.from_str('4310'))
        .ex_unit_prices(CSL.ExUnitPrices.new(
          CSL.UnitInterval.new(CSL.BigNum.from_str('577'), CSL.BigNum.from_str('10000')),
          CSL.UnitInterval.new(CSL.BigNum.from_str('721'), CSL.BigNum.from_str('10000000'))
        ))
        .build()
    );

    // Add script input
    const scriptInputId = CSL.TransactionInput.new(
      CSL.TransactionHash.from_bytes(hexToBytes(scriptUtxo.tx_hash)),
      CSL.BigNum.from_str(String(scriptUtxo.tx_index))
    );

    // Create redeemer
    const redeemer = CSL.Redeemer.new(
      CSL.RedeemerTag.new_spend(),
      CSL.BigNum.from_str('0'),
      CSL.PlutusData.from_bytes(hexToBytes(redeemerCbor)),
      CSL.ExUnits.new(
        CSL.BigNum.from_str('500000'),    // mem
        CSL.BigNum.from_str('200000000')  // steps
      )
    );

    // Parse Plutus script
    const plutusScript = CSL.PlutusScript.from_bytes(hexToBytes(COUNTER_SCRIPT_CBOR));
    
    // Build witness components
    const plutusScripts = CSL.PlutusScripts.new();
    plutusScripts.add(plutusScript);

    const redeemers = CSL.Redeemers.new();
    redeemers.add(redeemer);

    // Add script input
    txBuilder.add_input(
      scriptAddr,
      scriptInputId,
      CSL.Value.new(CSL.BigNum.from_str(scriptLovelace))
    );

    // Add output back to script with new datum
    const newDatum = CSL.PlutusData.from_bytes(hexToBytes(newDatumCbor));
    const outputBuilder = CSL.TransactionOutputBuilder.new()
      .with_address(scriptAddr)
      .with_data_hash(CSL.hash_plutus_data(newDatum));
    
    txBuilder.add_output(
      outputBuilder.next()
        .with_value(CSL.Value.new(CSL.BigNum.from_str(scriptLovelace)))
        .build()
    );

    // Add wallet inputs for fees
    for (const utxoHex of walletUtxosHex) {
      const utxo = CSL.TransactionUnspentOutput.from_bytes(hexToBytes(utxoHex));
      txBuilder.add_input(
        utxo.output().address(),
        utxo.input(),
        utxo.output().amount()
      );
    }

    // Set collateral
    const collateralInputs = CSL.TransactionInputs.new();
    collateralInputs.add(collateralUtxo.input());
    txBuilder.set_collateral(collateralInputs);

    // Set TTL (current slot + 2 hours)
    const currentSlot = Math.floor(Date.now() / 1000) - 1596491091 + 4924800;
    txBuilder.set_ttl(CSL.BigNum.from_str(String(currentSlot + 7200)));

    // Add change
    txBuilder.add_change_if_needed(changeAddr);

    // Build transaction body
    const txBody = txBuilder.build();

    // Create witness set
    const witnessSet = CSL.TransactionWitnessSet.new();
    witnessSet.set_plutus_scripts(plutusScripts);
    witnessSet.set_redeemers(redeemers);

    // Add datum to witness set
    const datums = CSL.PlutusList.new();
    datums.add(newDatum);
    // Also add original datum for validation
    datums.add(CSL.PlutusData.from_bytes(hexToBytes(datumCbor)));
    witnessSet.set_plutus_data(datums);

    // Create unsigned transaction
    const tx = CSL.Transaction.new(txBody, witnessSet);

    // Sign via CIP-30
    console.log('[CardanoBridge] Requesting wallet signature...');
    const txHex = bytesToHex(tx.to_bytes());
    const signedWitnessHex = await activeWalletApi.signTx(txHex, true);

    // Merge witness sets
    const signedWitness = CSL.TransactionWitnessSet.from_bytes(hexToBytes(signedWitnessHex));
    
    // Combine witnesses
    const finalWitness = CSL.TransactionWitnessSet.new();
    finalWitness.set_plutus_scripts(plutusScripts);
    finalWitness.set_redeemers(redeemers);
    finalWitness.set_plutus_data(datums);
    
    if (signedWitness.vkeys()) {
      finalWitness.set_vkeys(signedWitness.vkeys());
    }

    // Create final signed transaction
    const signedTx = CSL.Transaction.new(txBody, finalWitness);
    const signedTxHex = bytesToHex(signedTx.to_bytes());

    // Submit
    console.log('[CardanoBridge] Submitting transaction...');
    const txHash = await activeWalletApi.submitTx(signedTxHex);

    console.log('[CardanoBridge] Counter incremented! TxHash:', txHash);
    return {
      txHash,
      oldValue: currentValue.toString(),
      newValue: newValue.toString()
    };
  }

  // ============================================================
  // Expose API
  // ============================================================

  window.CardanoBridge = {
    // Initialization
    init,
    
    // Wallet detection
    isLaceAvailable,
    getAvailableWallets,
    
    // Connection
    connectWallet,
    disconnectWallet,
    isConnected,
    
    // Addresses
    getUsedAddresses,
    getUsedAddressesBech32,
    getChangeAddress,
    getChangeAddressBech32,
    
    // UTxOs
    getUtxosHex,
    getUtxos,
    getBalance,
    
    // Transactions
    buildAndSendPayment,
    buildAndSendPlutusTransaction,
    incrementCounter,
    
    // Utilities
    hexToBytes,
    bytesToHex,
    
    // State getters
    getWalletName: () => walletName,
    getNetworkId: () => networkId,
    getCSL: () => CSL,
  };

  console.log('[CardanoBridge] API exposed on window.CardanoBridge');

})();
