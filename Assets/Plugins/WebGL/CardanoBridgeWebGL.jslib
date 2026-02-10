mergeInto(LibraryManager.library, {

  // ============================================================
  // CardanoBridge_IsLaceAvailable
  // ============================================================
  CardanoBridge_IsLaceAvailable: function() {
    if (typeof window.CardanoBridge === 'undefined') return false;
    return window.CardanoBridge.isLaceAvailable() ? 1 : 0;
  },

  // ============================================================
  // CardanoBridge_GetAvailableWallets
  // ============================================================
  CardanoBridge_GetAvailableWallets: function() {
    if (typeof window.CardanoBridge === 'undefined') return null;
    var wallets = window.CardanoBridge.getAvailableWallets();
    var json = JSON.stringify(wallets);
    var bufferSize = lengthBytesUTF8(json) + 1;
    var buffer = _malloc(bufferSize);
    stringToUTF8(json, buffer, bufferSize);
    return buffer;
  },

  // ============================================================
  // CardanoBridge_IsConnected
  // ============================================================
  CardanoBridge_IsConnected: function() {
    if (typeof window.CardanoBridge === 'undefined') return 0;
    return window.CardanoBridge.isConnected() ? 1 : 0;
  },

  // ============================================================
  // CardanoBridge_ConnectWallet
  // ============================================================
  CardanoBridge_ConnectWallet: function(gameObjectNamePtr, successCallbackPtr, errorCallbackPtr, walletNamePtr) {
    var gameObjectName = UTF8ToString(gameObjectNamePtr);
    var successCallback = UTF8ToString(successCallbackPtr);
    var errorCallback = UTF8ToString(errorCallbackPtr);
    var walletName = UTF8ToString(walletNamePtr);

    if (typeof window.CardanoBridge === 'undefined') {
      SendMessage(gameObjectName, errorCallback, "CardanoBridge not loaded");
      return;
    }

    window.CardanoBridge.connectWallet(walletName || 'lace')
      .then(function(result) {
        SendMessage(gameObjectName, successCallback, JSON.stringify(result));
      })
      .catch(function(err) {
        SendMessage(gameObjectName, errorCallback, err.message || String(err));
      });
  },

  // ============================================================
  // CardanoBridge_DisconnectWallet
  // ============================================================
  CardanoBridge_DisconnectWallet: function() {
    if (typeof window.CardanoBridge === 'undefined') return;
    window.CardanoBridge.disconnectWallet();
  },

  // ============================================================
  // CardanoBridge_GetBalance
  // ============================================================
  CardanoBridge_GetBalance: function(gameObjectNamePtr, successCallbackPtr, errorCallbackPtr) {
    var gameObjectName = UTF8ToString(gameObjectNamePtr);
    var successCallback = UTF8ToString(successCallbackPtr);
    var errorCallback = UTF8ToString(errorCallbackPtr);

    if (typeof window.CardanoBridge === 'undefined') {
      SendMessage(gameObjectName, errorCallback, "CardanoBridge not loaded");
      return;
    }

    window.CardanoBridge.getBalance()
      .then(function(balance) {
        SendMessage(gameObjectName, successCallback, balance);
      })
      .catch(function(err) {
        SendMessage(gameObjectName, errorCallback, err.message || String(err));
      });
  },

  // ============================================================
  // CardanoBridge_GetUsedAddresses
  // ============================================================
  CardanoBridge_GetUsedAddresses: function(gameObjectNamePtr, successCallbackPtr, errorCallbackPtr) {
    var gameObjectName = UTF8ToString(gameObjectNamePtr);
    var successCallback = UTF8ToString(successCallbackPtr);
    var errorCallback = UTF8ToString(errorCallbackPtr);

    if (typeof window.CardanoBridge === 'undefined') {
      SendMessage(gameObjectName, errorCallback, "CardanoBridge not loaded");
      return;
    }

    window.CardanoBridge.getUsedAddressesBech32()
      .then(function(addresses) {
        SendMessage(gameObjectName, successCallback, JSON.stringify(addresses));
      })
      .catch(function(err) {
        SendMessage(gameObjectName, errorCallback, err.message || String(err));
      });
  },

  // ============================================================
  // CardanoBridge_GetUtxos
  // ============================================================
  CardanoBridge_GetUtxos: function(gameObjectNamePtr, successCallbackPtr, errorCallbackPtr) {
    var gameObjectName = UTF8ToString(gameObjectNamePtr);
    var successCallback = UTF8ToString(successCallbackPtr);
    var errorCallback = UTF8ToString(errorCallbackPtr);

    if (typeof window.CardanoBridge === 'undefined') {
      SendMessage(gameObjectName, errorCallback, "CardanoBridge not loaded");
      return;
    }

    window.CardanoBridge.getUtxos()
      .then(function(utxos) {
        SendMessage(gameObjectName, successCallback, JSON.stringify(utxos));
      })
      .catch(function(err) {
        SendMessage(gameObjectName, errorCallback, err.message || String(err));
      });
  },

  // ============================================================
  // CardanoBridge_BuildAndSendPayment
  // ============================================================
  CardanoBridge_BuildAndSendPayment: function(gameObjectNamePtr, successCallbackPtr, errorCallbackPtr, toAddressPtr, lovelaceAmountPtr) {
    var gameObjectName = UTF8ToString(gameObjectNamePtr);
    var successCallback = UTF8ToString(successCallbackPtr);
    var errorCallback = UTF8ToString(errorCallbackPtr);
    var toAddress = UTF8ToString(toAddressPtr);
    var lovelaceAmount = UTF8ToString(lovelaceAmountPtr);

    if (typeof window.CardanoBridge === 'undefined') {
      SendMessage(gameObjectName, errorCallback, "CardanoBridge not loaded");
      return;
    }

    console.log("[CardanoBridgeWebGL] BuildAndSendPayment:", toAddress, lovelaceAmount);

    window.CardanoBridge.buildAndSendPayment(toAddress, lovelaceAmount)
      .then(function(result) {
        SendMessage(gameObjectName, successCallback, JSON.stringify(result));
      })
      .catch(function(err) {
        var msg = err.message || String(err);
        // Check for user rejection
        if (msg.toLowerCase().includes('reject') || msg.toLowerCase().includes('cancel') || msg.toLowerCase().includes('denied')) {
          msg = "User rejected the transaction";
        }
        SendMessage(gameObjectName, errorCallback, msg);
      });
  },

  // ============================================================
  // CardanoBridge_GetChangeAddress
  // ============================================================
  CardanoBridge_GetChangeAddress: function(gameObjectNamePtr, successCallbackPtr, errorCallbackPtr) {
    var gameObjectName = UTF8ToString(gameObjectNamePtr);
    var successCallback = UTF8ToString(successCallbackPtr);
    var errorCallback = UTF8ToString(errorCallbackPtr);

    if (typeof window.CardanoBridge === 'undefined') {
      SendMessage(gameObjectName, errorCallback, "CardanoBridge not loaded");
      return;
    }

    window.CardanoBridge.getChangeAddressBech32()
      .then(function(address) {
        SendMessage(gameObjectName, successCallback, address);
      })
      .catch(function(err) {
        SendMessage(gameObjectName, errorCallback, err.message || String(err));
      });
  },

  // ============================================================
  // CardanoBridge_FetchDaoProposals
  // ============================================================
  CardanoBridge_FetchDaoProposals: function(gameObjectNamePtr, successCallbackPtr, errorCallbackPtr, blockfrostKeyPtr) {
    var gameObjectName = UTF8ToString(gameObjectNamePtr);
    var successCallback = UTF8ToString(successCallbackPtr);
    var errorCallback = UTF8ToString(errorCallbackPtr);
    var blockfrostKey = UTF8ToString(blockfrostKeyPtr);

    console.log("[CardanoBridgeWebGL] FetchDaoProposals called");

    if (typeof window.FetchDaoProposals !== 'function') {
      SendMessage(gameObjectName, errorCallback, "FetchDaoProposals not loaded. Ensure dao-csl.js is loaded.");
      return;
    }

    window.FetchDaoProposals(gameObjectName, successCallback, errorCallback, blockfrostKey)
      .catch(function(err) {
        console.error("[CardanoBridgeWebGL] FetchDaoProposals error:", err);
      });
  },

  // ============================================================
  // CardanoBridge_CreateDaoProposal
  // ============================================================
  CardanoBridge_CreateDaoProposal: function(gameObjectNamePtr, successCallbackPtr, errorCallbackPtr, blockfrostKeyPtr, policyIdPtr, titlePtr, descriptionPtr) {
    var gameObjectName = UTF8ToString(gameObjectNamePtr);
    var successCallback = UTF8ToString(successCallbackPtr);
    var errorCallback = UTF8ToString(errorCallbackPtr);
    var blockfrostKey = UTF8ToString(blockfrostKeyPtr);
    var policyId = UTF8ToString(policyIdPtr);
    var title = UTF8ToString(titlePtr);
    var description = UTF8ToString(descriptionPtr);

    console.log("[CardanoBridgeWebGL] CreateDaoProposal called:", title);

    if (typeof window.CreateDaoProposal !== 'function') {
      SendMessage(gameObjectName, errorCallback, "CreateDaoProposal not loaded. Ensure dao-csl.js is loaded.");
      return;
    }

    if (!window.__walletApi) {
      SendMessage(gameObjectName, errorCallback, "Wallet not connected. Connect via CIP-30 first.");
      return;
    }

    window.CreateDaoProposal(gameObjectName, successCallback, errorCallback, blockfrostKey, policyId, title, description)
      .catch(function(err) {
        console.error("[CardanoBridgeWebGL] CreateDaoProposal error:", err);
      });
  },

  // ============================================================
  // CardanoBridge_VoteOnDaoProposal
  // ============================================================
  CardanoBridge_VoteOnDaoProposal: function(gameObjectNamePtr, successCallbackPtr, errorCallbackPtr, blockfrostKeyPtr, proposalTxHashPtr, proposalTxIndexInt, voteTypePtr) {
    var gameObjectName = UTF8ToString(gameObjectNamePtr);
    var successCallback = UTF8ToString(successCallbackPtr);
    var errorCallback = UTF8ToString(errorCallbackPtr);
    var blockfrostKey = UTF8ToString(blockfrostKeyPtr);
    var proposalTxHash = UTF8ToString(proposalTxHashPtr);
    var proposalTxIndex = proposalTxIndexInt;
    var voteType = UTF8ToString(voteTypePtr);

    console.log("[CardanoBridgeWebGL] VoteOnDaoProposal called:", voteType, "on", proposalTxHash + "#" + proposalTxIndex);

    if (typeof window.VoteOnDaoProposal !== 'function') {
      SendMessage(gameObjectName, errorCallback, "VoteOnDaoProposal not loaded. Ensure dao-csl.js is loaded.");
      return;
    }

    if (!window.__walletApi) {
      SendMessage(gameObjectName, errorCallback, "Wallet not connected. Connect via CIP-30 first.");
      return;
    }

    window.VoteOnDaoProposal(gameObjectName, successCallback, errorCallback, blockfrostKey, proposalTxHash, proposalTxIndex, voteType)
      .catch(function(err) {
        console.error("[CardanoBridgeWebGL] VoteOnDaoProposal error:", err);
      });
  },

  // ============================================================
  // CardanoBridge_IncrementCounter
  // ============================================================
  // Increments an Aiken counter smart contract using pure CSL + Blockfrost + CIP-30.
  // No MeshSDK/Lucid/Blaze dependency.
  // ============================================================
  CardanoBridge_IncrementCounter: function(gameObjectNamePtr, successCallbackPtr, errorCallbackPtr, scriptAddressPtr, blockfrostKeyPtr) {
    var gameObjectName = UTF8ToString(gameObjectNamePtr);
    var successCallback = UTF8ToString(successCallbackPtr);
    var errorCallback = UTF8ToString(errorCallbackPtr);
    var scriptAddress = UTF8ToString(scriptAddressPtr);
    var blockfrostKey = UTF8ToString(blockfrostKeyPtr);

    console.log("[CardanoBridgeWebGL] IncrementCounter called");
    console.log("[CardanoBridgeWebGL] Script address:", scriptAddress);

    // Plutus V3 validator CBOR hex (Aiken counter - compiled with Aiken v1.1.21)
    var VALIDATOR_CBOR = "59016901010029800aba2aba1aba0aab9faab9eaab9dab9a488888896600264653001300800198041804800cc0200092225980099b8748008c01cdd500144ca60026018003300c300d0019b874800122259800980098059baa0078acc004c030dd5003c566002600260166ea800a26464b30013003300d3754003133223259800980318081baa0018992cc004cdc3a400860226ea8006266e1cdd6980a98091baa001337006eb4c054c048dd500424005164040600460226ea8c050c044dd5000c5900f198021bac300130103754012466ebcc050c044dd5000801980898071baa30113012300e37546022601c6ea80048c048c04cc04c0062c8060cc004dd6180818069baa00623375e6022601c6ea800401488c8cc00400400c896600200314c0103d87a80008992cc004c010006266e952000330130014bd7044cc00c00cc05400900f1809800a0228b20148b201a8b201418041baa0028b200c180400098019baa0088a4d13656400401";

    // Check if IncrementCounterCSL is available
    if (typeof window.IncrementCounterCSL !== 'function') {
      // Fallback: check if CSL is loaded
      if (typeof window.CSL === 'undefined') {
        SendMessage(gameObjectName, errorCallback, "CSL not loaded. Ensure csl.bundle.js is loaded in template.");
        return;
      }
      SendMessage(gameObjectName, errorCallback, "IncrementCounterCSL not loaded. Ensure increment-counter-csl.js is loaded.");
      return;
    }

    // Check wallet connection
    if (!window.__walletApi) {
      SendMessage(gameObjectName, errorCallback, "Wallet not connected. Connect via CIP-30 first.");
      return;
    }

    // Call the pure CSL + CIP-30 + Blockfrost implementation
    window.IncrementCounterCSL(
      gameObjectName,
      successCallback,
      errorCallback,
      scriptAddress,
      blockfrostKey,
      VALIDATOR_CBOR
    ).catch(function(err) {
      // Error already sent via SendMessage in IncrementCounterCSL
      console.error("[CardanoBridgeWebGL] IncrementCounter error:", err);
    });
  },

});
