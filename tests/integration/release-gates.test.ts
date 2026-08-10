import { execFileSync, spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  sanitizeReceiptTree,
  verifySanitizedReceiptTree
} from "../../src/evaluate/sanitize.js";
import {
  repositoryMetadataFromGitHubResponse,
  verifyGitHubProtectionResponse
} from "../../scripts/github/verify-branch-protection.js";
import { requiredCheckBindings } from "../../src/governance/branch-protection.js";
import { checkDecisionBrokerV1 } from "../../scripts/research/check-decision-broker-v1.js";
import { assertExtensionAppendOnly } from "../../scripts/research/assert-extension-append-only.js";
import { materializeDecisionResearch } from "../../scripts/research/materialize-decision-research.js";
import { hashReviewEvent, serializeReviewLedgerJsonl } from "../../src/research/review-ledger.js";
import type { ReviewLedgerEvent } from "../../src/model/review-ledger.js";
import { resolveTestTimeout } from "../../vitest.config.js";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

describe("foundation release gates", () => {
  it("re-materializes every v1 research projection before checking all generated decision artifacts", async () => {
    const [packageJson, checkScript] = await Promise.all([
      readFile(join(projectRoot, "package.json"), "utf8"),
      readFile(join(projectRoot, "scripts", "research", "check-decision-broker-v1.ts"), "utf8")
    ]);
    const scripts = (JSON.parse(packageJson) as { scripts: Record<string, string> }).scripts;

    expect(scripts["research:migrate-decision-broker-v1"]).toBe(
      "tsx scripts/research/migrate-decision-broker-v1.ts"
    );
    expect(scripts["check:generated"]).toContain("check-decision-broker-v1.ts");
    expect(scripts["check:generated"]).toContain("plugins/skillset-manager/data");
    for (const path of [
      "research/source-observations.json",
      "research/source-diffs.json",
      "research/materialized-review-state.json",
      "generated/decision-index.json",
      "plugins/skillset-manager/data/decision-index.json"
    ]) {
      expect(scripts["check:generated"]).toContain(path);
    }
    expect(checkScript).toContain("materializeDecisionResearch");
    expect(checkScript).toContain("checkOnly: true");
    expect(checkScript).toContain("materialized-review-state.json");
    expect(checkScript).not.toContain("2026-07-29T00:00:00Z");
  });

  it("accepts a future materialized asOf and appended review without rerunning the one-time migration", async () => {
    const root = await mkdtemp(join(tmpdir(), "future-decision-materialization-"));
    try {
      await Promise.all([
        cp(join(projectRoot, "research"), join(root, "research"), { recursive: true }),
        cp(join(projectRoot, "governance"), join(root, "governance"), { recursive: true })
      ]);
      await writeFile(
        join(root, "research", "review-ledger.jsonl"),
        serializeReviewLedgerJsonl([futureHeldReview()])
      );
      await materializeDecisionResearch({
        root,
        asOf: "2026-08-02T00:00:00Z",
        checkOnly: false
      });

      await expect(checkDecisionBrokerV1({ root })).resolves.toBeUndefined();
      const state = JSON.parse(await readFile(join(root, "research", "materialized-review-state.json"), "utf8")) as { asOf: string };
      expect(state.asOf).toBe("2026-08-02T00:00:00Z");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("authenticates actual annotated registry anchors and derives the anchored clean-copy base", async () => {
    const root = await mkdtemp(join(tmpdir(), "anchored-clean-copy-gate-"));
    try {
      git(root, ["init", "-q"]);
      git(root, ["config", "user.name", "Anchor Test"]);
      git(root, ["config", "user.email", "anchor-test@example.test"]);
      await mkdir(join(root, "notes"));
      await writeFile(join(root, "notes", "bootstrap.txt"), "bootstrap\n");
      const preAnchorBase = commitFixture(root, "bootstrap");

      expect(runRegistryAnchor(root, "pre-anchor", "")).toBe("");
      expect(resolveCleanCopyBase(root, "pre-anchor", "", preAnchorBase)).toBe(preAnchorBase);

      git(root, ["tag", "-a", "registry-approved/r01", "-m", "root anchor"]);
      const rootObject = git(root, ["rev-parse", "registry-approved/r01"]);
      const rootTarget = git(root, ["rev-parse", "HEAD"]);
      expect(() => runRegistryAnchor(root, "pre-anchor", "")).toThrow(/pre-anchor registry cannot contain/i);
      expect(() => runRegistryAnchor(root, "anchored", "f".repeat(40))).toThrow(/protected registry anchor object/i);

      await writeFile(join(root, "notes", "ordinary-head.txt"), "ordinary code only\n");
      commitFixture(root, "ordinary code only");
      expect(runRegistryAnchor(root, "anchored", rootObject, ["--print-target"])).toBe(rootTarget);
      expect(resolveCleanCopyBase(root, "anchored", rootObject, preAnchorBase)).toBe(rootTarget);

      await writeJsonFixture(root, "research/observation-evidence/observation-first.json", {
        id: "observation-first"
      });
      const candidateBase = git(root, ["rev-parse", "HEAD"]);
      const candidateHead = commitFixture(root, "prospective research batch");
      expect(runRegistryAnchor(root, "anchored", rootObject, [
        "--mode", "pre-approval-candidate", "--base", candidateBase, "--print-target"
      ])).toBe(candidateBase);
      expect(resolveCleanCopyBase(root, "anchored", rootObject, preAnchorBase, {
        REGISTRY_APPROVAL_MODE: "pre-approval-candidate",
        APPEND_BASE: candidateBase
      })).toBe(candidateBase);
      expect(candidateHead).toBe(git(root, ["rev-parse", "HEAD"]));

      await writeFile(join(root, "notes", "research-batch.txt"), "reviewed batch\n");
      const batchHead = commitFixture(root, "research batch");
      git(root, [
        "tag", "-a", "registry-approved/research-0001", "-m", [
          "sequence: 1",
          "previous-tag: registry-approved/r01",
          `previous-tag-object: ${rootObject}`,
          `batch-head: ${batchHead}`
        ].join("\n")
      ]);
      const latestObject = git(root, ["rev-parse", "registry-approved/research-0001"]);
      await writeFile(join(root, "notes", "ordinary-after-batch.txt"), "ordinary after batch\n");
      commitFixture(root, "ordinary after reviewed batch");

      expect(() => runRegistryAnchor(root, "anchored", rootObject, ["--print-target"])).toThrow(/stale/i);
      expect(runRegistryAnchor(root, "anchored", latestObject, ["--print-target"])).toBe(batchHead);
      expect(resolveCleanCopyBase(root, "anchored", latestObject, preAnchorBase)).toBe(batchHead);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("composes CI registry modes across an approved changed batch and an ordinary follow-up", async () => {
    const root = await mkdtemp(join(tmpdir(), "registry-ci-composition-"));
    try {
      const fixture = await createRegistryCiFixture(root);

      expect(runQualityRegistryGate(root, fixture.eventBase, fixture.rootObject)).toBe("changed-batch");
      expect(runPluginCleanCopyRegistryGate(root, fixture.eventBase, fixture.rootObject)).toEqual({
        mode: "changed-batch",
        appendBase: fixture.rootTarget
      });
      expect(() => runQualityRegistryGate(root, fixture.eventBase, fixture.latestObject))
        .toThrow(/--base must descend from the immediate approved registry predecessor target/i);
      expect(() => runPluginCleanCopyRegistryGate(root, fixture.eventBase, fixture.latestObject))
        .toThrow(/--base must descend from the immediate approved registry predecessor target/i);

      await writeJsonFixture(root, "governance/reviewers.json", {
        schemaVersion: 3,
        reviewers: [
          { id: "seunghyeon1004", roles: ["maintainer", "security-reviewer"] },
          { id: "new-reviewer", roles: ["source-reviewer"] }
        ]
      });
      const reviewerAllowlistBase = commitFixture(root, "allow new reviewer");
      expect(runQualityRegistryGate(root, fixture.batchHead, fixture.latestObject)).toBe("current-tip");
      expect(runPluginCleanCopyRegistryGate(root, fixture.batchHead, fixture.latestObject)).toEqual({
        mode: "current-tip",
        appendBase: fixture.batchHead
      });

      const appended = ledgerEvent({
        sequence: 2,
        id: "new-reviewer-held",
        previousEventHash: fixture.initialLedgerHash,
        target: { sourceId: "source-b", skillPath: "skills/new/SKILL.md" },
        reviewerId: "new-reviewer",
        reviewedAt: "2026-07-30T00:00:00Z",
        expiresAt: "2026-08-30T00:00:00Z"
      });
      await writeFile(
        join(root, "research", "review-ledger.jsonl"),
        `${await readFile(join(root, "research", "review-ledger.jsonl"), "utf8")}${serializeReviewLedgerJsonl([appended])}`
      );
      const ledgerAppendBase = reviewerAllowlistBase;
      const ledgerHead = commitFixture(root, "append new reviewer ledger event");
      expect(runQualityRegistryGate(root, ledgerAppendBase, fixture.latestObject)).toBe("current-tip");
      expect(runPluginCleanCopyRegistryGate(root, ledgerAppendBase, fixture.latestObject)).toEqual({
        mode: "current-tip",
        appendBase: fixture.batchHead
      });
      expect(() => runQualityRegistryGate(root, fixture.batchHead, fixture.latestObject))
        .toThrow(/reviewer registry and review ledger cannot change in the same change/i);
      expect(() => runPluginCleanCopyRegistryGate(root, fixture.batchHead, fixture.latestObject))
        .toThrow(/reviewer registry and review ledger cannot change in the same change/i);

      await writeFile(join(root, "notes", "ordinary-after-approval.txt"), "ordinary code only\n");
      commitFixture(root, "ordinary after approval");
      expect(runQualityRegistryGate(root, ledgerHead, fixture.latestObject)).toBe("current-tip");
      expect(runPluginCleanCopyRegistryGate(root, ledgerHead, fixture.latestObject)).toEqual({
        mode: "current-tip",
        appendBase: fixture.batchHead
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 20_000);

  it("uses immutable actions and validates every decision broker release surface", async () => {
    const [workflow, vitestConfig, generationTest] = await Promise.all([
      readFile(join(projectRoot, ".github", "workflows", "ci.yml"), "utf8"),
      readFile(join(projectRoot, "vitest.config.ts"), "utf8"),
      readFile(join(projectRoot, "tests", "integration", "generation.test.ts"), "utf8")
    ]);

    expect(workflow).toMatch(/^\s{2}quality:\s*$/m);
    expect(workflow).toMatch(/^\s{2}claude-plugin-validation:\s*$/m);
    expect(workflow).toContain(
      "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # actions/checkout v7"
    );
    expect(workflow).toContain(
      "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # actions/setup-node v7"
    );
    expect(workflow).toContain("node-version: 22");
    expect(workflow).toContain("cache: npm");
    expect(vitestConfig).toContain("fileParallelism: false");
    expect(resolveTestTimeout("true")).toBe(30_000);
    expect(resolveTestTimeout("false")).toBe(10_000);
    expect(resolveTestTimeout(undefined)).toBe(10_000);
    expect(resolveTestTimeout("true", 15_000)).toBe(30_000);
    expect(resolveTestTimeout("false", 15_000)).toBe(15_000);
    expect(resolveTestTimeout("true", 10_000, 60_000)).toBe(60_000);
    expect(generationTest).toContain(
      'import { resolveTestTimeout } from "../../vitest.config.js";'
    );
    expect(generationTest).toContain("}, resolveTestTimeout(process.env.CI, 15_000));");
    expect(workflow).toMatch(/fetch-depth:\s*0/);
    expect(workflow).toContain("npm install --global @anthropic-ai/claude-code@2.1.198");
    expect(workflow).toContain("npm run check");
    expect(workflow).toContain("github.event.pull_request.base.sha");
    expect(workflow).toContain("github.event.before");
    expect(workflow).toContain("verify:research-append-only -- --base");
    expect(workflow).toContain("verify:review-ledger-append-only -- --base");
    expect(workflow).toContain("verify:decision-index-history -- --previous-ref \"$APPEND_BASE\"");
    expect(workflow).not.toContain("DECISION_INDEX_HISTORY_BOOTSTRAP");
    expect(workflow).toContain("APPROVED_REGISTRY_TAG_OBJECT");
    expect(workflow).toContain("secrets.APPROVED_REGISTRY_TAG_OBJECT");
    expect(workflow).toContain("vars.REGISTRY_APPROVAL_ANCHORED");
    expect(workflow).toContain("require-registry-anchor-input.sh");
    expect(workflow).toContain("resolve-ci-approval-context.ts");
    expect((workflow.match(/npm exec -- tsx scripts\/research\/resolve-ci-approval-context\.ts/g) ?? [])).toHaveLength(2);
    expect(workflow).not.toMatch(/run:\s+tsx scripts\/research\/resolve-ci-approval-context\.ts/);
    expect(workflow).toContain("REGISTRY_APPROVAL_MODE");
    expect(workflow).toMatch(/push:\s*\n\s+branches:\s+\[main\]/);
    expect(workflow).not.toContain("registry-approved/r01");
    expect(workflow).not.toContain("github.event.inputs.tag_object");
    expect(workflow).toContain("bash tests/e2e/clean-copy.sh");
    expect(workflow).toContain("claude plugin validate . --strict");
    expect(workflow).toContain("claude plugin validate plugins/shared-core --strict");
    expect(workflow).toContain("claude plugin validate plugins/skillset-manager --strict");
    expect(workflow).not.toMatch(/uses:\s+actions\/(?:checkout|setup-node)@v\d+/);
    const pluginValidationJob = workflow.slice(
      workflow.indexOf("  claude-plugin-validation:"),
      workflow.length
    );
    const qualityJob = workflow.slice(workflow.indexOf("  quality:"), workflow.indexOf("  claude-plugin-validation:"));
    expect((workflow.match(/resolve-ci-approval-context\.ts/g) ?? [])).toHaveLength(2);
    expect(qualityJob).toContain("APPEND_BASE: ${{ steps.approval_context.outputs.base }}");
    expect(qualityJob).toContain("REGISTRY_APPROVAL_MODE: ${{ steps.approval_context.outputs.mode }}");
    expect(pluginValidationJob).toContain("APPEND_BASE: ${{ steps.approval_context.outputs.base }}");
    expect(pluginValidationJob).toContain("LEDGER_APPEND_BASE: ${{ steps.approval_context.outputs.base }}");
    expect(pluginValidationJob).toContain("REGISTRY_APPROVAL_MODE: ${{ steps.approval_context.outputs.mode == 'first-public-bootstrap' && 'current-tip' || steps.approval_context.outputs.mode }}");
    expect(pluginValidationJob).toContain("REGISTRY_APPROVAL_ANCHORED: ${{ vars.REGISTRY_APPROVAL_ANCHORED }}");
    expect(pluginValidationJob).toContain("APPROVED_REGISTRY_TAG_OBJECT: ${{ secrets.APPROVED_REGISTRY_TAG_OBJECT }}");
  });

  it("states that official Marketplace listing is not individual plugin safety certification", async () => {
    const [marketplace, manifest, pluginManifest, pluginReadme, notices, gitignore] = await Promise.all([
      readFile(join(projectRoot, ".claude-plugin", "marketplace.json"), "utf8"),
      readFile(join(projectRoot, "manifests", "plugins", "skillset-manager.yaml"), "utf8"),
      readFile(join(projectRoot, "plugins", "skillset-manager", ".claude-plugin", "plugin.json"), "utf8"),
      readFile(join(projectRoot, "plugins", "skillset-manager", "README.md"), "utf8"),
      readFile(join(projectRoot, "plugins", "skillset-manager", "THIRD_PARTY_NOTICES"), "utf8"),
      readFile(join(projectRoot, ".gitignore"), "utf8")
    ]);
    const descriptions = `${marketplace}\n${manifest}\n${pluginManifest}\n${pluginReadme}`;
    const entryDescriptions = `${marketplace}\n${manifest}\n${pluginManifest}`;
    expect(descriptions).not.toMatch(/reviewed external Claude plugins|검토된 외부 Claude 플러그인/i);
    expect(entryDescriptions).toMatch(/Anthropic official Marketplace listing is not safety certification/i);
    expect(entryDescriptions).toMatch(/Anthropic 공식 Marketplace 등재는 안전성 인증이 아닙니다/i);
    expect(marketplace).toMatch(/no-vendoring[\s\S]*source-identity evidence/i);
    expect(marketplace).toMatch(/비번들[\s\S]*source identity 근거|source identity 근거[\s\S]*비번들/i);
    expect(notices).toMatch(/Shopify AI Toolkit[\s\S]*556811e94dd45c795abe5c0b1bf6b5a4b098149d[\s\S]*metadata[\s\S]*hash/i);
    expect(gitignore).toMatch(/^\.env$/m);
    expect(gitignore).toMatch(/^\.env\.\*$/m);
    expect(gitignore).toMatch(/^!\.env\.example$/m);
    expect(gitignore).toMatch(/^\.claude\/settings\.local\.json$/m);
    expect(gitignore).toMatch(/^\.superpowers\/sdd\/$/m);
  });

  it("lets both required CI jobs handle only an attested first A/B main push", async () => {
    const [workflow, releaseGuide] = await Promise.all([
      readFile(join(projectRoot, ".github", "workflows", "ci.yml"), "utf8"),
      readFile(join(projectRoot, "docs", "release", "github-free-staged-public.md"), "utf8")
    ]);

    expect((workflow.match(/Prepare exact first-public bootstrap context/g) ?? [])).toHaveLength(2);
    expect((workflow.match(/github\.event\.before == '0000000000000000000000000000000000000000'/g) ?? [])).toHaveLength(2);
    expect((workflow.match(/git ls-remote --heads --tags origin/g) ?? [])).toHaveLength(2);
    expect((workflow.match(/END \{ print count \+ 0 \}.*= 3/g) ?? [])).toHaveLength(2);
    expect((workflow.match(/refs\\\/tags\\\/public-history\\\/root-v\[1-9\]\[0-9\]\*\$/g) ?? [])).toHaveLength(2);
    expect((workflow.match(/peeled_object=/g) ?? [])).toHaveLength(2);
    expect((workflow.match(/rev-parse --verify "\$\{tag_ref\}\^\{tag\}"/g) ?? [])).toHaveLength(2);
    expect((workflow.match(/PUBLIC_BOOTSTRAP_REMOTE_EXACT: \$\{\{ steps\.bootstrap_context\.outputs\.remote_exact \}\}/g) ?? [])).toHaveLength(2);
    expect((workflow.match(/PUBLIC_ROOT_TAG_NAME: \$\{\{ steps\.bootstrap_context\.outputs\.tag_name \}\}/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect((workflow.match(/first-public-bootstrap/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(workflow).toContain("PUBLIC_ROOT_COMMIT: ${{ steps.approval_context.outputs.mode == 'first-public-bootstrap' && steps.approval_context.outputs.base || '' }}");
    expect(releaseGuide).toMatch(/exactly three advertised lines[\s\S]*annotated tag object[\s\S]*peeled/i);
  });

  it("captures corrective-candidate push CI without substituting manual current-tip CI", async () => {
    const [workflow, bootstrapWorkflow, releaseGuide] = await Promise.all([
      readFile(join(projectRoot, ".github", "workflows", "ci.yml"), "utf8"),
      readFile(join(projectRoot, ".github", "workflows", "public-history-bootstrap.yml"), "utf8"),
      readFile(join(projectRoot, "docs", "release", "github-free-staged-public.md"), "utf8")
    ]);
    const dispatchDeclaration = workflow.slice(workflow.indexOf("  workflow_dispatch:"), workflow.indexOf("permissions:"));

    expect(workflow).toMatch(/on:\s*\n[\s\S]*?workflow_dispatch:\s*\n\s+inputs:\s*\n\s+expected_tip:/);
    expect(dispatchDeclaration).toMatch(/expected_tip:[\s\S]{0,160}required:\s*true[\s\S]{0,80}type:\s*string/);
    expect(dispatchDeclaration).not.toMatch(/root_commit:|tip_commit:|tag_name:|tag_object:/);
    expect((workflow.match(/MANUAL_CURRENT_TIP: \$\{\{ github\.event_name == 'workflow_dispatch' && 'true' \|\| 'false' \}\}/g) ?? [])).toHaveLength(2);
    expect((workflow.match(/EXPECTED_CURRENT_TIP: \$\{\{ inputs\.expected_tip \}\}/g) ?? [])).toHaveLength(2);
    expect(bootstrapWorkflow).not.toMatch(/MANUAL_CURRENT_TIP|EXPECTED_CURRENT_TIP|expected_tip/);
    expect(bootstrapWorkflow).toMatch(/root_commit:[\s\S]*tip_commit:[\s\S]*tag_name:[\s\S]*tag_object:/);
    const currentTipSection = releaseGuide.slice(
      releaseGuide.indexOf("### 1D. Anchor reviewed refreshes"),
      releaseGuide.indexOf("### 1E. Review candidate additions")
    );
    expect(currentTipSection).toMatch(/```bash\nset -euo pipefail/);
    expect(currentTipSection).toContain("--event push");
    expect(currentTipSection).toContain("--limit 1000 --json databaseId,createdAt");
    expect(currentTipSection.indexOf("PREEXISTING_PUSH_RUNS=")).toBeLessThan(
      currentTipSection.indexOf('git push --porcelain "$PUBLIC_REMOTE_URL" "$CANDIDATE_SHA:refs/heads/main"')
    );
    expect(currentTipSection.indexOf('PUSHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"')).toBeLessThan(
      currentTipSection.indexOf('git push --porcelain "$PUBLIC_REMOTE_URL" "$CANDIDATE_SHA:refs/heads/main"')
    );
    expect(currentTipSection).toMatch(/\[\$preexisting\[\]\.databaseId\] as \$preexisting_ids/);
    expect(currentTipSection).toMatch(/\.createdAt >= \$pushed_at/);
    expect(currentTipSection).toMatch(/index\(\$id\).*== null/);
    expect(currentTipSection).toMatch(/for attempt in \$\(seq 1 12\)[\s\S]*NEW_PUSH_RUN_IDS=.*list_new_push_run_ids/);
    expect(currentTipSection).toContain('PUSH_CI_RUN_ID="$(jq -r \'.[0]\' <<<"$NEW_PUSH_RUN_IDS")"');
    expect(currentTipSection).toContain('gh run view "$PUSH_CI_RUN_ID" --repo "$REPO"');
    expect(currentTipSection).toMatch(/manual[^.]*workflow_dispatch[^.]*never[^.]*substitute/i);
    expect(currentTipSection).toMatch(/exact `CANDIDATE_SHA`[\s\S]*quality[\s\S]*claude-plugin-validation[\s\S]*terminal[^.]*success/i);
  });

  it("keeps catalog refresh outside initial public staging and binds later maintenance to the candidate", async () => {
    const releaseGuide = await readFile(
      join(projectRoot, "docs", "release", "github-free-staged-public.md"),
      "utf8"
    );
    const prePublicSection = releaseGuide.slice(
      releaseGuide.indexOf("### 1D. Anchor reviewed refreshes"),
      releaseGuide.indexOf("## 2. Approved public staging")
    );
    const maintenanceSection = releaseGuide.slice(
      releaseGuide.indexOf("## 7. Later approved catalog maintenance")
    );

    expect(prePublicSection).toMatch(/do not dispatch[^.]*Catalog refresh[^.]*initial\s+public staging/i);
    expect(prePublicSection).not.toContain("gh workflow run catalog-refresh.yml");
    expect(prePublicSection).toMatch(/CATALOG_REFRESH_ENABLED[^.]*remain unset/i);
    expect(prePublicSection).not.toMatch(/gh variable set CATALOG_REFRESH_ENABLED/);
    expect(prePublicSection).toMatch(/fresh live `main`[^.]*exact(?:ly)?[^.]*`CANDIDATE_SHA`[^.]*stage 2/i);
    expect(releaseGuide.indexOf("## 7. Later approved catalog maintenance")).toBeGreaterThan(
      releaseGuide.indexOf("## 5. Release, tag, and announcement")
    );
    expect(maintenanceSection).toContain('gh workflow run catalog-refresh.yml --repo "$REPO" --ref main -f expected_tip="$CANDIDATE_SHA"');
    expect(maintenanceSection).toContain("gh variable set CATALOG_REFRESH_ENABLED --body enabled");
    expect(maintenanceSection).toMatch(/manual[^.]*schedule[^.]*CATALOG_REFRESH_ENABLED[^.]*enabled/is);
    expect(maintenanceSection).toMatch(/separate approval|separately approved/i);
    expect(maintenanceSection).toMatch(/schedule[^.]*event SHA/i);
    expect(maintenanceSection).toMatch(/publish[^.]*live `main`[^.]*validated base/i);
    expect(maintenanceSection).toMatch(/before[^.]*push[^.]*after[^.]*push[^.]*PR response[^.]*base SHA/is);
    expect(maintenanceSection).toMatch(/cannot[^.]*atomically lock[^.]*main|residual race/i);
    expect(maintenanceSection).toMatch(/response loss|ambiguous transport result/i);
    expect(maintenanceSection).toMatch(/attempt[^.]*authenticated[^.]*inventory/i);
    expect(maintenanceSection).toMatch(/exact[^.]*candidate[^.]*lease[^.]*delete/i);
    expect(maintenanceSection).toMatch(/other SHA[^.]*never[^.]*delete/i);
    expect(maintenanceSection).toMatch(/multiple[^.]*PR[^.]*operator review/i);
    expect(maintenanceSection).toMatch(/case-normalized[^.]*repository[^.]*ID/i);
    expect(maintenanceSection).toMatch(/body[^.]*branch[^.]*SHA[^.]*base[^.]*repository/is);
    expect(maintenanceSection).toMatch(/cannot guarantee[^.]*cleanup|cleanup[^.]*not guaranteed/i);
    expect(maintenanceSection).toMatch(/operator[^.]*inspect[^.]*live[^.]*refs[^.]*PRs[^.]*retry/i);
  });

  it("keeps the one-time bootstrap immutable while validating a corrective descendant", async () => {
    const releaseGuide = await readFile(
      join(projectRoot, "docs", "release", "github-free-staged-public.md"),
      "utf8"
    );
    const correctiveSection = releaseGuide.slice(
      releaseGuide.indexOf("### 1D. Anchor reviewed refreshes"),
      releaseGuide.indexOf("### 1E. Review candidate additions")
    );

    expect(correctiveSection).toContain('APPROVED_PUBLIC_ROOT_A="cb2f51c097be78612b07bcafe66bc30914c7d5ac"');
    expect(correctiveSection).toContain('APPROVED_PUBLIC_ROOT_TAG_OBJECT="6b56351f581797fc3ca26bd0c3a1f7978da4c675"');
    expect(correctiveSection).toContain('APPROVED_BOOTSTRAP_TIP_B="0ad29eea67c9f504c345d8be2bbc514bd0de5aca"');
    expect(correctiveSection).toContain('APPROVED_R01_TAG_OBJECT="92da733d31af3db551a442e141fbd6b2bfd11010"');
    expect(correctiveSection).toContain('BOOTSTRAP_TIP_B="$(git rev-parse registry-approved/r01^{commit})"');
    expect(correctiveSection).toContain('CANDIDATE_SHA="$(git rev-parse HEAD)"');
    expect(correctiveSection).toContain('test "$(git rev-list --parents -n 1 "$CANDIDATE_SHA")" = "$CANDIDATE_SHA $BOOTSTRAP_TIP_B"');
    expect(correctiveSection).toMatch(/--format=%ae[\s\S]*\.local[\s\S]*--format=%ce[\s\S]*\.local/);
    expect(correctiveSection).toMatch(/interpret-trailers --parse[\s\S]*Signed-off-by/);
    expect(correctiveSection).toContain("EXPECTED_MAINTENANCE_PATHS=");
    for (const path of [
      "README.en.md",
      "README.md",
      "docs/release/github-free-staged-public.md",
      "package-lock.json",
      "plugins/skillset-manager/THIRD_PARTY_NOTICES",
      "plugins/skillset-manager/runtime.mjs",
      "schemas/v3/branch-protection-receipt.schema.json",
      "scripts/github/verify-branch-protection.ts",
      "src/contracts/review-ledger.ts",
      "src/evaluate/sanitize.ts",
      "src/model/review-ledger.ts",
      "tests/fixtures/github/branch-protection.valid.json",
      "tests/integration/catalog-refresh-workflow.test.ts",
      "tests/integration/plugin-package-readiness.test.ts",
      "tests/integration/release-gates.test.ts",
      "tests/unit/branch-protection.test.ts",
      "tests/unit/sanitize.test.ts"
    ]) expect(correctiveSection).toContain(path);
    expect(correctiveSection).toContain('test "$ACTUAL_MAINTENANCE_PATHS" = "$EXPECTED_MAINTENANCE_PATHS"');
    expect(correctiveSection).toContain("R01_CATALOG_DATA_PATHS=(");
    expect(correctiveSection).toMatch(/fast-uri[\s\S]*3\.1\.5[\s\S]*sha512-gHwA1O9LDIcKunMKhObS\/HimwtehO1nPUECKAu5TpKgaO19fcWEl4bliWe1jWxVFvIXztJjjQ4L8XQ1EU9f7Jw==/);
    expect(correctiveSection).toMatch(/postcss[\s\S]*8\.5\.25[\s\S]*sha512-DTPx3RWSSnWyzLxQnlH0rJP\+EW5ekl16ZU4\/psbIhA0e53kJfdgaN5vKM\+xP7yJtXVu\+nfdVFmlgFDEKAe4Pyw==/);
    expect(correctiveSection).toMatch(/nanoid[\s\S]*3\.3\.18[\s\S]*sha512-DTg4MJbGMWkfi6VZFdNt2\/caMbQy4Ou\+Op\/hJQvGEWcnVfoA1QA\+xzRKAzw9jD6\+GVOOeYr\/mIcuDSdug6F6\+w==/);
    expect(correctiveSection).toMatch(/node_modules\/nanoid"\]\.dev[\s\S]*true/);
    expect(correctiveSection).toContain("npm ls fast-uri postcss nanoid");
    expect(correctiveSection).toContain("npm audit --audit-level=low");
    expect(correctiveSection).toContain("npm run check:manager-runtime");
    expect(correctiveSection).toContain("npm run check");
    expect(correctiveSection).toMatch(/clean-copy/i);
    expect(correctiveSection).toMatch(/A[^.]*public-history\/root-v1[^.]*immutable/i);
    expect(correctiveSection).toMatch(/B[^.]*registry-approved\/r01[^.]*immutable/i);
    expect(correctiveSection).toMatch(/never[^.]*rerun[^.]*bootstrap/i);
    expect(correctiveSection).not.toContain("gh workflow run public-history-bootstrap.yml");
    expect(correctiveSection).toMatch(/R01-approved catalog bytes[^.]*unchanged/i);
    expect(correctiveSection).toMatch(/protected research[^.]*unchanged/i);
    expect(correctiveSection).toMatch(/protected research surface changes[^.]*next registry-approved tag/i);
    expect(correctiveSection).not.toMatch(/release-mechanics-only/i);
    expect(correctiveSection).toMatch(/Run the gates for `CANDIDATE_SHA`[^.]*CI[^.]*branch\s+protection[^.]*semantic RC[^.]*anonymous install/is);
  });

  it("revalidates the exact source revision through a no-local single-branch transport fixture", async () => {
    const script = await readFile(join(projectRoot, "tests", "e2e", "clean-copy.sh"), "utf8");

    expect(script).toContain("set -euo pipefail");
    expect(script).toContain("mktemp -d");
    expect(script).toMatch(/trap\s+['\"]rm -rf/);
    expect(script).toContain("git init --bare");
    expect(script).toContain("git -C \"$bare_source\" fetch --no-tags");
    expect(script).toContain("git clone --no-local --single-branch --no-tags");
    expect(script).toContain("refs/tags/${governance_tag_name}:refs/tags/${governance_tag_name}");
    expect(script).not.toMatch(/git clone[^\n]*--local/);
    expect(script).toContain("rev-parse HEAD");
    expect(script).toContain("checkout --detach");
    expect(script).toContain("test -d \"${clone_dir}/.git\"");
    expect(script).toContain("npm ci");
    expect(script).toContain("npm run check");
    expect(script).toContain('[[ "${CATALOG_REFRESH_CANDIDATE:-false}" = true ]]');
    expect(script).toContain("npm run check:catalog-refresh");
    expect(script).not.toContain("research:migrate-decision-broker-v1 -- --check");
    expect(script).toContain("verify:research-append-only -- --base");
    expect(script).toContain("verify:review-ledger-append-only -- --base");
    expect(script).toContain("verify:decision-index-history -- --previous-ref \"$event_append_base\"");
    expect(script).not.toContain("DECISION_INDEX_HISTORY_BOOTSTRAP");
    expect(script).toContain("ledger_append_base=\"${LEDGER_APPEND_BASE:-$event_append_base}\"");
    expect(script).toContain("REGISTRY_APPROVAL_ANCHORED");
    expect(script).toContain("resolve-clean-copy-append-base.sh");
    expect(script).not.toContain("registry-approved/r01");
    expect(script).not.toMatch(/[0-9a-f]{40}/);
    expect(script).toContain("APPEND_BASE is required");
    expect(script).toContain("PUBLIC_ROOT_TAG_NAME");
    expect(script).toContain("PUBLIC_ROOT_TAG_OBJECT");
    expect(script).toContain("refs/tags/public-history/");
    expect(script).toContain("clean copy requires exactly one public-history root governance tag");
    expect(script).toContain("public-history root governance tag must be annotated");
    expect(script).toContain('[[ "$public_root_tag_name" =~ ^public-history/root-v[1-9][0-9]*$ ]]');
    expect(script).toContain("refs/tags/${public_root_tag_name}:refs/tags/${public_root_tag_name}");
    expect(script).toContain("verify:p03-immutable -- --baseline-ref \"$PUBLIC_ROOT_COMMIT\"");
    expect(script).toContain("generated/decision-index.json");
    expect(script).toContain("plugins/skillset-manager/data/decision-index.json");
    expect(script).toContain("claude plugin validate . --strict");
    expect(script).toContain("claude plugin validate plugins/shared-core --strict");
    expect(script).toContain("claude plugin validate plugins/skillset-manager --strict");
  });

  it("uses the authenticated public root as the first-public clean-copy baseline", async () => {
    const script = await readFile(join(projectRoot, "tests", "e2e", "clean-copy.sh"), "utf8");

    expect(script).toContain("PRE_ANCHOR_APPEND_BASE=\"$event_append_base\"");
    expect(script).toContain("ledger_append_base=\"${LEDGER_APPEND_BASE:-$event_append_base}\"");
    expect(script).toContain("verify:decision-index-history -- --previous-ref \"$event_append_base\"");
    expect(script).not.toMatch(/decision_base|p03_base/);
  });

  it("treats remote refs and pull requests as point-in-time inventory instead of durable live facts", async () => {
    const releaseGuide = await readFile(
      join(projectRoot, "docs", "release", "github-free-staged-public.md"),
      "utf8"
    );
    const inventoryStart = releaseGuide.indexOf("### 1B. Inventory the existing repository without reusing it");
    const inventoryEnd = releaseGuide.indexOf("### 1C. Approval-gated archive and new-private-repository bootstrap");

    expect(inventoryStart).toBeGreaterThan(-1);
    expect(inventoryEnd).toBeGreaterThan(inventoryStart);
    const inventory = releaseGuide.slice(inventoryStart, inventoryEnd);
    expect(inventory).toMatch(
      /Immediately\s+before\s+any\s+remote\s+mutation,[\s\S]*record\s+every\s+advertised\s+ref[\s\S]*git ls-remote --refs[\s\S]*exact\s+current\s+pull-request\s+state[\s\S]*gh pr list --state all/i
    );
    expect(inventory).toMatch(/point-in-time\s+evidence[\s\S]*must\s+not\s+be\s+restated[\s\S]*durable\s+live\s+fact/i);
    expect(inventory).toMatch(/GitHub-managed\s+pull-request\s+refs\s+such\s+as\s+`refs\/pull\/\*`[\s\S]*if\s+present[\s\S]*retain\s+old\s+private\s+history/i);
    expect(inventory).toMatch(/Whether\s+or\s+not[\s\S]*pull-request\s+ref[\s\S]*archive-and-new-empty-repository\s+design[\s\S]*required/i);
    expect(inventory).toMatch(/Do not reuse, force-replace, or delete refs/i);
    expect(inventory).not.toMatch(/refs\/pull\/\d+\/(?:head|merge)/i);
    expect(inventory).not.toMatch(/\bcurrent (?:source|repository) (?:has|contains|advertises) (?:such )?(?:a )?(?:pull-request )?ref\b/i);
  });

  it("recreates the exact private candidate tree when archived tracked paths are ignored", async () => {
    const releaseGuide = await readFile(
      join(projectRoot, "docs", "release", "github-free-staged-public.md"),
      "utf8"
    );
    const stagingFlags = releaseGuide.match(/^git -C "\$PUBLIC_DIR" add (.+)$/mu)?.[1]?.trim().split(/\s+/u);
    if (stagingFlags === undefined) throw new Error("Public-history staging command is missing");
    expect(releaseGuide).toContain('test "$(git -C "$PUBLIC_DIR" rev-parse "$A^{tree}")" = "$(git rev-parse "$PRIVATE_CANDIDATE^{tree}")"');
    expect(releaseGuide).toContain('test "$(git -C "$PUBLIC_DIR" ls-tree -r "$A")" = "$(git ls-tree -r "$PRIVATE_CANDIDATE")"');
    expect(releaseGuide).toContain('"${B}:refs/heads/main"');
    expect(releaseGuide).toContain('"refs/tags/${PUBLIC_ROOT_TAG_NAME}:refs/tags/${PUBLIC_ROOT_TAG_NAME}"');
    expect(releaseGuide).not.toContain('"$B:refs/heads/main"');
    expect(releaseGuide).not.toContain('"refs/tags/$PUBLIC_ROOT_TAG_NAME:refs/tags/$PUBLIC_ROOT_TAG_NAME"');

    const root = await realpath(await mkdtemp(join(tmpdir(), "public-history-archive-tree-")));
    const source = join(root, "source");
    const publicRoot = join(root, "public");
    const archive = join(root, "candidate.tar");
    try {
      await Promise.all([
        mkdir(join(source, ".superpowers", "sdd"), { recursive: true }),
        mkdir(publicRoot, { recursive: true })
      ]);
      await Promise.all([
        writeFile(join(source, ".gitignore"), ".superpowers/sdd/\n"),
        writeFile(join(source, "README.md"), "public candidate\n"),
        writeFile(join(source, ".superpowers", "sdd", "tracked-report.md"), "tracked but ignored\n")
      ]);
      git(source, ["init", "-q", "-b", "main"]);
      git(source, ["config", "user.name", "Public History Test"]);
      git(source, ["config", "user.email", "public-history@example.test"]);
      git(source, ["add", "-A"]);
      git(source, ["add", "-f", ".superpowers/sdd/tracked-report.md"]);
      git(source, ["commit", "-q", "-m", "private candidate"]);
      const privateCandidate = git(source, ["rev-parse", "HEAD"]);
      execFileSync("git", ["archive", "--format=tar", `--output=${archive}`, privateCandidate], {
        cwd: source,
        stdio: ["ignore", "pipe", "pipe"]
      });
      execFileSync("tar", ["-xf", archive, "-C", publicRoot], { stdio: ["ignore", "pipe", "pipe"] });

      git(publicRoot, ["init", "-q", "-b", "main"]);
      git(publicRoot, ["config", "user.name", "Public History Test"]);
      git(publicRoot, ["config", "user.email", "public-history@example.test"]);
      expect(git(publicRoot, ["check-ignore", ".superpowers/sdd/tracked-report.md"]))
        .toBe(".superpowers/sdd/tracked-report.md");
      git(publicRoot, ["add", ...stagingFlags]);
      git(publicRoot, ["commit", "-q", "-m", "public root"]);

      expect(git(publicRoot, ["rev-parse", "HEAD^{tree}"]))
        .toBe(git(source, ["rev-parse", `${privateCandidate}^{tree}`]));
      expect(git(publicRoot, ["ls-tree", "-r", "HEAD"]))
        .toBe(git(source, ["ls-tree", "-r", privateCandidate]));
      expect(git(publicRoot, ["ls-tree", "-r", "--name-only", "HEAD"]).split("\n"))
        .toHaveLength(3);
      expect(stagingFlags).toEqual(["-f", "-A"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps Korean primary documentation and GitHub Free staged-release safeguards explicit", async () => {
    const [readmeKo, readmeEn, contributing, releaseGuide, security, license] = await Promise.all([
      readFile(join(projectRoot, "README.md"), "utf8"),
      readFile(join(projectRoot, "README.en.md"), "utf8"),
      readFile(join(projectRoot, "CONTRIBUTING.md"), "utf8"),
      readFile(join(projectRoot, "docs", "release", "github-free-staged-public.md"), "utf8"),
      readFile(join(projectRoot, "SECURITY.md"), "utf8"),
      readFile(join(projectRoot, "LICENSE"), "utf8")
    ]);

    expect(readmeKo).toMatch(/\[English\]\(README\.en\.md\)/);
    expect(readmeEn).toMatch(/\[한국어\]\(README\.md\)/);
    expect(`${readmeKo}\n${readmeEn}`).toMatch(/GitHub Free/);
    expect(`${readmeKo}\n${readmeEn}`).toMatch(/공개 전환.*릴리스.*아님|public visibility.*not a release/is);
    expect(`${readmeKo}\n${readmeEn}`).toMatch(/최종 승인.*공개 전환|final approval.*public visibility/is);
    expect(`${readmeKo}\n${readmeEn}`).toMatch(/실패.*비공개.*복귀|failure.*return.*private/is);
    const orderedStages = [
      "1. Private candidate and ordinary CI",
      "2. Approved public staging",
      "3. Protected same-SHA local semantic RC",
      "4. Unauthenticated installation verification",
      "5. Release, tag, and announcement",
      "6. Rollback"
    ];
    let priorStage = -1;
    for (const stage of orderedStages) {
      const stageIndex = releaseGuide.indexOf(stage);
      expect(stageIndex, `missing or out-of-order release stage: ${stage}`).toBeGreaterThan(priorStage);
      priorStage = stageIndex;
    }
    expect(releaseGuide).toMatch(/explicit final user approval[\s\S]*change repository visibility to public/i);
    expect(releaseGuide).toMatch(/after visibility[\s\S]*successful[\s\S]*Only then[\s\S]*branch protection/i);
    expect(releaseGuide).toMatch(/exact `CANDIDATE_SHA`[\s\S]*local subscription Claude CLI/i);
    expect(releaseGuide).toMatch(/required approvals to `0`[\s\S]*do not require CODEOWNERS/i);
    expect(releaseGuide).toMatch(/humanReviewGuarantee:[\s\S]*not-guaranteed/i);
    expect(releaseGuide).toContain("repos/$REPO/private-vulnerability-reporting");
    expect(releaseGuide).toContain('test "$("${GH_API[@]}" "repos/$REPO/private-vulnerability-reporting" --jq .enabled)" = true');
    expect(releaseGuide).toContain('"required_approving_review_count": 0');
    expect(releaseGuide).toContain('{ "context": "quality", "app_id": 15368 }');
    expect(releaseGuide).toContain('{ "context": "claude-plugin-validation", "app_id": 15368 }');
    expect(releaseGuide).toMatch(/personal(?:-account)? repository[\s\S]*omit[\s\S]*bypass_pull_request_allowances/i);
    expect(releaseGuide).toMatch(/organization-owned repository[\s\S]*explicit empty[\s\S]*bypass_pull_request_allowances/i);
    expect(releaseGuide).toMatch(/whole protection[\s\S]*contexts-only[\s\S]*subresource[\s\S]*checks-only/i);
    expect(releaseGuide).toMatch(/never[\s\S]*contexts[\s\S]*checks[\s\S]*same request object/i);
    const protectionPayload = releaseGuide.match(/main-protection\.json <<'JSON'\n([\s\S]*?)\nJSON/)?.[1];
    expect(protectionPayload).toBeDefined();
    const parsedProtectionPayload = JSON.parse(protectionPayload!) as {
      required_status_checks: Record<string, unknown>;
      required_pull_request_reviews: Record<string, unknown>;
    };
    expect(parsedProtectionPayload.required_status_checks).toEqual({
      strict: true,
      contexts: ["claude-plugin-validation", "quality"]
    });
    expect(parsedProtectionPayload.required_pull_request_reviews).not.toHaveProperty("bypass_pull_request_allowances");
    const statusCheckPayload = releaseGuide.match(/status-checks\.json <<'JSON'\n([\s\S]*?)\nJSON/)?.[1];
    expect(statusCheckPayload).toBeDefined();
    expect(JSON.parse(statusCheckPayload!)).toEqual({
      strict: true,
      checks: [
        { context: "claude-plugin-validation", app_id: 15368 },
        { context: "quality", app_id: 15368 }
      ]
    });
    expect(releaseGuide).toContain('repos/$REPO/branches/main/protection/required_status_checks');
    const wholePut = releaseGuide.indexOf('"${GH_API[@]}" --method PUT "repos/$REPO/branches/main/protection"');
    const fullGet = releaseGuide.indexOf('"${GH_API[@]}" --method GET "repos/$REPO/branches/main/protection"', wholePut);
    const checksPatch = releaseGuide.indexOf('"${GH_API[@]}" --method PATCH "repos/$REPO/branches/main/protection/required_status_checks"', fullGet);
    expect(wholePut).toBeGreaterThan(-1);
    expect(fullGet).toBeGreaterThan(wholePut);
    expect(checksPatch).toBeGreaterThan(fullGet);
    expect(releaseGuide).toContain("--repository-id 1322344258");
    expect(releaseGuide).toContain('--expected-tip "$CANDIDATE_SHA"');
    expect(releaseGuide).toContain('GH_API=(gh api --hostname github.com -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2026-03-10")');
    expect((releaseGuide.match(/PUBLIC_REMOTE_URL="https:\/\/github\.com\/\$REPO\.git"/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(releaseGuide).toContain('gh run rerun "$PUSH_CI_RUN_ID" --repo "$REPO"');
    expect(releaseGuide).toContain('git ls-remote --refs "$PUBLIC_REMOTE_URL"');
    expect(releaseGuide).toContain('git ls-remote --heads --tags "$PUBLIC_REMOTE_URL"');
    expect(releaseGuide).toContain('gh pr list --repo "$REPO" --state all --limit 1000 --json number');
    expect(releaseGuide).toContain(".default_branch");
    expect(releaseGuide).toContain(".archived");
    expect(releaseGuide).toContain("protection/required_signatures");
    expect(releaseGuide).toMatch(/SIGNATURE_PROBE_BEFORE[\s\S]*404[\s\S]*--method PUT[^\n]*protection/);
    expect(releaseGuide).toMatch(/--method PUT[^\n]*protection[\s\S]*REQUIRED_SIGNATURES_AFTER[\s\S]*enabled[^\n]*false/);
    expect(releaseGuide).toMatch(/after[^.]*protection[\s\S]*required_signatures[\s\S]*enabled[\s\S]*false/i);
    expect(releaseGuide).toMatch(/requiredSignaturesEnabled[\s\S]*false/);
    expect(releaseGuide).not.toContain('--method DELETE "repos/$REPO/branches/main/protection/required_signatures"');
    const visibility = releaseGuide.indexOf('gh repo edit "github.com/$REPO" --visibility public');
    const rerun = releaseGuide.indexOf('gh run rerun "$PUSH_CI_RUN_ID" --repo "$REPO"', visibility);
    expect(visibility).toBeGreaterThan(-1);
    expect(rerun).toBeGreaterThan(visibility);
    expect(releaseGuide).toMatch(/billing[\s\S]*same push-event run attempt/i);
    expect((releaseGuide.match(/preflight_repository_state public "\$CANDIDATE_SHA"/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(releaseGuide).toMatch(/unauthenticated[\s\S]*clone[\s\S]*marketplace[\s\S]*install/i);
    for (const token of [
      'HOME="$ANON_ROOT/home"',
      'CLAUDE_CONFIG_DIR="$ANON_ROOT/claude"',
      "env -i",
      "unset GH_TOKEN GITHUB_TOKEN SSH_AUTH_SOCK GIT_ASKPASS",
      "GIT_CONFIG_PARAMETERS GIT_CONFIG_COUNT",
      "GIT_CONFIG_GLOBAL=/dev/null",
      "GIT_CONFIG_NOSYSTEM=1",
      "GIT_TERMINAL_PROMPT=0",
      "git -c credential.helper= ls-remote",
      "git -c credential.helper= clone",
      'claude plugin marketplace add "$REPO" --scope local',
      "claude plugin install skillset-manager@claude-code-skillsets --scope local",
      "claude plugin marketplace list --json",
      "claude plugin list --json",
      'skillset-manager@claude-code-skillsets" and .version == "0.1.3"',
      'shared-core@claude-code-skillsets" and .version == "0.1.0"',
      'EVIDENCE_DIR="$EVIDENCE_SANITIZED/anonymous-install-$CANDIDATE_SHA"',
      'mkdir "$EVIDENCE_DIR"',
      "set -o noclobber",
      'test ! -L "$EVIDENCE_ROOT"',
      'test ! -L "$EVIDENCE_SANITIZED"',
      'MARKETPLACE_ROOT="$(canonical_directory_below "$MARKETPLACE_LOCATION" "$ANON_ROOT")"',
      'test "$(git -C "$MARKETPLACE_ROOT" rev-parse HEAD)" = "$CANDIDATE_SHA"',
      'MANAGER_ROOT="$(canonical_directory_below "$MANAGER_INSTALL_PATH" "$ANON_ROOT/plugin-cache")"',
      'SHARED_ROOT="$(canonical_directory_below "$SHARED_INSTALL_PATH" "$ANON_ROOT/plugin-cache")"',
      'find "$expected" -name .in_use -print -quit',
      'find "$installed" -name .in_use ! -path "$installed/.in_use"',
      'test -f "$installed/.in_use"',
      'test ! -L "$installed/.in_use"',
      'diff -qr -x .in_use -- "$expected" "$installed"',
      'compare_plugin_tree "$ANON_ROOT/project/repository/plugins/skillset-manager" "$MANAGER_ROOT"',
      'compare_plugin_tree "$ANON_ROOT/project/repository/plugins/shared-core" "$SHARED_ROOT"',
      'PREVIEW="$(node "$MANAGER_ROOT/runtime.mjs" preview --request "$REQUEST")"',
      'and .status == "held"',
      'and (has("approvedExecution") | not)',
      'any(. == "decisionIndexDigest: \\($decision_digest)")',
      'any(. == "routingIndexDigest: \\($routing_digest)")'
    ]) expect(releaseGuide).toContain(token);
    expect(releaseGuide).not.toMatch(/runtime\.mjs"?\s+(?:execute|approval-object)\b/);
    expect(releaseGuide).toContain('CANDIDATE_SHA="$(jq -er \'.commitSha | select(test("^[0-9a-f]{40}$"))\' "$RECEIPT_PATH")"');
    expect((releaseGuide.match(/preflight_public_candidate/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(releaseGuide).toMatch(/Immediately before any release tag[\s\S]*preflight_public_candidate/i);
    expect(releaseGuide).toContain("rollback_identity_preflight");
    expect(releaseGuide).toContain('APPROVED_ARCHIVE_REPOSITORY_ID="1319698664"');
    expect(releaseGuide).toContain('"${GH_API[@]}" --method PATCH "repos/$REPO" --input -');
    expect(releaseGuide).toMatch(/ROLLBACK_CONFIRMED[\s\S]*visibility[\s\S]*private/i);
    expect(releaseGuide).toMatch(/After C is present on remote `main`[\s\S]*sibling C[\s\S]*prohibited[\s\S]*append-only repair plan/i);
    expect(releaseGuide).toMatch(/only after[\s\S]*(?:tag|GitHub Release)[\s\S]*announce/i);
    expect(releaseGuide).toMatch(/switch the repository back to private/i);
    expect(releaseGuide).toContain("<approved-private-candidate-sha>");
    expect(releaseGuide).toContain("public-history/root-v1");
    expect(releaseGuide).toMatch(/git archive[\s\S]*git .*init -b main[\s\S]*git .*commit.*public root/is);
    expect(releaseGuide).toMatch(/git .*commit --allow-empty[\s\S]*git .*tag -a/is);
    expect(releaseGuide).toMatch(/A=.*rev-parse HEAD[\s\S]*B=.*rev-parse HEAD[\s\S]*TAG_OBJECT=.*rev-parse/is);
    expect(releaseGuide).toContain("verify:public-history");
    expect(releaseGuide).toContain("public-history-bootstrap.yml");
    expect(releaseGuide).toContain("https://github.com/seunghyeon1004/claude-code-skillsets");
    expect(releaseGuide).toMatch(/private archive[\s\S]*new, initially empty private[\s\S]*original name/i);
    expect(releaseGuide).toMatch(/old\/archive\/new URL[\s\S]*A\/B\/tag[\s\S]*explicit approval/i);
    expect(releaseGuide).toMatch(/private archive name[\s\S]*no name collision[\s\S]*free the original name/i);
    expect(releaseGuide).toMatch(/do not copy or recreate issues[\s\S]*pull requests/i);
    expect(releaseGuide).toMatch(/no force push is permitted/i);
    expect(releaseGuide).not.toMatch(/git\s+push\s+--force/i);
    expect(releaseGuide).toMatch(/do not.*pin.*final.*SHA/i);
    expect(readmeKo).toContain("CONTRIBUTING.md");
    expect(contributing).toContain("docs/release/github-free-staged-public.md");
    expect(readmeKo).toContain("SECURITY.md");
    expect(readmeKo).toContain("Apache-2.0");
    expect(contributing).toMatch(/issue-first|issue first/i);
    expect(contributing).toMatch(/DCO|Developer Certificate of Origin/);
    expect(contributing).toMatch(/do not copy|never copy/i);
    expect(contributing).toMatch(/Korean.*English|English.*Korean/is);
    expect(contributing).toContain("npm run check");
    expect(security).toMatch(/private security advis(?:ory|ories)/i);
    expect(security).toMatch(/do not.*public issue/i);
    expect(license).toContain("Apache License");
    expect(license).toContain("Version 2.0, January 2004");
  });

  it("clears injected Git authorization configuration in the anonymous env allowlist", () => {
    const result = spawnSync("/usr/bin/env", [
      "-i",
      `PATH=${process.env.PATH ?? "/usr/bin:/bin"}`,
      "GIT_CONFIG_GLOBAL=/dev/null",
      "GIT_CONFIG_NOSYSTEM=1",
      "git",
      "config",
      "--show-origin",
      "--get-regexp",
      "^http\\."
    ], {
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "http.https://github.com/.extraHeader",
        GIT_CONFIG_VALUE_0: "Authorization: bearer injected-secret"
      }
    });

    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).not.toMatch(/authorization|injected-secret/i);
  });

  it("builds the anonymous schema-v2 request only from routing data and verifies both review-summary bindings", async () => {
    const releaseGuide = await readFile(
      join(projectRoot, "docs", "release", "github-free-staged-public.md"),
      "utf8"
    );
    const start = releaseGuide.indexOf('ANON_ROOT="$(mktemp -d');
    const end = releaseGuide.indexOf("ANONYMOUS_INSTALL\n\n", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const anonymousInstall = releaseGuide.slice(start, end);

    expect(anonymousInstall).toContain(
      'const routing = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));'
    );
    expect(anonymousInstall).not.toContain("data/decision-index.json");
    expect(anonymousInstall).not.toContain("process.argv[2]");
    expect(anonymousInstall).toContain("decisionIndexDigest: routing.decisionIndexDigest");
    expect(anonymousInstall).toContain("routingIndexDigest: routing.digest");
    expect(anonymousInstall).toContain("split(\"\\n\")");
    expect(anonymousInstall).toContain('"decisionIndexDigest: \\($decision_digest)"');
    expect(anonymousInstall).toContain('"routingIndexDigest: \\($routing_digest)"');
    expect(anonymousInstall).toMatch(/runtime[^.]*authenticates[^.]*full decision index/i);
  });

  it("keeps both READMEs aligned with the solo GitHub Free and directory-submission contracts", async () => {
    const [readmeKo, readmeEn] = await Promise.all([
      readFile(join(projectRoot, "README.md"), "utf8"),
      readFile(join(projectRoot, "README.en.md"), "utf8")
    ]);
    const readmes = [readmeKo, readmeEn];
    const waiverDisclosure = "Full exact-SHA semantic RC was not run; semantic coverage is not proven; release proceeds under an explicit owner waiver.";

    for (const readme of readmes) {
      expect(readme).not.toMatch(/BRANCH_PROTECTION_READ_TOKEN|private-rc/i);
      expect(readme).not.toMatch(/required approvals? (?:to )?`?1`?|at least one approval|최소 1(?:개|명)의 승인/i);
      expect(readme).not.toMatch(/second CODEOWNER|제2 CODEOWNER/i);
      expect(readme).toMatch(/parentless `?A`?[^.]*`?B`?|부모가 없는 `?A`?[^.]*`?B`?/i);
      expect(readme).toMatch(/new(?:, initially)? empty private repository|새 빈 비공개 저장소/i);
      expect(readme).toMatch(/private\s+vulnerability reporting|비공개 취약점 신고/i);
      expect(readme).toMatch(/pull requests?[\s\S]{0,120}approvals?[\s\S]{0,40}`?0`?|PR[^.]*승인[^.]*`?0`?/i);
      expect(readme).toMatch(/does? not require CODEOWNERS|CODEOWNERS[^.]*요구하지/i);
      expect(readme).toMatch(/GitHub Actions[\s\S]{0,100}15368/i);
      expect(readme).toMatch(/admins?[\s\S]{0,100}no bypass|관리자[\s\S]{0,100}우회[^.]*없/i);
      expect(readme).toMatch(/human review is not guaranteed|사람의 검토[^.]*보장하지/i);
      expect(readme).toMatch(/local subscription Claude CLI|로컬 구독 Claude CLI/i);
      expect(readme).toMatch(/read-only[^.]*same SHA|읽기 전용[^.]*동일한 SHA/i);
      expect(readme).toMatch(/unauthenticated[^.]*clone|인증 없이[^.]*clone/i);
      expect(readme).toMatch(/author-owned GitHub marketplace|작성자 소유 GitHub marketplace/i);
      expect(readme).toMatch(/only `?shared-core`?[^.]*directory submission candidate|`?shared-core`?만[^.]*directory 제출 후보/i);
      expect(readme).toMatch(/Claude\s+Code[^.]*`?claude-plugins-official`?|`?claude-plugins-official`?[^.]*Claude\s+Code/i);
      expect(readme).not.toMatch(/claude-community|has no application process|신청 절차가 없습니다/i);
      expect(readme).toMatch(/skillset-manager[^.]*policy hold|skillset-manager[^.]*정책[^.]*보류/i);
      expect(readme).toContain(waiverDisclosure);
      expect(readme).toMatch(/manual exact-SHA owner waiver|수동 exact-SHA owner waiver/i);
      expect(readme).toMatch(/waiver[^.]*not a pass[^.]*full[^.]*suite[^.]*not run|waiver[^.]*통과가 아니며[^.]*전체[^.]*suite[^.]*실행하지 않/i);
      expect(readme).toMatch(/does not mechanically prove historical absence[^.]*must not[^.]*hide[^.]*known semantic failure|역사적 부재[^.]*기계적으로 증명하지\s*않[^.]*알려진 semantic failure[^.]*숨/i);
    }
  });

  it("uses the local approved read-only semantic RC instead of a hosted release prerequisite", async () => {
    const [packageJson, releaseGuide, directorySubmission, script, contributing] = await Promise.all([
      readFile(join(projectRoot, "package.json"), "utf8"),
      readFile(join(projectRoot, "docs", "release", "github-free-staged-public.md"), "utf8"),
      readFile(join(projectRoot, "docs", "release", "claude-directory-submission.md"), "utf8"),
      readFile(join(projectRoot, "scripts", "release", "run-solo-semantic-rc.ts"), "utf8"),
      readFile(join(projectRoot, "CONTRIBUTING.md"), "utf8")
    ]);
    const scripts = (JSON.parse(packageJson) as { scripts: Record<string, string> }).scripts;

    expect(scripts["verify:solo-semantic-rc"]).toBe("tsx scripts/release/run-solo-semantic-rc.ts");
    expect(scripts["verify:private-rc-target"]).toBeUndefined();
    expect(script).toContain("--execute requires explicit --approved-read-only confirmation");
    expect(script).toContain("local semantic RC requires a clean working tree");
    expect(script).toContain('"setup-preview.ts"');
    expect(script).toContain('"sanitize.ts"');
    expect(script).toContain('"--verify"');
    expect(script).not.toMatch(/gh api|BRANCH_PROTECTION_READ_TOKEN|self-hosted|private-rc/i);
    expect(releaseGuide).toContain("verify:solo-semantic-rc");
    expect(releaseGuide).toContain("--approved-read-only");
    expect(releaseGuide).toMatch(/canonical `tsx`[^.]*directly[^.]*npm lifecycle/i);
    expect(releaseGuide).toMatch(/Claude executable[^.]*absolute path[^.]*SHA-256[^.]*before and after every model call/i);
    expect(releaseGuide).not.toMatch(/Claude executable shim/i);
    expect(releaseGuide).toMatch(/Keep only.*sanitized.*release evidence/is);
    expect(releaseGuide).toMatch(/manual exact-SHA owner waiver/i);
    expect(releaseGuide).toMatch(/freshly verified[^.]*protected public remote `?main`?[^.]*final SHA/i);
    expect(releaseGuide).toMatch(/subscription cost[^.]*semantic coverage[^.]*not\s+proven/i);
    expect(releaseGuide).toContain("WAIVE-FULL-SEMANTIC-RC:$SHA:SUBSCRIPTION-COST:SEMANTIC-COVERAGE-NOT-PROVEN:NO-KNOWN-SEMANTIC-FAILURE");
    expect(releaseGuide).toMatch(/manual waiver[^.]*not a pass[^.]*not[^.]*mechanically prove[^.]*historical absence/i);
    expect(releaseGuide).toMatch(/must not[^.]*delete[^.]*hide[^.]*known semantic failure/i);
    expect(releaseGuide).toMatch(/GitHub Release target SHA[^.]*must equal/i);
    expect(releaseGuide).toMatch(/release body[^.]*repository README[^.]*submission-visible description/i);
    const disclosure = "Full exact-SHA semantic RC was not run; semantic coverage is not proven; release proceeds under an explicit owner waiver.";
    const stageFiveStart = releaseGuide.indexOf("## 5. Release, tag, and announcement");
    const stageFiveEnd = releaseGuide.indexOf("## 6. Rollback", stageFiveStart);
    const stageFive = releaseGuide.slice(stageFiveStart, stageFiveEnd);
    expect(stageFive).toContain('SEMANTIC_DISPOSITION="${SEMANTIC_DISPOSITION:?set full-pass or manual-waiver}"');
    expect(stageFive).toContain('full-pass)');
    expect(stageFive).toContain('manual-waiver)');
    expect(stageFive).toContain('.schemaVersion == 6');
    expect(stageFive).toContain('.receiptType == "local-semantic-rc-target"');
    expect(stageFive).toContain('.commitSha == $sha');
    expect(stageFive).toContain('.semanticHarnessStatus == "passed"');
    expect(stageFive).toContain('npm run eval:sanitize:verify -- "$SEMANTIC_EVIDENCE_ROOT"');
    const fullPassBranch = stageFive.slice(stageFive.indexOf("  full-pass)"), stageFive.indexOf("  manual-waiver)"));
    expect(fullPassBranch).toContain("verify_full_semantic_pass");
    expect(fullPassBranch).toContain("Full exact-SHA semantic RC passed.");
    expect(fullPassBranch).not.toContain("Owner waiver:");
    expect(fullPassBranch).not.toContain(disclosure);
    const releaseBodyMaterialized = stageFive.indexOf('RELEASE_BODY_SHA256="$(shasum -a 256');
    const approvalManifestMaterialized = stageFive.indexOf('APPROVAL_MANIFEST_SHA256="$(shasum -a 256');
    const displayedMutation = stageFive.indexOf("Tag to create:");
    const approvalInstruction = stageFive.indexOf("Stop here for every disposition");
    const finalPreflight = stageFive.indexOf('FINAL_PREFLIGHT="$RELEASE_EVIDENCE/final-pre-release"');
    const releaseCreate = stageFive.indexOf('gh release create "$RELEASE_TAG" --repo "$REPO" --target "$SHA"');
    expect(releaseBodyMaterialized).toBeGreaterThan(-1);
    expect(approvalManifestMaterialized).toBeGreaterThan(releaseBodyMaterialized);
    expect(displayedMutation).toBeGreaterThan(approvalManifestMaterialized);
    expect(approvalInstruction).toBeGreaterThan(displayedMutation);
    expect(stageFive.slice(displayedMutation, approvalInstruction)).toContain('cat "$RELEASE_BODY"');
    expect(stageFive.slice(displayedMutation, approvalInstruction)).toContain('cat "$APPROVAL_MANIFEST"');
    expect(stageFive.slice(displayedMutation, approvalInstruction)).toContain('"$WAIVER"');
    for (const immutable of [
      "APPROVED_RELEASE_REPO",
      "APPROVED_RELEASE_TAG",
      "APPROVED_RELEASE_SHA",
      "APPROVED_RELEASE_TITLE",
      "APPROVED_SEMANTIC_DISPOSITION",
      "APPROVED_RELEASE_BODY_SHA256",
      "APPROVED_MANIFEST_SHA256"
    ]) {
      expect(stageFive.slice(releaseBodyMaterialized, approvalInstruction)).toContain(`readonly ${immutable}=`);
    }
    expect(stageFive).toMatch(/same approval[^.]*waiver token[^.]*tag and Release[^.]*remote mutations/i);
    expect(finalPreflight).toBeGreaterThan(approvalInstruction);
    expect(releaseCreate).toBeGreaterThan(finalPreflight);
    expect(stageFive.slice(approvalInstruction, releaseCreate)).toContain("preflight_public_candidate");
    expect(stageFive.slice(approvalInstruction, releaseCreate)).toContain("npm run verify:branch-protection --");
    expect(stageFive.slice(approvalInstruction, releaseCreate)).toContain('shasum -a 256 "$RELEASE_BODY"');
    expect(stageFive.slice(approvalInstruction, releaseCreate)).toContain('shasum -a 256 "$APPROVAL_MANIFEST"');
    const postApproval = stageFive.slice(approvalInstruction, releaseCreate);
    expect(postApproval).toContain('test "$REPO" = "$APPROVED_RELEASE_REPO"');
    expect(postApproval).toContain('test "$RELEASE_TAG" = "$APPROVED_RELEASE_TAG"');
    expect(postApproval).toContain('test "$SHA" = "$APPROVED_RELEASE_SHA"');
    expect(postApproval).toContain('test "$SHA" = "$CANDIDATE_SHA"');
    expect(postApproval).toContain('test "$RELEASE_TITLE" = "$APPROVED_RELEASE_TITLE"');
    expect(postApproval).toContain('test "$SEMANTIC_DISPOSITION" = "$APPROVED_SEMANTIC_DISPOSITION"');
    expect(postApproval).toContain('= "$APPROVED_RELEASE_BODY_SHA256"');
    expect(postApproval).toContain('= "$APPROVED_MANIFEST_SHA256"');
    for (const binding of [
      ".repository == $repository",
      ".tag == $tag",
      ".targetSha == $targetSha",
      ".title == $title",
      ".semanticDisposition == $semanticDisposition",
      ".releaseBodySha256 == $releaseBodySha256"
    ]) {
      expect(postApproval).toContain(binding);
    }
    expect(postApproval).toContain('--arg targetSha "$APPROVED_RELEASE_SHA"');
    expect(postApproval).toContain('--arg semanticDisposition "$APPROVED_SEMANTIC_DISPOSITION"');
    expect(stageFive.slice(approvalInstruction, releaseCreate)).toContain("verify_full_semantic_pass");
    expect(stageFive).toContain('--notes-file "$RELEASE_BODY"');
    expect(stageFive).toContain("jq -e --rawfile expected \"$RELEASE_BODY\" '.body == $expected'");
    expect(stageFive).toMatch(/git\/ref\/tags\/\$RELEASE_TAG[^]*\.object\.type[^]*= commit/);
    expect(stageFive).toMatch(/git\/ref\/tags\/\$RELEASE_TAG[^]*\.object\.sha[^]*= "\$SHA"/);
    expect(stageFive).toContain('git ls-remote --tags "$PUBLIC_REMOTE_URL"');
    expect(stageFive).toContain('gh pr list --repo "$REPO" --state open');
    expect(releaseGuide).toMatch(/do not call[^.]*pre-release[^.]*preflight_public_candidate/i);
    expect(releaseGuide).toMatch(/command may have succeeded[^.]*client\s+returns\s+nonzero[^.]*do\s+not\s+retry/is);
    const standalone = stageFive.slice(stageFive.indexOf('SHA="${APPROVED_RELEASE_SHA:?'));
    expect(standalone).toContain('test "$(git status --porcelain=v1)" = ""');
    expect(standalone).toContain('REPO="seunghyeon1004/claude-code-skillsets"');
    expect(standalone).toContain('RELEASE_JSON="$("${GH_API[@]}"');
    expect(standalone).toContain("npm run verify:branch-protection --");
    expect(standalone).toContain('SEMANTIC_EVIDENCE_ROOT="${SEMANTIC_EVIDENCE_ROOT:?');
    expect(standalone).toContain('npm run eval:sanitize:verify -- "$SEMANTIC_EVIDENCE_ROOT"');
    expect(standalone).toContain('$SEMANTIC_EVIDENCE_ROOT/governance/local-semantic-rc-target.json');
    expect(standalone).toContain("jq -e --rawfile expected \"$EXPECTED_BODY\" '.body == $expected'");
    expect(standalone).toContain('git ls-remote --tags "$PUBLIC_REMOTE_URL"');
    expect(stageFive).toMatch(/immediately before announcement[^.]*again immediately before directory submission/i);
    expect(contributing).toMatch(/semantic RC[^.]*passed[^.]*manual\s+exact-SHA\s+owner\s+waiver/i);
    expect(contributing).toMatch(/waiver[^.]*not a pass[^.]*historical absence[^.]*known semantic failure/i);
    expect(directorySubmission).toContain(disclosure);
    expect(directorySubmission).toMatch(/manual exact-SHA owner waiver/i);
    expect(directorySubmission).toMatch(/repository\s+README[^.]*release\s+body[^.]*submission-visible\s+description/i);
    expect(directorySubmission).toMatch(/GitHub Release `v0\.1\.0`[^.]*lightweight tag[^.]*exact body[^.]*protected `main`[^.]*same approved SHA/i);
    expect(directorySubmission).toMatch(/standalone post-release inventory[^.]*freshly[^.]*immediately before/i);
    expect(releaseGuide).toContain(disclosure);
  });

  it("isolates the zero-base first-public bootstrap in an exact-metadata manual workflow", async () => {
    const [workflow, packageJson] = await Promise.all([
      readFile(join(projectRoot, ".github", "workflows", "public-history-bootstrap.yml"), "utf8"),
      readFile(join(projectRoot, "package.json"), "utf8")
    ]);
    const scripts = (JSON.parse(packageJson) as { scripts: Record<string, string> }).scripts;

    expect(workflow).toMatch(/^name:\s*First Public History Bootstrap/m);
    expect(workflow).toMatch(/on:\s*\n\s+workflow_dispatch:/);
    expect(workflow).not.toMatch(/pull_request:|push:/);
    for (const input of ["root_commit", "tip_commit", "tag_name", "tag_object"]) {
      expect(workflow).toMatch(new RegExp(`${input}:[\\s\\S]{0,120}required:\\s*true`));
    }
    expect(workflow).toContain("actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1");
    expect(workflow).toContain("actions/setup-node@820762786026740c76f36085b0efc47a31fe5020");
    expect(workflow).toMatch(/fetch-depth:\s*2/);
    expect(workflow).toMatch(/ref:\s*main/);
    expect(workflow).toMatch(/persist-credentials:\s*false/);
    expect(workflow.indexOf("Validate bootstrap input syntax")).toBeLessThan(
      workflow.indexOf("Fetch only the approved governance tag")
    );
    expect(workflow).toContain('[[ "$PUBLIC_ROOT_COMMIT" =~ ^[0-9a-f]{40,64}$ ]]');
    expect(workflow).toContain('[[ "$PUBLIC_ROOT_TAG_NAME" =~ ^public-history/root-v[1-9][0-9]*$ ]]');
    expect(workflow).toContain('test "$GITHUB_REF" = refs/heads/main');
    expect(workflow).toContain("git fetch --no-tags origin \"refs/tags/${PUBLIC_ROOT_TAG_NAME}:refs/tags/${PUBLIC_ROOT_TAG_NAME}\"");
    expect((workflow.match(/GH_TOKEN:\s*\$\{\{ github\.token \}\}/g) ?? [])).toHaveLength(2);
    expect((workflow.match(/GIT_CONFIG_COUNT=1/g) ?? [])).toHaveLength(3);
    expect(workflow).toContain("GIT_CONFIG_KEY_0=http.extraHeader");
    expect(workflow).toContain('test "$(git rev-parse --is-shallow-repository)" = true');
    expect(workflow).toContain("git fetch --unshallow --no-tags origin refs/heads/main");
    expect(workflow.indexOf("git fetch --unshallow --no-tags origin refs/heads/main")).toBeLessThan(
      workflow.indexOf('git fetch --no-tags origin "refs/tags/${PUBLIC_ROOT_TAG_NAME}:refs/tags/${PUBLIC_ROOT_TAG_NAME}"')
    );
    expect(workflow).not.toMatch(/(?:echo|printenv)\b[^\n]*GH_TOKEN/);
    expect(workflow).toContain("EVENT_NAME: workflow_dispatch");
    expect(workflow).toContain('PUSH_BEFORE: "0000000000000000000000000000000000000000"');
    expect(workflow).toContain("npm exec -- tsx scripts/research/resolve-ci-approval-context.ts");
    expect(workflow).not.toMatch(/\$\(tsx scripts\/research\/resolve-ci-approval-context\.ts\)/);
    expect(workflow).not.toMatch(/^\s+GITHUB_REF:/m);
    expect(workflow).toContain("PUBLIC_ROOT_COMMIT: ${{ inputs.root_commit }}");
    expect(workflow).toContain("PUBLIC_TIP_COMMIT: ${{ inputs.tip_commit }}");
    expect(workflow).toContain("PUBLIC_ROOT_TAG_NAME: ${{ inputs.tag_name }}");
    expect(workflow).toContain("PUBLIC_ROOT_TAG_OBJECT: ${{ inputs.tag_object }}");
    expect(workflow).toContain("verify:research-append-only -- --base \"$PUBLIC_ROOT_COMMIT\"");
    expect(workflow).toContain("verify:review-ledger-append-only -- --base \"$PUBLIC_ROOT_COMMIT\"");
    expect(workflow).toContain("verify:decision-index-history -- --previous-ref \"$PUBLIC_ROOT_COMMIT\"");
    expect(workflow).toContain("verify:p03-immutable -- --baseline-ref \"$PUBLIC_ROOT_COMMIT\"");
    expect(workflow).toContain("npm run verify:public-history --");
    expect(workflow).toContain("bash tests/e2e/clean-copy.sh");
    expect(workflow).not.toMatch(/git\s+push|git\s+tag|gh\s+repo|visibility/i);
    expect(scripts["verify:public-history"]).toBe("tsx scripts/release/verify-public-history.ts");
  });

  it("projects schema-v3 solo branch protection receipts with the no-human-review disclosure", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "branch-protection-sanitizer-")));
    const source = join(root, "raw");
    const destination = join(root, "sanitized");
    try {
      await mkdir(source);
      await writeFile(join(source, "branch-protection.json"), JSON.stringify({
        schemaVersion: 3,
        repository: "seunghyeon1004/claude-code-skillsets",
        repositoryId: 1322344258,
        repositoryOwnerLogin: "seunghyeon1004",
        repositoryOwnerType: "User",
        commitSha: "f".repeat(40),
        branch: "main",
        observedAt: "2026-07-29T00:00:00Z",
        directPushesDisabled: true,
        forcePushesDisabled: true,
        deletionsDisabled: true,
        requiredSignaturesEnabled: false,
        requiredChecks: requiredCheckBindings(),
        minimumApprovals: 0,
        dismissesStaleReviews: true,
        requiresCodeOwnerReview: false,
        governanceMode: "solo-maintainer",
        humanReviewGuarantee: "not-guaranteed",
        actor: { login: "private-maintainer" },
        headers: { authorization: "Bearer secret-value" }
      }));
      await sanitizeReceiptTree(source, destination);

      const output = await readFile(join(destination, "branch-protection.json"), "utf8");
      expect(JSON.parse(output)).toEqual({
        schemaVersion: 3,
        receiptType: "branch-protection",
        repositoryId: 1322344258,
        repositoryOwnerType: "User",
        commitSha: "f".repeat(40),
        directPushesDisabled: true,
        forcePushesDisabled: true,
        deletionsDisabled: true,
        requiredSignaturesEnabled: false,
        requiredChecks: requiredCheckBindings(),
        minimumApprovals: 0,
        dismissesStaleReviews: true,
        requiresCodeOwnerReview: false,
        governanceMode: "solo-maintainer",
        humanReviewGuarantee: "not-guaranteed"
      });
      expect(JSON.parse(output)).not.toHaveProperty("repositoryOwnerLogin");
      expect(output).not.toMatch(/private-maintainer|secret-value|authorization/i);
      await expect(verifySanitizedReceiptTree(destination)).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps the branch-protection fixture explicitly non-live", async () => {
    const fixture = JSON.parse(await readFile(
      join(projectRoot, "tests", "fixtures", "github", "branch-protection.valid.json"),
      "utf8"
    )) as { fixture: string; expectedRepositoryId: number; expectedTip: string; repository: unknown; protection: unknown };

    expect(fixture.fixture).toBe("non-live local test fixture");
    const repositoryMetadata = repositoryMetadataFromGitHubResponse({
      expectedRepository: "example/private-broker",
      expectedRepositoryId: fixture.expectedRepositoryId,
      response: fixture.repository
    });
    expect(verifyGitHubProtectionResponse({
      repository: "example/private-broker",
      repositoryMetadata,
      expectedTip: fixture.expectedTip,
      branch: "main",
      observedAt: "2026-07-29T00:00:00Z",
      protection: fixture.protection
    })).toMatchObject({
      repositoryId: 101,
      repositoryOwnerLogin: "example",
      repositoryOwnerType: "User",
      commitSha: fixture.expectedTip,
      directPushesDisabled: true,
      forcePushesDisabled: true,
      deletionsDisabled: true,
      requiredSignaturesEnabled: false,
      requiredChecks: requiredCheckBindings(),
      minimumApprovals: 0,
      dismissesStaleReviews: true,
      requiresCodeOwnerReview: false,
      governanceMode: "solo-maintainer",
      humanReviewGuarantee: "not-guaranteed"
    });
  });
});

function markdownSection(content: string, heading: string): string {
  const start = content.indexOf(heading);
  expect(start, `missing ${heading}`).toBeGreaterThanOrEqual(0);
  const next = content.indexOf("\n## ", start + heading.length);
  return content.slice(start, next === -1 ? content.length : next);
}

function futureHeldReview(): ReviewLedgerEvent {
  const event: ReviewLedgerEvent = {
    sequence: 1,
    id: "future-source-held",
    previousEventHash: null,
    target: { sourceId: "anthropic-plugins-official", skillPath: null },
    disposition: "held",
    supersedes: null,
    baseline: {
      snapshotId: "2026-07-23-anthropic-plugins-official",
      inspectedCommit: "e3e378cbbb205673a5d7254ded32679cafa6179d",
      contentSha256: "a".repeat(64),
      pathBlobSha: null,
      inheritedEvidenceDigest: "b".repeat(64)
    },
    reasonCode: "future-review-update",
    reason: { ko: "future review update", en: "future review update" },
    reviewedSensitiveFields: {
      license: unknownField(), permissions: unknownField(), ownership: unknownField(),
      trust: unknownField(), dependencies: unknownField(), executableSurface: unknownField()
    },
    runtimeEvidence: [{ runtime: "claude-code", compatibility: "unknown", evidenceIds: ["future-review-update"] }],
    reviewerId: "seunghyeon1004",
    reviewedAt: "2026-08-01T00:00:00Z",
    expiresAt: "2026-09-01T00:00:00Z",
    eventHash: ""
  };
  return { ...event, eventHash: hashReviewEvent(event) };
}

function unknownField() {
  return { status: "unknown" as const, evidence: [] };
}

function ledgerEvent(overrides: Partial<ReviewLedgerEvent> = {}): ReviewLedgerEvent {
  const event: ReviewLedgerEvent = {
    ...futureHeldReview(),
    sequence: 1,
    id: "ledger-event",
    previousEventHash: null,
    target: { sourceId: "source-a", skillPath: "skills/example/SKILL.md" },
    disposition: "held",
    supersedes: null,
    reviewerId: "seunghyeon1004",
    reviewedAt: "2026-07-29T00:00:00Z",
    expiresAt: "2026-08-29T00:00:00Z",
    eventHash: "",
    ...overrides
  };
  return { ...event, eventHash: hashReviewEvent(event) };
}

function runRegistryAnchor(root: string, state: string, object: string, argumentsList: string[] = []): string {
  return execFileSync(
    "bash",
    [join(projectRoot, "scripts", "research", "require-registry-anchor-input.sh"), ...argumentsList],
    {
      cwd: root,
      env: {
        ...process.env,
        REGISTRY_APPROVAL_MODE: "current-tip",
        REGISTRY_APPROVAL_ANCHORED: state,
        APPROVED_REGISTRY_TAG_OBJECT: object
      },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }
  ).trim();
}

function resolveCleanCopyBase(
  root: string,
  state: string,
  object: string,
  preAnchorBase: string,
  extraEnv: Record<string, string> = {}
): string {
  return execFileSync("bash", [join(projectRoot, "scripts", "research", "resolve-clean-copy-append-base.sh")], {
    cwd: root,
    env: {
      ...process.env,
      REGISTRY_APPROVAL_MODE: "current-tip",
      REGISTRY_APPROVAL_ANCHORED: state,
      APPROVED_REGISTRY_TAG_OBJECT: object,
      PRE_ANCHOR_APPEND_BASE: preAnchorBase,
      ...extraEnv
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

async function createRegistryCiFixture(root: string): Promise<{
  rootObject: string;
  rootTarget: string;
  latestObject: string;
  eventBase: string;
  batchHead: string;
  initialLedgerHash: string;
}> {
  git(root, ["init", "-q"]);
  git(root, ["config", "user.name", "Registry CI Test"]);
  git(root, ["config", "user.email", "registry-ci-test@example.test"]);
  await mkdir(join(root, "research", "evidence", "artifacts"), { recursive: true });
  await mkdir(join(root, "manifests"), { recursive: true });
  await writeFile(
    join(root, "manifests", "decision-candidate-evidence.yaml"),
    "schemaVersion: 3\ncandidates: []\nevidence: []\n"
  );
  const context = { schemaVersion: 2, asOf: "2026-07-23T00:00:00Z", privateRcAt: null, upstreamObservations: [] };
  await writeJsonFixture(root, "research/evaluation-context.json", context);
  await writeJsonFixture(root, "research/current-evaluation-context.json", context);
  await writeJsonFixture(root, "research/review-source-extensions.json", { schemaVersion: 2, triads: [] });
  await writeJsonFixture(root, "research/evidence/issued.json", {
    id: "issued",
    artifactPath: "research/evidence/artifacts/issued.txt"
  });
  await writeFile(join(root, "research", "evidence", "artifacts", "issued.txt"), "issued\n");
  const initialLedger = ledgerEvent({
    id: "initial-ledger",
    target: { sourceId: "source-a", skillPath: "skills/base/SKILL.md" },
    reviewedAt: "2026-07-29T00:00:00Z",
    expiresAt: "2026-08-29T00:00:00Z"
  });
  await writeFile(join(root, "research", "review-ledger.jsonl"), serializeReviewLedgerJsonl([initialLedger]));
  await writeJsonFixture(root, "governance/reviewers.json", {
    schemaVersion: 3,
    reviewers: [{ id: "seunghyeon1004", roles: ["maintainer", "security-reviewer"] }]
  });
  commitFixture(root, "registry root");
  git(root, ["tag", "-a", "registry-approved/r01", "-m", "root anchor"]);
  const rootObject = git(root, ["rev-parse", "registry-approved/r01"]);
  const rootTarget = git(root, ["rev-parse", "HEAD"]);

  await mkdir(join(root, "notes"));
  await writeFile(join(root, "notes", "ordinary-before-batch.txt"), "ordinary code only\n");
  const eventBase = commitFixture(root, "ordinary predecessor descendant");

  await writeJsonFixture(root, "research/review-source-extensions.json", {
    schemaVersion: 2,
    triads: [{ sourceId: "source-a", receiptId: "receipt-a", snapshotId: "snapshot-a" }]
  });
  await writeJsonFixture(root, "research/sources/source-a.json", { sourceId: "source-a" });
  await writeJsonFixture(root, "research/receipts/receipt-a.json", {
    id: "receipt-a",
    sourceId: "source-a",
    snapshotId: "snapshot-a"
  });
  await writeJsonFixture(root, "research/snapshots/snapshot-a.json", { id: "snapshot-a" });
  const batchHead = commitFixture(root, "reviewed research batch");
  git(root, [
    "tag", "-a", "registry-approved/research-0001", "-m", [
      "sequence: 1",
      "previous-tag: registry-approved/r01",
      `previous-tag-object: ${rootObject}`,
      `batch-head: ${batchHead}`
    ].join("\n")
  ]);
  return {
    rootObject,
    rootTarget,
    latestObject: git(root, ["rev-parse", "registry-approved/research-0001"]),
    eventBase,
    batchHead,
    initialLedgerHash: initialLedger.eventHash
  };
}

function resolveCiApprovalContext(root: string, base: string): { base: string; mode: string } {
  const tsx = join(projectRoot, "node_modules", ".bin", "tsx");
  const output = execFileSync(
    tsx,
    [join(projectRoot, "scripts", "research", "resolve-ci-approval-context.ts")],
    {
      cwd: root,
      env: {
        ...process.env,
        EVENT_NAME: "pull_request",
        PR_BASE_SHA: base,
        PUSH_BEFORE: ""
      },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  const values = new Map(output.trim().split("\n").map((line) => line.split("=", 2) as [string, string]));
  const resolvedBase = values.get("base");
  const mode = values.get("mode");
  if (resolvedBase !== base || (mode !== "current-tip" && mode !== "changed-batch")) {
    throw new Error("invalid CI registry approval context");
  }
  return { base: resolvedBase, mode };
}

function runQualityRegistryGate(root: string, base: string, approvedObject: string): string {
  const context = resolveCiApprovalContext(root, base);
  const argumentsList = [
    join(projectRoot, "scripts", "research", "require-registry-anchor-input.sh"),
    "--mode", context.mode
  ];
  if (context.mode === "changed-batch") argumentsList.push("--base", context.base);
  execFileSync("bash", argumentsList, {
    cwd: root,
    env: {
      ...process.env,
      REGISTRY_APPROVAL_ANCHORED: "anchored",
      APPROVED_REGISTRY_TAG_OBJECT: approvedObject
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const prior = process.env.APPROVED_REGISTRY_TAG_OBJECT;
  process.env.APPROVED_REGISTRY_TAG_OBJECT = approvedObject;
  try {
    assertExtensionAppendOnly({ root, base: context.base });
    runReviewLedgerVerifier(root, context.base);
  } finally {
    if (prior === undefined) delete process.env.APPROVED_REGISTRY_TAG_OBJECT;
    else process.env.APPROVED_REGISTRY_TAG_OBJECT = prior;
  }
  return context.mode;
}

function runPluginCleanCopyRegistryGate(
  root: string,
  base: string,
  approvedObject: string
): { mode: string; appendBase: string } {
  const context = resolveCiApprovalContext(root, base);
  const appendBase = resolveCleanCopyBase(root, "anchored", approvedObject, "", {
    REGISTRY_APPROVAL_MODE: context.mode,
    APPEND_BASE: context.base
  });
  const prior = process.env.APPROVED_REGISTRY_TAG_OBJECT;
  process.env.APPROVED_REGISTRY_TAG_OBJECT = approvedObject;
  try {
    assertExtensionAppendOnly({ root, base: appendBase });
    runReviewLedgerVerifier(root, context.base);
  } finally {
    if (prior === undefined) delete process.env.APPROVED_REGISTRY_TAG_OBJECT;
    else process.env.APPROVED_REGISTRY_TAG_OBJECT = prior;
  }
  return { mode: context.mode, appendBase };
}

function runReviewLedgerVerifier(root: string, base: string): void {
  execFileSync(
    join(projectRoot, "node_modules", ".bin", "tsx"),
    [join(projectRoot, "scripts", "research", "assert-review-ledger-append-only.ts"), "--base", base],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"] }
  );
}

async function writeJsonFixture(root: string, path: string, value: unknown): Promise<void> {
  await mkdir(join(root, path, ".."), { recursive: true });
  await writeFile(join(root, path), `${JSON.stringify(value)}\n`);
}

function commitFixture(root: string, message: string): string {
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", message]);
  return git(root, ["rev-parse", "HEAD"]);
}

function git(root: string, argumentsList: string[]): string {
  return execFileSync("git", argumentsList, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}
