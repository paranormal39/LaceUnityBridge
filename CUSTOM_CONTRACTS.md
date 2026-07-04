# Custom Contracts — Design & Plan

> **Status:** Design proposal. The current bridge is hard-coded around the example **counter contract**. This doc describes the path to a generic API where any Compact contract can be plugged in by dropping a folder and registering a few entries — no bridge rebuild required for most contracts.

---

## Goal

Let a Unity developer ship a Midnight dApp by:

1. Writing a Compact contract (`my_contract.compact`).
2. Compiling it with `compactc` → a vendored package directory.
3. Dropping ZK keys + IR into a known location.
4. Calling a generic `MidnightSDK.CallContract(...)` from C# with the contract address, circuit name, and arguments.

…without forking `midnight-unity-bridge.ts`.

---

## Current state — what's hard-coded

The bridge today (`@/Users/.../web/midnight-bridge/src/midnight-unity-bridge.ts`) assumes the example counter contract in three places:

| Location | What's hard-coded | Lines |
|---|---|---|
| **Static import** | `import * as counterContract from '@midnight-ntwrk/counter-contract'` | top of file |
| **Loader** | `loadMidnightPackages()` stores `Counter.Contract`, `witnesses` globally | ~line 122–150 |
| **Circuit call** | `incrementCounter()` directly invokes `deployedContract.callTx.increment()` | ~line 1733 |
| **State decoder** | `readCounter()` calls `Counter.ledger(contractState.data).round` | ~line 1517 |
| **ZK paths** | `http://localhost:.../TemplateData/zk/counter/keys/increment.{prover,verifier}` | ~line 2288, 2311 |
| **Default address** | `DEFAULT_COUNTER_ADDRESS = '8c31306d…cd88dd'` | constant |

Replicating the existing pattern for a second contract would require duplicating most of this. The plan below replaces it with a registry.

---

## Proposed architecture — contract registry

### 1. Folder convention

```
Assets/StreamingAssets/zk/<contractName>/
  keys/
    <circuit>.prover
    <circuit>.verifier
  zkir/
    <circuit>.bzkir
    <circuit>.zkir          (optional, full IR)

web/midnight-bridge/vendor/<contractName>/
  package.json              (compactc output)
  managed/<contractName>/contract/index.js
  managed/<contractName>/contract/index.d.ts
  witnesses.js              (or co-located)
```

The `<contractName>` token must match across all four locations and is the registry key.

### 2. Registry manifest

A new file `web/midnight-bridge/src/contracts/registry.ts`:

```ts
export interface ContractEntry {
  name: string;                                // e.g. "counter"
  address?: string;                            // optional default deployment
  load: () => Promise<{                        // dynamic import
    Contract: any;
    witnesses: any;
    ledger: (state: any) => any;               // state decoder
  }>;
  decodeState: (decoded: any) => Record<string, any>;  // public state shape
  zkBaseUrl?: string;                          // override default `/zk/<name>/`
}

export const contractRegistry: Record<string, ContractEntry> = {
  counter: {
    name: 'counter',
    address: '8c31306d717dd2b79f30785ae7f0f5241f6f891d63441827395d8be1fecd88dd',
    load: async () => {
      const mod = await import('@midnight-ntwrk/counter-contract');
      return {
        Contract: (mod as any).Counter?.Contract ?? (mod as any).Contract,
        witnesses: (mod as any).witnesses ?? {},
        ledger: (mod as any).Counter?.ledger ?? (mod as any).ledger,
      };
    },
    decodeState: (decoded) => ({
      round: typeof decoded.round === 'bigint' ? Number(decoded.round) : decoded.round,
    }),
  },
};

export function registerContract(entry: ContractEntry): void {
  contractRegistry[entry.name] = entry;
}
```

User-side: drop a small registration call into a separate file the bundle imports, OR pass the entry from C# at runtime via a `MidnightSDK.RegisterContract(...)` exported function (see §4).

### 3. Generic `callContract` / `readContract`

Replace `incrementCounter` and `readCounter` with:

```ts
async function callContract(
  contractName: string,
  circuitName: string,
  args: any[] = [],
  contractAddress?: string,           // optional override of registry default
): Promise<{ success: boolean; result?: any; txHash?: string; error?: string }> {
  const entry = contractRegistry[contractName];
  if (!entry) throw new Error(`Unknown contract: ${contractName}`);

  const { Contract, witnesses, ledger } = await entry.load();
  const address = contractAddress || entry.address;
  if (!address) throw new Error(`No address for ${contractName}`);

  const zkBaseUrl = entry.zkBaseUrl
    || `${window.location.origin}/StreamingAssets/zk/${entry.name}/`;

  // ... existing setupProviders / findDeployedContract flow, but parameterized:
  const deployed = await findDeployedContract(providers, { contractAddress: address, contract: new Contract(witnesses) });
  const tx = await deployed.callTx[circuitName](...args);

  return { success: true, txHash: tx.public.txHash, result: tx.public };
}

async function readContract(
  contractName: string,
  contractAddress?: string,
): Promise<{ success: boolean; state?: Record<string, any>; error?: string }> {
  const entry = contractRegistry[contractName];
  if (!entry) throw new Error(`Unknown contract: ${contractName}`);

  const { ledger } = await entry.load();
  const address = contractAddress || entry.address!;

  const contractState = await publicDataProvider.queryContractState(address);
  const decoded = ledger(contractState.data);
  return { success: true, state: entry.decodeState(decoded) };
}
```

Existing `incrementCounter` / `readCounter` become thin shims:

```ts
export const incrementCounter = (addr?: string) => callContract('counter', 'increment', [], addr);
export const readCounter = (addr?: string) => readContract('counter', addr).then(r => ({
  success: r.success, counter: r.state?.round ?? null, error: r.error
}));
```

This preserves backwards compatibility for the existing Unity C# `MidnightSDK.IncrementCounter()` / `ReadCounter()` API.

### 4. Unity C# side

Two new methods on `MidnightSDK`:

```csharp
// Generic call
MidnightSDK.CallContract(
    contractName: "myDao",
    circuit: "vote",
    argsJson: "[\"proposalId\", true]",
    onSuccess: result => Debug.Log($"TX: {result.TxHash}"),
    onError: error => Debug.LogError(error)
);

// Generic read
MidnightSDK.ReadContract<MyDaoState>(
    contractName: "myDao",
    onSuccess: state => Debug.Log($"Votes: {state.YesVotes}"),
    onError: error => Debug.LogError(error)
);
```

Where `MyDaoState` is a user-defined POCO matching `decodeState` output, deserialized from JSON.

### 5. Optional: contract registration from C#

For runtime-supplied contracts (e.g. address discovered at runtime), expose:

```csharp
MidnightSDK.RegisterContract(new ContractRegistration {
    Name = "myDao",
    Address = "abc123...",
    PackageImportPath = "@my-org/my-dao-contract",   // npm-installed, bundled
    DecodeStateJs = "decoded => ({ yes: Number(decoded.yes), no: Number(decoded.no) })",
});
```

The bridge does a dynamic `import()` against the path. Implication: the contract package **must already be in the bundle** (esbuild-time decision) — runtime registration only changes which entry of pre-bundled options is used. True runtime contract loading from arbitrary URLs is **not viable** because:

- Contracts ship a `compactRuntime` dependency that's resolved at bundle time, not at runtime.
- ZK keys are large binary assets that need to be served at known paths.

Therefore **the bundle must be rebuilt to add a brand-new contract**, but the *Unity side* doesn't need to change — just registration metadata.

---

## Workflow for a developer adding a contract

### Phase 1 — author the contract

```bash
# 1. Write your_contract.compact
compactc your_contract.compact -o ./compiled
# produces compiled/managed/<name>/contract/index.js + ZK artifacts
```

### Phase 2 — vendor it into the bridge

```bash
cp -r compiled/ web/midnight-bridge/vendor/<name>/
# update web/midnight-bridge/package.json:
#   "dependencies": { "@your-org/<name>-contract": "file:vendor/<name>" }
npm install --legacy-peer-deps
```

### Phase 3 — copy ZK keys

```bash
mkdir -p Assets/StreamingAssets/zk/<name>/keys
mkdir -p Assets/StreamingAssets/zk/<name>/zkir
cp web/midnight-bridge/vendor/<name>/managed/<name>/keys/* Assets/StreamingAssets/zk/<name>/keys/
cp web/midnight-bridge/vendor/<name>/managed/<name>/zkir/* Assets/StreamingAssets/zk/<name>/zkir/
# AND mirror to Assets/WebGLTemplates/MidnightTemplate/TemplateData/zk/<name>/  for editor preview
```

### Phase 4 — register

Add a new entry to `web/midnight-bridge/src/contracts/registry.ts`:

```ts
import('your-contract').then(mod => registerContract({
  name: 'your-contract',
  address: '<deployed-address>',
  load: async () => ({
    Contract: mod.YourContract.Contract,
    witnesses: mod.witnesses,
    ledger: mod.YourContract.ledger,
  }),
  decodeState: (d) => ({ /* shape your way */ }),
}));
```

### Phase 5 — rebuild + Unity

```bash
cd web/midnight-bridge && npm run build:copy
# then in Unity: bump cache-bust ?v= in index.html, build WebGL, serve
```

From C#:

```csharp
MidnightSDK.CallContract("your-contract", "myCircuit", argsJson, onSuccess, onError);
```

---

## Implementation roadmap

| Phase | Scope | Risk |
|---|---|---|
| **0 — Spike** ✅ done | Counter contract works end-to-end with hard-coded path | — |
| **1 — Refactor to registry** | Extract `loadCounterPackages` → `loadContract(name)`. Move counter into `contractRegistry.counter`. No external API change. | Low — pure refactor with `incrementCounter`/`readCounter` as shims |
| **2 — Generic JS API** | Add `callContract` / `readContract` exports on `window.MidnightSDK`. Existing exports remain. | Low |
| **3 — Generic Unity API** | Add `MidnightSDK.CallContract` / `ReadContract<T>` C# methods + matching `.jslib` shims | Medium — argument JSON serialization needs care for BigInt / contract types |
| **4 — Documentation + example** | Add a second example contract (e.g. simple key-value store) to prove the path works for non-counter contracts | Medium — first non-counter contract will hit unanticipated edge cases |
| **5 — Runtime registration** | `RegisterContract` from C# for already-bundled packages | Low |
| **6 — Tooling** | A `scripts/add-contract.mjs` helper that automates Phase 1–4 of the developer workflow above | Low |

---

## Known constraints & non-goals

### Things this design **doesn't** solve

- **Dynamic on-chain contract download.** Compact contracts compile to JS + WASM that must be in the bundle. This is a fundamental constraint of the `@midnight-ntwrk/midnight-js-contracts` SDK; not a bridge limitation.
- **Cross-version contract compatibility.** A contract compiled with `compactc +0.30.0` cannot run inside a bridge built against `compact-runtime 0.16.0`. The version-pin matrix in [`web/midnight-bridge/README.md`](web/midnight-bridge/README.md) still applies per contract.
- **Wallet permission scoping.** Each `callContract` requires a wallet popup and full v4 authorization. No bulk approval.
- **Multi-contract atomic transactions.** Each circuit call is its own transaction; the bridge does not currently compose multiple contract calls into a single tx.

### Things that need investigation before Phase 1

1. **`@midnight-ntwrk/counter-contract` peer-dep alignment.** The vendored counter contract pulls `compact-runtime` as a peer dependency that needs to dedupe with the bridge's. New contracts may introduce conflicts.
2. **ZK fetch-provider URL templating.** The current `FixedZkConfigProvider` (`@/Users/.../midnight-unity-bridge.ts:2288-2403`) is parameterized by base URL but still names its keys after `increment`. Generalizing requires a `circuit → key-file` mapping per contract.
3. **`getProvingProvider` shape.** 1AM exposes a proving provider whose `proveTx` method differs from what `midnight-js-http-client-proof-provider` expects. Wallet-side proving (skipping the remote proof server) is not yet wired up — investigation needed before Phase 2 to decide whether `callContract` should opt-in to wallet proving when available.

---

## Open questions for the next session

1. **Should `decodeState` live in JS or be configurable from C#?** The advantage of JS is direct access to `bigint`. The advantage of C# is keeping contract-specific code with the game.
2. **Should we standardize an `IContract<TState, TArgs>` C# interface** to give the user IDE-typed contract bindings, or stay JSON-shaped?
3. **Witness functions are user-supplied JS.** What's the safe way for a Unity dev who doesn't write JS to author them? Likely need a "pure-state-only contract" template that has no witnesses (counter is one).

---

## Cross-references

- `README.md` — top-level project doc, links here.
- `web/midnight-bridge/README.md` — version-pin matrix that any new contract must respect.
- `web/midnight-bridge/src/midnight-unity-bridge.ts` — bridge to be refactored.
- `@/Users/.../web/midnight-bridge/vendor/counter-contract/` — reference vendored contract.
- `@/Users/.../Assets/StreamingAssets/zk/counter/` — reference ZK key layout.

