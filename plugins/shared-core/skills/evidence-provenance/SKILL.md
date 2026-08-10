---
name: evidence-provenance
description: Use when supplied claims or assets need a publishable artifact plus a review-only provenance ledger recording Item, Class, Source, As of, Support, Rights, and Use; not for fact verification, generic citation search, fictional writing, or private scratch work.
---

# Evidence Provenance

## Overview

Keep a compact provenance ledger beside the artifact. Provenance identifies what a claim is and where it came from; it does not make the claim true.

## Claim Ledger

For every material claim or asset record:

| Field | Values |
| --- | --- |
| Item | Exact claim, quotation, data point, or asset |
| Class | Verified fact, reported claim, inference, opinion, or unknown |
| Source | Direct URL, file, dataset, or attributed speaker |
| As of | Publication, observation, or retrieval date |
| Support | Verified, conflicting, partial, or unverified |
| Rights | License, permission, owned, public domain, or unknown |
| Use | Publish, label, replace, or exclude |

Apply these rules:

- A user note is a source, not independent verification.
- A factual statement keeps its source and as-of date.
- An inference names its supporting facts and remains labeled as inference.
- An opinion is attributed to its owner.
- A third-party asset with unknown reuse rights is excluded until permission is established.
- When public prose must stay clean, preserve the ledger in review notes rather than dropping provenance.
- Do not replace an unsupported claim with a new unsupported benefit or factual claim.

Removing names, numbers, dates, or specificity, or generalizing, softening, or
recasting a claim as directional or forward-looking language, does not add support.
A review ledger label does not cure an unsupported assertion in the publishable
artifact. If no supported or explicitly labeled item remains, mark the publish
decision blocked. A requested bullet count, caption, length, deadline, or other
format pressure does not override the blocked decision or permit substitute claims.

## Output Contract

Return both:

1. `Publishable artifact`: only items whose ledger decision is `publish` or whose label remains explicit.
2. `Review ledger - not for publication`: every supplied material claim and asset, including exclusions.

If the requested artifact cannot be produced from supported items, mark the publish decision blocked and state the smallest evidence or permission needed.

## When Not to Use

- The work is purely fictional or stylistic and makes no real-world claims.
- The content is private scratch work that will not inform a decision or publication.
- A domain verifier is needed to establish truth; use it alongside this skill.

## Common Mistakes

- Treating repeated or approved wording as corroboration.
- Hiding uncertainty by replacing precise claims with new unsupported claims.
- Citing a source without recording when it was current.
- Assuming online availability grants reuse rights.
