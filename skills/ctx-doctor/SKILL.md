---
name: ctx-doctor
description: Diagnose context-mode as a table; use the native CLI for strictly read-only checks.
disable-model-invocation: true
---
Call the ctx_doctor tool and show its table to the user unchanged only when its effects are within the authorized diagnostic scope. It can heal database files, write a report and index a large report. For strictly read-only work, use `context-mode doctor --agents <agent>` instead; select the actual host without changing its configuration.

List failed rows and their fixes. Do not automatically execute a Fix: installation, updates and removal belong to Pennix Lifecycle, while database repair needs its applicable authorization. Preserve unknown and failed results instead of retrying to hide them.
