# Design: direct protocol before redirected HTTP

## Boundary

The observed failure is a misleading redirect message, not an unsafe HTTP
allowance and not an OpenViking server failure. The routing Hook sees a shell
command but has no trustworthy inventory of the host's external MCP tool
schemas. Therefore its smallest correct behavior is a protocol-neutral next
action, rather than an attempted schema discovery or a service-specific branch.

## Change Shape

1. Replace the shared curl/wget redirect text with a concise ordered route:
   callable direct MCP/API for configured services; configured public-web
   retrieval; explicit HTTP/API inspection only when applicable; otherwise
   report the unavailable direct tool.
2. Apply the equivalent language to the inline HTTP redirect.
3. Narrow the API row and automatic-trigger wording in the shipped Skill to
   require no applicable direct structured protocol before `ctx_execute`.
4. Assert the essential wording in existing routing tests. Existing allow-list,
   redirect, external-MCP passthrough, and output-budget tests remain the
   regression boundary.

## Non-Goals

- No `mcpToolsAvailable` argument, sentinel reuse, host metadata, URL parser,
  configuration reader, or OpenViking name appears in the routing code.
- No fallback from a missing direct MCP tool to shell HTTP is introduced.
- No change to public web provider selection, direct external MCP passthrough,
  or the existing quiet file-download escape hatch.

## Release And Rollback

This is a text-and-test patch release. Rollback is the previous immutable tag
and normal installer path; no database, configuration, cache, credential, or
remote-service migration exists.
