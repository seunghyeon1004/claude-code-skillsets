---
name: quality-verification
description: Use when stated acceptance criteria need a criterion-to-evidence verification matrix with Required evidence, Verifier, and Fresh result; not for generic coding completion, generic test generation, or defining domain-specific quality.
---

# Quality Verification

## Overview

Completion is a set of verified claims. Map each claim to fresh evidence from the appropriate domain verifier before reporting it as passed.

## Verification Matrix

Build this matrix from the brief's completion criteria:

| Criterion | Required evidence | Verifier | Fresh result |
| --- | --- | --- | --- |
| Observable claim | Artifact, command, or workflow receipt | Domain skill, tool, or reviewer | Pass, fail, or not run |

Then:

1. Run the narrow checks that can falsify the change quickly.
2. Invoke the relevant domain verifier for behavior this core skill cannot judge.
3. Exercise the real output or user path when intermediate signals do not prove it.
4. Add boundary or failure checks in proportion to risk.
5. Record the actual artifact, invocation, and fresh result.
6. Report complete only when every required row passes; otherwise name the unverified or failed rows.

File existence, process exit, compilation, probe output, or upload receipt proves only the claim it directly measures.

## Report Contract

Preserve one named result per acceptance criterion, even when the requested format is compressed. A single line may contain multiple criterion-result pairs; never collapse distinct rows into "visual review," "manual check," or "tests."

## When Not to Use

- No completion claim or deliverable is being assessed.
- The response merely reports an observed result without interpreting it as success.
- A current verification matrix and fresh receipts already cover the unchanged artifact.

## Common Mistakes

- Reusing a nearby green check as proof of a different property.
- Saying a check "should pass" instead of recording its result.
- Running a broad suite while skipping the focused failure mode.
- Defining domain-specific quality inside the shared core instead of calling its verifier.
