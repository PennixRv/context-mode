<!-- TRELLIS:START -->
# Trellis Instructions

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` - development phases, task lifecycle, and skill routing
- `.trellis/spec/` - project coding guidelines to read before implementation
- `.trellis/workspace/` - developer journals and session traces
- `.trellis/tasks/` - task requirements, design, implementation plans, research, and results

Prefer the project Trellis skills under `.agents/skills/` over manually reproducing their steps.
Treat `.trellis/workflow.md`, the active task, and closer project instructions as authoritative.

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a
future `trellis update`.

<!-- TRELLIS:END -->

## Codex Execution Mode

- Codex uses `codex.dispatch_mode: inline`: the current main session implements and checks directly.
- Do not use Codex native multi-agent tools, built-in subagents, or native `SubagentStart` dispatch.
- Do not use Trellis channel for implementation or checking. A task that explicitly authorizes
  independent read-only investigation may define a separate channel batch and its write boundary.

## Repository Boundary

- This repository owns `context-mode` source, tests, package metadata, release assets, and its local
  Trellis configuration.
- A task started here may modify only this repository unless its approved PRD names another target.
- The parent `codex-workflow-optimization` repository, `/home/penn/.codex`, Governance Plugin, and
  sibling components are read-only integration context. Do not update their files or Gitlinks here.
- Cross-repository requirements must be copied into the local task so implementation does not depend
  on reading mutable files outside this repository.

## Task Delivery

- Bind the approved Trellis task before implementation and read `prd.md`, `design.md`, and
  `implement.md` plus applicable specs.
- Track approved cross-session handoff tasks under `.trellis/tasks/` so requirements and acceptance
  travel with the branch. Keep `.trellis/workspace/`, `.developer`, `.runtime/`, and backups local.
- Keep unrelated existing changes out of the task and its commits.
- Run validation proportional to the change, commit the component result, and leave the repository
  clean. Report branch, base commit, result commits, changed files, checks, and residual risks to the
  integration session; do not push unless explicitly authorized.

## Documentation Language

- Repository-maintained documentation, task artifacts, code comments, and commit messages use clear
  English. User-facing conversation follows the language required by the active user or higher-level
  instructions.
