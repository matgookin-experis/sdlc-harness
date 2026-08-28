import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { mergeConfig, mergeMcpJson, mergeModes } from './merge-bob-config.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Create a temporary Bob directory for an isolated test.
 * @returns {string} Temporary Bob directory.
 */
function createBobDir() {
  const root = mkdtempSync(join(tmpdir(), 'sdlc-bob-config-'));
  const bobDir = join(root, '.bob');
  mkdirSync(join(bobDir, 'settings'), { recursive: true });
  return bobDir;
}

/**
 * Verify MCP JSON merging and failure safety.
 * @returns {void}
 */
function testMcpMerge() {
  const bobDir = createBobDir();
  const path = join(bobDir, 'settings', 'mcp.json');

  try {
    writeFileSync(path, JSON.stringify({
      mcpServers: {
        existing: { command: 'keep' },
        'sdlc-harness': { command: 'stale' },
      },
    }));
    mergeMcpJson(projectRoot, bobDir);
    const first = JSON.parse(readFileSync(path, 'utf-8'));
    assert.equal(first.mcpServers.existing.command, 'keep');
    assert.equal(first.mcpServers['sdlc-harness'].command, 'node');

    mergeMcpJson(projectRoot, bobDir);
    const second = JSON.parse(readFileSync(path, 'utf-8'));
    assert.deepEqual(second, first);

    const invalid = '{ invalid json';
    writeFileSync(path, invalid);
    assert.throws(() => mergeMcpJson(projectRoot, bobDir));
    assert.equal(readFileSync(path, 'utf-8'), invalid);
  } finally {
    rmSync(dirname(bobDir), { recursive: true, force: true });
  }
}

/**
 * Verify custom-mode YAML merging and failure safety.
 * @returns {void}
 */
function testModeMerge() {
  const bobDir = createBobDir();
  const path = join(bobDir, 'settings', 'custom_modes.yaml');
  const existing = [
    'customModes:',
    '  - slug: existing-mode',
    '    name: Existing',
    '  - slug: sdlc-harness',
    '    name: Stale',
    'unrelatedSetting: true',
    '',
  ].join('\n');

  try {
    writeFileSync(path, existing);
    mergeModes(projectRoot, bobDir);
    const firstText = readFileSync(path, 'utf-8');
    const first = parse(firstText);
    assert.equal(first.unrelatedSetting, true);
    assert.equal(first.customModes.filter((mode) => mode.slug === 'sdlc-harness').length, 1);
    assert.equal(first.customModes.find((mode) => mode.slug === 'sdlc-harness').name, '🔧 SDLC Harness');
    assert.equal(first.customModes.find((mode) => mode.slug === 'existing-mode').name, 'Existing');

    mergeModes(projectRoot, bobDir);
    const second = parse(readFileSync(path, 'utf-8'));
    assert.equal(second.customModes.filter((mode) => mode.slug === 'sdlc-harness').length, 1);

    const invalid = 'customModes: [unterminated';
    writeFileSync(path, invalid);
    assert.throws(() => mergeModes(projectRoot, bobDir));
    assert.equal(readFileSync(path, 'utf-8'), invalid);
  } finally {
    rmSync(dirname(bobDir), { recursive: true, force: true });
  }
}

/**
 * Verify all configuration is validated before either destination is changed.
 * @returns {void}
 */
function testFailureAtomicValidation() {
  const bobDir = createBobDir();
  const mcpPath = join(bobDir, 'settings', 'mcp.json');
  const modesPath = join(bobDir, 'settings', 'custom_modes.yaml');
  const originalMcp = JSON.stringify({ mcpServers: { existing: { command: 'keep' } } });

  try {
    writeFileSync(mcpPath, originalMcp);
    writeFileSync(modesPath, 'customModes: [unterminated');
    assert.throws(() => mergeConfig(projectRoot, bobDir));
    assert.equal(readFileSync(mcpPath, 'utf-8'), originalMcp);
  } finally {
    rmSync(dirname(bobDir), { recursive: true, force: true });
  }
}

testMcpMerge();
testModeMerge();
testFailureAtomicValidation();
process.stdout.write('Bob config merge tests passed.\n');
