# Midnight Unity Bridge

TypeScript bridge that compiles to `midnight-sdk.bundle.js` — the runtime dependency for Midnight ZK smart contract interactions from Unity WebGL.

## Version Pinning (Important)

The following SDK versions are **pinned exactly** because the live Midnight Preview network requires them:

| Package | Pinned Version | Why |
|---------|---------------|-----|
| `@midnight-ntwrk/ledger-v8` | `8.0.3` | `^8.x` resolves to 8.1.0 which the live Preview network rejects |
| `@midnight-ntwrk/compact-runtime` | `0.15.0` | Must match the `compactc +0.30.0` output our vendored contract was compiled with |
| `@midnight-ntwrk/wallet-sdk-address-format` | `3.1.1` | Module-load Symbol issue — must dedupe to one copy |

Do not upgrade these without verifying network compatibility first.

## Build

```bash
npm install --legacy-peer-deps
npm run build:copy   # builds + copies to Unity assets
```

## Test

```bash
npm test   # runs Node.js built-in test runner
```

## Architecture

- `src/midnight-unity-bridge.ts` — Main entry point, exports `window.MidnightSDK`
- `build.mjs` — esbuild configuration with WASM inlining and Node polyfills
- `vendor/counter-contract/` — Vendored Compact counter contract compiled with `compactc +0.30.0`

The bundle is a single ~19 MB IIFE that exposes `window.MidnightSDK`. All Node-isms (`Buffer`, `process`, `crypto`, `stream`, `fs`, `path`, `assert`) are polyfilled at build time.
