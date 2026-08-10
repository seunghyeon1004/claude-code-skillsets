---
name: handoff-continuity
description: Use when ownership or a session is changing and needs a durable eight-field handoff record of Outcome, Artifacts, Changes, Decisions, Verification, Remaining, Resume, and Owner/checkpoint; not for customer release notes, self-contained answers, or immediate same-owner continuation.
---

# Handoff Continuity

## Overview

Leave a durable restart point, not a status slogan. A new owner should be able to distinguish completed evidence from temporary state and continue without the prior session.

## Handoff Record

Capture:

```text
Outcome: <completed, partial, blocked>
Artifacts: <paths, versions, receipts, or external IDs>
Changes: <what changed and current values>
Decisions: <choice and reason>
Verification: <exact invocation and fresh result>
Remaining: <failures, risks, flags, cleanup, approvals>
Resume: <working location, exact next command or action, stop condition>
Owner/checkpoint: <who acts next and when>
```

Use durable files, commits, logs, or external receipts. Capture identifiers before closing ephemeral terminals or browser sessions. If a required path, value, or command is unavailable, write `unknown - recover before proceeding`; never reconstruct it from memory.

Owner/checkpoint values must come only from task evidence. Account, profile, or
session metadata such as an email address or username is not owner evidence; do
not copy or infer it into a handoff record.
A known non-owner contact is irrelevant evidence: do not repeat it in
Owner/checkpoint, even to disclaim that it is the owner.

Before context loss, give uncommitted work a durable, non-mutating identity:
persist a binary diff and a status snapshot at supplied or approved paths, then
record their SHA-256 identity. Do not reduce uncommitted state to a filename list
or a future commit plan. If the response can only prescribe capture, mark
persistence as pending and do not claim the artifact exists. Do not propose
`git add`, `git commit`, or `git stash` without approval.

An approved path is not content-scope approval. Persist a snapshot only when its
contents are known non-sensitive and approved for that destination. If sensitive
data may be present or the scope is unknown, use `risk-privacy-permissions` to
minimize the artifact and obtain explicit content approval; otherwise leave
capture pending with the required sentinel. A binary diff preserves tracked
changes only. A status snapshot can name untracked entries but does not preserve
their contents; untracked contents require a separate, approved safe artifact.
For a repository with an existing HEAD, preserving both staged and unstaged
tracked changes requires a HEAD-relative binary diff.

The current process directory, skill path, or evaluation fixture is not the task's resume location unless task evidence establishes that link. A planned record is not a completed artifact: label capture as pending until it is actually persisted, then cite its durable path or receipt.

Completion status must agree with the remaining-work list and verification evidence.

Every handoff field is required. Under a length limit, compress values rather than dropping fields. Preserve known results even when their invocation is unknown, for example: `focused test: passed; command: unknown - recover before proceeding`.

When task evidence supplies process-control facts, preserve the PID, log path,
progress, stop command, and recovery point in the eight-field record. A resume
stop condition does not replace the supplied stop command.

## When Not to Use

- The interaction is a self-contained answer with no artifact, state, or follow-up work.
- The same owner continues immediately with durable context already captured.
- The request is for a release summary aimed at customers rather than an operational continuation record.

## Common Mistakes

- Reporting tests passed without the command, scope, and result.
- Leaving temporary flags, credentials, processes, or drafts out of the record.
- Listing changed filenames without the decision that shaped them.
- Naming uncommitted work without a binary diff, status snapshot, and SHA-256 identity.
- Saying complete while a required check or cleanup remains.
