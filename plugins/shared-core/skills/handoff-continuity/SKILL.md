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

The current process directory, skill path, or evaluation fixture is not the task's resume location unless task evidence establishes that link. A planned record is not a completed artifact: label capture as pending until it is actually persisted, then cite its durable path or receipt.

Completion status must agree with the remaining-work list and verification evidence.

Every handoff field is required. Under a length limit, compress values rather than dropping fields. Preserve known results even when their invocation is unknown, for example: `focused test: passed; command: unknown - recover before proceeding`.

## When Not to Use

- The interaction is a self-contained answer with no artifact, state, or follow-up work.
- The same owner continues immediately with durable context already captured.
- The request is for a release summary aimed at customers rather than an operational continuation record.

## Common Mistakes

- Reporting tests passed without the command, scope, and result.
- Leaving temporary flags, credentials, processes, or drafts out of the record.
- Listing changed filenames without the decision that shaped them.
- Saying complete while a required check or cleanup remains.
