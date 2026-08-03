# Decision index history contract

The installed broker treats `plugins/skillset-manager/data/decision-index.json`
as the current catalog generation. The first public release may contain only that
file.

Before a later release replaces the current file with a different `digest`, the
previous canonical file must be copied byte-for-byte to:

```text
plugins/skillset-manager/data/decision-index-history/<previous-digest>.json
```

Historical files are immutable and append-only. A release must never rewrite,
rename, or delete an existing digest-named file. The loader rejects symlinks,
non-regular entries, noncanonical filenames, filename/content digest mismatch,
and duplicate current/history digests.

The local clean public root `A` already contains the first public decision index.
The attestation tip `B` verifies against that exact root:

```sh
npm run verify:decision-index-history -- --previous-ref "$A"
```

Every later release compares against its public parent and requires the exact
prior bytes when the digest changed:

```sh
npm run verify:decision-index-history -- --previous-ref HEAD^
```

The previous-ref form is mandatory once the two-commit public candidate is created.
Do not substitute a private pre-release parent for the authenticated public root,
and do not run the no-previous-ref form as a missing-file bootstrap. Registry
`pre-anchor` status is not a history exemption.

Completed setup runs are authenticated against the plugin-owned generation named
by their stored `decisionIndexDigest`. Only a new setup approval is projected
from the current catalog. If an installed update omits a generation required by
an existing run, setup and maintenance fail closed before any Claude command and
direct the user to doctor review.
