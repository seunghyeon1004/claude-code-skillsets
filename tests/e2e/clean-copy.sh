#!/usr/bin/env bash

set -euo pipefail

source_root="$(git rev-parse --show-toplevel)"
source_head="$(git -C "$source_root" rev-parse HEAD)"
registry_anchor_state="${REGISTRY_APPROVAL_ANCHORED:-pre-anchor}"
event_append_base="${APPEND_BASE:-${PUBLIC_ROOT_COMMIT:-}}"
governance_tag_name="${PUBLIC_ROOT_TAG_NAME:-}"
governance_tag_object="${PUBLIC_ROOT_TAG_OBJECT:-}"
public_root_tag_name=""
public_root_tag_object=""
temp_root="$(mktemp -d "${TMPDIR:-/tmp}/claude-code-skillsets-clean-copy.XXXXXX")"
bare_source="$temp_root/source.git"
clone_dir="$temp_root/repository"

trap 'rm -rf "$temp_root"' EXIT

test -n "$event_append_base" || {
  printf '%s\n' "APPEND_BASE is required unless PUBLIC_ROOT_COMMIT supplies the authenticated first-public baseline" >&2
  exit 1
}

if [[ -n "$governance_tag_name" || -n "$governance_tag_object" ]]; then
  test -n "$governance_tag_name" && test -n "$governance_tag_object" || {
    printf '%s\n' "PUBLIC_ROOT_TAG_NAME and PUBLIC_ROOT_TAG_OBJECT must be supplied together" >&2
    exit 1
  }
elif [[ -n "${APPROVED_REGISTRY_TAG_OBJECT:-}" ]]; then
  governance_tag_object="$APPROVED_REGISTRY_TAG_OBJECT"
  matching_tags="$(git -C "$source_root" for-each-ref \
    --format='%(refname:short)%09%(objectname)' refs/tags/ | \
    /usr/bin/awk -F '\t' -v object="$governance_tag_object" '$2 == object { print $1 }')"
  test "$(printf '%s\n' "$matching_tags" | /usr/bin/awk 'NF { count += 1 } END { print count + 0 }')" = 1 || {
    printf '%s\n' "APPROVED_REGISTRY_TAG_OBJECT must resolve to exactly one local governance tag" >&2
    exit 1
  }
  governance_tag_name="$matching_tags"
fi

if [[ -n "${PUBLIC_ROOT_TAG_NAME:-}" ]]; then
  public_root_tag_name="$governance_tag_name"
  public_root_tag_object="$governance_tag_object"
else
  public_root_tags="$(git -C "$source_root" for-each-ref \
    --format='%(refname:short)%09%(objectname)%09%(objecttype)' \
    refs/tags/public-history/)"
  test "$(printf '%s\n' "$public_root_tags" | /usr/bin/awk 'NF { count += 1 } END { print count + 0 }')" = 1 || {
    printf '%s\n' "clean copy requires exactly one public-history root governance tag" >&2
    exit 1
  }
  IFS=$'\t' read -r public_root_tag_name public_root_tag_object public_root_tag_type <<< "$public_root_tags"
  [[ "$public_root_tag_name" =~ ^public-history/root-v[1-9][0-9]*$ ]] || {
    printf '%s\n' "public-history root governance tag name is invalid" >&2
    exit 1
  }
  test "$public_root_tag_type" = tag || {
    printf '%s\n' "public-history root governance tag must be annotated" >&2
    exit 1
  }
  test "$(git -C "$source_root" rev-parse --verify "refs/tags/${public_root_tag_name}^{tag}")" = "$public_root_tag_object"
fi

git init --bare "$bare_source"
git -C "$bare_source" fetch --no-tags "$source_root" "$source_head:refs/heads/candidate"
if [[ -n "$governance_tag_name" ]]; then
  git -C "$bare_source" fetch --no-tags "$source_root" \
    "refs/tags/${governance_tag_name}:refs/tags/${governance_tag_name}"
fi
if [[ -n "$public_root_tag_name" && "$public_root_tag_name" != "$governance_tag_name" ]]; then
  git -C "$bare_source" fetch --no-tags "$source_root" \
    "refs/tags/${public_root_tag_name}:refs/tags/${public_root_tag_name}"
fi
git clone --no-local --single-branch --no-tags --branch candidate "$bare_source" "$clone_dir"
if [[ -n "$governance_tag_name" ]]; then
  git -C "$clone_dir" fetch --no-tags origin \
    "refs/tags/${governance_tag_name}:refs/tags/${governance_tag_name}"
  test "$(git -C "$clone_dir" rev-parse --verify "refs/tags/${governance_tag_name}^{tag}")" = "$governance_tag_object"
fi
if [[ -n "$public_root_tag_name" && "$public_root_tag_name" != "$governance_tag_name" ]]; then
  git -C "$clone_dir" fetch --no-tags origin \
    "refs/tags/${public_root_tag_name}:refs/tags/${public_root_tag_name}"
  test "$(git -C "$clone_dir" rev-parse --verify "refs/tags/${public_root_tag_name}^{tag}")" = "$public_root_tag_object"
fi
git -C "$clone_dir" checkout --detach "$source_head"
test -d "${clone_dir}/.git"

(
  cd "$clone_dir"
  npm ci
  append_base="$(PRE_ANCHOR_APPEND_BASE="$event_append_base" \
    REGISTRY_APPROVAL_ANCHORED="$registry_anchor_state" \
    bash scripts/research/resolve-clean-copy-append-base.sh)"
  ledger_append_base="${LEDGER_APPEND_BASE:-$event_append_base}"
  git rev-parse --verify "${append_base}^{commit}" >/dev/null
  git rev-parse --verify "${ledger_append_base}^{commit}" >/dev/null
  git merge-base --is-ancestor "$append_base" HEAD
  git merge-base --is-ancestor "$ledger_append_base" HEAD
  if [[ "${CATALOG_REFRESH_CANDIDATE:-false}" = true ]]; then
    npm run check:catalog-refresh
  else
    npm run check
  fi
  if [[ -n "${PUBLIC_ROOT_COMMIT:-}" ]]; then
    npm run verify:p03-immutable -- --baseline-ref "$PUBLIC_ROOT_COMMIT"
  else
    npm run verify:p03-immutable
  fi
  npm run verify:research-append-only -- --base "$append_base"
  npm run verify:review-ledger-append-only -- --base "$ledger_append_base"
  npm run verify:official-claims-append-only -- --base "$event_append_base"
  npm run verify:decision-index-history -- --previous-ref "$event_append_base"
  npm run verify:broker-only
  npm run generate
  git diff --exit-code -- .claude-plugin generated plugins/skillset-manager/data \
    generated/decision-index.json plugins/skillset-manager/data/decision-index.json \
    research/source-observations.json research/source-diffs.json research/materialized-review-state.json
  claude plugin validate . --strict
  claude plugin validate plugins/shared-core --strict
  claude plugin validate plugins/skillset-manager --strict
)
