# Clarify direct MCP health routing

## Goal

Make context-mode's HTTP redirect guidance accurately preserve a configured,
callable MCP service's native protocol without weakening the generic protection
against unbounded HTTP output.

## Confirmed Facts

- The curl/wget and inline-HTTP branches in `hooks/core/routing.mjs` replace
  stdout-producing commands with a message that calls all retrieval “public
  web information” and suggests `ctx_execute`.
- The same repository already preserves external MCP tool calls before routing.
  The Hook does not receive a reliable registry of other MCP tools and must not
  infer one from a host, URL, or credential.
- In the user's Codex configuration, OpenViking is enabled with a bounded
  `health` tool. A newly started Codex thread reports the server connected with
  seven tools; the currently resumed thread has no OpenViking tool schema.
- A configured server and a current-thread tool schema are distinct states.
  Codex requires a new thread/client startup to load a changed MCP tool set;
  context-mode cannot retrofit that schema into a resumed thread.

## Requirements

1. Redirect guidance must state the priority of a callable direct MCP/API
   protocol for a configured service, then the public-web retrieval path, then
   the limited explicit HTTP/API-inspection path.
2. When the relevant direct tool is absent, guidance must say to report the
   capability gap. It must not prescribe a transport workaround or assume
   `ctx_execute` is callable.
3. Preserve the existing generic curl/wget and inline-HTTP output protection.
   Do not add an OpenViking special case, host/URL allow list, automatic retry,
   new setting, or schema probe.
4. Align the shipped context-mode Skill's API examples with the direct-protocol
   rule so it no longer gives conflicting route advice.
5. Publish the correction as a normal patch release and provide remote,
   installed, and focused-regression evidence to the parent integration work.

## Acceptance Criteria

- [ ] stdout `curl`, `wget`, and inline HTTP remain redirected; silent
      file-output behavior is unchanged.
- [ ] Both redirect messages say to call a callable direct MCP/API protocol for
      a configured service and to report a missing tool rather than bypassing
      the Hook.
- [ ] The context-mode Skill only recommends `ctx_execute` for an explicit
      direct HTTP/API response inspection with no applicable direct protocol.
- [ ] Focused routing tests, repository typecheck, full test/build, and release
      asset validation pass.
- [ ] A new immutable patch tag is pushed and the normal user installation is
      refreshed from that release; no plugin cache is edited manually.

## Out Of Scope

- Dynamic discovery of external MCP schemas, service health probing, changes to
  Codex itself, and changes to OpenViking's server or credentials.
- A Pennix Skills change unless the released context-mode text still leaves a
  concrete ambiguity in the root route contract.
- Enabling OpenViking resource, session, watcher, or automatic-memory features.

## Open Questions

None. The user explicitly authorized implementation, release, and installation.
