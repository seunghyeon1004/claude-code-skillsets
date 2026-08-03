# Shopify AI Toolkit exact-source audit

- Review mode: read-only; no plugin, skill, hook, script, CLI, or upstream code was installed or executed.
- Review verdict: `held` and discovery-only.
- Reviewed at: `2026-08-03T02:30:05Z`.

## Authenticated marketplace binding

- Official marketplace repository: `https://github.com/anthropics/claude-plugins-official`.
- Marketplace commit: `909649d9b178d142201000c76715b5fc952818e3`.
- Repository artifact: `research/marketplaces/claude-plugins-official-909649d9b178d142201000c76715b5fc952818e3.json`.
- Repository artifact SHA-256: `347a0f33756f6f53117276b6f6e9c3333ffbedf284f39e4a4f66f3c7fb79841d`.
- Marketplace manifest SHA-256: `d580b5d2fa473fdbfc8792ece117f6a3a92d4bb12356ab17beb2f3cc5f7b0316`.
- Shopify entry: `/plugins/230`.
- Observation evidence: `observation-20260803015057-anthropic-plugins-official`, observed at `2026-08-03T01:50:57Z`.

The selected entry binds `shopify-ai-toolkit` to
`https://github.com/Shopify/Shopify-AI-Toolkit.git` at the immutable source pin
`0e06bc35611e505e372de7f8cdf265e6d6dbc311`.

## Immutable source review

| Path | SHA-256 | Finding |
| --- | --- | --- |
| `README.md` | `6a3a6a2cb72aa12e191d9c1d07b97a2f25f75b4d143b805119a00121c09f48c3` | Documents installation surfaces and default-on telemetry. |
| `skills/shopify-admin/SKILL.md` | `c3eaa9f6b30bd912afdfd8b79c1ab45a79bf07352abd429e56baefaafdc75a07` | Provides Shopify Admin API guidance. |
| `skills/shopify-use-shopify-cli/SKILL.md` | `ddcae8c1461b205ef891c8b0b480d30b3be2d1c41d6c24485b2b2b77170b8e44` | Covers authenticated store reads, writes, and `--allow-mutations`. |
| `skills/shopify-shopifyql/SKILL.md` | `51b2d3f493501309ccb0cf15ad5dda7aaee17b33c880ee4501e9e67e6986dc99` | Covers ShopifyQL sales and revenue analysis. |
| `skills/shopify-shopifyql/scripts/log_skill_use.mjs` | `0e2d107da6c9ed8efde7cfdd7adabb87238129a8c6c4c8b91ee099d2ce427985` | Sends skill-use telemetry, including optional prompt content. |
| `skills/shopify-shopifyql/scripts/search_docs.mjs` | `e5721d8640e1fca18424f3b6588383c46efded5734d123be3289158f839d9b61` | Sends documentation queries and results or errors to telemetry. |
| `skills/shopify-use-shopify-cli/scripts/log_skill_use.mjs` | `d7faade7e27b58a5ce92a4005fdf24a04bf7fed0c382e18fc549728666c6c82e` | Provides CLI skill-use telemetry. |
| `skills/shopify-onboarding-merchant/SKILL.md` | `8dca7463ccf33a06e1748c9d78846d100abbe353a9e52614de50a9e552cb30ca` | Creates preview stores and opens a store in the browser. |
| `hooks/README.md` | `a61f3580f2f894ad25e8c3edb30b1020eee610b1eb6b741ae9f811504ef18ea9` | Documents prompt capture and hook activation behavior. |
| `hooks/scripts/track-telemetry.sh` | `2b7476c8d74bda7f593031811a3c1526b75b0cbe71728ffa2decba41e7c59c57` | Implements the telemetry activation hook. |
| `package.json` | `e2efcaac4ade347a186823e684a734640025df94fee1a6341269a0894e23a656` | Declares package metadata and an additional mutable git install surface. |
| `LICENSE` | `75c4e0e960d7639e5974c0b10a420f738b8011ac08742d3bbb13cca849fda9f4` | MIT license. |

Every source URL bound by the evidence artifact uses the immutable form
`https://raw.githubusercontent.com/Shopify/Shopify-AI-Toolkit/0e06bc35611e505e372de7f8cdf265e6d6dbc311/<path>`.

## Capability findings

- `operate-stores-and-marketplaces`: direct. The pinned source documents store authentication, reads, writes, preview-store creation, and store opening.
- `manage-product-catalogs-and-listings`: direct. The pinned CLI skill documents product reads and changes.
- `run-promotions-and-analyze-revenue`: inferred. Revenue analysis is direct, but the reviewed source does not establish the whole combined promotion capability.

## Unresolved risks

- Telemetry is default-on and can include queries, responses or errors, validation context, optional prompt content, `tool-skill-version`, `model-client-version-when-supplied`, and `artifact-and-revision-identifiers`. The documented opt-out is `OPT_OUT_INSTRUMENTATION=true`.
- The hook stores the most recent verbatim prompt at `${TMPDIR:-/tmp}/shopify-ai-toolkit-telemetry-<uid>/<session>.prompt` with mode `0600`. A later Shopify skill activation can reuse that local prompt stash. A stale file is pruned only on the next `UserPromptSubmit` after it is older than 24 hours; transmission does not immediately delete it.
- Structured local disclosure: `local-prompt-stash:${TMPDIR:-/tmp}/shopify-ai-toolkit-telemetry-<uid>/<session>.prompt`.
- Structured local disclosure: `local-prompt-stash-mode:0600`.
- Structured local disclosure: `local-prompt-stash-retention:pruned-only-on-next-user-prompt-submit-after-24h`.
- Structured local disclosure: `local-prompt-stash-reuse:subsequent-shopify-skill-activation`.
- Structured local disclosure: `local-prompt-stash-delete-after-transmit:not-immediate`.
- Store authentication, scopes, token storage, revocation, mutations, preview-store creation, and browser opening have not received an install or safety smoke test.
- Upstream documentation contains mutable install surfaces for `shopify` CLI at `latest`, Hermes raw `main`, a Pi git URL, and `npx skills add`; none is approved as a broker install route.
- Privacy, authentication, cost, dependency, trust, and individual safety reviews remain incomplete.
- Official marketplace listing and MIT licensing are source facts, not a security or safety certification.

The candidate therefore remains held, exposes no Claude or Codex install command,
and is available only as reviewed discovery metadata.
