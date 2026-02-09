/**
 * Midnight WebGL Plugin (Unity WebGL .jslib)
 * ------------------------------------------------------------
 * Purpose (v0):
 *  - Detect Lace (Midnight) wallet presence in the browser
 *  - Connect to Lace using Midnight DApp Connector
 *  - Retrieve the wallet address (from api.state().address)
 *  - Callback into Unity via SendMessage
 *
 * Notes:
 *  - Midnight DApp connector is exposed as: window.midnight.{walletName}
 *  - Known wallet names: "mnLace", "lace"
 *  - Connection flow:
 *      const api = await window.midnight.{walletName}.enable();
 *      const state = await api.state();
 *      const address = state.address;
 *
 * IMPORTANT: All helper code is inlined directly into each function
 * because Unity's jslib system doesn't reliably support shared helpers.
 */

var MidnightWebGLPlugin = {

  // ============================================================
  // DebugLogMidnightObject
  // ============================================================
  DebugLogMidnightObject: function () {
    console.log("[MidnightWebGL] === DEBUG: Full wallet inspection ===");

    if (window.midnight) {
      console.log("[MidnightWebGL] window.midnight EXISTS");
      console.log("[MidnightWebGL]   typeof:", typeof window.midnight);
      var keys = Object.keys(window.midnight);
      console.log("[MidnightWebGL]   keys:", keys);
      
      if (typeof window.midnight.enable === "function") {
        console.log("[MidnightWebGL]   HAS enable() - this IS a connector!");
      }
      if (window.midnight.name) {
        console.log("[MidnightWebGL]   name:", window.midnight.name);
      }
      if (window.midnight.apiVersion) {
        console.log("[MidnightWebGL]   apiVersion:", window.midnight.apiVersion);
      }
      
      for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        var val = window.midnight[key];
        var valType = typeof val;
        if (valType === "object" && val !== null) {
          console.log("[MidnightWebGL]   ." + key + " = [object]", Object.keys(val));
          if (typeof val.enable === "function") {
            console.log("[MidnightWebGL]     ^ HAS enable() - wallet connector!");
          }
          if (val.name) console.log("[MidnightWebGL]     ^ name:", val.name);
          if (val.apiVersion) console.log("[MidnightWebGL]     ^ apiVersion:", val.apiVersion);
        } else if (valType === "function") {
          console.log("[MidnightWebGL]   ." + key + " = [function]");
        } else {
          console.log("[MidnightWebGL]   ." + key + " =", val);
        }
      }
    } else {
      console.log("[MidnightWebGL] window.midnight is NOT present");
    }

    if (window.cardano) {
      console.log("[MidnightWebGL] window.cardano EXISTS");
      var cardanoKeys = Object.keys(window.cardano);
      console.log("[MidnightWebGL]   keys:", cardanoKeys);
      
      for (var j = 0; j < cardanoKeys.length; j++) {
        var ckey = cardanoKeys[j];
        var cval = window.cardano[ckey];
        if (cval && typeof cval === "object") {
          console.log("[MidnightWebGL]   ." + ckey + " = [object]");
          if (typeof cval.enable === "function") {
            console.log("[MidnightWebGL]     ^ HAS enable() - wallet connector!");
          }
          if (cval.name) console.log("[MidnightWebGL]     ^ name:", cval.name);
        }
      }
    } else {
      console.log("[MidnightWebGL] window.cardano is NOT present");
    }

    console.log("[MidnightWebGL] === END DEBUG ===");
  },

  // ============================================================
  // IsLaceAvailable
  // ============================================================
  IsLaceAvailable: function () {
    try {
      console.log("[MidnightWebGL] IsLaceAvailable check");
      console.log("[MidnightWebGL] window.midnight:", window.midnight ? Object.keys(window.midnight) : "not present");

      // Check window.midnight
      if (window.midnight) {
        // Check if window.midnight itself has enable()
        if (typeof window.midnight.enable === "function") {
          console.log("[MidnightWebGL] Found: window.midnight (direct connector)");
          return 1;
        }
        
        // Check known wallet names with detailed logging
        var knownNames = ["mnLace", "lace", "midnight", "Lace"];
        for (var i = 0; i < knownNames.length; i++) {
          var name = knownNames[i];
          var walletObj = window.midnight[name];
          if (walletObj) {
            console.log("[MidnightWebGL] Checking window.midnight." + name + ":");
            console.log("[MidnightWebGL]   typeof:", typeof walletObj);
            console.log("[MidnightWebGL]   keys:", Object.keys(walletObj));
            console.log("[MidnightWebGL]   enable exists:", "enable" in walletObj);
            console.log("[MidnightWebGL]   typeof enable:", typeof walletObj.enable);
            
            // Check if enable is a function
            if (typeof walletObj.enable === "function") {
              console.log("[MidnightWebGL] Found: window.midnight." + name + " (has enable function)");
              return 1;
            }
            // Also accept if the object exists and has expected wallet properties
            if (walletObj.name || walletObj.apiVersion) {
              console.log("[MidnightWebGL] Found: window.midnight." + name + " (has wallet properties, assuming valid)");
              return 1;
            }
          }
        }

        // Enumerate all keys with detailed logging
        var midnightKeys = Object.keys(window.midnight);
        console.log("[MidnightWebGL] Enumerating all midnight keys:", midnightKeys);
        for (var j = 0; j < midnightKeys.length; j++) {
          var key = midnightKeys[j];
          var obj = window.midnight[key];
          console.log("[MidnightWebGL] Checking key '" + key + "':", typeof obj);
          if (obj && typeof obj === "object") {
            console.log("[MidnightWebGL]   obj keys:", Object.keys(obj));
            console.log("[MidnightWebGL]   has enable:", "enable" in obj, "typeof:", typeof obj.enable);
            if (typeof obj.enable === "function") {
              console.log("[MidnightWebGL] Found via enumeration: window.midnight." + key);
              return 1;
            }
            // Also accept if the object has wallet-like properties
            if (obj.name || obj.apiVersion || obj.isEnabled) {
              console.log("[MidnightWebGL] Found via enumeration (wallet properties): window.midnight." + key);
              return 1;
            }
          }
        }
      }

      // Check window.cardano
      if (window.cardano) {
        console.log("[MidnightWebGL] window.cardano:", Object.keys(window.cardano));
        if (window.cardano.midnight && typeof window.cardano.midnight.enable === "function") {
          console.log("[MidnightWebGL] Found: window.cardano.midnight");
          return 1;
        }
        if (window.cardano.lace && typeof window.cardano.lace.enable === "function") {
          console.log("[MidnightWebGL] Found: window.cardano.lace");
          return 1;
        }
      }

      console.log("[MidnightWebGL] Lace NOT detected");
      return 0;
    } catch (e) {
      console.warn("[MidnightWebGL] IsLaceAvailable error:", e);
      return 0;
    }
  },

  // ============================================================
  // IsMidnightConnectorAvailable
  // ============================================================
  IsMidnightConnectorAvailable: function () {
    try {
      if (window.midnight) {
        if (typeof window.midnight.enable === "function") return 1;
        var keys = Object.keys(window.midnight);
        for (var i = 0; i < keys.length; i++) {
          var obj = window.midnight[keys[i]];
          if (obj && typeof obj === "object" && typeof obj.enable === "function") return 1;
        }
      }
      if (window.cardano && window.cardano.midnight && typeof window.cardano.midnight.enable === "function") return 1;
      return 0;
    } catch (e) {
      return 0;
    }
  },

  // ============================================================
  // IsLaceAvailableDelayed
  // ============================================================
  IsLaceAvailableDelayed: function (gameObjectNamePtr, callbackPtr, delayMs) {
    var gameObjectName = UTF8ToString(gameObjectNamePtr);
    var callback = UTF8ToString(callbackPtr);
    var delay = delayMs || 1000;

    console.log("[MidnightWebGL] IsLaceAvailableDelayed - waiting " + delay + "ms...");

    setTimeout(function () {
      var found = false;
      var foundPath = "";

      // Check window.midnight
      if (window.midnight) {
        if (typeof window.midnight.enable === "function") {
          found = true;
          foundPath = "window.midnight";
        } else {
          var knownNames = ["mnLace", "lace", "midnight", "Lace"];
          for (var i = 0; i < knownNames.length && !found; i++) {
            var name = knownNames[i];
            var walletObj = window.midnight[name];
            if (walletObj) {
              // Accept if has enable function OR has wallet properties
              if (typeof walletObj.enable === "function" || walletObj.name || walletObj.apiVersion) {
                found = true;
                foundPath = "window.midnight." + name;
              }
            }
          }
          if (!found) {
            var midnightKeys = Object.keys(window.midnight);
            for (var j = 0; j < midnightKeys.length && !found; j++) {
              var key = midnightKeys[j];
              var obj = window.midnight[key];
              if (obj && typeof obj === "object") {
                if (typeof obj.enable === "function" || obj.name || obj.apiVersion) {
                  found = true;
                  foundPath = "window.midnight." + key;
                }
              }
            }
          }
        }
      }

      // Check window.cardano
      if (!found && window.cardano) {
        if (window.cardano.midnight && typeof window.cardano.midnight.enable === "function") {
          found = true;
          foundPath = "window.cardano.midnight";
        } else if (window.cardano.lace && typeof window.cardano.lace.enable === "function") {
          found = true;
          foundPath = "window.cardano.lace";
        }
      }

      var result = found ? "1" : "0";
      console.log("[MidnightWebGL] IsLaceAvailableDelayed result:", result, foundPath ? "(" + foundPath + ")" : "");
      SendMessage(gameObjectName, callback, result);
    }, delay);
  },

  // ============================================================
  // ConnectLace
  // ============================================================
  ConnectLace: function (gameObjectNamePtr, successCallbackPtr, errorCallbackPtr) {
    var gameObjectName = UTF8ToString(gameObjectNamePtr);
    var successCallback = UTF8ToString(successCallbackPtr);
    var errorCallback = UTF8ToString(errorCallbackPtr);

    console.log("[MidnightWebGL] ConnectLace() called");

    (async function () {
      try {
        // Helper function to find wallet connector
        function findWalletConnector() {
          var connector = null;
          var connectorName = "";
          var connectorPath = "";

          // Check window.cardano first (most common for Lace)
          if (window.cardano) {
            // Try lace first
            if (window.cardano.lace && typeof window.cardano.lace.enable === "function") {
              return { connector: window.cardano.lace, name: "lace", path: "window.cardano.lace" };
            }
            // Try midnight
            if (window.cardano.midnight && typeof window.cardano.midnight.enable === "function") {
              return { connector: window.cardano.midnight, name: "midnight", path: "window.cardano.midnight" };
            }
            // Try any other wallet
            var keys = Object.keys(window.cardano);
            for (var i = 0; i < keys.length; i++) {
              var key = keys[i];
              var obj = window.cardano[key];
              if (obj && typeof obj === "object" && typeof obj.enable === "function") {
                return { connector: obj, name: key, path: "window.cardano." + key };
              }
            }
          }

          // Check window.midnight
          if (window.midnight) {
            if (window.midnight.mnLace && typeof window.midnight.mnLace.enable === "function") {
              return { connector: window.midnight.mnLace, name: "mnLace", path: "window.midnight.mnLace" };
            }
            if (typeof window.midnight.enable === "function") {
              return { connector: window.midnight, name: "midnight", path: "window.midnight" };
            }
            var mkeys = Object.keys(window.midnight);
            for (var j = 0; j < mkeys.length; j++) {
              var mkey = mkeys[j];
              var mobj = window.midnight[mkey];
              if (mobj && typeof mobj === "object" && typeof mobj.enable === "function") {
                return { connector: mobj, name: mkey, path: "window.midnight." + mkey };
              }
            }
          }

          return null;
        }

        // Wait for wallet to be available (up to 3 seconds)
        var maxWait = 3000;
        var waitInterval = 100;
        var waited = 0;
        var found = findWalletConnector();

        while (!found && waited < maxWait) {
          await new Promise(function(resolve) { setTimeout(resolve, waitInterval); });
          waited += waitInterval;
          found = findWalletConnector();
        }

        console.log("[MidnightWebGL] Wallet search completed after " + waited + "ms");

        // Use the found connector or throw error
        var connector = null;
        var connectorName = "";
        var connectorPath = "";

        if (found) {
          connector = found.connector;
          connectorName = found.name;
          connectorPath = found.path;
          console.log("[MidnightWebGL] Found connector:", connectorPath);
        } else {
          // Log what we found for debugging
          console.log("[MidnightWebGL] No connector found after waiting");
          console.log("[MidnightWebGL] window.cardano:", window.cardano ? Object.keys(window.cardano) : "undefined");
          console.log("[MidnightWebGL] window.midnight:", window.midnight ? Object.keys(window.midnight) : "undefined");
          
          if (window.cardano) {
            var cardanoKeys = Object.keys(window.cardano);
            for (var ck = 0; ck < cardanoKeys.length; ck++) {
              var ckey = cardanoKeys[ck];
              var cobj = window.cardano[ckey];
              if (cobj && typeof cobj === "object") {
                console.log("[MidnightWebGL] window.cardano." + ckey + " keys:", Object.keys(cobj));
                console.log("[MidnightWebGL] window.cardano." + ckey + ".enable:", typeof cobj.enable);
              }
            }
          }
          
          throw new Error(
            "Wallet connector not found with enable() method. Make sure Lace wallet is installed, unlocked, and the page is refreshed."
          );
        }

        console.log("[MidnightWebGL] Using connector at:", connectorPath);

        if (typeof connector.isEnabled === "function") {
          var enabled = await connector.isEnabled();
          console.log("[MidnightWebGL] " + connectorPath + ".isEnabled() =", enabled);
        }

        console.log("[MidnightWebGL] Calling " + connectorPath + ".enable()...");
        var api = await connector.enable();

        if (!api) {
          throw new Error("Failed to enable wallet connector (no api returned).");
        }

        console.log("[MidnightWebGL] enable() returned api. Keys:", Object.keys(api));

        if (typeof connector.isEnabled === "function") {
          var enabledAfter = await connector.isEnabled();
          console.log("[MidnightWebGL] isEnabled() after enable:", enabledAfter);
          if (!enabledAfter) {
            throw new Error("Wallet not authorized (isEnabled() returned false after enable).");
          }
        }

        var address = null;
        var state = null;
        var apiMode = "unknown";

        // Try Midnight API first (has state() method)
        if (typeof api.state === "function") {
          apiMode = "midnight";
          console.log("[MidnightWebGL] Using Midnight API - calling api.state()...");
          state = await api.state();
          console.log("[MidnightWebGL] state() returned:", state);
          
          if (state) {
            address = state.address || state.shieldAddress || state.shieldedAddress || state.addressLegacy;
          }
        }
        // Fall back to Cardano API (has getUsedAddresses())
        else if (typeof api.getUsedAddresses === "function") {
          apiMode = "cardano";
          console.log("[MidnightWebGL] Using Cardano CIP-30 API - calling api.getUsedAddresses()...");
          var addresses = await api.getUsedAddresses();
          console.log("[MidnightWebGL] getUsedAddresses() returned:", addresses);
          
          if (addresses && addresses.length > 0) {
            // Cardano addresses are hex-encoded, first one is typically the main address
            address = addresses[0];
            state = { address: address, addresses: addresses };
          } else {
            // Try getChangeAddress as fallback
            console.log("[MidnightWebGL] No used addresses, trying getChangeAddress()...");
            var changeAddr = await api.getChangeAddress();
            console.log("[MidnightWebGL] getChangeAddress() returned:", changeAddr);
            if (changeAddr) {
              address = changeAddr;
              state = { address: address };
            }
          }
        } else {
          console.warn("[MidnightWebGL] api object keys:", Object.keys(api));
          throw new Error("Wallet API has no supported address method. API keys: " + Object.keys(api).join(", "));
        }

        if (!address) {
          throw new Error("Connected, but could not retrieve address from wallet.");
        }

        console.log("[MidnightWebGL] Connected via " + apiMode.toUpperCase() + " API! Address:", address);

        // Detect network
        var networkId = -1;
        var networkName = "unknown";
        
        try {
          if (apiMode === "cardano" && typeof api.getNetworkId === "function") {
            // Cardano CIP-30: 0 = testnet, 1 = mainnet
            networkId = await api.getNetworkId();
            console.log("[MidnightWebGL] Cardano networkId:", networkId);
            
            if (networkId === 0) {
              // Could be preprod or preview - check address prefix
              // preprod/preview addresses start with "addr_test"
              networkName = "testnet"; // Generic testnet, can't distinguish preprod vs preview from API alone
            } else if (networkId === 1) {
              networkName = "mainnet";
            }
          } else if (apiMode === "midnight") {
            // For Midnight, try to get network from serviceUriConfig
            if (typeof api.serviceUriConfig === "function") {
              try {
                var svcConfig = await api.serviceUriConfig();
                console.log("[MidnightWebGL] Midnight serviceUriConfig:", svcConfig);
                
                if (svcConfig) {
                  // Check indexer URL or other config to determine network
                  var configStr = JSON.stringify(svcConfig).toLowerCase();
                  if (configStr.includes("mainnet")) {
                    networkName = "mainnet";
                    networkId = 1;
                  } else if (configStr.includes("preprod")) {
                    networkName = "preprod";
                    networkId = 0;
                  } else if (configStr.includes("preview")) {
                    networkName = "preview";
                    networkId = 0;
                  } else if (configStr.includes("testnet")) {
                    networkName = "testnet";
                    networkId = 0;
                  }
                }
              } catch (svcErr) {
                console.warn("[MidnightWebGL] Could not get serviceUriConfig:", svcErr);
              }
            }
          }
        } catch (netErr) {
          console.warn("[MidnightWebGL] Could not detect network:", netErr);
        }
        
        console.log("[MidnightWebGL] Network detected:", networkName, "(id:", networkId, ")");

        window.__walletApi = api;
        window.__walletState = state;
        window.__walletConnectorName = connectorName;
        window.__walletConnectorPath = connectorPath;
        window.__walletApiMode = apiMode;
        window.__walletNetworkId = networkId;
        window.__walletNetworkName = networkName;

        // Return JSON with address, mode, and network so Unity knows which API and network is active
        var result = JSON.stringify({ address: address, mode: apiMode, networkId: networkId, network: networkName });
        SendMessage(gameObjectName, successCallback, result);
      } catch (err) {
        var msg = (err && err.message) ? err.message : String(err);

        var lower = msg.toLowerCase();
        if (lower.includes("rejected") || lower.includes("declined") || lower.includes("deny") || lower.includes("cancel")) {
          msg = "User rejected the wallet connection request.";
        }

        console.error("[MidnightWebGL] ConnectLace error:", msg);
        SendMessage(gameObjectName, errorCallback, msg);
      }
    })();
  },

  // ============================================================
  // IsWalletConnected
  // ============================================================
  IsWalletConnected: function () {
    try {
      return (typeof window !== "undefined" && window.__walletApi) ? 1 : 0;
    } catch (e) {
      return 0;
    }
  },

  // ============================================================
  // DisconnectLace
  // ============================================================
  DisconnectLace: function () {
    try {
      console.log("[MidnightWebGL] DisconnectLace() clearing local api reference");
      window.__walletApi = null;
      window.__walletState = null;
      return 1;
    } catch (e) {
      return 0;
    }
  },

  // ============================================================
  // GetConnectedAddress
  // ============================================================
  GetConnectedAddress: function (gameObjectNamePtr, callbackPtr, errorCallbackPtr) {
    var gameObjectName = UTF8ToString(gameObjectNamePtr);
    var callback = UTF8ToString(callbackPtr);
    var errorCallback = UTF8ToString(errorCallbackPtr);

    try {
      if (!window.__walletState) {
        throw new Error("No wallet state found. Connect first.");
      }
      var addr = window.__walletState.address || window.__walletState.shieldAddress || window.__walletState.shieldedAddress;
      if (!addr) throw new Error("Connected state has no address field.");
      SendMessage(gameObjectName, callback, String(addr));
    } catch (err) {
      var msg = (err && err.message) ? err.message : String(err);
      SendMessage(gameObjectName, errorCallback, msg);
    }
  },

  // ============================================================
  // MidnightGetWalletState (Midnight DApp Connector)
  // ============================================================
  // Returns full wallet state including address and balances.
  // Response JSON: { address, balances: { "native": "amount", "tokenId": "amount", ... } }
  // ============================================================
  MidnightGetWalletState: function (gameObjectNamePtr, successCallbackPtr, errorCallbackPtr) {
    var gameObjectName = UTF8ToString(gameObjectNamePtr);
    var successCallback = UTF8ToString(successCallbackPtr);
    var errorCallback = UTF8ToString(errorCallbackPtr);

    console.log("[MidnightWebGL] MidnightGetWalletState() called");
    console.log("[MidnightWebGL] Target GameObject:", gameObjectName, "Callbacks:", successCallback, errorCallback);

    (async function () {
      try {
        console.log("[MidnightWebGL] Checking wallet API...");
        console.log("[MidnightWebGL] window.__walletApi:", window.__walletApi);
        console.log("[MidnightWebGL] window.__walletApiMode:", window.__walletApiMode);
        
        if (!window.__walletApi) {
          throw new Error("Wallet not connected. Connect first.");
        }

        if (window.__walletApiMode !== "midnight") {
          throw new Error("MidnightGetWalletState is only available in midnight mode. Current mode: " + window.__walletApiMode);
        }

        console.log("[MidnightWebGL] Wallet API methods:", Object.keys(window.__walletApi));
        
        if (typeof window.__walletApi.state !== "function") {
          throw new Error("Wallet API does not support state(). Available methods: " + Object.keys(window.__walletApi).join(", "));
        }

        console.log("[MidnightWebGL] Calling wallet.state()...");
        var walletState = await window.__walletApi.state();
        console.log("[MidnightWebGL] Wallet state received:", walletState);
        console.log("[MidnightWebGL] Wallet state type:", typeof walletState);
        console.log("[MidnightWebGL] Wallet state keys:", walletState ? Object.keys(walletState) : "null");

        // Build response with address and balances
        var response = {
          address: walletState.address || "",
          balances: {}
        };

        // Extract balances - format depends on wallet implementation
        // Midnight wallet state typically has balances as an object or map
        console.log("[MidnightWebGL] walletState.balances:", walletState.balances);
        console.log("[MidnightWebGL] walletState.balance:", walletState.balance);
        
        if (walletState.balances) {
          console.log("[MidnightWebGL] balances type:", typeof walletState.balances);
          console.log("[MidnightWebGL] balances is Map:", walletState.balances instanceof Map);
          
          if (typeof walletState.balances === "object") {
            // Could be a Map or plain object
            if (walletState.balances instanceof Map) {
              walletState.balances.forEach(function(value, key) {
                console.log("[MidnightWebGL] Map balance:", key, "=", value);
                response.balances[String(key)] = String(value);
              });
            } else {
              // Plain object
              for (var tokenId in walletState.balances) {
                if (walletState.balances.hasOwnProperty(tokenId)) {
                  console.log("[MidnightWebGL] Object balance:", tokenId, "=", walletState.balances[tokenId]);
                  response.balances[tokenId] = String(walletState.balances[tokenId]);
                }
              }
            }
          }
        }

        // Also check for specific balance fields
        if (walletState.balance !== undefined) {
          console.log("[MidnightWebGL] Found balance field:", walletState.balance);
          response.balances["native"] = String(walletState.balance);
        }

        // Check for tDUST specifically (Midnight testnet token)
        if (walletState.tDUST !== undefined) {
          console.log("[MidnightWebGL] Found tDUST field:", walletState.tDUST);
          response.balances["tDUST"] = String(walletState.tDUST);
        }

        var payload = JSON.stringify(response);
        console.log("[MidnightWebGL] MidnightGetWalletState response:", payload);
        console.log("[MidnightWebGL] Sending to Unity:", gameObjectName, successCallback);
        SendMessage(gameObjectName, successCallback, payload);
        console.log("[MidnightWebGL] SendMessage completed");
      } catch (err) {
        var msg = (err && err.message) ? err.message : String(err);
        console.error("[MidnightWebGL] MidnightGetWalletState error:", msg);
        console.error("[MidnightWebGL] Full error:", err);
        SendMessage(gameObjectName, errorCallback, msg);
      }
    })();
  },

  // ============================================================
  // MidnightGetServiceUriConfig (Midnight DApp Connector)
  // ============================================================
  MidnightGetServiceUriConfig: function (gameObjectNamePtr, successCallbackPtr, errorCallbackPtr) {
    var gameObjectName = UTF8ToString(gameObjectNamePtr);
    var successCallback = UTF8ToString(successCallbackPtr);
    var errorCallback = UTF8ToString(errorCallbackPtr);

    console.log("[MidnightWebGL] MidnightGetServiceUriConfig() called");

    (async function () {
      try {
        if (!window.__walletApi) {
          throw new Error("Wallet not connected. Connect first.");
        }

        if (window.__walletApiMode !== "midnight") {
          throw new Error("MidnightGetServiceUriConfig is only available in midnight mode.");
        }

        if (typeof window.__walletApi.serviceUriConfig !== "function") {
          throw new Error("Wallet API does not support serviceUriConfig().");
        }

        var cfg = await window.__walletApi.serviceUriConfig();
        var payload = JSON.stringify(cfg || {});
        SendMessage(gameObjectName, successCallback, payload);
      } catch (err) {
        var msg = (err && err.message) ? err.message : String(err);
        console.error("[MidnightWebGL] MidnightGetServiceUriConfig error:", msg);
        SendMessage(gameObjectName, errorCallback, msg);
      }
    })();
  },

  // ============================================================
  // MidnightCounterIncrement (Midnight DApp Connector)
  // ============================================================
  // Args:
  // - contractAddressPtr: contract address (format expected by your counter JS bindings)
  // - counterBindingsGlobalPtr: optional global name where your counter bindings are exposed (default: "MidnightCounter")
  // ============================================================
  MidnightCounterIncrement: function (gameObjectNamePtr, successCallbackPtr, errorCallbackPtr, contractAddressPtr, counterBindingsGlobalPtr) {
    var gameObjectName = UTF8ToString(gameObjectNamePtr);
    var successCallback = UTF8ToString(successCallbackPtr);
    var errorCallback = UTF8ToString(errorCallbackPtr);
    var contractAddress = UTF8ToString(contractAddressPtr);
    var rawBindingsName = (counterBindingsGlobalPtr && counterBindingsGlobalPtr !== 0) ? UTF8ToString(counterBindingsGlobalPtr) : "";
    var bindingsName = (rawBindingsName && rawBindingsName.trim() !== "") ? rawBindingsName.trim() : "MidnightCounter";

    console.log("[MidnightWebGL] MidnightCounterIncrement() called");
    console.log("[MidnightWebGL]   contractAddress:", contractAddress);
    console.log("[MidnightWebGL]   bindingsName:", bindingsName);

    (async function () {
      try {
        if (!window.__walletApi) {
          throw new Error("Wallet not connected. Connect first.");
        }

        if (window.__walletApiMode !== "midnight") {
          throw new Error("MidnightCounterIncrement is only available in midnight mode.");
        }

        if (!contractAddress || contractAddress.trim() === "") {
          throw new Error("contractAddress is required but was empty or null.");
        }

        if (typeof window.__walletApi.balanceAndProveTransaction !== "function") {
          throw new Error("Wallet API does not support balanceAndProveTransaction().");
        }

        if (typeof window.__walletApi.submitTransaction !== "function") {
          throw new Error("Wallet API does not support submitTransaction().");
        }

        var bindings = window[bindingsName];
        if (!bindings || typeof bindings.buildIncrementTransaction !== "function") {
          throw new Error(
            "Missing counter bindings. Expected window['" + bindingsName + "'].buildIncrementTransaction(contractAddress, serviceUriConfig)."
          );
        }

        var serviceCfg = null;
        if (typeof window.__walletApi.serviceUriConfig === "function") {
          serviceCfg = await window.__walletApi.serviceUriConfig();
        }

        var tx = await bindings.buildIncrementTransaction(contractAddress, serviceCfg);
        if (!tx) {
          throw new Error("buildIncrementTransaction returned null/undefined transaction.");
        }

        var balancedAndProvenTx = await window.__walletApi.balanceAndProveTransaction(tx);
        var submitted = await window.__walletApi.submitTransaction(balancedAndProvenTx);

        var payload = JSON.stringify({ submitted: submitted, connectorPath: window.__walletConnectorPath || "", mode: window.__walletApiMode });
        SendMessage(gameObjectName, successCallback, payload);
      } catch (err) {
        var msg = (err && err.message) ? err.message : String(err);

        var lower = msg.toLowerCase();
        if (lower.includes("rejected") || lower.includes("declined") || lower.includes("deny") || lower.includes("cancel")) {
          msg = "User rejected the transaction request.";
        }

        console.error("[MidnightWebGL] MidnightCounterIncrement error:", msg);
        SendMessage(gameObjectName, errorCallback, msg);
      }
    })();
  },

  // ============================================================
  // MidnightCounterGetCount (Midnight DApp Connector)
  // ============================================================
  // Args:
  // - contractAddressPtr
  // - counterBindingsGlobalPtr: optional global name where your counter bindings are exposed (default: "MidnightCounter")
  // ============================================================
  MidnightCounterGetCount: function (gameObjectNamePtr, successCallbackPtr, errorCallbackPtr, contractAddressPtr, counterBindingsGlobalPtr) {
    var gameObjectName = UTF8ToString(gameObjectNamePtr);
    var successCallback = UTF8ToString(successCallbackPtr);
    var errorCallback = UTF8ToString(errorCallbackPtr);
    var contractAddress = UTF8ToString(contractAddressPtr);
    var rawBindingsName = (counterBindingsGlobalPtr && counterBindingsGlobalPtr !== 0) ? UTF8ToString(counterBindingsGlobalPtr) : "";
    var bindingsName = (rawBindingsName && rawBindingsName.trim() !== "") ? rawBindingsName.trim() : "MidnightCounter";

    console.log("[MidnightWebGL] MidnightCounterGetCount() called");
    console.log("[MidnightWebGL]   contractAddress:", contractAddress);
    console.log("[MidnightWebGL]   bindingsName:", bindingsName);

    (async function () {
      try {
        if (!window.__walletApi) {
          throw new Error("Wallet not connected. Connect first.");
        }

        if (window.__walletApiMode !== "midnight") {
          throw new Error("MidnightCounterGetCount is only available in midnight mode.");
        }

        if (!contractAddress || contractAddress.trim() === "") {
          throw new Error("contractAddress is required but was empty or null.");
        }

        var bindings = window[bindingsName];
        if (!bindings || typeof bindings.getCount !== "function") {
          throw new Error(
            "Missing counter bindings. Expected window['" + bindingsName + "'].getCount(contractAddress, serviceUriConfig)."
          );
        }

        var serviceCfg = null;
        if (typeof window.__walletApi.serviceUriConfig === "function") {
          serviceCfg = await window.__walletApi.serviceUriConfig();
        }

        var count = await bindings.getCount(contractAddress, serviceCfg);
        if (count === null || typeof count === "undefined") {
          throw new Error("getCount returned null/undefined.");
        }

        SendMessage(gameObjectName, successCallback, String(count));
      } catch (err) {
        var msg = (err && err.message) ? err.message : String(err);
        console.error("[MidnightWebGL] MidnightCounterGetCount error:", msg);
        SendMessage(gameObjectName, errorCallback, msg);
      }
    })();
  },

  // ============================================================
  // SignTransaction (Cardano API)
  // ============================================================
  // Signs a transaction using the connected wallet.
  // txCbor: hex-encoded CBOR transaction
  // partialSign: if true, allows partial signing
  // ============================================================
  SignTransaction: function (gameObjectNamePtr, successCallbackPtr, errorCallbackPtr, txCborPtr, partialSign) {
    var gameObjectName = UTF8ToString(gameObjectNamePtr);
    var successCallback = UTF8ToString(successCallbackPtr);
    var errorCallback = UTF8ToString(errorCallbackPtr);
    var txCbor = UTF8ToString(txCborPtr);

    console.log("[MidnightWebGL] SignTransaction() called");

    (async function () {
      try {
        if (!window.__walletApi) {
          throw new Error("Wallet not connected. Connect first.");
        }

        if (window.__walletApiMode !== "cardano") {
          throw new Error("SignTransaction is cardano mode only.");
        }

        if (typeof window.__walletApi.signTx !== "function") {
          throw new Error("Wallet API does not support signTx()");
        }

        console.log("[MidnightWebGL] Calling signTx with CBOR length:", txCbor.length);
        var signedTx = await window.__walletApi.signTx(txCbor, partialSign ? true : false);
        
        console.log("[MidnightWebGL] signTx() returned:", signedTx ? "signed tx" : "null");
        
        if (!signedTx) {
          throw new Error("signTx returned null");
        }

        SendMessage(gameObjectName, successCallback, String(signedTx));
      } catch (err) {
        var msg = (err && err.message) ? err.message : String(err);
        
        var lower = msg.toLowerCase();
        if (lower.includes("rejected") || lower.includes("declined") || lower.includes("deny") || lower.includes("cancel")) {
          msg = "User rejected the transaction signing request.";
        }

        console.error("[MidnightWebGL] SignTransaction error:", msg);
        SendMessage(gameObjectName, errorCallback, msg);
      }
    })();
  },

  // ============================================================
  // SubmitTransaction (Cardano API)
  // ============================================================
  // Submits a signed transaction to the network.
  // signedTxCbor: hex-encoded CBOR of the signed transaction
  // ============================================================
  SubmitTransaction: function (gameObjectNamePtr, successCallbackPtr, errorCallbackPtr, signedTxCborPtr) {
    var gameObjectName = UTF8ToString(gameObjectNamePtr);
    var successCallback = UTF8ToString(successCallbackPtr);
    var errorCallback = UTF8ToString(errorCallbackPtr);
    var signedTxCbor = UTF8ToString(signedTxCborPtr);

    console.log("[MidnightWebGL] SubmitTransaction() called");

    (async function () {
      try {
        if (!window.__walletApi) {
          throw new Error("Wallet not connected. Connect first.");
        }

        if (window.__walletApiMode !== "cardano") {
          throw new Error("SubmitTransaction is cardano mode only.");
        }

        if (typeof window.__walletApi.submitTx !== "function") {
          throw new Error("Wallet API does not support submitTx()");
        }

        console.log("[MidnightWebGL] Calling submitTx with CBOR length:", signedTxCbor.length);
        var txHash = await window.__walletApi.submitTx(signedTxCbor);
        
        console.log("[MidnightWebGL] submitTx() returned txHash:", txHash);
        
        if (!txHash) {
          throw new Error("submitTx returned null");
        }

        SendMessage(gameObjectName, successCallback, String(txHash));
      } catch (err) {
        var msg = (err && err.message) ? err.message : String(err);
        console.error("[MidnightWebGL] SubmitTransaction error:", msg);
        SendMessage(gameObjectName, errorCallback, msg);
      }
    })();
  },

  // ============================================================
  // SignData (Cardano API)
  // ============================================================
  // Signs arbitrary data with the wallet (for authentication/verification).
  // addressHex: hex-encoded address to sign with
  // payloadHex: hex-encoded data to sign
  // ============================================================
  SignData: function (gameObjectNamePtr, successCallbackPtr, errorCallbackPtr, addressHexPtr, payloadHexPtr) {
    var gameObjectName = UTF8ToString(gameObjectNamePtr);
    var successCallback = UTF8ToString(successCallbackPtr);
    var errorCallback = UTF8ToString(errorCallbackPtr);
    var addressHex = UTF8ToString(addressHexPtr);
    var payloadHex = UTF8ToString(payloadHexPtr);

    console.log("[MidnightWebGL] SignData() called");

    (async function () {
      try {
        if (!window.__walletApi) {
          throw new Error("Wallet not connected. Connect first.");
        }

        if (window.__walletApiMode !== "cardano") {
          throw new Error("SignData is cardano mode only.");
        }

        if (typeof window.__walletApi.signData !== "function") {
          throw new Error("Wallet API does not support signData()");
        }

        console.log("[MidnightWebGL] Calling signData...");
        var signature = await window.__walletApi.signData(addressHex, payloadHex);
        
        console.log("[MidnightWebGL] signData() returned signature");
        
        if (!signature) {
          throw new Error("signData returned null");
        }

        // Return as JSON since signature has multiple fields (key, signature)
        var result = JSON.stringify(signature);
        SendMessage(gameObjectName, successCallback, result);
      } catch (err) {
        var msg = (err && err.message) ? err.message : String(err);
        
        var lower = msg.toLowerCase();
        if (lower.includes("rejected") || lower.includes("declined") || lower.includes("deny") || lower.includes("cancel")) {
          msg = "User rejected the data signing request.";
        }

        console.error("[MidnightWebGL] SignData error:", msg);
        SendMessage(gameObjectName, errorCallback, msg);
      }
    })();
  },

  // ============================================================
  // GetBalance (Cardano API)
  // ============================================================
  // Gets the wallet balance including all tokens.
  // Returns JSON: { "address": "", "balances": { "lovelace": "amount", "policyId.assetName": "amount", ... } }
  // ============================================================
  GetBalance: function (gameObjectNamePtr, successCallbackPtr, errorCallbackPtr) {
    var gameObjectName = UTF8ToString(gameObjectNamePtr);
    var successCallback = UTF8ToString(successCallbackPtr);
    var errorCallback = UTF8ToString(errorCallbackPtr);

    console.log("[MidnightWebGL] GetBalance() called");
    console.log("[MidnightWebGL] Target GameObject:", gameObjectName, "Callbacks:", successCallback, errorCallback);

    (async function () {
      try {
        console.log("[MidnightWebGL] Checking wallet API for Cardano balance...");
        console.log("[MidnightWebGL] window.__walletApi:", window.__walletApi);
        console.log("[MidnightWebGL] window.__walletApiMode:", window.__walletApiMode);
        
        if (!window.__walletApi) {
          throw new Error("Wallet not connected. Connect first.");
        }

        if (window.__walletApiMode !== "cardano") {
          throw new Error("GetBalance is cardano mode only. Current mode: " + window.__walletApiMode);
        }

        console.log("[MidnightWebGL] Cardano API methods:", Object.keys(window.__walletApi));
        
        if (typeof window.__walletApi.getBalance !== "function") {
          throw new Error("Wallet API does not support getBalance(). Available: " + Object.keys(window.__walletApi).join(", "));
        }

        console.log("[MidnightWebGL] Calling getBalance()...");
        var balanceCbor = await window.__walletApi.getBalance();
        console.log("[MidnightWebGL] getBalance() returned CBOR:", balanceCbor);
        console.log("[MidnightWebGL] CBOR length:", balanceCbor ? balanceCbor.length : 0);
        console.log("[MidnightWebGL] window.cbor available:", !!window.cbor);

        var response = {
          address: window.__walletState ? (window.__walletState.address || "") : "",
          balances: {}
        };

        // Parse CBOR balance - it can be either:
        // 1. A simple integer (just lovelace)
        // 2. An array [lovelace, { policyId: { assetName: amount } }]
        // The CBOR is hex-encoded, we need to decode it
        
        try {
          // Try to use a CBOR decoder if available
          if (window.cbor && typeof window.cbor.decode === "function") {
            var bytes = new Uint8Array(balanceCbor.match(/.{1,2}/g).map(function(byte) { return parseInt(byte, 16); }));
            var decoded = window.cbor.decode(bytes);
            console.log("[MidnightWebGL] CBOR decoded:", decoded);
            
            if (typeof decoded === "number" || typeof decoded === "bigint") {
              // Simple lovelace amount
              response.balances["lovelace"] = String(decoded);
            } else if (Array.isArray(decoded) && decoded.length >= 1) {
              // [lovelace, multiAssets]
              response.balances["lovelace"] = String(decoded[0]);
              
              if (decoded.length >= 2 && decoded[1]) {
                // Multi-asset map: { policyId: { assetName: amount } }
                var multiAssets = decoded[1];
                if (multiAssets instanceof Map) {
                  multiAssets.forEach(function(assets, policyId) {
                    var policyHex = typeof policyId === "string" ? policyId : 
                      Array.from(policyId).map(function(b) { return b.toString(16).padStart(2, "0"); }).join("");
                    
                    if (assets instanceof Map) {
                      assets.forEach(function(amount, assetName) {
                        var assetHex = typeof assetName === "string" ? assetName :
                          Array.from(assetName).map(function(b) { return b.toString(16).padStart(2, "0"); }).join("");
                        var tokenId = policyHex + "." + assetHex;
                        response.balances[tokenId] = String(amount);
                      });
                    } else if (typeof assets === "object") {
                      for (var assetName in assets) {
                        var tokenId = policyHex + "." + assetName;
                        response.balances[tokenId] = String(assets[assetName]);
                      }
                    }
                  });
                } else if (typeof multiAssets === "object") {
                  for (var policyId in multiAssets) {
                    var assets = multiAssets[policyId];
                    for (var assetName in assets) {
                      var tokenId = policyId + "." + assetName;
                      response.balances[tokenId] = String(assets[assetName]);
                    }
                  }
                }
              }
            }
          } else {
            // No CBOR decoder available - try simple hex parsing for integer
            // First 2 chars might be CBOR type indicator
            console.log("[MidnightWebGL] No CBOR decoder, attempting simple parse");
            
            // For simple integer CBOR: 1b + 8 bytes for uint64
            if (balanceCbor.length >= 2) {
              var typeTag = parseInt(balanceCbor.substring(0, 2), 16);
              
              if (typeTag <= 0x17) {
                // Tiny integer (0-23)
                response.balances["lovelace"] = String(typeTag);
              } else if (typeTag === 0x18) {
                // 1-byte uint
                response.balances["lovelace"] = String(parseInt(balanceCbor.substring(2, 4), 16));
              } else if (typeTag === 0x19) {
                // 2-byte uint
                response.balances["lovelace"] = String(parseInt(balanceCbor.substring(2, 6), 16));
              } else if (typeTag === 0x1a) {
                // 4-byte uint
                response.balances["lovelace"] = String(parseInt(balanceCbor.substring(2, 10), 16));
              } else if (typeTag === 0x1b) {
                // 8-byte uint (use BigInt for large values)
                var hex = balanceCbor.substring(2, 18);
                try {
                  response.balances["lovelace"] = String(BigInt("0x" + hex));
                } catch (e) {
                  response.balances["lovelace"] = String(parseInt(hex, 16));
                }
              } else if (typeTag >= 0x80 && typeTag <= 0x9f) {
                // Array - likely [lovelace, multiAssets] but we can't parse without CBOR lib
                console.log("[MidnightWebGL] Multi-asset balance detected but no CBOR decoder available");
                response.balances["lovelace"] = "0";
                response.balances["_note"] = "Install cbor-js for full token support";
              }
            }
          }
        } catch (parseErr) {
          console.warn("[MidnightWebGL] CBOR parse error:", parseErr);
          // Fallback: return raw hex
          response.balances["_raw"] = balanceCbor;
        }

        var payload = JSON.stringify(response);
        console.log("[MidnightWebGL] GetBalance response:", payload);
        SendMessage(gameObjectName, successCallback, payload);
      } catch (err) {
        var msg = (err && err.message) ? err.message : String(err);
        console.error("[MidnightWebGL] GetBalance error:", msg);
        SendMessage(gameObjectName, errorCallback, msg);
      }
    })();
  },

  // ============================================================
  // GetUtxos (Cardano API)
  // ============================================================
  // Gets the wallet's UTXOs (unspent transaction outputs).
  // Returns JSON array of hex-encoded CBOR UTXOs.
  // ============================================================
  GetUtxos: function (gameObjectNamePtr, successCallbackPtr, errorCallbackPtr) {
    var gameObjectName = UTF8ToString(gameObjectNamePtr);
    var successCallback = UTF8ToString(successCallbackPtr);
    var errorCallback = UTF8ToString(errorCallbackPtr);

    console.log("[MidnightWebGL] GetUtxos() called");

    (async function () {
      try {
        if (!window.__walletApi) {
          throw new Error("Wallet not connected. Connect first.");
        }

        if (window.__walletApiMode !== "cardano") {
          throw new Error("GetUtxos is cardano mode only.");
        }

        if (typeof window.__walletApi.getUtxos !== "function") {
          throw new Error("Wallet API does not support getUtxos()");
        }

        var utxos = await window.__walletApi.getUtxos();
        console.log("[MidnightWebGL] getUtxos() returned:", utxos ? utxos.length + " utxos" : "null");

        var result = JSON.stringify(utxos || []);
        SendMessage(gameObjectName, successCallback, result);
      } catch (err) {
        var msg = (err && err.message) ? err.message : String(err);
        console.error("[MidnightWebGL] GetUtxos error:", msg);
        SendMessage(gameObjectName, errorCallback, msg);
      }
    })();
  },

  // ============================================================
  // CopyToClipboard
  // ============================================================
  CopyToClipboard: function (textPtr) {
    var text = UTF8ToString(textPtr);
    
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function() {
        console.log("[MidnightWebGL] Copied to clipboard:", text.substring(0, 20) + "...");
      }).catch(function(err) {
        console.error("[MidnightWebGL] Clipboard write failed:", err);
        // Fallback
        var textArea = document.createElement("textarea");
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
      });
    } else {
      // Fallback for older browsers
      var textArea = document.createElement("textarea");
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
      console.log("[MidnightWebGL] Copied to clipboard (fallback)");
    }
  },

  // ============================================================
  // MeshIncrementCounter
  // ============================================================
  // Increments an Aiken counter smart contract using MeshJS SDK.
  // Uses locally bundled MeshJS, builds tx, signs via CIP-30 wallet, submits.
  // ============================================================
  MeshIncrementCounter: function (gameObjectNamePtr, successCallbackPtr, errorCallbackPtr, scriptAddressPtr, blockfrostKeyPtr) {
    var gameObjectName = UTF8ToString(gameObjectNamePtr);
    var successCallback = UTF8ToString(successCallbackPtr);
    var errorCallback = UTF8ToString(errorCallbackPtr);
    var scriptAddress = UTF8ToString(scriptAddressPtr);
    var blockfrostKey = UTF8ToString(blockfrostKeyPtr);

    console.log("[MidnightWebGL] MeshIncrementCounter() called");
    console.log("[MidnightWebGL] Script address:", scriptAddress);

    // Compiled Aiken counter script (Plutus V3)
    var COUNTER_SCRIPT_CBOR = "59016901010029800aba2aba1aba0aab9faab9eaab9dab9a488888896600264653001300800198041804800cc0200092225980099b8748008c01cdd500144ca60026018003300c300d0019b874800122259800980098059baa0078acc004c030dd5003c566002600260166ea800a26464b30013003300d3754003133223259800980318081baa0018992cc004cdc3a400860226ea8006266e1cdd6980a98091baa001337006eb4c054c048dd500424005164040600460226ea8c050c044dd5000c5900f198021bac300130103754012466ebcc050c044dd5000801980898071baa30113012300e37546022601c6ea80048c048c04cc04c0062c8060cc004dd6180818069baa00623375e6022601c6ea800401488c8cc00400400c896600200314c0103d87a80008992cc004c010006266e952000330130014bd7044cc00c00cc05400900f1809800a0228b20148b201a8b201418041baa0028b200c180400098019baa0088a4d13656400401";

    (async function () {
      try {
        // 1. Check wallet connected
        if (!window.__walletApi) {
          throw new Error("Wallet not connected. Connect first.");
        }

        console.log("[MidnightWebGL] Wallet API mode:", window.__walletApiMode);
        var walletApi = window.__walletApi;

        // 2. Check MeshJS SDK loaded
        console.log("[MidnightWebGL] Checking for MeshJS SDK...");
        
        if (!window.MeshSDK) {
          throw new Error(
            "MeshJS SDK not found. Make sure you're using the MidnightTemplate WebGL template " +
            "with mesh-sdk.bundle.js in TemplateData/. Check console for loading errors."
          );
        }
        
        var SDK = window.MeshSDK;
        console.log("[MidnightWebGL] MeshJS SDK available");
        console.log("[MidnightWebGL] SDK keys:", Object.keys(SDK).slice(0, 15));

        // 3. Create Blockfrost provider
        console.log("[MidnightWebGL] Creating Blockfrost provider...");
        var provider = new SDK.BlockfrostProvider(blockfrostKey);

        // 4. Fetch UTxOs at script address
        console.log("[MidnightWebGL] Fetching UTxOs at script address...");
        var scriptUtxos = await provider.fetchAddressUTxOs(scriptAddress);
        
        console.log("[MidnightWebGL] Found", scriptUtxos.length, "UTxOs");
        
        if (scriptUtxos.length === 0) {
          throw new Error("No UTxOs found at script address");
        }

        // 5. Find UTxO with inline datum
        var scriptUtxo = null;
        for (var i = 0; i < scriptUtxos.length; i++) {
          var utxo = scriptUtxos[i];
          if (utxo.output.plutusData) {
            scriptUtxo = utxo;
            console.log("[MidnightWebGL] Found UTxO with datum at index", i);
            console.log("[MidnightWebGL] UTxO:", JSON.stringify(utxo, null, 2));
            break;
          }
        }

        if (!scriptUtxo) {
          throw new Error("No UTxO with inline datum found");
        }

        // 6. Decode current counter value from datum
        var currentValue = 0n;
        try {
          var datumCbor = scriptUtxo.output.plutusData;
          console.log("[MidnightWebGL] Datum CBOR:", datumCbor);
          
          // Parse CBOR integer - simple cases
          if (datumCbor && datumCbor.length >= 2) {
            var firstByte = parseInt(datumCbor.substring(0, 2), 16);
            if (firstByte <= 0x17) {
              // Direct small integer (0-23)
              currentValue = BigInt(firstByte);
            } else if (firstByte === 0x18) {
              // One-byte unsigned integer
              currentValue = BigInt(parseInt(datumCbor.substring(2, 4), 16));
            } else if (firstByte === 0x19) {
              // Two-byte unsigned integer
              currentValue = BigInt(parseInt(datumCbor.substring(2, 6), 16));
            } else if (firstByte === 0x1a) {
              // Four-byte unsigned integer
              currentValue = BigInt(parseInt(datumCbor.substring(2, 10), 16));
            }
          }
        } catch (decodeErr) {
          console.log("[MidnightWebGL] Datum decode error, using 0:", decodeErr);
          currentValue = 0n;
        }
        
        console.log("[MidnightWebGL] Current counter value:", currentValue.toString());

        // 7. Calculate new value
        var newValue = currentValue + 1n;
        console.log("[MidnightWebGL] New counter value:", newValue.toString());

        // 8. Create new datum CBOR (integer)
        var newDatumCbor;
        if (newValue < 24n) {
          newDatumCbor = newValue.toString(16).padStart(2, "0");
        } else if (newValue < 256n) {
          newDatumCbor = "18" + newValue.toString(16).padStart(2, "0");
        } else if (newValue < 65536n) {
          newDatumCbor = "19" + newValue.toString(16).padStart(4, "0");
        } else {
          newDatumCbor = "1a" + newValue.toString(16).padStart(8, "0");
        }
        console.log("[MidnightWebGL] New datum CBOR:", newDatumCbor);

        // 9. Get wallet UTxOs and addresses
        console.log("[MidnightWebGL] Getting wallet UTxOs...");
        var walletUtxosHex = await walletApi.getUtxos();
        var changeAddressHex = await walletApi.getChangeAddress();
        var collateralHex = await walletApi.getCollateral();
        
        console.log("[MidnightWebGL] Wallet UTxOs:", walletUtxosHex ? walletUtxosHex.length : 0);
        console.log("[MidnightWebGL] Collateral:", collateralHex ? collateralHex.length : 0);

        if (!collateralHex || collateralHex.length === 0) {
          throw new Error("No collateral set in wallet. Please set collateral in Lace wallet settings.");
        }

        // 10. Build the script object
        var script = {
          code: COUNTER_SCRIPT_CBOR,
          version: "V3"
        };

        // 11. Create redeemer (constructor 0, no fields = Increment)
        // MeshJS Data format: { alternative: 0, fields: [] }
        var redeemer = { alternative: 0, fields: [] };
        console.log("[MidnightWebGL] Redeemer:", JSON.stringify(redeemer));

        // 12. Build the transaction using MeshTxBuilder
        console.log("[MidnightWebGL] Building transaction...");
        var txBuilder = new SDK.MeshTxBuilder({
          fetcher: provider,
          verbose: true
        });

        // Get script UTxO value
        var scriptUtxoValue = scriptUtxo.output.amount;
        console.log("[MidnightWebGL] Script UTxO value:", JSON.stringify(scriptUtxoValue));

        var unsignedTx = await txBuilder
          .spendingPlutusScriptV3()
          .txIn(
            scriptUtxo.input.txHash,
            scriptUtxo.input.outputIndex
          )
          .txInInlineDatumPresent()
          .txInRedeemerValue(redeemer)
          .txInScript(COUNTER_SCRIPT_CBOR)
          .txOut(scriptAddress, scriptUtxoValue)
          .txOutInlineDatumValue(newValue < 24n ? Number(newValue) : { int: Number(newValue) })
          .txInCollateral(
            collateralHex[0].input.txHash,
            collateralHex[0].input.outputIndex,
            collateralHex[0].output.amount,
            collateralHex[0].output.address
          )
          .changeAddress(changeAddressHex)
          .selectUtxosFrom(walletUtxosHex)
          .complete();

        console.log("[MidnightWebGL] Transaction built, signing...");

        // 13. Sign the transaction
        var signedTx = await walletApi.signTx(unsignedTx, true);
        console.log("[MidnightWebGL] Transaction signed, submitting...");

        // 14. Submit the transaction
        var txHash = await walletApi.submitTx(signedTx);
        console.log("[MidnightWebGL] Transaction submitted! Hash:", txHash);

        // 15. Return success with JSON containing txHash and values
        var result = JSON.stringify({
          txHash: txHash,
          oldValue: currentValue.toString(),
          newValue: newValue.toString()
        });
        SendMessage(gameObjectName, successCallback, result);

      } catch (err) {
        var msg = (err && err.message) ? err.message : String(err);
        
        var lower = msg.toLowerCase();
        if (lower.includes("rejected") || lower.includes("declined") || lower.includes("deny") || lower.includes("cancel")) {
          msg = "User rejected the transaction.";
        }

        console.error("[MidnightWebGL] MeshIncrementCounter error:", msg);
        console.error("[MidnightWebGL] Full error:", err);
        SendMessage(gameObjectName, errorCallback, msg);
      }
    })();
  },

  // ============================================================
  // BuildAndSendTransaction
  // ============================================================
  // Builds a simple ADA transfer transaction, signs it, and submits it.
  // This is a simplified version - real transactions need proper UTXO selection
  // and transaction building which typically requires a library like cardano-serialization-lib.
  // For now, this will use the wallet's built-in transaction building if available,
  // or return an error explaining the limitation.
  // ============================================================
  BuildAndSendTransaction: function (gameObjectNamePtr, successCallbackPtr, errorCallbackPtr, recipientAddressPtr, amountLovelacePtr) {
    var gameObjectName = UTF8ToString(gameObjectNamePtr);
    var successCallback = UTF8ToString(successCallbackPtr);
    var errorCallback = UTF8ToString(errorCallbackPtr);
    var recipientAddress = UTF8ToString(recipientAddressPtr);
    var amountLovelace = UTF8ToString(amountLovelacePtr);

    console.log("[MidnightWebGL] BuildAndSendTransaction() called");
    console.log("[MidnightWebGL] Recipient:", recipientAddress);
    console.log("[MidnightWebGL] Amount (lovelace):", amountLovelace);

    (async function () {
      try {
        if (!window.__walletApi) {
          throw new Error("Wallet not connected. Connect first.");
        }

        if (window.__walletApiMode !== "cardano") {
          throw new Error("BuildAndSendTransaction is cardano mode only.");
        }

        // Check if wallet has experimental API for building transactions
        // Some wallets like Lace support this
        var api = window.__walletApi;
        
        // For CIP-30 wallets, we need to build the transaction ourselves
        // This requires cardano-serialization-lib which is complex to include
        // Instead, we'll check if the wallet has any transaction building capability
        
        if (api.experimental && typeof api.experimental.createTx === "function") {
          // Some wallets have experimental transaction building
          console.log("[MidnightWebGL] Using experimental.createTx...");
          var tx = await api.experimental.createTx({
            outputs: [{
              address: recipientAddress,
              amount: amountLovelace
            }]
          });
          
          console.log("[MidnightWebGL] Signing transaction...");
          var signedTx = await api.signTx(tx, false);
          
          console.log("[MidnightWebGL] Submitting transaction...");
          var txHash = await api.submitTx(signedTx);
          
          console.log("[MidnightWebGL] Transaction submitted! Hash:", txHash);
          SendMessage(gameObjectName, successCallback, txHash);
        } else {
          // Standard CIP-30 doesn't include transaction building
          // We need to inform the user about this limitation
          throw new Error(
            "Transaction building requires cardano-serialization-lib. " +
            "For Preview testnet, you can use: " +
            "1) A DApp with built-in tx building, or " +
            "2) The Lace wallet UI directly to send funds. " +
            "The wallet API only provides signTx/submitTx for pre-built transactions."
          );
        }
      } catch (err) {
        var msg = (err && err.message) ? err.message : String(err);
        
        var lower = msg.toLowerCase();
        if (lower.includes("rejected") || lower.includes("declined") || lower.includes("deny") || lower.includes("cancel")) {
          msg = "User rejected the transaction.";
        }

        console.error("[MidnightWebGL] BuildAndSendTransaction error:", msg);
        SendMessage(gameObjectName, errorCallback, msg);
      }
    })();
  }
};

// Merge into Unity WebGL runtime
mergeInto(LibraryManager.library, MidnightWebGLPlugin);
