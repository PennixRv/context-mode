# Codex Marketplace v1.0.188

## Scope

This patch converges two component contracts for Linux and WSL Codex installs:

- Issue 009: CLI Doctor and MCP `ctx_doctor` now use one typed Codex Plugin
  diagnostic projection. Inventory, source root, cache root, loaded package
  root, manifests, Hook declarations, and current-session loading are reported
  independently with stable observation states.
- Issue 070: common package-manager, JavaScript, Python, JVM, Go, and Rust test
  commands are routed to context-mode aggregation on first and repeated calls.
  Classification uses command grammar rather than a free-form `test` substring.

The release preserves direct calls for lifecycle, wait, interactive, bounded
structured, CodeGraph, Fast Context, OpenViking, Trellis, Governance, and
unknown MCP protocols. It also preserves the compact presentation budgets and
the five Codex Plugin environment-forwarding variables introduced by earlier
releases.

## Doctor Contract

The `Codex Plugin diagnostic (JSON)` line is identical between the built CLI
Doctor and built MCP `ctx_doctor` for the same fixture. It includes stable check
IDs for identity, version, installation, enabled state, source/cache/runtime
roots, cache/runtime manifests, runtime Hooks, and current-session Hook loading.

`unavailable` means the relevant process or upstream CLI did not expose enough
evidence. It is never rewritten as `missing`. A current manifest can prove what
the MCP package contains, but it cannot prove that an already-running Codex
session loaded those Hooks, so that state remains `unavailable` unless the host
provides explicit evidence.

## Test Routing Contract

Recognized commands include `npm`/`pnpm`/`yarn` test scripts, Vitest, Jest,
Pytest, Tox, Gradle, Maven, SBT, `go test`, and `cargo test`, including supported
path options, wrappers, environment prefixes, and compound shell branches.
Mutations, navigation, process controls, short observations, and direct
structured protocols retain their existing handling.

Execution status remains authoritative after routing. Non-zero, timed-out, and
output-capped test commands are not reported as completed, and only successful
stdout is eligible for request-local search or explicit verified persistence.

## Installation And Rollback

Install the immutable `v1.0.188` Codex marketplace archive or online marketplace
tag using the normal Codex Plugin update transaction. A running Codex session
must be restarted before current-session Hook behavior can be accepted. Rollback
uses the previous immutable `v1.0.187` release; existing tags and release assets
must never be overwritten.
