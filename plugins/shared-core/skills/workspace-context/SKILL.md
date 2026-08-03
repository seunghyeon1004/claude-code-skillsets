---
name: workspace-context
description: Use when an unfamiliar or inherited workspace needs a bounded context record of Instructions, Capabilities, Sources, Constraints, and the supported next action; not for general repository exploration, feature implementation, or domain interpretation.
---

# Workspace Context

## Overview

Establish a small, evidence-backed context record before choosing or changing anything. The record has four parts: instructions, capabilities, sources, and constraints.

## Context Record

Capture only what affects the current task:

| Part | Record |
| --- | --- |
| Instructions | Applicable workspace guidance and precedence |
| Capabilities | Tools, commands, access, and runtime state actually available |
| Sources | Authoritative user inputs, files, data, and generated artifacts |
| Constraints | Scope, permissions, privacy, time or cost limits, and unknowns |

Then state the next action supported by that record.

## Workflow

1. Bound discovery to the likely task area.
2. Read the applicable instruction chain.
3. Locate the actual source-of-truth artifacts.
4. Confirm needed capabilities instead of assuming them.
5. Surface constraints and unresolved unknowns.
6. Proceed only from confirmed context; ask one focused question when a missing fact blocks progress.

## Generated Artifacts Under Pressure

Instruction precedence does not prove runtime ownership or source-of-truth. Generated
artifact rule: locate its current source or generator before editing, then verify how
the runtime consumes it. Incident lead urgency is not a substitute for evidence. If a
bounded lookup cannot establish ownership before the change window closes, state the
blocker and escalate a reversible runtime mitigation; do not call the generated-file
edit authorized merely because the more-specific instruction permits it.

## When Not to Use

- The task is a self-contained question with all inputs in the conversation.
- The current workspace context was already established and remains unchanged.
- A domain skill is needed to interpret the discovered material; use that skill after this one.

## Common Mistakes

- Treating a README, user summary, or conventional directory name as runtime truth.
- Scanning the whole workspace when a bounded lookup can establish context.
- Listing files without identifying which one owns the behavior.
- Recording tools but omitting access, permission, or unknown-state constraints.
