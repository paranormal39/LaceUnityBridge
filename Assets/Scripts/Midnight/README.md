# Midnight Unity SDK

A Unity SDK for integrating **Lace Wallet** (Midnight Network) into WebGL games. Supports wallet connection, balance queries, and smart contract interactions using the Midnight DApp Connector API v4.0.x.

## Installation

### Prerequisites

1. **Unity 2021.3+** with WebGL build support
2. **Lace Wallet** browser extension with Midnight mode enabled
3. **Node.js 18+** (for building the JavaScript bridge)

### Setup Steps

1. **Copy the SDK files** to your Unity project:
   ```
   Assets/Scripts/Midnight/     # C# SDK files
   Assets/Plugins/WebGL/        # JavaScript bridge (JSLIB + bundle)
   Assets/WebGLTemplates/MidnightTemplate/  # WebGL template
   ```

2. **Build the JavaScript bundle** (if modifying TypeScript):
   ```bash
   cd web/midnight-bridge
   npm install
   npm run build
   ```

3. **Copy the built bundle** to Unity:
   ```bash
   cp dist/midnight-sdk.bundle.js* Assets/Plugins/WebGL/
   cp dist/midnight-sdk.bundle.js* Assets/WebGLTemplates/MidnightTemplate/TemplateData/
   ```

4. **Configure Unity WebGL build**:
   - Go to **File > Build Settings > WebGL**
   - Set **Player Settings > Resolution and Presentation > WebGL Template** to `MidnightTemplate`

5. **Build and deploy** to HTTPS server (required for wallet extensions)

## Quick Start

### 1. Basic Connection

```csharp
using Midnight;

public class MyGame : MonoBehaviour
{
    void Start()
    {
        // Initialize SDK
        MidnightSDK.Initialize(
            onReady: () => Debug.Log("Wallet detected!"),
            onWalletNotFound: () => Debug.Log("Install Lace wallet")
        );
        
        // Subscribe to events
        MidnightSDK.OnConnected += OnWalletConnected;
        MidnightSDK.OnDisconnected += () => Debug.Log("Disconnected");
        MidnightSDK.OnError += error => Debug.LogError(error);
    }

    public void ConnectWallet()
    {
        MidnightSDK.Connect(
            onSuccess: wallet => {
                Debug.Log($"Connected: {wallet.Address}");
                Debug.Log($"Mode: {wallet.Mode}");      // "midnight"
                Debug.Log($"Network: {wallet.Network}"); // "preprod"
            },
            onError: error => Debug.LogError(error)
        );
    }
    
    void OnWalletConnected(MidnightSDK.WalletInfo wallet)
    {
        Debug.Log($"Connected to {wallet.Network} via {wallet.Mode}");
    }
}
```

### 2. Get Balance

```csharp
MidnightSDK.GetBalance(
    onSuccess: balance => {
        Debug.Log($"tDUST: {balance.NativeFormatted}");  // e.g., "6.192663 tDUST"
        Debug.Log($"Shielded: {balance.Shielded}");
        Debug.Log($"Unshielded: {balance.Unshielded}");
    },
    onError: error => Debug.LogError(error)
);
```

### 3. Counter Contract (Example)

```csharp
// Read the current counter value
MidnightSDK.ReadCounter(
    onSuccess: result => {
        Debug.Log($"Counter: {result.Counter}");
    },
    onError: error => Debug.LogError(error)
);

// Increment the counter (triggers wallet signing popup)
MidnightSDK.IncrementCounter(
    onSuccess: result => {
        Debug.Log($"New value: {result.Counter}");
        Debug.Log($"TX Hash: {result.TxHash}");
    },
    onError: error => Debug.LogError(error)
);
```

### 4. Send Tokens

```csharp
// Amount in smallest units
MidnightSDK.Send("mn_addr_preprod1...", "1000000000",
    onSuccess: txHash => Debug.Log($"TX: {txHash}"),
    onError: error => Debug.LogError(error)
);
```

### 5. Events

```csharp
void Start()
{
    MidnightSDK.OnConnected += wallet => Debug.Log("Connected!");
    MidnightSDK.OnDisconnected += () => Debug.Log("Disconnected");
    MidnightSDK.OnError += error => Debug.LogError(error);
    MidnightSDK.OnStateChanged += state => Debug.Log($"State: {state}");
}
```

## API Reference

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `MidnightSDK.IsConnected` | `bool` | Is wallet connected? |
| `MidnightSDK.IsWalletAvailable` | `bool` | Is Lace installed? |
| `MidnightSDK.Wallet` | `WalletInfo` | Current wallet info |
| `MidnightSDK.CurrentState` | `State` | SDK state |
| `MidnightSDK.LastError` | `string` | Last error message |
| `MidnightSDK.DebugMode` | `bool` | Enable verbose logging |

### Methods

| Method | Description |
|--------|-------------|
| `Initialize(onReady, onNotFound)` | Initialize SDK, detect wallet |
| `Connect(onSuccess, onError)` | Connect to Lace wallet (preprod) |
| `Disconnect()` | Disconnect from wallet |
| `GetBalance(onSuccess, onError)` | Get tDUST balance |
| `Send(address, amount, onSuccess, onError)` | Send tokens |
| `ReadCounter(onSuccess, onError)` | Read counter contract value |
| `IncrementCounter(onSuccess, onError)` | Increment counter (signs tx) |
| `CopyToClipboard(text)` | Copy text to clipboard |

### Types

#### WalletInfo
```csharp
public class WalletInfo
{
    public string Address;      // Shielded wallet address (mn_shield-addr_preprod...)
    public string Mode;         // "midnight" (always for this SDK)
    public string Network;      // "preprod", "mainnet", "preview"
    public int NetworkId;       // 0 = testnet, 1 = mainnet
    public bool IsMidnight;     // true if using Midnight API
    public bool IsCardano;      // true if using Cardano CIP-30 (fallback)
}
```

#### BalanceInfo
```csharp
public class BalanceInfo
{
    public string Native;           // Raw DUST balance (smallest units)
    public string NativeFormatted;  // Human-readable (e.g., "6.192663 tDUST")
    public string Shielded;         // Shielded balance
    public string Unshielded;       // Unshielded tNIGHT balance
    public string Dust;             // DUST balance (same as Native)
}
```

#### CounterResult
```csharp
public class CounterResult
{
    public bool Success;        // Operation succeeded?
    public int Counter;         // Current counter value
    public string TxHash;       // Transaction hash (for increment)
    public string Error;        // Error message if failed
}
```

#### State
```csharp
public enum State
{
    NotInitialized,  // SDK not initialized
    WalletNotFound,  // Lace not installed
    Ready,           // Ready to connect
    Connecting,      // Connection in progress
    Connected,       // Wallet connected
    Error            // Error occurred
}
```

## Midnight Network

This SDK connects to the **Midnight Network** using the DApp Connector API v4.0.x. Midnight is a privacy-focused blockchain built on Cardano that supports:

- **Zero-Knowledge Proofs** - Private transactions and computations
- **Shielded Addresses** - Privacy-preserving wallet addresses
- **tDUST** - Native token for transaction fees (testnet)
- **tNIGHT** - Transferable token (testnet)
- **Smart Contracts** - Compact language for ZK circuits

### Networks

| Network | Description | Faucet |
|---------|-------------|--------|
| **preprod** | Primary testnet | [faucet.preprod.midnight.network](https://faucet.preprod.midnight.network) |
| **preview** | Experimental testnet | N/A |
| **mainnet** | Production (future) | N/A |

## Project Structure

```
Assets/
├── Scripts/Midnight/
│   ├── MidnightSDK.cs           # Main SDK (static API)
│   ├── MidnightWalletUI.cs      # Pre-built wallet UI
│   ├── MidnightBridge.cs        # Legacy UI bridge
│   └── README.md                # This file
├── Plugins/WebGL/
│   ├── MidnightWebGL.jslib      # JavaScript interop
│   └── midnight-sdk.bundle.js   # Bundled TypeScript SDK
└── WebGLTemplates/MidnightTemplate/
    ├── index.html               # WebGL template
    └── TemplateData/            # Template assets

web/midnight-bridge/
├── src/
│   ├── midnight-unity-bridge.ts # Main TypeScript bridge
│   └── MidnightConnector.ts     # Wallet connector logic
├── package.json
└── tsconfig.json
```

## Building the JavaScript Bundle

If you modify the TypeScript source:

```bash
cd web/midnight-bridge
npm install
npm run build

# Copy to Unity
copy dist\midnight-sdk.bundle.js ..\..\Assets\Plugins\WebGL\
copy dist\midnight-sdk.bundle.js ..\..\Assets\WebGLTemplates\MidnightTemplate\TemplateData\
```

## Unity WebGL Build

1. **File > Build Settings > WebGL**
2. **Player Settings**:
   - Resolution and Presentation > WebGL Template: `MidnightTemplate`
   - Publishing Settings > Compression Format: `Brotli` (recommended)
3. **Build**
4. **Deploy** to HTTPS server (localhost works for testing)

## Using the Pre-built UI

Add `MidnightWalletUI` component to any GameObject:

```csharp
// The UI is created automatically and includes:
// - Connect/Disconnect button
// - Network and address display
// - Balance display (tDUST)
// - Counter contract controls (Read/Increment)
```

## Troubleshooting

### "Wallet not found"
- Install [Lace Wallet](https://www.lace.io/) browser extension
- Enable **Midnight mode** in Lace settings
- Refresh the page after installing

### "Connection failed" or "Access denied"
1. Open Lace wallet and unlock it
2. Go to **Settings > Connected Websites**
3. Remove any localhost entries
4. Restart browser and reconnect

### "Invalid network ID"
- Ensure Lace is set to **Preprod** network
- The SDK targets preprod by default

### Counter contract errors
- Ensure you have tDUST for transaction fees
- Get tNIGHT from the [faucet](https://faucet.preprod.midnight.network)
- Wait for DUST to generate from registered NIGHT

### BigInt serialization errors
- Already fixed in this SDK version
- If you see this, ensure you're using the latest `midnight-sdk.bundle.js`

## Resources

- [Midnight Network Docs](https://docs.midnight.network/)
- [Example Counter Contract](https://github.com/midnightntwrk/example-counter)
- [Lace Wallet](https://www.lace.io/)
- [Preprod Faucet](https://faucet.preprod.midnight.network)

## License

MIT
