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
    console.log("[MidnightWebGL] Time:", new Date().toISOString());

    // ---- Explicit DApp connector path checks ----
    console.log("[MidnightWebGL] --- Explicit connector path checks ---");

    var explicitPaths = [
      { path: "window.midnight",              get: function() { return window.midnight; } },
      { path: "window.midnight.mnLace",       get: function() { return window.midnight && window.midnight.mnLace; } },
      { path: "window.midnight.lace",         get: function() { return window.midnight && window.midnight.lace; } },
      { path: "window.midnight.Lace",         get: function() { return window.midnight && window.midnight.Lace; } },
      { path: "window.midnight.midnight",     get: function() { return window.midnight && window.midnight.midnight; } },
      { path: "window.midnight.MnLace",       get: function() { return window.midnight && window.midnight.MnLace; } },
      { path: "window.midnight.mn_lace",      get: function() { return window.midnight && window.midnight.mn_lace; } },
      { path: "window.cardano",               get: function() { return window.cardano; } },
      { path: "window.cardano.lace",          get: function() { return window.cardano && window.cardano.lace; } },
      { path: "window.cardano.midnight",      get: function() { return window.cardano && window.cardano.midnight; } },
      { path: "window.cardano.mnLace",        get: function() { return window.cardano && window.cardano.mnLace; } },
      { path: "window.cardano.nami",          get: function() { return window.cardano && window.cardano.nami; } },
      { path: "window.lace",                  get: function() { return window.lace; } },
      { path: "window.mnLace",                get: function() { return window.mnLace; } }
    ];

    for (var p = 0; p < explicitPaths.length; p++) {
      var entry = explicitPaths[p];
      try {
        var obj = entry.get();
        if (obj) {
          var t = typeof obj;
          var info = entry.path + " = EXISTS (" + t + ")";
          if (t === "object") {
            var objKeys = Object.keys(obj);
            info += " keys=[" + objKeys.join(", ") + "]";
            if (typeof obj.enable === "function") info += " [HAS enable() - DAPP CONNECTOR]";
            if (typeof obj.isEnabled === "function") info += " [HAS isEnabled()]";
            if (obj.name) info += " name=" + obj.name;
            if (obj.apiVersion) info += " apiVersion=" + obj.apiVersion;
            if (obj.icon) info += " [HAS icon]";
          } else if (t === "function") {
            info += " [is a function]";
          }
          console.log("[MidnightWebGL] CHECK: " + info);
        } else {
          console.log("[MidnightWebGL] CHECK: " + entry.path + " = NOT PRESENT (" + (obj === null ? "null" : typeof obj === "undefined" ? "undefined" : String(obj)) + ")");
        }
      } catch (err) {
        console.log("[MidnightWebGL] CHECK: " + entry.path + " = ERROR: " + err.message);
      }
    }

    // ---- Deep enumerate window.midnight ----
    console.log("[MidnightWebGL] --- Deep enumerate window.midnight ---");
    if (window.midnight) {
      console.log("[MidnightWebGL] window.midnight EXISTS");
      console.log("[MidnightWebGL]   typeof:", typeof window.midnight);
      var keys = Object.keys(window.midnight);
      console.log("[MidnightWebGL]   keys:", keys);
      console.log("[MidnightWebGL]   prototype:", Object.getPrototypeOf(window.midnight));
      
      if (typeof window.midnight.enable === "function") {
        console.log("[MidnightWebGL]   HAS enable() - this IS a connector!");
      }
      if (window.midnight.name) {
        console.log("[MidnightWebGL]   name:", window.midnight.name);
      }
      if (window.midnight.apiVersion) {
        console.log("[MidnightWebGL]   apiVersion:", window.midnight.apiVersion);
      }
      
      // Also try getOwnPropertyNames for non-enumerable props
      try {
        var allProps = Object.getOwnPropertyNames(window.midnight);
        if (allProps.length !== keys.length) {
          console.log("[MidnightWebGL]   getOwnPropertyNames:", allProps);
        }
      } catch(e) {}
      
      for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        var val = window.midnight[key];
        var valType = typeof val;
        if (valType === "object" && val !== null) {
          var subKeys = Object.keys(val);
          console.log("[MidnightWebGL]   ." + key + " = [object] keys=[" + subKeys.join(", ") + "]");
          if (typeof val.enable === "function") {
            console.log("[MidnightWebGL]     ^ HAS enable() - wallet connector!");
          }
          if (typeof val.isEnabled === "function") {
            console.log("[MidnightWebGL]     ^ HAS isEnabled()");
          }
          if (val.name) console.log("[MidnightWebGL]     ^ name:", val.name);
          if (val.apiVersion) console.log("[MidnightWebGL]     ^ apiVersion:", val.apiVersion);
          // Recurse one more level for nested connectors
          for (var si = 0; si < subKeys.length; si++) {
            var subVal = val[subKeys[si]];
            if (subVal && typeof subVal === "object") {
              console.log("[MidnightWebGL]     ." + key + "." + subKeys[si] + " = [object] keys=[" + Object.keys(subVal).join(", ") + "]");
              if (typeof subVal.enable === "function") {
                console.log("[MidnightWebGL]       ^ HAS enable() - NESTED connector!");
              }
            }
          }
        } else if (valType === "function") {
          console.log("[MidnightWebGL]   ." + key + " = [function]");
        } else {
          console.log("[MidnightWebGL]   ." + key + " =", val);
        }
      }
    } else {
      console.log("[MidnightWebGL] window.midnight is NOT present");
    }

    // ---- Deep enumerate window.cardano ----
    console.log("[MidnightWebGL] --- Deep enumerate window.cardano ---");
    if (window.cardano) {
      console.log("[MidnightWebGL] window.cardano EXISTS");
      var cardanoKeys = Object.keys(window.cardano);
      console.log("[MidnightWebGL]   keys:", cardanoKeys);
      
      for (var j = 0; j < cardanoKeys.length; j++) {
        var ckey = cardanoKeys[j];
        var cval = window.cardano[ckey];
        if (cval && typeof cval === "object") {
          console.log("[MidnightWebGL]   ." + ckey + " = [object] keys=[" + Object.keys(cval).join(", ") + "]");
          if (typeof cval.enable === "function") {
            console.log("[MidnightWebGL]     ^ HAS enable() - wallet connector!");
          }
          if (typeof cval.isEnabled === "function") {
            console.log("[MidnightWebGL]     ^ HAS isEnabled()");
          }
          if (cval.name) console.log("[MidnightWebGL]     ^ name:", cval.name);
          if (cval.apiVersion) console.log("[MidnightWebGL]     ^ apiVersion:", cval.apiVersion);
        } else if (typeof cval === "function") {
          console.log("[MidnightWebGL]   ." + ckey + " = [function]");
        }
      }
    } else {
      console.log("[MidnightWebGL] window.cardano is NOT present");
    }

    // ---- Check other possible global injection points ----
    console.log("[MidnightWebGL] --- Other global checks ---");
    if (window.lace) console.log("[MidnightWebGL] window.lace EXISTS, typeof:", typeof window.lace, "keys:", Object.keys(window.lace));
    else console.log("[MidnightWebGL] window.lace: NOT present");
    if (window.mnLace) console.log("[MidnightWebGL] window.mnLace EXISTS, typeof:", typeof window.mnLace, "keys:", Object.keys(window.mnLace));
    else console.log("[MidnightWebGL] window.mnLace: NOT present");

    // ---- Check MidnightSDK bundle (midnight-bridge) ----
    console.log("[MidnightWebGL] --- MidnightSDK bundle check ---");
    if (window.MidnightSDK) {
      console.log("[MidnightWebGL] window.MidnightSDK EXISTS, keys:", Object.keys(window.MidnightSDK));
      console.log("[MidnightWebGL]   version:", window.MidnightSDK.version);
      console.log("[MidnightWebGL]   ready:", window.MidnightSDKReady);
      console.log("[MidnightWebGL]   connectorAvailable:", window.MidnightSDK.isConnectorAvailable());
      console.log("[MidnightWebGL]   connected:", window.MidnightSDK.isConnected());
      var sdkAddr = window.MidnightSDK.getAddress();
      if (sdkAddr) console.log("[MidnightWebGL]   address:", sdkAddr);
    } else {
      console.log("[MidnightWebGL] window.MidnightSDK: NOT present (midnight-bridge bundle not loaded)");
    }

    console.log("[MidnightWebGL] === END DEBUG ===");
  },

  // ============================================================
  // IsLaceAvailable
  // ============================================================
  IsLaceAvailable: function () {
    try {
      // Delegate to page-level detection function (runs on main thread
      // where Lace actually injects). This avoids the issue where
      // window.cardano is undefined in Unity's worker/threaded context.
      if (typeof window.MidnightBridge_IsAnyWalletAvailable === "function") {
        var result = window.MidnightBridge_IsAnyWalletAvailable();
        console.log("[MidnightWebGL] IsLaceAvailable (page-level):", result);
        return result ? 1 : 0;
      }

      // Fallback: direct check (may fail in threaded context)
      console.log("[MidnightWebGL] IsLaceAvailable fallback (no page-level function)");
      console.log("[MidnightWebGL] window.midnight:", typeof window.midnight !== "undefined" ? Object.keys(window.midnight) : "not present");
      console.log("[MidnightWebGL] window.cardano:", typeof window.cardano !== "undefined" ? Object.keys(window.cardano) : "not present");

      // Check window.midnight
      if (typeof window.midnight !== "undefined" && window.midnight) {
        if (typeof window.midnight.enable === "function") return 1;
        var knownNames = ["mnLace", "lace", "midnight", "Lace"];
        for (var i = 0; i < knownNames.length; i++) {
          var walletObj = window.midnight[knownNames[i]];
          if (walletObj && typeof walletObj.enable === "function") return 1;
        }
        var midnightKeys = Object.keys(window.midnight);
        for (var j = 0; j < midnightKeys.length; j++) {
          var obj = window.midnight[midnightKeys[j]];
          if (obj && typeof obj === "object" && typeof obj.enable === "function") return 1;
        }
      }

      // Check window.cardano
      if (typeof window.cardano !== "undefined" && window.cardano) {
        if (window.cardano.lace && typeof window.cardano.lace.enable === "function") return 1;
        if (window.cardano.midnight && typeof window.cardano.midnight.enable === "function") return 1;
        var cardanoKeys = Object.keys(window.cardano);
        for (var k = 0; k < cardanoKeys.length; k++) {
          var cobj = window.cardano[cardanoKeys[k]];
          if (cobj && typeof cobj === "object" && typeof cobj.enable === "function") return 1;
        }
      }

      // Check MidnightSDK
      if (typeof window.MidnightSDK !== "undefined" && window.MidnightSDK && typeof window.MidnightSDK.isConnectorAvailable === "function") {
        if (window.MidnightSDK.isConnectorAvailable()) return 1;
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
      // Delegate to page-level detection (main thread, where extensions inject)
      if (typeof window.MidnightBridge_IsMidnightConnectorAvailable === "function") {
        return window.MidnightBridge_IsMidnightConnectorAvailable() ? 1 : 0;
      }
      // Fallback with typeof guards for threaded context
      if (typeof window.midnight !== "undefined" && window.midnight) {
        if (typeof window.midnight.enable === "function") return 1;
        var keys = Object.keys(window.midnight);
        for (var i = 0; i < keys.length; i++) {
          var obj = window.midnight[keys[i]];
          if (obj && typeof obj === "object" && typeof obj.enable === "function") return 1;
        }
      }
      if (typeof window.cardano !== "undefined" && window.cardano && window.cardano.midnight && typeof window.cardano.midnight.enable === "function") return 1;
      if (typeof window.MidnightSDK !== "undefined" && window.MidnightSDK && typeof window.MidnightSDK.isConnectorAvailable === "function" && window.MidnightSDK.isConnectorAvailable()) return 1;
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

      // Prefer page-level detection (main thread)
      if (typeof window.MidnightBridge_IsAnyWalletAvailable === "function") {
        found = window.MidnightBridge_IsAnyWalletAvailable();
        if (found) {
          if (typeof window.MidnightBridge_IsLaceAvailable === "function" && window.MidnightBridge_IsLaceAvailable()) foundPath = "window.cardano.lace (page-level)";
          else if (typeof window.MidnightBridge_IsMidnightConnectorAvailable === "function" && window.MidnightBridge_IsMidnightConnectorAvailable()) foundPath = "window.midnight.* (page-level)";
          else foundPath = "wallet (page-level)";
        }
        // Also run debug detection for console output
        if (typeof window.MidnightBridge_DebugDetection === "function") window.MidnightBridge_DebugDetection();
      } else {
        // Fallback: direct checks with typeof guards
        if (typeof window.midnight !== "undefined" && window.midnight) {
          if (typeof window.midnight.enable === "function") { found = true; foundPath = "window.midnight"; }
          else {
            var knownNames = ["mnLace", "lace", "midnight", "Lace"];
            for (var i = 0; i < knownNames.length && !found; i++) {
              var walletObj = window.midnight[knownNames[i]];
              if (walletObj && (typeof walletObj.enable === "function" || walletObj.name || walletObj.apiVersion)) {
                found = true; foundPath = "window.midnight." + knownNames[i];
              }
            }
          }
        }
        if (!found && typeof window.cardano !== "undefined" && window.cardano) {
          if (window.cardano.lace && typeof window.cardano.lace.enable === "function") { found = true; foundPath = "window.cardano.lace"; }
          else if (window.cardano.midnight && typeof window.cardano.midnight.enable === "function") { found = true; foundPath = "window.cardano.midnight"; }
        }
        if (!found && typeof window.MidnightSDK !== "undefined" && window.MidnightSDK && typeof window.MidnightSDK.isConnectorAvailable === "function" && window.MidnightSDK.isConnectorAvailable()) {
          found = true; foundPath = "MidnightSDK";
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
  // Updated for @midnight-ntwrk/dapp-connector-api v4.0.x
  // Uses connect(networkId) instead of enable() for Midnight API
  // ============================================================
  ConnectLace: function (gameObjectNamePtr, successCallbackPtr, errorCallbackPtr) {
    var gameObjectName = UTF8ToString(gameObjectNamePtr);
    var successCallback = UTF8ToString(successCallbackPtr);
    var errorCallback = UTF8ToString(errorCallbackPtr);

    console.log("%c[MidnightWebGL] ═══════════════════════════════════════════", "color: #9966ff; font-weight: bold");
    console.log("%c[MidnightWebGL] ConnectLace() called", "color: #9966ff; font-weight: bold");
    console.log("[MidnightWebGL]   GameObject:", gameObjectName);
    console.log("[MidnightWebGL]   SuccessCallback:", successCallback);
    console.log("[MidnightWebGL]   ErrorCallback:", errorCallback);
    console.log("%c[MidnightWebGL] ═══════════════════════════════════════════", "color: #9966ff; font-weight: bold");

    (async function () {
      try {
        // ============================================================
        // PRIORITY 1: Use MidnightSDK if available (recommended)
        // This uses the properly bundled connector with v4.0.x API
        // ============================================================
        console.log("[MidnightWebGL] DIAG ConnectLace window:", typeof window, "window.MidnightSDK:", typeof (window && window.MidnightSDK), "window.__midnightSDK:", typeof (window && window.__midnightSDK));
        try { console.log("[MidnightWebGL] DIAG parent.MidnightSDK:", typeof parent.MidnightSDK); } catch(e) {}
        try { console.log("[MidnightWebGL] DIAG top.MidnightSDK:", typeof top.MidnightSDK); } catch(e) {}
        console.log("[MidnightWebGL] Step 1: Checking for MidnightSDK...");
        var midnightSDK = (typeof window !== "undefined" && window.MidnightSDK) ||
                          (typeof window !== "undefined" && window.__midnightSDK) ||
                          (typeof globalThis !== "undefined" && globalThis.MidnightSDK) ||
                          (typeof self !== "undefined" && self.MidnightSDK) || null;
        if (!midnightSDK) {
          try { if (typeof parent !== "undefined" && parent !== window && parent.MidnightSDK) midnightSDK = parent.MidnightSDK; } catch(e) {}
        }
        if (!midnightSDK) {
          try { if (typeof top !== "undefined" && top !== window && top.MidnightSDK) midnightSDK = top.MidnightSDK; } catch(e) {}
        }
        console.log("[MidnightWebGL]   MidnightSDK found:", !!midnightSDK);
        if (midnightSDK) {
          console.log("[MidnightWebGL]   MidnightSDK keys:", Object.keys(midnightSDK));
        }
        
        if (midnightSDK && typeof midnightSDK.connectMidnightPreview === "function") {
          // Auto-detect the wallet's network — try preview first, fall back to preprod
          console.log("%c[MidnightWebGL] ✓ Using MidnightSDK.connectMidnightPreview('auto')", "color: #66ff66");
          
          var result = await midnightSDK.connectMidnightPreview("auto");
          console.log("[MidnightWebGL] MidnightSDK.connectMidnightPreview result:", result);

          // Sync MidnightConfig.network with whatever the wallet returned
          if (result && result.success && result.network && window.MidnightConfig) {
            window.MidnightConfig.network = result.network;
            console.log("[MidnightWebGL] Detected wallet network:", result.network);
            var sel = document.getElementById("config-network");
            if (sel) sel.value = result.network;
          }
          
          if (!result.success) {
            throw new Error(result.errorMessage || result.error || "Connection failed");
          }
          
          // Extract info from the new response format
          var address = result.address || "";
          var networkName = result.network || "unknown";
          var networkId = networkName === "mainnet" ? 1 : 0;
          var walletInfo = result.walletInfo || {};
          
          // Get additional wallet state if available
          var walletState = walletInfo;
          try {
            if (typeof midnightSDK.getWalletState === "function") {
              var fullState = await midnightSDK.getWalletState();
              console.log("[MidnightWebGL] MidnightSDK.getWalletState():", fullState);
              walletState = Object.assign({}, walletInfo, fullState);
            }
          } catch (stateErr) {
            console.warn("[MidnightWebGL] Could not get full wallet state:", stateErr);
          }
          
          // Use shielded address if available
          if (!address && walletState.shieldedAddress) {
            address = walletState.shieldedAddress;
          }
          
          // Store for later use
          window.__walletApi = result.api;
          window.__walletState = walletState;
          window.__walletConnectorName = result.provider || "lace";
          window.__walletConnectorPath = "MidnightSDK";
          window.__walletApiMode = "midnight";
          window.__walletNetworkId = networkId;
          window.__walletNetworkName = networkName;
          // CRITICAL: preserve SDK reference for functions that can't see window.MidnightSDK
          window.__midnightSDK = midnightSDK;
          
          console.log("%c[MidnightWebGL] ✓ SUCCESS via MidnightSDK!", "color: #66ff66; font-weight: bold");
          console.log("[MidnightWebGL]   Address:", address);
          console.log("[MidnightWebGL]   Mode: midnight (DApp Connector API v4.0.x)");
          console.log("[MidnightWebGL]   Network:", networkName);
          console.log("[MidnightWebGL]   Provider:", result.provider, "v" + result.apiVersion);
          
          var response = JSON.stringify({ 
            address: address, 
            mode: "midnight", 
            networkId: networkId, 
            network: networkName,
            provider: result.provider,
            apiVersion: result.apiVersion
          });
          console.log("[MidnightWebGL]   Sending to Unity:", response);
          SendMessage(gameObjectName, successCallback, response);
          return;
        }
        
        // ============================================================
        // PRIORITY 2: Direct Midnight v4.0.x API (window.midnight[uuid])
        // Uses connect(networkId) method
        // ============================================================
        console.log("[MidnightWebGL] Step 2: Checking for window.midnight...");
        console.log("[MidnightWebGL]   window.midnight exists:", !!window.midnight);
        
        if (window.midnight) {
          var midnightKeys = Object.keys(window.midnight);
          console.log("[MidnightWebGL] Checking window.midnight keys:", midnightKeys);
          
          for (var i = 0; i < midnightKeys.length; i++) {
            var key = midnightKeys[i];
            var provider = window.midnight[key];
            
            if (provider && typeof provider === "object") {
              console.log("[MidnightWebGL] Checking provider:", key, "keys:", Object.keys(provider));
              
              // v4.0.x API: has connect() method and apiVersion starting with "4."
              if (typeof provider.connect === "function") {
                // Check API version
                var apiVersion = provider.apiVersion || "";
                var isV4 = apiVersion.startsWith("4.");
                
                console.log("%c[MidnightWebGL] Found Midnight provider!", "color: #66ff66; font-weight: bold");
                console.log("[MidnightWebGL]   Path: window.midnight." + key);
                console.log("[MidnightWebGL]   Name:", provider.name);
                console.log("[MidnightWebGL]   API Version:", apiVersion, isV4 ? "(v4.x ✓)" : "(not v4.x)");
                console.log("[MidnightWebGL]   RDNS:", provider.rdns);
                
                if (!isV4) {
                  console.warn("[MidnightWebGL] Skipping non-v4.x provider");
                  continue;
                }
                
                // Try networks in order: preprod, mainnet, preview
                var networksToTry = ["preprod", "mainnet", "preview"];
                var connectedApi = null;
                var connectedNetwork = null;
                
                for (var n = 0; n < networksToTry.length; n++) {
                  var networkToTry = networksToTry[n];
                  console.log("[MidnightWebGL] Trying connect('" + networkToTry + "')...");
                  
                  try {
                    connectedApi = await provider.connect(networkToTry);
                    if (connectedApi) {
                      connectedNetwork = networkToTry;
                      console.log("[MidnightWebGL] ✓ Connected to " + networkToTry);
                      break;
                    }
                  } catch (netErr) {
                    var netMsg = (netErr && netErr.message) ? netErr.message.toLowerCase() : "";
                    if (netMsg.includes("rejected") || netMsg.includes("denied")) {
                      throw netErr; // User rejected, don't try other networks
                    }
                    console.log("[MidnightWebGL] ✗ " + networkToTry + " failed: " + netErr.message);
                    // Continue to next network
                  }
                }
                
                var api = connectedApi;
                
                if (!api) {
                  throw new Error("User rejected the wallet connection request.");
                }
                
                console.log("%c[MidnightWebGL] connect() SUCCESS!", "color: #66ff66");
                console.log("[MidnightWebGL]   API methods:", Object.keys(api));
                
                // v4.0.x API: use granular methods per official docs
                var address = "";
                var unshieldedAddress = "";
                var walletState = {};
                
                // Get shielded addresses (v4.0.0 returns object, not array)
                // { shieldedAddress, shieldedCoinPublicKey, shieldedEncryptionPublicKey }
                if (typeof api.getShieldedAddresses === "function") {
                  try {
                    var shieldedResult = await api.getShieldedAddresses();
                    console.log("[MidnightWebGL] getShieldedAddresses():", shieldedResult);
                    
                    // v4.0.0 returns object with shieldedAddress property
                    if (shieldedResult) {
                      if (shieldedResult.shieldedAddress) {
                        address = shieldedResult.shieldedAddress;
                        walletState.shieldedAddress = shieldedResult.shieldedAddress;
                        walletState.shieldedCoinPublicKey = shieldedResult.shieldedCoinPublicKey || "";
                        walletState.shieldedEncryptionPublicKey = shieldedResult.shieldedEncryptionPublicKey || "";
                      } else if (Array.isArray(shieldedResult) && shieldedResult.length > 0) {
                        // Fallback for array format
                        address = shieldedResult[0].shieldedAddress || shieldedResult[0].address || shieldedResult[0];
                        walletState.shieldedAddress = address;
                      }
                    }
                  } catch (e) {
                    console.warn("[MidnightWebGL] getShieldedAddresses failed:", e.message);
                  }
                }
                
                // Get unshielded address (v4.0.0)
                // { unshieldedAddress }
                if (typeof api.getUnshieldedAddress === "function") {
                  try {
                    var unshieldedResult = await api.getUnshieldedAddress();
                    console.log("[MidnightWebGL] getUnshieldedAddress():", unshieldedResult);
                    if (unshieldedResult && unshieldedResult.unshieldedAddress) {
                      unshieldedAddress = unshieldedResult.unshieldedAddress;
                      walletState.unshieldedAddress = unshieldedAddress;
                    }
                  } catch (e) {
                    console.warn("[MidnightWebGL] getUnshieldedAddress failed:", e.message);
                  }
                }
                
                // Fallback to state() if available (legacy API)
                if (!address && typeof api.state === "function") {
                  try {
                    var state = await api.state();
                    console.log("[MidnightWebGL] state() (legacy):", state);
                    address = state.address || state.shieldedAddress || "";
                    walletState = state;
                  } catch (e) {
                    console.warn("[MidnightWebGL] state() failed:", e);
                  }
                }
                
                if (!address) {
                  throw new Error("Connected but could not retrieve address from wallet.");
                }
                
                // Use the network we connected to
                var networkName = connectedNetwork || "preprod";
                var networkId = (networkName === "mainnet") ? 1 : 0;
                
                // Try to get network from configuration to confirm
                if (typeof api.getConfiguration === "function") {
                  try {
                    var config = await api.getConfiguration();
                    console.log("[MidnightWebGL] getConfiguration():", config);
                    if (config && config.networkId) {
                      networkName = config.networkId;
                      networkId = (networkName === "mainnet") ? 1 : 0;
                    }
                  } catch (e) {
                    console.warn("[MidnightWebGL] getConfiguration failed:", e);
                  }
                }
                
                // Store for later use
                window.__walletApi = api;
                window.__walletState = walletState;
                window.__walletConnectorName = provider.name || key;
                window.__walletConnectorPath = "window.midnight." + key;
                window.__walletApiMode = "midnight";
                window.__walletNetworkId = networkId;
                window.__walletNetworkName = networkName;
                
                console.log("[MidnightWebGL] Connected via Midnight v4.0.x API! Address:", address);
                
                var response = JSON.stringify({ 
                  address: address, 
                  mode: "midnight", 
                  networkId: networkId, 
                  network: networkName 
                });
                SendMessage(gameObjectName, successCallback, response);
                return;
              }
              
              // Legacy: has enable() method
              if (typeof provider.enable === "function") {
                console.log("[MidnightWebGL] Found legacy Midnight provider at window.midnight." + key);
                console.log("[MidnightWebGL] Calling enable()...");
                
                var api = await provider.enable();
                
                if (!api) {
                  throw new Error("Failed to enable wallet connector.");
                }
                
                console.log("[MidnightWebGL] enable() returned api. Keys:", Object.keys(api));
                
                var address = "";
                var walletState = {};
                
                if (typeof api.state === "function") {
                  walletState = await api.state();
                  console.log("[MidnightWebGL] state():", walletState);
                  address = walletState.address || walletState.shieldedAddress || "";
                }
                
                if (!address) {
                  throw new Error("Connected but could not retrieve address from wallet.");
                }
                
                window.__walletApi = api;
                window.__walletState = walletState;
                window.__walletConnectorName = provider.name || key;
                window.__walletConnectorPath = "window.midnight." + key;
                window.__walletApiMode = "midnight";
                window.__walletNetworkId = 0;
                window.__walletNetworkName = "preprod";
                
                console.log("[MidnightWebGL] Connected via legacy Midnight API! Address:", address);
                
                var response = JSON.stringify({ 
                  address: address, 
                  mode: "midnight", 
                  networkId: 0, 
                  network: "preprod" 
                });
                SendMessage(gameObjectName, successCallback, response);
                return;
              }
            }
          }
        }
        
        // ============================================================
        // NOTE: CIP-30 (Cardano) API is NOT used
        // We only use Midnight DApp Connector API v4.0.x
        // ============================================================
        
        // No Midnight wallet found
        console.log("%c[MidnightWebGL] ✗ No Midnight wallet connector found!", "color: #ff6666; font-weight: bold");
        console.log("[MidnightWebGL] ═══════════════════════════════════════════");
        console.log("[MidnightWebGL] Troubleshooting:");
        console.log("[MidnightWebGL]   1. Is Lace wallet extension installed?");
        console.log("[MidnightWebGL]   2. Is Midnight mode enabled in Lace settings?");
        console.log("[MidnightWebGL]   3. Is the wallet unlocked?");
        console.log("[MidnightWebGL]   4. Try refreshing the page");
        console.log("[MidnightWebGL] ═══════════════════════════════════════════");
        console.log("[MidnightWebGL] Note: This SDK uses Midnight DApp Connector API v4.0.x");
        console.log("[MidnightWebGL] CIP-30 (Cardano) mode is NOT supported");
        throw new Error("No Midnight wallet found. Enable Midnight mode in Lace settings.");
        
      } catch (err) {
        var msg = (err && err.message) ? err.message : String(err);

        var lower = msg.toLowerCase();
        if (lower.includes("rejected") || lower.includes("declined") || lower.includes("deny") || lower.includes("cancel") || lower.includes("permissionrejected")) {
          msg = "User rejected the wallet connection request.";
        }

        console.log("%c[MidnightWebGL] ═══════════════════════════════════════════", "color: #ff6666; font-weight: bold");
        console.error("[MidnightWebGL] ✗ ConnectLace FAILED:", msg);
        console.log("%c[MidnightWebGL] ═══════════════════════════════════════════", "color: #ff6666; font-weight: bold");
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
  // Updated for @midnight-ntwrk/dapp-connector-api v4.0.x
  // Uses granular methods: getShieldedAddresses, getShieldedBalances, etc.
  // Response JSON v4.0.x: { shieldedAddress, shieldedCoinPublicKey, unshieldedAddress, shieldedBalances, unshieldedBalances, dustBalance }
  // Response JSON legacy: { address, balances: { "native": "amount", "tokenId": "amount", ... } }
  // ============================================================
  MidnightGetWalletState: function (gameObjectNamePtr, successCallbackPtr, errorCallbackPtr) {
    var gameObjectName = UTF8ToString(gameObjectNamePtr);
    var successCallback = UTF8ToString(successCallbackPtr);
    var errorCallback = UTF8ToString(errorCallbackPtr);

    console.log("[MidnightWebGL] MidnightGetWalletState() called");
    console.log("[MidnightWebGL] Target GameObject:", gameObjectName, "Callbacks:", successCallback, errorCallback);

    (async function () {
      try {
        // ============================================================
        // PRIORITY 1: Use MidnightSDK if available
        // ============================================================
        if (window.MidnightSDK && typeof window.MidnightSDK.getWalletState === "function") {
          console.log("[MidnightWebGL] Using MidnightSDK.getWalletState()...");
          var walletState = await window.MidnightSDK.getWalletState();
          console.log("[MidnightWebGL] MidnightSDK wallet state:", walletState);
          
          // Handle BigInt serialization - convert BigInt to string
          var payload = JSON.stringify(walletState, function(key, value) {
            return typeof value === "bigint" ? value.toString() : value;
          });
          console.log("[MidnightWebGL] MidnightGetWalletState response:", payload);
          SendMessage(gameObjectName, successCallback, payload);
          return;
        }
        
        // ============================================================
        // PRIORITY 2: Direct wallet API
        // ============================================================
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
        
        var response = {};
        var api = window.__walletApi;
        
        // ============================================================
        // v4.0.x API: Use granular methods
        // ============================================================
        
        // Get shielded addresses (v4.0.0 returns object, not array)
        // { shieldedAddress, shieldedCoinPublicKey, shieldedEncryptionPublicKey }
        if (typeof api.getShieldedAddresses === "function") {
          try {
            var shieldedResult = await api.getShieldedAddresses();
            console.log("[MidnightWebGL] getShieldedAddresses():", shieldedResult);
            if (shieldedResult) {
              if (shieldedResult.shieldedAddress) {
                // v4.0.0 object format
                response.shieldedAddress = shieldedResult.shieldedAddress;
                response.shieldedCoinPublicKey = shieldedResult.shieldedCoinPublicKey || "";
                response.shieldedEncryptionPublicKey = shieldedResult.shieldedEncryptionPublicKey || "";
              } else if (Array.isArray(shieldedResult) && shieldedResult.length > 0) {
                // Fallback for array format
                response.shieldedAddress = shieldedResult[0].shieldedAddress || shieldedResult[0].address || shieldedResult[0];
                response.shieldedCoinPublicKey = shieldedResult[0].coinPublicKey || "";
              }
            }
          } catch (e) {
            console.warn("[MidnightWebGL] getShieldedAddresses failed:", e);
          }
        }
        
        // Get unshielded address (v4.0.0 returns { unshieldedAddress })
        if (typeof api.getUnshieldedAddress === "function") {
          try {
            var unshieldedResult = await api.getUnshieldedAddress();
            console.log("[MidnightWebGL] getUnshieldedAddress():", unshieldedResult);
            if (unshieldedResult && unshieldedResult.unshieldedAddress) {
              response.unshieldedAddress = unshieldedResult.unshieldedAddress;
            } else {
              response.unshieldedAddress = unshieldedResult || "";
            }
          } catch (e) {
            console.warn("[MidnightWebGL] getUnshieldedAddress failed:", e);
          }
        }
        
        // Get shielded balances (v4.0.0 returns Record<TokenType, bigint>)
        if (typeof api.getShieldedBalances === "function") {
          try {
            var shieldedBal = await api.getShieldedBalances();
            console.log("[MidnightWebGL] getShieldedBalances():", shieldedBal);
            // Convert bigint values to strings for JSON serialization
            response.shieldedBalances = {};
            if (shieldedBal) {
              for (var tokenType in shieldedBal) {
                if (shieldedBal.hasOwnProperty(tokenType)) {
                  response.shieldedBalances[tokenType] = String(shieldedBal[tokenType]);
                }
              }
            }
            // Also set a combined balance for easy access
            if (response.shieldedBalances["tDUST"]) {
              response.shieldedBalance = response.shieldedBalances["tDUST"];
            }
          } catch (e) {
            console.warn("[MidnightWebGL] getShieldedBalances failed:", e.message);
          }
        }
        
        // Get unshielded balances (v4.0.0 returns Record<TokenType, bigint>)
        if (typeof api.getUnshieldedBalances === "function") {
          try {
            var unshieldedBal = await api.getUnshieldedBalances();
            console.log("[MidnightWebGL] getUnshieldedBalances():", unshieldedBal);
            // Convert bigint values to strings for JSON serialization
            response.unshieldedBalances = {};
            if (unshieldedBal) {
              for (var tokenType in unshieldedBal) {
                if (unshieldedBal.hasOwnProperty(tokenType)) {
                  response.unshieldedBalances[tokenType] = String(unshieldedBal[tokenType]);
                }
              }
            }
            // Also set a combined balance for easy access
            if (response.unshieldedBalances["tDUST"]) {
              response.unshieldedBalance = response.unshieldedBalances["tDUST"];
            }
          } catch (e) {
            console.warn("[MidnightWebGL] getUnshieldedBalances failed:", e.message);
          }
        }
        
        // Get dust balance (v4.0.0 returns bigint)
        if (typeof api.getDustBalance === "function") {
          try {
            var dustBal = await api.getDustBalance();
            console.log("[MidnightWebGL] getDustBalance():", dustBal);
            response.dustBalance = String(dustBal || "0");
          } catch (e) {
            console.warn("[MidnightWebGL] getDustBalance failed:", e.message);
          }
        }
        
        // Calculate total native balance for display
        var totalNative = BigInt(0);
        try {
          if (response.shieldedBalance) totalNative += BigInt(response.shieldedBalance);
          if (response.unshieldedBalance) totalNative += BigInt(response.unshieldedBalance);
          if (response.dustBalance) totalNative += BigInt(response.dustBalance);
          response.nativeBalance = String(totalNative);
          response.balance = String(totalNative); // Alias for compatibility
        } catch (e) {
          console.warn("[MidnightWebGL] Could not calculate total balance:", e.message);
        }
        
        // ============================================================
        // Legacy fallback: Use state() method
        // ============================================================
        if (!response.shieldedAddress && typeof api.state === "function") {
          console.log("[MidnightWebGL] Using legacy state() method...");
          var walletState = await api.state();
          console.log("[MidnightWebGL] Wallet state received:", walletState);
          
          response.address = walletState.address || walletState.shieldedAddress || "";
          response.balances = {};
          
          if (walletState.balances) {
            if (walletState.balances instanceof Map) {
              walletState.balances.forEach(function(value, key) {
                response.balances[String(key)] = String(value);
              });
            } else if (typeof walletState.balances === "object") {
              for (var tokenId in walletState.balances) {
                if (walletState.balances.hasOwnProperty(tokenId)) {
                  response.balances[tokenId] = String(walletState.balances[tokenId]);
                }
              }
            }
          }
          
          if (walletState.balance !== undefined) {
            response.balances["native"] = String(walletState.balance);
          }
          if (walletState.tDUST !== undefined) {
            response.balances["tDUST"] = String(walletState.tDUST);
          }
        }

        // Handle BigInt serialization
        var payload = JSON.stringify(response, function(key, value) {
          return typeof value === "bigint" ? value.toString() : value;
        });
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

        // Handle BigInt serialization
        var payload = JSON.stringify(response, function(key, value) {
          return typeof value === "bigint" ? value.toString() : value;
        });
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
  // JS_CopyToClipboard
  // ============================================================
  JS_CopyToClipboard: function (textPtr) {
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
  },

  // ============================================================
  // DebugMidnightConnection
  // ============================================================
  // NEW: Midnight-specific connection debug.
  // Attempts to find, enable, and inspect the Midnight DApp connector
  // step-by-step, logging everything. Does NOT touch Cardano paths.
  // Call from Unity or browser console to diagnose Midnight connectivity.
  // ============================================================
  DebugMidnightConnection: function () {
    console.log("[MidnightDebug] ============================================");
    console.log("[MidnightDebug] === MIDNIGHT CONNECTION DEBUG ===");
    console.log("[MidnightDebug] Time:", new Date().toISOString());
    console.log("[MidnightDebug] URL:", window.location.href);
    console.log("[MidnightDebug] Protocol:", window.location.protocol);
    console.log("[MidnightDebug] ============================================");

    // ---- Step 1: Check if window.midnight exists ----
    console.log("[MidnightDebug] ");
    console.log("[MidnightDebug] [STEP 1] Checking window.midnight...");
    if (!window.midnight) {
      console.log("[MidnightDebug] ❌ window.midnight does NOT exist");
      console.log("[MidnightDebug]    Possible causes:");
      console.log("[MidnightDebug]    1. Lace Midnight Preview extension not installed");
      console.log("[MidnightDebug]    2. Extension disabled or not enabled for this site");
      console.log("[MidnightDebug]    3. Page loaded before extension injected (try waiting/refreshing)");
      console.log("[MidnightDebug]    4. Running on file:// URL (must use http:// or https://)");
      console.log("[MidnightDebug]    5. Extension only injects on specific origins");

      // Check if we're on file://
      if (window.location.protocol === "file:") {
        console.log("[MidnightDebug]    ⚠️  You ARE on file:// - extensions cannot inject here!");
      }

      // Check if MidnightSDK bundle is loaded as alternative
      if (window.MidnightSDK) {
        console.log("[MidnightDebug]    ℹ️  window.MidnightSDK bundle IS loaded (midnight-bridge)");
        console.log("[MidnightDebug]    ℹ️  Bundle connectorAvailable:", window.MidnightSDK.isConnectorAvailable());
      }

      console.log("[MidnightDebug] === END (no window.midnight) ===");
      return;
    }

    console.log("[MidnightDebug] ✅ window.midnight EXISTS");
    console.log("[MidnightDebug]    typeof:", typeof window.midnight);

    // ---- Step 2: Enumerate all keys on window.midnight ----
    console.log("[MidnightDebug] ");
    console.log("[MidnightDebug] [STEP 2] Enumerating window.midnight keys...");
    var keys = [];
    try {
      keys = Object.keys(window.midnight);
      console.log("[MidnightDebug]    Object.keys:", JSON.stringify(keys));
    } catch (e) {
      console.log("[MidnightDebug]    ❌ Object.keys failed:", e.message);
    }
    try {
      var allProps = Object.getOwnPropertyNames(window.midnight);
      if (allProps.length !== keys.length) {
        console.log("[MidnightDebug]    getOwnPropertyNames:", JSON.stringify(allProps));
        console.log("[MidnightDebug]    ⚠️  Non-enumerable properties detected!");
      }
    } catch (e) {}

    // Check if window.midnight itself is a connector
    if (typeof window.midnight.enable === "function") {
      console.log("[MidnightDebug]    ⚡ window.midnight itself has enable() - it IS a connector!");
    }

    // ---- Step 3: Find all connectors under window.midnight ----
    console.log("[MidnightDebug] ");
    console.log("[MidnightDebug] [STEP 3] Scanning for connectors (objects with enable())...");
    var connectors = [];

    // Check window.midnight itself
    if (typeof window.midnight.enable === "function") {
      connectors.push({ path: "window.midnight", obj: window.midnight });
    }

    // Check each key
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      try {
        var val = window.midnight[key];
        var vtype = typeof val;
        if (val && vtype === "object") {
          var subKeys = Object.keys(val);
          console.log("[MidnightDebug]    ." + key + " = [object] keys=[" + subKeys.join(", ") + "]");
          if (typeof val.enable === "function") {
            console.log("[MidnightDebug]      ⚡ HAS enable() - THIS IS A CONNECTOR");
            connectors.push({ path: "window.midnight." + key, obj: val });
          }
          if (typeof val.isEnabled === "function") console.log("[MidnightDebug]      ✓ has isEnabled()");
          if (typeof val.serviceUriConfig === "function") console.log("[MidnightDebug]      ✓ has serviceUriConfig()");
          if (val.name) console.log("[MidnightDebug]      name:", val.name);
          if (val.apiVersion) console.log("[MidnightDebug]      apiVersion:", val.apiVersion);

          // Check one level deeper
          for (var si = 0; si < subKeys.length; si++) {
            try {
              var subVal = val[subKeys[si]];
              if (subVal && typeof subVal === "object" && typeof subVal.enable === "function") {
                console.log("[MidnightDebug]      ." + key + "." + subKeys[si] + " ⚡ NESTED CONNECTOR with enable()");
                connectors.push({ path: "window.midnight." + key + "." + subKeys[si], obj: subVal });
              }
            } catch (e) {}
          }
        } else if (vtype === "function") {
          console.log("[MidnightDebug]    ." + key + " = [function]");
        } else {
          console.log("[MidnightDebug]    ." + key + " = " + String(val) + " (" + vtype + ")");
        }
      } catch (e) {
        console.log("[MidnightDebug]    ." + key + " = ERROR reading: " + e.message);
      }
    }

    if (connectors.length === 0) {
      console.log("[MidnightDebug]    ❌ NO connectors found (no objects with enable())");
      console.log("[MidnightDebug]    window.midnight exists but has no usable wallet connector.");
      console.log("[MidnightDebug]    The extension may still be initializing - try again in a few seconds.");
      console.log("[MidnightDebug] === END (no connectors) ===");
      return;
    }

    console.log("[MidnightDebug]    Found " + connectors.length + " connector(s):");
    for (var c = 0; c < connectors.length; c++) {
      console.log("[MidnightDebug]      [" + c + "] " + connectors[c].path);
    }

    // ---- Step 4: Inspect the primary connector ----
    var primary = connectors[0];
    console.log("[MidnightDebug] ");
    console.log("[MidnightDebug] [STEP 4] Inspecting primary connector: " + primary.path);
    var conn = primary.obj;

    var methods = ["enable", "isEnabled", "state", "serviceUriConfig", "balanceAndProveTransaction", "submitTransaction", "name", "apiVersion", "icon"];
    for (var m = 0; m < methods.length; m++) {
      var mname = methods[m];
      try {
        var mval = conn[mname];
        if (typeof mval === "function") {
          console.log("[MidnightDebug]    ✓ " + mname + "() = [function]");
        } else if (mval !== undefined) {
          console.log("[MidnightDebug]    ✓ " + mname + " = " + String(mval));
        } else {
          console.log("[MidnightDebug]    ✗ " + mname + " = undefined");
        }
      } catch (e) {
        console.log("[MidnightDebug]    ✗ " + mname + " = ERROR: " + e.message);
      }
    }

    // ---- Step 5: Try isEnabled() ----
    console.log("[MidnightDebug] ");
    console.log("[MidnightDebug] [STEP 5] Calling isEnabled() on " + primary.path + "...");

    (async function () {
      try {
        if (typeof conn.isEnabled === "function") {
          var enabled = await conn.isEnabled();
          console.log("[MidnightDebug]    isEnabled() returned:", enabled);
          if (enabled) {
            console.log("[MidnightDebug]    ✅ Already authorized for this site!");
          } else {
            console.log("[MidnightDebug]    ℹ️  Not yet authorized - enable() will prompt user");
          }
        } else {
          console.log("[MidnightDebug]    ⚠️  No isEnabled() method available");
        }

        // ---- Step 6: Try enable() ----
        console.log("[MidnightDebug] ");
        console.log("[MidnightDebug] [STEP 6] Calling enable() on " + primary.path + "...");
        console.log("[MidnightDebug]    (This may trigger a wallet popup for user approval)");

        var api = await conn.enable();

        if (!api) {
          console.log("[MidnightDebug]    ❌ enable() returned null/undefined");
          console.log("[MidnightDebug]    The wallet may have rejected silently.");
          console.log("[MidnightDebug] === END (enable failed) ===");
          return;
        }

        console.log("[MidnightDebug]    ✅ enable() succeeded!");
        console.log("[MidnightDebug]    API typeof:", typeof api);
        var apiKeys = Object.keys(api);
        console.log("[MidnightDebug]    API keys:", JSON.stringify(apiKeys));

        // ---- Step 7: Inspect API methods ----
        console.log("[MidnightDebug] ");
        console.log("[MidnightDebug] [STEP 7] Inspecting returned API object...");
        var apiMethods = ["state", "balanceAndProveTransaction", "submitTransaction", "serviceUriConfig",
                          "getUsedAddresses", "getChangeAddress", "getBalance", "getUtxos", "signTx", "submitTx", "signData", "getNetworkId"];
        for (var am = 0; am < apiMethods.length; am++) {
          var amName = apiMethods[am];
          try {
            if (typeof api[amName] === "function") {
              console.log("[MidnightDebug]    ✓ api." + amName + "() = [function]");
            } else if (api[amName] !== undefined) {
              console.log("[MidnightDebug]    ~ api." + amName + " = " + String(api[amName]));
            }
          } catch (e) {}
        }

        // Determine API type
        var isMidnightAPI = typeof api.state === "function";
        var isCardanoAPI = typeof api.getUsedAddresses === "function";
        console.log("[MidnightDebug]    Is Midnight API (has state()):", isMidnightAPI);
        console.log("[MidnightDebug]    Is Cardano CIP-30 API (has getUsedAddresses()):", isCardanoAPI);

        // ---- Step 8: Try state() for Midnight API ----
        if (isMidnightAPI) {
          console.log("[MidnightDebug] ");
          console.log("[MidnightDebug] [STEP 8] Calling api.state() (Midnight API)...");
          try {
            var walletState = await api.state();
            console.log("[MidnightDebug]    ✅ state() returned!");
            console.log("[MidnightDebug]    typeof:", typeof walletState);
            if (walletState) {
              var stateKeys = Object.keys(walletState);
              console.log("[MidnightDebug]    keys:", JSON.stringify(stateKeys));
              for (var sk = 0; sk < stateKeys.length; sk++) {
                var skey = stateKeys[sk];
                var sval = walletState[skey];
                var stype = typeof sval;
                if (stype === "object" && sval !== null) {
                  console.log("[MidnightDebug]    ." + skey + " = [" + stype + "] keys=[" + Object.keys(sval).join(", ") + "]");
                } else if (stype === "string" && sval.length > 80) {
                  console.log("[MidnightDebug]    ." + skey + " = \"" + sval.substring(0, 40) + "..." + sval.substring(sval.length - 20) + "\" (len=" + sval.length + ")");
                } else {
                  console.log("[MidnightDebug]    ." + skey + " = " + String(sval) + " (" + stype + ")");
                }
              }

              // Highlight key fields
              if (walletState.address) console.log("[MidnightDebug]    📍 ADDRESS: " + walletState.address);
              if (walletState.coinPublicKey) console.log("[MidnightDebug]    🔑 COIN PUBLIC KEY: " + walletState.coinPublicKey);
              if (walletState.encryptionPublicKey) console.log("[MidnightDebug]    🔐 ENCRYPTION PUBLIC KEY: " + walletState.encryptionPublicKey);
            } else {
              console.log("[MidnightDebug]    ⚠️  state() returned null/undefined");
            }
          } catch (stateErr) {
            console.log("[MidnightDebug]    ❌ state() threw error:", stateErr.message || stateErr);
          }
        }

        // ---- Step 9: Try serviceUriConfig() ----
        console.log("[MidnightDebug] ");
        console.log("[MidnightDebug] [STEP 9] Checking serviceUriConfig()...");
        var svcSource = null;
        if (typeof conn.serviceUriConfig === "function") {
          svcSource = conn;
          console.log("[MidnightDebug]    Using connector.serviceUriConfig()");
        } else if (typeof api.serviceUriConfig === "function") {
          svcSource = api;
          console.log("[MidnightDebug]    Using api.serviceUriConfig()");
        }

        if (svcSource) {
          try {
            var svcConfig = await svcSource.serviceUriConfig();
            console.log("[MidnightDebug]    ✅ serviceUriConfig() returned!");
            if (svcConfig) {
              var cfgKeys = Object.keys(svcConfig);
              console.log("[MidnightDebug]    keys:", JSON.stringify(cfgKeys));
              for (var ck = 0; ck < cfgKeys.length; ck++) {
                console.log("[MidnightDebug]    ." + cfgKeys[ck] + " = " + String(svcConfig[cfgKeys[ck]]));
              }
              // Highlight important URIs
              if (svcConfig.indexerUri) console.log("[MidnightDebug]    🌐 INDEXER: " + svcConfig.indexerUri);
              if (svcConfig.indexerWsUri) console.log("[MidnightDebug]    🌐 INDEXER WS: " + svcConfig.indexerWsUri);
              if (svcConfig.proverServerUri) console.log("[MidnightDebug]    🌐 PROVER: " + svcConfig.proverServerUri);
              if (svcConfig.nodeUri) console.log("[MidnightDebug]    🌐 NODE: " + svcConfig.nodeUri);
            } else {
              console.log("[MidnightDebug]    ⚠️  serviceUriConfig() returned null");
            }
          } catch (svcErr) {
            console.log("[MidnightDebug]    ❌ serviceUriConfig() error:", svcErr.message || svcErr);
          }
        } else {
          console.log("[MidnightDebug]    ⚠️  No serviceUriConfig() on connector or API");
        }

        // ---- Step 10: Summary ----
        console.log("[MidnightDebug] ");
        console.log("[MidnightDebug] ============================================");
        console.log("[MidnightDebug] === SUMMARY ===");
        console.log("[MidnightDebug]    Connector: " + primary.path);
        console.log("[MidnightDebug]    API type: " + (isMidnightAPI ? "MIDNIGHT" : isCardanoAPI ? "CARDANO CIP-30" : "UNKNOWN"));
        console.log("[MidnightDebug]    enable(): ✅ SUCCESS");
        if (isMidnightAPI) {
          console.log("[MidnightDebug]    state(): available");
          console.log("[MidnightDebug]    → Ready for Midnight transactions");
        }
        if (isCardanoAPI) {
          console.log("[MidnightDebug]    → This connector exposes Cardano CIP-30, not Midnight API");
        }
        console.log("[MidnightDebug] ============================================");
        console.log("[MidnightDebug] === END DEBUG ===");

      } catch (err) {
        var errMsg = (err && err.message) ? err.message : String(err);
        var lower = errMsg.toLowerCase();

        console.log("[MidnightDebug]    ❌ Error during debug flow:", errMsg);

        if (lower.includes("rejected") || lower.includes("declined") || lower.includes("deny") || lower.includes("cancel")) {
          console.log("[MidnightDebug]    → User REJECTED the connection in the wallet popup");
        } else if (lower.includes("timeout")) {
          console.log("[MidnightDebug]    → Connection TIMED OUT - wallet may not be responding");
        } else {
          console.log("[MidnightDebug]    → Unexpected error. Full error object:");
          console.log("[MidnightDebug]    ", err);
        }

        console.log("[MidnightDebug] === END DEBUG (with error) ===");
      }
    })();
  },

  // ============================================================
  // MIDNIGHT PREPROD INTEGRATION
  // ============================================================
  // These functions use window.midnight.mnLace with connect('preprod')
  // and the new Midnight DApp Connector API.
  // COMPLETELY SEPARATE from Cardano CIP-30 integration.
  // ============================================================

  // ============================================================
  // MidnightPreprod_IsAvailable
  // ============================================================
  MidnightPreprod_IsAvailable: function () {
    try {
      // Check for page-level detection function first
      if (typeof window.MidnightBridge_IsMidnightPreprodAvailable === "function") {
        return window.MidnightBridge_IsMidnightPreprodAvailable() ? 1 : 0;
      }
      // Check for MidnightBridge module
      if (typeof window.MidnightBridge !== "undefined" && 
          typeof window.MidnightBridge.isMidnightConnectorAvailable === "function") {
        return window.MidnightBridge.isMidnightConnectorAvailable() ? 1 : 0;
      }
      // Direct check
      if (typeof window.midnight !== "undefined" && window.midnight && window.midnight.mnLace) {
        var mnLace = window.midnight.mnLace;
        if (typeof mnLace.connect === "function" || typeof mnLace.enable === "function") {
          return 1;
        }
      }
      return 0;
    } catch (e) {
      console.warn("[MidnightWebGL] MidnightPreprod_IsAvailable error:", e);
      return 0;
    }
  },

  // ============================================================
  // MidnightPreprod_Connect
  // ============================================================
  MidnightPreprod_Connect: function (gameObjectNamePtr, successCallbackPtr, errorCallbackPtr, networkPtr) {
    var gameObjectName = UTF8ToString(gameObjectNamePtr);
    var successCallback = UTF8ToString(successCallbackPtr);
    var errorCallback = UTF8ToString(errorCallbackPtr);
    var network = UTF8ToString(networkPtr) || "preprod";

    console.log("[MidnightWebGL] MidnightPreprod_Connect() called");
    console.log("[MidnightWebGL]   network:", network);

    (async function () {
      try {
        // Use MidnightBridge if available
        if (typeof window.MidnightBridge !== "undefined" && 
            typeof window.MidnightBridge.connect === "function") {
          console.log("[MidnightWebGL] Using MidnightBridge.connect()");
          var result = await window.MidnightBridge.connect(network);
          var payload = JSON.stringify(result);
          SendMessage(gameObjectName, successCallback, payload);
          return;
        }

        // Direct implementation
        console.log("[MidnightWebGL] Using direct mnLace connection");

        if (!window.midnight) {
          throw new Error("window.midnight not found. Is Lace Midnight Preview installed?");
        }

        if (!window.midnight.mnLace) {
          throw new Error("window.midnight.mnLace not found. Enable Midnight mode in Lace.");
        }

        var mnLace = window.midnight.mnLace;
        console.log("[MidnightWebGL] mnLace found, keys:", Object.keys(mnLace));

        var api;
        if (typeof mnLace.connect === "function") {
          console.log("[MidnightWebGL] Calling mnLace.connect('" + network + "')...");
          api = await mnLace.connect(network);
        } else if (typeof mnLace.enable === "function") {
          console.log("[MidnightWebGL] Fallback: calling mnLace.enable()...");
          api = await mnLace.enable();
        } else {
          throw new Error("mnLace has no connect() or enable() method");
        }

        if (!api) {
          throw new Error("Connection returned null - user may have rejected");
        }

        console.log("[MidnightWebGL] Connected! API keys:", Object.keys(api));

        // Get connection status
        var connectionStatus = null;
        if (typeof api.getConnectionStatus === "function") {
          try {
            connectionStatus = await api.getConnectionStatus();
            console.log("[MidnightWebGL] Connection status:", connectionStatus);
          } catch (e) {
            console.warn("[MidnightWebGL] getConnectionStatus() error:", e.message);
          }
        }

        // Get shielded addresses
        var shieldedAddresses = [];
        var shieldedAddress = null;
        if (typeof api.getShieldedAddresses === "function") {
          try {
            shieldedAddresses = await api.getShieldedAddresses();
            console.log("[MidnightWebGL] Shielded addresses:", shieldedAddresses);
            if (shieldedAddresses && shieldedAddresses.length > 0) {
              shieldedAddress = shieldedAddresses[0];
            }
          } catch (e) {
            console.warn("[MidnightWebGL] getShieldedAddresses() error:", e.message);
          }
        } else if (typeof api.state === "function") {
          try {
            var state = await api.state();
            console.log("[MidnightWebGL] Wallet state:", state);
            if (state && state.address) {
              shieldedAddress = state.address;
              shieldedAddresses = [state.address];
            }
          } catch (e) {
            console.warn("[MidnightWebGL] state() error:", e.message);
          }
        }

        // Get configuration
        var configuration = null;
        if (typeof api.getConfiguration === "function") {
          try {
            configuration = await api.getConfiguration();
            console.log("[MidnightWebGL] Configuration:", configuration);
          } catch (e) {
            console.warn("[MidnightWebGL] getConfiguration() error:", e.message);
          }
        } else if (typeof api.serviceUriConfig === "function") {
          try {
            configuration = await api.serviceUriConfig();
            console.log("[MidnightWebGL] Service URI config:", configuration);
          } catch (e) {
            console.warn("[MidnightWebGL] serviceUriConfig() error:", e.message);
          }
        } else if (typeof mnLace.serviceUriConfig === "function") {
          try {
            configuration = await mnLace.serviceUriConfig();
            console.log("[MidnightWebGL] Connector serviceUriConfig:", configuration);
          } catch (e) {
            console.warn("[MidnightWebGL] connector.serviceUriConfig() error:", e.message);
          }
        }

        // Store for later use
        window.__midnightPreprodApi = api;
        window.__midnightPreprodConfig = configuration;
        window.__midnightPreprodAddress = shieldedAddress;

        var result = {
          success: true,
          walletName: mnLace.name || "mnLace",
          apiVersion: mnLace.apiVersion || "unknown",
          network: network,
          connectionStatus: connectionStatus,
          shieldedAddress: shieldedAddress,
          shieldedAddresses: shieldedAddresses,
          configuration: configuration
        };

        console.log("[MidnightWebGL] Connection complete:", result);
        var payload = JSON.stringify(result);
        SendMessage(gameObjectName, successCallback, payload);

      } catch (err) {
        var msg = (err && err.message) ? err.message : String(err);
        var lower = msg.toLowerCase();
        if (lower.includes("rejected") || lower.includes("declined") || lower.includes("deny") || lower.includes("cancel")) {
          msg = "User rejected the connection request.";
        }
        console.error("[MidnightWebGL] MidnightPreprod_Connect error:", msg);
        SendMessage(gameObjectName, errorCallback, msg);
      }
    })();
  },

  // ============================================================
  // MidnightPreprod_Disconnect
  // ============================================================
  MidnightPreprod_Disconnect: function () {
    console.log("[MidnightWebGL] MidnightPreprod_Disconnect()");
    window.__midnightPreprodApi = null;
    window.__midnightPreprodConfig = null;
    window.__midnightPreprodAddress = null;
    if (typeof window.MidnightBridge !== "undefined" && 
        typeof window.MidnightBridge.disconnect === "function") {
      window.MidnightBridge.disconnect();
    }
  },

  // ============================================================
  // MidnightPreprod_IsConnected
  // ============================================================
  MidnightPreprod_IsConnected: function () {
    if (window.__midnightPreprodApi) return 1;
    if (typeof window.MidnightBridge !== "undefined" && 
        typeof window.MidnightBridge.isConnected === "function") {
      return window.MidnightBridge.isConnected() ? 1 : 0;
    }
    return 0;
  },

  // ============================================================
  // MidnightPreprod_RunDiagnostic
  // ============================================================
  MidnightPreprod_RunDiagnostic: function (gameObjectNamePtr, callbackPtr) {
    var gameObjectName = UTF8ToString(gameObjectNamePtr);
    var callback = UTF8ToString(callbackPtr);

    console.log("[MidnightWebGL] MidnightPreprod_RunDiagnostic()");

    (async function () {
      var result = { success: false, error: null };

      try {
        if (typeof window.MidnightBridge !== "undefined" && 
            typeof window.MidnightBridge.runDiagnostic === "function") {
          result = await window.MidnightBridge.runDiagnostic();
        } else {
          // Run inline diagnostic
          console.log("[MidnightWebGL] === MIDNIGHT PREPROD DIAGNOSTIC ===");
          
          if (!window.midnight) {
            result.error = "window.midnight not found";
            console.log("[MidnightWebGL] window.midnight: NOT FOUND");
          } else {
            console.log("[MidnightWebGL] window.midnight: EXISTS");
            console.log("[MidnightWebGL]   keys:", Object.keys(window.midnight));
            
            if (!window.midnight.mnLace) {
              result.error = "window.midnight.mnLace not found";
              console.log("[MidnightWebGL] window.midnight.mnLace: NOT FOUND");
            } else {
              console.log("[MidnightWebGL] window.midnight.mnLace: EXISTS");
              console.log("[MidnightWebGL]   keys:", Object.keys(window.midnight.mnLace));
              console.log("[MidnightWebGL]   name:", window.midnight.mnLace.name);
              console.log("[MidnightWebGL]   apiVersion:", window.midnight.mnLace.apiVersion);
              console.log("[MidnightWebGL]   connect:", typeof window.midnight.mnLace.connect);
              console.log("[MidnightWebGL]   enable:", typeof window.midnight.mnLace.enable);
              result.success = true;
            }
          }
          
          console.log("[MidnightWebGL] === END DIAGNOSTIC ===");
        }
      } catch (e) {
        result.error = e.message || String(e);
      }

      var payload = JSON.stringify(result);
      SendMessage(gameObjectName, callback, payload);
    })();
  },

  // ============================================================
  // MidnightPreprod_JoinContract
  // ============================================================
  MidnightPreprod_JoinContract: function (gameObjectNamePtr, successCallbackPtr, errorCallbackPtr, contractAddressPtr) {
    var gameObjectName = UTF8ToString(gameObjectNamePtr);
    var successCallback = UTF8ToString(successCallbackPtr);
    var errorCallback = UTF8ToString(errorCallbackPtr);
    var contractAddress = UTF8ToString(contractAddressPtr);

    console.log("[MidnightWebGL] MidnightPreprod_JoinContract()");
    console.log("[MidnightWebGL]   contractAddress:", contractAddress);

    (async function () {
      try {
        if (!window.__midnightPreprodApi) {
          throw new Error("Not connected. Call MidnightPreprod_Connect first.");
        }

        // Use MidnightCounter if available
        if (typeof window.MidnightCounter !== "undefined" && 
            typeof window.MidnightCounter.joinContract === "function") {
          var result = await window.MidnightCounter.joinContract(contractAddress);
          var payload = JSON.stringify(result);
          SendMessage(gameObjectName, successCallback, payload);
          return;
        }

        // Store contract address for later use
        window.__midnightPreprodContractAddress = contractAddress;
        
        var result = {
          success: true,
          contractAddress: contractAddress,
          message: "Contract address stored. Full contract client requires midnight.bundle.js."
        };

        console.log("[MidnightWebGL] Contract joined (address stored)");
        var payload = JSON.stringify(result);
        SendMessage(gameObjectName, successCallback, payload);

      } catch (err) {
        var msg = (err && err.message) ? err.message : String(err);
        console.error("[MidnightWebGL] MidnightPreprod_JoinContract error:", msg);
        SendMessage(gameObjectName, errorCallback, msg);
      }
    })();
  },

  // ============================================================
  // MidnightPreprod_ReadCounter
  // Uses MidnightSDK.readCounter() to query the Counter contract
  // ============================================================
  MidnightPreprod_ReadCounter: function (gameObjectNamePtr, successCallbackPtr, errorCallbackPtr, contractAddressPtr) {
    var gameObjectName = UTF8ToString(gameObjectNamePtr);
    var successCallback = UTF8ToString(successCallbackPtr);
    var errorCallback = UTF8ToString(errorCallbackPtr);
    var contractAddress = contractAddressPtr ? UTF8ToString(contractAddressPtr) : "";

    console.log("[MidnightWebGL] MidnightPreprod_ReadCounter()");
    console.log("[MidnightWebGL]   contractAddress:", contractAddress || "(default)");

    (async function () {
      try {
        console.log("[MidnightWebGL] DIAG ReadCounter window:", typeof window, "window.MidnightSDK:", typeof (window && window.MidnightSDK), "window.__midnightSDK:", typeof (window && window.__midnightSDK));
        // Robustly find MidnightSDK across all scopes (iframe support)
        var sdk = (typeof window !== "undefined" && window.MidnightSDK) ||
                  (typeof window !== "undefined" && window.__midnightSDK) ||
                  (typeof globalThis !== "undefined" && globalThis.MidnightSDK) ||
                  (typeof self !== "undefined" && self.MidnightSDK) || null;
        if (!sdk) {
          try { if (typeof parent !== "undefined" && parent !== window && parent.MidnightSDK) sdk = parent.MidnightSDK; } catch(e) {}
        }
        if (!sdk) {
          try { if (typeof top !== "undefined" && top !== window && top.MidnightSDK) sdk = top.MidnightSDK; } catch(e) {}
        }

        // Use MidnightSDK.readCounter() if available
        if (sdk && typeof sdk.readCounter === "function") {
          console.log("[MidnightWebGL] Using MidnightSDK.readCounter()");
          var result;
          if (contractAddress) {
            result = await sdk.readCounter(contractAddress);
          } else {
            result = await sdk.readCounter();
          }
          
          console.log("[MidnightWebGL] readCounter result:", result);
          
          if (result.success) {
            var payload = JSON.stringify({
              success: true,
              counter: result.counter,
              contractAddress: result.contractAddress
            });
            SendMessage(gameObjectName, successCallback, payload);
          } else {
            throw new Error(result.error || "Failed to read counter");
          }
          return;
        }

        // Legacy: Use MidnightCounter if available
        if (typeof window.MidnightCounter !== "undefined" && 
            typeof window.MidnightCounter.readCounter === "function") {
          var value = await window.MidnightCounter.readCounter();
          var payload = JSON.stringify({
            success: true,
            counter: value,
            contractAddress: contractAddress || window.__midnightPreprodContractAddress || ""
          });
          SendMessage(gameObjectName, successCallback, payload);
          return;
        }

        throw new Error(
          "MidnightSDK.readCounter() not available. " +
          "Ensure midnight-sdk.bundle.js is loaded."
        );

      } catch (err) {
        var msg = (err && err.message) ? err.message : String(err);
        console.error("[MidnightWebGL] MidnightPreprod_ReadCounter error:", msg);
        SendMessage(gameObjectName, errorCallback, msg);
      }
    })();
  },

  // ============================================================
  // MidnightPreprod_IncrementCounter
  // Uses MidnightSDK.incrementCounter() to call the increment circuit
  // ============================================================
  MidnightPreprod_IncrementCounter: function (gameObjectNamePtr, successCallbackPtr, errorCallbackPtr, contractAddressPtr) {
    var gameObjectName = UTF8ToString(gameObjectNamePtr);
    var successCallback = UTF8ToString(successCallbackPtr);
    var errorCallback = UTF8ToString(errorCallbackPtr);
    var contractAddress = contractAddressPtr ? UTF8ToString(contractAddressPtr) : "";

    console.log("[MidnightWebGL] MidnightPreprod_IncrementCounter()");
    console.log("[MidnightWebGL]   contractAddress:", contractAddress || "(default)");

    (async function () {
      try {
        console.log("[MidnightWebGL] DIAG PreprodInc window:", typeof window, "window.MidnightSDK:", typeof (window && window.MidnightSDK), "window.__midnightSDK:", typeof (window && window.__midnightSDK));
        // Robustly find MidnightSDK across all scopes (iframe support)
        var sdk = (typeof window !== "undefined" && window.MidnightSDK) ||
                  (typeof window !== "undefined" && window.__midnightSDK) ||
                  (typeof globalThis !== "undefined" && globalThis.MidnightSDK) ||
                  (typeof self !== "undefined" && self.MidnightSDK) || null;
        if (!sdk) {
          try { if (typeof parent !== "undefined" && parent !== window && parent.MidnightSDK) sdk = parent.MidnightSDK; } catch(e) {}
        }
        if (!sdk) {
          try { if (typeof top !== "undefined" && top !== window && top.MidnightSDK) sdk = top.MidnightSDK; } catch(e) {}
        }

        // Check if connected
        if (sdk) {
          if (typeof sdk.isConnected === "function" && !sdk.isConnected()) {
            throw new Error("Not connected. Call Midnight_ConnectPreprod first.");
          }
          if (typeof sdk.isAuthorized === "function" && !sdk.isAuthorized()) {
            throw new Error("Not authorized. Call Midnight_ConnectPreprod first.");
          }
        }

        // Use MidnightSDK.incrementCounter() if available
        if (sdk && typeof sdk.incrementCounter === "function") {
          console.log("[MidnightWebGL] Using MidnightSDK.incrementCounter()");
          var result;
          if (contractAddress) {
            result = await sdk.incrementCounter(contractAddress);
          } else {
            result = await sdk.incrementCounter();
          }
          
          console.log("[MidnightWebGL] incrementCounter result:", result);
          
          if (result.success) {
            var payload = JSON.stringify({
              success: true,
              txHash: result.txHash,
              previousCounter: result.previousCounter,
              newCounter: result.newCounter,
              contractAddress: result.contractAddress
            });
            SendMessage(gameObjectName, successCallback, payload);
          } else {
            throw new Error(result.error || "Failed to increment counter");
          }
          return;
        }

        // Legacy: Use MidnightCounter if available
        if (typeof window.MidnightCounter !== "undefined" && 
            typeof window.MidnightCounter.incrementCounter === "function") {
          var result = await window.MidnightCounter.incrementCounter();
          var payload = JSON.stringify(result);
          SendMessage(gameObjectName, successCallback, payload);
          return;
        }

        throw new Error(
          "MidnightSDK.incrementCounter() not available. " +
          "Ensure midnight-sdk.bundle.js is loaded and you are connected."
        );

      } catch (err) {
        var msg = (err && err.message) ? err.message : String(err);
        var lower = msg.toLowerCase();
        if (lower.includes("rejected") || lower.includes("declined") || lower.includes("deny") || lower.includes("cancel")) {
          msg = "User rejected the transaction.";
        }
        console.error("[MidnightWebGL] MidnightPreprod_IncrementCounter error:", msg);
        SendMessage(gameObjectName, errorCallback, msg);
      }
    })();
  },

  // ============================================================
  // Midnight_ConnectPreprod
  // Uses MidnightSDK.connectPreprod() with two-phase authorization
  // ============================================================
  Midnight_ConnectPreprod: function (gameObjectNamePtr, successCallbackPtr, errorCallbackPtr) {
    var gameObjectName = UTF8ToString(gameObjectNamePtr);
    var successCallback = UTF8ToString(successCallbackPtr);
    var errorCallback = UTF8ToString(errorCallbackPtr);

    console.log("[MidnightWebGL] Midnight_ConnectPreprod()");

    (async function () {
      try {
        // Use MidnightSDK.connectPreprod() if available
        if (typeof window.MidnightSDK !== "undefined" && 
            typeof window.MidnightSDK.connectPreprod === "function") {
          console.log("[MidnightWebGL] Using MidnightSDK.connectPreprod()");
          var result = await window.MidnightSDK.connectPreprod();
          
          console.log("[MidnightWebGL] connectPreprod result:", result);
          
          if (result.success) {
            var payload = JSON.stringify({
              success: true,
              connected: result.connected,
              authorized: result.authorized,
              providerKey: result.providerKey,
              apiVersion: result.apiVersion,
              walletName: result.walletName
            });
            SendMessage(gameObjectName, successCallback, payload);
          } else {
            var errorMsg = result.errors && result.errors.length > 0 
              ? result.errors.join("; ") 
              : "Connection failed";
            throw new Error(errorMsg);
          }
          return;
        }

        throw new Error(
          "MidnightSDK.connectPreprod() not available. " +
          "Ensure midnight-sdk.bundle.js is loaded."
        );

      } catch (err) {
        var msg = (err && err.message) ? err.message : String(err);
        var lower = msg.toLowerCase();
        if (lower.includes("rejected") || lower.includes("declined") || lower.includes("deny") || lower.includes("cancel")) {
          msg = "User rejected the connection request.";
        }
        console.error("[MidnightWebGL] Midnight_ConnectPreprod error:", msg);
        SendMessage(gameObjectName, errorCallback, msg);
      }
    })();
  },

  // ============================================================
  // Midnight_ReadCounter
  // Wrapper for MidnightPreprod_ReadCounter with simpler signature
  // ============================================================
  Midnight_ReadCounter: function (gameObjectNamePtr, successCallbackPtr, errorCallbackPtr) {
    var gameObjectName = UTF8ToString(gameObjectNamePtr);
    var successCallback = UTF8ToString(successCallbackPtr);
    var errorCallback = UTF8ToString(errorCallbackPtr);

    console.log("[MidnightWebGL] Midnight_ReadCounter()");

    (async function () {
      try {
        console.log("[MidnightWebGL] DIAG ReadCounter2 window:", typeof window, "window.MidnightSDK:", typeof (window && window.MidnightSDK), "window.__midnightSDK:", typeof (window && window.__midnightSDK));
        // Find MidnightSDK across window, parent, top (iframe support)
        var sdk = (typeof window !== "undefined" && window.MidnightSDK) ||
                  (typeof window !== "undefined" && window.__midnightSDK) ||
                  (typeof globalThis !== "undefined" && globalThis.MidnightSDK) ||
                  (typeof self !== "undefined" && self.MidnightSDK) || null;
        if (!sdk) {
          try { if (typeof parent !== "undefined" && parent !== window && parent.MidnightSDK) sdk = parent.MidnightSDK; } catch(e) {}
        }
        if (!sdk) {
          try { if (typeof top !== "undefined" && top !== window && top.MidnightSDK) sdk = top.MidnightSDK; } catch(e) {}
        }
        if (sdk && typeof sdk.readCounter === "function") {
          var result = await sdk.readCounter();
          
          if (result.success) {
            var payload = JSON.stringify({
              success: true,
              counter: result.counter,
              contractAddress: result.contractAddress
            });
            SendMessage(gameObjectName, successCallback, payload);
          } else {
            throw new Error(result.error || "Failed to read counter");
          }
          return;
        }

        throw new Error("MidnightSDK.readCounter() not available");

      } catch (err) {
        var msg = (err && err.message) ? err.message : String(err);
        console.error("[MidnightWebGL] Midnight_ReadCounter error:", msg);
        SendMessage(gameObjectName, errorCallback, msg);
      }
    })();
  },

  // ============================================================
  // Midnight_IncrementCounter
  // Wrapper for MidnightPreprod_IncrementCounter with simpler signature
  // ============================================================
  Midnight_IncrementCounter: function (gameObjectNamePtr, successCallbackPtr, errorCallbackPtr) {
    var gameObjectName = UTF8ToString(gameObjectNamePtr);
    var successCallback = UTF8ToString(successCallbackPtr);
    var errorCallback = UTF8ToString(errorCallbackPtr);

    (async function () {
      try {
        console.log("[MidnightWebGL] DIAG IncCounter window:", typeof window, "window.MidnightSDK:", typeof (window && window.MidnightSDK), "window.__midnightSDK:", typeof (window && window.__midnightSDK));
        // Robustly find MidnightSDK — window.MidnightSDK may be shadowed in Emscripten scope or iframe
        var sdk = (typeof window !== "undefined" && window.MidnightSDK) ||
                  (typeof window !== "undefined" && window.__midnightSDK) ||
                  (typeof globalThis !== "undefined" && globalThis.MidnightSDK) ||
                  (typeof self !== "undefined" && self.MidnightSDK) || null;
        // If not found, try parent/top (Unity may run in iframe on itch.io etc.)
        if (!sdk) {
          try { if (typeof parent !== "undefined" && parent !== window && parent.MidnightSDK) sdk = parent.MidnightSDK; } catch(e) {}
        }
        if (!sdk) {
          try { if (typeof top !== "undefined" && top !== window && top.MidnightSDK) sdk = top.MidnightSDK; } catch(e) {}
        }
        var sdkSource = "none";
        if (sdk) {
          if (typeof window !== "undefined" && sdk === window.MidnightSDK) sdkSource = "window.MidnightSDK";
          else if (typeof window !== "undefined" && sdk === window.__midnightSDK) sdkSource = "window.__midnightSDK";
          else if (typeof globalThis !== "undefined" && sdk === globalThis.MidnightSDK) sdkSource = "globalThis.MidnightSDK";
          else if (typeof self !== "undefined" && sdk === self.MidnightSDK) sdkSource = "self.MidnightSDK";
          else {
            try { if (typeof parent !== "undefined" && sdk === parent.MidnightSDK) sdkSource = "parent.MidnightSDK"; } catch(e) {}
          }
          if (sdkSource === "none") {
            try { if (typeof top !== "undefined" && sdk === top.MidnightSDK) sdkSource = "top.MidnightSDK"; } catch(e) {}
          }
        }
        console.log("[MidnightWebGL] sdk found via:", sdkSource);
        if (sdk) {
          console.log("[MidnightWebGL] sdk keys:", Object.keys(sdk));
          console.log("[MidnightWebGL] sdk.incrementCounter:", typeof sdk.incrementCounter);
          console.log("[MidnightWebGL] sdk.isConnected:", typeof sdk.isConnected);
          if (typeof sdk.isConnected === "function" && !sdk.isConnected()) {
            throw new Error("Not connected. Call Midnight_ConnectPreprod first.");
          }
        } else {
          console.error("[MidnightWebGL] MidnightSDK not found on any global object!");
        }

        if (sdk && typeof sdk.incrementCounter === "function") {
          var result = await sdk.incrementCounter();
          
          if (result.success) {
            var payload = JSON.stringify({
              success: true,
              txHash: result.txHash,
              previousCounter: result.previousCounter,
              newCounter: result.newCounter,
              contractAddress: result.contractAddress
            });
            SendMessage(gameObjectName, successCallback, payload);
          } else {
            throw new Error(result.error || "Failed to increment counter");
          }
          return;
        }

        throw new Error("MidnightSDK.incrementCounter() not available (typeof=" + (sdk ? typeof sdk.incrementCounter : "no SDK") + ")");

      } catch (err) {
        var msg = (err && err.message) ? err.message : String(err);
        var lower = msg.toLowerCase();
        if (lower.includes("rejected") || lower.includes("declined") || lower.includes("deny") || lower.includes("cancel")) {
          msg = "User rejected the transaction.";
        }
        console.error("[MidnightWebGL] Midnight_IncrementCounter error:", msg);
        SendMessage(gameObjectName, errorCallback, msg);
      }
    })();
  }
};

// Merge into Unity WebGL runtime
mergeInto(LibraryManager.library, MidnightWebGLPlugin);
