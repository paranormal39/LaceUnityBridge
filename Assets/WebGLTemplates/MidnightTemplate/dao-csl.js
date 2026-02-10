/**
 * DAO-CSL - Pure CSL + CIP-30 + Blockfrost implementation for Simple DAO
 * For Unity WebGL - No backend, no Mesh/Lucid/Blaze
 * 
 * Operations:
 * - FetchProposals: Read all proposals from script UTxOs (no script execution)
 * - CreateProposal: Send 2 ADA to script with inline datum (no script execution)
 * - VoteOnProposal: Spend proposal UTxO with vote redeemer (script execution)
 * 
 * Prerequisites:
 * - window.CSL loaded (from csl.bundle.js)
 * - window.__walletApi connected (CIP-30 wallet)
 */

(function() {
  'use strict';

  // ============================================================
  // DAO Constants
  // ============================================================
  var DAO_SCRIPT_ADDRESS = 'addr_test1wzgxsphtczfamr2cljp80e48544vwp3p4u9n68702t6psgcnkt88j';
  var DAO_SCRIPT_HASH = '906806ebc093dd8d58fc8277e6a7a56ac70621af0b3d1fcf52f41823';
  var DAO_VALIDATOR_CBOR = '59037201010029800aba2aba1aba0aab9faab9eaab9dab9a488888896600264653001300800198041804800cdc3a400530080024888966002600460106ea800e2653001300d00198069807000cdc3a4000911192cc004c008c034dd5004c4c966002602600313232598009802800c56600260226ea800a0091640491598009805000c56600260226ea800a00916404915980099b87480100062b3001301137540050048b20248b201e403c8078c03cdd50009809000c5901018071baa0098b2018159800980098061baa00289919912cc004c010c03cdd500144c8cc88c966002601060266ea8006264b30013370e9002180a1baa0018992cc004c028c054dd5000c4c8c8c8c8c8ca60026eb4c07c0066eb8c07c01a6eb8c07c0166eb8c07c0126eb4c07c00e6eb4c07c009222222598009813003c566002b30013371e6eb8c094c088dd50069bae30253022375402715980099b8f375c602460446ea8034dd7180918111baa013899b8f375c602060446ea8034dd7180818111baa0138a50408114a08102330012302630273027302730273027001918131813981398139813800c8c098c09cc09cc09c00660426ea8c094c088dd500ecdc024004911114c004dc39bad300330273754025370e6eb4c010c09cdd50094dc39bad3005302737540249112cc004c0780162b300130033004375a600c60546ea806e2b30013002375a600e60546ea806e260026eb4c020c0a8dd500dc52820508a5040a11598009811802c56600260066eb4c018c0a8dd500dc566002600460086eb4c01cc0a8dd500dc4c004dd6980418151baa01b8a5040a114a081422b30013003375a600c60546ea806e2b30013002375a600e60546ea806e2600260086eb4c020c0a8dd500dc52820508a5040a08141028114a081022c8118603e002603c002603a00260380026036002602c6ea80062c80a0c060c054dd5000c590131801180a1baa3017301437540031640486600c6eb0c004c04cdd5005919baf301730143754002006602860226ea8c004c044dd5180a18089baa00323015301630160012301430150018b201c3300137586022601c6ea80188cdd7980918079baa0010053011300e375400644646600200200644b30010018a6103d87a80008992cc004c010006266e952000330140014bd7044cc00c00cc058009010180a000a0248b201618049baa0038b200e180400098019baa0088a4d13656400401';

  // ============================================================
  // Helper Functions
  // ============================================================

  function hexToBytes(hex) {
    if (hex.length % 2 !== 0) hex = '0' + hex;
    var bytes = new Uint8Array(hex.length / 2);
    for (var i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return bytes;
  }

  function bytesToHex(bytes) {
    return Array.from(bytes).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  function utf8ToHex(str) {
    var bytes = new TextEncoder().encode(str);
    return bytesToHex(bytes);
  }

  function hexToUtf8(hex) {
    var bytes = hexToBytes(hex);
    return new TextDecoder().decode(bytes);
  }

  // ============================================================
  // CBOR Encoding/Decoding Helpers
  // ============================================================

  /**
   * Encode a non-negative BigInt as CBOR major type 0 (unsigned integer)
   */
  function encodeCborUint(n) {
    if (n < 0n) throw new Error('encodeCborUint: negative value');
    if (n <= 23n) return [Number(n)];
    if (n <= 0xffn) return [0x18, Number(n)];
    if (n <= 0xffffn) return [0x19, Number(n >> 8n) & 0xff, Number(n) & 0xff];
    if (n <= 0xffffffffn) {
      var v = Number(n);
      return [0x1a, (v >> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
    }
    // 8-byte
    var hi = Number(n >> 32n);
    var lo = Number(n & 0xffffffffn);
    return [0x1b,
      (hi >> 24) & 0xff, (hi >> 16) & 0xff, (hi >> 8) & 0xff, hi & 0xff,
      (lo >> 24) & 0xff, (lo >> 16) & 0xff, (lo >> 8) & 0xff, lo & 0xff
    ];
  }

  /**
   * Encode a byte string as CBOR major type 2
   */
  function encodeCborBytes(bytes) {
    var len = bytes.length;
    var header;
    if (len <= 23) header = [0x40 + len];
    else if (len <= 0xff) header = [0x58, len];
    else if (len <= 0xffff) header = [0x59, (len >> 8) & 0xff, len & 0xff];
    else header = [0x5a, (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff];
    return header.concat(Array.from(bytes));
  }

  /**
   * Build ProposalDatum as Constr 0 with 6 fields using CSL PlutusData
   * Fields: [policy_id(bytes), title(bytes), description(bytes), yes(int), no(int), appeal(int)]
   */
  function buildProposalDatum(CSL, policyId, title, description, yesCount, noCount, appealCount) {
    var fields = CSL.PlutusList.new();
    
    // Field 0: policy_id as bytes
    fields.add(CSL.PlutusData.new_bytes(hexToBytes(utf8ToHex(policyId))));
    // Field 1: title as bytes
    fields.add(CSL.PlutusData.new_bytes(hexToBytes(utf8ToHex(title))));
    // Field 2: description as bytes
    fields.add(CSL.PlutusData.new_bytes(hexToBytes(utf8ToHex(description))));
    // Field 3: yes_count
    fields.add(CSL.PlutusData.new_integer(CSL.BigInt.from_str(yesCount.toString())));
    // Field 4: no_count
    fields.add(CSL.PlutusData.new_integer(CSL.BigInt.from_str(noCount.toString())));
    // Field 5: appeal_count
    fields.add(CSL.PlutusData.new_integer(CSL.BigInt.from_str(appealCount.toString())));
    
    return CSL.PlutusData.new_constr_plutus_data(
      CSL.ConstrPlutusData.new(CSL.BigNum.from_str('0'), fields)
    );
  }

  /**
   * Build vote redeemer: Constr(0, [VoteOption])
   * VoteOption: Yes=Constr(0,[]), No=Constr(1,[]), Appeal=Constr(2,[])
   */
  function buildVoteRedeemer(CSL, voteType) {
    var voteIndex;
    if (voteType === 'yes') voteIndex = 0;
    else if (voteType === 'no') voteIndex = 1;
    else if (voteType === 'appeal') voteIndex = 2;
    else throw new Error('Invalid vote type: ' + voteType + '. Must be yes, no, or appeal.');
    
    // Inner: VoteOption = Constr(voteIndex, [])
    var emptyFields = CSL.PlutusList.new();
    var voteOption = CSL.PlutusData.new_constr_plutus_data(
      CSL.ConstrPlutusData.new(CSL.BigNum.from_str(voteIndex.toString()), emptyFields)
    );
    
    // Outer: Constr(0, [VoteOption])
    var outerFields = CSL.PlutusList.new();
    outerFields.add(voteOption);
    return CSL.PlutusData.new_constr_plutus_data(
      CSL.ConstrPlutusData.new(CSL.BigNum.from_str('0'), outerFields)
    );
  }

  /**
   * Parse a ProposalDatum from inline_datum hex string
   * Returns { policyId, title, description, yesCount, noCount, appealCount } or null
   */
  function parseProposalDatum(inlineDatumHex) {
    try {
      var CSL = window.CSL;
      var pd = CSL.PlutusData.from_hex(inlineDatumHex);
      var constr = pd.as_constr_plutus_data();
      if (!constr) {
        console.log('[DAO] Datum is not Constr format');
        return null;
      }
      
      var tag = constr.alternative().to_str();
      if (tag !== '0') {
        console.log('[DAO] Datum Constr tag is', tag, 'expected 0');
        return null;
      }
      
      var fields = constr.data();
      if (fields.len() < 6) {
        console.log('[DAO] Datum has', fields.len(), 'fields, expected 6');
        return null;
      }
      
      // Parse bytes fields (0, 1, 2)
      var policyIdBytes = fields.get(0).as_bytes();
      var titleBytes = fields.get(1).as_bytes();
      var descBytes = fields.get(2).as_bytes();
      
      // Parse integer fields (3, 4, 5)
      var yesCount = fields.get(3).as_integer().to_str();
      var noCount = fields.get(4).as_integer().to_str();
      var appealCount = fields.get(5).as_integer().to_str();
      
      return {
        policyId: new TextDecoder().decode(policyIdBytes),
        title: new TextDecoder().decode(titleBytes),
        description: new TextDecoder().decode(descBytes),
        yesCount: parseInt(yesCount),
        noCount: parseInt(noCount),
        appealCount: parseInt(appealCount)
      };
    } catch (e) {
      console.error('[DAO] Failed to parse proposal datum:', e.message);
      return null;
    }
  }

  // ============================================================
  // Blockfrost API Helpers
  // ============================================================

  var BLOCKFROST_BASE = 'https://cardano-preprod.blockfrost.io/api/v0';

  async function blockfrostFetch(endpoint, blockfrostKey, method, body) {
    method = method || 'GET';
    var options = {
      method: method,
      headers: {
        'project_id': blockfrostKey,
        'Content-Type': 'application/json'
      }
    };
    if (body) options.body = JSON.stringify(body);
    
    var response = await fetch(BLOCKFROST_BASE + endpoint, options);
    if (!response.ok) {
      var text = await response.text();
      throw new Error('Blockfrost ' + response.status + ': ' + text);
    }
    return response.json();
  }

  async function getProtocolParameters(blockfrostKey) {
    return blockfrostFetch('/epochs/latest/parameters', blockfrostKey);
  }

  async function getLatestBlock(blockfrostKey) {
    return blockfrostFetch('/blocks/latest', blockfrostKey);
  }

  async function fetchScriptCbor(blockfrostKey, scriptHash) {
    console.log('[DAO] Fetching script CBOR from Blockfrost for hash:', scriptHash);
    var data = await blockfrostFetch('/scripts/' + scriptHash + '/cbor', blockfrostKey);
    if (!data || !data.cbor) throw new Error('Blockfrost returned no CBOR for script ' + scriptHash);
    console.log('[DAO] Got script CBOR from Blockfrost, length:', data.cbor.length);
    return data.cbor;
  }

  function sleep(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
  }

  // ============================================================
  // Shared: toRational, buildTxBuilderConfig
  // (Same as increment-counter-csl.js)
  // ============================================================

  function toRational(value) {
    if (value && typeof value === 'object' && 'numerator' in value) {
      return { num: BigInt(value.numerator), den: BigInt(value.denominator) };
    }
    if (typeof value === 'string' && value.includes('/')) {
      var parts = value.split('/');
      return { num: BigInt(parts[0]), den: BigInt(parts[1]) };
    }
    if (typeof value === 'number') {
      var str = value.toString();
      var decIdx = str.indexOf('.');
      if (decIdx === -1) return { num: BigInt(value), den: 1n };
      var decimals = str.length - decIdx - 1;
      var den = 10n ** BigInt(decimals);
      var num = BigInt(Math.round(value * Number(den)));
      return { num: num, den: den };
    }
    if (typeof value === 'string') return toRational(parseFloat(value));
    return { num: 1n, den: 1n };
  }

  function buildTxBuilderConfig(pp, CSL) {
    var linearFee = CSL.LinearFee.new(
      CSL.BigNum.from_str(pp.min_fee_a.toString()),
      CSL.BigNum.from_str(pp.min_fee_b.toString())
    );
    var memPrice = toRational(pp.price_mem);
    var stepPrice = toRational(pp.price_step);
    var exUnitPrices = CSL.ExUnitPrices.new(
      CSL.UnitInterval.new(CSL.BigNum.from_str(memPrice.num.toString()), CSL.BigNum.from_str(memPrice.den.toString())),
      CSL.UnitInterval.new(CSL.BigNum.from_str(stepPrice.num.toString()), CSL.BigNum.from_str(stepPrice.den.toString()))
    );
    
    var configBuilder = CSL.TransactionBuilderConfigBuilder.new()
      .fee_algo(linearFee)
      .pool_deposit(CSL.BigNum.from_str(pp.pool_deposit))
      .key_deposit(CSL.BigNum.from_str(pp.key_deposit))
      .max_value_size(parseInt(pp.max_val_size))
      .max_tx_size(parseInt(pp.max_tx_size))
      .coins_per_utxo_byte(CSL.BigNum.from_str(pp.coins_per_utxo_size))
      .ex_unit_prices(exUnitPrices)
      .prefer_pure_change(true);
    
    if (pp.min_fee_ref_script_cost_per_byte && typeof configBuilder.ref_script_coins_per_byte === 'function') {
      var refPrice = toRational(pp.min_fee_ref_script_cost_per_byte);
      configBuilder = configBuilder.ref_script_coins_per_byte(
        CSL.UnitInterval.new(CSL.BigNum.from_str(refPrice.num.toString()), CSL.BigNum.from_str(refPrice.den.toString()))
      );
    }
    
    return configBuilder.build();
  }

  // ============================================================
  // Script parsing helpers (same pattern as increment-counter-csl.js)
  // ============================================================

  function unwrapCborBytes(bytes) {
    if (!bytes || bytes.length < 2) return { unwrapped: bytes, wasWrapped: false };
    var fb = bytes[0];
    if (fb === 0x58 && bytes.length > 2) {
      var len = bytes[1];
      if (bytes.length === 2 + len) return { unwrapped: bytes.slice(2), wasWrapped: true };
    } else if (fb === 0x59 && bytes.length > 3) {
      var len2 = (bytes[1] << 8) | bytes[2];
      if (bytes.length === 3 + len2) return { unwrapped: bytes.slice(3), wasWrapped: true };
    }
    return { unwrapped: bytes, wasWrapped: false };
  }

  /**
   * Parse script CBOR hex, trying multiple unwrap strategies and Plutus versions.
   * Mirrors the comprehensive approach from increment-counter-csl.js.
   * Returns { script: PlutusScript, version: 'v3'|'v2'|'v1' }
   */
  function parseScript(CSL, validatorHex, expectedHash) {
    var rawBytes = hexToBytes(validatorHex);
    
    // Collect byte variants: raw, single-unwrap, double-unwrap, envelope
    var byteVariants = [{ label: 'raw', bytes: rawBytes }];
    var r1 = unwrapCborBytes(rawBytes);
    if (r1.wasWrapped) {
      byteVariants.push({ label: 'unwrap1', bytes: r1.unwrapped });
      var r2 = unwrapCborBytes(r1.unwrapped);
      if (r2.wasWrapped) {
        byteVariants.push({ label: 'unwrap2', bytes: r2.unwrapped });
      }
    }
    // Envelope: if starts with 0x82 (CBOR array of 2), extract [version, bytes]
    if (rawBytes[0] === 0x82 && rawBytes.length > 3 && (rawBytes[1] === 0x01 || rawBytes[1] === 0x02 || rawBytes[1] === 0x03)) {
      var envVersion = rawBytes[1];
      var envInner = unwrapCborBytes(rawBytes.slice(2));
      if (envInner.wasWrapped) {
        byteVariants.push({ label: 'envelope_v' + envVersion, bytes: envInner.unwrapped });
      }
    }
    
    console.log('[DAO] parseScript: trying ' + byteVariants.length + ' byte variants');
    
    // For each byte variant, try every parsing method
    for (var i = 0; i < byteVariants.length; i++) {
      var bv = byteVariants[i];
      var b = bv.bytes;
      console.log('[DAO] Variant ' + bv.label + ': ' + b.length + ' bytes, first8=' + bytesToHex(b.slice(0, 8)));
      
      // Also prepare unwrapped version of this variant
      var bUnwrapped = unwrapCborBytes(b);
      var byteSets = [{ tag: '', bytes: b }];
      if (bUnwrapped.wasWrapped) {
        byteSets.push({ tag: '+unwrap', bytes: bUnwrapped.unwrapped });
      }
      
      for (var bs = 0; bs < byteSets.length; bs++) {
        var curBytes = byteSets[bs].bytes;
        var curTag = bv.label + byteSets[bs].tag;
        
        // Method 1: new_v3 (raw flat bytes)
        if (typeof CSL.PlutusScript.new_v3 === 'function') {
          try {
            var s = CSL.PlutusScript.new_v3(curBytes);
            var h = s.hash().to_hex();
            console.log('[DAO] ' + curTag + ' new_v3 -> ' + h);
            if (h === expectedHash) return { script: s, version: 'v3' };
          } catch (e) { console.log('[DAO] ' + curTag + ' new_v3 fail: ' + e.message); }
        }
        
        // Method 2: new_v2
        if (typeof CSL.PlutusScript.new_v2 === 'function') {
          try {
            var s2 = CSL.PlutusScript.new_v2(curBytes);
            var h2 = s2.hash().to_hex();
            console.log('[DAO] ' + curTag + ' new_v2 -> ' + h2);
            if (h2 === expectedHash) return { script: s2, version: 'v2' };
          } catch (e) { console.log('[DAO] ' + curTag + ' new_v2 fail: ' + e.message); }
        }
        
        // Method 3: new_v1
        if (typeof CSL.PlutusScript.new_v1 === 'function') {
          try {
            var s1 = CSL.PlutusScript.new_v1(curBytes);
            var h1 = s1.hash().to_hex();
            console.log('[DAO] ' + curTag + ' new_v1 -> ' + h1);
            if (h1 === expectedHash) return { script: s1, version: 'v1' };
          } catch (e) { console.log('[DAO] ' + curTag + ' new_v1 fail: ' + e.message); }
        }
        
        // Method 4: from_bytes_with_version V3
        if (typeof CSL.PlutusScript.from_bytes_with_version === 'function') {
          try {
            var sv3 = CSL.PlutusScript.from_bytes_with_version(curBytes, CSL.Language.new_plutus_v3());
            var hv3 = sv3.hash().to_hex();
            console.log('[DAO] ' + curTag + ' from_bytes_with_version(v3) -> ' + hv3);
            if (hv3 === expectedHash) return { script: sv3, version: 'v3' };
          } catch (e) { console.log('[DAO] ' + curTag + ' fbwv(v3) fail: ' + e.message); }
          try {
            var sv2 = CSL.PlutusScript.from_bytes_with_version(curBytes, CSL.Language.new_plutus_v2());
            var hv2 = sv2.hash().to_hex();
            console.log('[DAO] ' + curTag + ' from_bytes_with_version(v2) -> ' + hv2);
            if (hv2 === expectedHash) return { script: sv2, version: 'v2' };
          } catch (e) { console.log('[DAO] ' + curTag + ' fbwv(v2) fail: ' + e.message); }
        }
        
        // Method 5: from_v3, from_v2
        if (typeof CSL.PlutusScript.from_v3 === 'function') {
          try {
            var sf3 = CSL.PlutusScript.from_v3(curBytes);
            var hf3 = sf3.hash().to_hex();
            console.log('[DAO] ' + curTag + ' from_v3 -> ' + hf3);
            if (hf3 === expectedHash) return { script: sf3, version: 'v3' };
          } catch (e) { console.log('[DAO] ' + curTag + ' from_v3 fail: ' + e.message); }
        }
        if (typeof CSL.PlutusScript.from_v2 === 'function') {
          try {
            var sf2 = CSL.PlutusScript.from_v2(curBytes);
            var hf2 = sf2.hash().to_hex();
            console.log('[DAO] ' + curTag + ' from_v2 -> ' + hf2);
            if (hf2 === expectedHash) return { script: sf2, version: 'v2' };
          } catch (e) { console.log('[DAO] ' + curTag + ' from_v2 fail: ' + e.message); }
        }
        
        // Method 6: from_bytes (generic, no version)
        try {
          var sg = CSL.PlutusScript.from_bytes(curBytes);
          var hg = sg.hash().to_hex();
          console.log('[DAO] ' + curTag + ' from_bytes -> ' + hg);
          if (hg === expectedHash) return { script: sg, version: 'v2' };
        } catch (e) { console.log('[DAO] ' + curTag + ' from_bytes fail: ' + e.message); }
      }
    }
    
    // Last resort: manual blake2b_224(version_prefix || script_bytes) hash check
    // Cardano script hash = blake2b_224(version_byte || cbor_bytes)
    console.log('[DAO] Trying manual blake2b_224 hash computation...');
    var versionPrefixes = [
      { prefix: 0x03, label: 'v3' },
      { prefix: 0x02, label: 'v2' },
      { prefix: 0x01, label: 'v1' }
    ];
    for (var mi = 0; mi < byteVariants.length; mi++) {
      var mbv = byteVariants[mi];
      for (var vi = 0; vi < versionPrefixes.length; vi++) {
        var vp = versionPrefixes[vi];
        var preimage = new Uint8Array(1 + mbv.bytes.length);
        preimage[0] = vp.prefix;
        preimage.set(mbv.bytes, 1);
        var manualHash = _b2b.toHex(_b2b.hash224(preimage));
        console.log('[DAO] Manual hash ' + mbv.label + ' + prefix 0x0' + vp.prefix + ': ' + manualHash);
        if (manualHash === expectedHash) {
          console.log('[DAO] ✅ Manual hash matches! Version: ' + vp.label + ', variant: ' + mbv.label);
          // Construct PlutusScript using the best available method
          var matchedScript = null;
          if (vp.label === 'v3' && typeof CSL.PlutusScript.new_v3 === 'function') {
            matchedScript = CSL.PlutusScript.new_v3(mbv.bytes);
          } else if (vp.label === 'v2' && typeof CSL.PlutusScript.new_v2 === 'function') {
            matchedScript = CSL.PlutusScript.new_v2(mbv.bytes);
          } else if (vp.label === 'v1' && typeof CSL.PlutusScript.new_v1 === 'function') {
            matchedScript = CSL.PlutusScript.new_v1(mbv.bytes);
          } else if (typeof CSL.PlutusScript.from_bytes_with_version === 'function') {
            var lang = vp.label === 'v3' ? CSL.Language.new_plutus_v3() :
                       vp.label === 'v2' ? CSL.Language.new_plutus_v2() :
                       CSL.Language.new_plutus_v1();
            matchedScript = CSL.PlutusScript.from_bytes_with_version(mbv.bytes, lang);
          }
          if (matchedScript) return { script: matchedScript, version: vp.label };
        }
      }
    }
    
    throw new Error('Could not parse script with matching hash. Expected: ' + expectedHash);
  }

  // ============================================================
  // Shared: ExUnits evaluation with retry (same as increment)
  // ============================================================

  async function evaluateWithRetry(txCborHex, blockfrostKey) {
    var retryDelays = [250, 750, 2000];
    var lastError = null;
    
    for (var attempt = 0; attempt <= retryDelays.length; attempt++) {
      try {
        console.log('[DAO-Eval] Attempt ' + (attempt + 1) + '/' + (retryDelays.length + 1));
        
        var response = await fetch(BLOCKFROST_BASE + '/utils/txs/evaluate?version=6', {
          method: 'POST',
          headers: {
            'project_id': blockfrostKey,
            'Content-Type': 'application/cbor',
            'Accept': 'application/json'
          },
          body: txCborHex
        });
        
        var text = await response.text();
        var json;
        try { json = JSON.parse(text); } catch (e) { json = null; }
        
        console.log('[DAO-Eval] HTTP', response.status, text.substring(0, 200));
        
        if (response.status >= 500 && attempt < retryDelays.length) {
          console.log('[DAO-Eval] Server error, retrying in ' + retryDelays[attempt] + 'ms...');
          await sleep(retryDelays[attempt]);
          continue;
        }
        
        if (!response.ok) throw new Error('Evaluate failed ' + response.status + ': ' + text);
        
        // Parse result
        var evalResult = json;
        if (evalResult && evalResult.result) {
          var result = Array.isArray(evalResult.result) ? evalResult.result : [evalResult.result];
          return { result: result };
        }
        
        throw new Error('Unexpected evaluation response: ' + text);
      } catch (e) {
        lastError = e;
        if (attempt < retryDelays.length) {
          await sleep(retryDelays[attempt]);
        }
      }
    }
    
    throw lastError || new Error('Evaluation failed after all retries');
  }

  // ============================================================
  // Shared: Manual script_data_hash (same blake2b + CBOR as increment)
  // Uses the blake2b from increment-counter-csl.js via window._b2b
  // OR embeds its own copy
  // ============================================================

  // Inline blake2b-256 (same as increment-counter-csl.js)
  var _b2b = (function() {
    function ADD64AA(v, a, b) {
      var o0 = v[a] + v[b]; var o1 = v[a + 1] + v[b + 1];
      if (o0 >= 0x100000000) o1++; v[a] = o0; v[a + 1] = o1;
    }
    function ADD64AC(v, a, b0, b1) {
      var o0 = v[a] + b0; if (b0 < 0) o0 += 0x100000000;
      var o1 = v[a + 1] + b1; if (o0 >= 0x100000000) o1++; v[a] = o0; v[a + 1] = o1;
    }
    function B2B_GET32(arr, i) { return arr[i] ^ (arr[i+1] << 8) ^ (arr[i+2] << 16) ^ (arr[i+3] << 24); }
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
    var v = new Uint32Array(32); var m = new Uint32Array(32);
    function B2B_G(a, b, c, d, ix, iy) {
      var x0 = m[ix], x1 = m[ix+1], y0 = m[iy], y1 = m[iy+1];
      ADD64AA(v, a, b); ADD64AC(v, a, x0, x1);
      var xor0 = v[d] ^ v[a], xor1 = v[d+1] ^ v[a+1]; v[d] = xor1; v[d+1] = xor0;
      ADD64AA(v, c, d);
      xor0 = v[b] ^ v[c]; xor1 = v[b+1] ^ v[c+1];
      v[b] = (xor0 >>> 24) ^ (xor1 << 8); v[b+1] = (xor1 >>> 24) ^ (xor0 << 8);
      ADD64AA(v, a, b); ADD64AC(v, a, y0, y1);
      xor0 = v[d] ^ v[a]; xor1 = v[d+1] ^ v[a+1];
      v[d] = (xor0 >>> 16) ^ (xor1 << 16); v[d+1] = (xor1 >>> 16) ^ (xor0 << 16);
      ADD64AA(v, c, d);
      xor0 = v[b] ^ v[c]; xor1 = v[b+1] ^ v[c+1];
      v[b] = (xor1 >>> 31) ^ (xor0 << 1); v[b+1] = (xor0 >>> 31) ^ (xor1 << 1);
    }
    function compress(ctx, last) {
      var i;
      for (i = 0; i < 16; i++) { v[i] = ctx.h[i]; v[i+16] = BLAKE2B_IV32[i]; }
      v[24] = v[24] ^ ctx.t; v[25] = v[25] ^ (ctx.t / 0x100000000);
      if (last) { v[28] = ~v[28]; v[29] = ~v[29]; }
      for (i = 0; i < 32; i++) m[i] = B2B_GET32(ctx.b, 4 * i);
      for (i = 0; i < 12; i++) {
        B2B_G(0,8,16,24,SIGMA82[i*16+0],SIGMA82[i*16+1]);
        B2B_G(2,10,18,26,SIGMA82[i*16+2],SIGMA82[i*16+3]);
        B2B_G(4,12,20,28,SIGMA82[i*16+4],SIGMA82[i*16+5]);
        B2B_G(6,14,22,30,SIGMA82[i*16+6],SIGMA82[i*16+7]);
        B2B_G(0,10,20,30,SIGMA82[i*16+8],SIGMA82[i*16+9]);
        B2B_G(2,12,22,24,SIGMA82[i*16+10],SIGMA82[i*16+11]);
        B2B_G(4,14,16,26,SIGMA82[i*16+12],SIGMA82[i*16+13]);
        B2B_G(6,8,18,28,SIGMA82[i*16+14],SIGMA82[i*16+15]);
      }
      for (i = 0; i < 16; i++) ctx.h[i] = ctx.h[i] ^ v[i] ^ v[i+16];
    }
    function init(outlen, key) {
      if (outlen <= 0 || outlen > 64) throw new Error('Illegal output length');
      var keylen = key ? key.length : 0;
      if (keylen > 64) throw new Error('Illegal key length');
      var ctx = {
        b: new Uint8Array(128), h: new Uint32Array(16),
        t: 0, c: 0, outlen: outlen
      };
      for (var i = 0; i < 16; i++) ctx.h[i] = BLAKE2B_IV32[i];
      ctx.h[0] ^= 0x01010000 ^ (keylen << 8) ^ outlen;
      if (keylen > 0) { update(ctx, key); ctx.c = 128; }
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
    return {
      hash: function(input) { var ctx = init(32); update(ctx, input); return final(ctx); },
      hash224: function(input) { var ctx = init(28); update(ctx, input); return final(ctx); },
      toHex: function(bytes) { return Array.from(bytes).map(function(b) { return b.toString(16).padStart(2,'0'); }).join(''); }
    };
  })();

  /**
   * Compute script_data_hash manually
   * Per Alonzo spec: blake2b_256(redeemers_cbor || language_views_cbor)
   * langId: 0=PlutusV1, 1=PlutusV2, 2=PlutusV3
   */
  function computeScriptDataHash(redeemersBytes, costModelValues, langId) {
    if (langId === undefined) langId = 2; // default V3
    // Build language_views: canonical CBOR map {langId: [cost_model_values]}
    var langViewParts = [0xa1, langId]; // map(1) key=langId
    
    // Encode array of cost model values
    var arrLen = costModelValues.length;
    var arrHeader;
    if (arrLen <= 23) arrHeader = [0x80 + arrLen];
    else if (arrLen <= 0xff) arrHeader = [0x98, arrLen];
    else arrHeader = [0x99, (arrLen >> 8) & 0xff, arrLen & 0xff];
    
    var langViewBytes = langViewParts.concat(arrHeader);
    for (var i = 0; i < costModelValues.length; i++) {
      var val = BigInt(costModelValues[i]);
      if (val >= 0n) {
        langViewBytes = langViewBytes.concat(encodeCborUint(val));
      } else {
        // Negative: CBOR major type 1, encode -1-val
        var neg = -1n - val;
        var encoded = encodeCborUint(neg);
        encoded[0] = encoded[0] | 0x20; // Set major type 1
        langViewBytes = langViewBytes.concat(encoded);
      }
    }
    
    var langViewArr = new Uint8Array(langViewBytes);
    
    // Preimage = redeemers || language_views
    var preimage = new Uint8Array(redeemersBytes.length + langViewArr.length);
    preimage.set(redeemersBytes, 0);
    preimage.set(langViewArr, redeemersBytes.length);
    
    console.log('[DAO] script_data_hash preimage size:', preimage.length);
    console.log('[DAO] Redeemers CBOR hex (' + redeemersBytes.length + ' bytes):', bytesToHex(redeemersBytes));
    console.log('[DAO] Language views CBOR length:', langViewArr.length, 'bytes');
    
    var hash = _b2b.hash(preimage);
    var hashHex = _b2b.toHex(hash);
    console.log('[DAO] Manual script_data_hash:', hashHex);
    return hashHex;
  }

  // ============================================================
  // OPERATION 1: Fetch Proposals (read-only, no script execution)
  // ============================================================

  async function FetchDaoProposals(gameObjectName, successCallback, errorCallback, blockfrostKey) {
    try {
      console.log('[DAO] Fetching proposals from', DAO_SCRIPT_ADDRESS);
      
      var response = await fetch(BLOCKFROST_BASE + '/addresses/' + DAO_SCRIPT_ADDRESS + '/utxos', {
        headers: { 'project_id': blockfrostKey }
      });
      
      if (response.status === 404) {
        // No UTxOs = no proposals
        console.log('[DAO] No UTxOs at script address (no proposals yet)');
        window.unityInstance.SendMessage(gameObjectName, successCallback, JSON.stringify([]));
        return;
      }
      
      if (!response.ok) {
        var errText = await response.text();
        throw new Error('Blockfrost ' + response.status + ': ' + errText);
      }
      
      var utxos = await response.json();
      console.log('[DAO] Found', utxos.length, 'UTxOs at script address');
      
      var proposals = [];
      for (var i = 0; i < utxos.length; i++) {
        var u = utxos[i];
        if (!u.inline_datum) {
          console.log('[DAO] UTxO ' + i + ' has no inline datum, skipping');
          continue;
        }
        
        var parsed = parseProposalDatum(u.inline_datum);
        if (parsed) {
          parsed.txHash = u.tx_hash;
          parsed.txIndex = u.tx_index || u.output_index;
          parsed.lovelace = '0';
          if (u.amount) {
            var lov = u.amount.find(function(a) { return a.unit === 'lovelace'; });
            if (lov) parsed.lovelace = lov.quantity;
          }
          proposals.push(parsed);
          console.log('[DAO] Proposal ' + i + ':', parsed.title, 'Yes=' + parsed.yesCount, 'No=' + parsed.noCount, 'Appeal=' + parsed.appealCount);
        }
      }
      
      console.log('[DAO] ✅ Parsed', proposals.length, 'proposals');
      window.unityInstance.SendMessage(gameObjectName, successCallback, JSON.stringify(proposals));
    } catch (e) {
      console.error('[DAO] FetchProposals error:', e);
      window.unityInstance.SendMessage(gameObjectName, errorCallback, e.message || String(e));
    }
  }

  // ============================================================
  // OPERATION 2: Create Proposal (no script execution, simple payment)
  // ============================================================

  async function CreateDaoProposal(gameObjectName, successCallback, errorCallback, blockfrostKey, policyId, title, description) {
    try {
      var CSL = window.CSL;
      var walletApi = window.__walletApi;
      if (!CSL) throw new Error('CSL not loaded');
      if (!walletApi) throw new Error('Wallet not connected');
      
      console.log('[DAO] Creating proposal:', title);
      console.log('[DAO] Policy:', policyId);
      
      // 1. Build the proposal datum
      var datum = buildProposalDatum(CSL, policyId, title, description, 0, 0, 0);
      console.log('[DAO] Datum CBOR:', bytesToHex(datum.to_bytes()));
      
      // 2. Get wallet UTxOs and change address
      var walletUtxosHex = await walletApi.getUtxos();
      var changeAddressHex = await walletApi.getChangeAddress();
      var changeAddr = CSL.Address.from_bytes(hexToBytes(changeAddressHex));
      
      if (!walletUtxosHex || walletUtxosHex.length === 0) throw new Error('No wallet UTxOs');
      
      // 3. Get protocol parameters
      var pp = await getProtocolParameters(blockfrostKey);
      var block = await getLatestBlock(blockfrostKey);
      var currentSlot = parseInt(block.slot);
      var ttlSlot = (currentSlot + 600).toString();
      
      // 4. Build transaction
      var config = buildTxBuilderConfig(pp, CSL);
      var txBuilder = CSL.TransactionBuilder.new(config);
      
      // Add script output with inline datum (2 ADA)
      var scriptAddr = CSL.Address.from_bech32(DAO_SCRIPT_ADDRESS);
      var outputBuilder = CSL.TransactionOutputBuilder.new()
        .with_address(scriptAddr)
        .with_plutus_data(datum)
        .next()
        .with_coin(CSL.BigNum.from_str('2000000'))
        .build();
      txBuilder.add_output(outputBuilder);
      
      // Add wallet inputs
      var walletUtxos = CSL.TransactionUnspentOutputs.new();
      for (var i = 0; i < walletUtxosHex.length; i++) {
        try {
          walletUtxos.add(CSL.TransactionUnspentOutput.from_hex(walletUtxosHex[i]));
        } catch (e) {
          try {
            walletUtxos.add(CSL.TransactionUnspentOutput.from_bytes(hexToBytes(walletUtxosHex[i])));
          } catch (e2) { /* skip */ }
        }
      }
      txBuilder.add_inputs_from(walletUtxos, CSL.CoinSelectionStrategyCIP2.LargestFirstMultiAsset);
      
      // Set TTL
      txBuilder.set_ttl_bignum(CSL.BigNum.from_str(ttlSlot));
      
      // Add change
      txBuilder.add_change_if_needed(changeAddr);
      
      // Build
      var txBody = txBuilder.build();
      var tx = CSL.Transaction.new(txBody, CSL.TransactionWitnessSet.new());
      var txHex = bytesToHex(tx.to_bytes());
      
      console.log('[DAO] Unsigned tx size:', txHex.length / 2, 'bytes');
      
      // 5. Sign via wallet
      console.log('[DAO] Requesting wallet signature...');
      var witnessHex = await walletApi.signTx(txHex, true);
      
      // Merge witness
      var witnessSet = CSL.TransactionWitnessSet.from_hex(witnessHex);
      var signedTx = CSL.Transaction.new(tx.body(), witnessSet, tx.auxiliary_data());
      var signedTxHex = bytesToHex(signedTx.to_bytes());
      
      // 6. Submit via wallet
      console.log('[DAO] Submitting transaction...');
      var txHash;
      try {
        txHash = await walletApi.submitTx(signedTxHex);
      } catch (e) {
        console.log('[DAO] Wallet submit failed, trying Blockfrost...');
        var bfResponse = await fetch(BLOCKFROST_BASE + '/tx/submit', {
          method: 'POST',
          headers: { 'project_id': blockfrostKey, 'Content-Type': 'application/cbor' },
          body: hexToBytes(signedTxHex)
        });
        if (!bfResponse.ok) {
          var errText = await bfResponse.text();
          throw new Error('Submit failed: ' + errText);
        }
        txHash = await bfResponse.text();
        txHash = txHash.replace(/"/g, '');
      }
      
      console.log('[DAO] ✅ Proposal created! TxHash:', txHash);
      window.unityInstance.SendMessage(gameObjectName, successCallback, txHash);
    } catch (e) {
      console.error('[DAO] CreateProposal error:', e);
      window.unityInstance.SendMessage(gameObjectName, errorCallback, e.message || String(e));
    }
  }

  // ============================================================
  // OPERATION 3: Vote on Proposal (script execution, like counter increment)
  // ============================================================

  async function VoteOnDaoProposal(gameObjectName, successCallback, errorCallback, blockfrostKey, proposalTxHash, proposalTxIndex, voteType) {
    try {
      var CSL = window.CSL;
      var walletApi = window.__walletApi;
      if (!CSL) throw new Error('CSL not loaded');
      if (!walletApi) throw new Error('Wallet not connected');
      
      console.log('[DAO] Voting', voteType, 'on proposal', proposalTxHash + '#' + proposalTxIndex);
      
      // 1. Fetch the proposal UTxO
      var scriptUtxos = await blockfrostFetch('/addresses/' + DAO_SCRIPT_ADDRESS + '/utxos', blockfrostKey);
      var proposalUtxo = scriptUtxos.find(function(u) {
        return u.tx_hash === proposalTxHash && (u.tx_index === proposalTxIndex || u.output_index === proposalTxIndex);
      });
      
      if (!proposalUtxo) throw new Error('Proposal UTxO not found: ' + proposalTxHash + '#' + proposalTxIndex);
      if (!proposalUtxo.inline_datum) throw new Error('Proposal UTxO has no inline datum');
      
      // 2. Parse current datum
      var currentProposal = parseProposalDatum(proposalUtxo.inline_datum);
      if (!currentProposal) throw new Error('Failed to parse proposal datum');
      
      console.log('[DAO] Current votes: Yes=' + currentProposal.yesCount + ' No=' + currentProposal.noCount + ' Appeal=' + currentProposal.appealCount);
      
      // 3. Build new datum with incremented vote
      var newYes = currentProposal.yesCount;
      var newNo = currentProposal.noCount;
      var newAppeal = currentProposal.appealCount;
      
      if (voteType === 'yes') newYes++;
      else if (voteType === 'no') newNo++;
      else if (voteType === 'appeal') newAppeal++;
      else throw new Error('Invalid vote type: ' + voteType);
      
      console.log('[DAO] New votes: Yes=' + newYes + ' No=' + newNo + ' Appeal=' + newAppeal);
      
      var newDatum = buildProposalDatum(CSL, currentProposal.policyId, currentProposal.title, currentProposal.description, newYes, newNo, newAppeal);
      console.log('[DAO] New datum CBOR:', bytesToHex(newDatum.to_bytes()));
      
      // 4. Fetch the script CBOR from Blockfrost and parse it
      var fetchedCbor = await fetchScriptCbor(blockfrostKey, DAO_SCRIPT_HASH);
      var parseResult = parseScript(CSL, fetchedCbor, DAO_SCRIPT_HASH);
      var plutusScript = parseResult.script;
      var scriptVersion = parseResult.version;
      console.log('[DAO] Script version detected:', scriptVersion);
      
      // 5. Get wallet UTxOs, collateral, change address
      var walletUtxosHex = await walletApi.getUtxos();
      var changeAddressHex = await walletApi.getChangeAddress();
      var changeAddr = CSL.Address.from_bytes(hexToBytes(changeAddressHex));
      
      var collateralHex;
      try {
        var collResult = await walletApi.getCollateral();
        if (Array.isArray(collResult) && collResult.length > 0) collateralHex = collResult;
        else collateralHex = null;
      } catch (e) {
        collateralHex = null;
      }
      
      if (!collateralHex || collateralHex.length === 0) {
        console.log('[DAO] No dedicated collateral, using wallet UTxOs');
        collateralHex = walletUtxosHex ? [walletUtxosHex[0]] : null;
      }
      if (!collateralHex) throw new Error('No collateral available');
      
      // 6. Get protocol parameters
      var pp = await getProtocolParameters(blockfrostKey);
      var block = await getLatestBlock(blockfrostKey);
      var currentSlot = parseInt(block.slot);
      var ttlSlot = (currentSlot + 600).toString();
      
      // 7. Build transaction
      var config = buildTxBuilderConfig(pp, CSL);
      var txBuilder = CSL.TransactionBuilder.new(config);
      
      // Script input
      var scriptAddr = CSL.Address.from_bech32(DAO_SCRIPT_ADDRESS);
      var scriptTxInput = CSL.TransactionInput.new(
        CSL.TransactionHash.from_hex(proposalUtxo.tx_hash),
        proposalUtxo.tx_index !== undefined ? proposalUtxo.tx_index : proposalUtxo.output_index
      );
      var scriptLovelace = '2000000';
      if (proposalUtxo.amount) {
        var lov = proposalUtxo.amount.find(function(a) { return a.unit === 'lovelace'; });
        if (lov) scriptLovelace = lov.quantity;
      }
      var inputValue = CSL.Value.new(CSL.BigNum.from_str(scriptLovelace));
      
      // Current datum for witness
      var currentDatumPD = CSL.PlutusData.from_hex(proposalUtxo.inline_datum);
      
      // Build redeemer with placeholder ExUnits
      var voteRedeemerData = buildVoteRedeemer(CSL, voteType);
      console.log('[DAO] Vote redeemer CBOR:', bytesToHex(voteRedeemerData.to_bytes()));
      
      // We need to figure out the redeemer index after inputs are sorted
      // For now use index 0, will be corrected after building
      var placeholderRedeemer = CSL.Redeemer.new(
        CSL.RedeemerTag.new_spend(),
        CSL.BigNum.from_str('0'),
        voteRedeemerData,
        CSL.ExUnits.new(CSL.BigNum.from_str('1000000'), CSL.BigNum.from_str('500000000'))
      );
      
      // Add script input via PlutusScriptSource
      var plutusWitness = CSL.PlutusWitness.new(plutusScript, currentDatumPD, placeholderRedeemer);
      txBuilder.add_plutus_script_input(plutusWitness, scriptTxInput, inputValue);
      
      // Script output with new datum
      var scriptOutput = CSL.TransactionOutputBuilder.new()
        .with_address(scriptAddr)
        .with_plutus_data(newDatum)
        .next()
        .with_coin(CSL.BigNum.from_str(scriptLovelace))
        .build();
      txBuilder.add_output(scriptOutput);
      
      // Add wallet input for fee
      var walletUtxos = [];
      for (var i = 0; i < walletUtxosHex.length; i++) {
        try {
          walletUtxos.push(CSL.TransactionUnspentOutput.from_hex(walletUtxosHex[i]));
        } catch (e) {
          try {
            walletUtxos.push(CSL.TransactionUnspentOutput.from_bytes(hexToBytes(walletUtxosHex[i])));
          } catch (e2) { /* skip */ }
        }
      }
      
      // Pick a wallet UTxO that isn't the script UTxO
      var walletInputAdded = false;
      for (var j = 0; j < walletUtxos.length; j++) {
        var wu = walletUtxos[j];
        var wInput = wu.input();
        var wTxHash = bytesToHex(wInput.transaction_id().to_bytes());
        if (wTxHash !== proposalUtxo.tx_hash || wInput.index() !== (proposalUtxo.tx_index || proposalUtxo.output_index)) {
          var wAddr = wu.output().address();
          var wVal = wu.output().amount();
          if (typeof txBuilder.add_regular_input === 'function') {
            txBuilder.add_regular_input(wAddr, wInput, wVal);
          } else {
            txBuilder.add_input(wAddr, wInput, wVal);
          }
          walletInputAdded = true;
          console.log('[DAO] Added wallet input:', wTxHash.substring(0, 16) + '...#' + wInput.index());
          break;
        }
      }
      if (!walletInputAdded) throw new Error('No suitable wallet UTxO for fee payment');
      
      // Collateral
      var collateralBuilder = CSL.TxInputsBuilder.new();
      for (var c = 0; c < collateralHex.length; c++) {
        try {
          var collUtxo;
          try { collUtxo = CSL.TransactionUnspentOutput.from_hex(collateralHex[c]); }
          catch (e) { collUtxo = CSL.TransactionUnspentOutput.from_bytes(hexToBytes(collateralHex[c])); }
          if (typeof collateralBuilder.add_regular_input === 'function') {
            collateralBuilder.add_regular_input(collUtxo.output().address(), collUtxo.input(), collUtxo.output().amount());
          } else {
            collateralBuilder.add_input(collUtxo.output().address(), collUtxo.input(), collUtxo.output().amount());
          }
        } catch (e) { console.warn('[DAO] Collateral parse error:', e.message); }
      }
      txBuilder.set_collateral(collateralBuilder);
      
      // Required signers - extract key hash for later use
      var signerKeyHash = null;
      var changeAddrObj = CSL.BaseAddress.from_address(changeAddr);
      if (changeAddrObj) {
        var paymentCred = changeAddrObj.payment_cred();
        signerKeyHash = paymentCred.to_keyhash();
        if (signerKeyHash) {
          if (typeof txBuilder.add_required_signer === 'function') {
            txBuilder.add_required_signer(signerKeyHash);
          } else if (typeof txBuilder.set_required_signers === 'function') {
            var reqSigners = CSL.Ed25519KeyHashes.new();
            reqSigners.add(signerKeyHash);
            txBuilder.set_required_signers(reqSigners);
          }
        }
      }
      
      // TTL
      if (typeof txBuilder.set_ttl_bignum === 'function') {
        txBuilder.set_ttl_bignum(CSL.BigNum.from_str(ttlSlot));
      } else if (typeof txBuilder.set_ttl === 'function') {
        txBuilder.set_ttl(CSL.BigNum.from_str(ttlSlot));
      }
      
      // Build Costmdls for calc_script_data_hash
      var costModels = pp.cost_models || pp.cost_models_raw;
      var costModelRaw, costModelLangId;
      if (scriptVersion === 'v2') {
        costModelRaw = costModels['PlutusV2'] || costModels['plutus:v2'];
        costModelLangId = 1;
      } else {
        costModelRaw = costModels['PlutusV3'] || costModels['plutus:v3'];
        costModelLangId = 2;
      }
      if (!costModelRaw) throw new Error('No cost model for Plutus ' + scriptVersion);
      
      var costModelArr = Array.isArray(costModelRaw) ? costModelRaw : Object.values(costModelRaw);
      console.log('[DAO] Cost model (' + scriptVersion + '): ' + costModelArr.length + ' values');
      
      // Build CSL CostModel + Costmdls
      var cslCostModel = CSL.CostModel.new();
      for (var ci = 0; ci < costModelArr.length; ci++) {
        var val = costModelArr[ci];
        if (typeof CSL.Int.new_i32 === 'function' && val >= -2147483648 && val <= 2147483647) {
          cslCostModel.set(ci, CSL.Int.new_i32(val));
        } else if (val >= 0) {
          cslCostModel.set(ci, CSL.Int.new(CSL.BigNum.from_str(val.toString())));
        } else {
          cslCostModel.set(ci, CSL.Int.new_negative(CSL.BigNum.from_str((-val).toString())));
        }
      }
      var cslCostmdls = CSL.Costmdls.new();
      var lang = scriptVersion === 'v2' ? CSL.Language.new_plutus_v2() : CSL.Language.new_plutus_v3();
      cslCostmdls.insert(lang, cslCostModel);
      
      // calc_script_data_hash BEFORE build_tx
      if (typeof txBuilder.calc_script_data_hash === 'function') {
        txBuilder.calc_script_data_hash(cslCostmdls);
        console.log('[DAO] calc_script_data_hash set on builder');
      }
      
      // Change
      txBuilder.add_change_if_needed(changeAddr);
      
      // Build
      var unsignedTx = txBuilder.build_tx();
      var builtBody = unsignedTx.body();
      
      // Ensure required signers are on the body
      if (signerKeyHash && (!builtBody.required_signers || !builtBody.required_signers())) {
        var reqSigners2 = CSL.Ed25519KeyHashes.new();
        reqSigners2.add(signerKeyHash);
        builtBody.set_required_signers(reqSigners2);
      }
      
      var builtWitness = unsignedTx.witness_set();
      
      // Strip supplemental datums (inline datum tx)
      var cleanWitness = CSL.TransactionWitnessSet.new();
      if (builtWitness.plutus_scripts()) cleanWitness.set_plutus_scripts(builtWitness.plutus_scripts());
      if (builtWitness.redeemers()) cleanWitness.set_redeemers(builtWitness.redeemers());
      // Do NOT set plutus_data
      
      unsignedTx = CSL.Transaction.new(builtBody, cleanWitness);
      
      // 8. Compute manual script_data_hash for V3 (override CSL's potentially broken one)
      var redeemersFromTx = cleanWitness.redeemers();
      var plutusScriptsFromTx = cleanWitness.plutus_scripts();
      
      var redeemersBytes = redeemersFromTx.to_bytes();
      var manualHash = computeScriptDataHash(redeemersBytes, costModelArr, costModelLangId);
      
      // Override script_data_hash on body
      var oldBody = unsignedTx.body();
      oldBody.set_script_data_hash(CSL.ScriptDataHash.from_hex(manualHash));
      console.log('[DAO] ✅ Set manual script_data_hash:', manualHash);
      
      // Build unsigned tx hex for evaluation
      unsignedTx = CSL.Transaction.new(oldBody, cleanWitness);
      var unsignedTxHex = bytesToHex(unsignedTx.to_bytes());
      console.log('[DAO] Unsigned tx size:', unsignedTxHex.length / 2, 'bytes');
      
      // 9. Evaluate ExUnits
      console.log('[DAO] Evaluating ExUnits...');
      var evalResult = await evaluateWithRetry(unsignedTxHex, blockfrostKey);
      
      var evalData = evalResult.result;
      if (!evalData || evalData.length === 0) throw new Error('No evaluation result');
      
      var exUnits;
      var entry = evalData[0];
      if (entry.budget) {
        exUnits = { memory: entry.budget.memory, steps: entry.budget.cpu || entry.budget.steps };
      } else if (entry.ex_units) {
        exUnits = { memory: entry.ex_units.mem, steps: entry.ex_units.steps };
      } else {
        throw new Error('Cannot parse ExUnits from evaluation result');
      }
      console.log('[DAO] ExUnits: mem=' + exUnits.memory + ' steps=' + exUnits.steps);
      
      // 10. Rebuild redeemer with real ExUnits
      var redeemersFromBody = redeemersFromTx;
      var oldRedeemer = redeemersFromBody.get(0);
      var finalRedeemers = CSL.Redeemers.new();
      finalRedeemers.add(CSL.Redeemer.new(
        oldRedeemer.tag(),
        oldRedeemer.index(),
        oldRedeemer.data(),
        CSL.ExUnits.new(
          CSL.BigNum.from_str(exUnits.memory.toString()),
          CSL.BigNum.from_str(exUnits.steps.toString())
        )
      ));
      
      // 11. Recompute script_data_hash with real ExUnits
      var finalRedeemersBytes = finalRedeemers.to_bytes();
      var newScriptDataHash = computeScriptDataHash(finalRedeemersBytes, costModelArr, costModelLangId);
      
      // 12. Compute new fee
      var minFeeA = BigInt(pp.min_fee_a);
      var minFeeB = BigInt(pp.min_fee_b);
      var priceMem = Number(toRational(pp.price_mem).num) / Number(toRational(pp.price_mem).den);
      var priceStep = Number(toRational(pp.price_step).num) / Number(toRational(pp.price_step).den);
      
      var estimatedSize = BigInt(unsignedTxHex.length / 2 + 150);
      var sizeFee = minFeeA * estimatedSize + minFeeB;
      var exUnitsFee = BigInt(Math.ceil(priceMem * exUnits.memory)) + BigInt(Math.ceil(priceStep * exUnits.steps));
      var computedFee = sizeFee + exUnitsFee;
      var newFee = computedFee + computedFee / 10n;
      console.log('[DAO] Fee: sizeFee=' + sizeFee + ' exUnitsFee=' + exUnitsFee + ' total(+10%)=' + newFee);
      
      // 13. Rebuild TransactionBody with new fee, adjusted change, script_data_hash
      var walletBech32 = changeAddr.to_bech32();
      var newBody = rebuildBodyWithFeeAndHash(CSL, oldBody, newFee.toString(), newScriptDataHash, walletBech32);
      
      // 14. Rebuild witness set
      var finalWitnessSet = CSL.TransactionWitnessSet.new();
      finalWitnessSet.set_plutus_scripts(plutusScriptsFromTx);
      finalWitnessSet.set_redeemers(finalRedeemers);
      
      var finalTx = CSL.Transaction.new(newBody, finalWitnessSet);
      var finalTxHex = bytesToHex(finalTx.to_bytes());
      
      console.log('[DAO] Final tx size:', finalTxHex.length / 2, 'bytes');
      console.log('[DAO] Final script_data_hash:', finalTx.body().script_data_hash().to_hex());
      
      // 15. Sign
      console.log('[DAO] Requesting wallet signature...');
      var sigWitnessHex = await walletApi.signTx(finalTxHex, true);
      
      // Merge vkey witness
      var sigWitnessSet = CSL.TransactionWitnessSet.from_hex(sigWitnessHex);
      var mergedWitness = CSL.TransactionWitnessSet.new();
      mergedWitness.set_plutus_scripts(plutusScriptsFromTx);
      mergedWitness.set_redeemers(finalRedeemers);
      if (sigWitnessSet.vkeys()) mergedWitness.set_vkeys(sigWitnessSet.vkeys());
      
      var signedTx = CSL.Transaction.new(newBody, mergedWitness);
      var signedTxHex = bytesToHex(signedTx.to_bytes());
      
      // 16. Submit
      console.log('[DAO] Submitting vote transaction...');
      var txHash;
      try {
        txHash = await walletApi.submitTx(signedTxHex);
      } catch (e) {
        console.log('[DAO] Wallet submit failed, trying Blockfrost...');
        var bfResponse = await fetch(BLOCKFROST_BASE + '/tx/submit', {
          method: 'POST',
          headers: { 'project_id': blockfrostKey, 'Content-Type': 'application/cbor' },
          body: hexToBytes(signedTxHex)
        });
        if (!bfResponse.ok) {
          var errText = await bfResponse.text();
          throw new Error('Submit failed: ' + errText);
        }
        txHash = await bfResponse.text();
        txHash = txHash.replace(/"/g, '');
      }
      
      console.log('[DAO] ✅ Vote submitted! TxHash:', txHash);
      window.unityInstance.SendMessage(gameObjectName, successCallback, txHash);
    } catch (e) {
      console.error('[DAO] VoteOnProposal error:', e);
      window.unityInstance.SendMessage(gameObjectName, errorCallback, e.message || String(e));
    }
  }

  /**
   * Rebuild TransactionBody with new fee and adjusted change output
   * (Same pattern as increment-counter-csl.js)
   */
  function rebuildBodyWithFeeAndHash(CSL, oldBody, newFeeStr, scriptDataHashHex, walletAddr) {
    var inputs = oldBody.inputs();
    var oldOutputs = oldBody.outputs();
    var oldFee = oldBody.fee();
    var newFeeBN = CSL.BigNum.from_str(newFeeStr);
    
    var feeDiff = BigInt(oldFee.to_str()) - BigInt(newFeeStr);
    console.log('[DAO] Fee adjustment: oldFee=' + oldFee.to_str() + ' newFee=' + newFeeStr + ' diff=' + feeDiff);
    
    var newOutputs = CSL.TransactionOutputs.new();
    var changeAdjusted = false;
    for (var i = 0; i < oldOutputs.len(); i++) {
      var out = oldOutputs.get(i);
      var outAddr = out.address().to_bech32();
      if (!changeAdjusted && walletAddr && outAddr === walletAddr) {
        var oldAmount = BigInt(out.amount().coin().to_str());
        var newAmount = oldAmount + feeDiff;
        console.log('[DAO] Adjusting change output[' + i + ']: ' + oldAmount + ' -> ' + newAmount);
        var newValue = CSL.Value.new(CSL.BigNum.from_str(newAmount.toString()));
        newOutputs.add(CSL.TransactionOutput.new(out.address(), newValue));
        changeAdjusted = true;
      } else {
        newOutputs.add(out);
      }
    }
    if (!changeAdjusted && feeDiff !== 0n) {
      console.warn('[DAO] WARNING: Could not find change output to adjust!');
    }
    
    var newBody = CSL.TransactionBody.new_tx_body(inputs, newOutputs, newFeeBN);
    
    var ttl = oldBody.ttl_bignum ? oldBody.ttl_bignum() : undefined;
    if (ttl) { newBody.set_ttl(ttl); console.log('[DAO] Rebuilt body TTL:', ttl.to_str()); }
    
    var collateral = oldBody.collateral();
    if (collateral) newBody.set_collateral(collateral);
    var collateralReturn = oldBody.collateral_return ? oldBody.collateral_return() : undefined;
    if (collateralReturn) newBody.set_collateral_return(collateralReturn);
    var totalCollateral = oldBody.total_collateral ? oldBody.total_collateral() : undefined;
    if (totalCollateral) newBody.set_total_collateral(totalCollateral);
    
    var requiredSigners = oldBody.required_signers ? oldBody.required_signers() : undefined;
    if (requiredSigners) newBody.set_required_signers(requiredSigners);
    
    newBody.set_script_data_hash(CSL.ScriptDataHash.from_hex(scriptDataHashHex));
    
    return newBody;
  }

  // ============================================================
  // Expose to window for jslib bridge
  // ============================================================
  window.FetchDaoProposals = FetchDaoProposals;
  window.CreateDaoProposal = CreateDaoProposal;
  window.VoteOnDaoProposal = VoteOnDaoProposal;

  console.log('[DAO] dao-csl.js loaded. Functions: FetchDaoProposals, CreateDaoProposal, VoteOnDaoProposal');

})();
