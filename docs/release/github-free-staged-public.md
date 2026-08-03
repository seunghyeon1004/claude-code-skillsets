# GitHub Free Staged-Public Release

This runbook is the release-order contract for this repository. It exists because
the required branch-protection receipt cannot be obtained while the repository is
private under the current GitHub Free configuration. Public visibility is therefore
a controlled validation stage, not a release.

Changing visibility is an approval-gated operation. A public repository is genuinely
accessible during staging, and making it private again cannot recall copies that were
already fetched. Do not start stage 2 without explicit final user approval.

## 1. Private candidate and ordinary CI

Prepare a clean private `main` candidate and freeze its exact SHA. The SHA must
already contain the public installation documentation and release metadata. Run the
local gates, clean-copy checks, and ordinary GitHub Actions CI against that SHA.
Run `npm run verify:decision-index-history -- --previous-ref HEAD^`; a changed current
digest must preserve the public parent's exact index bytes. See
[`docs/decision-index-history.md`](../decision-index-history.md).

Do not create or move a release tag, create a GitHub Release, announce the project,
or describe the candidate as released. Any code or documentation change creates a
new SHA and restarts this stage.

### 1A. Create the two-commit public candidate locally

Do not pin a final SHA in this runbook or in tracked workflow code. Replace only the
angle-bracket values below after the private candidate is approved. Use a public
identity whose author, committer, and tagger email does not end in `.local`.

```bash
PRIVATE_CANDIDATE="<approved-private-candidate-sha>"
PUBLIC_DIR="$(mktemp -d "${TMPDIR:-/tmp}/skillsets-public-history.XXXXXX")"
PUBLIC_ROOT_TAG_NAME="public-history/root-v1"

git archive "$PRIVATE_CANDIDATE" | tar -x -C "$PUBLIC_DIR"
git -C "$PUBLIC_DIR" init -b main
git -C "$PUBLIC_DIR" config user.name "<public-maintainer-name>"
git -C "$PUBLIC_DIR" config user.email "<public-maintainer-email>"
git -C "$PUBLIC_DIR" add -f -A
git -C "$PUBLIC_DIR" commit -s -m "chore: establish public root"
A="$(git -C "$PUBLIC_DIR" rev-parse HEAD)"
test "$(git -C "$PUBLIC_DIR" rev-parse "$A^{tree}")" = "$(git rev-parse "$PRIVATE_CANDIDATE^{tree}")"
test "$(git -C "$PUBLIC_DIR" ls-tree -r --name-only "$A" | wc -l | tr -d '[:space:]')" = "$(git ls-tree -r --name-only "$PRIVATE_CANDIDATE" | wc -l | tr -d '[:space:]')"
test "$(git -C "$PUBLIC_DIR" ls-tree -r "$A")" = "$(git ls-tree -r "$PRIVATE_CANDIDATE")"
git -C "$PUBLIC_DIR" commit --allow-empty -s -m "chore: attest first public history"
B="$(git -C "$PUBLIC_DIR" rev-parse HEAD)"
git -C "$PUBLIC_DIR" tag -a "$PUBLIC_ROOT_TAG_NAME" "$A" -m "approved public root"
TAG_OBJECT="$(git -C "$PUBLIC_DIR" rev-parse "$PUBLIC_ROOT_TAG_NAME")"
```

The force-add is allowed only in this fresh archive-derived temporary repository.
It restores paths that were tracked by the private candidate but still match an
archived `.gitignore`; never run that force-add in the private source checkout. The
tree hash, full recursive tree listing, and tracked-path count gates must all pass
before creating `B` or the governance tag.

`A` must have no parent. `B` must have exactly `A` as its parent and the same tree.
The annotated governance tag must point directly to `A`. Verify those properties
before preparing any remote operation:

```bash
test "$(git -C "$PUBLIC_DIR" rev-list --parents -n 1 "$A")" = "$A"
test "$(git -C "$PUBLIC_DIR" rev-parse "$B^")" = "$A"
test "$(git -C "$PUBLIC_DIR" rev-parse "$A^{tree}")" = "$(git -C "$PUBLIC_DIR" rev-parse "$B^{tree}")"
test "$(git -C "$PUBLIC_DIR" rev-parse "$PUBLIC_ROOT_TAG_NAME^{commit}")" = "$A"
```

Create a transport-like local bare source that advertises only `main` and the
governance tag. Clone with no local object sharing and fetch only that tag:

```bash
TRANSPORT="$(mktemp -d "${TMPDIR:-/tmp}/skillsets-public-transport.XXXXXX")/source.git"
VERIFY_CLONE="$(mktemp -d "${TMPDIR:-/tmp}/skillsets-public-verify.XXXXXX")"
git init --bare "$TRANSPORT"
git -C "$TRANSPORT" fetch --no-tags "$PUBLIC_DIR" "${B}:refs/heads/main"
git -C "$TRANSPORT" fetch --no-tags "$PUBLIC_DIR" "refs/tags/${PUBLIC_ROOT_TAG_NAME}:refs/tags/${PUBLIC_ROOT_TAG_NAME}"
git clone --no-local --single-branch --no-tags --branch main "$TRANSPORT" "$VERIFY_CLONE"
git -C "$VERIFY_CLONE" fetch --no-tags origin "refs/tags/${PUBLIC_ROOT_TAG_NAME}:refs/tags/${PUBLIC_ROOT_TAG_NAME}"
(
  cd "$VERIFY_CLONE"
  npm ci
  npm run verify:public-history -- \
    --remote origin --branch main --root-commit "$A" --tip-commit "$B" \
    --tag-name "$PUBLIC_ROOT_TAG_NAME" --tag-object "$TAG_OBJECT"
)
```

The public root `A` is the mandatory baseline for P03, research append-only,
review-ledger append-only, and decision-index history verification. It must already
contain every protected file. There is no missing-file or no-previous-ref bootstrap
after `A` exists.

### 1B. Inventory the existing repository without reusing it

The current private source URL is exactly
`https://github.com/seunghyeon1004/claude-code-skillsets`. Immediately before any
remote mutation, record every advertised ref with `git ls-remote --refs` and record
the exact current pull-request state with `gh pr list --state all --repo
seunghyeon1004/claude-code-skillsets --limit 1000 --json
number,state,url,headRefName,headRefOid,baseRefName`. Treat both outputs as
point-in-time evidence; they must not be restated in this runbook as a durable live
fact. GitHub-managed pull-request refs such as `refs/pull/*`, if present, are not
deletable by a repository owner and can retain old private history. Whether or not
the inventory reports any pull-request ref, the archive-and-new-empty-repository
design in 1C remains required.

Do not reuse, force-replace, or delete refs from that repository for the public
bootstrap. In particular, do not weaken `verify:public-history` to ignore
`refs/pull/*`: its exact advertised-ref contract is intentional. The existing
repository becomes a private archive; its issues, pull requests, discussions,
releases, branches, tags, and Git objects stay there. Do not copy or recreate issues
or pull requests in the public repository.

### 1C. Approval-gated archive and new-private-repository bootstrap

The public repository must instead be a completely new, initially empty private
repository using the original name. Before requesting approval, prepare one explicit
remote-mutation plan with these exact values:

```text
old source URL: https://github.com/seunghyeon1004/claude-code-skillsets
private archive URL: https://github.com/seunghyeon1004/<approved-private-archive-name>
new private URL: https://github.com/seunghyeon1004/claude-code-skillsets
public root A: <A>
public attestation tip B: <B>
governance tag: public-history/root-v1 at <TAG_OBJECT>
final advertised refs: refs/heads/main at <B>; refs/tags/public-history/root-v1 at <TAG_OBJECT>
```

Before approval, confirm that the proposed private archive name has no name collision
and that renaming the current repository will free the original name for the new
private repository. If either name is unavailable or resolves to an unexpected
repository, stop without renaming or creating anything.

Show that exact old/archive/new URL and A/B/tag plan to the user and obtain separate
explicit approval before performing any remote operation. The approval covers only:

1. Renaming the existing repository to the approved private archive name while
   keeping it private.
2. Creating a new empty private repository at the original URL, without initializing
   it and without importing issues, pull requests, discussions, releases, branches,
   tags, or Git history from the archive.
3. Pushing only `B` as `refs/heads/main` and the annotated governance tag pointing to
   `A`; no force push is permitted.

After approval, verify the archive is still private, create the empty replacement,
and verify that it has no advertised refs before pushing the two approved refs. The
new repository must not receive a pull request before the bootstrap workflow passes.
Push `B` as `main` and the annotated governance tag in the same approved operation.
The first `main` push runs both required CI jobs. They accept a zero remote base only
when the remote advertises exactly `main` plus one annotated `public-history/root-vN`
tag, `main` equals `B`, and the shared resolver proves the parentless A/B/same-tree
graph. Any other zero-base push fails closed. Wait for successful `quality` and
`claude-plugin-validation` checks on `B`, then run
`.github/workflows/public-history-bootstrap.yml` manually with exact `A`, `B`,
`PUBLIC_ROOT_TAG_NAME`, and `TAG_OBJECT` inputs. The manual workflow reuses the same
A/B validation helper and verifies the public identities, generated state, mandatory
baselines, and a transport-like clean copy. Ordinary nonzero push and pull-request CI
keep their existing ancestor-base rules.

The fresh-remote check counts exactly three advertised lines: `refs/heads/main`, the
annotated tag object at `refs/tags/public-history/root-vN`, and that tag's peeled
`^{}` commit line. A fourth ref, a lightweight tag, a missing peeled line, or a `main`
SHA different from `B` fails the first-push CI gate.

If archive renaming, empty-repository creation, either approved push, ref inventory,
or the bootstrap workflow fails, keep both repositories private. Do not make the
archive public, do not retry against or force-replace the archive, do not publish a
release or announcement, and do not copy its issues or pull requests. Record only
sanitized evidence, return to a new local candidate, and obtain a new approval plan
with the exact replacement URL and A/B/tag values.

### 1D. Anchor reviewed refreshes after the strict bootstrap

The one-time A/B/public-history bootstrap remains pre-anchor and exact-ref only.
After that bootstrap succeeds, use a separate approved remote operation to create
the annotated `registry-approved/r01` tag at exactly `B`; never include it in the
initial three-line remote bootstrap. Verify the annotated tag object and target
before configuring GitHub:

```bash
git tag -a registry-approved/r01 "$B" -m "R01 reviewed broker registry base"
test "$(git cat-file -t registry-approved/r01)" = tag
test "$(git rev-parse registry-approved/r01^{commit})" = "$B"
R01_TAG_OBJECT="$(git rev-parse registry-approved/r01)"
```

Pushing that new tag and changing repository variables or secrets are separate
external effects and require explicit approval. After the approved tag push, use
GitHub's repository settings to configure `REGISTRY_APPROVAL_ANCHORED` to the exact
value `anchored` and `APPROVED_REGISTRY_TAG_OBJECT` to the exact protected
`R01_TAG_OBJECT`. Verify the remote annotated tag again, rerun current-tip CI at
unchanged `B` with the exact required input:

```bash
set -euo pipefail
PREEXISTING_CI_RUNS="$(gh run list --workflow ci.yml --event workflow_dispatch --branch main --commit "$B" --limit 1000 --json databaseId,createdAt)"
DISPATCHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
gh workflow run ci.yml --ref main -f expected_tip="$B"

list_new_ci_run_ids() {
  gh run list --workflow ci.yml --event workflow_dispatch --branch main --commit "$B" --limit 1000 --json databaseId,createdAt \
    | jq -c --argjson preexisting "$PREEXISTING_CI_RUNS" --arg dispatched_at "$DISPATCHED_AT" '
      [$preexisting[].databaseId] as $preexisting_ids
      | [
          .[]
          | .databaseId as $id
          | select(.createdAt >= $dispatched_at)
          | select(($preexisting_ids | index($id)) == null)
          | $id
        ]
    '
}

CI_RUN_ID=""
for attempt in $(seq 1 12); do
  NEW_CI_RUN_IDS="$(list_new_ci_run_ids)"
  NEW_CI_RUN_COUNT="$(jq 'length' <<<"$NEW_CI_RUN_IDS")"
  if test "$NEW_CI_RUN_COUNT" = 1; then
    CI_RUN_ID="$(jq -r '.[0]' <<<"$NEW_CI_RUN_IDS")"
    break
  fi
  test "$NEW_CI_RUN_COUNT" = 0
  sleep 5
done
test -n "$CI_RUN_ID"
gh run watch "$CI_RUN_ID" --exit-status
NEW_CI_RUN_IDS="$(list_new_ci_run_ids)"
test "$(jq 'length' <<<"$NEW_CI_RUN_IDS")" = 1
test "$(jq -r '.[0]' <<<"$NEW_CI_RUN_IDS")" = "$CI_RUN_ID"
CI_RUN="$(gh run view "$CI_RUN_ID" --json conclusion,headSha,jobs,status)"
test "$(jq -r '.status' <<<"$CI_RUN")" = completed
test "$(jq -r '.conclusion' <<<"$CI_RUN")" = success
test "$(jq -r '.headSha' <<<"$CI_RUN")" = "$B"
test "$(jq '[.jobs[] | select(.name == "quality")] | length' <<<"$CI_RUN")" = 1
test "$(jq '[.jobs[] | select(.name == "quality" and .status == "completed" and .conclusion == "success")] | length' <<<"$CI_RUN")" = 1
test "$(jq '[.jobs[] | select(.name == "claude-plugin-validation")] | length' <<<"$CI_RUN")" = 1
test "$(jq '[.jobs[] | select(.name == "claude-plugin-validation" and .status == "completed" and .conclusion == "success")] | length' <<<"$CI_RUN")" = 1
test "$(gh api repos/seunghyeon1004/claude-code-skillsets/git/ref/heads/main --jq .object.sha)" = "$B"
```

Wait for both exact `B` jobs, `quality` and `claude-plugin-validation`, to reach
terminal `success`. Do not dispatch the Catalog refresh workflow during initial
public staging; this release candidate already contains its reviewed catalog. After
the CI result, confirm that fresh live `main` still points exactly to `B`, then proceed
to stage 2 under its separate explicit public-visibility approval. The repository
variable `CATALOG_REFRESH_ENABLED` must remain unset throughout initial staging and
release; do not configure it in stages 1 through 6. The workflow requires its exact
approved value before checkout, so both schedule and manual refreshes fail before
collection while the variable is absent.

### 1E. Review candidate additions from the generated backlog

Treat `research/official-marketplace-review-backlog.json` as review evidence, not
as an authorization record. Extract protected additions and their stable identity
and canonical source coordinate with:

```bash
jq -r '
  .inventoryChanges[]
  | select(.status == "added" and .protected == true)
  | [.name, .observed.candidateIdentity, (.observed.sourceCoordinate | tojson)]
  | @tsv
' research/official-marketplace-review-backlog.json
```

For each row, a reviewer must compare the observed description, source coordinate,
and source pin against the intended upstream listing. Only after that human comparison
may the reviewer copy `.observed.candidateIdentity` into the typed
`candidateAdditions` approval input.

The backlog identity is never an automatic approval input. Collection must never
merge, install, or approve a candidate.

After recording the human review, run the typed local approval workflow from the
clean, committed review-held candidate checkout. Repeat `--candidate-addition-json`
for every added protected candidate, using the exact identity copied from the
reviewed backlog:

```bash
BASE_SHA="<reviewed-append-only-base-commit>"
EXPECTED_HEAD_SHA="$(git rev-parse HEAD)"
APPROVED_REGISTRY_TAG_OBJECT="<reviewed-annotated-registry-tag-object>"

npm run research:approve-official-marketplace -- \
  --base-sha "$BASE_SHA" \
  --expected-head-sha "$EXPECTED_HEAD_SHA" \
  --approved-registry-tag-object "$APPROVED_REGISTRY_TAG_OBJECT" \
  --approved-at "<newer-rfc3339-utc>" \
  --approved-by "<reviewer-id>" \
  --reason "<review-record>" \
  --candidate-addition-json \
  '{"name":"<plugin-name>","expectedIdentity":"<reviewed-candidate-identity>"}'
```

Omit the final option only when the backlog has no `added` protected candidate.
The approval timestamp must use exact UTC seconds and cannot be in the future.
The base must be an ancestor of the exact clean `HEAD`, and the tag object must be
the immediate annotated registry approval-chain predecessor. Exact held candidate
rebindings are read from the digest-bound append-only revision records after their
reviewer, latest observation, marketplace artifact, and audit artifact bindings
validate; they are never accepted as a free-form CLI input. Pin-only approval
compares the documented pin-insensitive source coordinate, while the full candidate
identity still binds the description, source pin, and complete marketplace source.
This workflow applies the explicit approval, materializes decision state, generates
the catalog, preserves the prior authenticated index in delivery history, advances
the manager patch version when bytes changed, regenerates version-bound surfaces,
and runs deterministic approval-local verification without modifying the approved
tree. Commit the resulting tree, then run the full local gates, append-only gates,
and transport-like clean-copy verification against that exact commit before any
publication step. In v0.1, published candidates, assignments, and capability
claims are append-only, and an existing claim record is immutable; there is no
implicit withdrawal or in-place claim revision path.
If materialization, generation, delivery, or verification fails, the workflow
restores every tracked file and removes every newly created file before returning
the failure; it also verifies that the checkout is clean again.

## 2. Approved public staging

After the remote bootstrap workflow passes and explicit final user approval is
recorded, change repository visibility to public. This
visibility change is not a release and must not be combined with a tag, GitHub
Release, marketplace-directory submission, or announcement.

Immediately after visibility changes to public, confirm in GitHub Actions that the
exact `B` SHA has successful `quality` and `claude-plugin-validation` runs. Only then
enable the public private-vulnerability-reporting endpoint that `SUPPORT.md` links
to, and verify it before any release claim:

```bash
REPO="seunghyeon1004/claude-code-skillsets"
gh api --method PUT "repos/$REPO/private-vulnerability-reporting"
test "$(gh api "repos/$REPO/private-vulnerability-reporting" --jq .enabled)" = true
```

Only after that support gate passes, apply `main` branch protection and verify the
live policy:

- disable direct pushes, force pushes, and branch deletion, including for admins;
- allow no user, team, or app bypass;
- require `quality` and `claude-plugin-validation`, both bound to GitHub Actions
  producer app ID `15368`;
- require pull requests but set required approvals to `0`, dismiss stale approvals,
  and do not require CODEOWNERS review while `seunghyeon1004` is the sole
  collaborator;
- record the explicit sanitized disclosure `humanReviewGuarantee:
  "not-guaranteed"`. This protects the write path but does **not** guarantee an
  independent human review.

Use this exact GitHub API payload. It requires pull requests even though the minimum
approval count is zero, and binds both required checks to the GitHub Actions app:

```bash
mkdir -p .release-evidence
cat > .release-evidence/main-protection.json <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": [],
    "checks": [
      { "context": "claude-plugin-validation", "app_id": 15368 },
      { "context": "quality", "app_id": 15368 }
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 0,
    "require_last_push_approval": false,
    "bypass_pull_request_allowances": { "users": [], "teams": [], "apps": [] }
  },
  "restrictions": null,
  "required_linear_history": false,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_conversation_resolution": false,
  "lock_branch": false,
  "allow_fork_syncing": false
}
JSON
gh api --method PUT "repos/$REPO/branches/main/protection" \
  --input .release-evidence/main-protection.json
```

Use the normal read-only GitHub CLI session to create the local receipt after the
policy is applied; no self-hosted runner, protected environment, or special
Administration token is a public-release prerequisite:

```bash
mkdir -p .release-evidence/raw
npm run verify:branch-protection -- \
  --repo seunghyeon1004/claude-code-skillsets --branch main \
  --output .release-evidence/raw/branch-protection.json
npm run eval:sanitize -- .release-evidence/raw .release-evidence/sanitized
npm run eval:sanitize:verify -- .release-evidence/sanitized
```

Freeze the candidate. If `main` no longer points to the private-stage SHA, stop and
use rollback instead of validating a different commit.

## 3. Protected same-SHA local semantic RC

Use a clean local checkout of protected `main` at the exact `B` SHA. After explicit
approval for the local subscription Claude CLI evaluation, run the read-only fixture
suite below. The command refuses a dirty worktree, a non-`main` branch, or a SHA that
does not equal the local `main` tip before it invokes Claude. Its evaluator uses the
repository's fixture data and Claude Code safe mode with read-only tools; it does not
install candidates, mutate GitHub, or use a remote runner.

```bash
SHA="$(git rev-parse HEAD)"
npm ci
npm run verify:solo-semantic-rc -- \
  --commit-sha "$SHA" \
  --output-dir "$PWD/.rc-artifacts/$SHA" \
  --execute --approved-read-only
```

Keep only `.rc-artifacts/$SHA/sanitized` as release evidence. The generated local
target receipt identifies the exact SHA and repeats `humanReviewGuarantee:
"not-guaranteed"`; it must never be described as a full or independent human review.
Do not reuse a receipt from another SHA.

## 4. Unauthenticated installation verification

From a clean environment with no GitHub authentication, verify that the exact same
SHA is reachable by HTTPS clone. Then test public marketplace add, manager install,
and the first-user setup preview. The marketplace and installed plugin must resolve
to the staged repository, and setup must preserve its approval boundaries.

For the first public marketplace bootstrap, `skillset-manager` depends on the bare
same-marketplace name `shared-core`. Do not add a version range until a valid
`shared-core--v0.1.0` tag exists at a matching manifest version; the first
installation must not require that tag.

The unreleased `skillset-manager` `0.1.0` package was private-only. A reviewed
catalog whose authenticated decision-index bytes change must preserve the exact
previous bytes in `data/decision-index-history/` and publish a higher manager patch
version in the root marketplace and manager manifest. An existing cached install
receives that catalog only through the explicit manager update and reload sequence:

```text
claude plugin marketplace update claude-code-skillsets
claude plugin update skillset-manager@claude-code-skillsets --scope user
/reload-plugins
```

The first two lines are shell commands. `/reload-plugins` is run inside Claude Code
after the update command reports success; restart Claude Code if required by the
CLI update notice. Then inspect `/plugin` or `claude plugin list --json` and verify
the expected manager version before relying on the new decision index.

Do not install an external candidate during this release check without its separate
user approval. Record only sanitized evidence.

## 5. Release, tag, and announcement

Only after stages 1 through 4 pass for one unchanged SHA may the maintainer create
or move the release tag, publish a GitHub Release, announce the public repository,
or submit it to an external marketplace directory. Release evidence must identify
that exact SHA.

## 6. Rollback

On any failure after stage 2, stop testing, create no tag or GitHub Release, make no
announcement, and switch the repository back to private. Record the failed gate and
retain only sanitized evidence. Publicly fetched copies cannot be revoked.

Fixes produce a new candidate SHA and restart at stage 1. Do not weaken branch
protection, skip the exact-SHA check, or reuse an RC receipt from an older commit.

## 7. Later approved catalog maintenance

A manual Catalog refresh is a later maintenance action, not an initial public-staging
or release prerequisite. Both manual and schedule routes require
`CATALOG_REFRESH_ENABLED` to equal `enabled`. Obtain separate approval to activate
that maintenance policy, bind the manual run to the reviewed exact `B` tip, and only
then enable and dispatch it after the release workflow is complete:

```bash
REPO="seunghyeon1004/claude-code-skillsets"
gh variable set CATALOG_REFRESH_ENABLED --body enabled --repo "$REPO"
test "$(gh variable get CATALOG_REFRESH_ENABLED --repo "$REPO")" = enabled
gh workflow run catalog-refresh.yml --ref main -f expected_tip="$B"
```

The manual route checks the required tip before checkout and verifies the resulting
checkout against both the input and event SHA. The weekly schedule route separately
binds collection to its event SHA without accepting a manual input. On either route,
the publish job observes live `main` immediately before the branch push and again
after the push, then verifies the PR response base SHA against the validated base.
Those checks are point-in-time observations and cannot atomically lock `main`; a
residual race remains after the final observation. A mismatch or authenticated lookup
failure before a push attempt creates no branch. A nonzero client result can still
mean the server accepted a branch push or PR POST before response loss. The workflow
therefore records cleanup eligibility before each transport attempt and, on failure,
attempts authenticated inventory rather than trusting the client result.

Branch inventory distinguishes an absent exact ref, the exact candidate SHA, and any
other SHA. An absent ref is clean at that observation. Only the exact candidate may be
removed with an exact-candidate lease delete, followed by another authenticated
inventory. A branch at any other SHA is never deleted and requires operator review.
For a PR POST attempt, inventory binds the exact generated body, candidate branch,
candidate head SHA, base branch, base repository, and head repository. Repository
identity requires case-normalized `full_name` plus the stable repository ID, so a
fork PR cannot be accepted as a no-op or closed during cleanup. New PR responses use
the same repository identity checks. One exact match is closed and re-inventoried;
multiple matching PRs, malformed results, or lookup failure require operator review
instead of guessing.

These recovery steps cannot guarantee cleanup: an ambiguous transport result,
inventory failure, propagation delay, or a later concurrent write can prevent a final
confirmation. In that case the workflow remains failed with an operator-inventory
message. The operator must inspect the live refs and PRs before retrying. Existing
matching PRs and newly created PR responses must still bind both the validated base
and candidate head SHAs. The candidate bundle, exact base, and single-parent checks
remain mandatory before any remote write.

## Review ownership

The current repository has one collaborator, `seunghyeon1004`. `main` is PR-only and
has no bypass, but its `0` approvals and disabled CODEOWNERS review deliberately mean
human review is not guaranteed. Do not call this configuration independently reviewed.

When a second collaborator is actually added, use the stronger optional path before
claiming a human approval gate: set required approvals to `1`, enable CODEOWNERS
review, assign a second CODEOWNER, and verify that neither author can satisfy their
own review requirement. Add a tested reviewed-maintainer branch-protection policy and
a distinct sanitized disclosure in the same change; do not relabel an old
`solo-maintainer` receipt as compliant. Re-run the same-SHA CI, policy receipt,
local semantic RC, and anonymous-install gates after that policy change.
