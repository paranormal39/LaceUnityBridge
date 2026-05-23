using System;
using System.Runtime.InteropServices;
using UnityEngine;
using UnityEngine.UI;

/// <summary>
/// MidnightDiagnostics - Diagnostic tools for Midnight Preprod connection.
/// 
/// This script provides:
/// - Diagnostic connect to Midnight Preprod via window.midnight.mnLace
/// - Display of wallet info, shielded address, and configuration
/// - Contract join/read/increment operations
/// 
/// IMPORTANT: This is SEPARATE from Cardano integration.
/// Cardano uses: CIP-30 + CSL + Blockfrost
/// Midnight uses: mnLace DApp Connector + Compact contracts
/// 
/// WebGL only - will not work in Editor or native builds.
/// </summary>
public class MidnightDiagnostics : MonoBehaviour
{
    // ============================================================
    // JSLIB External Function Declarations
    // ============================================================

#if UNITY_WEBGL && !UNITY_EDITOR
    // Legacy functions (still work)
    [DllImport("__Internal")]
    private static extern void MidnightPreprod_Connect(string gameObjectName, string successCallback, string errorCallback, string network);

    [DllImport("__Internal")]
    private static extern void MidnightPreprod_Disconnect();

    [DllImport("__Internal")]
    private static extern int MidnightPreprod_IsConnected();

    [DllImport("__Internal")]
    private static extern int MidnightPreprod_IsAvailable();

    [DllImport("__Internal")]
    private static extern void MidnightPreprod_RunDiagnostic(string gameObjectName, string callback);

    [DllImport("__Internal")]
    private static extern void MidnightPreprod_JoinContract(string gameObjectName, string successCallback, string errorCallback, string contractAddress);

    [DllImport("__Internal")]
    private static extern void MidnightPreprod_ReadCounter(string gameObjectName, string successCallback, string errorCallback, string contractAddress);

    [DllImport("__Internal")]
    private static extern void MidnightPreprod_IncrementCounter(string gameObjectName, string successCallback, string errorCallback, string contractAddress);

    // New simplified functions using MidnightSDK
    [DllImport("__Internal")]
    private static extern void Midnight_ConnectPreprod(string gameObjectName, string successCallback, string errorCallback);

    [DllImport("__Internal")]
    private static extern void Midnight_ReadCounter(string gameObjectName, string successCallback, string errorCallback);

    [DllImport("__Internal")]
    private static extern void Midnight_IncrementCounter(string gameObjectName, string successCallback, string errorCallback);
#endif

    // ============================================================
    // UI References
    // ============================================================

    [Header("UI Elements")]
    [Tooltip("Text displaying diagnostic status")]
    public Text statusText;

    [Tooltip("Text displaying wallet info")]
    public Text walletInfoText;

    [Tooltip("Text displaying shielded address")]
    public Text addressText;

    [Tooltip("Text displaying configuration")]
    public Text configText;

    [Tooltip("Text displaying counter value")]
    public Text counterText;

    [Tooltip("Button to connect to Midnight Preprod")]
    public Button connectButton;

    [Tooltip("Button to run diagnostics")]
    public Button diagnosticButton;

    [Tooltip("Button to join contract")]
    public Button joinContractButton;

    [Tooltip("Button to read counter")]
    public Button readCounterButton;

    [Tooltip("Button to increment counter")]
    public Button incrementButton;

    [Header("Contract Settings")]
    [Tooltip("Counter contract address on Midnight Preview")]
    public string contractAddress = "8c31306d717dd2b79f30785ae7f0f5241f6f891d63441827395d8be1fecd88dd";

    // ============================================================
    // State
    // ============================================================

    private bool isConnected = false;
    private bool isContractJoined = false;
    private string shieldedAddress = "";
    private string walletName = "";
    private string apiVersion = "";
    private int counterValue = 0;

    // ============================================================
    // Events
    // ============================================================

    public event Action<string> OnConnected;
    public event Action<string> OnConnectionFailed;
    public event Action<int> OnCounterRead;
    public event Action<string> OnCounterIncremented;

    // ============================================================
    // Unity Lifecycle
    // ============================================================

    private void Start()
    {
        SetStatus("Initializing...");
        CheckAvailability();
    }

    // ============================================================
    // Public Methods
    // ============================================================

    /// <summary>
    /// Check if Midnight Preprod connector is available.
    /// </summary>
    public void CheckAvailability()
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        bool available = MidnightPreprod_IsAvailable() == 1;
        if (available)
        {
            SetStatus("Midnight Preprod Available - Ready to Connect");
            SetConnectButtonEnabled(true);
        }
        else
        {
            SetStatus("Midnight connector not found. Install Lace Midnight Preview.");
            SetConnectButtonEnabled(false);
        }
        Debug.Log($"[MidnightDiagnostics] Connector available: {available}");
#else
        SetStatus("WebGL Only - Run in Browser");
        SetConnectButtonEnabled(false);
        Debug.Log("[MidnightDiagnostics] Running in Editor - WebGL features disabled");
#endif
    }

    /// <summary>
    /// Connect to Midnight Preprod network using two-phase authorization.
    /// Uses MidnightSDK.connectPreprod() which handles connect() + enable() if needed.
    /// </summary>
    public void Connect()
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        SetStatus("Connecting to Midnight Preprod...");
        SetConnectButtonEnabled(false);
        Debug.Log("[MidnightDiagnostics] Initiating connection to preprod with two-phase auth...");
        Midnight_ConnectPreprod(gameObject.name, "OnConnectPreprodSuccess", "OnConnectPreprodError");
#else
        SetStatus("WebGL Only");
        Debug.Log("[MidnightDiagnostics] Connect only works in WebGL builds");
#endif
    }

    /// <summary>
    /// Legacy connect method (for backwards compatibility).
    /// </summary>
    public void ConnectLegacy()
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        SetStatus("Connecting to Midnight Preprod (legacy)...");
        SetConnectButtonEnabled(false);
        Debug.Log("[MidnightDiagnostics] Initiating legacy connection to preprod...");
        MidnightPreprod_Connect(gameObject.name, "OnConnectSuccess", "OnConnectError", "preprod");
#else
        SetStatus("WebGL Only");
        Debug.Log("[MidnightDiagnostics] Connect only works in WebGL builds");
#endif
    }

    /// <summary>
    /// Disconnect from wallet.
    /// </summary>
    public void Disconnect()
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        MidnightPreprod_Disconnect();
#endif
        isConnected = false;
        isContractJoined = false;
        shieldedAddress = "";
        SetStatus("Disconnected");
        UpdateUI();
        Debug.Log("[MidnightDiagnostics] Disconnected");
    }

    /// <summary>
    /// Run full diagnostic and log to console.
    /// </summary>
    public void RunDiagnostic()
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        SetStatus("Running diagnostic...");
        Debug.Log("[MidnightDiagnostics] Running diagnostic...");
        MidnightPreprod_RunDiagnostic(gameObject.name, "OnDiagnosticComplete");
#else
        SetStatus("WebGL Only");
        Debug.Log("[MidnightDiagnostics] Diagnostic only works in WebGL builds");
#endif
    }

    /// <summary>
    /// Join the Counter contract.
    /// </summary>
    public void JoinContract()
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        if (!isConnected)
        {
            SetStatus("Connect to wallet first");
            return;
        }
        SetStatus("Joining contract...");
        Debug.Log($"[MidnightDiagnostics] Joining contract: {contractAddress}");
        MidnightPreprod_JoinContract(gameObject.name, "OnJoinContractSuccess", "OnJoinContractError", contractAddress);
#else
        SetStatus("WebGL Only");
#endif
    }

    /// <summary>
    /// Read the current counter value using MidnightSDK.
    /// No longer requires JoinContract - reads directly from indexer.
    /// </summary>
    public void ReadCounter()
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        SetStatus("Reading counter...");
        Debug.Log("[MidnightDiagnostics] Reading counter from contract: " + contractAddress);
        Midnight_ReadCounter(gameObject.name, "OnReadCounterSuccess", "OnReadCounterError");
#else
        SetStatus("WebGL Only");
#endif
    }

    /// <summary>
    /// Increment the counter using MidnightSDK.
    /// Requires connection but no longer requires JoinContract.
    /// </summary>
    public void IncrementCounter()
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        if (!isConnected)
        {
            SetStatus("Connect to wallet first");
            return;
        }
        SetStatus("Incrementing counter...");
        Debug.Log("[MidnightDiagnostics] Incrementing counter on contract: " + contractAddress);
        Midnight_IncrementCounter(gameObject.name, "OnIncrementSuccess", "OnIncrementError");
#else
        SetStatus("WebGL Only");
#endif
    }

    // ============================================================
    // JavaScript Callbacks
    // ============================================================

    /// <summary>
    /// Called when connection succeeds.
    /// </summary>
    public void OnConnectSuccess(string resultJson)
    {
        Debug.Log($"[MidnightDiagnostics] Connection success: {resultJson}");
        isConnected = true;

        try
        {
            // Parse JSON result
            // Expected: { "success": true, "walletName": "...", "apiVersion": "...", 
            //             "shieldedAddress": "...", "configuration": {...} }
            
            // Simple parsing
            if (resultJson.Contains("\"shieldedAddress\":\""))
            {
                int start = resultJson.IndexOf("\"shieldedAddress\":\"") + 19;
                int end = resultJson.IndexOf("\"", start);
                if (end > start)
                {
                    shieldedAddress = resultJson.Substring(start, end - start);
                }
            }

            if (resultJson.Contains("\"walletName\":\""))
            {
                int start = resultJson.IndexOf("\"walletName\":\"") + 14;
                int end = resultJson.IndexOf("\"", start);
                if (end > start)
                {
                    walletName = resultJson.Substring(start, end - start);
                }
            }

            if (resultJson.Contains("\"apiVersion\":\""))
            {
                int start = resultJson.IndexOf("\"apiVersion\":\"") + 14;
                int end = resultJson.IndexOf("\"", start);
                if (end > start)
                {
                    apiVersion = resultJson.Substring(start, end - start);
                }
            }
        }
        catch (Exception e)
        {
            Debug.LogWarning($"[MidnightDiagnostics] Parse error: {e.Message}");
        }

        SetStatus("Connected to Midnight Preprod");
        UpdateUI();
        SetConnectButtonEnabled(true);

        OnConnected?.Invoke(shieldedAddress);
    }

    /// <summary>
    /// Called when connection fails.
    /// </summary>
    public void OnConnectError(string error)
    {
        Debug.LogError($"[MidnightDiagnostics] Connection error: {error}");
        isConnected = false;
        SetStatus($"Connection failed: {error}");
        SetConnectButtonEnabled(true);

        OnConnectionFailed?.Invoke(error);
    }

    /// <summary>
    /// Called when new connectPreprod succeeds (two-phase auth).
    /// </summary>
    public void OnConnectPreprodSuccess(string resultJson)
    {
        Debug.Log($"[MidnightDiagnostics] ConnectPreprod success: {resultJson}");
        isConnected = true;
        isContractJoined = true; // No longer need separate join step

        try
        {
            // Parse JSON result
            // Expected: { "success": true, "connected": true, "authorized": true,
            //             "providerKey": "mnLace", "apiVersion": "4.0.0", "walletName": "lace" }
            
            if (resultJson.Contains("\"providerKey\":\""))
            {
                int start = resultJson.IndexOf("\"providerKey\":\"") + 15;
                int end = resultJson.IndexOf("\"", start);
                if (end > start)
                {
                    shieldedAddress = resultJson.Substring(start, end - start);
                }
            }

            if (resultJson.Contains("\"walletName\":\""))
            {
                int start = resultJson.IndexOf("\"walletName\":\"") + 14;
                int end = resultJson.IndexOf("\"", start);
                if (end > start)
                {
                    walletName = resultJson.Substring(start, end - start);
                }
            }

            if (resultJson.Contains("\"apiVersion\":\""))
            {
                int start = resultJson.IndexOf("\"apiVersion\":\"") + 14;
                int end = resultJson.IndexOf("\"", start);
                if (end > start)
                {
                    apiVersion = resultJson.Substring(start, end - start);
                }
            }
        }
        catch (Exception e)
        {
            Debug.LogWarning($"[MidnightDiagnostics] Parse error: {e.Message}");
        }

        SetStatus($"Connected: {walletName} v{apiVersion}");
        UpdateUI();
        SetConnectButtonEnabled(true);

        OnConnected?.Invoke(shieldedAddress);
    }

    /// <summary>
    /// Called when new connectPreprod fails.
    /// </summary>
    public void OnConnectPreprodError(string error)
    {
        Debug.LogError($"[MidnightDiagnostics] ConnectPreprod error: {error}");
        isConnected = false;
        SetStatus($"Connection failed: {error}");
        SetConnectButtonEnabled(true);

        OnConnectionFailed?.Invoke(error);
    }

    /// <summary>
    /// Called when diagnostic completes.
    /// </summary>
    public void OnDiagnosticComplete(string resultJson)
    {
        Debug.Log($"[MidnightDiagnostics] Diagnostic complete: {resultJson}");
        SetStatus("Diagnostic complete - see browser console");
    }

    /// <summary>
    /// Called when contract join succeeds.
    /// </summary>
    public void OnJoinContractSuccess(string resultJson)
    {
        Debug.Log($"[MidnightDiagnostics] Contract joined: {resultJson}");
        isContractJoined = true;
        SetStatus("Contract joined");
        UpdateUI();
    }

    /// <summary>
    /// Called when contract join fails.
    /// </summary>
    public void OnJoinContractError(string error)
    {
        Debug.LogError($"[MidnightDiagnostics] Join contract error: {error}");
        SetStatus($"Join failed: {error}");
    }

    /// <summary>
    /// Called when counter read succeeds.
    /// Now receives JSON: { "success": true, "counter": N, "contractAddress": "..." }
    /// </summary>
    public void OnReadCounterSuccess(string resultJson)
    {
        Debug.Log($"[MidnightDiagnostics] Counter result: {resultJson}");
        
        try
        {
            // Parse counter from JSON
            if (resultJson.Contains("\"counter\":"))
            {
                int start = resultJson.IndexOf("\"counter\":") + 10;
                int end = resultJson.IndexOfAny(new char[] { ',', '}' }, start);
                if (end > start)
                {
                    string counterStr = resultJson.Substring(start, end - start).Trim();
                    if (int.TryParse(counterStr, out int val))
                    {
                        counterValue = val;
                    }
                }
            }
        }
        catch (Exception e)
        {
            Debug.LogWarning($"[MidnightDiagnostics] Parse error: {e.Message}");
        }

        SetStatus($"Counter: {counterValue}");
        UpdateCounterDisplay();

        OnCounterRead?.Invoke(counterValue);
    }

    /// <summary>
    /// Called when counter read fails.
    /// </summary>
    public void OnReadCounterError(string error)
    {
        Debug.LogError($"[MidnightDiagnostics] Read counter error: {error}");
        SetStatus($"Read failed: {error}");
    }

    /// <summary>
    /// Called when increment succeeds.
    /// Now receives JSON: { "success": true, "txHash": "...", "previousCounter": N, "newCounter": M, ... }
    /// </summary>
    public void OnIncrementSuccess(string resultJson)
    {
        Debug.Log($"[MidnightDiagnostics] Increment success: {resultJson}");
        
        try
        {
            // Parse new counter from JSON
            if (resultJson.Contains("\"newCounter\":"))
            {
                int start = resultJson.IndexOf("\"newCounter\":") + 13;
                int end = resultJson.IndexOfAny(new char[] { ',', '}' }, start);
                if (end > start)
                {
                    string counterStr = resultJson.Substring(start, end - start).Trim();
                    if (int.TryParse(counterStr, out int val))
                    {
                        counterValue = val;
                        UpdateCounterDisplay();
                    }
                }
            }
        }
        catch (Exception e)
        {
            Debug.LogWarning($"[MidnightDiagnostics] Parse error: {e.Message}");
        }

        SetStatus($"Counter incremented to {counterValue}!");

        OnCounterIncremented?.Invoke(resultJson);
    }

    /// <summary>
    /// Called when increment fails.
    /// </summary>
    public void OnIncrementError(string error)
    {
        Debug.LogError($"[MidnightDiagnostics] Increment error: {error}");
        SetStatus($"Increment failed: {error}");
    }

    // ============================================================
    // UI Helpers
    // ============================================================

    private void SetStatus(string message)
    {
        if (statusText != null)
        {
            statusText.text = message;
        }
        Debug.Log($"[MidnightDiagnostics] Status: {message}");
    }

    private void SetConnectButtonEnabled(bool enabled)
    {
        if (connectButton != null)
        {
            connectButton.interactable = enabled;
        }
    }

    private void UpdateUI()
    {
        // Update wallet info
        if (walletInfoText != null)
        {
            if (isConnected)
            {
                walletInfoText.text = $"Wallet: {walletName}\nAPI: {apiVersion}";
            }
            else
            {
                walletInfoText.text = "Not connected";
            }
        }

        // Update address
        if (addressText != null)
        {
            if (!string.IsNullOrEmpty(shieldedAddress))
            {
                addressText.text = TruncateAddress(shieldedAddress);
            }
            else
            {
                addressText.text = "";
            }
        }

        // Update button states
        if (joinContractButton != null)
        {
            joinContractButton.interactable = isConnected && !isContractJoined;
        }
        if (readCounterButton != null)
        {
            readCounterButton.interactable = isContractJoined;
        }
        if (incrementButton != null)
        {
            incrementButton.interactable = isContractJoined;
        }
    }

    private void UpdateCounterDisplay()
    {
        if (counterText != null)
        {
            counterText.text = $"Counter: {counterValue}";
        }
    }

    private string TruncateAddress(string address)
    {
        if (string.IsNullOrEmpty(address) || address.Length <= 20)
        {
            return address;
        }
        return $"{address.Substring(0, 10)}...{address.Substring(address.Length - 8)}";
    }

    // ============================================================
    // Properties
    // ============================================================

    public bool IsConnected => isConnected;
    public bool IsContractJoined => isContractJoined;
    public string ShieldedAddress => shieldedAddress;
    public string WalletName => walletName;
    public int CounterValue => counterValue;
}
