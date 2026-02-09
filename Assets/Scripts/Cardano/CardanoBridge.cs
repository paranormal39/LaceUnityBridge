using System;
using System.Runtime.InteropServices;
using UnityEngine;

namespace Cardano
{
    /// <summary>
    /// Unity C# bridge for Cardano CIP-30 wallet interactions.
    /// Uses pure CSL + CIP-30 (no MeshJS dependency).
    /// </summary>
    public class CardanoBridge : MonoBehaviour
    {
        public static CardanoBridge Instance { get; private set; }

        // Events
        public event Action<WalletConnectionResult> OnWalletConnected;
        public event Action<string> OnWalletConnectionFailed;
        public event Action OnWalletDisconnected;
        public event Action<string> OnBalanceReceived;
        public event Action<string> OnBalanceFailed;
        public event Action<string[]> OnAddressesReceived;
        public event Action<string> OnAddressesFailed;
        public event Action<TransactionResult> OnTransactionSuccess;
        public event Action<string> OnTransactionFailed;

        // State
        public bool IsConnected => CardanoBridge_IsConnected() == 1;
        public bool IsLaceAvailable => CardanoBridge_IsLaceAvailable() == 1;

        #region DllImports

#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")]
        private static extern int CardanoBridge_IsLaceAvailable();

        [DllImport("__Internal")]
        private static extern IntPtr CardanoBridge_GetAvailableWallets();

        [DllImport("__Internal")]
        private static extern int CardanoBridge_IsConnected();

        [DllImport("__Internal")]
        private static extern void CardanoBridge_ConnectWallet(string gameObjectName, string successCallback, string errorCallback, string walletName);

        [DllImport("__Internal")]
        private static extern void CardanoBridge_DisconnectWallet();

        [DllImport("__Internal")]
        private static extern void CardanoBridge_GetBalance(string gameObjectName, string successCallback, string errorCallback);

        [DllImport("__Internal")]
        private static extern void CardanoBridge_GetUsedAddresses(string gameObjectName, string successCallback, string errorCallback);

        [DllImport("__Internal")]
        private static extern void CardanoBridge_GetUtxos(string gameObjectName, string successCallback, string errorCallback);

        [DllImport("__Internal")]
        private static extern void CardanoBridge_BuildAndSendPayment(string gameObjectName, string successCallback, string errorCallback, string toAddress, string lovelaceAmount);

        [DllImport("__Internal")]
        private static extern void CardanoBridge_GetChangeAddress(string gameObjectName, string successCallback, string errorCallback);
#else
        // Editor stubs
        private static int CardanoBridge_IsLaceAvailable() => 0;
        private static IntPtr CardanoBridge_GetAvailableWallets() => IntPtr.Zero;
        private static int CardanoBridge_IsConnected() => 0;
        private static void CardanoBridge_ConnectWallet(string a, string b, string c, string d) { Debug.Log("[CardanoBridge] Editor: ConnectWallet stub"); }
        private static void CardanoBridge_DisconnectWallet() { Debug.Log("[CardanoBridge] Editor: DisconnectWallet stub"); }
        private static void CardanoBridge_GetBalance(string a, string b, string c) { Debug.Log("[CardanoBridge] Editor: GetBalance stub"); }
        private static void CardanoBridge_GetUsedAddresses(string a, string b, string c) { Debug.Log("[CardanoBridge] Editor: GetUsedAddresses stub"); }
        private static void CardanoBridge_GetUtxos(string a, string b, string c) { Debug.Log("[CardanoBridge] Editor: GetUtxos stub"); }
        private static void CardanoBridge_BuildAndSendPayment(string a, string b, string c, string d, string e) { Debug.Log("[CardanoBridge] Editor: BuildAndSendPayment stub"); }
        private static void CardanoBridge_GetChangeAddress(string a, string b, string c) { Debug.Log("[CardanoBridge] Editor: GetChangeAddress stub"); }
#endif

        #endregion

        #region Unity Lifecycle

        private void Awake()
        {
            if (Instance != null && Instance != this)
            {
                Destroy(gameObject);
                return;
            }
            Instance = this;
            DontDestroyOnLoad(gameObject);
        }

        #endregion

        #region Public API

        /// <summary>
        /// Connect to a CIP-30 wallet. Must be called from user gesture (button click).
        /// </summary>
        /// <param name="walletName">Wallet name: "lace", "eternl", "nami", etc.</param>
        public void ConnectWallet(string walletName = "lace")
        {
            Debug.Log($"[CardanoBridge] Connecting to {walletName}...");
            CardanoBridge_ConnectWallet(gameObject.name, "OnConnectSuccess", "OnConnectError", walletName);
        }

        /// <summary>
        /// Disconnect from wallet
        /// </summary>
        public void DisconnectWallet()
        {
            CardanoBridge_DisconnectWallet();
            OnWalletDisconnected?.Invoke();
        }

        /// <summary>
        /// Get wallet balance in lovelace
        /// </summary>
        public void GetBalance()
        {
            CardanoBridge_GetBalance(gameObject.name, "OnBalanceSuccess", "OnBalanceError");
        }

        /// <summary>
        /// Get used addresses
        /// </summary>
        public void GetUsedAddresses()
        {
            CardanoBridge_GetUsedAddresses(gameObject.name, "OnAddressesSuccess", "OnAddressesError");
        }

        /// <summary>
        /// Build and send a simple ADA payment
        /// </summary>
        /// <param name="toAddress">Recipient bech32 address</param>
        /// <param name="lovelaceAmount">Amount in lovelace (1 ADA = 1,000,000 lovelace)</param>
        public void SendPayment(string toAddress, long lovelaceAmount)
        {
            Debug.Log($"[CardanoBridge] Sending {lovelaceAmount} lovelace to {toAddress}");
            CardanoBridge_BuildAndSendPayment(
                gameObject.name, 
                "OnPaymentSuccess", 
                "OnPaymentError", 
                toAddress, 
                lovelaceAmount.ToString()
            );
        }

        /// <summary>
        /// Send ADA (convenience method)
        /// </summary>
        /// <param name="toAddress">Recipient bech32 address</param>
        /// <param name="adaAmount">Amount in ADA</param>
        public void SendAda(string toAddress, decimal adaAmount)
        {
            long lovelace = (long)(adaAmount * 1_000_000m);
            SendPayment(toAddress, lovelace);
        }

        #endregion

        #region JS Callbacks

        // Called from JavaScript
        private void OnConnectSuccess(string json)
        {
            Debug.Log($"[CardanoBridge] Connected: {json}");
            try
            {
                var result = JsonUtility.FromJson<WalletConnectionResult>(json);
                OnWalletConnected?.Invoke(result);
            }
            catch (Exception e)
            {
                Debug.LogError($"[CardanoBridge] Failed to parse connection result: {e.Message}");
                OnWalletConnectionFailed?.Invoke("Failed to parse connection result");
            }
        }

        private void OnConnectError(string error)
        {
            Debug.LogError($"[CardanoBridge] Connection failed: {error}");
            OnWalletConnectionFailed?.Invoke(error);
        }

        private void OnBalanceSuccess(string balance)
        {
            Debug.Log($"[CardanoBridge] Balance: {balance} lovelace");
            OnBalanceReceived?.Invoke(balance);
        }

        private void OnBalanceError(string error)
        {
            Debug.LogError($"[CardanoBridge] Balance failed: {error}");
            OnBalanceFailed?.Invoke(error);
        }

        private void OnAddressesSuccess(string json)
        {
            Debug.Log($"[CardanoBridge] Addresses: {json}");
            try
            {
                var addresses = JsonHelper.FromJsonArray<string>(json);
                OnAddressesReceived?.Invoke(addresses);
            }
            catch
            {
                OnAddressesFailed?.Invoke("Failed to parse addresses");
            }
        }

        private void OnAddressesError(string error)
        {
            Debug.LogError($"[CardanoBridge] Addresses failed: {error}");
            OnAddressesFailed?.Invoke(error);
        }

        private void OnPaymentSuccess(string json)
        {
            Debug.Log($"[CardanoBridge] Payment success: {json}");
            try
            {
                var result = JsonUtility.FromJson<TransactionResult>(json);
                OnTransactionSuccess?.Invoke(result);
            }
            catch
            {
                // Try manual parsing
                if (json.Contains("txHash"))
                {
                    var result = new TransactionResult { txHash = ExtractTxHash(json) };
                    OnTransactionSuccess?.Invoke(result);
                }
                else
                {
                    OnTransactionFailed?.Invoke("Failed to parse transaction result");
                }
            }
        }

        private void OnPaymentError(string error)
        {
            Debug.LogError($"[CardanoBridge] Payment failed: {error}");
            OnTransactionFailed?.Invoke(error);
        }

        private string ExtractTxHash(string json)
        {
            // Simple extraction for {"txHash":"..."}
            int start = json.IndexOf("\"txHash\":\"") + 10;
            int end = json.IndexOf("\"", start);
            return json.Substring(start, end - start);
        }

        #endregion

        #region Data Classes

        [Serializable]
        public class WalletConnectionResult
        {
            public bool success;
            public string wallet;
            public int networkId;
            public string networkName;
            public int addressCount;
            public string changeAddress;
        }

        [Serializable]
        public class TransactionResult
        {
            public string txHash;
        }

        // Helper for JSON array parsing
        private static class JsonHelper
        {
            public static T[] FromJsonArray<T>(string json)
            {
                string wrapped = "{\"items\":" + json + "}";
                var wrapper = JsonUtility.FromJson<Wrapper<T>>(wrapped);
                return wrapper.items;
            }

            [Serializable]
            private class Wrapper<T>
            {
                public T[] items;
            }
        }

        #endregion
    }
}
