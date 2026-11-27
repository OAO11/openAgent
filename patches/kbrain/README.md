# openAgent K-brain extension

`openagent-roles.patch` applies to K-brain revision `02cd80037809790478281e986a2d3b1004737c32`. The base remains K-brain under its existing Apache-2.0 license. This patch adds product-specific prompt-template roles to its existing resource store, HTTP API and `subagent` tool; no additional backend service or duplicate role database is introduced.

A template can independently be the single global parent prompt and/or an enabled subagent role. Enabled role names and descriptions are offered to the parent; their prompt bodies are added only to children that explicitly select the role. A role can select a configured provider/model and reasoning effort. Missing or disabled roles and unresolved models fail explicitly. Existing child tool policy inheritance remains in place.

The patch includes Go tests for normalization, persistence, API updates, role selection, model/reasoning application and child prompt isolation. Desktop integration tests additionally drive the real backend through a local model-response fixture.

The SHA-256 of the patch is recorded in `scripts/release/kbrain.lock.json`. `build-kbrain-source.mjs` clones a detached checkout at the locked revision, checks/applies each locked patch, builds both K-brain executables and records the revision, patches and binary hashes in `.liveagent/kbrain-artifact/kbrain-artifact.json`. `prepare-kbrain.mjs` verifies this manifest and creates the prepared sidecar receipt. Patched configurations never fall back to an unpatched release download or arbitrary development binary override.

To rebuild from the local reference checkout (without changing that checkout):

```powershell
node scripts/release/build-kbrain-source.mjs --source-dir ..\K-brain
npx.cmd --yes pnpm@10.32.1 preview:build
```

When changing this patch, update its SHA-256 in the lock, rebuild the source artifact, run the included Go tests and `crates/agent-gui/test/settings/prompts-backend.test.mjs`, then verify the packaged sidecars with `verify-kbrain-packaging.mjs`. When upgrading the locked base, rebase and review this patch explicitly before accepting the new artifact.

## Local desktop product profile

The same patch removes SSHManager and TunnelManager registration, SSH HTTP routes and remote host-bridge commands. The authenticated loopback bridge only advertises ReadTerminal. Client tool declarations cannot reintroduce the reserved remote tools.

With `OPENAGENT_BUILTIN_PROMPTS=1`, the prompt store seeds eight editable Chinese role templates once. Existing IDs and the global enable flag are preserved; edits and deletions persist across restart. Seed templates and their version marker are saved atomically. The MIT-licensed agency-agents source attribution and full license are embedded alongside the presets; see `resources/prompts/README.md`.

## Plugin management

The experimental GitHub plugin store was removed on 2026-11-26 at the product owner's request. Its frontend, backend store routes and archive download/install code are no longer included. Existing local-folder plugin installation, listing, enable/disable, removal and sandboxed panels remain available. MCP and Skills stores and their Chinese reading translations are unaffected.
