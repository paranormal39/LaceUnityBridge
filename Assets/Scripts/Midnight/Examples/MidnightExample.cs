using UnityEngine;
using UnityEngine.UI;
using Midnight;

/// <summary>
/// Example: How to use MidnightSDK in your Unity game.
/// 
/// This demonstrates the simplest way to connect to Lace wallet
/// and perform basic operations.
/// </summary>
public class MidnightExample : MonoBehaviour
{
    [Header("UI References (Optional)")]
    public Text statusText;
    public Text addressText;
    public Text balanceText;
    public Button connectButton;

    void Start()
    {
        // Initialize SDK on startup
        MidnightSDK.Initialize(
            onReady: () => {
                Log("Lace wallet detected! Ready to connect.");
                if (connectButton) connectButton.interactable = true;
            },
            onWalletNotFound: () => {
                Log("Lace wallet not found. Please install Lace extension.");
                if (connectButton) connectButton.interactable = false;
            }
        );

        // Subscribe to events
        MidnightSDK.OnConnected += OnWalletConnected;
        MidnightSDK.OnDisconnected += OnWalletDisconnected;
        MidnightSDK.OnError += OnError;

        // Wire up button
        if (connectButton)
        {
            connectButton.onClick.AddListener(OnConnectClicked);
        }
    }

    void OnDestroy()
    {
        // Unsubscribe from events
        MidnightSDK.OnConnected -= OnWalletConnected;
        MidnightSDK.OnDisconnected -= OnWalletDisconnected;
        MidnightSDK.OnError -= OnError;
    }

    // ============================================================
    // Button Handlers
    // ============================================================

    public void OnConnectClicked()
    {
        if (MidnightSDK.IsConnected)
        {
            // Already connected - disconnect
            MidnightSDK.Disconnect();
        }
        else
        {
            // Connect to wallet
            Log("Connecting to Lace...");
            MidnightSDK.Connect();
        }
    }

    // ============================================================
    // Event Handlers
    // ============================================================

    void OnWalletConnected(MidnightSDK.WalletInfo wallet)
    {
        Log($"Connected via {wallet.Mode.ToUpper()} on {wallet.Network}");
        
        if (addressText)
        {
            // Show truncated address
            string addr = wallet.Address;
            addressText.text = addr.Length > 20 
                ? $"{addr.Substring(0, 8)}...{addr.Substring(addr.Length - 6)}"
                : addr;
        }

        // Automatically fetch balance
        FetchBalance();

        // Update button text
        if (connectButton)
        {
            connectButton.GetComponentInChildren<Text>().text = "Disconnect";
        }

        // Show warning if not in Midnight mode
        if (!wallet.IsMidnight)
        {
            Log("Warning: Connected via Cardano API, not Midnight");
        }
    }

    void OnWalletDisconnected()
    {
        Log("Disconnected");
        
        if (addressText) addressText.text = "";
        if (balanceText) balanceText.text = "Balance: --";
        
        if (connectButton)
        {
            connectButton.GetComponentInChildren<Text>().text = "Connect";
        }
    }

    void OnError(string error)
    {
        Log($"Error: {error}");
    }

    // ============================================================
    // Wallet Operations
    // ============================================================

    void FetchBalance()
    {
        MidnightSDK.GetBalance(
            onSuccess: balance => {
                if (balanceText)
                {
                    balanceText.text = $"Balance: {balance.NativeFormatted}";
                }
                Log($"Balance: {balance.Native} (shielded: {balance.Shielded}, unshielded: {balance.Unshielded})");
            },
            onError: error => {
                Log($"Failed to get balance: {error}");
            }
        );
    }

    /// <summary>
    /// Example: Send tokens to an address.
    /// Call this from a button or your game logic.
    /// </summary>
    public void SendTokens(string recipientAddress, string amountLovelace)
    {
        if (!MidnightSDK.IsConnected)
        {
            Log("Cannot send - wallet not connected");
            return;
        }

        Log($"Sending {amountLovelace} lovelace to {recipientAddress}...");

        MidnightSDK.Send(recipientAddress, amountLovelace,
            onSuccess: txHash => {
                Log($"Transaction sent! Hash: {txHash}");
                // Refresh balance after sending
                FetchBalance();
            },
            onError: error => {
                Log($"Send failed: {error}");
            }
        );
    }

    // ============================================================
    // Helpers
    // ============================================================

    void Log(string message)
    {
        Debug.Log($"[MidnightExample] {message}");
        if (statusText) statusText.text = message;
    }
}
