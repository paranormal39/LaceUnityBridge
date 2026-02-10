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

        // DAO Events
        public event Action<DaoProposal[]> OnDaoProposalsReceived;
        public event Action<string> OnDaoProposalsFailed;
        public event Action<string> OnDaoProposalCreated;
        public event Action<string> OnDaoProposalCreateFailed;
        public event Action<string> OnDaoVoteSuccess;
        public event Action<string> OnDaoVoteFailed;

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

        [DllImport("__Internal")]
        private static extern void CardanoBridge_FetchDaoProposals(string gameObjectName, string successCallback, string errorCallback, string blockfrostKey);

        [DllImport("__Internal")]
        private static extern void CardanoBridge_CreateDaoProposal(string gameObjectName, string successCallback, string errorCallback, string blockfrostKey, string policyId, string title, string description);

        [DllImport("__Internal")]
        private static extern void CardanoBridge_VoteOnDaoProposal(string gameObjectName, string successCallback, string errorCallback, string blockfrostKey, string proposalTxHash, int proposalTxIndex, string voteType);
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
        private static void CardanoBridge_FetchDaoProposals(string a, string b, string c, string d) { Debug.Log("[CardanoBridge] Editor: FetchDaoProposals stub"); }
        private static void CardanoBridge_CreateDaoProposal(string a, string b, string c, string d, string e, string f, string g) { Debug.Log("[CardanoBridge] Editor: CreateDaoProposal stub"); }
        private static void CardanoBridge_VoteOnDaoProposal(string a, string b, string c, string d, string e, int f, string g) { Debug.Log("[CardanoBridge] Editor: VoteOnDaoProposal stub"); }
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

        // DAO Blockfrost key — set at runtime via SetBlockfrostKey()
        private string _daoBlockfrostKey = "";

        /// <summary>
        /// Set the Blockfrost API key for DAO operations.
        /// Called from MidnightUISetup using the inspector-configured value.
        /// </summary>
        public void SetBlockfrostKey(string key)
        {
            _daoBlockfrostKey = key;
        }

        /// <summary>
        /// Fetch all DAO proposals from the script address
        /// </summary>
        public void FetchDaoProposals()
        {
            Debug.Log("[CardanoBridge] Fetching DAO proposals...");
            CardanoBridge_FetchDaoProposals(gameObject.name, "OnDaoProposalsSuccess", "OnDaoProposalsError", _daoBlockfrostKey);
        }

        /// <summary>
        /// Create a new DAO proposal (sends 2 ADA to script address with inline datum)
        /// </summary>
        public void CreateDaoProposal(string policyId, string title, string description)
        {
            Debug.Log($"[CardanoBridge] Creating DAO proposal: {title}");
            CardanoBridge_CreateDaoProposal(gameObject.name, "OnDaoCreateSuccess", "OnDaoCreateError", _daoBlockfrostKey, policyId, title, description);
        }

        /// <summary>
        /// Vote on a DAO proposal (spends script UTxO with vote redeemer)
        /// </summary>
        /// <param name="proposalTxHash">The tx hash of the proposal UTxO</param>
        /// <param name="proposalTxIndex">The output index of the proposal UTxO</param>
        /// <param name="voteType">"yes", "no", or "appeal"</param>
        public void VoteOnDaoProposal(string proposalTxHash, int proposalTxIndex, string voteType)
        {
            Debug.Log($"[CardanoBridge] Voting {voteType} on {proposalTxHash}#{proposalTxIndex}");
            CardanoBridge_VoteOnDaoProposal(gameObject.name, "OnDaoVoteSuccessCb", "OnDaoVoteErrorCb", _daoBlockfrostKey, proposalTxHash, proposalTxIndex, voteType);
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

        // DAO Callbacks
        private void OnDaoProposalsSuccess(string json)
        {
            Debug.Log($"[CardanoBridge] DAO proposals received: {json}");
            try
            {
                var proposals = JsonHelper.FromJsonArray<DaoProposal>(json);
                OnDaoProposalsReceived?.Invoke(proposals);
            }
            catch (Exception e)
            {
                Debug.LogError($"[CardanoBridge] Failed to parse proposals: {e.Message}");
                OnDaoProposalsFailed?.Invoke("Failed to parse proposals");
            }
        }

        private void OnDaoProposalsError(string error)
        {
            Debug.LogError($"[CardanoBridge] DAO proposals failed: {error}");
            OnDaoProposalsFailed?.Invoke(error);
        }

        private void OnDaoCreateSuccess(string txHash)
        {
            Debug.Log($"[CardanoBridge] DAO proposal created: {txHash}");
            OnDaoProposalCreated?.Invoke(txHash);
        }

        private void OnDaoCreateError(string error)
        {
            Debug.LogError($"[CardanoBridge] DAO proposal creation failed: {error}");
            OnDaoProposalCreateFailed?.Invoke(error);
        }

        private void OnDaoVoteSuccessCb(string txHash)
        {
            Debug.Log($"[CardanoBridge] DAO vote success: {txHash}");
            OnDaoVoteSuccess?.Invoke(txHash);
        }

        private void OnDaoVoteErrorCb(string error)
        {
            Debug.LogError($"[CardanoBridge] DAO vote failed: {error}");
            OnDaoVoteFailed?.Invoke(error);
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

        [Serializable]
        public class DaoProposal
        {
            public string policyId;
            public string title;
            public string description;
            public int yesCount;
            public int noCount;
            public int appealCount;
            public string txHash;
            public int txIndex;
            public string lovelace;
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
