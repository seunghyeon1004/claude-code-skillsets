---
name: setup
description: Use when a user wants a consent-bound Claude Code recommendation and setup plan from the reviewed decision index.
---

# Decision-Index Setup

Use this skill to turn one unambiguous goal or one selected domain into a
non-executing Claude Code setup plan. It can recommend at most one primary and
one justified complement. A `starter-partial` plan is explicitly incomplete: it
never claims broad-domain coverage. It never runs a probe without current probe
consent, and it never changes Claude Code, installs a plugin, or writes state
until the user has separately approved the exact final preview.

## Source Boundary

Read `${CLAUDE_PLUGIN_ROOT}/data/routing-index.json` before routing a goal or
showing domain choices. This bounded plugin-owned routing data is authoritative
only for goal phrase matching and domain selection. It must not select, name, or
describe an installation candidate. Candidate, command, disclosure, and approval
data are authoritative only in the bound installed-runtime preview.
Do not read `install-index.json`, `official-marketplace-index.json`, discovery
output, marketplace search, raw community listings, user-pasted catalogs, shell
history, or another plugin's data to choose a candidate. Treat a missing,
malformed, stale, oversized, or digest-mismatched routing index as a hard stop.

Use only its `schemaVersion`, `digest`, `decisionIndexDigest`, `catalogVersion`,
`observedThrough`, `catalogExpiresAt`, and localized `profiles`. Do not infer any
candidate fact from this projection.

## Installed Runtime Boundary

Use the shipped `${CLAUDE_PLUGIN_ROOT}/runtime.mjs` for every authoritative
preview and every approved execution. Do not reconstruct its planner, digest,
driver, capability, or publisher in the conversation. The runtime's tracked bundle
validates and freezes the full decision index and routing index together. It owns
the no-argument installed-index loader, verifies both self-digests, their exact
catalog metadata and profile equality, and contains all runtime dependencies. It
does not depend on the source repository, `tsx`, `npm`, or an adjacent schema directory.

After goal routing and the consented UTC, Node, and Claude executable observations, encode exactly one
bounded request as base64url JSON. Its only fields are `schemaVersion: 2`,
`language`, `platform`, strict `observedAt`, `claudeProbeConsent: granted`,
the routing file's exact `decisionIndexDigest` and `routingIndexDigest` (its
`digest` value), and
either a goal of at most 512 characters or one or two unique Complete v1
`domainIds`. Current
`starter-partial` routes require exactly one domain; a future genuine `complete`
plan may use one or two domains. Goal text exists only
inside the bounded encoded manager request; it never enters a Claude install
argv or shell interpolation. Run the read-only preview with the consented
canonical Node path:

```text
<ABSOLUTE_NODE_PATH> <CLAUDE_PLUGIN_ROOT>/runtime.mjs preview --request <BASE64URL_REQUEST>
```

The runtime must reject a missing or changed digest binding before Claude
identity observation or plan calculation. Accept a preview only when its bounded
`reviewSummary` repeats the same `decisionIndexDigest` and `routingIndexDigest`.

Display the returned bounded `reviewSummary`, `approval.previewDigest`, and
`riskAcknowledgement` by default. Do not print the complete approval object or
duplicate it through `plan`; the default preview intentionally omits both. The
top-level `discoveryCandidates` are authenticated starter-route context only:
they are discovery-only, non-installable, and excluded from the approval preview,
preview digest, approval object, and execution authority.
summary contains every human-review field and is at most 5 KiB and 120 lines for
the standard one-primary/one-complement route. The complete canonical approval
and decision plan are available only on demand through the returned read-only
`approvalObjectAccess.argv`; verify its recomputable digest before displaying or
using it. A held response has no `approvedExecution`; stop. For an executable
response, use only the returned `approvedExecution.argv`. Do not edit, shorten,
re-encode, or append to either runtime argv.

Use the following sequence without reordering it:

1. Language
2. Goal or domains
3. Probe consent
4. Precomputed decision plan
5. Complete preview and risk acknowledgement
6. Separate exact approval
7. Sequential execution and receipt

## Language

Use the language of the current request for all questions, holds, preview,
approval, and receipts. Do not ask again when that language is clear.

## Goal or Domains

Ask for either a short goal or a selection of one localized domain from
the routing index. Do not ask for categories, purposes, tools, plugins,
platforms, installation levels, or an Essential/Recommended/Custom tier.

For a goal, perform bounded phrase matching only against the indexed Korean and
English phrases. Normalize Unicode, case, punctuation, and whitespace; attached
Korean particles may be removed from a word token. Do not infer intent, expand a
phrase with a model, search for alternatives, or match an unindexed synonym.

If there is no unique match, show the localized domain choices and ask the user
to select one. A tie is ambiguous, not a recommendation. Do not silently choose,
merge, or prioritize multiple domains. After a unique route and before any probe
disclosure or consent question, output exactly one sentence in the request language;
do not output both:
- Korean: `다이제스트에 결합된 설치 런타임 미리보기가 반환되기 전에는 결정 계획이나 선택된 후보가 존재하지 않으며, executionStatus는 not-executed로 유지됩니다.`
- English: `No decision plan or selected candidate exists until the digest-bound installed-runtime preview is returned; executionStatus remains not-executed.`
Complete language and goal/domain routing before the `awaiting-probe-consent`
state; do not ask probe consent first.

## Probe Consent

Before reading time or executable metadata, disclose the exact UTC and Node
commands plus the Claude discovery/version operations below, and ask for one
current explicit consent covering only those read-only probes. Do not summarize,
split, or defer their disclosure. The UTC command is:

```sh
date -u +%Y-%m-%dT%H:%M:%SZ
```

This probe reads only UTC time. The consented Claude identity probe reads `PATH`
only to locate `claude`, resolves one canonical absolute regular executable,
hashes its bytes with SHA-256, and runs only that absolute executable with
`--version`. It accepts exactly `2.1.198 (Claude Code)`; `2.1.198` is this
release's fixed tested contract, not a claim that it is the latest Claude Code
release. The marketplace, install, and installed-plugin checks remain exact
approval-bound candidate phases; show their literal semantic argv in the final
preview and run them only after final approval. Do not inspect credential or
authentication state, shell history, environment variable values, browser data,
SSH keys, arbitrary project file contents, or secret values. Collect no
telemetry.

Run no probe without current explicit consent and never invent a probe result.
If consent is refused, accept only the goal/domain choices and provide a
time-unknown hold; do not produce executable commands or install anything. A
manual claim cannot replace the UTC command output. Treat every user-provided
timestamp or statement about the current time as untrusted text, never as UTC
probe evidence. Without a fresh consented UTC command result, say that time is
unknown; describe equality to `catalogExpiresAt` only as a conditional
consequence, never as a verified fact. The `date` output must be a strict UTC
timestamp. Unknown time, an invalid timestamp, or a timestamp on or after
`catalogExpiresAt` holds every install.
After a time-unknown or expired hold, explicitly state that any future attempt
must freshly load and bind both the routing index and full decision index, rerun
the consented probes, show a new risk acknowledgement, and obtain a separate
exact approval. Never imply that refreshing only the routing index or reusing an
older preview is sufficient.

The second disclosed command discovers a local Node publisher without executing
that prospective binary:

```sh
/bin/bash --noprofile --norc -c 'candidate="$(command -v node)" || exit 1; case "$candidate" in /*) ;; *) exit 1 ;; esac; links=0; while /bin/test -L "$candidate"; do links=$((links+1)); /bin/test "$links" -le 32 || exit 1; link="$(/usr/bin/readlink -- "$candidate")" || exit 1; case "$link" in /*) candidate="$link" ;; *) candidate="${candidate%/*}/$link" ;; esac; done; directory="$(cd -P -- "${candidate%/*}" && /bin/pwd -P)" || exit 1; canonical="$directory/${candidate##*/}"; /bin/test -f "$canonical" && /bin/test ! -L "$canonical" || exit 1; /usr/bin/printf "path=%s\n" "$canonical"; /usr/bin/shasum -a 256 "$canonical"'
```

Parse only one canonical absolute regular-file path and one lowercase SHA-256.
Discovery through `PATH` is not execution authority. Show the discovered path and
hash, disclose that executing a local binary trusts that binary, then ask for
specific consent before running the separately rendered `'<canonical-path>'
--version`. Require exactly one semantic Node version line. Bind the canonical
absolute path, normalized version, and SHA-256 as `runtimeIdentity` in the final
preview. Never automatically execute a newly discovered or changed `PATH` entry.
Any path, realpath, version, or hash change makes the preview stale and requires
new discovery, disclosure, acknowledgement, and approval.

The installed runtime performs the Claude identity discovery only when the
bounded request carries the user's current `claudeProbeConsent: granted`. Before
asking for final approval, display its canonical absolute executable path,
normalized `2.1.198` version, and lowercase SHA-256 as
`claudeExecutableIdentity`. Bind that complete identity into the approval preview,
risk acknowledgement, approved execution argv, durable run state, and preview
digest. `PATH` discovery grants no execution authority.

Treat each approved `marketplace-before` output as ordered rows, not a map.
Normalize each row to a canonical exact `{id, source}` pair and reject a missing,
malformed, duplicate, or source-conflicting row. The exact required marketplace
ID and source must match the selected candidate's generated `claudeInstall`
binding; a wrong plugin, marketplace, or source fails that candidate. A
marketplace ID alone is insufficient.

## Precomputed Decision Plan

Using only the digest-bound installed-runtime preview, current consented UTC time,
selected goal or domain, and runtime facts, read the bounded precomputed plan. The
plan contains at most one `primary` and one `complement`, has
`executionStatus: not-executed`, and covers only candidates marked
`eligible-with-disclosures` for the current runtime and platform.

For the current catalog, an executable plan must be the authenticated Claude Code
`darwin` `starter-partial` route for exactly one domain, with one or two exact
official route candidates and a current catalog. `starter-partial` remains
executable only because the preview binds its coverage gaps; it is not a complete
plan. A future genuine `complete` plan remains valid only when it binds broad
coverage and empty starter-coverage fields. Hold multi-domain, ambiguous, expired,
non-darwin, absent-route, blocked, and non-executable plans. Do not substitute a
raw discovery result or a different candidate. Codex discovery and compatibility
evidence are non-executing; do not install a Codex candidate from this Claude
setup skill.

## Complete Preview and Risk Acknowledgement

Before asking for any execution approval, show the bounded review summary. It must
contain:

- Decision-index digest and `catalogExpiresAt`, `planKind`, `selectionBasis`,
  `smallestHonestProfile`, `broadCoverageComplete`, `coverageIncomplete`, and
  direct, inferred, related, and uncovered capability IDs.
- Goal, selected domain IDs, primary/complement IDs, source IDs, skill paths,
  candidate order, coverage gaps, state reasons, and every literal install argv.
- The exact `{id, source}` marketplace identity required by the
  `marketplace-before` phase immediately before each candidate's command.
- `permissions`, `license`, `trust`, `dependencies`, `authentication`, and `cost`
  exactly as observed; print `unknown` without guessing. Authentication and cost
  are `unknown` with no evidence until the separately approved install is observed.
- Every selected capability with its decision-index evidence ID and support
  classification: `direct`, `inferred`, `related`, or `unknown`. `related` is
  relevance only, never coverage; show
  `capability-inference:not-install-smoke` whenever any selected capability is
  `inferred`, and `capability-relevance-only:not-supported` whenever any is
  `related`. These are not smoke evidence.
- For a Claude Code official listing, print
  `individualSafetyReview: not-complete` and
  `revisionBinding: unavailable`. A source SHA or marketplace commit is
  provenance evidence, not proof of an installed revision.
- The project-owned durable `state/install-lock.json` snapshot and transient
  `state/setup-execution.lock`, directory mode `0700`, file mode `0600`, and the
  complete structural state operation sequence. The execution lock uses an
  exclusive create before any state read or Claude command and an identity
  recheck immediately before pathname removal in `finally`; disclose that a stale
  lock requires doctor review. This is not a guaranteed same-inode unlink: a
  same-user path replacement after the recheck remains a residual limitation.
  An identity mismatch preserves the observed path for doctor review. The
  install-lock publication sequence is:
  directory preparation, random same-directory temporary creation, write, file
  sync, rename, then directory sync. The standard Bash publisher resolves HOME itself;
  no user text supplies a state directory, temporary filename, command, or snapshot.
  It rejects pre-existing symbolic-link ancestors or target files. This is a
  single-file publication contract, not a claim of multi-file transaction
  atomicity or a guarantee against an adversarial same-user path race.
- The publisher `runtimeIdentity`: canonical absolute executable path, exact Node
  version, and executable SHA-256. Also show the exact absolute publisher argv;
  a bare `node`, `/usr/bin/env node`, or later `PATH` lookup is forbidden.
- The Claude `claudeExecutableIdentity`: canonical absolute executable path,
  exact supported version `2.1.198`, and executable SHA-256. Disclose that every
  candidate phase reverifies realpath, file type, and hash, while the two exact
  approval-bound version rows verify `2.1.198 (Claude Code)`. Every row uses only
  the approved absolute path. A later `PATH` lookup is forbidden.

The preview's state publication order is:

```text
prepare-directory -> protect-directory -> prepare-temporary -> write-temporary
-> sync-temporary -> atomic-rename -> sync-directory
```

### Bundled Runtime State Publisher

The bundled runtime owns each previewed state publication. The one separately
approved Claude `Bash` tool call invokes `runtime.mjs execute`; inside that same
process the runtime issues the one-use capability, renders this publisher, and
publishes only schema-validated snapshots. Before risk acknowledgement and
separate approval, bind every byte of this complete tool contract into the
approval preview digest. Keep it in the canonical approval object available on
demand; the bounded default summary identifies the publisher executable and
state paths without repeating this large command template:

```text
tool: Bash
commandTemplate: <SHELL_QUOTED_ABSOLUTE_NODE_PATH> -e 'const f=require("node:fs"),o=require("node:os"),p=require("node:path"),c=require("node:crypto");const bad=m=>{throw new Error(m)};const missing=e=>e&&e.code==="ENOENT";const runtimeRaw=Buffer.from(process.argv[1],"base64url").toString("utf8"),runtime=JSON.parse(runtimeRaw),runtimeCanonical=JSON.stringify(runtime,null,2)+"\n";if(runtimeRaw!==runtimeCanonical)bad("publisher runtime identity is not canonical JSON");const actual=p.resolve(f.realpathSync(process.execPath));if(actual!==runtime.executablePath||process.versions.node!==runtime.version||c.createHash("sha256").update(f.readFileSync(actual)).digest("hex")!==runtime.sha256)bad("publisher runtime identity changed after approval");const noLinks=(x,allowMissing)=>{const a=p.resolve(x),parts=a.split(p.sep).filter(Boolean);let q=p.parse(a).root;for(const part of parts){q=p.join(q,part);try{const s=f.lstatSync(q);if(s.isSymbolicLink())bad("setup state path contains a symlink");if(q!==a&&!s.isDirectory())bad("setup state ancestor is not a directory")}catch(e){if(allowMissing&&missing(e))return;throw e}}};const regularDir=x=>{const s=f.lstatSync(x);if(s.isSymbolicLink()||!s.isDirectory())bad("setup state directory is not regular")};const regularFile=x=>{const s=f.lstatSync(x);if(s.isSymbolicLink()||!s.isFile())bad("setup state file is not regular")};if(!Number.isInteger(f.constants.O_NOFOLLOW)||!Number.isInteger(f.constants.O_DIRECTORY))bad("required atomic state flags unavailable");const raw=Buffer.from(process.argv[2],"base64url").toString("utf8"),value=JSON.parse(raw),canonical=JSON.stringify(value,null,2)+"\n";if(raw!==canonical)bad("setup snapshot is not canonical JSON");const expected=process.argv[3];if(expected!=="missing"&&!/^[0-9a-f]{64}$/.test(expected))bad("invalid expected setup state digest");const project=p.join(o.homedir(),".claude","claude-code-skillsets"),dir=p.join(project,"state"),target=p.join(dir,"install-lock.json"),temp=p.join(dir,".install-lock.json.tmp-"+c.randomBytes(16).toString("hex"));let fd,renamed=false;try{noLinks(dir,true);f.mkdirSync(dir,{recursive:true,mode:448});noLinks(dir,false);regularDir(project);regularDir(dir);f.chmodSync(project,448);f.chmodSync(dir,448);noLinks(temp,true);fd=f.openSync(temp,f.constants.O_WRONLY|f.constants.O_CREAT|f.constants.O_EXCL|f.constants.O_NOFOLLOW,384);f.fchmodSync(fd,384);regularFile(temp);f.writeFileSync(fd,raw,"utf8");f.fsyncSync(fd);f.closeSync(fd);fd=undefined;regularFile(temp);noLinks(target,true);let prior="missing";try{regularFile(target);prior=c.createHash("sha256").update(f.readFileSync(target)).digest("hex")}catch(e){if(!missing(e))throw e}if(prior!==expected)bad("expected-prior-digest stale check failed; run /skillset-manager:doctor");f.renameSync(temp,target);renamed=true;const d=f.openSync(dir,f.constants.O_RDONLY|f.constants.O_DIRECTORY);try{f.fsyncSync(d)}finally{f.closeSync(d)}}finally{if(fd!==undefined)try{f.closeSync(fd)}catch{}if(!renamed)try{f.rmSync(temp,{force:true})}catch{}}' '<BASE64URL_PUBLISHER_RUNTIME_IDENTITY>' '<BASE64URL_CANONICAL_SETUP_SNAPSHOT>' '<EXPECTED_PRIOR_SETUP_STATE_DIGEST>'
runtimePathPlaceholder: <SHELL_QUOTED_ABSOLUTE_NODE_PATH>
runtimeIdentityPlaceholder: <BASE64URL_PUBLISHER_RUNTIME_IDENTITY>
snapshotPlaceholder: <BASE64URL_CANONICAL_SETUP_SNAPSHOT>
expectedPriorDigestPlaceholder: <EXPECTED_PRIOR_SETUP_STATE_DIGEST>
snapshotEncoding: canonical-json-base64url
dynamicValueSource: verified-setup-snapshot-and-authenticated-prior-raw-digest-only
```

The runtime resolves the path and identity placeholders before approval from the
separately consented observations; they are fixed approval-bound values. The only
post-approval dynamic values are the base64url encoding of the verified canonical
snapshot and the authenticated exact prior raw digest (or exact absence). They
replace their dedicated placeholders; user text and raw command output never
enter the publisher command.
The runtime requires its rendered command to match the approved template
byte-for-byte apart from those two state-derived substitutions. It never
resolves the publisher through `PATH` during execution. Before any state access,
the inline publisher immediately reverifies its own realpath, Node version, and
executable SHA-256 against the approved runtime identity and fails closed if any
value changed. It then performs
random same-directory `O_EXCL | O_NOFOLLOW` creation at mode `0600`, protects
directories at `0700`, rejects symbolic-link ancestors and targets, performs
file fsync, atomic rename, and directory fsync, and removes an uncommitted
temporary file on failure.

This identity binding limits `PATH` substitution and stale-binary execution. It
does not make an untrusted local executable safe and cannot promise total TOCTOU
immunity against an adversary who controls the same account or executable path.

`runtime.mjs` is the installed executable form of the TypeScript evaluator and
publisher. Do not use Claude `Write`, a repository-only harness, an improvised
shell command, or a shortened reconstruction instead.

For every candidate, the same summary must show these literal semantic argv in
this exact order; each row is separately receipt-verified. The actual executable
for every row is the approved canonical absolute Claude path. The runtime
revalidates that path and SHA-256 before each row; exact version compatibility is
checked by the two approval-bound version rows:

```sh
marketplace-before: claude plugin marketplace list --json
cli-version-before: claude --version
install: claude plugin install <approved-plugin@approved-marketplace> --scope user
plugin-list-after: claude plugin list --json
cli-version-after: claude --version
```

There is no persistent write before final approval. The preview identifies both
fixed relative state paths, the execution-lock acquire/release and structural
publisher steps, exact commands, and exact
candidate order. The schema-v2 lock snapshot contains ordered `runs`; each run
records its complete exact approval binding (`preview` plus recomputable
`previewDigest`), decision-index digest, catalog expiry, command order and
statuses, state paths, publisher runtime identity, and managed-install receipts.
Each run's approval preview digest binds the complete Bash publisher contract and
every exact install argv.

Ask for a specific acknowledgement before the final approval question: the user
must acknowledge incomplete individual safety review, every unknown sensitive
field, every capability inference that is not an install smoke, and that success
does not guarantee safety, trust, capability quality, or an exact reviewed revision.
State the order explicitly: every listed risk must be acknowledged before a
separate exact approval can be requested. Use the runtime-provided acknowledgement
statement; do not paraphrase it into weaker or unordered consent.
This acknowledgement is not installation approval.
For Shopify official evidence, telemetry, Node/Bash execution behavior, store
authentication, and secret-flow behavior remain `unknown`; do not describe them
as safe, disabled, reviewed, or absent.

## Separate Exact Approval

After the acknowledgement, reference the already displayed bounded summary and
its `approvalPreviewDigest`; do not print the full approval object or repeat the
summary. Ask for separate final approval of that exact plan. The user's approval of the exact absolute
Node `approvedExecution.argv` as one Claude `Bash` tool call is the external
execution boundary. Do not treat the prior risk acknowledgement as execution
approval and do not run `execute` through any other tool or command. Bind a
deterministic digest to the complete
structured preview and compare the full structure, not only a boolean or a
partial digest. It includes language, goal, selected domains, `planKind`,
`selectionBasis`, complete starter coverage fields, observed UTC value,
decision-index digest, catalog expiry, exact commands,
candidate IDs and identities, execution order, state paths, disclosure fields,
all probe/version/install/verification argv, risk disclosures, every state operation sequence,
the canonical publisher executable path/version/SHA-256 and exact absolute argv,
and the complete state publisher tool contract.
The install literal argv is a precomputed array; must not interpolate
user, probe, or marketplace text into a shell command. Any change,
including a later UTC time, invalidates approval and requires a new acknowledgement
and approval. Blanket, previous, or manager approval does not apply.
The exact approval binding may issue at most one process-local execution
capability. Repeating the same object or a structural clone is a replay and
returns to `awaiting-approval` with no capability; obtain a fresh consented UTC
observation and approve the newly bound preview. A capability itself is
single-use even when execution fails or crashes after a durable publication.
Its short expiry is calculated from actual UTC at issuance and never extends
beyond the catalog expiry. The durable executor rechecks actual UTC before the
initial publication, before every candidate, and again before committing a
successful candidate receipt. Expiry fails closed and requires a fresh UTC
observation, acknowledgement, and approval.

Execution authority also requires the exact cached, deeply frozen decision-index
object returned by the no-argument module-owned installed-index loader. A generic
caller-root loader may validate read-only planning data but never authenticates
execution. A caller-provided, schema-valid,
self-consistently rehashed object can be used only for non-authoritative preview
calculation: it cannot make approval valid or issue a capability. The durable
executor accepts only the same authenticated index object used at issuance.
Normalized fixture plans and completed-plan objects carry no write authority;
there is no public plan-to-lock publisher. Only the capability-consuming durable
executor may publish `install-lock.json`.

The approved `execute` subcommand reloads the same authenticated index,
recomputes the normalized preview and risk-acknowledgement digest, compares both
lowercase SHA-256 values, issues the capability, and consumes it in the durable
executor without leaving the process. A missing or changed request, preview
digest, acknowledgement digest, runtime identity, catalog, route, or candidate
fails before any Claude install command.

## Sequential Execution and Receipt

Execute only after the current exact approval. Publish the completed lock snapshot
through the previewed internal structural sequence; the prior regular lock remains
authoritative until rename completes. A temporary file is never a committed lock.
Execute one candidate at a time and never retry, alter a literal argv, remove a
plugin, or overwrite a receipt.

Before every candidate phase, revalidate the approved Claude executable's
canonical realpath, regular-file type, and SHA-256. Fail before that phase if any
value differs, and never fall back to `PATH`. The approval-bound
`cli-version-before` and `cli-version-after` rows each run exactly one
`claude --version` and require `2.1.198 (Claude Code)`. No undisclosed version
probe may run between the five semantic rows. Then parse the raw
`claude plugin marketplace list --json`
Claude Code `2.1.198` discriminated marketplace rows (`source: github` uses
`repo`; `source: git` uses `url`) and verify the exact official marketplace
`{id, source}`. A supported unrelated `git` row does not invalidate that exact
official `github` identity. The same ID with another source is a hard failure;
malformed rows, duplicates, or conflicts also fail. Fresh setup does not observe a pre-install plugin list,
so `preInstallVersion` is explicitly `null`. Run the
previewed command, then parse raw `claude plugin list --json` output immediately afterward
to verify the exact plugin name, marketplace ID, scope, and enabled
state. Claude Code `2.1.198` does not report `loadStatus`. It may report either a
semver or an opaque/`unknown` version string; only a valid semver is revision
evidence. Use and record this exact phase order without reordering it. The command
receipt's `invocationTrace` must have exactly the semantic argv actually invoked
and must equal the approval-bound sequence on success:
`marketplace-before` -> `cli-version-before` -> `install` ->
`plugin-list-after` -> `cli-version-after`. Both raw CLI version outputs must be
exactly `2.1.198 (Claude Code)`. A command exit success is insufficient: every
phase must match the candidate, marketplace, source, scope, enabled state, and
honest version-evidence contract before a receipt exists.

After every successful managed install, record this `ManagedInstallReceipt` in
the temporary lock, render and run only the approved standard Bash publisher,
atomically rename and directory-sync the resulting lock,
then begin the next candidate. A crash between candidates therefore leaves the
already verified successful receipt durable and never starts or records the next
candidate:

```json
{
  "managedBy": "claude-code-skillsets",
  "decisionPlanDigest": "<approved preview digest>",
  "pluginName": "<exact parsed plugin name>",
  "marketplaceId": "<exact observed marketplace ID>",
  "marketplaceSource": "<exact observed marketplace source>",
  "scope": "user",
  "preInstallVersion": null,
  "postInstallVersion": null,
  "versionStatus": "unknown",
  "observedAt": "<consented UTC timestamp>",
  "installCommandDigest": "<SHA-256 of exact command>"
}
```

Keep receipts as one globally unique `(pluginName, marketplaceId, scope)` set
across every run in the single install-lock snapshot. Each run retains its own
exact approval, ordered statuses, and receipts. Record `success`, `failure`,
`installed-but-unverified`, or `skipped` status for every candidate. If the
install command succeeds but any post-install plugin/version verification fails,
record `installed-but-unverified`, preserve the candidate identity, literal
install argv and invocation evidence, mint no managed receipt, and disclose that
the plugin may remain installed. Never retry or remove it automatically. On any
failure or installed-but-unverified state, stop the remaining commands, mark them
skipped and preserve all prior runs byte-for-structure, then publish one final snapshot
before stopping. An
abandoned temporary file never supersedes the prior lock. Never include secret values in a
receipt. A successful receipt means only that the exact plugin identity was
observed enabled. `versionStatus: unknown` always pairs with
`postInstallVersion: null`; maintenance must hold that receipt until a semver is
observed. `versionStatus: observed-semver` instead pairs with the exact semver
string. Neither form claims an exact source-pinned revision was installed.

Before any Claude command, the runtime reads only canonical JSON from the anchored
`state/install-lock.json` path and rejects symbolic links. It authenticates every
run against the plugin-owned current or immutable digest-named historical index,
requires every prior run to be fully successful,
and rejects duplicate run digests or duplicate managed identities. A fully
successful run with the same exact preview digest invokes no Claude command and
leaves the durable install lock unchanged; it only acquires and releases the
approved transient execution lock before returning `already-executed`. A new non-overlapping approval appends one run without
rewriting prior run structures. A validated schema-v1 lock is treated as one
legacy run and is deterministically nested unchanged when the first schema-v2
append is published; no evidence is silently discarded. Partial, failed,
installed-but-unverified,
malformed, duplicate, or drifted state requires doctor or maintenance review and
has no automatic resume. After execution, direct the user to
`/skillset-manager:doctor` with the exact setup candidate IDs and selected domain
IDs. Doctor diagnosis is read-only; observation or reconciliation requires a new,
separate approval and never inherits setup approval.

After approval and before reading state or invoking Claude, acquire the anchored
`state/setup-execution.lock` with `O_EXCL`, `O_NOFOLLOW`, and mode `0600`. Keep it
through the last state publication, then recheck its identity immediately before
pathname removal in `finally`. This is not an inode-bound unlink: a same-user
replacement after that recheck remains a residual limitation. An existing or
identity-mismatched lock is a fail-closed doctor hold and preserves the observed
path; never infer that a stale lock is safe to delete. Every publisher call runs
the expected-prior-digest stale check on the exact prior canonical raw SHA-256
(or exact absence) before rename. That check is not atomic against a same-user
external writer that ignores the execution lock.

The public release carries both current `data/decision-index.json` and bounded
`data/routing-index.json`. Before a future release changes the full decision
file's digest, preserve its exact prior bytes append-only as
`data/decision-index-history/<digest>.json`. Never rewrite or delete history.
