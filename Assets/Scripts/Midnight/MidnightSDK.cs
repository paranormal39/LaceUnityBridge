using System;
using System.Runtime.InteropServices;
using UnityEngine;

namespace Midnight
{
    /// <summary>
    /// MidnightSDK - Simple API for Unity developers to integrate Lace wallet.
    /// 
    /// Debug Logging:
    ///   All logs are prefixed with [MidnightSDK] for easy filtering.
    ///   Set MidnightSDK.DebugMode = true for verbose logging.
    /// 
    /// Usage:
    ///   // Connect to wallet
    ///   MidnightSDK.Connect(onSuccess: wallet => {
    ///       Debug.Log($"Connected: {wallet.Address}");
    ///       Debug.Log($"Mode: {wallet.Mode}"); // "midnight" or "cardano"
    ///       Debug.Log($"Network: {wallet.Network}"); // "preprod", "mainnet", etc.
    ///   }, onError: error => {
    ///       Debug.LogError($"Connection failed: {error}");
    ///   });
    ///   
    ///   // Get balance
    ///   MidnightSDK.GetBalance(onSuccess: balance => {
    ///       Debug.Log($"Balance: {balance.Native} tDUST");
    ///   });
    ///   
    ///   // Send transaction
    ///   MidnightSDK.Send(recipientAddress, amountLovelace, onSuccess: txHash => {
    ///       Debug.Log($"Sent! TX: {txHash}");
    ///   });
    /// </summary>
    public static class MidnightSDK
    {
        // ============================================================
        // Public Types
        // ============================================================

        /// <summary>
        /// Wallet connection information.
        /// </summary>
        public class WalletInfo
        {
            public string Address { get; set; }
            public string Mode { get; set; }      // "midnight" or "cardano"
            public string Network { get; set; }   // "preprod", "mainnet", "preview"
            public int NetworkId { get; set; }
            public bool IsMidnight => Mode == "midnight";
            public bool IsCardano => Mode == "cardano";
        }

        /// <summary>
        /// Wallet balance information.
        /// </summary>
        public class BalanceInfo
        {
            public string Native { get; set; }           // Native token (tDUST/ADA)
            public string NativeFormatted { get; set; }  // Human-readable
            public string Shielded { get; set; }         // Shielded balance (Midnight)
            public string Unshielded { get; set; }       // Unshielded balance (Midnight)
            public string Dust { get; set; }             // Dust balance (Midnight)
        }

        /// <summary>
        /// Counter contract result.
        /// </summary>
        public class CounterResult
        {
            public bool Success { get; set; }
            public int Counter { get; set; }
            public string TxHash { get; set; }
            public bool TimedOut { get; set; }
            public string Error { get; set; }
        }

        /// <summary>
        /// SDK state.
        /// </summary>
        public enum State
        {
            NotInitialized,
            WalletNotFound,
            Ready,
            Connecting,
            Connected,
            Error
        }

        // ============================================================
        // Public Properties
        // ============================================================

        /// <summary>Current SDK state.</summary>
        public static State CurrentState { get; private set; } = State.NotInitialized;

        /// <summary>Current wallet info (null if not connected).</summary>
        public static WalletInfo Wallet { get; private set; }

        /// <summary>Last error message.</summary>
        public static string LastError { get; private set; }

        /// <summary>Is wallet connected?</summary>
        public static bool IsConnected => CurrentState == State.Connected && Wallet != null;

        /// <summary>Is Lace wallet available in browser?</summary>
        public static bool IsWalletAvailable => CurrentState != State.NotInitialized && CurrentState != State.WalletNotFound;

        /// <summary>Enable verbose debug logging.</summary>
        public static bool DebugMode { get; set; } = true;

        // ============================================================
        // Events
        // ============================================================

        /// <summary>Fired when wallet connects.</summary>
        public static event Action<WalletInfo> OnConnected;

        /// <summary>Fired when wallet disconnects.</summary>
        public static event Action OnDisconnected;

        /// <summary>Fired on any error.</summary>
        public static event Action<string> OnError;

        /// <summary>Fired when state changes.</summary>
        public static event Action<State> OnStateChanged;

        // ============================================================
        // JSLIB Imports (WebGL only)
        // ============================================================

#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")]
        private static extern int IsLaceAvailable();

        [DllImport("__Internal")]
        private static extern void ConnectLace(string gameObjectName, string successCallback, string errorCallback);

        [DllImport("__Internal")]
        private static extern int DisconnectLace();

        [DllImport("__Internal")]
        private static extern void MidnightGetWalletState(string gameObjectName, string successCallback, string errorCallback);

        [DllImport("__Internal")]
        private static extern void BuildAndSendTransaction(string gameObjectName, string successCallback, string errorCallback, string recipientAddress, string amountLovelace);

        [DllImport("__Internal")]
        private static extern void SignTransaction(string gameObjectName, string successCallback, string errorCallback, string txCbor, int partialSign);

        [DllImport("__Internal")]
        private static extern void SignData(string gameObjectName, string successCallback, string errorCallback, string addressHex, string payloadHex);

        [DllImport("__Internal")]
        private static extern void JS_CopyToClipboard(string text);

        [DllImport("__Internal")]
        private static extern void IsLaceAvailableDelayed(string gameObjectName, string callback, int delayMs);

        [DllImport("__Internal")]
        private static extern void Midnight_ReadCounter(string gameObjectName, string successCallback, string errorCallback);

        [DllImport("__Internal")]
        private static extern void Midnight_IncrementCounter(string gameObjectName, string successCallback, string errorCallback);
#endif

        // ============================================================
        // Internal State
        // ============================================================

        private static MidnightSDKCallbackHandler _callbackHandler;
        private static Action<WalletInfo> _connectSuccessCallback;
        private static Action<string> _connectErrorCallback;
        private static Action<BalanceInfo> _balanceSuccessCallback;
        private static Action<string> _balanceErrorCallback;
        private static Action<string> _sendSuccessCallback;
        private static Action<string> _sendErrorCallback;
        private static Action<CounterResult> _readCounterSuccessCallback;
        private static Action<string> _readCounterErrorCallback;
        private static Action<CounterResult> _incrementCounterSuccessCallback;
        private static Action<string> _incrementCounterErrorCallback;

        // ============================================================
        // Logging
        // ============================================================

        private static void Log(string message)
        {
            if (DebugMode) Debug.Log($"[MidnightSDK] {message}");
        }

        private static void LogWarning(string message)
        {
            Debug.LogWarning($"[MidnightSDK] ⚠ {message}");
        }

        private static void LogError(string message)
        {
            Debug.LogError($"[MidnightSDK] ✗ {message}");
        }

        private static void LogSuccess(string message)
        {
            if (DebugMode) Debug.Log($"[MidnightSDK] ✓ {message}");
        }

        // ============================================================
        // Public API
        // ============================================================

        /// <summary>
        /// Initialize the SDK. Call this once on startup.
        /// Automatically detects if Lace wallet is available.
        /// </summary>
        /// <param name="onReady">Called when SDK is ready (wallet found)</param>
        /// <param name="onWalletNotFound">Called if wallet not found</param>
        /// <param name="detectionDelayMs">Delay for wallet detection (extensions load late)</param>
        public static void Initialize(Action onReady = null, Action onWalletNotFound = null, int detectionDelayMs = 1500)
        {
            Log("═══════════════════════════════════════════");
            Log("Initializing MidnightSDK...");
            Log($"  Detection delay: {detectionDelayMs}ms");
            Log("═══════════════════════════════════════════");
            
            EnsureCallbackHandler();

#if UNITY_WEBGL && !UNITY_EDITOR
            Log("Platform: WebGL (production mode)");
            Log("Checking for Lace wallet (immediate)...");
            
            // Check immediately
            bool available = IsLaceAvailable() == 1;
            if (available)
            {
                LogSuccess("Lace wallet detected (immediate check)");
                SetState(State.Ready);
                onReady?.Invoke();
            }
            else
            {
                Log($"Wallet not found immediately, trying delayed detection ({detectionDelayMs}ms)...");
                // Try delayed detection (extensions sometimes load late)
                _callbackHandler.SetInitCallbacks(onReady, onWalletNotFound);
                IsLaceAvailableDelayed(_callbackHandler.gameObject.name, "OnDelayedDetection", detectionDelayMs);
            }
#else
            LogWarning("Platform: Unity Editor (WebGL features disabled)");
            Log("To test wallet connection, build for WebGL and run in browser");
            SetState(State.NotInitialized);
            onWalletNotFound?.Invoke();
#endif
        }

        /// <summary>
        /// Connect to Lace wallet.
        /// </summary>
        /// <param name="onSuccess">Called with wallet info on success</param>
        /// <param name="onError">Called with error message on failure</param>
        public static void Connect(Action<WalletInfo> onSuccess = null, Action<string> onError = null)
        {
            Log("───────────────────────────────────────────");
            Log("Connect() called");
            Log($"  Current state: {CurrentState}");
            
            if (CurrentState == State.Connected)
            {
                Log("Already connected, returning existing wallet info");
                onSuccess?.Invoke(Wallet);
                return;
            }

            if (CurrentState == State.Connecting)
            {
                LogWarning("Connection already in progress");
                onError?.Invoke("Connection already in progress");
                return;
            }

            EnsureCallbackHandler();
            _connectSuccessCallback = onSuccess;
            _connectErrorCallback = onError;

#if UNITY_WEBGL && !UNITY_EDITOR
            Log("Calling JavaScript ConnectLace()...");
            Log("  → This will trigger wallet popup in browser");
            SetState(State.Connecting);
            ConnectLace(_callbackHandler.gameObject.name, "OnConnectSuccess", "OnConnectError");
#else
            LogError("WebGL only - run in browser");
            onError?.Invoke("WebGL only - run in browser");
#endif
        }

        /// <summary>
        /// Disconnect from wallet.
        /// </summary>
        public static void Disconnect()
        {
            Log("───────────────────────────────────────────");
            Log("Disconnect() called");
            
#if UNITY_WEBGL && !UNITY_EDITOR
            Log("Calling JavaScript DisconnectLace()...");
            DisconnectLace();
#endif
            Wallet = null;
            SetState(State.Ready);
            LogSuccess("Disconnected from wallet");
            OnDisconnected?.Invoke();
        }

        /// <summary>
        /// Get wallet balance.
        /// </summary>
        /// <param name="onSuccess">Called with balance info</param>
        /// <param name="onError">Called on error</param>
        public static void GetBalance(Action<BalanceInfo> onSuccess = null, Action<string> onError = null)
        {
            Log("───────────────────────────────────────────");
            Log("GetBalance() called");
            
            if (!IsConnected)
            {
                LogWarning("Cannot get balance - wallet not connected");
                onError?.Invoke("Wallet not connected");
                return;
            }

            EnsureCallbackHandler();
            _balanceSuccessCallback = onSuccess;
            _balanceErrorCallback = onError;

#if UNITY_WEBGL && !UNITY_EDITOR
            Log("Calling JavaScript MidnightGetWalletState()...");
            MidnightGetWalletState(_callbackHandler.gameObject.name, "OnBalanceSuccess", "OnBalanceError");
#else
            LogError("WebGL only");
            onError?.Invoke("WebGL only");
#endif
        }

        /// <summary>
        /// Send native tokens to an address.
        /// </summary>
        /// <param name="recipientAddress">Recipient address</param>
        /// <param name="amountLovelace">Amount in lovelace (1 ADA = 1,000,000 lovelace)</param>
        /// <param name="onSuccess">Called with transaction hash</param>
        /// <param name="onError">Called on error</param>
        public static void Send(string recipientAddress, string amountLovelace, Action<string> onSuccess = null, Action<string> onError = null)
        {
            Log("───────────────────────────────────────────");
            Log("Send() called");
            Log($"  Recipient: {recipientAddress}");
            Log($"  Amount: {amountLovelace} lovelace");
            
            if (!IsConnected)
            {
                LogWarning("Cannot send - wallet not connected");
                onError?.Invoke("Wallet not connected");
                return;
            }

            EnsureCallbackHandler();
            _sendSuccessCallback = onSuccess;
            _sendErrorCallback = onError;

#if UNITY_WEBGL && !UNITY_EDITOR
            Log("Calling JavaScript BuildAndSendTransaction()...");
            Log("  → This will trigger wallet signing popup");
            BuildAndSendTransaction(_callbackHandler.gameObject.name, "OnSendSuccess", "OnSendError", recipientAddress, amountLovelace);
#else
            LogError("WebGL only");
            onError?.Invoke("WebGL only");
#endif
        }

        /// <summary>
        /// Copy text to clipboard.
        /// </summary>
        public static void CopyToClipboard(string text)
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            JS_CopyToClipboard(text);
#else
            GUIUtility.systemCopyBuffer = text;
#endif
        }

        /// <summary>
        /// Read the current counter value from the deployed Counter contract.
        /// </summary>
        /// <param name="onSuccess">Called with counter result</param>
        /// <param name="onError">Called on error</param>
        public static void ReadCounter(Action<CounterResult> onSuccess = null, Action<string> onError = null)
        {
            Log("───────────────────────────────────────────");
            Log("ReadCounter() called");
            
            if (!IsConnected)
            {
                LogWarning("Cannot read counter - wallet not connected");
                onError?.Invoke("Wallet not connected");
                return;
            }

            EnsureCallbackHandler();
            _readCounterSuccessCallback = onSuccess;
            _readCounterErrorCallback = onError;

#if UNITY_WEBGL && !UNITY_EDITOR
            Log("Calling JavaScript Midnight_ReadCounter()...");
            Midnight_ReadCounter(_callbackHandler.gameObject.name, "OnReadCounterSuccess", "OnReadCounterError");
#else
            LogError("WebGL only");
            onError?.Invoke("WebGL only");
#endif
        }

        /// <summary>
        /// Increment the counter on the deployed Counter contract.
        /// This will trigger a wallet signing popup.
        /// </summary>
        /// <param name="onSuccess">Called with counter result including tx hash</param>
        /// <param name="onError">Called on error</param>
        public static void IncrementCounter(Action<CounterResult> onSuccess = null, Action<string> onError = null)
        {
            Log("───────────────────────────────────────────");
            Log("IncrementCounter() called");
            
            if (!IsConnected)
            {
                LogWarning("Cannot increment counter - wallet not connected");
                onError?.Invoke("Wallet not connected");
                return;
            }

            EnsureCallbackHandler();
            _incrementCounterSuccessCallback = onSuccess;
            _incrementCounterErrorCallback = onError;

#if UNITY_WEBGL && !UNITY_EDITOR
            Log("Calling JavaScript Midnight_IncrementCounter()...");
            Log("  → This will trigger wallet signing popup");
            Midnight_IncrementCounter(_callbackHandler.gameObject.name, "OnIncrementCounterSuccess", "OnIncrementCounterError");
#else
            LogError("WebGL only");
            onError?.Invoke("WebGL only");
#endif
        }

        // ============================================================
        // Internal Methods
        // ============================================================

        private static void EnsureCallbackHandler()
        {
            if (_callbackHandler == null)
            {
                var go = new GameObject("MidnightSDKCallbacks");
                UnityEngine.Object.DontDestroyOnLoad(go);
                _callbackHandler = go.AddComponent<MidnightSDKCallbackHandler>();
            }
        }

        private static void SetState(State newState)
        {
            if (CurrentState != newState)
            {
                CurrentState = newState;
                OnStateChanged?.Invoke(newState);
            }
        }

        // ============================================================
        // Callback Handler (receives JS callbacks)
        // ============================================================

        internal static void HandleDelayedDetection(string result)
        {
            Log($"Delayed detection callback received: {result}");
            bool available = result == "1";
            
            if (available)
            {
                LogSuccess("Lace wallet detected (delayed check)");
            }
            else
            {
                LogWarning("Lace wallet NOT found after delayed check");
                Log("  → Make sure Lace extension is installed");
                Log("  → Try refreshing the page");
            }
            
            SetState(available ? State.Ready : State.WalletNotFound);
            _callbackHandler?.InvokeInitCallbacks(available);
        }

        internal static void HandleConnectSuccess(string resultJson)
        {
            Log("───────────────────────────────────────────");
            Log("Connection callback received (SUCCESS)");
            Log($"  Raw JSON: {resultJson}");
            
            try
            {
                var wallet = ParseWalletInfo(resultJson);
                Wallet = wallet;
                SetState(State.Connected);
                
                LogSuccess("WALLET CONNECTED!");
                Log($"  Mode: {wallet.Mode.ToUpper()}");
                Log($"  Network: {wallet.Network}");
                Log($"  NetworkId: {wallet.NetworkId}");
                Log($"  Address: {wallet.Address}");
                
                if (wallet.IsMidnight)
                {
                    Log("  ✓ Using Midnight API (ZK features available)");
                }
                else
                {
                    LogWarning("Using Cardano API (not Midnight mode)");
                    Log("  → To use Midnight, enable it in Lace settings");
                }
                
                _connectSuccessCallback?.Invoke(wallet);
                OnConnected?.Invoke(wallet);
            }
            catch (Exception e)
            {
                LogError($"Failed to parse connection result: {e.Message}");
                HandleConnectError($"Parse error: {e.Message}");
            }
        }

        internal static void HandleConnectError(string error)
        {
            Log("───────────────────────────────────────────");
            LogError($"Connection FAILED: {error}");
            
            // Provide helpful hints based on error
            if (error.Contains("rejected") || error.Contains("denied"))
            {
                Log("  → User rejected the connection request");
            }
            else if (error.Contains("shutdown") || error.Contains("channel"))
            {
                Log("  → Wallet extension may need refresh");
                Log("  → Try: Refresh page, unlock wallet, reconnect");
            }
            
            LastError = error;
            SetState(State.Error);
            _connectErrorCallback?.Invoke(error);
            OnError?.Invoke(error);
        }

        internal static void HandleBalanceSuccess(string resultJson)
        {
            Log("───────────────────────────────────────────");
            Log("Balance callback received (SUCCESS)");
            Log($"  Raw JSON: {resultJson}");
            
            try
            {
                var balance = ParseBalanceInfo(resultJson);
                
                LogSuccess("Balance retrieved:");
                Log($"  Native: {balance.Native} ({balance.NativeFormatted})");
                Log($"  Shielded: {balance.Shielded}");
                Log($"  Unshielded: {balance.Unshielded}");
                Log($"  Dust: {balance.Dust}");
                
                _balanceSuccessCallback?.Invoke(balance);
            }
            catch (Exception e)
            {
                LogError($"Failed to parse balance: {e.Message}");
                HandleBalanceError($"Parse error: {e.Message}");
            }
        }

        internal static void HandleBalanceError(string error)
        {
            LogError($"Balance fetch FAILED: {error}");
            _balanceErrorCallback?.Invoke(error);
            OnError?.Invoke(error);
        }

        internal static void HandleSendSuccess(string txHash)
        {
            Log("───────────────────────────────────────────");
            LogSuccess($"Transaction SENT!");
            Log($"  TX Hash: {txHash}");
            _sendSuccessCallback?.Invoke(txHash);
        }

        internal static void HandleSendError(string error)
        {
            LogError($"Transaction FAILED: {error}");
            _sendErrorCallback?.Invoke(error);
            OnError?.Invoke(error);
        }

        internal static void HandleReadCounterSuccess(string resultJson)
        {
            Log("───────────────────────────────────────────");
            Log("ReadCounter callback received (SUCCESS)");
            Log($"  Raw JSON: {resultJson}");
            
            try
            {
                var result = ParseCounterResult(resultJson);
                LogSuccess($"Counter value: {result.Counter}");
                _readCounterSuccessCallback?.Invoke(result);
            }
            catch (Exception e)
            {
                LogError($"Failed to parse counter result: {e.Message}");
                HandleReadCounterError($"Parse error: {e.Message}");
            }
        }

        internal static void HandleReadCounterError(string error)
        {
            LogError($"ReadCounter FAILED: {error}");
            _readCounterErrorCallback?.Invoke(error);
            OnError?.Invoke(error);
        }

        internal static void HandleIncrementCounterSuccess(string resultJson)
        {
            Log("───────────────────────────────────────────");
            Log("IncrementCounter callback received (SUCCESS)");
            Log($"  Raw JSON: {resultJson}");
            
            try
            {
                var result = ParseCounterResult(resultJson);
                if (result.TimedOut)
                    LogWarning($"Counter incremented (after watcher timeout)! New value: {result.Counter}, TX: {result.TxHash}");
                else
                    LogSuccess($"Counter incremented! New value: {result.Counter}, TX: {result.TxHash}");
                _incrementCounterSuccessCallback?.Invoke(result);
            }
            catch (Exception e)
            {
                LogError($"Failed to parse increment result: {e.Message}");
                HandleIncrementCounterError($"Parse error: {e.Message}");
            }
        }

        internal static void HandleIncrementCounterError(string error)
        {
            LogError($"IncrementCounter FAILED: {error}");
            _incrementCounterErrorCallback?.Invoke(error);
            OnError?.Invoke(error);
        }

        // ============================================================
        // JSON Parsing (simple, no external dependencies)
        // ============================================================

        private static WalletInfo ParseWalletInfo(string json)
        {
            var wallet = new WalletInfo();

            if (json.StartsWith("{"))
            {
                wallet.Address = ExtractJsonString(json, "address");
                wallet.Mode = ExtractJsonString(json, "mode");
                wallet.Network = ExtractJsonString(json, "network");
                wallet.NetworkId = ExtractJsonInt(json, "networkId");
            }
            else
            {
                wallet.Address = json;
                wallet.Mode = "unknown";
                wallet.Network = "unknown";
            }

            return wallet;
        }

        private static BalanceInfo ParseBalanceInfo(string json)
        {
            var balance = new BalanceInfo();

            if (json.StartsWith("{"))
            {
                // Extract dustBalance.balance (nested object)
                string dustBalanceRaw = "0";
                int dustStart = json.IndexOf("\"dustBalance\":{");
                if (dustStart >= 0)
                {
                    string dustBalanceValue = ExtractJsonString(json.Substring(dustStart), "balance");
                    if (!string.IsNullOrEmpty(dustBalanceValue))
                    {
                        dustBalanceRaw = dustBalanceValue;
                    }
                }
                
                // Extract unshieldedBalances - look for the token balance (key is 64 zeros for native)
                string unshieldedRaw = "0";
                int unshieldedStart = json.IndexOf("\"unshieldedBalances\":{");
                if (unshieldedStart >= 0)
                {
                    // Find the first balance value after unshieldedBalances
                    int balanceStart = json.IndexOf("\":\"", unshieldedStart);
                    if (balanceStart >= 0)
                    {
                        balanceStart += 3; // Skip ":"
                        int balanceEnd = json.IndexOf("\"", balanceStart);
                        if (balanceEnd > balanceStart)
                        {
                            unshieldedRaw = json.Substring(balanceStart, balanceEnd - balanceStart);
                        }
                    }
                }
                
                balance.Native = dustBalanceRaw;
                balance.Shielded = ExtractJsonString(json, "shieldedBalance") ?? "0";
                balance.Unshielded = unshieldedRaw;
                balance.Dust = dustBalanceRaw;

                // Format native balance - tDUST uses 18 decimals
                if (decimal.TryParse(balance.Native, out decimal dustSmallest))
                {
                    // tDUST has 18 decimal places (like ETH wei)
                    decimal tDust = dustSmallest / 1000000000000000000m;
                    balance.NativeFormatted = $"{tDust:F6} tDUST";
                }
                else
                {
                    balance.NativeFormatted = balance.Native;
                }
                
                // Also format unshielded (uses same 18 decimals)
                if (decimal.TryParse(balance.Unshielded, out decimal unshieldedSmallest))
                {
                    decimal unshieldedTDust = unshieldedSmallest / 1000000000m; // 9 decimals for unshielded tDUST
                    balance.Unshielded = $"{unshieldedTDust:F6}";
                }
            }

            return balance;
        }

        private static string ExtractJsonString(string json, string key)
        {
            string pattern = $"\"{key}\":\"";
            int start = json.IndexOf(pattern);
            if (start < 0) return null;
            start += pattern.Length;
            int end = json.IndexOf("\"", start);
            if (end < 0) return null;
            return json.Substring(start, end - start);
        }

        private static int ExtractJsonInt(string json, string key)
        {
            string pattern = $"\"{key}\":";
            int start = json.IndexOf(pattern);
            if (start < 0) return -1;
            start += pattern.Length;
            int end = start;
            while (end < json.Length && (char.IsDigit(json[end]) || json[end] == '-'))
                end++;
            if (end == start) return -1;
            int.TryParse(json.Substring(start, end - start), out int result);
            return result;
        }

        private static bool ExtractJsonBool(string json, string key)
        {
            string patternTrue = $"\"{key}\":true";
            string patternFalse = $"\"{key}\":false";
            if (json.Contains(patternTrue)) return true;
            return false;
        }

        private static CounterResult ParseCounterResult(string json)
        {
            var result = new CounterResult();
            
            if (json.StartsWith("{"))
            {
                result.Success = ExtractJsonBool(json, "success");
                result.Counter = ExtractJsonInt(json, "counter");
                result.TxHash = ExtractJsonString(json, "txHash");
                result.TimedOut = ExtractJsonBool(json, "timedOut");
                result.Error = ExtractJsonString(json, "error");
            }
            
            return result;
        }
    }

    /// <summary>
    /// Internal MonoBehaviour to receive JavaScript callbacks.
    /// </summary>
    public class MidnightSDKCallbackHandler : MonoBehaviour
    {
        private Action _onReady;
        private Action _onNotFound;

        public void SetInitCallbacks(Action onReady, Action onNotFound)
        {
            _onReady = onReady;
            _onNotFound = onNotFound;
        }

        public void InvokeInitCallbacks(bool available)
        {
            if (available)
                _onReady?.Invoke();
            else
                _onNotFound?.Invoke();
        }

        // Called from JavaScript
        public void OnDelayedDetection(string result) => MidnightSDK.HandleDelayedDetection(result);
        public void OnConnectSuccess(string result) => MidnightSDK.HandleConnectSuccess(result);
        public void OnConnectError(string error) => MidnightSDK.HandleConnectError(error);
        public void OnBalanceSuccess(string result) => MidnightSDK.HandleBalanceSuccess(result);
        public void OnBalanceError(string error) => MidnightSDK.HandleBalanceError(error);
        public void OnSendSuccess(string txHash) => MidnightSDK.HandleSendSuccess(txHash);
        public void OnSendError(string error) => MidnightSDK.HandleSendError(error);
        public void OnReadCounterSuccess(string result) => MidnightSDK.HandleReadCounterSuccess(result);
        public void OnReadCounterError(string error) => MidnightSDK.HandleReadCounterError(error);
        public void OnIncrementCounterSuccess(string result) => MidnightSDK.HandleIncrementCounterSuccess(result);
        public void OnIncrementCounterError(string error) => MidnightSDK.HandleIncrementCounterError(error);
    }
}
