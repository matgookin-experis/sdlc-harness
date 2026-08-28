#!/usr/bin/env node
/**
 * Safely merge the MCP server into ~/.bob/settings/mcp.json and the custom mode into
 * ~/.bob/settings/custom_modes.yaml.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMap, isSeq, parseDocument } from 'yaml';

const DEFAULT_BOB_DIR = process.env.SDLC_BOB_DIR ?? join(homedir(), '.bob');

/**
 * Ensure a directory exists.
 * @param {string} path - Directory path.
 * @returns {void}
 */
function ensureDir(path) {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

/**
 * Atomically replace a file using a temporary sibling file.
 * @param {string} path - Destination path.
 * @param {string} content - New file content.
 * @returns {void}
 */
function atomicWrite(path, content) {
  ensureDir(dirname(path));
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;

  try {
    writeFileSync(tempPath, content, 'utf-8');
    renameSync(tempPath, path);
  } catch (error) {
    if (existsSync(tempPath)) {
      unlinkSync(tempPath);
    }
    throw error;
  }
}

/**
 * Read a JSON object without accepting malformed or non-object content.
 * @param {string} path - JSON file path.
 * @returns {Record<string, unknown>}
 */
function readJsonObject(path) {
  if (!existsSync(path)) {
    return {};
  }

  const parsed = JSON.parse(readFileSync(path, 'utf-8'));
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${path} must contain a JSON object.`);
  }

  return parsed;
}

/**
 * Read and validate a YAML document.
 * @param {string} text - YAML source.
 * @param {string} label - Source label for errors.
 * @returns {import('yaml').Document}
 */
function parseYaml(text, label) {
  const document = parseDocument(text);
  if (document.errors.length > 0) {
    throw new Error(`${label} contains invalid YAML: ${document.errors[0]?.message}`);
  }
  return document;
}

/**
 * Return the customModes sequence, creating or normalizing it when safe.
 * @param {import('yaml').Document} document - Parsed YAML document.
 * @param {string} label - Source label for errors.
 * @returns {import('yaml').YAMLSeq}
 */
function getModes(document, label) {
  if (document.contents === null) {
    document.contents = document.createNode({ customModes: [] });
  } else if (isSeq(document.contents)) {
    document.contents = document.createNode({ customModes: document.contents.toJSON() });
  }

  if (!isMap(document.contents)) {
    throw new Error(`${label} must contain a top-level mapping.`);
  }

  if (!document.has('customModes')) {
    document.set('customModes', []);
  }

  const modes = document.get('customModes', true);
  if (!isSeq(modes)) {
    throw new Error(`${label} customModes must be a sequence.`);
  }

  return modes;
}

/**
 * Prepare the merged MCP configuration without writing it.
 * @param {string} projectRoot - Absolute repository root.
 * @param {string} [bobDir] - Bob configuration root.
 * @returns {{ path: string, content: string }} Prepared file.
 */
function prepareMcpJson(projectRoot, bobDir = DEFAULT_BOB_DIR) {
  const path = join(bobDir, 'settings', 'mcp.json');
  const existing = readJsonObject(path);
  const key = Object.hasOwn(existing, 'mcpServers')
    ? 'mcpServers'
    : Object.hasOwn(existing, 'servers')
      ? 'servers'
      : 'mcpServers';
  const value = existing[key] ?? {};

  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} ${key} must be a JSON object.`);
  }

  const servers = value;
  const entry = {
    type: 'stdio',
    command: 'node',
    args: [join(projectRoot, 'bob-kit', 'mcp-server', 'dist', 'index.js')],
    env: {
      SDLC_ENV_FILE: join(projectRoot, '.env'),
    },
  };
  const merged = {
    ...existing,
    [key]: {
      ...servers,
      'sdlc-harness': entry,
    },
  };

  return { path, content: `${JSON.stringify(merged, null, 2)}\n` };
}

/**
 * Merge the MCP server registration while preserving unrelated entries.
 * @param {string} projectRoot - Absolute repository root.
 * @param {string} [bobDir] - Bob configuration root.
 * @returns {void}
 */
export function mergeMcpJson(projectRoot, bobDir = DEFAULT_BOB_DIR) {
  const prepared = prepareMcpJson(projectRoot, bobDir);
  atomicWrite(prepared.path, prepared.content);
}

/**
 * Prepare the merged custom-mode configuration without writing it.
 * @param {string} projectRoot - Absolute repository root.
 * @param {string} [bobDir] - Bob configuration root.
 * @returns {{ path: string, content: string }} Prepared file.
 */
function prepareModes(projectRoot, bobDir = DEFAULT_BOB_DIR) {
  const sourcePath = join(projectRoot, 'bob-kit', 'custom_modes.yaml');
  const targetPath = join(bobDir, 'settings', 'custom_modes.yaml');
  const sourceDocument = parseYaml(readFileSync(sourcePath, 'utf-8'), sourcePath);
  const sourceModes = getModes(sourceDocument, sourcePath);
  const sourceMode = sourceModes.items.find(
    (item) => isMap(item) && item.get('slug') === 'sdlc-harness',
  );

  if (!sourceMode) {
    throw new Error(`${sourcePath} does not define the sdlc-harness mode.`);
  }

  const existingText = existsSync(targetPath)
    ? readFileSync(targetPath, 'utf-8')
    : 'customModes: []\n';
  const targetDocument = parseYaml(existingText, targetPath);
  const targetModes = getModes(targetDocument, targetPath);
  const index = targetModes.items.findIndex(
    (item) => isMap(item) && item.get('slug') === 'sdlc-harness',
  );
  const mode = targetDocument.createNode(sourceMode.toJSON());

  if (index >= 0) {
    targetModes.items[index] = mode;
  } else {
    targetModes.add(mode);
  }

  return { path: targetPath, content: targetDocument.toString() };
}

/**
 * Merge the canonical sdlc-harness mode while preserving unrelated YAML data.
 * @param {string} projectRoot - Absolute repository root.
 * @param {string} [bobDir] - Bob configuration root.
 * @returns {void}
 */
export function mergeModes(projectRoot, bobDir = DEFAULT_BOB_DIR) {
  const prepared = prepareModes(projectRoot, bobDir);
  atomicWrite(prepared.path, prepared.content);
}

/**
 * Validate all source and destination configuration before installation.
 * @param {string} projectRoot - Absolute repository root.
 * @param {string} [bobDir] - Bob configuration root.
 * @returns {void}
 */
export function validateConfig(projectRoot, bobDir = DEFAULT_BOB_DIR) {
  prepareMcpJson(projectRoot, bobDir);
  prepareModes(projectRoot, bobDir);
}

/**
 * Prepare both files before writing either one, then apply the merge.
 * @param {string} projectRoot - Absolute repository root.
 * @param {string} [bobDir] - Bob configuration root.
 * @returns {void}
 */
export function mergeConfig(projectRoot, bobDir = DEFAULT_BOB_DIR) {
  const mcp = prepareMcpJson(projectRoot, bobDir);
  const modes = prepareModes(projectRoot, bobDir);
  atomicWrite(mcp.path, mcp.content);
  atomicWrite(modes.path, modes.content);
}

/**
 * Run the command-line config merge.
 * @returns {void}
 */
function main() {
  const isCheck = process.argv[2] === '--check';
  const projectRoot = resolve(process.argv[isCheck ? 3 : 2] ?? process.cwd());
  ensureDir(DEFAULT_BOB_DIR);
  ensureDir(join(DEFAULT_BOB_DIR, 'settings'));
  if (isCheck) {
    validateConfig(projectRoot);
    console.log('Bob configuration is valid for merging.');
    return;
  }

  mergeConfig(projectRoot);
  console.log('Merged sdlc-harness Bob configuration.');
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}
