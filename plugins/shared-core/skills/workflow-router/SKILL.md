---
name: workflow-router
description: Use when one defined request has overlapping proposed workstreams and needs Primary workstream, Supporting workstream, Deferred work, and Coverage; not for catalog, pack, skill, agent, tool, plugin, or installation selection, or open-ended workflow design.
---

# Workflow Router

## Overview

Separate already-proposed work inside one defined request into the smallest complete,
non-overlapping set of workstreams. This skill assigns responsibility within the
request. It does not discover, recommend, select, or install external components.

## Routing Contract

1. Name the requested output and its acceptance boundary.
2. List only the proposed workstreams already present in the request, with each
   workstream's output and responsibility.
3. Choose the narrowest workstream that directly produces the output as primary.
4. Add a supporting workstream only for a named output gap the primary workstream
   does not cover.
5. Count shared preparatory work once and defer overlapping, broader, unrelated, or
   premature work.

Return:

```text
Primary workstream: <one workstream or no-match>
Supporting workstream: <only an uncovered output responsibility>
Deferred work: <workstream and reason>
Coverage: <required output -> responsible workstream>
```

If no proposed workstream covers the required output, return `no-match` and state the
missing responsibility. Do not introduce a new tool, plugin, skill, pack, agent, or
provider as part of the route.

## When Not to Use

- The task is selecting from a catalog or choosing, recommending, installing, updating,
  or removing a pack, plugin, skill, agent, tool, or provider.
- One workstream already owns the output and no responsibility overlap remains.
- The task is authoring component metadata or designing a new workflow from scratch.
- The request needs workspace or risk discovery before routing criteria are known.

## Common Mistakes

- Treating a broad workstream as better merely because it contains more activity.
- Adding adjacent analysis that was never part of the deliverable.
- Assigning multiple workstreams to own the same output.
- Treating shared preparation as a reason to activate every proposed workstream.
