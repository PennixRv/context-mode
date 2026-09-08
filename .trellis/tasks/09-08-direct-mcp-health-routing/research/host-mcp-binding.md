# Host MCP binding evidence

## Observation

The current resumed Codex process is an existing thread. Its injected tool
schema contains no `mcp__openviking__*` functions even though the host MCP
configuration enables OpenViking and provides the bearer-token environment
variable. The configuration is visible through `codex mcp get openviking`, and
the environment variable is present in both the current and login shells.

A separately started native Codex diagnostic thread reported:

```text
openviking: connected (7 tools)
```

The configured tools were `health`, `find`, `search`, `recall`, `read`, `list`,
and `remember`. This proves the server, transport, and credential binding are
working for a new client/thread.

## Conclusion

The missing functions are a current-thread schema boundary, not an
OpenViking health or credential failure. A resumed thread does not acquire
newly available MCP functions dynamically. context-mode runs after the Codex
tool schema is established and cannot add MCP functions; the operational fix
is to start a new native Codex thread after MCP configuration changes.

## Scope consequence

No host configuration, OpenViking server, credential, or context-mode schema
probe is needed for Issue 178. The component fix only corrects redirect
guidance so it prefers a callable direct protocol and reports a missing
capability instead of prescribing a shell HTTP workaround.
