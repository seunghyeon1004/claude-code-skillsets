import { loadInstalledDecisionIndex } from "../decision/index-loader.js";
import {
  evaluateSetupDecisionFixture,
  executeAndPublishApprovedSetupCandidates
} from "./setup.js";

const [marketplaceSource, pluginVersion] = process.argv.slice(2);
if (marketplaceSource === undefined || pluginVersion === undefined) {
  throw new Error("setup fixture publisher requires marketplace source and plugin version");
}

const index = await loadInstalledDecisionIndex();
const input = {
  language: "en" as const,
  domainIds: ["research-and-intelligence" as const],
  platform: "darwin" as const,
  timeProbe: { consent: "granted" as const, utcTimestamp: index.observedThrough },
  riskAcknowledged: true
};
const awaiting = await evaluateSetupDecisionFixture(index, input);
const approved = await evaluateSetupDecisionFixture(index, {
  ...input,
  approval: awaiting.approvalBinding
});
const candidate = approved.approvalBinding.preview.candidates[0]!;
await executeAndPublishApprovedSetupCandidates({
  executionCapability: approved.executionCapability!,
  decisionIndex: index,
  observedAt: index.observedThrough,
  driver: {
    async executeCandidate() {
      return {
        marketplaceBeforeStdout: JSON.stringify([{
          installLocation: "/fixture/marketplaces/claude-plugins-official",
          name: candidate.marketplaceId,
          repo: candidate.marketplaceSource,
          source: "github"
        }]),
        cliVersionBeforeStdout: "2.1.198 (Claude Code)\n",
        installInvocation: { argv: candidate.installArgv, status: "success" as const },
        pluginListAfterStdout: JSON.stringify([{
          id: `${candidate.pluginName}@${candidate.marketplaceId}`,
          version: pluginVersion,
          scope: candidate.scope,
          enabled: true
        }]),
        cliVersionAfterStdout: "2.1.198 (Claude Code)\n",
        invocationTrace: candidateInvocationTrace(candidate.installArgv)
      };
    }
  }
});

function candidateInvocationTrace(installArgv: string[]) {
  return [
    { argv: ["claude", "plugin", "marketplace", "list", "--json"], status: "success" as const },
    { argv: ["claude", "--version"], status: "success" as const },
    { argv: [...installArgv], status: "success" as const },
    { argv: ["claude", "plugin", "list", "--json"], status: "success" as const },
    { argv: ["claude", "--version"], status: "success" as const }
  ];
}
