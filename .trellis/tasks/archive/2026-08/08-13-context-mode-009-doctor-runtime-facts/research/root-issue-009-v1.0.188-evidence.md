# Root Issue 009 v1.0.188 Dynamic Evidence

## Provenance

- Parent integration repository fact commit:
  `7baa0e9` (`docs: record context-mode 1.0.188 dynamic acceptance`).
- Component release: `v1.0.188`.
- Component source/evidence commit supplied by the root workflow:
  `f9a817a76a19aa9555e53d8b3d16a38091ab0ab1`.
- Evidence was supplied by the user and cross-checked against the parent read-only Issue and dynamic
  acceptance files on 2026-08-13. This component task does not modify those parent files.

## Same-Session Comparison

The root workflow installed `v1.0.188`, restarted Codex, and compared the bundled CLI Doctor with
MCP `ctx_doctor` in the same new session.

CLI Doctor observed:

- `installed=true` and `enabled=true`;
- the Git marketplace source root;
- the temporary marketplace cache root;
- the installed versioned Plugin runtime root;
- `runtime_cache_alignment=different_matching_release`; and
- runtime Hook declarations for `PostCompact`, `PreCompact`, `PreToolUse`, and `SessionStart`.

MCP Doctor observed its `1.0.188` version and runtime root, but reported these as unavailable:

- installation;
- source root;
- cache root and cache manifest;
- runtime/cache alignment; and
- current-session Hook loading.

It also rendered Plugin-root, MCP-registration, and current-session-Hook warnings. The actual Hooks
and separate routing acceptance were working, so this is a diagnostic observation defect rather
than evidence of a broken installation.

## Repository Correlation

- `.codex-plugin/mcp.json` fixes `CONTEXT_MODE_PLATFORM=codex` and forwards only the five
  presentation-budget variables.
- `CodexAdapter` resolves config through `CODEX_HOME` or `HOME` and calls `codex plugin list`
  through inherited `PATH`.
- The built-entry-point test passes one complete synthetic environment directly to both CLI and MCP
  children, bypassing the Plugin manifest projection that exists in the real host.
- CLI and MCP Doctor each call Hook validation, structured serialization, and registration methods
  that independently recollect Plugin state, allowing one unavailable capability to produce several
  warning surfaces.

No real credentials, profile configuration, session records, cache contents, or database content
were copied into this evidence file.
