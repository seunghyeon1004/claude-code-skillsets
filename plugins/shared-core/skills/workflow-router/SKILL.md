---
name: workflow-router
description: Use when routing an outcome only across provided catalog categories and packs into Primary, Supporting, Deferred, and Coverage; not for general skill, agent, tool, plugin installation, or open-ended workflow routing.
---

# Workflow Router

## Overview

Route an outcome to the smallest complete, non-overlapping workflow. A broad bundle is not a better match when a narrower candidate already produces the required output.

## Routing Contract

1. Name the requested output and its acceptance boundary.
2. Filter candidates whose declared inputs and outputs fit.
3. Choose the narrowest candidate that directly produces the output as the primary pack.
4. Add a supporting pack only for a named gap the primary pack does not cover.
5. Count shared dependencies once and defer overlapping, broader, unrelated, or premature packs.

Return:

```text
Primary: <one pack or no-match>
Supporting: <only uncovered capabilities>
Deferred: <pack and reason>
Coverage: <required output -> owning pack>
```

If no candidate covers the required output, return `no-match` and state the missing capability instead of assembling a misleading bundle.

## When Not to Use

- One exact skill is already selected and no category, pack, dependency, or overlap decision remains.
- The task is to author catalog metadata rather than consume it.
- The request needs workspace or risk discovery before routing criteria are known.

## Common Mistakes

- Choosing the largest suite because it sounds comprehensive.
- Adding adjacent analysis that was never part of the deliverable.
- Installing multiple packs that own the same workflow step.
- Treating a shared dependency as a reason to install every dependent pack.
