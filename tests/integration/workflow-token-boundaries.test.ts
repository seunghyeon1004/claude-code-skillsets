import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

describe("workflow token boundaries", () => {
  it("keeps CI read-only and prevents checkout from persisting credentials", async () => {
    const workflow = await readFile(join(projectRoot, ".github", "workflows", "ci.yml"), "utf8");

    expect(workflow).toMatch(/^permissions:\n  contents: read\n$/m);
    const checkoutBlocks = workflow.match(/uses:\s+actions\/checkout@[a-f0-9]{40}[^]*?(?=\n\s+- (?:uses|name|run):|$)/gu) ?? [];
    expect(checkoutBlocks).toHaveLength(2);
    expect(checkoutBlocks.every((block) => /persist-credentials:\s*false/u.test(block))).toBe(true);
  });

  it("does not persist catalog refresh write credentials", async () => {
    const workflow = await readFile(join(projectRoot, ".github", "workflows", "catalog-refresh.yml"), "utf8");

    const checkoutBlocks = workflow.match(/uses:\s+actions\/checkout@[a-f0-9]{40}[^]*?(?=\n\s+- (?:uses|name|run):|$)/gu) ?? [];
    expect(checkoutBlocks).toHaveLength(2);
    expect(checkoutBlocks.every((block) => /persist-credentials:\s*false/u.test(block))).toBe(true);
    expect(workflow).toMatch(/validate:\n\s+runs-on:[^]*?permissions:\n\s+contents: read/u);
    expect(workflow).toMatch(/publish:\n\s+needs: validate\n[^]*?permissions:\n\s+contents: write\n\s+pull-requests: write/u);

    const validateJob = workflow.slice(workflow.indexOf("  validate:"), workflow.indexOf("  publish:"));
    const publishJob = workflow.slice(workflow.indexOf("  publish:"));
    expect(validateJob).not.toMatch(/GH_TOKEN|GITHUB_TOKEN|CATALOG_PUBLISH_TOKEN|github\.token/u);
    expect(publishJob).not.toMatch(/setup-node|npm\s|tsx|scripts\/research/u);
    expect(publishJob.indexOf("Verify validated catalog artifact")).toBeLessThan(publishJob.indexOf("GH_TOKEN:"));
    expect(publishJob).toContain('test "$(git rev-parse HEAD)" = "$base_sha"');
    expect(publishJob).toMatch(/git(?:\s+-C\s+"\$verify_repo")?\s+bundle verify/u);
    expect(publishJob).toContain("sha256sum --check");
    expect(publishJob).not.toContain("persist-credentials: true");
    expect(publishJob).not.toContain("gh auth setup-git");
    expect(publishJob.match(/^\s+GH_TOKEN:/gm)).toHaveLength(1);
  });
});
