---
name: plan-and-checkpoints
description: Use when dependent work needs a dependency-and-checkpoint record with Step, Needs, Produces, Parallel with, Evidence, Decision owner, Go when, Stop when, and Recovery; not for general implementation plans, execution, or domain-rule definition.
---

# Plan and Checkpoints

## Overview

Build an executable dependency order, then place decision and evidence gates where proceeding would consume options. A checkpoint is a contract, not a progress label.

## Plan Contract

For each step record:

```text
Step: <action>
Needs: <inputs or prior evidence>
Produces: <artifact or state>
Parallel with: <independent steps only>
```

For each checkpoint record:

```text
Evidence: <observable result>
Decision owner: <authorized role>
Go when: <explicit condition>
Stop when: <explicit condition>
Recovery: <rollback, retry, or preserved state>
```

Place checkpoints before irreversible, costly, permission-changing, or externally visible actions and after evidence needed for the next dependency. An unstated tolerance, approval standard, or ownership rule remains a decision gate; do not invent it.

## Boundaries

- Use risk-privacy-permissions to identify actions that require consent or extra controls.
- Use quality-verification to choose domain-specific checks.
- This skill orders those actions and checks; it does not define their domain rules.

## When Not to Use

- The work is one reversible step with an already-defined acceptance check.
- The request is only to brainstorm options, with no execution sequence yet.
- A domain runbook already supplies the exact current order and gates.

## Common Mistakes

- Calling sequential dependencies parallel because time is short.
- Naming a checkpoint without its evidence or decision owner.
- Treating broad authority as consent for an unspecified irreversible choice.
- Scheduling rollback after the remaining recovery window has closed.
