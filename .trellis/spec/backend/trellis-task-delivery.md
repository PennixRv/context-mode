# Trellis Task Delivery Contract

## 1. Scope / Trigger

Apply this contract when one Codex main session prepares a context-mode source
task for another main session, or when an integration repository must review a
component task and its acceptance evidence.

The contract exists because an unanchored `tasks/` ignore rule previously hid
`.trellis/tasks/`, while `AGENTS.md` was ignored explicitly. Git could report a
clean worktree even though the task requirements and repository boundaries were
present only as local untracked state.

Ad hoc local experiments that do not need cross-session delivery may remain
uncommitted, but they must not be represented as a published or clean handoff.

## 2. Signatures And Paths

Tracked handoff assets:

```text
AGENTS.md
.trellis/tasks/<MM-DD-task>/task.json
.trellis/tasks/<MM-DD-task>/prd.md
.trellis/tasks/<MM-DD-task>/design.md       # complex tasks
.trellis/tasks/<MM-DD-task>/implement.md    # complex tasks
.trellis/tasks/<MM-DD-task>/research/**     # bounded evidence copied into this repository
```

Local-only paths:

```text
.trellis/.developer
.trellis/.runtime/**
.trellis/workspace/**
.trellis/.backup-*/**
**/__pycache__/**
**/*.pyc
```

Repository-local scratch tasks use `/tasks/`. The leading slash is required;
plain `tasks/` also matches `.trellis/tasks/` and is forbidden.

## 3. Contracts

- The publishing session creates a task branch from the approved base branch,
  writes complete planning artifacts, records a stable external correlation ID
  when applicable, and starts the task only after user approval.
- The preparation commit contains Trellis/runtime updates, `AGENTS.md`, the
  approved task artifacts, and no product implementation.
- The implementation session binds the existing task to its own session with
  `task.py start`; it does not recreate the task from the launch prompt.
- Task artifacts contain all mutable requirements and evidence needed to work
  inside this repository. The implementation session must not depend on reading
  a parent repository, user configuration, or sibling component.
- Workspace journals, developer identity, runtime pointers, update backups, and
  Python caches never enter the index or handoff commit.
- Repository-maintained task documentation uses English. User-facing handoff
  prompts may use the user's active conversation language.
- A task handoff is complete only when the preparation commit exists and
  `git status --short` is empty. A launch prompt alone is not a durable handoff.

## 4. Validation And Error Matrix

| Condition | Required result |
| --- | --- |
| `AGENTS.md` is ignored | Block preparation; remove the ignore rule |
| `.trellis/tasks/<task>/prd.md` is ignored | Block preparation; anchor `/tasks/` at repository root |
| `/tasks/example` is not ignored | Block preparation; preserve root scratch-task exclusion |
| workspace, identity, runtime, backup, or cache is tracked | Block commit and remove it from the index |
| complex task lacks `design.md` or `implement.md` | Keep task in `planning` |
| task has no stable correlation ID for external acceptance | Block cross-repository handoff |
| preparation commit includes product source | Split the commit before handoff |
| worktree is dirty after the preparation commit | Do not launch the implementation session |

## 5. Good / Base / Bad Cases

- Good: a P0 component task has complete artifacts, a stable root issue ID, an
  isolated preparation commit, and a clean worktree before the new session starts.
- Base: a local one-session experiment has no cross-repository consumer. Its task
  may remain local, but it is not called a published handoff and must be removed
  or deliberately promoted before claiming the branch is ready.
- Bad: `.trellis/tasks/` is ignored, the publisher sends requirements only in a
  chat prompt, and Git reports clean. The implementation session then has no
  repository-owned task fact and cannot be audited from the branch.

## 6. Tests Required

Before a preparation commit, assert:

```bash
git check-ignore AGENTS.md
git check-ignore .trellis/tasks/<task>/prd.md
git check-ignore --no-index tasks/example
git check-ignore --no-index .trellis/workspace/example .trellis/.developer .trellis/.runtime/example
python3 ./.trellis/scripts/task.py validate <task>
python3 ./.trellis/scripts/task.py current --source
git diff --check
git status --short
```

The first two commands must return no match. The root scratch path and every
local-only Trellis path must return an ignore rule. After committing, inspect
`git show --name-status --stat HEAD` and require a clean worktree.

## 7. Wrong Vs Correct

### Wrong

```gitignore
tasks/
AGENTS.md
```

The unanchored directory rule hides nested Trellis tasks, and the second rule
removes the repository's always-on AI boundary from version control.

### Correct

```gitignore
/tasks/
__pycache__/
*.pyc
```

Track `AGENTS.md` and approved `.trellis/tasks/**`; keep machine-local state in
`.trellis/.gitignore` with explicit `.developer`, `.runtime/`, `workspace/`, and
`.backup-*` rules.
