#!/usr/bin/env bash

set -euo pipefail

readonly approved_prefix="registry-approved/"
readonly root_tag="registry-approved/r01"

print_target=false
approval_mode="${REGISTRY_APPROVAL_MODE:-current-tip}"
event_base=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --print-target)
      "$print_target" && { printf '%s\n' "--print-target may appear only once" >&2; exit 1; }
      print_target=true
      shift
      ;;
    --mode)
      [[ $# -ge 2 ]] || { printf '%s\n' "--mode requires current-tip, changed-batch, or pre-approval-candidate" >&2; exit 1; }
      approval_mode="$2"
      shift 2
      ;;
    --base)
      [[ $# -ge 2 ]] || { printf '%s\n' "--base requires a commit" >&2; exit 1; }
      event_base="$2"
      shift 2
      ;;
    *)
      printf '%s\n' "usage: require-registry-anchor-input.sh [--mode current-tip|changed-batch|pre-approval-candidate] [--base <commit>] [--print-target]" >&2
      exit 1
      ;;
  esac
done

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

tag_lines="$(git for-each-ref --format='%(refname:short)%09%(objecttype)%09%(objectname)' "refs/tags/${approved_prefix}")"

case "${REGISTRY_APPROVAL_ANCHORED:-pre-anchor}" in
  pre-anchor)
    test -z "${APPROVED_REGISTRY_TAG_OBJECT:-}" || fail "A registry anchor object requires REGISTRY_APPROVAL_ANCHORED=anchored"
    test -z "$tag_lines" || fail "pre-anchor registry cannot contain registry-approved tags"
    test "$approval_mode" = "current-tip" || fail "changed-batch approval requires REGISTRY_APPROVAL_ANCHORED=anchored"
    exit 0
    ;;
  anchored)
    test -n "${APPROVED_REGISTRY_TAG_OBJECT:-}" || fail "APPROVED_REGISTRY_TAG_OBJECT is required for an anchored registry"
    ;;
  *)
    fail "REGISTRY_APPROVAL_ANCHORED must be pre-anchor or anchored"
    ;;
esac

[[ "$APPROVED_REGISTRY_TAG_OBJECT" =~ ^[0-9a-f]{40,64}$ ]] || fail "APPROVED_REGISTRY_TAG_OBJECT must be a full object ID"
test "$(git cat-file -t "$APPROVED_REGISTRY_TAG_OBJECT" 2>/dev/null || true)" = "tag" \
  || fail "protected registry anchor object must be an annotated tag"
resolved_object="$(git rev-parse --verify "${APPROVED_REGISTRY_TAG_OBJECT}^{tag}" 2>/dev/null || true)"
test "$resolved_object" = "$APPROVED_REGISTRY_TAG_OBJECT" \
  || fail "protected registry anchor object is not an exact annotated tag object"
test -n "$tag_lines" || fail "anchored registry requires registry-approved tags"

tag_payload() {
  git cat-file -p "$1"
}

validate_annotated_tag() {
  local name="$1"
  local object="$2"
  local payload target type declared_name
  test "$(git cat-file -t "$object" 2>/dev/null || true)" = "tag" \
    || fail "approved registry tag must be annotated: $name"
  payload="$(tag_payload "$object")"
  target="$(printf '%s\n' "$payload" | /usr/bin/awk '/^$/ { exit } /^object / { print substr($0, 8); exit }')"
  type="$(printf '%s\n' "$payload" | /usr/bin/awk '/^$/ { exit } /^type / { print substr($0, 6); exit }')"
  declared_name="$(printf '%s\n' "$payload" | /usr/bin/awk '/^$/ { exit } /^tag / { print substr($0, 5); exit }')"
  test -n "$target" && test "$type" = "commit" && test "$declared_name" = "$name" \
    || fail "approved registry tag must directly annotate its commit target: $name"
  git cat-file -e "${target}^{commit}" 2>/dev/null \
    || fail "approved registry tag target must be a commit: $name"
  TAG_PAYLOAD="$payload"
  TAG_TARGET="$target"
}

annotation_value() {
  local key="$1"
  local values count
  values="$(printf '%s\n' "$TAG_PAYLOAD" | /usr/bin/awk -v prefix="${key}: " '
    /^$/ { message = 1; next }
    message && index($0, prefix) == 1 { print substr($0, length(prefix) + 1) }
  ')"
  count="$(printf '%s\n' "$values" | /usr/bin/awk 'NF { count += 1 } END { print count + 0 }')"
  test "$count" = "1" || fail "approved registry tag annotation is malformed"
  printf '%s\n' "$values"
}

root_count=0
provided_count=0
while IFS=$'\t' read -r name type object; do
  test -n "$name" || continue
  if [[ "$name" != "$root_tag" && ! "$name" =~ ^registry-approved/research-[0-9]{4}$ ]]; then
    fail "invalid approved registry tag name: $name"
  fi
  if [[ "$name" == "$root_tag" ]]; then
    root_count=$((root_count + 1))
    root_object="$object"
    root_type="$type"
  fi
  if [[ "$object" == "$APPROVED_REGISTRY_TAG_OBJECT" ]]; then
    provided_count=$((provided_count + 1))
  fi
done <<< "$tag_lines"

test "$root_count" = "1" && test "${root_type:-}" = "tag" \
  || fail "registry-approved/r01 must be an annotated root approval tag"
test "$provided_count" = "1" \
  || fail "protected registry anchor object must name exactly one approved chain tag"

validate_annotated_tag "$root_tag" "$root_object"
previous_name="$root_tag"
previous_object="$root_object"
previous_target="$TAG_TARGET"
latest_object="$root_object"
latest_target="$TAG_TARGET"
latest_name="$root_tag"
provided_name=""
provided_target=""
if [[ "$root_object" == "$APPROVED_REGISTRY_TAG_OBJECT" ]]; then
  provided_name="$root_tag"
  provided_target="$TAG_TARGET"
fi
expected_sequence=1

sequenced="$(printf '%s\n' "$tag_lines" | /usr/bin/awk -F '\t' '$1 ~ /^registry-approved\/research-[0-9]{4}$/ { print }' | /usr/bin/sort -t $'\t' -k1,1)"
while IFS=$'\t' read -r name type object; do
  test -n "$name" || continue
  expected_name="registry-approved/research-$(printf '%04d' "$expected_sequence")"
  test "$name" = "$expected_name" || fail "approved registry tag sequence must begin at 0001 without gaps or reuse"
  test "$type" = "tag" || fail "approved registry chain tag must be annotated: $name"
  validate_annotated_tag "$name" "$object"
  test "$(annotation_value sequence)" = "$expected_sequence" \
    && test "$(annotation_value previous-tag)" = "$previous_name" \
    && test "$(annotation_value previous-tag-object)" = "$previous_object" \
    && test "$(annotation_value batch-head)" = "$TAG_TARGET" \
    || fail "approved registry tag has an invalid chain annotation: $name"
  git merge-base --is-ancestor "$previous_target" "$TAG_TARGET" \
    || fail "approved registry tag target is not descended from its immediate predecessor: $name"
  previous_name="$name"
  previous_object="$object"
  previous_target="$TAG_TARGET"
  latest_object="$object"
  latest_target="$TAG_TARGET"
  latest_name="$name"
  if [[ "$object" == "$APPROVED_REGISTRY_TAG_OBJECT" ]]; then
    provided_name="$name"
    provided_target="$TAG_TARGET"
  fi
  expected_sequence=$((expected_sequence + 1))
done <<< "$sequenced"

case "$approval_mode" in
  current-tip)
    test "$APPROVED_REGISTRY_TAG_OBJECT" = "$latest_object" \
      || fail "protected registry anchor object is stale"
    git merge-base --is-ancestor "$latest_target" HEAD \
      || fail "protected registry anchor target must be an ancestor of HEAD"
    output_target="$latest_target"
    ;;
  changed-batch)
    test -n "$event_base" || fail "--base is required for changed-batch approval"
    git cat-file -e "${event_base}^{commit}" 2>/dev/null \
      || fail "--base must name a commit"
    git merge-base --is-ancestor "$provided_target" "$event_base" \
      || fail "--base must descend from the immediate approved registry predecessor target"
    git merge-base --is-ancestor "$event_base" HEAD \
      || fail "--base must be an ancestor of HEAD"
    if [[ "$provided_name" == "$root_tag" ]]; then
      provided_sequence=0
    else
      provided_sequence="${provided_name#registry-approved/research-}"
      provided_sequence=$((10#$provided_sequence))
    fi
    next_sequence=$((provided_sequence + 1))
    next_name="registry-approved/research-$(printf '%04d' "$next_sequence")"
    if [[ "$latest_name" != "$next_name" ]]; then
      if [[ "$latest_name" == "$provided_name" ]]; then
        fail "missing annotated next approved registry tag: $next_name"
      fi
      fail "protected registry anchor object is stale"
    fi
    validate_annotated_tag "$latest_name" "$latest_object"
    next_target="$TAG_TARGET"
    test "$next_target" = "$(git rev-parse HEAD)" \
      || fail "next approved registry tag must target the reviewed batch HEAD"
    test "$(annotation_value sequence)" = "$next_sequence" \
      && test "$(annotation_value previous-tag)" = "$provided_name" \
      && test "$(annotation_value previous-tag-object)" = "$APPROVED_REGISTRY_TAG_OBJECT" \
      && test "$(annotation_value batch-head)" = "$next_target" \
      || fail "next approved registry tag annotation must bind sequence, immediate predecessor, predecessor object, and batch HEAD"
    script_dir="$(cd "$(dirname "$0")" && pwd)"
    detector="$script_dir/../../node_modules/.bin/tsx"
    test -x "$detector" || fail "npm ci is required before changed-batch approval validation"
    protected_change="$("$detector" "$script_dir/detect-research-batch-change.ts" --between "$provided_target" "$event_base")"
    test "$protected_change" = "unchanged" \
      || fail "approved registry predecessor descendants cannot change protected research batch surfaces"
    output_target="$provided_target"
    ;;
  pre-approval-candidate)
    test -n "$event_base" || fail "--base is required for pre-approval candidate validation"
    git cat-file -e "${event_base}^{commit}" 2>/dev/null \
      || fail "--base must name a commit"
    test "$APPROVED_REGISTRY_TAG_OBJECT" = "$latest_object" \
      || fail "protected registry anchor object is stale"
    git merge-base --is-ancestor "$provided_target" "$event_base" \
      || fail "--base must descend from the current approved registry anchor target"
    git merge-base --is-ancestor "$event_base" HEAD \
      || fail "--base must be an ancestor of HEAD"
    script_dir="$(cd "$(dirname "$0")" && pwd)"
    detector="$script_dir/../../node_modules/.bin/tsx"
    test -x "$detector" || fail "npm ci is required before pre-approval candidate validation"
    protected_before_base="$("$detector" "$script_dir/detect-research-batch-change.ts" --between "$provided_target" "$event_base")"
    test "$protected_before_base" = "unchanged" \
      || fail "approved registry anchor descendants cannot change protected research batch surfaces"
    protected_candidate="$("$detector" "$script_dir/detect-research-batch-change.ts" --between "$event_base" HEAD)"
    test "$protected_candidate" = "changed" \
      || fail "pre-approval candidate must change protected research batch surfaces"
    output_target="$event_base"
    ;;
  *)
    fail "approval mode must be current-tip, changed-batch, or pre-approval-candidate"
    ;;
esac

if "$print_target"; then
  printf '%s\n' "$output_target"
fi
