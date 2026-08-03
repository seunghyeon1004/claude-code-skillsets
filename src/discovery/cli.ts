import { pathToFileURL } from "node:url";
import { COMPLETE_V1_DOMAIN_IDS, type DomainId, type Platform, type SourceReviewBacklog } from "../model/complete-v1.js";
import { buildDecisionPlan } from "../decision/planner.js";
import { prepareCodexHandoff } from "../decision/codex-preview.js";
import { loadDecisionIndex } from "../decision/repository.js";
import type { DecisionIndex } from "../model/decision.js";
import { loadVerifiedSourceReviewBacklog } from "../research/source-review-backlog-composition.js";
import { DELEGATED_OFFICIAL_SOURCE_IDS } from "../research/source-review-backlog.js";
import {
  OFFICIAL_CLAUDE_CODE_ONLY_BOUNDARY,
  OFFICIAL_MARKETPLACE_ID,
  loadOfficialMarketplaceBaseline,
  officialMarketplaceRecommendations
} from "./official-marketplace.js";
import {
  compactDiscoveryProvenance,
  loadDiscoveryBroker,
  type DiscoveryBroker,
  type PageOptions
} from "./broker.js";

export interface DiscoveryCliOperations {
  loadBroker(root: string): Promise<DiscoveryBroker>;
  loadDecisionIndex(root: string): Promise<DecisionIndex>;
  loadSourceReviewBacklog(root: string): Promise<SourceReviewBacklog>;
  writeStdout(value: string): void;
  writeStderr(value: string): void;
}

const defaultOperations: DiscoveryCliOperations = {
  loadBroker: loadDiscoveryBroker,
  loadDecisionIndex,
  loadSourceReviewBacklog: loadVerifiedSourceReviewBacklog,
  writeStdout: (value) => process.stdout.write(value),
  writeStderr: (value) => process.stderr.write(value)
};

export async function runDiscoveryCli(
  args: readonly string[],
  root = process.cwd(),
  overrides: Partial<DiscoveryCliOperations> = {}
): Promise<number> {
  const operations = { ...defaultOperations, ...overrides };
  try {
    const officialOutput = officialCommandOutput(args);
    if (officialOutput !== undefined) {
      operations.writeStdout(`${JSON.stringify(officialOutput, null, 2)}\n`);
      return 0;
    }
    const reviewQueueOutput = await sourceReviewQueueOutput(args, root, operations);
    if (reviewQueueOutput !== undefined) {
      operations.writeStdout(`${JSON.stringify(reviewQueueOutput, null, 2)}\n`);
      return 0;
    }
    const decisionPlanOutput = await decisionPlanCommandOutput(args, root, operations);
    if (decisionPlanOutput !== undefined) {
      operations.writeStdout(`${JSON.stringify(decisionPlanOutput, null, 2)}\n`);
      return 0;
    }
    const broker = await operations.loadBroker(root);
    operations.writeStdout(`${JSON.stringify(commandOutput(args, broker), null, 2)}\n`);
    return 0;
  } catch (error) {
    operations.writeStderr(`${errorMessage(error)}\n`);
    return 2;
  }
}

async function decisionPlanCommandOutput(
  args: readonly string[],
  root: string,
  operations: DiscoveryCliOperations
): Promise<unknown | undefined> {
  if (args[0] !== "decision-plan") return undefined;
  const input = parseDecisionPlanArguments(args.slice(1));
  const plan = buildDecisionPlan(await operations.loadDecisionIndex(root), input);
  return input.runtime === "codex" ? prepareCodexHandoff(plan) : plan;
}

function parseDecisionPlanArguments(args: readonly string[]): {
  runtime: "claude-code" | "codex";
  platform: Platform;
  asOf: string;
  goal?: string;
  domainIds?: DomainId[];
  domainPriority?: DomainId[];
} {
  let runtime: "claude-code" | "codex" | undefined;
  let platform: Platform | undefined;
  let asOf: string | undefined;
  let goal: string | undefined;
  const domainIds: DomainId[] = [];
  const domainPriority: DomainId[] = [];
  const usage = "Usage: npm run broker -- decision-plan --runtime <claude-code|codex> --platform <darwin|linux|win32> --as-of <UTC> (--goal <text> | --domain <id> [...] [--priority <id> --priority <id>])";

  for (let index = 0; index < args.length; index += 1) {
    const option = args[index]!;
    const value = args[index + 1];
    if (value === undefined || !option.startsWith("--")) throw new Error(usage);
    index += 1;
    if (option === "--runtime") {
      if (runtime !== undefined || (value !== "claude-code" && value !== "codex")) throw new Error(usage);
      runtime = value;
      continue;
    }
    if (option === "--platform") {
      if (platform !== undefined || !(["darwin", "linux", "win32"] as const).includes(value as Platform)) throw new Error(usage);
      platform = value as Platform;
      continue;
    }
    if (option === "--as-of") {
      if (asOf !== undefined || !isExplicitUtc(value)) throw new Error(usage);
      asOf = value;
      continue;
    }
    if (option === "--goal") {
      if (goal !== undefined || value.trim() === "") throw new Error(usage);
      goal = value;
      continue;
    }
    if (option === "--domain") {
      if (!COMPLETE_V1_DOMAIN_IDS.includes(value as DomainId) || domainIds.includes(value as DomainId)) throw new Error(usage);
      domainIds.push(value as DomainId);
      continue;
    }
    if (option === "--priority") {
      if (!COMPLETE_V1_DOMAIN_IDS.includes(value as DomainId) || domainPriority.includes(value as DomainId)) throw new Error(usage);
      domainPriority.push(value as DomainId);
      continue;
    }
    throw new Error(usage);
  }

  if (runtime === undefined || platform === undefined || asOf === undefined
    || (goal === undefined && domainIds.length === 0) || (goal !== undefined && domainIds.length > 0)
    || (goal !== undefined && domainPriority.length > 0)
    || (domainIds.length <= 2 && domainPriority.length > 0)
    || (domainIds.length > 2 && (domainPriority.length !== 2
      || domainPriority.some((domainId) => !domainIds.includes(domainId))))) throw new Error(usage);
  return {
    runtime,
    platform,
    asOf,
    ...(goal === undefined ? {
      domainIds,
      ...(domainPriority.length === 0 ? {} : { domainPriority })
    } : { goal })
  };
}

function isExplicitUtc(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(value) && Number.isFinite(Date.parse(value));
}

async function sourceReviewQueueOutput(
  args: readonly string[],
  root: string,
  operations: DiscoveryCliOperations
): Promise<unknown | undefined> {
  const parsed = parsePageOptions(args);
  const [command, ...operands] = parsed.operands;
  if (command !== "review-queue") return undefined;
  if (operands.length !== 0 || parsed.options.cursor !== undefined || parsed.options.limit !== undefined) {
    throw new Error("Usage: npm run broker -- review-queue");
  }
  const backlog = await operations.loadSourceReviewBacklog(root);
  return {
    kind: "source-review-backlog",
    status: "review-required",
    executionStatus: "not-executed",
    delegatedOfficialSourceIds: DELEGATED_OFFICIAL_SOURCE_IDS,
    totalCandidateCount: backlog.candidates.length,
    candidates: backlog.candidates
  };
}

function officialCommandOutput(args: readonly string[]): unknown | undefined {
  const parsed = parsePageOptions(args);
  const [command, ...operands] = parsed.operands;
  if (command !== "official" && command !== "prepare-official") return undefined;
  if (parsed.options.cursor !== undefined) {
    throw new Error("official marketplace commands do not accept --cursor");
  }
  if (operands.length !== 1) {
    throw new Error("Usage: npm run broker -- official <domain> [--limit 1..3]|prepare-official <domain>");
  }

  const domainId = operands[0] as DomainId;
  const candidates = officialMarketplaceRecommendations()[domainId];
  if (candidates === undefined) {
    throw new Error(`unknown domain: ${domainId}`);
  }
  const baseline = loadOfficialMarketplaceBaseline();
  if (command === "prepare-official") {
    if (parsed.options.limit !== undefined) {
      throw new Error("prepare-official does not accept --limit");
    }
    return {
      ...OFFICIAL_CLAUDE_CODE_ONLY_BOUNDARY,
      deprecated: true,
      domainId,
      marketplace: OFFICIAL_MARKETPLACE_ID,
      listingStatus: "marketplace-listed",
      individualSafetyReview: "not-complete",
      executionStatus: "not-executed",
      decisionAuthority: "none",
      nextAction: "use-decision-plan",
      totalCandidateCount: candidates.length,
      candidates: candidates.map((candidate) => ({
        name: candidate.name,
        description: candidate.description,
        sourcePin: candidate.sourcePin,
        classificationRoutes: candidate.classificationRoutes,
        listingStatus: candidate.listingStatus,
        individualSafetyReview: candidate.individualSafetyReview,
        permissions: "unknown",
        license: "unknown",
        trust: "unknown",
        dependencies: "unknown",
        reviewedVersionVerification: "unavailable",
        codexCompatibility: "not-evaluated"
      })),
      provenance: {
        ...baseline.provenance,
        pluginCount: baseline.plugins.length
      }
    };
  }

  const limit = parsed.options.limit ?? 2;
  if (!Number.isInteger(limit) || limit < 1 || limit > 3) {
    throw new Error("official --limit must be an integer from 1 to 3");
  }
  return {
    ...OFFICIAL_CLAUDE_CODE_ONLY_BOUNDARY,
    domainId,
    marketplace: OFFICIAL_MARKETPLACE_ID,
    listingStatus: "marketplace-listed",
    individualSafetyReview: "not-complete",
    executionStatus: "not-executed",
    decisionAuthority: "none",
    nextAction: "use-decision-plan",
    totalCandidateCount: candidates.length,
    candidates: candidates.slice(0, limit).map((candidate) => ({
      name: candidate.name,
      description: candidate.description,
      sourcePin: candidate.sourcePin,
      classificationRoutes: candidate.classificationRoutes,
      listingStatus: candidate.listingStatus,
      individualSafetyReview: candidate.individualSafetyReview,
      permissions: "unknown",
      license: "unknown",
      trust: "unknown",
      dependencies: "unknown",
      reviewedVersionVerification: "unavailable",
      codexCompatibility: "not-evaluated",
      revisionNotGuaranteedByInstallCommand: true
    })),
    provenance: {
      ...baseline.provenance,
      pluginCount: baseline.plugins.length
    }
  };
}

function commandOutput(args: readonly string[], broker: DiscoveryBroker): unknown {
  const parsed = parsePageOptions(args);
  const [command, ...operands] = parsed.operands;
  if (command === "domains" && operands.length === 0) {
    return {
      status: broker.index.status,
      sourceCount: broker.index.sourceCount,
      contractCount: broker.index.contractCount,
      visibleCandidateCount: broker.index.visibleCandidateCount,
      classifiedCount: broker.index.classifiedCount,
      allClassifiedCount: broker.index.allClassifiedCount,
      defaultVisibleClassifiedCount: broker.index.defaultVisibleClassifiedCount,
      geminiOnlyClassifiedCount: broker.index.geminiOnlyClassifiedCount,
      unclassifiedCount: broker.index.unclassifiedCount,
      geminiOnlyCount: broker.index.geminiOnlyCount,
      domains: broker.index.domains.map(({ id, name, status, candidateCount, sourceCount }) => ({
        id,
        name,
        status,
        candidateCount,
        sourceCount
      })),
      provenance: compactDiscoveryProvenance(broker.index)
    };
  }
  if (command === "domain" && operands.length === 1) {
    return broker.domain(operands[0] as DomainId, parsed.options);
  }
  if (command === "unclassified" && operands.length === 0) {
    return broker.unclassified(parsed.options);
  }
  if (command === "runtime" && operands.length === 1) {
    if (operands[0] !== "codex") throw new Error(`unknown observed runtime: ${operands[0]}`);
    return broker.runtime("codex", parsed.options);
  }
  if (command === "recommend" && operands.length > 0) {
    return broker.recommend(operands.join(" "), parsed.options);
  }
  if (command === "provenance" && operands.length === 0) {
    return {
      status: "held",
      provenance: broker.index.provenance,
      sources: broker.index.sources
    };
  }
  throw new Error(
    "Usage: npm run broker -- domains|domain <id> [--cursor N] [--limit 1..20]|unclassified [--cursor N] [--limit 1..20]|runtime codex [--cursor N] [--limit 1..20]|recommend <goal> [--cursor N] [--limit 1..20]|provenance|review-queue|official <domain> [--limit 1..3]|prepare-official <domain>|decision-plan --runtime <claude-code|codex> --platform <darwin|linux|win32> --as-of <UTC> (--goal <text> | --domain <id> [...] [--priority <id> --priority <id>])"
  );
}

function parsePageOptions(args: readonly string[]): { operands: string[]; options: PageOptions } {
  const operands: string[] = [];
  const options: PageOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]!;
    if (value === "--limit") {
      const raw = args[index + 1];
      if (raw === undefined || !/^[0-9]+$/u.test(raw)) throw new Error("--limit requires a positive integer");
      options.limit = Number(raw);
      index += 1;
      continue;
    }
    if (value === "--cursor") {
      const raw = args[index + 1];
      if (raw === undefined) throw new Error("--cursor requires a value");
      options.cursor = raw;
      index += 1;
      continue;
    }
    operands.push(value);
  }
  return { operands, options };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  process.exitCode = await runDiscoveryCli(process.argv.slice(2));
}
