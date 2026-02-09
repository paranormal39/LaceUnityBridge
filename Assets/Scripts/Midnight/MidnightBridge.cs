using System;
using System.Runtime.InteropServices;
using UnityEngine;
using UnityEngine.UI;

/// <summary>
/// MidnightBridge - Unity C# bridge for Lace Wallet (Midnight) WebGL integration.
/// 
/// This script handles:
/// - Detecting if Lace wallet is available in the browser
/// - Connecting to Lace wallet
/// - Displaying connection status and shield address
/// 
/// WebGL only - will not work in Editor or native builds.
/// </summary>
public class MidnightBridge : MonoBehaviour
{
    // ============================================================
    // JSLIB External Function Declarations
    // ============================================================
    // These functions are defined in MidnightWebGL.jslib
    // They only work in WebGL builds
    
#if UNITY_WEBGL && !UNITY_EDITOR
    [DllImport("__Internal")]
    private static extern int IsLaceAvailable();

    [DllImport("__Internal")]
    private static extern void ConnectLace(string gameObjectName, string successCallback, string errorCallback);

    [DllImport("__Internal")]
    private static extern int DisconnectLace();

    [DllImport("__Internal")]
    private static extern int IsWalletConnected();

    [DllImport("__Internal")]
    private static extern void DebugLogMidnightObject();

    [DllImport("__Internal")]
    private static extern void IsLaceAvailableDelayed(string gameObjectName, string callback, int delayMs);

    [DllImport("__Internal")]
    private static extern int IsMidnightConnectorAvailable();

    // Transaction functions
    [DllImport("__Internal")]
    private static extern void SignTransaction(string gameObjectName, string successCallback, string errorCallback, string txCbor, int partialSign);

    [DllImport("__Internal")]
    private static extern void SubmitTransaction(string gameObjectName, string successCallback, string errorCallback, string signedTxCbor);

    [DllImport("__Internal")]
    private static extern void SignData(string gameObjectName, string successCallback, string errorCallback, string addressHex, string payloadHex);

    [DllImport("__Internal")]
    private static extern void GetBalance(string gameObjectName, string successCallback, string errorCallback);

    [DllImport("__Internal")]
    private static extern void GetUtxos(string gameObjectName, string successCallback, string errorCallback);

    // Utility functions
    [DllImport("__Internal")]
    private static extern void CopyToClipboard(string text);

    [DllImport("__Internal")]
    private static extern void BuildAndSendTransaction(string gameObjectName, string successCallback, string errorCallback, string recipientAddress, string amountLovelace);

    // Midnight-specific functions
    [DllImport("__Internal")]
    private static extern void MidnightGetWalletState(string gameObjectName, string successCallback, string errorCallback);

    // Counter increment (CardanoBridge with CSL + Blockfrost)
    [DllImport("__Internal")]
    private static extern void CardanoBridge_IncrementCounter(string gameObjectName, string successCallback, string errorCallback, string scriptAddress, string blockfrostKey);
#endif

    // ============================================================
    // UI References
    // ============================================================
    [Header("UI Elements")]
    [Tooltip("Text displaying connection status")]
    public Text statusText;

    [Tooltip("Text displaying the shield address when connected")]
    public Text addressText;

    [Tooltip("Button to initiate wallet connection")]
    public Button connectButton;

    [Tooltip("Text on the connect button")]
    public Text connectButtonText;

    [Tooltip("Button to copy address to clipboard")]
    public Button copyAddressButton;

    [Header("Balance Display")]
    [Tooltip("Text displaying the main balance (tDUST/native)")]
    public Text balanceText;

    [Tooltip("Text displaying the network (mainnet, preprod, preview, testnet)")]
    public Text networkText;

    [Tooltip("Container for the token list items")]
    public Transform tokenListContainer;

    [Tooltip("Prefab for token list item (optional - will create dynamically if null)")]
    public GameObject tokenListItemPrefab;

    [Header("Send Transaction UI")]
    [Tooltip("Input field for recipient address")]
    public InputField recipientInput;

    [Tooltip("Input field for amount in lovelace")]
    public InputField amountInput;

    [Tooltip("Button to send transaction")]
    public Button sendButton;

    [Tooltip("Text displaying transaction status")]
    public Text txStatusText;

    [Header("Status Messages")]
    [SerializeField] private string detectingMessage = "Detecting wallet...";
    [SerializeField] private string walletDetectedMessage = "Lace Detected - Ready to Connect";
    [SerializeField] private string walletNotFoundMessage = "Lace Not Installed";
    [SerializeField] private string connectingMessage = "Connecting...";
    [SerializeField] private string connectedMessage = "Connected";
    [SerializeField] private string disconnectedMessage = "Disconnected";
    [SerializeField] private string editorMessage = "WebGL Only - Run in Browser";

    [Header("Detection Settings")]
    [Tooltip("Use delayed detection (wallet extensions sometimes inject late)")]
    [SerializeField] private bool useDelayedDetection = true;
    [Tooltip("Delay in milliseconds before checking for wallet")]
    [SerializeField] private int detectionDelayMs = 1500;

    // ============================================================
    // State
    // ============================================================
    private bool isLaceAvailable = false;
    private bool isConnected = false;
    private string shieldAddress = "";
    private string walletMode = ""; // "cardano" or "midnight"
    private string networkName = ""; // "mainnet", "preprod", "preview", "testnet"
    private int networkId = -1;
    private string nativeBalance = "0";
    private System.Collections.Generic.Dictionary<string, string> tokenBalances = new System.Collections.Generic.Dictionary<string, string>();

    // ============================================================
    // Unity Lifecycle
    // ============================================================

    private void Start()
    {
        // Initialize UI
        if (addressText != null)
        {
            addressText.text = "";
        }

        // Check for Lace wallet on start
        CheckWalletAvailability();
    }

    // ============================================================
    // Public Methods (called from UI)
    // ============================================================

    /// <summary>
    /// Check if Lace wallet is available in the browser.
    /// Called automatically on Start, but can be called manually to refresh.
    /// </summary>
    public void CheckWalletAvailability()
    {
        SetStatus(detectingMessage);

#if UNITY_WEBGL && !UNITY_EDITOR
        // First, log debug info to browser console
        Debug.Log("[MidnightBridge] Checking wallet availability...");
        DebugLogMidnightObject();

        // Try immediate detection first
        isLaceAvailable = IsLaceAvailable() == 1;
        
        if (isLaceAvailable)
        {
            SetStatus(walletDetectedMessage);
            SetConnectButtonEnabled(true);
            Debug.Log("[MidnightBridge] Lace wallet detected (immediate)");
        }
        else if (useDelayedDetection)
        {
            // Wallet extensions sometimes inject after page load
            // Try again with a delay
            Debug.Log($"[MidnightBridge] Wallet not found immediately, trying delayed detection ({detectionDelayMs}ms)...");
            SetStatus("Detecting wallet (waiting for extension)...");
            IsLaceAvailableDelayed(gameObject.name, "OnDelayedDetectionResult", detectionDelayMs);
        }
        else
        {
            SetStatus(walletNotFoundMessage);
            SetConnectButtonEnabled(false);
            Debug.LogWarning("[MidnightBridge] Lace wallet not found");
        }
#else
        // In Editor, show a message that this only works in WebGL
        SetStatus(editorMessage);
        SetConnectButtonEnabled(false);
        Debug.Log("[MidnightBridge] Running in Editor - WebGL features disabled");
#endif
    }

    /// <summary>
    /// Callback from JavaScript for delayed wallet detection.
    /// </summary>
    /// <param name="result">"1" if wallet found, "0" if not</param>
    public void OnDelayedDetectionResult(string result)
    {
        isLaceAvailable = result == "1";
        
        if (isLaceAvailable)
        {
            SetStatus(walletDetectedMessage);
            SetConnectButtonEnabled(true);
            Debug.Log("[MidnightBridge] Lace wallet detected (delayed)");
        }
        else
        {
            SetStatus(walletNotFoundMessage);
            SetConnectButtonEnabled(false);
            Debug.LogWarning("[MidnightBridge] Lace wallet not found after delayed check. Check browser console for debug info.");
#if UNITY_WEBGL && !UNITY_EDITOR
            // Log debug info again after delay
            DebugLogMidnightObject();
#endif
        }
    }

    /// <summary>
    /// Manually trigger debug logging of window.midnight object.
    /// Call this from a UI button for troubleshooting.
    /// </summary>
    public void DebugLogWalletInfo()
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        Debug.Log("[MidnightBridge] Manual debug log triggered");
        DebugLogMidnightObject();
#else
        Debug.Log("[MidnightBridge] Debug logging only works in WebGL builds");
#endif
    }

    /// <summary>
    /// Initiate connection to Lace wallet.
    /// Called from the Connect button.
    /// </summary>
    public void OnConnectButtonClicked()
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        if (!isLaceAvailable)
        {
            SetStatus(walletNotFoundMessage);
            Debug.LogWarning("[MidnightBridge] Cannot connect - Lace not available");
            return;
        }

        if (isConnected)
        {
            // Already connected - disconnect
            Disconnect();
            return;
        }

        // Start connection process
        SetStatus(connectingMessage);
        SetConnectButtonEnabled(false);
        
        Debug.Log("[MidnightBridge] Initiating Lace connection...");
        
        // Call the JavaScript function
        // Pass this GameObject's name so JS can call back to us
        ConnectLace(gameObject.name, "OnConnectionSuccess", "OnConnectionError");
#else
        Debug.Log("[MidnightBridge] Connect clicked (Editor mode - no action)");
        SetStatus(editorMessage);
#endif
    }

    /// <summary>
    /// Disconnect from the wallet.
    /// </summary>
    public void Disconnect()
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        DisconnectLace();
#endif
        isConnected = false;
        shieldAddress = "";
        
        if (addressText != null)
        {
            addressText.text = "";
        }
        
        SetStatus(disconnectedMessage);
        UpdateConnectButtonText();
        SetConnectButtonEnabled(true);
        
        Debug.Log("[MidnightBridge] Disconnected from wallet");
    }

    // ============================================================
    // JavaScript Callbacks
    // ============================================================
    // These methods are called from JavaScript via SendMessage

    /// <summary>
    /// Called from JavaScript when wallet connection succeeds.
    /// </summary>
    /// <param name="resultJson">JSON containing address and mode</param>
    public void OnConnectionSuccess(string resultJson)
    {
        isConnected = true;
        
        // Parse JSON response: { "address": "...", "mode": "cardano" or "midnight", "network": "...", "networkId": N }
        string address = resultJson;
        string mode = "unknown";
        string network = "unknown";
        int netId = -1;
        
        try
        {
            // Simple JSON parsing without external dependencies
            if (resultJson.StartsWith("{"))
            {
                // Extract address
                int addrStart = resultJson.IndexOf("\"address\":\"") + 11;
                int addrEnd = resultJson.IndexOf("\"", addrStart);
                if (addrStart > 10 && addrEnd > addrStart)
                {
                    address = resultJson.Substring(addrStart, addrEnd - addrStart);
                }
                
                // Extract mode
                int modeStart = resultJson.IndexOf("\"mode\":\"") + 8;
                int modeEnd = resultJson.IndexOf("\"", modeStart);
                if (modeStart > 7 && modeEnd > modeStart)
                {
                    mode = resultJson.Substring(modeStart, modeEnd - modeStart);
                }
                
                // Extract network name
                int networkStart = resultJson.IndexOf("\"network\":\"") + 11;
                int networkEnd = resultJson.IndexOf("\"", networkStart);
                if (networkStart > 10 && networkEnd > networkStart)
                {
                    network = resultJson.Substring(networkStart, networkEnd - networkStart);
                }
                
                // Extract networkId (number, not string)
                int netIdStart = resultJson.IndexOf("\"networkId\":") + 12;
                if (netIdStart > 11)
                {
                    int netIdEnd = netIdStart;
                    while (netIdEnd < resultJson.Length && (char.IsDigit(resultJson[netIdEnd]) || resultJson[netIdEnd] == '-'))
                        netIdEnd++;
                    if (netIdEnd > netIdStart)
                    {
                        int.TryParse(resultJson.Substring(netIdStart, netIdEnd - netIdStart), out netId);
                    }
                }
            }
        }
        catch (System.Exception e)
        {
            Debug.LogWarning($"[MidnightBridge] Failed to parse connection result: {e.Message}");
        }
        
        shieldAddress = address;
        walletMode = mode;
        networkName = network;
        networkId = netId;
        
        // Update status to show which API mode is active
        string modeDisplay = mode == "midnight" ? "Midnight" : "Cardano";
        SetStatus($"Connected ({modeDisplay})");
        
        if (addressText != null)
        {
            // Display truncated address for readability
            addressText.text = TruncateAddress(address);
        }
        
        // Update network display
        UpdateNetworkDisplay();
        
        UpdateConnectButtonText();
        SetConnectButtonEnabled(true);
        SetSendUIEnabled(true);
        
        // Show warning if using Cardano API instead of Midnight
        if (mode == "cardano")
        {
            SetTxStatus("Cardano mode - use Lace UI for Midnight");
            Debug.LogWarning("[MidnightBridge] Connected via Cardano API. For Midnight tDUST, enable Midnight mode in Lace.");
        }
        
        Debug.Log($"[MidnightBridge] Connected via {modeDisplay} API on {network}! Address: {address}");
        
        // Fetch wallet balance after connection
        RefreshWalletBalance();
    }

    /// <summary>
    /// Called from JavaScript when wallet connection fails.
    /// </summary>
    /// <param name="errorMessage">Error message describing what went wrong</param>
    public void OnConnectionError(string errorMessage)
    {
        isConnected = false;
        shieldAddress = "";
        
        SetStatus($"Error: {errorMessage}");
        
        if (addressText != null)
        {
            addressText.text = "";
        }
        
        SetConnectButtonEnabled(true);
        SetSendUIEnabled(false);
        
        Debug.LogError($"[MidnightBridge] Connection error: {errorMessage}");
    }

    // ============================================================
    // Helper Methods
    // ============================================================

    private void SetStatus(string message)
    {
        if (statusText != null)
        {
            statusText.text = message;
        }
    }

    private void SetConnectButtonEnabled(bool enabled)
    {
        if (connectButton != null)
        {
            connectButton.interactable = enabled;
        }
    }

    private void UpdateConnectButtonText()
    {
        if (connectButtonText != null)
        {
            connectButtonText.text = isConnected ? "Disconnect" : "Connect Lace";
        }
    }

    /// <summary>
    /// Truncates a long address for display purposes.
    /// Example: "addr1qxy...z9k3" 
    /// </summary>
    private string TruncateAddress(string address)
    {
        if (string.IsNullOrEmpty(address) || address.Length <= 20)
        {
            return address;
        }
        
        return $"{address.Substring(0, 10)}...{address.Substring(address.Length - 8)}";
    }

    private void SetSendUIEnabled(bool enabled)
    {
        if (copyAddressButton != null) copyAddressButton.interactable = enabled;
        if (recipientInput != null) recipientInput.interactable = enabled;
        if (amountInput != null) amountInput.interactable = enabled;
        if (sendButton != null) sendButton.interactable = enabled;
    }

    private void SetTxStatus(string message)
    {
        if (txStatusText != null)
        {
            txStatusText.text = message;
        }
    }

    /// <summary>
    /// Update the network display UI element.
    /// </summary>
    private void UpdateNetworkDisplay()
    {
        if (networkText == null)
        {
            Debug.LogWarning("[MidnightBridge] networkText UI reference is null");
            return;
        }
        
        // Format network name for display
        string displayName = networkName;
        Color networkColor = Color.white;
        
        switch (networkName.ToLower())
        {
            case "mainnet":
                displayName = "Mainnet";
                networkColor = new Color(0.2f, 0.8f, 0.2f); // Green
                break;
            case "preprod":
                displayName = "Pre-Production";
                networkColor = new Color(1f, 0.6f, 0.2f); // Orange
                break;
            case "preview":
                displayName = "Preview";
                networkColor = new Color(0.6f, 0.4f, 1f); // Purple
                break;
            case "testnet":
                displayName = "Testnet";
                networkColor = new Color(1f, 0.8f, 0.2f); // Yellow
                break;
            default:
                displayName = networkName;
                networkColor = new Color(0.7f, 0.7f, 0.7f); // Gray
                break;
        }
        
        networkText.text = $"Network: {displayName}";
        networkText.color = networkColor;
        
        Debug.Log($"[MidnightBridge] Network display updated: {displayName}");
    }

    // ============================================================
    // Balance Display Methods
    // ============================================================

    /// <summary>
    /// Refresh wallet balance from the connected wallet.
    /// </summary>
    public void RefreshWalletBalance()
    {
        Debug.Log($"[MidnightBridge] RefreshWalletBalance called. isConnected={isConnected}, walletMode={walletMode}");
        
#if UNITY_WEBGL && !UNITY_EDITOR
        if (!isConnected)
        {
            Debug.LogWarning("[MidnightBridge] Cannot refresh balance - not connected");
            SetBalanceText("Not connected");
            return;
        }

        if (walletMode == "midnight")
        {
            Debug.Log($"[MidnightBridge] Calling MidnightGetWalletState on GameObject: {gameObject.name}");
            MidnightGetWalletState(gameObject.name, "OnWalletStateSuccess", "OnWalletStateError");
        }
        else
        {
            Debug.Log($"[MidnightBridge] Calling GetBalance (Cardano) on GameObject: {gameObject.name}");
            GetBalance(gameObject.name, "OnGetBalanceSuccess", "OnGetBalanceError");
        }
#else
        Debug.Log("[MidnightBridge] RefreshWalletBalance only works in WebGL builds");
        SetBalanceText("Editor mode");
#endif
    }

    /// <summary>
    /// Called from JavaScript when Midnight wallet state is received.
    /// </summary>
    public void OnWalletStateSuccess(string stateJson)
    {
        Debug.Log($"[MidnightBridge] Wallet state received: {stateJson}");
        
        try
        {
            // Parse JSON: { "address": "...", "balances": { "native": "123", "tokenId": "456" } }
            tokenBalances.Clear();
            nativeBalance = "0";
            
            if (stateJson.StartsWith("{"))
            {
                // Extract balances object
                int balancesStart = stateJson.IndexOf("\"balances\":{");
                if (balancesStart >= 0)
                {
                    balancesStart += 11; // Move past "balances":{
                    int balancesEnd = stateJson.IndexOf("}", balancesStart);
                    if (balancesEnd > balancesStart)
                    {
                        string balancesStr = stateJson.Substring(balancesStart, balancesEnd - balancesStart);
                        ParseBalances(balancesStr);
                    }
                }
            }
            
            UpdateBalanceUI();
        }
        catch (System.Exception e)
        {
            Debug.LogWarning($"[MidnightBridge] Failed to parse wallet state: {e.Message}");
        }
    }

    /// <summary>
    /// Called from JavaScript when Midnight wallet state fetch fails.
    /// </summary>
    public void OnWalletStateError(string error)
    {
        Debug.LogError($"[MidnightBridge] Wallet state error: {error}");
        SetBalanceText("Balance: Error");
    }

    /// <summary>
    /// Called from JavaScript when Cardano balance is received.
    /// Now receives JSON: { "address": "", "balances": { "lovelace": "amount", "policyId.assetName": "amount" } }
    /// </summary>
    public void OnGetBalanceSuccess(string balanceJson)
    {
        Debug.Log($"[MidnightBridge] Cardano balance received: {balanceJson}");
        
        try
        {
            tokenBalances.Clear();
            nativeBalance = "0";
            
            // Check if it's JSON format (new) or raw value (legacy)
            if (balanceJson.StartsWith("{"))
            {
                // New JSON format with balances object
                int balancesStart = balanceJson.IndexOf("\"balances\":{");
                if (balancesStart >= 0)
                {
                    balancesStart += 11; // Move past "balances":{
                    int balancesEnd = FindMatchingBrace(balanceJson, balancesStart);
                    if (balancesEnd > balancesStart)
                    {
                        string balancesStr = balanceJson.Substring(balancesStart, balancesEnd - balancesStart);
                        ParseCardanoBalances(balancesStr);
                    }
                }
            }
            else if (long.TryParse(balanceJson, out long balance))
            {
                // Legacy: simple number
                nativeBalance = balance.ToString();
                tokenBalances["lovelace"] = nativeBalance;
            }
            else
            {
                // Legacy: raw hex - just store it
                nativeBalance = balanceJson;
            }
            
            UpdateBalanceUI();
            
            // Invoke event for backward compatibility
            OnBalanceReceived?.Invoke(balanceJson);
        }
        catch (System.Exception e)
        {
            Debug.LogWarning($"[MidnightBridge] Failed to parse Cardano balance: {e.Message}");
            SetBalanceText("Balance: Parse Error");
        }
    }
    
    /// <summary>
    /// Find the matching closing brace for a JSON object.
    /// </summary>
    private int FindMatchingBrace(string json, int startIndex)
    {
        int depth = 1;
        for (int i = startIndex; i < json.Length; i++)
        {
            if (json[i] == '{') depth++;
            else if (json[i] == '}') depth--;
            
            if (depth == 0) return i;
        }
        return json.Length;
    }
    
    /// <summary>
    /// Parse Cardano balance entries from JSON substring.
    /// Handles "lovelace" as native and "policyId.assetName" as tokens.
    /// </summary>
    private void ParseCardanoBalances(string balancesStr)
    {
        // Simple parsing for "key":"value" pairs
        int pos = 0;
        while (pos < balancesStr.Length)
        {
            // Find key
            int keyStart = balancesStr.IndexOf("\"", pos);
            if (keyStart < 0) break;
            keyStart++;
            
            int keyEnd = balancesStr.IndexOf("\"", keyStart);
            if (keyEnd < 0) break;
            
            string key = balancesStr.Substring(keyStart, keyEnd - keyStart);
            
            // Find value (could be string or number)
            int colonPos = balancesStr.IndexOf(":", keyEnd);
            if (colonPos < 0) break;
            
            // Skip whitespace after colon
            int valueStart = colonPos + 1;
            while (valueStart < balancesStr.Length && char.IsWhiteSpace(balancesStr[valueStart]))
                valueStart++;
            
            string value;
            if (valueStart < balancesStr.Length && balancesStr[valueStart] == '"')
            {
                // String value
                valueStart++;
                int valueEnd = balancesStr.IndexOf("\"", valueStart);
                if (valueEnd < 0) break;
                value = balancesStr.Substring(valueStart, valueEnd - valueStart);
                pos = valueEnd + 1;
            }
            else
            {
                // Number value - find end (comma or closing brace)
                int valueEnd = valueStart;
                while (valueEnd < balancesStr.Length && 
                       balancesStr[valueEnd] != ',' && 
                       balancesStr[valueEnd] != '}')
                    valueEnd++;
                value = balancesStr.Substring(valueStart, valueEnd - valueStart).Trim();
                pos = valueEnd;
            }
            
            // Skip internal keys like _note, _raw
            if (key.StartsWith("_")) continue;
            
            // Store balance
            if (key == "lovelace")
            {
                nativeBalance = value;
            }
            tokenBalances[key] = value;
            
            pos++;
        }
        
        Debug.Log($"[MidnightBridge] Parsed {tokenBalances.Count} Cardano balances. Lovelace: {nativeBalance}");
    }

    /// <summary>
    /// Called from JavaScript when Cardano balance fetch fails.
    /// </summary>
    public void OnGetBalanceError(string error)
    {
        Debug.LogError($"[MidnightBridge] Get balance error: {error}");
        SetBalanceText("Balance: Error");
        OnTransactionError?.Invoke(error);
    }

    /// <summary>
    /// Parse balance entries from JSON substring.
    /// </summary>
    private void ParseBalances(string balancesStr)
    {
        // Simple parsing for "key":"value" pairs
        int pos = 0;
        while (pos < balancesStr.Length)
        {
            // Find key
            int keyStart = balancesStr.IndexOf("\"", pos);
            if (keyStart < 0) break;
            keyStart++;
            
            int keyEnd = balancesStr.IndexOf("\"", keyStart);
            if (keyEnd < 0) break;
            
            string key = balancesStr.Substring(keyStart, keyEnd - keyStart);
            
            // Find value
            int valueStart = balancesStr.IndexOf("\"", keyEnd + 1);
            if (valueStart < 0) break;
            valueStart++;
            
            int valueEnd = balancesStr.IndexOf("\"", valueStart);
            if (valueEnd < 0) break;
            
            string value = balancesStr.Substring(valueStart, valueEnd - valueStart);
            
            // Store balance
            if (key == "native" || key == "tDUST")
            {
                nativeBalance = value;
            }
            tokenBalances[key] = value;
            
            pos = valueEnd + 1;
        }
        
        Debug.Log($"[MidnightBridge] Parsed {tokenBalances.Count} token balances. Native: {nativeBalance}");
    }

    /// <summary>
    /// Update the balance UI elements.
    /// </summary>
    private void UpdateBalanceUI()
    {
        Debug.Log($"[MidnightBridge] UpdateBalanceUI called. nativeBalance={nativeBalance}, walletMode={walletMode}, tokenCount={tokenBalances.Count}");
        
        // Update main balance text
        string formattedBalance = FormatBalance(nativeBalance);
        string tokenName = walletMode == "midnight" ? "tDUST" : "ADA";
        string displayText = $"{formattedBalance} {tokenName}";
        
        Debug.Log($"[MidnightBridge] Setting balance text to: {displayText}");
        SetBalanceText(displayText);
        
        // Update token list
        Debug.Log($"[MidnightBridge] Updating token list with {tokenBalances.Count} tokens");
        UpdateTokenList();
    }

    /// <summary>
    /// Format a balance value for display (convert from smallest unit).
    /// </summary>
    private string FormatBalance(string rawBalance)
    {
        if (string.IsNullOrEmpty(rawBalance)) return "0";
        
        if (long.TryParse(rawBalance, out long balance))
        {
            // Midnight uses 10^6 for tDUST, Cardano uses 10^6 for lovelace
            double displayBalance = balance / 1000000.0;
            return displayBalance.ToString("N6");
        }
        
        return rawBalance;
    }

    /// <summary>
    /// Set the balance text display.
    /// </summary>
    private void SetBalanceText(string text)
    {
        Debug.Log($"[MidnightBridge] SetBalanceText: '{text}', balanceText is {(balanceText != null ? "assigned" : "NULL")}");
        
        if (balanceText != null)
        {
            balanceText.text = text;
            Debug.Log($"[MidnightBridge] Balance text updated successfully");
        }
        else
        {
            Debug.LogWarning("[MidnightBridge] balanceText UI reference is null! Cannot display balance.");
        }
    }

    /// <summary>
    /// Update the token list UI with all token balances.
    /// </summary>
    private void UpdateTokenList()
    {
        if (tokenListContainer == null) return;
        
        // Clear existing items (skip the title which is the first child)
        for (int i = tokenListContainer.childCount - 1; i >= 1; i--)
        {
            Destroy(tokenListContainer.GetChild(i).gameObject);
        }
        
        // Add token items (skip native tokens since they're shown in main balance)
        foreach (var kvp in tokenBalances)
        {
            // Skip native balance keys
            if (kvp.Key == "native" || kvp.Key == "tDUST" || kvp.Key == "lovelace") continue;
            
            CreateTokenListItem(kvp.Key, kvp.Value);
        }
    }

    /// <summary>
    /// Create a token list item UI element.
    /// </summary>
    private void CreateTokenListItem(string tokenId, string balance)
    {
        if (tokenListContainer == null) return;
        
        GameObject item;
        if (tokenListItemPrefab != null)
        {
            item = Instantiate(tokenListItemPrefab, tokenListContainer);
        }
        else
        {
            // Create dynamically
            item = new GameObject($"Token_{tokenId}");
            item.transform.SetParent(tokenListContainer, false);
            
            Text text = item.AddComponent<Text>();
            text.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            text.fontSize = 14;
            text.color = Color.white;
            text.alignment = TextAnchor.MiddleLeft;
            
            RectTransform rect = item.GetComponent<RectTransform>();
            rect.sizeDelta = new Vector2(200, 25);
        }
        
        // Set text
        Text itemText = item.GetComponentInChildren<Text>();
        if (itemText != null)
        {
            string truncatedId = tokenId.Length > 12 ? tokenId.Substring(0, 6) + "..." + tokenId.Substring(tokenId.Length - 4) : tokenId;
            string formattedBalance = FormatBalance(balance);
            itemText.text = $"{truncatedId}: {formattedBalance}";
        }
    }

    // ============================================================
    // Copy Address & Send Transaction UI Handlers
    // ============================================================

    /// <summary>
    /// Called when Copy button is clicked. Copies full address to clipboard.
    /// </summary>
    public void OnCopyAddressClicked()
    {
        if (string.IsNullOrEmpty(shieldAddress))
        {
            Debug.LogWarning("[MidnightBridge] No address to copy");
            return;
        }

#if UNITY_WEBGL && !UNITY_EDITOR
        // Use JavaScript to copy to clipboard in WebGL
        CopyToClipboard(shieldAddress);
#else
        GUIUtility.systemCopyBuffer = shieldAddress;
#endif
        SetTxStatus("Address copied!");
        Debug.Log($"[MidnightBridge] Address copied to clipboard: {shieldAddress}");
        
        // Clear the status after a delay
        Invoke(nameof(ClearTxStatus), 2f);
    }

    private void ClearTxStatus()
    {
        SetTxStatus("");
    }

    /// <summary>
    /// Called when Send button is clicked. Initiates a transaction.
    /// </summary>
    public void OnSendButtonClicked()
    {
        if (!isConnected)
        {
            SetTxStatus("Not connected!");
            return;
        }

        string recipient = recipientInput != null ? recipientInput.text.Trim() : "";
        string amountStr = amountInput != null ? amountInput.text.Trim() : "";

        if (string.IsNullOrEmpty(recipient))
        {
            SetTxStatus("Enter recipient address");
            return;
        }

        if (string.IsNullOrEmpty(amountStr))
        {
            SetTxStatus("Enter amount");
            return;
        }

        if (!long.TryParse(amountStr, out long amountLovelace) || amountLovelace <= 0)
        {
            SetTxStatus("Invalid amount");
            return;
        }

        Debug.Log($"[MidnightBridge] Sending {amountLovelace} lovelace to {recipient}");
        SetTxStatus("Building transaction...");
        SetSendUIEnabled(false);

#if UNITY_WEBGL && !UNITY_EDITOR
        // Call JavaScript to build and sign transaction
        BuildAndSendTransaction(gameObject.name, "OnBuildTxSuccess", "OnBuildTxError", recipient, amountLovelace.ToString());
#else
        SetTxStatus("WebGL only");
        SetSendUIEnabled(true);
#endif
    }

    // ============================================================
    // Public Getters (for other scripts to access state)
    // ============================================================

    /// <summary>
    /// Returns true if Lace wallet is available in the browser.
    /// </summary>
    public bool IsWalletAvailable => isLaceAvailable;

    /// <summary>
    /// Returns true if currently connected to wallet.
    /// </summary>
    public bool IsConnectedToWallet => isConnected;

    /// <summary>
    /// Returns the wallet API mode: "cardano" or "midnight".
    /// Use this to determine which features are available.
    /// </summary>
    public string WalletMode => walletMode;

    /// <summary>
    /// Returns true if connected via Midnight API (has tDUST support).
    /// </summary>
    public bool IsMidnightMode => walletMode == "midnight";

    /// <summary>
    /// Returns the shield address if connected, empty string otherwise.
    /// </summary>
    public string ShieldAddress => shieldAddress;

    // ============================================================
    // Transaction Methods
    // ============================================================

    /// <summary>
    /// Event fired when a transaction is signed successfully.
    /// Parameter is the signed transaction CBOR (hex).
    /// </summary>
    public event Action<string> OnTransactionSigned;

    /// <summary>
    /// Event fired when a transaction is submitted successfully.
    /// Parameter is the transaction hash.
    /// </summary>
    public event Action<string> OnTransactionSubmitted;

    /// <summary>
    /// Event fired when data is signed successfully.
    /// Parameter is the signature JSON.
    /// </summary>
    public event Action<string> OnDataSigned;

    /// <summary>
    /// Event fired when balance is retrieved.
    /// Parameter is the balance (hex-encoded CBOR).
    /// </summary>
    public event Action<string> OnBalanceReceived;

    /// <summary>
    /// Event fired when UTXOs are retrieved.
    /// Parameter is the UTXOs JSON array.
    /// </summary>
    public event Action<string> OnUtxosReceived;

    /// <summary>
    /// Event fired on any transaction error.
    /// Parameter is the error message.
    /// </summary>
    public event Action<string> OnTransactionError;

    /// <summary>
    /// Sign a transaction with the connected wallet.
    /// </summary>
    /// <param name="txCbor">Hex-encoded CBOR transaction to sign</param>
    /// <param name="partialSign">Allow partial signing (for multi-sig)</param>
    public void RequestSignTransaction(string txCbor, bool partialSign = false)
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        if (!isConnected)
        {
            Debug.LogError("[MidnightBridge] Cannot sign - not connected");
            OnTransactionError?.Invoke("Wallet not connected");
            return;
        }
        Debug.Log("[MidnightBridge] Requesting transaction signature...");
        SignTransaction(gameObject.name, "OnSignTransactionSuccess", "OnSignTransactionError", txCbor, partialSign ? 1 : 0);
#else
        Debug.Log("[MidnightBridge] SignTransaction only works in WebGL builds");
        OnTransactionError?.Invoke("WebGL only");
#endif
    }

    /// <summary>
    /// Submit a signed transaction to the network.
    /// </summary>
    /// <param name="signedTxCbor">Hex-encoded CBOR of signed transaction</param>
    public void RequestSubmitTransaction(string signedTxCbor)
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        if (!isConnected)
        {
            Debug.LogError("[MidnightBridge] Cannot submit - not connected");
            OnTransactionError?.Invoke("Wallet not connected");
            return;
        }
        Debug.Log("[MidnightBridge] Submitting transaction...");
        SubmitTransaction(gameObject.name, "OnSubmitTransactionSuccess", "OnSubmitTransactionError", signedTxCbor);
#else
        Debug.Log("[MidnightBridge] SubmitTransaction only works in WebGL builds");
        OnTransactionError?.Invoke("WebGL only");
#endif
    }

    /// <summary>
    /// Sign arbitrary data with the wallet (for authentication).
    /// </summary>
    /// <param name="addressHex">Hex-encoded address to sign with</param>
    /// <param name="payloadHex">Hex-encoded data to sign</param>
    public void RequestSignData(string addressHex, string payloadHex)
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        if (!isConnected)
        {
            Debug.LogError("[MidnightBridge] Cannot sign data - not connected");
            OnTransactionError?.Invoke("Wallet not connected");
            return;
        }
        Debug.Log("[MidnightBridge] Requesting data signature...");
        SignData(gameObject.name, "OnSignDataSuccess", "OnSignDataError", addressHex, payloadHex);
#else
        Debug.Log("[MidnightBridge] SignData only works in WebGL builds");
        OnTransactionError?.Invoke("WebGL only");
#endif
    }

    /// <summary>
    /// Get the wallet balance.
    /// </summary>
    public void RequestBalance()
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        if (!isConnected)
        {
            Debug.LogError("[MidnightBridge] Cannot get balance - not connected");
            OnTransactionError?.Invoke("Wallet not connected");
            return;
        }
        Debug.Log("[MidnightBridge] Requesting balance...");
        GetBalance(gameObject.name, "OnGetBalanceSuccess", "OnGetBalanceError");
#else
        Debug.Log("[MidnightBridge] GetBalance only works in WebGL builds");
        OnTransactionError?.Invoke("WebGL only");
#endif
    }

    /// <summary>
    /// Get the wallet's UTXOs.
    /// </summary>
    public void RequestUtxos()
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        if (!isConnected)
        {
            Debug.LogError("[MidnightBridge] Cannot get UTXOs - not connected");
            OnTransactionError?.Invoke("Wallet not connected");
            return;
        }
        Debug.Log("[MidnightBridge] Requesting UTXOs...");
        GetUtxos(gameObject.name, "OnGetUtxosSuccess", "OnGetUtxosError");
#else
        Debug.Log("[MidnightBridge] GetUtxos only works in WebGL builds");
        OnTransactionError?.Invoke("WebGL only");
#endif
    }

    // ============================================================
    // Transaction Callbacks (called from JavaScript)
    // ============================================================

    public void OnSignTransactionSuccess(string signedTx)
    {
        Debug.Log($"[MidnightBridge] Transaction signed successfully");
        OnTransactionSigned?.Invoke(signedTx);
    }

    public void OnSignTransactionError(string error)
    {
        Debug.LogError($"[MidnightBridge] Sign transaction error: {error}");
        OnTransactionError?.Invoke(error);
    }

    public void OnSubmitTransactionSuccess(string txHash)
    {
        Debug.Log($"[MidnightBridge] Transaction submitted! Hash: {txHash}");
        OnTransactionSubmitted?.Invoke(txHash);
    }

    public void OnSubmitTransactionError(string error)
    {
        Debug.LogError($"[MidnightBridge] Submit transaction error: {error}");
        OnTransactionError?.Invoke(error);
    }

    public void OnSignDataSuccess(string signatureJson)
    {
        Debug.Log($"[MidnightBridge] Data signed successfully");
        OnDataSigned?.Invoke(signatureJson);
    }

    public void OnSignDataError(string error)
    {
        Debug.LogError($"[MidnightBridge] Sign data error: {error}");
        OnTransactionError?.Invoke(error);
    }

    public void OnGetUtxosSuccess(string utxosJson)
    {
        Debug.Log($"[MidnightBridge] UTXOs received");
        OnUtxosReceived?.Invoke(utxosJson);
    }

    public void OnGetUtxosError(string error)
    {
        Debug.LogError($"[MidnightBridge] Get UTXOs error: {error}");
        OnTransactionError?.Invoke(error);
    }

    // Build and Send Transaction callbacks (for UI send button)
    public void OnBuildTxSuccess(string txHash)
    {
        Debug.Log($"[MidnightBridge] Transaction sent! Hash: {txHash}");
        SetTxStatus($"Sent! Tx: {txHash.Substring(0, 16)}...");
        SetSendUIEnabled(true);
        
        // Clear inputs after successful send
        if (recipientInput != null) recipientInput.text = "";
        if (amountInput != null) amountInput.text = "";
        
        OnTransactionSubmitted?.Invoke(txHash);
    }

    public void OnBuildTxError(string error)
    {
        Debug.LogError($"[MidnightBridge] Send transaction error: {error}");
        SetTxStatus($"Error: {error}");
        SetSendUIEnabled(true);
        OnTransactionError?.Invoke(error);
    }

    // ============================================================
    // Counter Increment (CardanoBridge - pure CSL)
    // ============================================================

    /// <summary>
    /// Event fired when counter increment transaction is submitted.
    /// Parameter is the transaction hash.
    /// </summary>
    public event Action<string> OnCounterIncremented;

    /// <summary>
    /// Event fired when counter increment succeeds with full result.
    /// Parameter is JSON: { txHash, oldValue, newValue }
    /// </summary>
    public event Action<string, string, string> OnCounterIncrementedWithValues;

    /// <summary>
    /// Increment the Aiken counter smart contract.
    /// Uses CardanoBridge with MeshSDK + Blockfrost to build the transaction.
    /// </summary>
    /// <param name="scriptAddress">Bech32 script address of the counter</param>
    /// <param name="blockfrostKey">Blockfrost API key for Preprod</param>
    public void IncrementCounter(string scriptAddress, string blockfrostKey)
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        if (!isConnected)
        {
            Debug.LogError("[MidnightBridge] Cannot increment counter - not connected");
            SetTxStatus("Connect wallet first");
            OnTransactionError?.Invoke("Wallet not connected");
            return;
        }

        if (string.IsNullOrEmpty(scriptAddress))
        {
            Debug.LogError("[MidnightBridge] Script address is required");
            SetTxStatus("Script address missing");
            OnTransactionError?.Invoke("Script address is required");
            return;
        }

        if (string.IsNullOrEmpty(blockfrostKey))
        {
            Debug.LogError("[MidnightBridge] Blockfrost key is required");
            SetTxStatus("Blockfrost key missing");
            OnTransactionError?.Invoke("Blockfrost key is required");
            return;
        }

        Debug.Log($"[MidnightBridge] Incrementing counter at {scriptAddress}");
        SetTxStatus("Building transaction...");

        CardanoBridge_IncrementCounter(
            gameObject.name,
            "OnIncrementCounterSuccess",
            "OnIncrementCounterError",
            scriptAddress,
            blockfrostKey
        );
#else
        Debug.Log("[MidnightBridge] IncrementCounter only works in WebGL builds");
        SetTxStatus("WebGL only");
        OnTransactionError?.Invoke("WebGL only");
#endif
    }

    /// <summary>
    /// Callback when counter increment succeeds.
    /// Receives JSON: { txHash, oldValue, newValue }
    /// </summary>
    public void OnIncrementCounterSuccess(string resultJson)
    {
        Debug.Log($"[MidnightBridge] Counter incremented! Result: {resultJson}");
        
        // Parse JSON result
        string txHash = "";
        string oldValue = "0";
        string newValue = "0";
        
        try
        {
            // Simple JSON parsing without external dependencies
            if (resultJson.Contains("txHash"))
            {
                int start = resultJson.IndexOf("\"txHash\":\"") + 10;
                int end = resultJson.IndexOf("\"", start);
                if (start > 9 && end > start)
                    txHash = resultJson.Substring(start, end - start);
            }
            if (resultJson.Contains("oldValue"))
            {
                int start = resultJson.IndexOf("\"oldValue\":\"") + 12;
                int end = resultJson.IndexOf("\"", start);
                if (start > 11 && end > start)
                    oldValue = resultJson.Substring(start, end - start);
            }
            if (resultJson.Contains("newValue"))
            {
                int start = resultJson.IndexOf("\"newValue\":\"") + 12;
                int end = resultJson.IndexOf("\"", start);
                if (start > 11 && end > start)
                    newValue = resultJson.Substring(start, end - start);
            }
        }
        catch (System.Exception e)
        {
            Debug.LogWarning($"[MidnightBridge] Failed to parse result JSON: {e.Message}");
            txHash = resultJson; // Fallback to treating whole string as txHash
        }

        string shortTx = txHash.Length > 8 ? txHash.Substring(0, 8) + "..." : txHash;
        SetTxStatus($"Incremented! {oldValue} → {newValue} (Tx: {shortTx})");
        
        OnCounterIncremented?.Invoke(txHash);
        OnCounterIncrementedWithValues?.Invoke(txHash, oldValue, newValue);
        OnTransactionSubmitted?.Invoke(txHash);
    }

    /// <summary>
    /// Callback when counter increment fails.
    /// </summary>
    public void OnIncrementCounterError(string error)
    {
        Debug.LogError($"[MidnightBridge] Increment counter error: {error}");
        SetTxStatus($"Error: {error}");
        OnTransactionError?.Invoke(error);
    }
}
