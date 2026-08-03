import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

const readProjectFile = (path: string): Promise<string> =>
  readFile(join(projectRoot, path), "utf8");

describe("Claude directory submission documentation", () => {
  it("publishes bilingual, self-contained privacy boundaries at every package root", async () => {
    const [rootPrivacy, sharedPrivacy, managerPrivacy] = await Promise.all([
      readProjectFile("PRIVACY.md"),
      readProjectFile("plugins/shared-core/PRIVACY.md"),
      readProjectFile("plugins/skillset-manager/PRIVACY.md")
    ]);

    for (const document of [rootPrivacy, sharedPrivacy, managerPrivacy]) {
      expect(document).toMatch(/## English/);
      expect(document).toMatch(/## 한국어/);
      expect(document).toMatch(/telemetry/i);
      expect(document).toMatch(/account/i);
      expect(document).toMatch(/secret/i);
      expect(document).toMatch(/delete|deletion/i);
      expect(document).toMatch(/삭제/);
    }

    expect(sharedPrivacy).toMatch(/does not install, update, or remove external plugins/i);
    for (const document of [rootPrivacy, managerPrivacy]) {
      expect(document).toContain("~/.claude/claude-code-skillsets/state");
      expect(document).toMatch(/plugin-owned index/i);
      expect(document).toMatch(/read-only probes/i);
      expect(document).toMatch(/observe UTC time/i);
      expect(document).toMatch(/Node\.js publisher/i);
      expect(document).toMatch(/Claude executable identities/i);
      expect(document).toContain("2.1.198 (Claude Code)");
      expect(document).toMatch(/candidate phases run only after[\s\S]*exact final approval/i);
      expect(document).toMatch(/revalidates[\s\S]*realpath[\s\S]*(?:SHA-256|hash)[\s\S]*version/i);
      expect(document).toContain("claude plugin install");
      expect(document).toMatch(/provider.*polic/i);
      expect(document).toMatch(/unknown/i);
    }
  });

  it("publishes public support and private vulnerability-reporting routes", async () => {
    const supportDocuments = await Promise.all([
      readProjectFile("SUPPORT.md"),
      readProjectFile("plugins/shared-core/SUPPORT.md"),
      readProjectFile("plugins/skillset-manager/SUPPORT.md")
    ]);

    for (const document of supportDocuments) {
      expect(document).toMatch(/## English/);
      expect(document).toMatch(/## 한국어/);
      expect(document).toContain("https://github.com/seunghyeon1004/claude-code-skillsets/issues");
      expect(document).toContain("https://github.com/seunghyeon1004/claude-code-skillsets/security/advisories/new");
      expect(document).toMatch(/do\s+not[\s\S]*secret/i);
      expect(document).toMatch(/비밀/);
      expect(document).toMatch(/upstream|provider/i);
    }
  });

  it("prepares only Shared Core for submission and holds Skillset Manager", async () => {
    const guide = await readProjectFile("docs/release/claude-directory-submission.md");

    expect(guide).toMatch(/^# Claude Plugin Directory Submission Draft/m);
    expect(guide).toMatch(/DO NOT SUBMIT/);
    expect(guide).toMatch(/제출 금지/);
    expect(guide).not.toContain("<REQUIRED_BEFORE_SUBMISSION>");
    expect(guide).not.toMatch(/form-only|intentionally unpublished|intentionally not published/i);
    expect(guide).toMatch(/community-driven plugin directory[\s\S]*Claude\s+Code[\s\S]*`claude-plugins-official`/i);
    expect(guide).toMatch(/community가 참여하는 plugin[\s\S]*directory[\s\S]*Claude\s+Code[\s\S]*`claude-plugins-official`/i);
    expect(guide).toContain("https://claude.com/docs/plugins/submit");
    expect(guide).toContain("https://github.com/anthropics/claude-plugins-official");
    expect(guide).toContain("https://platform.claude.com/plugins/submit");
    expect(guide).toContain(
      "https://claude.ai/admin-settings/directory/submissions/plugins/new"
    );
    expect(guide).toMatch(/in-app[\s\S]*Console[\s\S]*forms[\s\S]*not (?:a )?(?:GitHub )?(?:pull request|PR)/i);
    expect(guide).toMatch(/live form fields[\s\S]*re-verified manually/i);
    expect(guide).toMatch(/separate explicit consent[\s\S]*public display[\s\S]*public alias[\s\S]*official clarification/i);
    expect(guide).not.toMatch(/claude-community|has no application process|신청 절차가 없습니다/i);
    expect(guide).not.toMatch(/### Current Form Contract|Required fields are|Optional fields are|필수 필드는|선택 필드는/i);
    expect(guide).toMatch(/Claude Code only/);
    expect(guide).toMatch(/Apache-2\.0/);

    const sharedSubpath = "plugins/shared-core";
    expect(guide).toContain("Plugin name: `shared-core`");
    expect(guide).toContain(`Repository subpath: \`${sharedSubpath}\``);
    expect(guide).toContain(
      `https://github.com/seunghyeon1004/claude-code-skillsets/tree/main/${sharedSubpath}#readme`
    );
    expect(guide).toContain(
      `https://github.com/seunghyeon1004/claude-code-skillsets/blob/main/${sharedSubpath}/PRIVACY.md`
    );
    expect(guide).toContain(
      `https://github.com/seunghyeon1004/claude-code-skillsets/blob/main/${sharedSubpath}/SUPPORT.md`
    );

    expect(guide).toContain("https://github.com/seunghyeon1004/claude-code-skillsets");
    expect(guide).toContain("/shared-core:intent-to-brief");
    expect(guide).toContain("/shared-core:risk-privacy-permissions");
    expect(guide).toContain("/shared-core:quality-verification");
    expect(guide).toMatch(/CURRENT POLICY HOLD - DO NOT SUBMIT/);
    expect(guide).toMatch(/Section 2\.D/);
    expect(guide).toMatch(/Section 2\.F/);
    expect(guide).toMatch(/dynamic\w*[\s\S]*behavioral\s+instructions/i);
    expect(guide).toMatch(/advertising or promotional vehicle/i);
    expect(guide).toMatch(/author-owned GitHub marketplace/i);
    expect(guide).toMatch(/current verified Claude Code version[^\n]*2\.1\.198/i);
    expect(guide).toMatch(/not a minimum version/i);
    expect(guide).toContain(
      "claude plugin marketplace add seunghyeon1004/claude-code-skillsets --scope user"
    );
    expect(guide).toContain(
      "claude plugin install skillset-manager@claude-code-skillsets --scope user"
    );
    expect(guide).toMatch(/same-marketplace[\s\S]*static[\s\S]*dependency/i);
    const normalizedGuide = guide.replace(/\s+/gu, " ");
    expect(normalizedGuide).toContain("updates pushed to the submitted public GitHub repository are picked up automatically");
    expect(normalizedGuide).toContain("do not need to re-submit the form for updates");
    const submissionGates = guide.match(
      /## Submission Gates \/ 제출 게이트[\s\S]*?(?=## After Submission \/ 제출 후)/
    )?.[0];
    expect(submissionGates).toBeDefined();
    expect(submissionGates).toContain(
      "- [ ] The owner reviews the Software Directory Terms and manually accepts them."
    );
    expect(submissionGates).toContain(
      "- [ ] The user gives a separate final approval to submit `shared-core`."
    );
    expect(submissionGates).toContain(
      "- [ ] 소유자가 Software Directory Terms를 검토하고 직접 동의합니다."
    );
    expect(submissionGates).toContain(
      "- [ ] 사용자가 `shared-core` 제출을 별도로 최종 승인합니다."
    );
    expect(guide).not.toContain("Plugin name: `skillset-manager`");
    expect(guide).not.toContain("Repository subpath: `plugins/skillset-manager`");
    expect(guide).not.toContain("Submit both plugins");
    expect(guide).not.toContain("claude plugin validate plugins/skillset-manager --strict");
  });

  it("packages complete Shared Core guidance and official-metadata attribution", async () => {
    const [sharedReadme, managerNotices, rootNotices] = await Promise.all([
      readProjectFile("plugins/shared-core/README.md"),
      readProjectFile("plugins/skillset-manager/THIRD_PARTY_NOTICES"),
      readProjectFile("THIRD_PARTY_NOTICES.md")
    ]);

    for (const skill of [
      "evidence-provenance",
      "handoff-continuity",
      "intent-to-brief",
      "plan-and-checkpoints",
      "quality-verification",
      "risk-privacy-permissions",
      "workflow-router",
      "workspace-context"
    ]) {
      expect(sharedReadme).toContain(`\`${skill}\``);
    }

    expect(sharedReadme).toContain("/shared-core:intent-to-brief");
    expect(sharedReadme).toContain("/shared-core:risk-privacy-permissions");
    expect(sharedReadme).toContain("/shared-core:quality-verification");
    expect(sharedReadme).toMatch(/Troubleshooting/);
    expect(sharedReadme).toMatch(/문제 해결/);
    expect(sharedReadme).toContain("/reload-plugins");
    expect(sharedReadme).toContain("PRIVACY.md");
    expect(sharedReadme).toContain("SUPPORT.md");

    expect(managerNotices).toMatch(/Anthropic Claude Plugins Official Marketplace Metadata/);
    expect(managerNotices).toContain("e3e378cbbb205673a5d7254ded32679cafa6179d");
    expect(managerNotices).toContain("data/official-marketplace-index.json");
    expect(managerNotices).toContain("data/decision-index.json");
    expect(managerNotices).toMatch(/Change notice/);
    expect(managerNotices).toContain("Apache License 2.0");
    expect(rootNotices).toContain("e3e378cbbb205673a5d7254ded32679cafa6179d");
  });
});
