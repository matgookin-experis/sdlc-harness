#!/usr/bin/env node
/**
 * merge-bob-config.mjs — MERGE-ONLY installer for Bob global config.
 *
 * Bob's configuration lives in ~/.bob/:
 *   - mcp.json         : MCP server registrations
 *   - custom_modes.yaml: custom Bob modes
 *
 * This script merges the sdlc-harness entries INTO those files without
 * overwriting unrelated existing config. It is safe to run multiple times
 * (idempotent — re-running is a no-op if already installed).
 *
 * Usage (from the mcp-server directory):
 *   node merge-bob-config.mjs
 * Or via install.sh which calls it automatically.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const BOB_DIR = join(homedir(), ".bob");
const MCP_JSON_PATH = join(BOB_DIR, "mcp.json");
const MODES_YAML_PATH = join(BOB_DIR, "custom_modes.yaml");

// ---------------------------------------------------------------------------
// sdlc-harness MCP server entry
// ---------------------------------------------------------------------------

const SDLC_SERVER_ENTRY = {
  "sdlc-harness": {
    "type": "stdio",
    "command": "node",
    "args": ["<REPLACE_WITH_ABSOLUTE_PATH_TO>/mcp-server/dist/index.js"],
    "env": {
      "SDLC_ENV_FILE": "<REPLACE_WITH_ABSOLUTE_PATH_TO>/.env"
    }
  }
};

// ---------------------------------------------------------------------------
// sdlc-harness custom mode entry (YAML fragment)
// ---------------------------------------------------------------------------

const SDLC_MODE_YAML = `
- slug: sdlc-harness
  name: "🔧 SDLC Harness"
  roleDefinition: |
    You are an SDLC governance agent for the sdlc-harness project.
    Your job is to monitor GitLab work items and propose quality improvements:
    drafting missing acceptance criteria, flagging ambiguous descriptions,
    suggesting dependency links, and recommending state transitions.
    Always present proposals for human review — never apply changes without approval.
  groups:
    - read
    - edit
    - mcp
  source: project
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureBobDir() {
  if (!existsSync(BOB_DIR)) {
    mkdirSync(BOB_DIR, { recursive: true });
    console.log(`Created ~/.bob directory.`);
  }
}

// ---------------------------------------------------------------------------
// mcp.json merge
// ---------------------------------------------------------------------------

function mergeMcpJson(absoluteProjectPath) {
  let existing = {};
  if (existsSync(MCP_JSON_PATH)) {
    try {
      existing = JSON.parse(readFileSync(MCP_JSON_PATH, "utf-8"));
    } catch {
      console.warn(`Warning: could not parse existing ${MCP_JSON_PATH} — will merge carefully.`);
    }
  }

  const servers = existing.mcpServers ?? existing.servers ?? {};

  if (servers["sdlc-harness"]) {
    console.log(`✓ sdlc-harness already present in mcp.json — skipping.`);
    return;
  }

  // Resolve paths
  const entry = JSON.parse(JSON.stringify(SDLC_SERVER_ENTRY));
  const indexPath = join(absoluteProjectPath, "mcp-server", "dist", "index.js");
  const envPath = join(absoluteProjectPath, ".env");

  entry["sdlc-harness"].args[0] = indexPath;
  entry["sdlc-harness"].env["SDLC_ENV_FILE"] = envPath;

  const merged = {
    ...existing,
    mcpServers: {
      ...servers,
      ...entry,
    },
  };

  writeFileSync(MCP_JSON_PATH, JSON.stringify(merged, null, 2) + "\n", "utf-8");
  console.log(`✓ Merged sdlc-harness into ${MCP_JSON_PATH}`);
}

// ---------------------------------------------------------------------------
// custom_modes.yaml merge
// ---------------------------------------------------------------------------

function mergeModes() {
  let existing = "";
  if (existsSync(MODES_YAML_PATH)) {
    existing = readFileSync(MODES_YAML_PATH, "utf-8");
  }

  if (existing.includes("slug: sdlc-harness")) {
    console.log(`✓ sdlc-harness mode already present in custom_modes.yaml — skipping.`);
    return;
  }

  // Append the mode entry — YAML arrays can be concatenated safely
  const updated = existing.trimEnd() + "\n" + SDLC_MODE_YAML;
  writeFileSync(MODES_YAML_PATH, updated, "utf-8");
  console.log(`✓ Merged sdlc-harness mode into ${MODES_YAML_PATH}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const projectPath = process.argv[2] ?? process.cwd();

console.log("sdlc-harness Bob config merge");
console.log("==============================");
console.log(`Project path : ${projectPath}`);
console.log(`Bob dir      : ${BOB_DIR}`);
console.log("");

ensureBobDir();
mergeMcpJson(projectPath);
mergeModes();

console.log("");
console.log("Done. Restart Bob to pick up the new MCP server and mode.");
