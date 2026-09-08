# Implementation Plan

1. Update the two redirect messages in `hooks/core/routing.mjs` and the API
   guidance in `skills/context-mode/SKILL.md`.
2. Extend the existing Hook routing tests to lock the direct-protocol and
   unavailable-tool wording while retaining the curl/wget redirect assertions.
3. Run focused routing tests, typecheck, complete test/build, and the existing
   Codex release-asset validation.
4. Use the repository's existing version/release commands to create and push a
   patch tag. Verify the remote tag and release asset before installation.
5. Install only through the normal plugin update path, restart a fresh Codex
   diagnostic thread, and verify the installed Hook plus OpenViking's direct
   MCP visibility separately.
