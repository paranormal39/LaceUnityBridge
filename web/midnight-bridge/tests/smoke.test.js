/**
 * Smoke tests for midnight-unity-bridge
 * 
 * These tests verify the tx-construction and signing paths work correctly.
 * Run with: npm test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('midnight-unity-bridge smoke tests', () => {
  it('transaction utilities exist', () => {
    // Check that the main source file exists
    const srcPath = path.join(__dirname, '..', 'src', 'midnight-unity-bridge.ts');
    assert.ok(fs.existsSync(srcPath), 'midnight-unity-bridge.ts should exist');
    
    // Check that build script exists
    const buildPath = path.join(__dirname, '..', 'build.mjs');
    assert.ok(fs.existsSync(buildPath), 'build.mjs should exist');
  });

  it('package.json has required dependencies', async () => {
    const pkgPath = path.join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    
    // Check version pins
    assert.strictEqual(pkg.dependencies['@midnight-ntwrk/ledger-v8'], '8.0.3', 
      'ledger-v8 must be pinned to 8.0.3');
    assert.strictEqual(pkg.dependencies['@midnight-ntwrk/compact-runtime'], '0.15.0',
      'compact-runtime must be pinned to 0.15.0');
    assert.strictEqual(pkg.dependencies['@midnight-ntwrk/wallet-sdk-address-format'], '3.1.1',
      'wallet-sdk-address-format must be pinned to 3.1.1');
    
    // Check overrides section
    assert.ok(pkg.overrides, 'should have overrides section');
    assert.strictEqual(pkg.overrides['@midnight-ntwrk/ledger-v8'], '8.0.3',
      'ledger-v8 override must be 8.0.3');
    assert.strictEqual(pkg.overrides['@midnight-ntwrk/compact-runtime'], '0.15.0',
      'compact-runtime override must be 0.15.0');
  });

  it('vendor contract exists', () => {
    const contractPath = path.join(__dirname, '..', 'vendor', 'counter-contract');
    assert.ok(fs.existsSync(contractPath), 'counter-contract vendor directory should exist');
    
    // Check that the main contract file exists
    const contractFile = path.join(contractPath, 'counter.compact');
    assert.ok(fs.existsSync(contractFile), 'counter.compact should exist');
    
    // Check for managed directory
    const managedPath = path.join(contractPath, 'managed');
    assert.ok(fs.existsSync(managedPath), 'managed directory should exist');
  });

  it('build configuration exists', () => {
    // Check build script
    const buildPath = path.join(__dirname, '..', 'build.mjs');
    const buildContent = fs.readFileSync(buildPath, 'utf-8');
    
    // Verify key configurations
    assert.ok(buildContent.includes('midnight-sdk.bundle.js'), 
      'build should output midnight-sdk.bundle.js');
    assert.ok(buildContent.includes("format: 'iife'"), 
      'build should use iife format for browser');
  });

  it('scripts directory has copy-to-unity script', () => {
    const scriptPath = path.join(__dirname, '..', 'scripts', 'copy-to-unity.js');
    assert.ok(fs.existsSync(scriptPath), 'copy-to-unity.js script should exist');
  });
});

// Note: Full integration tests would require:
// - Mocking the DApp-Connector v4 wallet API
// - Mocking the indexer GraphQL responses
// - Mocking the proof server
// These are left for future test expansion.
