#!/usr/bin/env node
// Validate the Git index, not ignored local dependencies or user data.
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const files = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
const forbidden = [
  /(^|\/)(?:node_modules|target|dist|dist-ssr|data|coverage|test-results|playwright-report|__pycache__|\.codex|\.claude|\.codex-artifacts|\.pnpm-store|\.openagent-validation|\.codegraph|\.liveagent|\.openagent|\.vscode|\.idea)(?:\/|$)/,
  /^crates\/agent-gateway\//,
  /^\.github\/pr-assets\//,
  /^scripts\/(?:testing\/|prepare-gateway\.mjs$)/,
  /\.(?:exe|dll|pdb|msi|sqlite3?|db|log|pem|pfx|p12|key)$/i,
  /(^|\/)\.env(?:\.(?!example$).*)?$/,
];
const unexpected = files.filter((file) => forbidden.some((pattern) => pattern.test(file)));
if (unexpected.length) {
  console.error(`Files outside the product source scope:\n${unexpected.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(`Source scope passed: ${files.length} tracked source, resource and development files.`);
}
