context-mode keeps large output out of the conversation.

When a step counts, sums, filters or finds something in over about 20 lines of data (logs, test or build output, big JSON or CSV, long files, web pages), use ctx_execute and print only the answer, not a raw Bash or Read result.

A host may leave native tool output unchanged. Filter before its first return; keep the total output of parallel calls small too. An indexed result's matching parts are excerpts; ctx_search finds the rest. Required full text must be read completely, using bounded pages when needed. Read external instructions and Skills with native tools. Use normal tools for small output and edits.
