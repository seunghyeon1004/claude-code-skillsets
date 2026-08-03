#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
approval_mode="${REGISTRY_APPROVAL_MODE:-current-tip}"

case "${REGISTRY_APPROVAL_ANCHORED:-pre-anchor}" in
  pre-anchor)
    test -n "${PRE_ANCHOR_APPEND_BASE:-}" || {
      printf '%s\n' "PRE_ANCHOR_APPEND_BASE is required" >&2
      exit 1
    }
    bash "$script_dir/require-registry-anchor-input.sh" --mode "$approval_mode"
    git rev-parse --verify "${PRE_ANCHOR_APPEND_BASE}^{commit}"
    ;;
  anchored)
    case "$approval_mode" in
      current-tip)
        bash "$script_dir/require-registry-anchor-input.sh" --mode current-tip --print-target
        ;;
      changed-batch)
        test -n "${APPEND_BASE:-}" || {
          printf '%s\n' "APPEND_BASE is required for changed-batch approval" >&2
          exit 1
        }
        bash "$script_dir/require-registry-anchor-input.sh" --mode changed-batch --base "$APPEND_BASE" --print-target
        ;;
      pre-approval-candidate)
        test -n "${APPEND_BASE:-}" || {
          printf '%s\n' "APPEND_BASE is required for pre-approval candidate validation" >&2
          exit 1
        }
        bash "$script_dir/require-registry-anchor-input.sh" --mode pre-approval-candidate --base "$APPEND_BASE" --print-target
        ;;
      *)
        printf '%s\n' "REGISTRY_APPROVAL_MODE must be current-tip, changed-batch, or pre-approval-candidate" >&2
        exit 1
        ;;
    esac
    ;;
  *)
    printf '%s\n' "REGISTRY_APPROVAL_ANCHORED must be pre-anchor or anchored" >&2
    exit 1
    ;;
esac
