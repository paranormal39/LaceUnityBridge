using System;
using System.Collections;
using UnityEngine;
using UnityEngine.Networking;
using UnityEngine.UI;

/// <summary>
/// CounterReader - Reads Aiken counter smart contract datum from Cardano Preprod via Blockfrost.
/// 
/// Features:
/// - Fetches UTxOs at the script address
/// - Parses inline_datum CBOR integer
/// - Displays counter value in UI
/// - Handles errors gracefully
/// 
/// SECURITY NOTE: Do NOT ship Blockfrost API keys in production WebGL builds.
/// Use a proxy endpoint or serverless function instead.
/// </summary>
public class CounterReader : MonoBehaviour
{
    // ============================================================
    // Configuration
    // ============================================================
    
    [Header("Blockfrost Configuration")]
    [Tooltip("Blockfrost Project ID (API Key). For dev only - use proxy in production!")]
    [SerializeField] private string blockfrostProjectId = "";
    
    [Tooltip("Script address of the Aiken counter contract on Preprod")]
    [SerializeField] private string scriptAddress = "addr_test1wq0666pyk48q4v2zgjgdd4fuzn3xg2lzhsvueduvjxjuksqc7yh2n";
    
    [Header("API Settings")]
    [Tooltip("Base URL for Blockfrost API")]
    [SerializeField] private string blockfrostBaseUrl = "https://cardano-preprod.blockfrost.io/api/v0";
    
    [Tooltip("Request timeout in seconds")]
    [SerializeField] private float requestTimeout = 15f;

    // ============================================================
    // UI References
    // ============================================================
    
    [Header("UI Elements")]
    [Tooltip("Text displaying the counter value")]
    public Text counterText;
    
    [Tooltip("Text displaying status/errors")]
    public Text counterStatusText;
    
    [Tooltip("Button to refresh the counter")]
    public Button refreshButton;

    // ============================================================
    // State
    // ============================================================
    
    private bool isLoading = false;
    private long lastCounterValue = -1;

    // ============================================================
    // Events
    // ============================================================
    
    /// <summary>
    /// Fired when counter value is successfully read. Parameter is the counter value.
    /// </summary>
    public event Action<long> OnCounterRead;
    
    /// <summary>
    /// Fired when an error occurs. Parameter is the error message.
    /// </summary>
    public event Action<string> OnCounterError;

    // ============================================================
    // Unity Lifecycle
    // ============================================================

    private void Start()
    {
        if (refreshButton != null)
        {
            refreshButton.onClick.AddListener(RefreshCounter);
        }
        
        SetCounterText("Counter: --");
        SetStatusText("Ready");
    }

    // ============================================================
    // Public Methods
    // ============================================================

    /// <summary>
    /// Refresh the counter value from the blockchain.
    /// </summary>
    public void RefreshCounter()
    {
        if (isLoading)
        {
            Debug.LogWarning("[CounterReader] Already loading, please wait...");
            return;
        }
        
        if (string.IsNullOrEmpty(blockfrostProjectId))
        {
            SetStatusText("Error: Blockfrost API key not set");
            Debug.LogError("[CounterReader] Blockfrost Project ID is not configured!");
            return;
        }
        
        StartCoroutine(FetchCounterCoroutine());
    }

    /// <summary>
    /// Set the Blockfrost Project ID at runtime.
    /// </summary>
    public void SetBlockfrostProjectId(string projectId)
    {
        blockfrostProjectId = projectId;
    }

    /// <summary>
    /// Set the script address at runtime.
    /// </summary>
    public void SetScriptAddress(string address)
    {
        scriptAddress = address;
    }

    /// <summary>
    /// Get the last read counter value. Returns -1 if not yet read.
    /// </summary>
    public long GetLastCounterValue()
    {
        return lastCounterValue;
    }

    // ============================================================
    // Coroutine: Fetch Counter from Blockfrost
    // ============================================================

    private IEnumerator FetchCounterCoroutine()
    {
        isLoading = true;
        SetRefreshButtonEnabled(false);
        SetStatusText("Fetching...");
        
        string url = $"{blockfrostBaseUrl}/addresses/{scriptAddress}/utxos";
        
        Debug.Log($"[CounterReader] Fetching UTxOs from: {url}");
        
        using (UnityWebRequest request = UnityWebRequest.Get(url))
        {
            request.SetRequestHeader("project_id", blockfrostProjectId);
            request.SetRequestHeader("Content-Type", "application/json");
            request.timeout = (int)requestTimeout;
            
            yield return request.SendWebRequest();
            
            if (request.result == UnityWebRequest.Result.ConnectionError)
            {
                HandleError($"Network error: {request.error}");
                yield break;
            }
            
            if (request.result == UnityWebRequest.Result.ProtocolError)
            {
                long responseCode = request.responseCode;
                string errorBody = request.downloadHandler.text;
                
                if (responseCode == 404)
                {
                    HandleError("No UTxOs found at script address");
                }
                else if (responseCode == 403)
                {
                    HandleError("API key invalid or rate limited");
                }
                else if (responseCode == 429)
                {
                    HandleError("Rate limited - try again later");
                }
                else
                {
                    HandleError($"HTTP {responseCode}: {errorBody}");
                }
                yield break;
            }
            
            string responseText = request.downloadHandler.text;
            Debug.Log($"[CounterReader] Response: {responseText}");
            
            // Parse the response
            ParseUtxosResponse(responseText);
        }
        
        isLoading = false;
        SetRefreshButtonEnabled(true);
    }

    // ============================================================
    // JSON Parsing (minimal, no external dependencies)
    // ============================================================

    private void ParseUtxosResponse(string json)
    {
        // Response is a JSON array: [ { "tx_hash": "...", "inline_datum": "...", ... }, ... ]
        // We need to find the first UTxO with inline_datum
        
        if (string.IsNullOrEmpty(json) || json == "[]")
        {
            HandleError("No UTxOs at script address");
            return;
        }
        
        // Find inline_datum in the response
        string inlineDatum = ExtractInlineDatum(json);
        
        if (string.IsNullOrEmpty(inlineDatum))
        {
            HandleError("No inline_datum found in UTxOs");
            return;
        }
        
        Debug.Log($"[CounterReader] Found inline_datum: {inlineDatum}");
        
        // Decode CBOR integer
        try
        {
            long counterValue = DecodeCborUnsignedInt(inlineDatum);
            lastCounterValue = counterValue;
            
            SetCounterText($"Counter: {counterValue}");
            SetStatusText("Updated");
            
            Debug.Log($"[CounterReader] Counter value: {counterValue}");
            
            OnCounterRead?.Invoke(counterValue);
        }
        catch (Exception e)
        {
            HandleError($"CBOR decode error: {e.Message}");
        }
    }

    /// <summary>
    /// Extract the first inline_datum value from the UTxO array JSON.
    /// Simple string parsing to avoid external JSON dependencies.
    /// </summary>
    private string ExtractInlineDatum(string json)
    {
        // Look for "inline_datum":"<hex>" pattern
        // Note: Blockfrost returns inline_datum as a string (hex CBOR)
        
        string searchKey = "\"inline_datum\":\"";
        int startIndex = json.IndexOf(searchKey);
        
        if (startIndex < 0)
        {
            // Try alternative: inline_datum might be null or missing
            // Check if there's inline_datum with null value
            if (json.Contains("\"inline_datum\":null"))
            {
                Debug.LogWarning("[CounterReader] inline_datum is null");
                return null;
            }
            return null;
        }
        
        startIndex += searchKey.Length;
        int endIndex = json.IndexOf("\"", startIndex);
        
        if (endIndex <= startIndex)
        {
            return null;
        }
        
        return json.Substring(startIndex, endIndex - startIndex);
    }

    // ============================================================
    // CBOR Decoding (unsigned integers only)
    // ============================================================
    
    /// <summary>
    /// Decode a CBOR-encoded unsigned integer from hex string.
    /// 
    /// CBOR unsigned int encoding:
    /// - 0x00-0x17: value is the byte itself (0-23)
    /// - 0x18 + 1 byte: value is next byte (24-255)
    /// - 0x19 + 2 bytes: value is next 2 bytes big-endian (256-65535)
    /// - 0x1a + 4 bytes: value is next 4 bytes big-endian
    /// - 0x1b + 8 bytes: value is next 8 bytes big-endian
    /// </summary>
    private long DecodeCborUnsignedInt(string hex)
    {
        if (string.IsNullOrEmpty(hex))
        {
            throw new ArgumentException("Empty hex string");
        }
        
        // Remove any whitespace
        hex = hex.Trim().ToLower();
        
        // Must have at least 2 characters (1 byte)
        if (hex.Length < 2)
        {
            throw new ArgumentException($"Hex too short: {hex}");
        }
        
        byte[] bytes = HexToBytes(hex);
        
        if (bytes.Length == 0)
        {
            throw new ArgumentException("No bytes decoded");
        }
        
        byte firstByte = bytes[0];
        
        // Check major type (top 3 bits should be 0 for unsigned int)
        int majorType = (firstByte >> 5) & 0x07;
        if (majorType != 0)
        {
            throw new ArgumentException($"Not a CBOR unsigned int. Major type: {majorType}, first byte: 0x{firstByte:X2}");
        }
        
        int additionalInfo = firstByte & 0x1F;
        
        // Direct value (0-23)
        if (additionalInfo <= 23)
        {
            return additionalInfo;
        }
        
        // 1-byte value (24-255)
        if (additionalInfo == 24)
        {
            if (bytes.Length < 2)
            {
                throw new ArgumentException("CBOR 0x18 requires 1 additional byte");
            }
            return bytes[1];
        }
        
        // 2-byte value (big-endian)
        if (additionalInfo == 25)
        {
            if (bytes.Length < 3)
            {
                throw new ArgumentException("CBOR 0x19 requires 2 additional bytes");
            }
            return (bytes[1] << 8) | bytes[2];
        }
        
        // 4-byte value (big-endian)
        if (additionalInfo == 26)
        {
            if (bytes.Length < 5)
            {
                throw new ArgumentException("CBOR 0x1a requires 4 additional bytes");
            }
            return ((long)bytes[1] << 24) | ((long)bytes[2] << 16) | ((long)bytes[3] << 8) | bytes[4];
        }
        
        // 8-byte value (big-endian)
        if (additionalInfo == 27)
        {
            if (bytes.Length < 9)
            {
                throw new ArgumentException("CBOR 0x1b requires 8 additional bytes");
            }
            long value = 0;
            for (int i = 1; i <= 8; i++)
            {
                value = (value << 8) | bytes[i];
            }
            return value;
        }
        
        throw new ArgumentException($"Unsupported CBOR additional info: {additionalInfo}");
    }

    /// <summary>
    /// Convert hex string to byte array.
    /// </summary>
    private byte[] HexToBytes(string hex)
    {
        if (hex.Length % 2 != 0)
        {
            throw new ArgumentException($"Hex string has odd length: {hex.Length}");
        }
        
        byte[] bytes = new byte[hex.Length / 2];
        
        for (int i = 0; i < bytes.Length; i++)
        {
            bytes[i] = Convert.ToByte(hex.Substring(i * 2, 2), 16);
        }
        
        return bytes;
    }

    // ============================================================
    // Helper Methods
    // ============================================================

    private void HandleError(string message)
    {
        isLoading = false;
        SetRefreshButtonEnabled(true);
        SetStatusText($"Error: {message}");
        Debug.LogError($"[CounterReader] {message}");
        
        OnCounterError?.Invoke(message);
    }

    private void SetCounterText(string text)
    {
        if (counterText != null)
        {
            counterText.text = text;
        }
    }

    private void SetStatusText(string text)
    {
        if (counterStatusText != null)
        {
            counterStatusText.text = text;
        }
    }

    private void SetRefreshButtonEnabled(bool enabled)
    {
        if (refreshButton != null)
        {
            refreshButton.interactable = enabled;
        }
    }
}
