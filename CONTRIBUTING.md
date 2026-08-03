# Contributing

## Start With an Issue

Use an issue-first proposal for a new outcome pack, category, external source,
or material change. Describe the user outcome, intended inputs and outputs,
dependencies, risks, evaluation cases, and the maintainer who will own updates.
Do not start a large pack implementation before the proposal has been discussed.

## Content and Source Rules

Original repository code and skills are Apache-2.0. Do not copy external skills,
prompts, or source code into this repository. Record external work as a source
reference with its original marketplace, license, trust tier, review date, and
update policy.

All user-facing metadata must be maintained in both Korean and English. Write
each language for its readers; do not treat machine translation as the final
version. Keep skill instructions concise, disclose permissions and side effects,
and add normal and boundary evaluation cases for behavior changes.

## Developer Certificate of Origin

Every commit must include a DCO sign-off, confirming that you have the right to
submit the work under the repository license:

```text
Signed-off-by: Your Name <you@example.com>
```

Use `git commit -s` to add it. Contributions without a valid sign-off cannot be
merged.

## Local Gates

Before opening a pull request, run:

```bash
npm ci
npm run check
claude plugin validate . --strict
claude plugin validate plugins/shared-core --strict
claude plugin validate plugins/skillset-manager --strict
bash tests/e2e/clean-copy.sh
```

Keep generated artifacts in sync and include focused tests for behavior changes.
The exact public-candidate SHA must already contain its installation documentation
so the same-SHA release gates can evaluate the complete candidate. Under the
[GitHub Free staged-public contract](docs/release/github-free-staged-public.md),
public visibility after explicit final approval is a validation stage and is not a
release. Do not tag or publish a release until that exact public-candidate SHA has
passed protected branch verification, post-public semantic RC, and unauthenticated
installation validation. On failure, return the repository to private without a tag
or announcement and restart with a new SHA.
