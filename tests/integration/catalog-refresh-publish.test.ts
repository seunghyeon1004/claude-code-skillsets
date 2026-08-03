import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("catalog refresh publish workflow", () => {
  it("imports only the verified candidate into the checkout before pushing its exact branch", async () => {
    const harness = await createPublishHarness();

    await expect(git(harness.workspace, ["cat-file", "-e", `${harness.candidateSha}^{commit}`]))
      .rejects.toThrow();
    await runPublishStep(harness);

    expect(await git(harness.remote, ["rev-parse", `refs/heads/${harness.branch}`])).toBe(harness.candidateSha);
    expect(await git(harness.workspace, ["for-each-ref", "--format=%(refname)", "refs/catalog-refresh/publish"])).toBe("");
    await expect(git(harness.workspace, ["show-ref", "--verify", "refs/heads/unrelated-bundle-ref"]))
      .rejects.toThrow();
    await expect(git(harness.remote, ["show-ref", "--verify", "refs/heads/unrelated-bundle-ref"]))
      .rejects.toThrow();
    const ghLog = await readFile(harness.ghLog, "utf8");
    expect(ghLog.match(/git\/ref\/heads\/main/g)).toHaveLength(2);
    expect(ghLog).toMatch(/--method POST[^\n]*pulls/);
  });

  it("deletes the exact pushed candidate when live main drifts before PR creation", async () => {
    const harness = await createPublishHarness({ publishMode: "drift-after-push" });

    await expect(runPublishStep(harness)).rejects.toThrow(/live main moved/i);
    await expect(git(harness.remote, ["show-ref", "--verify", `refs/heads/${harness.branch}`]))
      .rejects.toThrow();
    expect(await git(harness.workspace, ["for-each-ref", "--format=%(refname)", "refs/catalog-refresh/publish"])).toBe("");
    const ghLog = await readFile(harness.ghLog, "utf8");
    expect(ghLog.match(/git\/ref\/heads\/main/g)).toHaveLength(2);
    expect(ghLog).not.toMatch(/--method POST[^\n]*pulls/);
  });

  it("deletes the exact pushed candidate when the post-push main lookup fails", async () => {
    const harness = await createPublishHarness({ publishMode: "lookup-failure-after-push" });

    await expect(runPublishStep(harness)).rejects.toThrow(/live main lookup failed/i);
    await expect(git(harness.remote, ["show-ref", "--verify", `refs/heads/${harness.branch}`]))
      .rejects.toThrow();
    expect(await git(harness.workspace, ["for-each-ref", "--format=%(refname)", "refs/catalog-refresh/publish"])).toBe("");
  });

  it("closes the created PR and deletes its exact branch when the PR base response drifts", async () => {
    const harness = await createPublishHarness({ publishMode: "pr-base-mismatch" });

    await expect(runPublishStep(harness)).rejects.toThrow();
    await expect(git(harness.remote, ["show-ref", "--verify", `refs/heads/${harness.branch}`]))
      .rejects.toThrow();
    const ghLog = await readFile(harness.ghLog, "utf8");
    expect(ghLog).toMatch(/--method POST[^\n]*pulls/);
    expect(ghLog).toMatch(/--method PATCH[^\n]*pulls\/1[^\n]*state=closed/);
  });

  it("inventories and deletes an exact candidate after an ambiguous successful push", async () => {
    const harness = await createPublishHarness({ publishMode: "ambiguous-push-success" });

    await expect(runPublishStep(harness)).rejects.toThrow();
    await expect(git(harness.remote, ["show-ref", "--verify", `refs/heads/${harness.branch}`]))
      .rejects.toThrow();
    const ghLog = await readFile(harness.ghLog, "utf8");
    expect(ghLog).toMatch(/matching-refs\/heads\/automation\/catalog-refresh/);
  });

  it("never deletes a candidate branch moved by another actor after an ambiguous push", async () => {
    const harness = await createPublishHarness({ publishMode: "ambiguous-push-branch-moved" });

    await expect(runPublishStep(harness)).rejects.toThrow(/operator review/i);
    expect(await git(harness.remote, ["rev-parse", `refs/heads/${harness.branch}`])).toBe(harness.baseSha);
  });

  it("leaves an ambiguous branch for operator inventory when authenticated inventory fails", async () => {
    const harness = await createPublishHarness({ publishMode: "branch-inventory-failure" });

    await expect(runPublishStep(harness)).rejects.toThrow(/operator inventory/i);
    expect(await git(harness.remote, ["rev-parse", `refs/heads/${harness.branch}`])).toBe(harness.candidateSha);
  });

  it("inventories and closes a PR created before its POST response was lost", async () => {
    const harness = await createPublishHarness({ publishMode: "ambiguous-pr-success" });

    await expect(runPublishStep(harness)).rejects.toThrow();
    await expect(git(harness.remote, ["show-ref", "--verify", `refs/heads/${harness.branch}`]))
      .rejects.toThrow();
    expect((await readFile(harness.prState, "utf8")).trim()).toBe("closed");
    const ghLog = await readFile(harness.ghLog, "utf8");
    expect(ghLog).toMatch(/--method PATCH[^\n]*pulls\/1[^\n]*state=closed/);
  });

  it("leaves multiple exact candidate PRs open for operator review", async () => {
    const harness = await createPublishHarness({ publishMode: "multiple-candidate-prs" });

    await expect(runPublishStep(harness)).rejects.toThrow(/multiple exact candidate PRs.*operator review/i);
    expect((await readFile(harness.prState, "utf8")).trim()).toBe("open");
    await expect(git(harness.remote, ["show-ref", "--verify", `refs/heads/${harness.branch}`]))
      .rejects.toThrow();
  });

  it("requires operator inventory when candidate PR lookup fails after an ambiguous POST", async () => {
    const harness = await createPublishHarness({ publishMode: "pr-inventory-failure" });

    await expect(runPublishStep(harness)).rejects.toThrow(/operator inventory required/i);
    expect((await readFile(harness.prState, "utf8")).trim()).toBe("open");
    await expect(git(harness.remote, ["show-ref", "--verify", `refs/heads/${harness.branch}`]))
      .rejects.toThrow();
  });

  it("rejects a matching foreign-head PR instead of accepting it as a no-op", async () => {
    const harness = await createPublishHarness({ publishMode: "foreign-existing-pr" });
    await writeFile(harness.prState, "open\n");

    await expect(runPublishStep(harness)).rejects.toThrow(/foreign repository identity.*operator review/i);
    expect((await readFile(harness.prState, "utf8")).trim()).toBe("open");
    await expect(git(harness.remote, ["show-ref", "--verify", `refs/heads/${harness.branch}`]))
      .rejects.toThrow();
    const ghLog = await readFile(harness.ghLog, "utf8");
    expect(ghLog).not.toMatch(/--method POST[^\n]*pulls/);
  });

  it("accepts a case-normalized same-repository PR as the existing no-op", async () => {
    const harness = await createPublishHarness();
    await writeFile(harness.prState, "open\n");

    await runPublishStep(harness);
    expect((await readFile(harness.prState, "utf8")).trim()).toBe("open");
    await expect(git(harness.remote, ["show-ref", "--verify", `refs/heads/${harness.branch}`]))
      .rejects.toThrow();
    const ghLog = await readFile(harness.ghLog, "utf8");
    expect(ghLog).not.toMatch(/--method POST[^\n]*pulls/);
  });

  it("never closes a foreign-head PR after an ambiguous POST", async () => {
    const harness = await createPublishHarness({ publishMode: "foreign-pr-after-ambiguous-post" });

    await expect(runPublishStep(harness)).rejects.toThrow(/foreign repository identity.*operator review/i);
    expect((await readFile(harness.prState, "utf8")).trim()).toBe("open");
    await expect(git(harness.remote, ["show-ref", "--verify", `refs/heads/${harness.branch}`]))
      .rejects.toThrow();
    const ghLog = await readFile(harness.ghLog, "utf8");
    expect(ghLog).not.toMatch(/--method PATCH[^\n]*pulls\/1/);
  });

  it("rejects candidate metadata that does not match the imported bundle HEAD", async () => {
    const harness = await createPublishHarness();
    await writeFile(join(harness.artifactDirectory, "candidate-sha"), `${harness.baseSha}\n`);

    await expect(runPublishStep(harness)).rejects.toThrow(/candidate.*bundle|bundle.*candidate/i);
    await expect(git(harness.remote, ["show-ref", "--verify", `refs/heads/${harness.branch}`]))
      .rejects.toThrow();
    expect(await git(harness.workspace, ["for-each-ref", "--format=%(refname)", "refs/catalog-refresh/publish"])).toBe("");
  });

  it("rejects a merge candidate whose first parent is the expected base", async () => {
    const harness = await createPublishHarness({ mergeCandidate: true });
    const candidateLine = harness.candidateLine.split(" ");
    expect(candidateLine).toHaveLength(3);
    expect(candidateLine.slice(0, 2)).toEqual([harness.candidateSha, harness.baseSha]);

    await expect(runPublishStep(harness)).rejects.toThrow(/single parent/i);
    await expect(git(harness.remote, ["show-ref", "--verify", `refs/heads/${harness.branch}`]))
      .rejects.toThrow();
    expect(await git(harness.workspace, ["for-each-ref", "--format=%(refname)", "refs/catalog-refresh/publish"])).toBe("");
  });
});

interface PublishHarness {
  root: string;
  workspace: string;
  remote: string;
  artifactDirectory: string;
  fakeBin: string;
  runId: string;
  baseSha: string;
  candidateSha: string;
  candidateLine: string;
  branch: string;
  ghLog: string;
  prState: string;
  realGit: string;
  publishMode: PublishMode;
}

type PublishMode =
  | "success"
  | "drift-after-push"
  | "lookup-failure-after-push"
  | "pr-base-mismatch"
  | "ambiguous-push-success"
  | "ambiguous-push-branch-moved"
  | "branch-inventory-failure"
  | "ambiguous-pr-success"
  | "multiple-candidate-prs"
  | "pr-inventory-failure"
  | "foreign-existing-pr"
  | "foreign-pr-after-ambiguous-post";

async function createPublishHarness(options: {
  mergeCandidate?: boolean;
  publishMode?: PublishMode;
} = {}): Promise<PublishHarness> {
  const root = await mkdtemp(join(tmpdir(), "catalog-refresh-publish-"));
  temporaryRoots.push(root);
  const producer = join(root, "producer");
  const remote = join(root, "remote.git");
  const workspace = join(root, "workspace");
  const artifactDirectory = join(root, "catalog-refresh-artifact");
  const fakeBin = join(root, "bin");
  const ghLog = join(root, "gh.log");
  const ghState = join(root, "gh-state");
  const prState = join(root, "pr-state");
  const publishMode = options.publishMode ?? "success";
  const runId = "987654321";
  await Promise.all([mkdir(producer), mkdir(artifactDirectory), mkdir(fakeBin)]);

  await run("git", ["init", "--quiet", "-b", "main"], producer);
  await run("git", ["config", "user.name", "Catalog Refresh Publish Test"], producer);
  await run("git", ["config", "user.email", "catalog-refresh-publish@example.test"], producer);
  await writeFile(join(producer, "catalog.txt"), "base\n");
  await run("git", ["add", "catalog.txt"], producer);
  await run("git", ["commit", "--quiet", "--signoff", "-m", "test: seed catalog base"], producer);
  const baseSha = await git(producer, ["rev-parse", "HEAD"]);
  const baseDigest = "a".repeat(64);
  const resultDigest = "b".repeat(64);
  const branch = `automation/catalog-refresh-${baseDigest.slice(0, 8)}-${runId}`;

  await run("git", ["init", "--quiet", "--bare", remote], root);
  await run("git", ["--git-dir", remote, "fetch", "--quiet", producer, `${baseSha}:refs/heads/main`], root);
  await run("git", ["clone", "--quiet", "--branch", "main", remote, workspace], root);

  if (options.mergeCandidate) {
    await run("git", ["checkout", "--quiet", "-b", "merge-side"], producer);
    await writeFile(join(producer, "merge-side.txt"), "merge candidate\n");
    await run("git", ["add", "merge-side.txt"], producer);
    await run("git", ["commit", "--quiet", "--signoff", "-m", "test: seed merge side"], producer);
    await run("git", ["checkout", "--quiet", "main"], producer);
    await run("git", ["merge", "--quiet", "--no-ff", "--signoff", "-m", "chore: refresh catalog merge candidate", "merge-side"], producer);
  } else {
    await writeFile(join(producer, "catalog.txt"), "candidate\n");
    await run("git", ["add", "catalog.txt"], producer);
    await run("git", ["commit", "--quiet", "--signoff", "-m", "chore: refresh catalog candidate"], producer);
  }
  const candidateSha = await git(producer, ["rev-parse", "HEAD"]);
  const candidateLine = await git(producer, ["rev-list", "--parents", "-n", "1", candidateSha]);
  await run("git", ["branch", "unrelated-bundle-ref", baseSha], producer);
  const bundlePath = join(artifactDirectory, "candidate.bundle");
  await run("git", ["bundle", "create", bundlePath, "HEAD", "refs/heads/unrelated-bundle-ref"], producer);
  const bundleDigest = createHash("sha256").update(await readFile(bundlePath)).digest("hex");
  await Promise.all([
    writeFile(join(artifactDirectory, "candidate.bundle.sha256"), `${bundleDigest}  candidate.bundle\n`),
    writeFile(join(artifactDirectory, "base-sha"), `${baseSha}\n`),
    writeFile(join(artifactDirectory, "candidate-sha"), `${candidateSha}\n`),
    writeFile(join(artifactDirectory, "branch"), `${branch}\n`),
    writeFile(join(artifactDirectory, "base-digest"), `${baseDigest}\n`),
    writeFile(join(artifactDirectory, "result-digest"), `${resultDigest}\n`)
  ]);

  await Promise.all([
    writeFile(ghLog, ""),
    writeFile(ghState, "0\n"),
    writeFile(prState, "closed\n")
  ]);
  const { stdout: realGitOutput } = await execFileAsync("which", ["git"], { encoding: "utf8" });
  const realGit = realGitOutput.trim();
  const gitPath = join(fakeBin, "git");
  await writeFile(gitPath, `#!/bin/sh
set -eu
ambiguous_creation=false
for argument in "$@"; do
  case "$argument" in
    --force-with-lease=refs/heads/*:) ambiguous_creation=true ;;
  esac
done
if test "$ambiguous_creation" = true; then
  case "$GH_FIXTURE_MODE" in
    ambiguous-push-success|branch-inventory-failure)
      "$REAL_GIT" "$@"
      exit 41
      ;;
    ambiguous-push-branch-moved)
      "$REAL_GIT" "$@"
      "$REAL_GIT" --git-dir="$GH_FIXTURE_REMOTE" update-ref "refs/heads/$GH_FIXTURE_BRANCH" "$GH_FIXTURE_BASE_SHA"
      exit 41
      ;;
  esac
fi
exec "$REAL_GIT" "$@"
`);
  await chmod(gitPath, 0o755);
  const ghPath = join(fakeBin, "gh");
  await writeFile(ghPath, `#!/bin/sh
set -eu
printf '%s\n' "$*" >> "$GH_FIXTURE_LOG"
test "$1" = api
case "$*" in
  *git/ref/heads/main*)
    count="$(cat "$GH_FIXTURE_STATE")"
    count=$((count + 1))
    printf '%s\n' "$count" > "$GH_FIXTURE_STATE"
    if test "$count" = 2 && test "$GH_FIXTURE_MODE" = lookup-failure-after-push; then
      exit 3
    fi
    if test "$count" = 2 && test "$GH_FIXTURE_MODE" = drift-after-push; then
      printf '%s\n' "ffffffffffffffffffffffffffffffffffffffff"
    else
      printf '%s\n' "$GH_FIXTURE_BASE_SHA"
    fi
    ;;
  *matching-refs/heads/automation/catalog-refresh-*)
    if test "$GH_FIXTURE_MODE" = branch-inventory-failure; then
      exit 4
    fi
    if branch_sha="$("$REAL_GIT" --git-dir="$GH_FIXTURE_REMOTE" rev-parse "refs/heads/$GH_FIXTURE_BRANCH" 2>/dev/null)"; then
      jq -n --arg ref "refs/heads/$GH_FIXTURE_BRANCH" --arg sha "$branch_sha" '[{ref:$ref,object:{sha:$sha}}]'
    else
      printf '[]\n'
    fi
    ;;
  *pulls?state=open*)
    if test "$(cat "$GH_FIXTURE_PR_STATE")" = open; then
      if test "$GH_FIXTURE_MODE" = pr-inventory-failure; then
        exit 6
      fi
      if test "$GH_FIXTURE_MODE" = multiple-candidate-prs; then
        jq -n \
          --arg body "$GH_FIXTURE_BODY" \
          --arg base "$GH_FIXTURE_BASE_SHA" \
          --arg head "$GH_FIXTURE_CANDIDATE_SHA" \
          --arg branch "$GH_FIXTURE_BRANCH" \
          --arg repo "$GH_FIXTURE_API_REPOSITORY" \
          --argjson repo_id "$GH_FIXTURE_REPOSITORY_ID" \
          '[
            {number:1,body:$body,base:{sha:$base,ref:"main",repo:{full_name:$repo,id:$repo_id}},head:{sha:$head,ref:$branch,repo:{full_name:$repo,id:$repo_id}},html_url:"https://example.test/pr/1"},
            {number:2,body:$body,base:{sha:$base,ref:"main",repo:{full_name:$repo,id:$repo_id}},head:{sha:$head,ref:$branch,repo:{full_name:$repo,id:$repo_id}},html_url:"https://example.test/pr/2"}
          ]'
        exit 0
      fi
      head_repo="$GH_FIXTURE_API_REPOSITORY"
      head_repo_id="$GH_FIXTURE_REPOSITORY_ID"
      if test "$GH_FIXTURE_MODE" = foreign-existing-pr \
        || test "$GH_FIXTURE_MODE" = foreign-pr-after-ambiguous-post; then
        head_repo="fork-owner/catalog"
        head_repo_id=654321
      fi
      jq -n \
        --arg body "$GH_FIXTURE_BODY" \
        --arg base "$GH_FIXTURE_BASE_SHA" \
        --arg head "$GH_FIXTURE_CANDIDATE_SHA" \
        --arg branch "$GH_FIXTURE_BRANCH" \
        --arg repo "$GH_FIXTURE_API_REPOSITORY" \
        --arg head_repo "$head_repo" \
        --argjson repo_id "$GH_FIXTURE_REPOSITORY_ID" \
        --argjson head_repo_id "$head_repo_id" \
        '[{number:1,body:$body,base:{sha:$base,ref:"main",repo:{full_name:$repo,id:$repo_id}},head:{sha:$head,ref:$branch,repo:{full_name:$head_repo,id:$head_repo_id}},html_url:"https://example.test/pr/1"}]'
    else
      printf '[]\n'
    fi
    ;;
  *pulls/1*)
    printf 'closed\n' > "$GH_FIXTURE_PR_STATE"
    printf '{"state":"closed"}\n'
    ;;
  *pulls*)
    printf 'open\n' > "$GH_FIXTURE_PR_STATE"
    if test "$GH_FIXTURE_MODE" = ambiguous-pr-success \
      || test "$GH_FIXTURE_MODE" = multiple-candidate-prs \
      || test "$GH_FIXTURE_MODE" = pr-inventory-failure \
      || test "$GH_FIXTURE_MODE" = foreign-pr-after-ambiguous-post; then
      exit 5
    fi
    response_base="$GH_FIXTURE_BASE_SHA"
    if test "$GH_FIXTURE_MODE" = pr-base-mismatch; then
      response_base="ffffffffffffffffffffffffffffffffffffffff"
    fi
    jq -n \
      --arg body "$GH_FIXTURE_BODY" \
      --arg base "$response_base" \
      --arg head "$GH_FIXTURE_CANDIDATE_SHA" \
      --arg branch "$GH_FIXTURE_BRANCH" \
      --arg repo "$GH_FIXTURE_API_REPOSITORY" \
      --argjson repo_id "$GH_FIXTURE_REPOSITORY_ID" \
      '{number:1,body:$body,base:{sha:$base,ref:"main",repo:{full_name:$repo,id:$repo_id}},head:{sha:$head,ref:$branch,repo:{full_name:$repo,id:$repo_id}},html_url:"https://example.test/pr/1"}'
    ;;
  *) exit 2 ;;
esac
`);
  await chmod(ghPath, 0o755);

  return {
    root,
    workspace,
    remote,
    artifactDirectory,
    fakeBin,
    runId,
    baseSha,
    candidateSha,
    candidateLine,
    branch,
    ghLog,
    prState,
    realGit,
    publishMode
  };
}

async function runPublishStep(harness: PublishHarness): Promise<void> {
  const workflow = await readFile(join(projectRoot, ".github", "workflows", "catalog-refresh.yml"), "utf8");
  const marker = "      - name: Push validated branch and open review PR\n";
  const start = workflow.indexOf(marker);
  if (start === -1) throw new Error("Catalog refresh publish step is missing");
  const step = workflow.slice(start + marker.length);
  const runMarker = "        run: |\n";
  const runStart = step.indexOf(runMarker);
  if (runStart === -1) throw new Error("Catalog refresh publish run block is missing");
  const script = step.slice(runStart + runMarker.length)
    .split("\n")
    .map((line) => line.startsWith("          ") ? line.slice(10) : line)
    .join("\n");
  await execFileAsync("bash", ["-c", script], {
    cwd: harness.workspace,
    env: {
      ...process.env,
      PATH: `${harness.fakeBin}:${process.env.PATH ?? ""}`,
      RUNNER_TEMP: harness.root,
      GITHUB_RUN_ID: harness.runId,
      GITHUB_REPOSITORY: "example/catalog",
      GH_TOKEN: "fixture-token",
      GH_FIXTURE_LOG: harness.ghLog,
      GH_FIXTURE_STATE: join(harness.root, "gh-state"),
      GH_FIXTURE_MODE: harness.publishMode,
      GH_FIXTURE_BASE_SHA: harness.baseSha,
      GH_FIXTURE_CANDIDATE_SHA: harness.candidateSha,
      GH_FIXTURE_API_REPOSITORY: "Example/Catalog",
      GH_FIXTURE_REPOSITORY_ID: "123456",
      GH_FIXTURE_BRANCH: harness.branch,
      GH_FIXTURE_REMOTE: harness.remote,
      GH_FIXTURE_PR_STATE: harness.prState,
      GH_FIXTURE_BODY: `catalog-refresh-base-digest: ${"a".repeat(64)}\ncatalog-refresh-result-digest: ${"b".repeat(64)}`,
      REAL_GIT: harness.realGit,
      GITHUB_REPOSITORY_ID: "123456"
    },
    maxBuffer: 8 * 1024 * 1024
  });
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  return (await run("git", [...args], cwd)).trim();
}

async function run(file: string, args: readonly string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync(file, [...args], { cwd, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  return stdout;
}
