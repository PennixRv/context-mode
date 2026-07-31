---
name: ctx-upgrade
description: |
  Update context-mode from GitHub and fix hooks/settings.
  Pulls latest, builds, installs, updates npm global, configures hooks.
  Trigger: /context-mode:ctx-upgrade
user-invocable: true
---

# Context Mode Upgrade

Pull latest from GitHub and reinstall the plugin.

## Instructions

1. For Codex marketplace-managed installs, update through the configured marketplace and plugin version. Do not use `ctx_upgrade` to clone or globally replace the plugin.
2. For other supported installations, call the `ctx_upgrade` MCP tool directly. It returns a shell command to execute.
3. Run the returned command using your shell execution tool (Bash, shell_execute, etc.).
4. Display results as a markdown checklist:
   ```
   ## context-mode upgrade
   - [x] Pulled latest from GitHub
   - [x] Built and installed v1.0.39
   - [x] Hooks configured
   - [x] Doctor: all checks PASS
   ```
   Use `[x]` for success, `[ ]` for failure. Show actual version numbers.
5. Tell the user to **restart their session** to pick up the new version.
6. **Fallback** (only if MCP tool call fails, and never for a Codex marketplace install): Derive the **plugin root** from this skill's base directory (go up 2 levels — remove `/skills/ctx-upgrade`), then run with Bash:
   ```
   CLI="<PLUGIN_ROOT>/cli.bundle.mjs"; [ ! -f "$CLI" ] && CLI="<PLUGIN_ROOT>/build/cli.js"; node "$CLI" upgrade
   ```
