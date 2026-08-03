---
name: risk-privacy-permissions
description: Use when a resolved risky action needs a seven-field risk record of Action, Data, Destination, Permission, Impact, Recovery, and Authority before scoped approval; not for domain compliance interpretation, generic security review, or read-only local public-data work.
---

# Risk, Privacy, and Permissions

## Overview

Make the exact data flow and authority visible before a risky action. Consent is informed only when its scope is known.

## Risk Record

Record:

| Field | Question |
| --- | --- |
| Action | What will change or leave the workspace? |
| Data | What sensitive fields or artifacts are involved? |
| Destination | Who can access it, where, and for how long? |
| Permission | What is the narrowest required access and duration? |
| Impact | What external effect, cost, or irreversible state follows? |
| Recovery | How is state preserved, revoked, or restored? |
| Authority | Who can approve this resolved scope? |

## Control Sequence

1. Minimize data, recipients, permissions, duration, and external effects.
2. Prefer a staged, reversible action and preserve recovery evidence.
3. Verify the destination and the decision maker's authority.
4. Before external disclosure, credential use, persistent permission, paid action, or destruction, present the resolved record and obtain explicit approval for that scope.
5. Execute only the approved scope; record the result, revocation, retention, and cleanup.

Broad approval such as "authorize everything" does not cover recipients, fields, retention, cost, or destruction details that were unresolved when it was given.

## When Not to Use

- The action is read-only, local, public-data-only, and has no permission or cost change.
- Another approved runbook already defines the same current scope, authority, and recovery controls.
- Domain compliance interpretation is required; call the appropriate specialist and use this skill to apply its decision.

## Common Mistakes

- Treating an approved vendor as approval for every file or recipient.
- Granting broad persistent access for a narrow one-time action.
- Confusing a backup with permission to destroy the source.
- Recording consent without recording what was actually approved.
