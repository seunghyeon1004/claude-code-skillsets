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
or describe the candidate as released. Before the one-time remote bootstrap, any
code or documentation change creates a new SHA and restarts this stage. After the
bootstrap and R01 anchor exist, use the corrective-descendant contract in 1D instead;
the bootstrap cannot be restarted against the existing repository.

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

The one-time A/B bootstrap and the separately approved R01 anchor already exist. The
A / `public-history/root-v1` pair and B / `registry-approved/r01` pair are immutable.
Never move either tag and never rerun the bootstrap. Resolve all four identities from
the local annotated tags on every restart and compare them with the approved values;
do not rely on shell variables left by the bootstrap session.

Candidate C is a narrow post-bootstrap security and release maintenance commit. It
must have exactly B as its only parent. It may update only the exact reviewed path set
below. The R01-approved catalog bytes, catalog data, and protected research stay
unchanged. Those unchanged decision surfaces are the only reason a new registry tag
is not required. Protected research surface changes or catalog/data changes require
the reviewed research workflow and a next registry-approved tag.

```bash
set -euo pipefail
REPO="seunghyeon1004/claude-code-skillsets"
PUBLIC_REMOTE_URL="https://github.com/$REPO.git"
export GH_HOST=github.com
GH_API=(gh api --hostname github.com -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2026-03-10")

APPROVED_REPOSITORY_ID="1322344258"
APPROVED_PUBLIC_ROOT_A="cb2f51c097be78612b07bcafe66bc30914c7d5ac"
APPROVED_PUBLIC_ROOT_TAG_OBJECT="6b56351f581797fc3ca26bd0c3a1f7978da4c675"
APPROVED_BOOTSTRAP_TIP_B="0ad29eea67c9f504c345d8be2bbc514bd0de5aca"
APPROVED_R01_TAG_OBJECT="92da733d31af3db551a442e141fbd6b2bfd11010"

PUBLIC_ROOT_A="$(git rev-parse public-history/root-v1^{commit})"
PUBLIC_ROOT_TAG_OBJECT="$(git rev-parse public-history/root-v1^{tag})"
BOOTSTRAP_TIP_B="$(git rev-parse registry-approved/r01^{commit})"
R01_TAG_OBJECT="$(git rev-parse registry-approved/r01^{tag})"
test "$PUBLIC_ROOT_A" = "$APPROVED_PUBLIC_ROOT_A"
test "$PUBLIC_ROOT_TAG_OBJECT" = "$APPROVED_PUBLIC_ROOT_TAG_OBJECT"
test "$BOOTSTRAP_TIP_B" = "$APPROVED_BOOTSTRAP_TIP_B"
test "$R01_TAG_OBJECT" = "$APPROVED_R01_TAG_OBJECT"

CANDIDATE_SHA="$(git rev-parse HEAD)"
test "$(git rev-list --parents -n 1 "$CANDIDATE_SHA")" = "$CANDIDATE_SHA $BOOTSTRAP_TIP_B"
AUTHOR_EMAIL="$(git show -s --format=%ae "$CANDIDATE_SHA")"
case "$AUTHOR_EMAIL" in *.local) exit 1 ;; esac
COMMITTER_EMAIL="$(git show -s --format=%ce "$CANDIDATE_SHA")"
case "$COMMITTER_EMAIL" in *.local) exit 1 ;; esac
SIGNED_OFF_COUNT="$(git show -s --format=%B "$CANDIDATE_SHA" | git interpret-trailers --parse | awk -F': ' '$1 == "Signed-off-by" { count += 1 } END { print count + 0 }')"
test "$SIGNED_OFF_COUNT" = 1

EXPECTED_MAINTENANCE_PATHS="$(cat <<'PATHS'
README.en.md
README.md
docs/release/github-free-staged-public.md
package-lock.json
plugins/skillset-manager/THIRD_PARTY_NOTICES
plugins/skillset-manager/runtime.mjs
schemas/v3/branch-protection-receipt.schema.json
scripts/github/verify-branch-protection.ts
src/contracts/review-ledger.ts
src/evaluate/sanitize.ts
src/model/review-ledger.ts
tests/fixtures/github/branch-protection.valid.json
tests/integration/catalog-refresh-workflow.test.ts
tests/integration/plugin-package-readiness.test.ts
tests/integration/release-gates.test.ts
tests/unit/branch-protection.test.ts
tests/unit/sanitize.test.ts
PATHS
)"
ACTUAL_MAINTENANCE_PATHS="$(git diff --name-only "$BOOTSTRAP_TIP_B" "$CANDIDATE_SHA" | LC_ALL=C sort)"
test "$ACTUAL_MAINTENANCE_PATHS" = "$EXPECTED_MAINTENANCE_PATHS"

PROTECTED_RESEARCH_PATHS=(
  governance/reviewers.json
  manifests/decision-candidate-evidence.yaml
  manifests/complete-v1-providers
  manifests/source-reviews
  manifests/conflicts
  manifests/provider-selections
  research
)
R01_CATALOG_DATA_PATHS=(
  .claude-plugin/marketplace.json
  generated/catalog.en.md
  generated/catalog.ko.md
  generated/decision-index.json
  generated/install-index.json
  generated/official-marketplace-index.json
  manifests/official-listing-capability-claims.yaml
  manifests/plugins/skillset-manager.yaml
  plugins/skillset-manager/.claude-plugin/plugin.json
  plugins/skillset-manager/data
)
git diff --quiet "$BOOTSTRAP_TIP_B" "$CANDIDATE_SHA" -- \
  "${PROTECTED_RESEARCH_PATHS[@]}" "${R01_CATALOG_DATA_PATHS[@]}"

npm ci
test "$(node -p 'require("./package-lock.json").packages["node_modules/fast-uri"].version')" = "3.1.5"
test "$(node -p 'require("./package-lock.json").packages["node_modules/fast-uri"].integrity')" = "sha512-gHwA1O9LDIcKunMKhObS/HimwtehO1nPUECKAu5TpKgaO19fcWEl4bliWe1jWxVFvIXztJjjQ4L8XQ1EU9f7Jw=="
test "$(node -p 'require("./package-lock.json").packages["node_modules/postcss"].version')" = "8.5.25"
test "$(node -p 'require("./package-lock.json").packages["node_modules/postcss"].integrity')" = "sha512-DTPx3RWSSnWyzLxQnlH0rJP+EW5ekl16ZU4/psbIhA0e53kJfdgaN5vKM+xP7yJtXVu+nfdVFmlgFDEKAe4Pyw=="
test "$(node -p 'String(require("./package-lock.json").packages["node_modules/postcss"].dev)')" = true
test "$(node -p 'require("./package-lock.json").packages["node_modules/nanoid"].version')" = "3.3.18"
test "$(node -p 'require("./package-lock.json").packages["node_modules/nanoid"].integrity')" = "sha512-DTg4MJbGMWkfi6VZFdNt2/caMbQy4Ou+Op/hJQvGEWcnVfoA1QA+xzRKAzw9jD6+GVOOeYr/mIcuDSdug6F6+w=="
test "$(node -p 'String(require("./package-lock.json").packages["node_modules/nanoid"].dev)')" = true
npm ls fast-uri postcss nanoid
npm audit --audit-level=low
npm run check:manager-runtime
npm run check
REGISTRY_APPROVAL_ANCHORED=anchored \
APPROVED_REGISTRY_TAG_OBJECT="$R01_TAG_OBJECT" \
APPEND_BASE="$BOOTSTRAP_TIP_B" \
bash tests/e2e/clean-copy.sh

preflight_repository_state() {
  expected_visibility="$1"
  expected_main="$2"
  repository_json="$("${GH_API[@]}" --method GET "repos/$REPO")"
  test "$(jq -r '.id' <<<"$repository_json")" = "$APPROVED_REPOSITORY_ID"
  test "$(jq -r '.full_name' <<<"$repository_json")" = "$REPO"
  test "$(jq -r '.owner.login' <<<"$repository_json")" = "seunghyeon1004"
  test "$(jq -r '.owner.type' <<<"$repository_json")" = User
  test "$(jq -r '.visibility' <<<"$repository_json")" = "$expected_visibility"
  test "$(jq -r '.default_branch' <<<"$repository_json")" = main
  test "$(jq -r '.archived' <<<"$repository_json")" = false
  test "$("${GH_API[@]}" --method GET "repos/$REPO/git/ref/heads/main" --jq .object.sha)" = "$expected_main"
  test "$("${GH_API[@]}" --method GET "repos/$REPO/git/ref/tags/public-history/root-v1" --jq .object.sha)" = "$APPROVED_PUBLIC_ROOT_TAG_OBJECT"
  test "$("${GH_API[@]}" --method GET "repos/$REPO/git/tags/$APPROVED_PUBLIC_ROOT_TAG_OBJECT" --jq .object.sha)" = "$APPROVED_PUBLIC_ROOT_A"
  test "$("${GH_API[@]}" --method GET "repos/$REPO/git/ref/tags/registry-approved/r01" --jq .object.sha)" = "$APPROVED_R01_TAG_OBJECT"
  test "$("${GH_API[@]}" --method GET "repos/$REPO/git/tags/$APPROVED_R01_TAG_OBJECT" --jq .object.sha)" = "$APPROVED_BOOTSTRAP_TIP_B"
  expected_direct_refs="$(printf '%s\t%s\n' \
    "$expected_main" refs/heads/main \
    "$APPROVED_PUBLIC_ROOT_TAG_OBJECT" refs/tags/public-history/root-v1 \
    "$APPROVED_R01_TAG_OBJECT" refs/tags/registry-approved/r01 | LC_ALL=C sort)"
  test "$(git ls-remote --refs "$PUBLIC_REMOTE_URL" | LC_ALL=C sort)" = "$expected_direct_refs"
  expected_advertised_refs="$(printf '%s\t%s\n' \
    "$expected_main" refs/heads/main \
    "$APPROVED_PUBLIC_ROOT_TAG_OBJECT" refs/tags/public-history/root-v1 \
    "$APPROVED_PUBLIC_ROOT_A" 'refs/tags/public-history/root-v1^{}' \
    "$APPROVED_R01_TAG_OBJECT" refs/tags/registry-approved/r01 \
    "$APPROVED_BOOTSTRAP_TIP_B" 'refs/tags/registry-approved/r01^{}' | LC_ALL=C sort)"
  test "$(git ls-remote --heads --tags "$PUBLIC_REMOTE_URL" | LC_ALL=C sort)" = "$expected_advertised_refs"
  test "$(gh pr list --repo "$REPO" --state all --limit 1000 --json number | jq 'length')" = 0
}

preflight_repository_state private "$BOOTSTRAP_TIP_B"
printf 'approved target inventory: id=%s repo=%s owner=%s visibility=private main=%s root-tag=%s root=%s r01-tag=%s r01=%s\n' \
  "$APPROVED_REPOSITORY_ID" "$REPO" seunghyeon1004 "$BOOTSTRAP_TIP_B" \
  "$APPROVED_PUBLIC_ROOT_TAG_OBJECT" "$APPROVED_PUBLIC_ROOT_A" \
  "$APPROVED_R01_TAG_OBJECT" "$APPROVED_BOOTSTRAP_TIP_B"
```

Show that live inventory and the exact B:C push to the user. Obtain explicit approval
for this push only. It does not authorize public visibility, settings changes, a
release, or an announcement. Continue in the same shell only after that approval:

```bash
PREEXISTING_PUSH_RUNS="$(gh run list --repo "$REPO" --workflow ci.yml --event push --branch main --commit "$CANDIDATE_SHA" --limit 1000 --json databaseId,createdAt)"
PUSHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
preflight_repository_state private "$BOOTSTRAP_TIP_B"
git push --porcelain "$PUBLIC_REMOTE_URL" "$CANDIDATE_SHA:refs/heads/main"
preflight_repository_state private "$CANDIDATE_SHA"

list_new_push_run_ids() {
  gh run list --repo "$REPO" --workflow ci.yml --event push --branch main --commit "$CANDIDATE_SHA" --limit 1000 --json databaseId,createdAt \
    | jq -c --argjson preexisting "$PREEXISTING_PUSH_RUNS" --arg pushed_at "$PUSHED_AT" '
      [$preexisting[].databaseId] as $preexisting_ids
      | [.[] | .databaseId as $id | select(.createdAt >= $pushed_at) | select(($preexisting_ids | index($id)) == null) | $id]
    '
}

for attempt in $(seq 1 12); do
  NEW_PUSH_RUN_IDS="$(list_new_push_run_ids)"
  test "$(jq 'length' <<<"$NEW_PUSH_RUN_IDS")" -le 1
  test "$(jq 'length' <<<"$NEW_PUSH_RUN_IDS")" = 0 || break
  sleep 5
done
test "$(jq 'length' <<<"$NEW_PUSH_RUN_IDS")" = 1
PUSH_CI_RUN_ID="$(jq -r '.[0]' <<<"$NEW_PUSH_RUN_IDS")"
PUSH_CI_RUN="$(gh run view "$PUSH_CI_RUN_ID" --repo "$REPO" --json conclusion,event,headSha,jobs,status)"
test "$(jq -r '.event' <<<"$PUSH_CI_RUN")" = push
test "$(jq -r '.headSha' <<<"$PUSH_CI_RUN")" = "$CANDIDATE_SHA"
set +e
gh run watch "$PUSH_CI_RUN_ID" --repo "$REPO" --exit-status
PRIVATE_PUSH_WATCH_STATUS=$?
set -e
PUSH_CI_RUN="$(gh run view "$PUSH_CI_RUN_ID" --repo "$REPO" --json conclusion,event,headSha,jobs,status)"
test "$(jq -r '.event' <<<"$PUSH_CI_RUN")" = push
test "$(jq -r '.headSha' <<<"$PUSH_CI_RUN")" = "$CANDIDATE_SHA"
if test "$PRIVATE_PUSH_WATCH_STATUS" = 0; then
  test "$(jq -r '.status' <<<"$PUSH_CI_RUN")" = completed
  test "$(jq -r '.conclusion' <<<"$PUSH_CI_RUN")" = success
  test "$(jq '[.jobs[] | select(.name == "quality")] | length' <<<"$PUSH_CI_RUN")" = 1
  test "$(jq '[.jobs[] | select(.name == "quality" and .status == "completed" and .conclusion == "success")] | length' <<<"$PUSH_CI_RUN")" = 1
  test "$(jq '[.jobs[] | select(.name == "claude-plugin-validation")] | length' <<<"$PUSH_CI_RUN")" = 1
  test "$(jq '[.jobs[] | select(.name == "claude-plugin-validation" and .status == "completed" and .conclusion == "success")] | length' <<<"$PUSH_CI_RUN")" = 1
else
  gh run view "$PUSH_CI_RUN_ID" --repo "$REPO" --log-failed || true
  printf '%s\n' "STOP: classify the exact failure; only confirmed private Actions billing may proceed to visibility approval" >&2
  exit 2
fi
```

Run the gates for `CANDIDATE_SHA` in this order: exact push-event CI, branch
protection and its receipt, same-SHA semantic RC, then anonymous install. The exact
push-event run ID is mandatory evidence. A manual `workflow_dispatch`
current-tip run may be supplementary evidence, but it must never substitute for that
push run. If the watch stops, do not classify an arbitrary CI failure as billing.
Inspect the exact run and obtain explicit user confirmation that private-repository
Actions billing is the sole blocker. Preserve `PUSH_CI_RUN_ID`; only that confirmed
case may continue to stage 2 and rerun the same push-event run attempt after
visibility. Otherwise both exact `CANDIDATE_SHA` jobs, `quality` and
`claude-plugin-validation`, must reach terminal `success` while private.
Do not dispatch Catalog refresh during initial public staging. `CATALOG_REFRESH_ENABLED`
must remain unset through stages 1 to 6. After fresh live `main` is confirmed exactly
at `CANDIDATE_SHA`, proceed to stage 2 under its separate visibility approval.

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

Public visibility requires a separate explicit final user approval after the private
B:C push and exact push-run inventory. It is not a release and must not be combined
with a tag, GitHub Release, marketplace submission, or announcement. On a restarted
shell, restore the captured push run ID and derive C from the reviewed local commit.
Resolve and verify the immutable identities again before displaying the final live
inventory:

Obtain explicit final user approval before you change repository visibility to public.

```bash
set -euo pipefail
REPO="seunghyeon1004/claude-code-skillsets"
PUBLIC_REMOTE_URL="https://github.com/$REPO.git"
export GH_HOST=github.com
GH_API=(gh api --hostname github.com -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2026-03-10")
APPROVED_REPOSITORY_ID="1322344258"
APPROVED_PUBLIC_ROOT_A="cb2f51c097be78612b07bcafe66bc30914c7d5ac"
APPROVED_PUBLIC_ROOT_TAG_OBJECT="6b56351f581797fc3ca26bd0c3a1f7978da4c675"
APPROVED_BOOTSTRAP_TIP_B="0ad29eea67c9f504c345d8be2bbc514bd0de5aca"
APPROVED_R01_TAG_OBJECT="92da733d31af3db551a442e141fbd6b2bfd11010"
BOOTSTRAP_TIP_B="$(git rev-parse registry-approved/r01^{commit})"
CANDIDATE_SHA="$(git rev-parse HEAD)"
PUSH_CI_RUN_ID="<captured-push-run-id>"
test "$(git rev-parse public-history/root-v1^{commit})" = "$APPROVED_PUBLIC_ROOT_A"
test "$(git rev-parse public-history/root-v1^{tag})" = "$APPROVED_PUBLIC_ROOT_TAG_OBJECT"
test "$BOOTSTRAP_TIP_B" = "$APPROVED_BOOTSTRAP_TIP_B"
test "$(git rev-parse registry-approved/r01^{tag})" = "$APPROVED_R01_TAG_OBJECT"
test "$(git rev-list --parents -n 1 "$CANDIDATE_SHA")" = "$CANDIDATE_SHA $BOOTSTRAP_TIP_B"

preflight_repository_state() {
  expected_visibility="$1"
  expected_main="$2"
  repository_json="$("${GH_API[@]}" --method GET "repos/$REPO")"
  test "$(jq -r '.id' <<<"$repository_json")" = "$APPROVED_REPOSITORY_ID"
  test "$(jq -r '.full_name' <<<"$repository_json")" = "$REPO"
  test "$(jq -r '.owner.login' <<<"$repository_json")" = "seunghyeon1004"
  test "$(jq -r '.owner.type' <<<"$repository_json")" = User
  test "$(jq -r '.visibility' <<<"$repository_json")" = "$expected_visibility"
  test "$(jq -r '.default_branch' <<<"$repository_json")" = main
  test "$(jq -r '.archived' <<<"$repository_json")" = false
  test "$("${GH_API[@]}" --method GET "repos/$REPO/git/ref/heads/main" --jq .object.sha)" = "$expected_main"
  test "$("${GH_API[@]}" --method GET "repos/$REPO/git/ref/tags/public-history/root-v1" --jq .object.sha)" = "$APPROVED_PUBLIC_ROOT_TAG_OBJECT"
  test "$("${GH_API[@]}" --method GET "repos/$REPO/git/tags/$APPROVED_PUBLIC_ROOT_TAG_OBJECT" --jq .object.sha)" = "$APPROVED_PUBLIC_ROOT_A"
  test "$("${GH_API[@]}" --method GET "repos/$REPO/git/ref/tags/registry-approved/r01" --jq .object.sha)" = "$APPROVED_R01_TAG_OBJECT"
  test "$("${GH_API[@]}" --method GET "repos/$REPO/git/tags/$APPROVED_R01_TAG_OBJECT" --jq .object.sha)" = "$APPROVED_BOOTSTRAP_TIP_B"
  expected_direct_refs="$(printf '%s\t%s\n' \
    "$expected_main" refs/heads/main \
    "$APPROVED_PUBLIC_ROOT_TAG_OBJECT" refs/tags/public-history/root-v1 \
    "$APPROVED_R01_TAG_OBJECT" refs/tags/registry-approved/r01 | LC_ALL=C sort)"
  test "$(git ls-remote --refs "$PUBLIC_REMOTE_URL" | LC_ALL=C sort)" = "$expected_direct_refs"
  expected_advertised_refs="$(printf '%s\t%s\n' \
    "$expected_main" refs/heads/main \
    "$APPROVED_PUBLIC_ROOT_TAG_OBJECT" refs/tags/public-history/root-v1 \
    "$APPROVED_PUBLIC_ROOT_A" 'refs/tags/public-history/root-v1^{}' \
    "$APPROVED_R01_TAG_OBJECT" refs/tags/registry-approved/r01 \
    "$APPROVED_BOOTSTRAP_TIP_B" 'refs/tags/registry-approved/r01^{}' | LC_ALL=C sort)"
  test "$(git ls-remote --heads --tags "$PUBLIC_REMOTE_URL" | LC_ALL=C sort)" = "$expected_advertised_refs"
  test "$(gh pr list --repo "$REPO" --state all --limit 1000 --json number | jq 'length')" = 0
}

preflight_repository_state private "$CANDIDATE_SHA"
PUSH_CI_RUN="$(gh run view "$PUSH_CI_RUN_ID" --repo "$REPO" --json conclusion,event,headSha,jobs,status)"
test "$(jq -r '.event' <<<"$PUSH_CI_RUN")" = push
test "$(jq -r '.headSha' <<<"$PUSH_CI_RUN")" = "$CANDIDATE_SHA"
```

Show this exact private inventory and push-run state, explain that public copies cannot
be recalled, and obtain explicit final approval. Continue in the same shell only after
approval:

```bash
preflight_repository_state private "$CANDIDATE_SHA"
gh repo edit "github.com/$REPO" --visibility public --accept-visibility-change-consequences
preflight_repository_state public "$CANDIDATE_SHA"

if test "$(jq -r '.conclusion' <<<"$PUSH_CI_RUN")" != success; then
  gh run rerun "$PUSH_CI_RUN_ID" --repo "$REPO"
fi
gh run watch "$PUSH_CI_RUN_ID" --repo "$REPO" --exit-status
PUSH_CI_RUN="$(gh run view "$PUSH_CI_RUN_ID" --repo "$REPO" --json conclusion,event,headSha,jobs,status)"
test "$(jq -r '.event' <<<"$PUSH_CI_RUN")" = push
test "$(jq -r '.status' <<<"$PUSH_CI_RUN")" = completed
test "$(jq -r '.conclusion' <<<"$PUSH_CI_RUN")" = success
test "$(jq -r '.headSha' <<<"$PUSH_CI_RUN")" = "$CANDIDATE_SHA"
test "$(jq '[.jobs[] | select(.name == "quality")] | length' <<<"$PUSH_CI_RUN")" = 1
test "$(jq '[.jobs[] | select(.name == "quality" and .status == "completed" and .conclusion == "success")] | length' <<<"$PUSH_CI_RUN")" = 1
test "$(jq '[.jobs[] | select(.name == "claude-plugin-validation")] | length' <<<"$PUSH_CI_RUN")" = 1
test "$(jq '[.jobs[] | select(.name == "claude-plugin-validation" and .status == "completed" and .conclusion == "success")] | length' <<<"$PUSH_CI_RUN")" = 1
preflight_repository_state public "$CANDIDATE_SHA"
```

If private billing blocked the first attempt, the successful evidence above is the
same push-event run attempt rerun after visibility, not a manual dispatch. Only after
that exact run succeeds, enable the public private-vulnerability-reporting endpoint
that `SUPPORT.md` links to. Repeat the full preflight immediately before and after the
mutation:

After visibility, the exact push-event jobs must be successful. Only then may branch
protection and its prerequisite public support setting be changed.

```bash
preflight_repository_state public "$CANDIDATE_SHA"
"${GH_API[@]}" --method PUT "repos/$REPO/private-vulnerability-reporting"
preflight_repository_state public "$CANDIDATE_SHA"
test "$("${GH_API[@]}" "repos/$REPO/private-vulnerability-reporting" --jq .enabled)" = true
preflight_repository_state public "$CANDIDATE_SHA"
```

Only after that support gate passes, apply `main` branch protection and verify the
live policy. Signed-commit protection is a separate GitHub endpoint and this policy
keeps it disabled. Before branch protection exists, the probe must return exact HTTP
404. After protection is applied, the pinned API must return HTTP 200 with the exact
repository endpoint and `enabled: false`; another status, malformed response,
`enabled: true`, or a transport failure stops the release:

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

The target is a personal-account repository, so omit
`bypass_pull_request_allowances`; field absence means no bypass for this owner type.
An organization-owned repository must instead include explicit empty
`bypass_pull_request_allowances` arrays for `users`, `teams`, and `apps`. Any present
malformed or nonempty child is a verification failure for either owner type.
The protection PUT still sends `restrictions: null`. GitHub may omit that field from
the subsequent GET for a personal repository because push restrictions are an
organization-only feature; the verifier accepts only that owner-aware omission or an
explicit `null` and rejects every non-null value.

GitHub's whole protection request is contexts-only. After the full protection GET,
use the status-check subresource with a checks-only PATCH if the app pins do not
match. Here checks-only means no `contexts`; the subresource payload also repeats
`strict: true`. Never put `contexts` and `checks` in the same request object. The
first payload requires pull requests even though the minimum approval count is zero:

```bash
set -euo pipefail
mkdir -p .release-evidence
preflight_repository_state public "$CANDIDATE_SHA"

set +e
SIGNATURE_PROBE_BEFORE="$("${GH_API[@]}" --method GET --include --silent "repos/$REPO/branches/main/protection/required_signatures" 2>&1)"
SIGNATURE_PROBE_BEFORE_STATUS=$?
set -e
test "$SIGNATURE_PROBE_BEFORE_STATUS" = 1
grep -Eq '^HTTP/\S+ 404([[:space:]]|$)' <<<"$SIGNATURE_PROBE_BEFORE"
preflight_repository_state public "$CANDIDATE_SHA"

cat > .release-evidence/main-protection.json <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["claude-plugin-validation", "quality"]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 0,
    "require_last_push_approval": false
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
preflight_repository_state public "$CANDIDATE_SHA"
"${GH_API[@]}" --method PUT "repos/$REPO/branches/main/protection" \
  --input .release-evidence/main-protection.json

preflight_repository_state public "$CANDIDATE_SHA"
FULL_PROTECTION="$("${GH_API[@]}" --method GET "repos/$REPO/branches/main/protection")"
if ! jq -e '
  [.required_status_checks.checks[] | {context, app_id}] | sort_by(.context)
  == [
    {"context":"claude-plugin-validation","app_id":15368},
    {"context":"quality","app_id":15368}
  ]
' <<<"$FULL_PROTECTION" >/dev/null; then
  cat > .release-evidence/status-checks.json <<'JSON'
{
  "strict": true,
  "checks": [
    { "context": "claude-plugin-validation", "app_id": 15368 },
    { "context": "quality", "app_id": 15368 }
  ]
}
JSON
  preflight_repository_state public "$CANDIDATE_SHA"
  "${GH_API[@]}" --method PATCH "repos/$REPO/branches/main/protection/required_status_checks" \
    --input .release-evidence/status-checks.json
fi
preflight_repository_state public "$CANDIDATE_SHA"

REQUIRED_SIGNATURES_AFTER="$("${GH_API[@]}" --method GET "repos/$REPO/branches/main/protection/required_signatures")"
test "$(jq -r '.url' <<<"$REQUIRED_SIGNATURES_AFTER")" = "https://api.github.com/repos/$REPO/branches/main/protection/required_signatures"
test "$(jq -r '.enabled' <<<"$REQUIRED_SIGNATURES_AFTER")" = false
preflight_repository_state public "$CANDIDATE_SHA"
```

Use the normal read-only GitHub CLI session to create the local receipt after the
policy is applied; no self-hosted runner, protected environment, or special
Administration token is a public-release prerequisite:

```bash
preflight_repository_state public "$CANDIDATE_SHA"
mkdir -p .release-evidence/raw
npm run verify:branch-protection -- \
  --repo seunghyeon1004/claude-code-skillsets --repository-id 1322344258 \
  --expected-tip "$CANDIDATE_SHA" \
  --branch main \
  --output .release-evidence/raw/branch-protection.json
npm run eval:sanitize -- .release-evidence/raw .release-evidence/sanitized
npm run eval:sanitize:verify -- .release-evidence/sanitized
```

The verifier uses the same fixed GitHub API media type and version as the runbook. In
one invocation it fetches the repository, verifies `main` at exact `CANDIDATE_SHA`,
fetches protection and the separate required-signatures endpoint, then verifies
`main` again. The raw receipt preserves repository ID, full name, owner login/type,
commit SHA, and `requiredSignaturesEnabled: false`. The sanitized receipt deliberately
removes repository full name and owner login; it preserves repository ID, owner type,
commit SHA, and the disabled-signatures evidence. If any identity or tip changes,
stop and use rollback.

## 3. Protected same-SHA local semantic RC

Use a clean local checkout of protected `main` at the exact `CANDIDATE_SHA`. After explicit
approval for the local subscription Claude CLI evaluation, run the read-only fixture
suite below. The command refuses a dirty worktree, a non-`main` branch, or a SHA that
does not equal the local `main` tip before it invokes Claude. Its evaluator uses the
repository's fixture data and Claude Code safe mode with read-only tools; it does not
install candidates, mutate GitHub, or use a remote runner.

Before creating an artifact or invoking a model, the runner resolves one canonical
regular Claude executable and requires `claude auth status --json` to report
`loggedIn: true`, `authMethod: "claude.ai"`, `apiProvider: "firstParty"`, and a
nonempty subscription type. API-key, auth-token, custom-base-URL, Bedrock, Vertex,
and Foundry routing environment variables fail the gate. Authentication email,
organization, tokens, headers, cookies, and the inherited environment are never
written to the receipt. Every evaluation child receives only the runner's fixed
non-secret environment allowlist, including the operating-system-derived `USER`
required for macOS Keychain subscription lookup; an inherited `USER` value is ignored.
The runner executes canonical `tsx` directly,
outside the npm lifecycle, and passes the verified Claude executable absolute path
and SHA-256 to each evaluator for validation before and after every model call.

```bash
SHA="$CANDIDATE_SHA"
test "$(git rev-parse HEAD)" = "$SHA"
npm ci
npm run verify:solo-semantic-rc -- \
  --commit-sha "$SHA" \
  --output-dir "$PWD/.rc-artifacts/$SHA" \
  --execute --approved-read-only
```

Keep only `.rc-artifacts/$SHA/sanitized` as release evidence. The generated local
target receipt identifies the exact SHA; the routing path, byte length, byte digest,
and self digest; the full decision-index byte length, byte digest, and semantic
digest; the catalog version and validity interval; and the observed `claude.ai`
subscription mode. It records `semanticHarnessStatus: "passed"` separately from
`executableAvailability`: a passing language harness does not make a review-held
catalog executable. The receipt repeats `humanReviewGuarantee: "not-guaranteed"`
and must never be described as a full or independent human review. Do not reuse a
receipt from another SHA or another routing/catalog byte set.

A manual exact-SHA owner waiver is an exceptional alternative. Do not request it until
Stage 5 has freshly verified the protected public remote `main` final SHA and branch
protection for this release. The user must explicitly decline the full same-SHA
semantic RC because of subscription cost, acknowledge that semantic coverage is not
proven, and attest that no semantic failure is known. Stage 5 constructs and displays
the exact token only after that live preflight. The token is an operational
acknowledgement, not a secret or authentication credential.

This manual waiver creates no local waiver receipt and has no local verifier. The
manual waiver is not a pass and does not mechanically prove historical absence. The
owner must not delete or hide a known semantic failure to obtain the waiver. Any SHA
change invalidates the approval and requires a newly displayed exact token and new
approval.

The GitHub Release target SHA must equal `$SHA`. The release body, repository README,
and submission-visible description must each display this exact disclosure:

> Full exact-SHA semantic RC was not run; semantic coverage is not proven; release proceeds under an explicit owner waiver.

## 4. Unauthenticated installation verification

From a clean environment with no GitHub authentication, verify that the exact same
`CANDIDATE_SHA` is reachable by HTTPS clone. Then test public marketplace add, manager install,
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

Run the actual public install in a disposable environment. This uses only this
repository's manager and its same-marketplace `shared-core` dependency; it does not
install an external candidate. Preserve only the projected JSON evidence, never the
temporary paths or raw Claude configuration:

```bash
set -euo pipefail
REPO="seunghyeon1004/claude-code-skillsets"
PUBLIC_REMOTE_URL="https://github.com/$REPO.git"
GH_API=(gh api --hostname github.com -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2026-03-10")
APPROVED_REPOSITORY_ID="1322344258"
APPROVED_PUBLIC_ROOT_A="cb2f51c097be78612b07bcafe66bc30914c7d5ac"
APPROVED_PUBLIC_ROOT_TAG_OBJECT="6b56351f581797fc3ca26bd0c3a1f7978da4c675"
APPROVED_BOOTSTRAP_TIP_B="0ad29eea67c9f504c345d8be2bbc514bd0de5aca"
APPROVED_R01_TAG_OBJECT="92da733d31af3db551a442e141fbd6b2bfd11010"
RECEIPT_PATH="$PWD/.release-evidence/sanitized/branch-protection.json"
CANDIDATE_SHA="$(jq -er '.commitSha | select(test("^[0-9a-f]{40}$"))' "$RECEIPT_PATH")"
test "$(git rev-parse HEAD)" = "$CANDIDATE_SHA"

preflight_public_candidate() {
  repository_json="$("${GH_API[@]}" --method GET "repos/$REPO")"
  test "$(jq -r '.id' <<<"$repository_json")" = "$APPROVED_REPOSITORY_ID"
  test "$(jq -r '.full_name' <<<"$repository_json")" = "$REPO"
  test "$(jq -r '.owner.login' <<<"$repository_json")" = seunghyeon1004
  test "$(jq -r '.owner.type' <<<"$repository_json")" = User
  test "$(jq -r '.visibility' <<<"$repository_json")" = public
  test "$(jq -r '.default_branch' <<<"$repository_json")" = main
  test "$(jq -r '.archived' <<<"$repository_json")" = false
  test "$(git ls-remote --heads "$PUBLIC_REMOTE_URL" refs/heads/main)" = \
    "$(printf '%s\t%s' "$CANDIDATE_SHA" refs/heads/main)"
  expected_tags="$(printf '%s\t%s\n' \
    "$APPROVED_PUBLIC_ROOT_TAG_OBJECT" refs/tags/public-history/root-v1 \
    "$APPROVED_PUBLIC_ROOT_A" 'refs/tags/public-history/root-v1^{}' \
    "$APPROVED_R01_TAG_OBJECT" refs/tags/registry-approved/r01 \
    "$APPROVED_BOOTSTRAP_TIP_B" 'refs/tags/registry-approved/r01^{}' | LC_ALL=C sort)"
  test "$(git ls-remote --tags "$PUBLIC_REMOTE_URL" | LC_ALL=C sort)" = "$expected_tags"
  test "$(gh pr list --repo "$REPO" --state open --limit 1000 --json number | jq 'length')" = 0
}

preflight_public_candidate
EVIDENCE_BASE="$PWD"
ANON_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/skillsets-anonymous-install.XXXXXX")"
trap 'rm -rf "$ANON_ROOT"' EXIT
mkdir -p "$ANON_ROOT/home" "$ANON_ROOT/claude" "$ANON_ROOT/plugin-cache" "$ANON_ROOT/project" "$ANON_ROOT/tmp"
TRUSTED_PATH="$(dirname "$(command -v claude)"):/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

env -i \
  PATH="$TRUSTED_PATH" \
  HOME="$ANON_ROOT/home" \
  SHELL=/bin/bash \
  TMPDIR="$ANON_ROOT/tmp" \
  LC_ALL=C \
  CLAUDE_CONFIG_DIR="$ANON_ROOT/claude" \
  CLAUDE_CODE_PLUGIN_CACHE_DIR="$ANON_ROOT/plugin-cache" \
  GIT_CONFIG_GLOBAL=/dev/null \
  GIT_CONFIG_NOSYSTEM=1 \
  GIT_TERMINAL_PROMPT=0 \
  REPO="$REPO" \
  CANDIDATE_SHA="$CANDIDATE_SHA" \
  ANON_ROOT="$ANON_ROOT" \
  EVIDENCE_BASE="$EVIDENCE_BASE" \
  /bin/bash --noprofile --norc <<'ANONYMOUS_INSTALL'
set -euo pipefail
unset GH_TOKEN GITHUB_TOKEN SSH_AUTH_SOCK GIT_ASKPASS GIT_CONFIG_PARAMETERS GIT_CONFIG_COUNT

canonical_directory_below() {
  candidate="$1"
  boundary="$2"
  test -d "$candidate"
  test ! -L "$candidate"
  candidate_real="$(cd "$candidate" && pwd -P)"
  boundary_real="$(cd "$boundary" && pwd -P)"
  case "$candidate_real" in
    "$boundary_real"/*) printf '%s\n' "$candidate_real" ;;
    *) return 1 ;;
  esac
}

compare_plugin_tree() {
  expected="$1"
  installed="$2"
  test -z "$(find "$expected" -type l -print -quit)"
  test -z "$(find "$installed" -type l -print -quit)"
  test -z "$(find "$expected" -name .in_use -print -quit)"
  test -z "$(find "$installed" -name .in_use ! -path "$installed/.in_use" -print -quit)"
  if test -e "$installed/.in_use"; then
    test -d "$installed/.in_use"
    test ! -L "$installed/.in_use"
    test -z "$(find "$installed/.in_use" -mindepth 1 -print -quit)"
  fi
  diff -qr -x .in_use -- "$expected" "$installed"
}

ANON_REPO_URL="https://github.com/$REPO.git"
test "$(git -c credential.helper= ls-remote "$ANON_REPO_URL" refs/heads/main | awk '{print $1}')" = "$CANDIDATE_SHA"
git -c credential.helper= clone --no-tags --single-branch --branch main "$ANON_REPO_URL" "$ANON_ROOT/project/repository"
test "$(git -C "$ANON_ROOT/project/repository" rev-parse HEAD)" = "$CANDIDATE_SHA"
cd "$ANON_ROOT/project"
claude plugin marketplace add "$REPO" --scope local
claude plugin install skillset-manager@claude-code-skillsets --scope local

MARKETPLACES="$(claude plugin marketplace list --json)"
PLUGINS="$(claude plugin list --json)"
jq -e --arg repo "$REPO" '
  [.[] | select(.name == "claude-code-skillsets" and .repo == $repo and .source == "github")] | length == 1
' <<<"$MARKETPLACES" >/dev/null
jq -e '
  ([.[] | select(.id == "skillset-manager@claude-code-skillsets" and .version == "0.1.3" and .scope == "local" and .enabled == true)] | length == 1)
  and
  ([.[] | select(.id == "shared-core@claude-code-skillsets" and .version == "0.1.0" and .scope == "local" and .enabled == true)] | length == 1)
' <<<"$PLUGINS" >/dev/null

MARKETPLACE_LOCATION="$(jq -er '.[] | select(.name == "claude-code-skillsets") | .installLocation' <<<"$MARKETPLACES")"
MANAGER_INSTALL_PATH="$(jq -er '.[] | select(.id == "skillset-manager@claude-code-skillsets") | .installPath' <<<"$PLUGINS")"
SHARED_INSTALL_PATH="$(jq -er '.[] | select(.id == "shared-core@claude-code-skillsets") | .installPath' <<<"$PLUGINS")"
MARKETPLACE_ROOT="$(canonical_directory_below "$MARKETPLACE_LOCATION" "$ANON_ROOT")"
MANAGER_ROOT="$(canonical_directory_below "$MANAGER_INSTALL_PATH" "$ANON_ROOT/plugin-cache")"
SHARED_ROOT="$(canonical_directory_below "$SHARED_INSTALL_PATH" "$ANON_ROOT/plugin-cache")"
test "$(git -C "$MARKETPLACE_ROOT" rev-parse HEAD)" = "$CANDIDATE_SHA"
compare_plugin_tree "$ANON_ROOT/project/repository/plugins/skillset-manager" "$MANAGER_ROOT"
compare_plugin_tree "$ANON_ROOT/project/repository/plugins/shared-core" "$SHARED_ROOT"

# The request carries only routing projection values; the installed runtime authenticates the full decision index.
ROUTING_INDEX_PATH="$MANAGER_ROOT/data/routing-index.json"
DECISION_INDEX_DIGEST="$(jq -er '.decisionIndexDigest | select(test("^[a-f0-9]{64}$"))' "$ROUTING_INDEX_PATH")"
ROUTING_INDEX_DIGEST="$(jq -er '.digest | select(test("^[a-f0-9]{64}$"))' "$ROUTING_INDEX_PATH")"
REQUEST="$(node -e '
const fs = require("node:fs");
const routing = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const request = {
  schemaVersion: 2,
  language: "en",
  platform: "linux",
  observedAt: routing.observedThrough,
  claudeProbeConsent: "granted",
  domainIds: [routing.profiles[0].domainId],
  decisionIndexDigest: routing.decisionIndexDigest,
  routingIndexDigest: routing.digest
};
process.stdout.write(Buffer.from(`${JSON.stringify(request, null, 2)}\n`).toString("base64url"));
' "$ROUTING_INDEX_PATH")"
PREVIEW="$(node "$MANAGER_ROOT/runtime.mjs" preview --request "$REQUEST")"
jq -e --arg decision_digest "$DECISION_INDEX_DIGEST" --arg routing_digest "$ROUTING_INDEX_DIGEST" '
  .command == "preview"
  and .status == "held"
  and (has("approvedExecution") | not)
  and (.reviewSummary | split("\n") | any(. == "decisionIndexDigest: \($decision_digest)"))
  and (.reviewSummary | split("\n") | any(. == "routingIndexDigest: \($routing_digest)"))
' \
  <<<"$PREVIEW" >/dev/null

EVIDENCE_ROOT="$EVIDENCE_BASE/.release-evidence"
EVIDENCE_SANITIZED="$EVIDENCE_ROOT/sanitized"
test ! -L "$EVIDENCE_ROOT"
mkdir -p "$EVIDENCE_ROOT"
test ! -L "$EVIDENCE_ROOT"
test ! -L "$EVIDENCE_SANITIZED"
mkdir -p "$EVIDENCE_SANITIZED"
test ! -L "$EVIDENCE_SANITIZED"
EVIDENCE_DIR="$EVIDENCE_SANITIZED/anonymous-install-$CANDIDATE_SHA"
test ! -e "$EVIDENCE_DIR"
mkdir "$EVIDENCE_DIR"
set -o noclobber
jq --arg repo "$REPO" '[.[] | select(.name == "claude-code-skillsets") | {name, repo: $repo, source}]' \
  <<<"$MARKETPLACES" > "$EVIDENCE_DIR/marketplace.json"
jq '[.[] | select(.id == "skillset-manager@claude-code-skillsets" or .id == "shared-core@claude-code-skillsets") | {id, version, scope, enabled}]' \
  <<<"$PLUGINS" > "$EVIDENCE_DIR/plugins.json"
jq --arg decision_digest "$DECISION_INDEX_DIGEST" --arg routing_digest "$ROUTING_INDEX_DIGEST" \
  '{command, status, approvedExecutionPresent: has("approvedExecution"), decisionIndexDigest: $decision_digest, routingIndexDigest: $routing_digest}' \
  <<<"$PREVIEW" > "$EVIDENCE_DIR/preview.json"
ANONYMOUS_INSTALL

test "$(git rev-parse HEAD)" = "$CANDIDATE_SHA"
preflight_public_candidate
```

If any anonymous clone, source, dependency, version, or enablement check fails, stage
4 fails. The `EXIT` trap removes only the isolated temporary root. Do not install an
external candidate during this release check without its separate user approval.

## 5. Release, tag, and announcement

Immediately before any release tag or GitHub Release, run the following preparation
block in the stage 4 shell. This is the post-bootstrap path: merged pull-request
history and non-release heads may exist, but there must be no open pull request. The
release-bearing refs must be exact: `main` at the candidate and only the two immutable
governance tags before release. Stages 1, 2, and 4 must pass for the unchanged SHA.
Set `SEMANTIC_DISPOSITION` to exactly `full-pass` or `manual-waiver`; the two branches
produce different public release bodies and cannot be combined. A waiver is not
passed, and a known semantic failure cannot be waived.

```bash
set -euo pipefail
SHA="$CANDIDATE_SHA"
RELEASE_TAG="v0.1.0"
RELEASE_TITLE="Claude Code Skillsets v0.1.0"
SEMANTIC_DISPOSITION="${SEMANTIC_DISPOSITION:?set full-pass or manual-waiver}"
DISCLOSURE="Full exact-SHA semantic RC was not run; semantic coverage is not proven; release proceeds under an explicit owner waiver."
RELEASE_EVIDENCE="$PWD/.release-evidence/release-$SHA"
RELEASE_BODY="$RELEASE_EVIDENCE/release-body.md"
APPROVAL_MANIFEST="$RELEASE_EVIDENCE/approval-manifest.json"
SEMANTIC_EVIDENCE_ROOT="$PWD/.rc-artifacts/$SHA/sanitized"

verify_full_semantic_pass() {
  semantic_receipt="$SEMANTIC_EVIDENCE_ROOT/governance/local-semantic-rc-target.json"
  npm run eval:sanitize:verify -- "$SEMANTIC_EVIDENCE_ROOT"
  jq -e --arg sha "$SHA" '
    .schemaVersion == 6
    and .receiptType == "local-semantic-rc-target"
    and .commitSha == $sha
    and .semanticHarnessStatus == "passed"
  ' "$semantic_receipt" >/dev/null
}

test "$(git rev-parse HEAD)" = "$SHA"
preflight_public_candidate
test "$("${GH_API[@]}" --method GET "repos/$REPO/git/ref/heads/main" --jq .object.sha)" = "$SHA"
test ! -e "$RELEASE_EVIDENCE"
mkdir -p "$RELEASE_EVIDENCE/raw"
npm run verify:branch-protection -- \
  --repo "$REPO" --repository-id "$APPROVED_REPOSITORY_ID" \
  --expected-tip "$SHA" --branch main \
  --output "$RELEASE_EVIDENCE/raw/branch-protection.json"
npm run eval:sanitize -- "$RELEASE_EVIDENCE/raw" "$RELEASE_EVIDENCE/sanitized"
npm run eval:sanitize:verify -- "$RELEASE_EVIDENCE/sanitized"

set +e
PREEXISTING_RELEASE="$("${GH_API[@]}" --method GET --include --silent "repos/$REPO/releases/tags/$RELEASE_TAG" 2>&1)"
PREEXISTING_RELEASE_STATUS=$?
set -e
test "$PREEXISTING_RELEASE_STATUS" = 1
grep -Eq '^HTTP/\S+ 404([[:space:]]|$)' <<<"$PREEXISTING_RELEASE"
test -z "$(git ls-remote --refs "$PUBLIC_REMOTE_URL" "refs/tags/$RELEASE_TAG")"

case "$SEMANTIC_DISPOSITION" in
  full-pass)
    verify_full_semantic_pass
    cat > "$RELEASE_BODY" <<EOF
# Claude Code Skillsets v0.1.0

Release commit: $SHA

Full exact-SHA semantic RC passed.
EOF
    ;;
  manual-waiver)
    WAIVER="WAIVE-FULL-SEMANTIC-RC:$SHA:SUBSCRIPTION-COST:SEMANTIC-COVERAGE-NOT-PROVEN:NO-KNOWN-SEMANTIC-FAILURE"
    cat > "$RELEASE_BODY" <<EOF
# Claude Code Skillsets v0.1.0

Release commit: $SHA

$DISCLOSURE

Owner waiver: $WAIVER
EOF
    ;;
  *)
    printf '%s\n' "Unsupported SEMANTIC_DISPOSITION: $SEMANTIC_DISPOSITION" >&2
    exit 1
    ;;
esac

RELEASE_BODY_SHA256="$(shasum -a 256 "$RELEASE_BODY" | awk '{print $1}')"
jq -n \
  --arg repository "$REPO" \
  --arg tag "$RELEASE_TAG" \
  --arg targetSha "$SHA" \
  --arg title "$RELEASE_TITLE" \
  --arg semanticDisposition "$SEMANTIC_DISPOSITION" \
  --arg releaseBodySha256 "$RELEASE_BODY_SHA256" \
  '{schemaVersion: 1, repository: $repository, tag: $tag, targetSha: $targetSha,
    title: $title, semanticDisposition: $semanticDisposition,
    releaseBodySha256: $releaseBodySha256}' > "$APPROVAL_MANIFEST"
APPROVAL_MANIFEST_SHA256="$(shasum -a 256 "$APPROVAL_MANIFEST" | awk '{print $1}')"
readonly APPROVED_RELEASE_REPO="$REPO"
readonly APPROVED_RELEASE_TAG="$RELEASE_TAG"
readonly APPROVED_RELEASE_SHA="$SHA"
readonly APPROVED_RELEASE_TITLE="$RELEASE_TITLE"
readonly APPROVED_SEMANTIC_DISPOSITION="$SEMANTIC_DISPOSITION"
readonly APPROVED_RELEASE_BODY_SHA256="$RELEASE_BODY_SHA256"
readonly APPROVED_MANIFEST_SHA256="$APPROVAL_MANIFEST_SHA256"
printf 'Repository: %s\nTag to create: %s\nTarget SHA: %s\nTitle: %s\nSemantic disposition: %s\nRelease body SHA-256: %s\n' \
  "$REPO" "$RELEASE_TAG" "$SHA" "$RELEASE_TITLE" "$SEMANTIC_DISPOSITION" "$RELEASE_BODY_SHA256"
printf 'Approval manifest SHA-256: %s\n' "$APPROVAL_MANIFEST_SHA256"
cat "$APPROVAL_MANIFEST"
printf '%s\n' '--- Exact GitHub Release body ---'
cat "$RELEASE_BODY"
if test "$SEMANTIC_DISPOSITION" = manual-waiver; then
  printf '%s\n' '--- Exact owner-waiver token ---' "$WAIVER"
fi
```

Stop here for every disposition. Obtain explicit approval for the displayed repository,
new lightweight tag, target SHA, title, approval manifest digest, and exact GitHub
Release body. For
`manual-waiver`, the same approval must also cover the complete displayed waiver token
and acknowledge that the tag and Release are remote mutations. Any SHA or body change
invalidates the approval. After approval, rerun the complete live preflight below; do
not rely on the pre-approval result. The release command may have succeeded even if the
client returns nonzero, so do not retry it. Continue directly to authenticated inventory
and accept success only if every postcondition holds.

```bash
test "$(git rev-parse HEAD)" = "$SHA"
test "$REPO" = "$APPROVED_RELEASE_REPO"
test "$RELEASE_TAG" = "$APPROVED_RELEASE_TAG"
test "$SHA" = "$APPROVED_RELEASE_SHA"
test "$SHA" = "$CANDIDATE_SHA"
test "$RELEASE_TITLE" = "$APPROVED_RELEASE_TITLE"
test "$SEMANTIC_DISPOSITION" = "$APPROVED_SEMANTIC_DISPOSITION"
test "$(shasum -a 256 "$RELEASE_BODY" | awk '{print $1}')" = "$APPROVED_RELEASE_BODY_SHA256"
test "$(shasum -a 256 "$APPROVAL_MANIFEST" | awk '{print $1}')" = "$APPROVED_MANIFEST_SHA256"
jq -e \
  --arg repository "$APPROVED_RELEASE_REPO" \
  --arg tag "$APPROVED_RELEASE_TAG" \
  --arg targetSha "$APPROVED_RELEASE_SHA" \
  --arg title "$APPROVED_RELEASE_TITLE" \
  --arg semanticDisposition "$APPROVED_SEMANTIC_DISPOSITION" \
  --arg releaseBodySha256 "$APPROVED_RELEASE_BODY_SHA256" '
    .schemaVersion == 1
    and .repository == $repository
    and .tag == $tag
    and .targetSha == $targetSha
    and .title == $title
    and .semanticDisposition == $semanticDisposition
    and .releaseBodySha256 == $releaseBodySha256
  ' "$APPROVAL_MANIFEST" >/dev/null
preflight_public_candidate
test "$("${GH_API[@]}" --method GET "repos/$REPO/git/ref/heads/main" --jq .object.sha)" = "$SHA"

FINAL_PREFLIGHT="$RELEASE_EVIDENCE/final-pre-release"
test ! -e "$FINAL_PREFLIGHT"
mkdir -p "$FINAL_PREFLIGHT/raw"
npm run verify:branch-protection -- \
  --repo "$REPO" --repository-id "$APPROVED_REPOSITORY_ID" \
  --expected-tip "$SHA" --branch main \
  --output "$FINAL_PREFLIGHT/raw/branch-protection.json"
npm run eval:sanitize -- "$FINAL_PREFLIGHT/raw" "$FINAL_PREFLIGHT/sanitized"
npm run eval:sanitize:verify -- "$FINAL_PREFLIGHT/sanitized"

set +e
PREEXISTING_RELEASE="$("${GH_API[@]}" --method GET --include --silent "repos/$REPO/releases/tags/$RELEASE_TAG" 2>&1)"
PREEXISTING_RELEASE_STATUS=$?
set -e
test "$PREEXISTING_RELEASE_STATUS" = 1
grep -Eq '^HTTP/\S+ 404([[:space:]]|$)' <<<"$PREEXISTING_RELEASE"
test -z "$(git ls-remote --refs "$PUBLIC_REMOTE_URL" "refs/tags/$RELEASE_TAG")"
if test "$SEMANTIC_DISPOSITION" = full-pass; then
  verify_full_semantic_pass
fi

set +e
gh release create "$RELEASE_TAG" --repo "$REPO" --target "$SHA" \
  --title "$RELEASE_TITLE" --notes-file "$RELEASE_BODY" --latest
RELEASE_CREATE_STATUS=$?
set -e

RELEASE_JSON="$("${GH_API[@]}" --method GET "repos/$REPO/releases/tags/$RELEASE_TAG")"
test "$(jq -r '.tag_name' <<<"$RELEASE_JSON")" = "$RELEASE_TAG"
test "$(jq -r '.target_commitish' <<<"$RELEASE_JSON")" = "$SHA"
test "$(jq -r '.name' <<<"$RELEASE_JSON")" = "$RELEASE_TITLE"
test "$(jq -r '.draft' <<<"$RELEASE_JSON")" = false
test "$(jq -r '.prerelease' <<<"$RELEASE_JSON")" = false
jq -e --rawfile expected "$RELEASE_BODY" '.body == $expected' <<<"$RELEASE_JSON" >/dev/null
test "$("${GH_API[@]}" --method GET "repos/$REPO/git/ref/tags/$RELEASE_TAG" --jq .object.type)" = commit
test "$("${GH_API[@]}" --method GET "repos/$REPO/git/ref/tags/$RELEASE_TAG" --jq .object.sha)" = "$SHA"

test "$(git ls-remote --heads "$PUBLIC_REMOTE_URL" refs/heads/main)" = \
  "$(printf '%s\t%s' "$SHA" refs/heads/main)"
expected_release_tags="$(printf '%s\t%s\n' \
  "$APPROVED_PUBLIC_ROOT_TAG_OBJECT" refs/tags/public-history/root-v1 \
  "$APPROVED_PUBLIC_ROOT_A" 'refs/tags/public-history/root-v1^{}' \
  "$APPROVED_R01_TAG_OBJECT" refs/tags/registry-approved/r01 \
  "$APPROVED_BOOTSTRAP_TIP_B" 'refs/tags/registry-approved/r01^{}' \
  "$SHA" "refs/tags/$RELEASE_TAG" | LC_ALL=C sort)"
test "$(git ls-remote --tags "$PUBLIC_REMOTE_URL" | LC_ALL=C sort)" = "$expected_release_tags"
test "$(gh pr list --repo "$REPO" --state open --limit 1000 --json number | jq 'length')" = 0
test "$("${GH_API[@]}" --method GET "repos/$REPO/git/ref/heads/main" --jq .object.sha)" = "$SHA"
test "$RELEASE_CREATE_STATUS" = 0 || printf '%s\n' "Release API postconditions prove the nonzero client result completed remotely."
```

After the release tag exists, do not call the pre-release
`preflight_public_candidate`: its strict ref allowlist intentionally excludes release
tags. Instead, run this standalone block from a clean checkout of the approved release
SHA immediately before announcement and again immediately before directory submission.
It deliberately reconstructs all other variables and expected body bytes and can run
in a fresh shell. Set the approved SHA and approved semantic disposition. For
`full-pass`, also set `SEMANTIC_EVIDENCE_ROOT` to the retained sanitized exact-SHA
semantic RC evidence directory; the manual path does not read that variable.

```bash
set -euo pipefail
SHA="${APPROVED_RELEASE_SHA:?set the approved 40-hex release SHA}"
SEMANTIC_DISPOSITION="${SEMANTIC_DISPOSITION:?set full-pass or manual-waiver}"
test "$(git rev-parse HEAD)" = "$SHA"
test "$(git status --porcelain=v1)" = ""
test "$(printf '%s' "$SHA" | grep -Ec '^[0-9a-f]{40}$')" = 1

REPO="seunghyeon1004/claude-code-skillsets"
PUBLIC_REMOTE_URL="https://github.com/$REPO.git"
GH_API=(gh api --hostname github.com -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2026-03-10")
APPROVED_REPOSITORY_ID="1322344258"
APPROVED_PUBLIC_ROOT_A="cb2f51c097be78612b07bcafe66bc30914c7d5ac"
APPROVED_PUBLIC_ROOT_TAG_OBJECT="6b56351f581797fc3ca26bd0c3a1f7978da4c675"
APPROVED_BOOTSTRAP_TIP_B="0ad29eea67c9f504c345d8be2bbc514bd0de5aca"
APPROVED_R01_TAG_OBJECT="92da733d31af3db551a442e141fbd6b2bfd11010"
RELEASE_TAG="v0.1.0"
RELEASE_TITLE="Claude Code Skillsets v0.1.0"
DISCLOSURE="Full exact-SHA semantic RC was not run; semantic coverage is not proven; release proceeds under an explicit owner waiver."
EXPECTED_BODY="$(mktemp "${TMPDIR:-/tmp}/skillsets-release-body.XXXXXX")"
POST_RELEASE_EVIDENCE="$(mktemp -d "${TMPDIR:-/tmp}/skillsets-post-release.XXXXXX")"
POST_RELEASE_SANITIZED="$POST_RELEASE_EVIDENCE-sanitized"
trap 'rm -f "$EXPECTED_BODY"; rm -rf "$POST_RELEASE_EVIDENCE" "$POST_RELEASE_SANITIZED"' EXIT

case "$SEMANTIC_DISPOSITION" in
  full-pass)
    SEMANTIC_EVIDENCE_ROOT="${SEMANTIC_EVIDENCE_ROOT:?set retained sanitized exact-SHA semantic RC evidence}"
    npm run eval:sanitize:verify -- "$SEMANTIC_EVIDENCE_ROOT"
    jq -e --arg sha "$SHA" '
      .schemaVersion == 6
      and .receiptType == "local-semantic-rc-target"
      and .commitSha == $sha
      and .semanticHarnessStatus == "passed"
    ' "$SEMANTIC_EVIDENCE_ROOT/governance/local-semantic-rc-target.json" >/dev/null
    cat > "$EXPECTED_BODY" <<EOF
# Claude Code Skillsets v0.1.0

Release commit: $SHA

Full exact-SHA semantic RC passed.
EOF
    ;;
  manual-waiver)
    WAIVER="WAIVE-FULL-SEMANTIC-RC:$SHA:SUBSCRIPTION-COST:SEMANTIC-COVERAGE-NOT-PROVEN:NO-KNOWN-SEMANTIC-FAILURE"
    cat > "$EXPECTED_BODY" <<EOF
# Claude Code Skillsets v0.1.0

Release commit: $SHA

$DISCLOSURE

Owner waiver: $WAIVER
EOF
    ;;
  *) exit 1 ;;
esac

repository_json="$("${GH_API[@]}" --method GET "repos/$REPO")"
test "$(jq -r '.id' <<<"$repository_json")" = "$APPROVED_REPOSITORY_ID"
test "$(jq -r '.full_name' <<<"$repository_json")" = "$REPO"
test "$(jq -r '.visibility' <<<"$repository_json")" = public
test "$(jq -r '.default_branch' <<<"$repository_json")" = main
test "$(jq -r '.archived' <<<"$repository_json")" = false

npm run verify:branch-protection -- \
  --repo "$REPO" --repository-id "$APPROVED_REPOSITORY_ID" \
  --expected-tip "$SHA" --branch main \
  --output "$POST_RELEASE_EVIDENCE/branch-protection.json"
npm run eval:sanitize -- "$POST_RELEASE_EVIDENCE" "$POST_RELEASE_SANITIZED"
npm run eval:sanitize:verify -- "$POST_RELEASE_SANITIZED"

RELEASE_JSON="$("${GH_API[@]}" --method GET "repos/$REPO/releases/tags/$RELEASE_TAG")"
test "$(jq -r '.tag_name' <<<"$RELEASE_JSON")" = "$RELEASE_TAG"
test "$(jq -r '.target_commitish' <<<"$RELEASE_JSON")" = "$SHA"
test "$(jq -r '.name' <<<"$RELEASE_JSON")" = "$RELEASE_TITLE"
test "$(jq -r '.draft' <<<"$RELEASE_JSON")" = false
test "$(jq -r '.prerelease' <<<"$RELEASE_JSON")" = false
jq -e --rawfile expected "$EXPECTED_BODY" '.body == $expected' <<<"$RELEASE_JSON" >/dev/null
test "$("${GH_API[@]}" --method GET "repos/$REPO/git/ref/tags/$RELEASE_TAG" --jq .object.type)" = commit
test "$("${GH_API[@]}" --method GET "repos/$REPO/git/ref/tags/$RELEASE_TAG" --jq .object.sha)" = "$SHA"
test "$("${GH_API[@]}" --method GET "repos/$REPO/git/ref/heads/main" --jq .object.sha)" = "$SHA"
test "$(git ls-remote --heads "$PUBLIC_REMOTE_URL" refs/heads/main)" = \
  "$(printf '%s\t%s' "$SHA" refs/heads/main)"
expected_release_tags="$(printf '%s\t%s\n' \
  "$APPROVED_PUBLIC_ROOT_TAG_OBJECT" refs/tags/public-history/root-v1 \
  "$APPROVED_PUBLIC_ROOT_A" 'refs/tags/public-history/root-v1^{}' \
  "$APPROVED_R01_TAG_OBJECT" refs/tags/registry-approved/r01 \
  "$APPROVED_BOOTSTRAP_TIP_B" 'refs/tags/registry-approved/r01^{}' \
  "$SHA" "refs/tags/$RELEASE_TAG" | LC_ALL=C sort)"
test "$(git ls-remote --tags "$PUBLIC_REMOTE_URL" | LC_ALL=C sort)" = "$expected_release_tags"
test "$(gh pr list --repo "$REPO" --state open --limit 1000 --json number | jq 'length')" = 0
```

The standalone inventory must pass without edits immediately before each external
announcement or submission. The release target, exact body, lightweight tag, protected
`main`, and release-bearing tag set must remain bound to the approved SHA. For the
manual path, the exact disclosure must remain in the repository README and appear
verbatim in every submission-visible description.

## 6. Rollback

On any failure after stage 2, stop testing, create no tag or GitHub Release, make no
announcement, and switch the repository back to private. Record the failed gate and
retain only sanitized evidence. Publicly fetched copies cannot be revoked.

The rollback must work even when strict ref, branch, tag, or PR inventory is the
failed gate. It therefore checks only the immutable target identity before each
bounded private-visibility attempt, then proves both the target and archive are
private:

```bash
set -euo pipefail
REPO="seunghyeon1004/claude-code-skillsets"
ARCHIVE_REPO="seunghyeon1004/claude-code-skillsets-private-bootstrap-v9"
APPROVED_REPOSITORY_ID="1322344258"
APPROVED_ARCHIVE_REPOSITORY_ID="1319698664"
GH_API=(gh api --hostname github.com -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2026-03-10")

rollback_identity_preflight() {
  target="$("${GH_API[@]}" --method GET "repos/$REPO")"
  test "$(jq -r '.id' <<<"$target")" = "$APPROVED_REPOSITORY_ID"
  test "$(jq -r '.full_name' <<<"$target")" = "$REPO"
  test "$(jq -r '.owner.login' <<<"$target")" = seunghyeon1004
  test "$(jq -r '.owner.type' <<<"$target")" = User
}

ROLLBACK_CONFIRMED=false
for attempt in $(seq 1 6); do
  rollback_identity_preflight
  set +e
  printf '%s\n' '{"visibility":"private"}' \
    | "${GH_API[@]}" --method PATCH "repos/$REPO" --input - >/dev/null
  PATCH_STATUS=$?
  set -e
  sleep "$((attempt * 2))"
  rollback_identity_preflight
  target="$("${GH_API[@]}" --method GET "repos/$REPO")"
  if test "$(jq -r '.private' <<<"$target")" = true \
    && test "$(jq -r '.visibility' <<<"$target")" = private; then
    ROLLBACK_CONFIRMED=true
    break
  fi
  test "$PATCH_STATUS" -eq 0 || test "$attempt" -lt 6
done
test "$ROLLBACK_CONFIRMED" = true
rollback_identity_preflight
archive="$("${GH_API[@]}" --method GET "repos/$ARCHIVE_REPO")"
test "$(jq -r '.id' <<<"$archive")" = "$APPROVED_ARCHIVE_REPOSITORY_ID"
test "$(jq -r '.full_name' <<<"$archive")" = "$ARCHIVE_REPO"
test "$(jq -r '.private' <<<"$archive")" = true
```

Before the one-time bootstrap, fixes produce a new candidate SHA and restart stage 1.
Before C is pushed, it may be replaced only by another reviewed single commit whose
only parent is B. After C is present on remote `main`, a sibling C would require a
non-fast-forward or force push and is prohibited. On any later failure, return the
repository to private and stop. Do not mutate remote state again until a new explicit
append-only repair plan is reviewed and approved. That plan must make the current
remote C the direct parent of one repair commit, re-audit every public commit from B
through the repair, enforce an exact repair allowlist plus unchanged protected
research/catalog data, and rerun every gate. Never rerun bootstrap, move A/B/R01,
weaken branch protection, or reuse an older receipt.

## 7. Later approved catalog maintenance

A manual Catalog refresh is a later maintenance action, not an initial public-staging
or release prerequisite. Both manual and schedule routes require
`CATALOG_REFRESH_ENABLED` to equal `enabled`. Obtain separate approval to activate
that maintenance policy, bind the manual run to the reviewed exact `CANDIDATE_SHA`, and only
then enable and dispatch it after the release workflow is complete:

```bash
REPO="seunghyeon1004/claude-code-skillsets"
export GH_HOST=github.com
gh variable set CATALOG_REFRESH_ENABLED --body enabled --repo "$REPO"
test "$(gh variable get CATALOG_REFRESH_ENABLED --repo "$REPO")" = enabled
gh workflow run catalog-refresh.yml --repo "$REPO" --ref main -f expected_tip="$CANDIDATE_SHA"
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
local semantic RC or a newly approved manual exact-SHA owner waiver, and anonymous-install
gates after that policy change. Never reuse a prior candidate's waiver.
