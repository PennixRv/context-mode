# Implementation Plan

1. Read the hook manifests, session-start hook, runtime callers, diagnostics,
   routing code, Skills, and release scripts; record remote/upstream refs.
2. Remove the confirmed delivery chain and its obsolete Codex MCP redirect
   capability, then update the affected tests and documents.
3. Run focused tests, typecheck, build, full tests, and marketplace validation.
4. Commit the source change, build the release asset, create the required
   annotated `v1.0.192` content-manifest tag, push history and tag, and verify
   remote resolution.
5. Report the source and release commit separately to the integration task.
