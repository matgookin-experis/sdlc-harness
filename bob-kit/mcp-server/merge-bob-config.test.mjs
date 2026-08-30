import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import {
  mergeConfig,
  mergeMcpJson,
  mergeModes,
  unmergeConfig,
  unmergeMcpJson,
  unmergeModes,
} from './merge-bob-config.mjs';

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
 * Read a file's POSIX permission bits.
 * @param {string} path - File path.
 * @returns {number} Permission bits.
 */
function fileMode(path) {
  return statSync(path).mode & 0o777;
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
    assert.equal(
      first.mcpServers['sdlc-harness'].env.SDLC_ENV_FILE,
      join(projectRoot, '.env'),
    );
    assert.equal(
      first.mcpServers['sdlc-harness'].env.SDLC_PROJECT_CONFIG,
      join(projectRoot, '.sdlc-harness.json'),
    );
    assert.equal(
      isAbsolute(first.mcpServers['sdlc-harness'].env.SDLC_PROJECT_CONFIG),
      true,
    );

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
 * Verify atomic replacements preserve restrictive modes and never exceed 0600.
 * @returns {void}
 */
function testFileModes() {
  const restrictiveDir = createBobDir();
  const freshDir = createBobDir();
  const permissiveDir = createBobDir();
  const restrictiveMcp = join(restrictiveDir, 'settings', 'mcp.json');
  const restrictiveModes = join(restrictiveDir, 'settings', 'custom_modes.yaml');
  const freshMcp = join(freshDir, 'settings', 'mcp.json');
  const freshModes = join(freshDir, 'settings', 'custom_modes.yaml');
  const permissiveMcp = join(permissiveDir, 'settings', 'mcp.json');

  try {
    // Windows/NTFS has no POSIX permission bits — chmod only toggles the DOS
    // read-only attribute, which stat reports back as 0o444 (read-only) or
    // 0o666 (writable), never the exact requested bits.
    const restrictedMode = process.platform === 'win32' ? 0o444 : 0o400;
    const writableMode = process.platform === 'win32' ? 0o666 : 0o600;

    writeFileSync(restrictiveMcp, '{}');
    writeFileSync(restrictiveModes, 'customModes: []\n');
    chmodSync(restrictiveMcp, 0o400);
    chmodSync(restrictiveModes, 0o400);
    mergeConfig(projectRoot, restrictiveDir);
    assert.equal(fileMode(restrictiveMcp), restrictedMode);
    assert.equal(fileMode(restrictiveModes), restrictedMode);

    mergeConfig(projectRoot, freshDir);
    assert.equal(fileMode(freshMcp), writableMode);
    assert.equal(fileMode(freshModes), writableMode);

    writeFileSync(permissiveMcp, '{}');
    chmodSync(permissiveMcp, 0o644);
    mergeMcpJson(projectRoot, permissiveDir);
    assert.equal(fileMode(permissiveMcp), writableMode);
  } finally {
    rmSync(dirname(restrictiveDir), { recursive: true, force: true });
    rmSync(dirname(freshDir), { recursive: true, force: true });
    rmSync(dirname(permissiveDir), { recursive: true, force: true });
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

/**
 * Verify MCP JSON un-merging: removes only the sdlc-harness entry, is a
 * no-op when the file is absent or the entry was never present.
 * @returns {void}
 */
function testMcpUnmerge() {
  const bobDir = createBobDir();
  const path = join(bobDir, 'settings', 'mcp.json');

  try {
    // No-op when the file doesn't exist at all -- must not create one.
    unmergeMcpJson(bobDir);
    assert.equal(existsSync(path), false);

    writeFileSync(path, JSON.stringify({
      mcpServers: {
        existing: { command: 'keep' },
        'sdlc-harness': { command: 'node' },
      },
    }));
    unmergeMcpJson(bobDir);
    const after = JSON.parse(readFileSync(path, 'utf-8'));
    assert.equal(after.mcpServers.existing.command, 'keep');
    assert.equal(Object.hasOwn(after.mcpServers, 'sdlc-harness'), false);

    // Idempotent: already-removed is a silent no-op, not an error.
    unmergeMcpJson(bobDir);
    const second = JSON.parse(readFileSync(path, 'utf-8'));
    assert.deepEqual(second, after);
  } finally {
    rmSync(dirname(bobDir), { recursive: true, force: true });
  }
}

/**
 * Verify custom-mode YAML un-merging: removes only the sdlc-harness mode,
 * is a no-op when the file is absent or the mode was never present.
 * @returns {void}
 */
function testModeUnmerge() {
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
    // No-op when the file doesn't exist at all -- must not create one.
    unmergeModes(bobDir);
    assert.equal(existsSync(path), false);

    writeFileSync(path, existing);
    unmergeModes(bobDir);
    const after = parse(readFileSync(path, 'utf-8'));
    assert.equal(after.unrelatedSetting, true);
    assert.equal(after.customModes.some((mode) => mode.slug === 'sdlc-harness'), false);
    assert.equal(after.customModes.find((mode) => mode.slug === 'existing-mode').name, 'Existing');

    // Idempotent: already-removed is a silent no-op, not an error.
    unmergeModes(bobDir);
    const second = parse(readFileSync(path, 'utf-8'));
    assert.deepEqual(second, after);
  } finally {
    rmSync(dirname(bobDir), { recursive: true, force: true });
  }
}

/**
 * Verify unmergeConfig composes both removals against a real merged state.
 * @returns {void}
 */
function testUnmergeConfig() {
  const bobDir = createBobDir();
  const mcpPath = join(bobDir, 'settings', 'mcp.json');
  const modesPath = join(bobDir, 'settings', 'custom_modes.yaml');

  try {
    mergeMcpJson(projectRoot, bobDir);
    mergeModes(projectRoot, bobDir);
    unmergeConfig(bobDir);

    const mcp = JSON.parse(readFileSync(mcpPath, 'utf-8'));
    assert.equal(Object.hasOwn(mcp.mcpServers, 'sdlc-harness'), false);
    const modes = parse(readFileSync(modesPath, 'utf-8'));
    assert.equal(modes.customModes.some((mode) => mode.slug === 'sdlc-harness'), false);
  } finally {
    rmSync(dirname(bobDir), { recursive: true, force: true });
  }
}

testMcpMerge();
testModeMerge();
testFailureAtomicValidation();
testMcpUnmerge();
testModeUnmerge();
testUnmergeConfig();
testFileModes();
process.stdout.write('Bob config merge tests passed.\n');
