import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

describe("catalog refresh workflow policy", () => {
  it("keeps the workflow PR-only", async () => {
    const [workflow, runner, refresh] = await Promise.all([
      readFile(join(projectRoot, ".github", "workflows", "catalog-refresh.yml"), "utf8"),
      readFile(join(projectRoot, "scripts", "research", "refresh-catalog.ts"), "utf8"),
      readFile(join(projectRoot, "src", "research", "refresh.ts"), "utf8")
    ]);

    expect(workflow).toContain('cron: "17 0 * * 1"');
    expect(workflow).toMatch(/^\s{2}workflow_dispatch:\s*\n\s{4}inputs:\s*\n\s{6}expected_tip:/m);
    expect(workflow).toMatch(/expected_tip:[\s\S]{0,160}required:\s*true[\s\S]{0,80}type:\s*string/);
    expect(workflow).not.toMatch(/gh pr merge|git push[^\n]*--force(?!-with-lease)|claude plugin|skill-installer/i);
    expect(workflow).toMatch(/^permissions:\s*\{\}\s*$/m);
    expect(workflow).toMatch(/validate:\n\s+runs-on:[^]*?permissions:\n\s+contents: read/u);
    expect(workflow).toMatch(/publish:\n\s+needs: validate/u);
    expect(workflow).toMatch(/concurrency:\n\s+group:\s+catalog-refresh\n\s+cancel-in-progress:\s+false\n/m);
    expect(workflow).toContain("CATALOG_REFRESH_ENABLED: ${{ vars.CATALOG_REFRESH_ENABLED }}");
    expect(workflow).toContain('test "$CATALOG_REFRESH_ENABLED" = enabled');
    expect(workflow.indexOf("Require separately enabled catalog maintenance")).toBeLessThan(
      workflow.indexOf("Validate the event-bound catalog base")
    );
    expect(workflow.indexOf("Require separately enabled catalog maintenance")).toBeLessThan(
      workflow.indexOf("actions/checkout@")
    );
    expect(workflow.indexOf("Require separately enabled catalog maintenance")).toBeLessThan(
      workflow.indexOf("npm run research:refresh")
    );
    expect(workflow).toContain("automation/catalog-refresh-<baseDigest8>-${{ github.run_id }}");
    expect(workflow).toContain("REGISTRY_APPROVAL_ANCHORED: ${{ vars.REGISTRY_APPROVAL_ANCHORED }}");
    expect(workflow).toContain("APPROVED_REGISTRY_TAG_OBJECT: ${{ secrets.APPROVED_REGISTRY_TAG_OBJECT }}");
    expect(workflow).toContain("Verify the approved registry anchor before collection");
    expect(workflow).toContain("require-registry-anchor-input.sh --mode current-tip");
    expect(workflow).not.toMatch(/rev-parse[^\n]*registry-approved|for-each-ref[^\n]*registry-approved/);
    const preCheckout = workflow.slice(workflow.indexOf("    steps:"), workflow.indexOf("actions/checkout@"));
    expect(preCheckout).toContain("Validate the event-bound catalog base");
    expect(preCheckout).toContain("EVENT_NAME: ${{ github.event_name }}");
    expect(preCheckout).toContain("EXPECTED_TIP: ${{ inputs.expected_tip }}");
    expect(preCheckout).toContain('[[ "$EXPECTED_TIP" =~ ^[0-9a-f]{40}$ ]]');
    expect(preCheckout).toContain('test "$GITHUB_REF" = refs/heads/main');
    expect(preCheckout).toContain('test "$GITHUB_SHA" = "$EXPECTED_TIP"');
    expect(preCheckout).toMatch(/schedule\)[\s\S]*test -z "\$\{EXPECTED_TIP:-\}"/);
    expect(workflow).toContain("ref: ${{ github.event_name == 'workflow_dispatch' && inputs.expected_tip || 'main' }}");
    const postCheckout = workflow.slice(workflow.indexOf("actions/checkout@"), workflow.indexOf("Set up Node.js"));
    expect(postCheckout).toContain("Verify the checked-out event commit");
    expect(postCheckout).toContain('HEAD_SHA="$(git rev-parse --verify HEAD^{commit})"');
    expect(postCheckout).toContain('test "$HEAD_SHA" = "$GITHUB_SHA"');
    expect(postCheckout).toContain('test "$HEAD_SHA" = "$EXPECTED_TIP"');
    expect((workflow.match(/test -z "\$\{EXPECTED_TIP:-\}"/g) ?? [])).toHaveLength(2);
    expect(workflow).toContain('test "$(git rev-parse HEAD)" = "$base_sha"');
    const publishStep = workflow.slice(workflow.indexOf("Push validated branch and open review PR"));
    expect(publishStep).toContain("require_live_main_at_base()");
    expect(publishStep).toContain('repos/${GITHUB_REPOSITORY}/git/ref/heads/main');
    expect(publishStep).toContain('[[ ! "$live_main_sha" =~ ^[0-9a-f]{40}$ ]]');
    expect(publishStep).toContain('if test "$live_main_sha" != "$base_sha"; then');
    expect((publishStep.match(/require_live_main_at_base/g) ?? [])).toHaveLength(3);
    const creationPush = 'git push --force-with-lease=refs/heads/$branch: origin "$candidate_ref:refs/heads/$branch"';
    expect(publishStep.indexOf("require_live_main_at_base\n")).toBeLessThan(
      publishStep.indexOf(creationPush)
    );
    expect(publishStep.indexOf(creationPush)).toBeLessThan(
      publishStep.lastIndexOf("require_live_main_at_base")
    );
    expect(publishStep).toContain("cleanup_failed_publish()");
    expect(publishStep).toContain("inventory_candidate_branch()");
    expect(publishStep).toContain('repos/${GITHUB_REPOSITORY}/git/matching-refs/heads/${branch}');
    expect(publishStep).toContain('select(.ref == $expected_ref)');
    expect(publishStep).toContain("branch_push_attempted=false");
    expect(publishStep).toContain("branch_push_attempted=true");
    expect(publishStep.indexOf("branch_push_attempted=true")).toBeLessThan(
      publishStep.indexOf(creationPush)
    );
    expect(publishStep).toContain('git push --force-with-lease=refs/heads/$branch:$candidate_sha origin ":refs/heads/$branch"');
    expect(publishStep).toMatch(/trap cleanup_failed_publish EXIT[\s\S]*git push --force-with-lease=refs\/heads\/\$branch: origin "\$candidate_ref:refs\/heads\/\$branch"/);
    expect(publishStep).toContain(creationPush);
    expect(publishStep).toContain("existing_matches");
    expect(publishStep).toContain(".base.sha // empty");
    expect(publishStep).toContain(".head.sha // empty");
    expect(publishStep).toContain('test "$existing_base_sha" = "$base_sha"');
    expect(publishStep).toContain('test "$existing_head_sha" = "$candidate_sha"');
    expect(publishStep).not.toMatch(/head -n 1/);
    expect(publishStep).toContain('gh api --method POST "repos/${GITHUB_REPOSITORY}/pulls"');
    expect(publishStep).toContain("inventory_candidate_prs()");
    expect(publishStep).toContain('[[ "$GITHUB_REPOSITORY_ID" =~ ^[1-9][0-9]*$ ]]');
    expect(publishStep).toContain("ascii_downcase");
    expect(publishStep).toContain(".head.repo.full_name");
    expect(publishStep).toContain(".base.repo.full_name");
    expect(publishStep).toContain(".head.repo.id");
    expect(publishStep).toContain(".base.repo.id");
    expect(publishStep).toContain('.head.ref == $expected_branch');
    expect(publishStep).toContain('.base.ref == "main"');
    expect(publishStep).toMatch(/foreign repository identity[^\n]*operator review/i);
    expect(publishStep).toContain("pr_post_attempted=false");
    expect(publishStep).toContain("pr_post_attempted=true");
    expect(publishStep).toContain('.body == $expected_body');
    expect(publishStep).toContain('.head.sha == $expected_head');
    expect(publishStep).toContain('.head.ref == $expected_branch');
    expect(publishStep.indexOf("pr_post_attempted=true")).toBeLessThan(
      publishStep.indexOf('gh api --method POST "repos/${GITHUB_REPOSITORY}/pulls"')
    );
    expect(publishStep).toMatch(/multiple[^\n]*candidate PR[^\n]*operator review/i);
    expect(publishStep).toMatch(/operator inventory required/i);
    expect(publishStep).not.toContain("gh pr create");
    expect(publishStep).toContain("pr_base_sha");
    expect(publishStep).toContain("pr_head_sha");
    expect(publishStep).toContain("pr_head_ref");
    expect(publishStep).toContain("pr_base_ref");
    expect(publishStep).toContain("require_same_repository_identity");
    expect(publishStep).toContain(".base.sha // empty");
    expect(publishStep).toContain(".head.sha // empty");
    expect(publishStep).toContain('test "$pr_base_sha" = "$base_sha"');
    expect(publishStep).toContain('test "$pr_head_sha" = "$candidate_sha"');
    expect(publishStep).toMatch(
      /gh api --method PATCH "repos\/\$\{GITHUB_REPOSITORY\}\/pulls\/\$\{pr_number\}"[\s\\]*-f state=closed/
    );
    expect(publishStep).toContain('if test "$candidate_line" != "$candidate_sha $base_sha"; then');
    expect(refresh).toContain("automation/catalog-refresh-${baseCatalogDigest.slice(0, 8)}-${githubRunId}");
  });

  it("uses only full-SHA actions and no automatic publication trigger", async () => {
    const [workflow, runner] = await Promise.all([
      readFile(join(projectRoot, ".github", "workflows", "catalog-refresh.yml"), "utf8"),
      readFile(join(projectRoot, "scripts", "research", "refresh-catalog.ts"), "utf8")
    ]);

    expect(workflow).not.toMatch(/^\s+(?:push|pull_request):/m);
    const actionRefs = [...workflow.matchAll(/^\s+uses:\s+[^@\s]+@([^\s#]+)/gm)].map((match) => match[1]!);
    expect(actionRefs).not.toHaveLength(0);
    expect(actionRefs.every((ref) => /^[a-f0-9]{40}$/u.test(ref))).toBe(true);
    expect(runner).toMatch(/"npm", \["run", "check"\]/);
    expect(runner).toContain('"pre-approval-candidate"');
    expect(runner).toContain('"verify:research-append-only"');
    expect(runner).toContain('"verify:review-ledger-append-only"');
    expect(runner).toContain('"scripts/research/require-registry-anchor-input.sh"');
    expect(runner).toMatch(/"npm", \["run", "verify:broker-only"\]/);
    expect(runner).toMatch(/"bash", \["tests\/e2e\/clean-copy\.sh"\]/);
    expect(runner).toContain('"git", ["bundle", "create"');
    expect(runner).not.toMatch(/"gh"|"push"/u);
    expect(runner).toContain("new GitCliTransport(source.repository, runSanitizedGit)");
    expect(runner).toMatch(/delete environment\.GH_TOKEN;[^]*delete environment\.GITHUB_TOKEN;/u);
    expect(runner).toContain("research/observation-evidence");
    expect(runner).toContain("generated/decision-index.json");
    expect(workflow).toMatch(/identical open PR no-op receipt/i);
  });

  it("documents the exact post-bootstrap r01 and installed catalog delivery order", async () => {
    const [runbook, packageJson] = await Promise.all([
      readFile(join(projectRoot, "docs", "release", "github-free-staged-public.md"), "utf8"),
      readFile(join(projectRoot, "package.json"), "utf8")
    ]);
    const scripts = (JSON.parse(packageJson) as { scripts: Record<string, string> }).scripts;

    expect(runbook).toMatch(/registry-approved\/r01[\s\S]*exact(?:ly)? `?B`?/i);
    expect(runbook).toMatch(
      /verify[\s\S]*annotated tag[\s\S]*configure `REGISTRY_APPROVAL_ANCHORED`[\s\S]*`APPROVED_REGISTRY_TAG_OBJECT`[\s\S]*current-tip CI[\s\S]*public staging/i
    );
    expect(runbook).toContain('gh workflow run catalog-refresh.yml --ref main -f expected_tip="$B"');
    expect(runbook).toContain("CATALOG_REFRESH_ENABLED");
    expect(runbook).toContain("claude plugin marketplace update claude-code-skillsets");
    expect(runbook).toContain("claude plugin update skillset-manager@claude-code-skillsets --scope user");
    expect(runbook).toContain("/reload-plugins");
    expect(runbook).toMatch(/0\.1\.0[\s\S]*private-only/i);
    expect(runbook).toContain("research/official-marketplace-review-backlog.json");
    expect(runbook).toContain(".observed.candidateIdentity");
    expect(runbook).toMatch(/human comparison[\s\S]*never an automatic approval input/i);
    expect(scripts["research:approve-official-marketplace"])
      .toBe("tsx scripts/research/approve-official-marketplace.ts");
    expect(runbook).toContain("npm run research:approve-official-marketplace --");
    const reviewSection = runbook.slice(
      runbook.indexOf("### 1E. Review candidate additions"),
      runbook.indexOf("## 2. Approved public staging")
    );
    expect(reviewSection).toMatch(
      /approval[\s\S]*materializ[\s\S]*generat[\s\S]*history[\s\S]*version[\s\S]*deterministic approval-local verification[\s\S]*commit the resulting tree[\s\S]*full local gates[\s\S]*append-only gates[\s\S]*transport-like clean-copy verification[\s\S]*exact commit/i
    );
    expect(reviewSection).not.toMatch(/runs? the full check/i);
  });
});
