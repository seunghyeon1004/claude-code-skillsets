import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  validateDecisionCandidateEvidence,
  validateDecisionIndex,
  validateDecisionIntents
} from "../../src/contracts/decision.js";
import { projectCandidate, projectDecisionCandidates } from "../../src/decision/candidate-projection.js";
import { generateDecisionIndex } from "../../src/generate/decision-index.js";
import {
  loadDecisionIndex,
  loadDecisionManifests,
  verifiedOfficialMarketplaceIdentityFor
} from "../../src/decision/repository.js";
import { assertDecisionIndexIntegrity, decisionIndexDigest } from "../../src/decision/index-loader.js";
import { COMPLETE_V1_DOMAIN_IDS } from "../../src/model/complete-v1.js";
import { materializeApprovedOfficialMarketplaceFixture } from "../helpers/official-marketplace-fixture.js";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("decision contracts", () => {
  it("rejects capability coverage without current evidence", () => {
    const value = validCandidateEvidence();
    value.candidates[0]!.capabilityEvidenceIds = [];

    expect(() => validateDecisionCandidateEvidence(value)).toThrow(/evidence/i);
  });

  it("requires every domain and bounded required capabilities", async () => {
    const repository = await loadDecisionManifests(projectRoot);

    expect(repository.profiles.map(({ domainId }) => domainId)).toEqual(
      COMPLETE_V1_DOMAIN_IDS
    );
    expect(repository.profiles.every((profile) =>
      profile.requiredCapabilityIds.length >= 1 && profile.requiredCapabilityIds.length <= 3
    )).toBe(true);
  });

  it("keeps related evidence out of capability coverage unless separate current support exists", () => {
    const value = validCandidateEvidence();
    const candidate = value.candidates[0]!;
    const related = value.evidence[0]!;
    candidate.providedCapabilityIds = [];
    related.kind = "official-listing";
    related.support = "related";
    related.listingExcerpt = "promotion evidence";
    related.listingExcerptSha256 = "a".repeat(64);

    expect(validateDecisionCandidateEvidence(value)).toEqual(value);

    candidate.providedCapabilityIds = [related.capabilityId];
    expect(() => validateDecisionCandidateEvidence(value)).toThrow(/related.*must not provide|non-related/i);

    const direct = { ...structuredClone(related), id: "official-commerce-promotion-direct", support: "direct" as const };
    candidate.capabilityEvidenceIds.push(direct.id);
    value.evidence.push(direct);
    expect(validateDecisionCandidateEvidence(value)).toEqual(value);
  });

  it("rejects unknown properties and duplicate normalized phrases", async () => {
    const intents = await readDocument<IntentDocument>(projectRoot, "manifests/decision-intents.yaml");
    const withUnknownProperty = structuredClone(intents);
    withUnknownProperty.profiles[0]!.unexpected = true;

    expect(() => validateDecisionIntents(withUnknownProperty)).toThrow(/additional propert|unexpected/i);

    const withDuplicatePhrase = structuredClone(intents);
    withDuplicatePhrase.profiles[0]!.phrases.ko = ["쇼핑몰 상품 홍보 매출", "쇼핑몰  상품 홍보, 매출!"];

    expect(() => validateDecisionIntents(withDuplicatePhrase)).toThrow(/phrase/i);
  });

  it("rejects duplicate profile IDs", async () => {
    const intents = await readDocument<IntentDocument>(projectRoot, "manifests/decision-intents.yaml");
    intents.profiles[1]!.id = intents.profiles[0]!.id;

    expect(() => validateDecisionIntents(intents)).toThrow(/duplicate profile ID/i);
  });

  it("rejects missing capabilities and evidence IDs that do not resolve", async () => {
    const root = await createFixtureRoot();
    const intents = await readDocument<{ profiles: Array<{ coreCapabilityId: string }> }>(
      root,
      "manifests/decision-intents.yaml"
    );
    const originalCoreCapabilityId = intents.profiles[0]!.coreCapabilityId;
    intents.profiles[0]!.coreCapabilityId = "missing-capability";
    await writeJson(root, "manifests/decision-intents.yaml", intents);

    await expect(loadDecisionManifests(root)).rejects.toThrow(/capability/i);

    intents.profiles[0]!.coreCapabilityId = originalCoreCapabilityId;
    await writeJson(root, "manifests/decision-intents.yaml", intents);
    const candidateEvidence = await readDocument<{
      candidates: Array<{ capabilityEvidenceIds: string[] }>;
    }>(root, "manifests/decision-candidate-evidence.yaml");
    candidateEvidence.candidates[0]!.capabilityEvidenceIds = ["missing-evidence"];
    await writeJson(root, "manifests/decision-candidate-evidence.yaml", candidateEvidence);

    await expect(loadDecisionManifests(root)).rejects.toThrow(/evidence/i);
  });

  it("requires each claimed capability to reference current official baseline or observation evidence", () => {
    const value = validCandidateEvidence();
    value.evidence[0]!.current = false;

    expect(() => validateDecisionCandidateEvidence(value)).toThrow(/current.*evidence|evidence.*current/i);
  });

  it("requires official-listing evidence fields and forbids incompatible source artifact fields", () => {
    const missingListingFields = validCandidateEvidence();
    missingListingFields.evidence[0]!.kind = "official-listing";
    expect(() => validateDecisionCandidateEvidence(missingListingFields)).toThrow(
      /listingExcerpt|listingExcerptSha256|support/i
    );

    const incompatibleFields = validCandidateEvidence();
    incompatibleFields.evidence[0]!.kind = "official-listing";
    incompatibleFields.evidence[0]!.support = "direct";
    incompatibleFields.evidence[0]!.listingExcerpt = "promotion evidence";
    incompatibleFields.evidence[0]!.listingExcerptSha256 = "a".repeat(64);
    incompatibleFields.evidence[0]!.sourceBlobs = [];
    expect(() => validateDecisionCandidateEvidence(incompatibleFields)).toThrow(/sourceBlobs|incompatible|must not/i);

    const relatedNonListing = validCandidateEvidence();
    relatedNonListing.evidence[0]!.support = "related";
    expect(() => validateDecisionCandidateEvidence(relatedNonListing)).toThrow(/support|related/i);
  });

  it("round-trips the Codex target platform through the candidate-evidence manifest", () => {
    const value = validCandidateEvidence();
    value.candidates[0] = {
      ...value.candidates[0]!,
      runtime: "codex",
      skillPath: "skills/commerce/SKILL.md",
      revisionBinding: "exact",
      codexInstall: {
        repository: "https://github.com/example/commerce",
        commit: "a".repeat(40),
        skillPath: "skills/commerce/SKILL.md",
        reviewDecisionId: "commerce-codex-approved",
        compatibilityEvidence: "codex-darwin-compatibility",
        targetPlatform: "darwin"
      }
    };

    expect(validateDecisionCandidateEvidence(value)).toEqual(value);
  });

  it("validates every evidence capability ID against Complete v1", async () => {
    const root = await createFixtureRoot();
    const claims = await readDocument<OfficialListingClaimsDocument>(
      root,
      "manifests/official-listing-capability-claims.yaml"
    );
    claims.candidates[0]!.assignments[0]!.capabilityClaims[0]!.capabilityId = "missing-capability";
    await writeJson(root, "manifests/official-listing-capability-claims.yaml", claims);

    await expect(loadDecisionManifests(root)).rejects.toThrow(
      /capability does not exist in the Complete v1 taxonomy/i
    );
  });

  it.each([
    ["content hash", async (root: string) => {
      const claims = await readDocument<OfficialListingClaimsDocument>(root, "manifests/official-listing-capability-claims.yaml");
      claims.candidates[0]!.assignments[0]!.capabilityClaims[0]!.listingExcerptSha256 = "0".repeat(64);
      await writeJson(root, "manifests/official-listing-capability-claims.yaml", claims);
    }, /listing excerpt SHA-256 mismatch/i],
    ["source binding", async (root: string) => {
      const source = await readDocument<{ repository: string }>(root, "research/sources/anthropic-plugins-official.json");
      source.repository = "https://github.com/example/fabricated-source";
      await writeJson(root, "research/sources/anthropic-plugins-official.json", source);
    }, /source.*bind|bind.*source/i],
    ["official baseline reference", async (root: string) => {
      const claims = await readDocument<OfficialListingClaimsDocument>(root, "manifests/official-listing-capability-claims.yaml");
      claims.candidates[0]!.marketplaceReference = "research/marketplaces/claude-plugins-official-e3e378c.json#/plugins/999";
      await writeJson(root, "manifests/official-listing-capability-claims.yaml", claims);
    }, /reference/i]
  ])("does not trust current:true without verified %s", async (_caseName, mutate, expected) => {
    const root = await createFixtureRoot();
    await mutate(root);

    await expect(loadDecisionManifests(root)).rejects.toThrow(expected);
  });

  it("does not let obsolete observation evidence supersede an exact revision tail", async () => {
    const root = await createFixtureRoot();
    const document = await readDocument<CandidateEvidenceDocument>(root, "manifests/decision-candidate-evidence.yaml");
    document.evidence[0]!.kind = "observation";
    document.evidence[0]!.reference = "research/snapshots/2026-07-23-anthropic-plugins-official.json#/entries/0";
    document.evidence[0]!.contentSha256 = "355696da746e58e1e197be509236d8f8e6a7c5f8f7437c1a71ff32896c866c05";
    await writeJson(root, "manifests/decision-candidate-evidence.yaml", document);

    const repository = await loadDecisionManifests(root);
    expect(repository.candidateEvidence.some(({ kind }) => kind === "observation")).toBe(false);

    document.evidence[0]!.contentSha256 = "0".repeat(64);
    await writeJson(root, "manifests/decision-candidate-evidence.yaml", document);
    const unchanged = await loadDecisionManifests(root);
    expect(unchanged.candidateEvidence.some(({ kind }) => kind === "observation")).toBe(false);
  });

  it("applies the candidate graph checks to runtime decision indexes", () => {
    const duplicateProfile = validDecisionIndex();
    duplicateProfile.profiles.push(structuredClone(duplicateProfile.profiles[0]!));
    expect(() => validateDecisionIndex(duplicateProfile)).toThrow(/duplicate profile ID/i);

    const duplicateCandidate = validDecisionIndex();
    duplicateCandidate.candidates.push(structuredClone(duplicateCandidate.candidates[0]!));
    expect(() => validateDecisionIndex(duplicateCandidate)).toThrow(/duplicate candidate ID/i);

    const unresolvedEvidence = validDecisionIndex();
    unresolvedEvidence.candidates[0]!.capabilityEvidenceIds = ["missing-evidence"];
    expect(() => validateDecisionIndex(unresolvedEvidence)).toThrow(/resolve to evidence/i);

    const inconsistentCandidate = validDecisionIndex();
    inconsistentCandidate.candidateEvidence[0]!.candidate.sourceId = "different-source";
    expect(() => validateDecisionIndex(inconsistentCandidate)).toThrow(/exactly match/i);

    const staleClaim = validDecisionIndex();
    staleClaim.candidateEvidence[0]!.current = false;
    expect(() => validateDecisionIndex(staleClaim)).toThrow(/current capability evidence/i);
  });

  it("requires intent fixtures in the closed decision-index contract", () => {
    const missingFixtures = validDecisionIndex();
    delete missingFixtures.intentFixtures;

    expect(() => validateDecisionIndex(missingFixtures)).toThrow(/intentFixtures/i);
  });

  it("rejects an all-commerce corpus even when its fixtures and digest are recomputed", async () => {
    const root = await createFixtureRoot();
    const index = await rootedDecisionIndex(root);
    for (const profile of index.profiles) profile.domainId = "commerce";
    index.intentFixtures = index.profiles.map((profile) => ({
      id: `single-${profile.id}`,
      runtime: "claude-code",
      platform: "darwin",
      asOf: index.observedThrough,
      domainIds: ["commerce"]
    }));
    refreshDecisionIndexDigest(index);

    expect(() => assertDecisionIndexIntegrity(index as never)).toThrow(/Complete v1 domain profile/i);
  });

  it("rejects rehashed runtime listing evidence that omits listing-only proof fields", async () => {
    const root = await createFixtureRoot();
    const index = await rootedDecisionIndex(root);
    index.candidateEvidence[0]!.kind = "official-listing";
    delete index.candidateEvidence[0]!.support;
    delete index.candidateEvidence[0]!.listingExcerpt;
    delete index.candidateEvidence[0]!.listingExcerptSha256;
    refreshDecisionIndexDigest(index);

    expect(() => assertDecisionIndexIntegrity(index as never)).toThrow(/official-listing|listingExcerpt|support/i);
  });

  it("loads runtime decision indexes only after Complete v1 taxonomy validation", async () => {
    const root = await createFixtureRoot();
    const index = await rootedDecisionIndex(root);
    await mkdir(join(root, "generated"), { recursive: true });
    await writeJson(root, "generated/decision-index.json", index);

    await expect(loadDecisionIndex(root)).resolves.toEqual(expect.objectContaining({
      profiles: expect.any(Array)
    }));

    const partial = structuredClone(index);
    partial.profiles = partial.profiles.slice(0, 1);
    await writeJson(root, "generated/decision-index.json", partial);
    await expect(loadDecisionIndex(root)).rejects.toThrow(/profiles.*Complete v1|Complete v1.*profiles/i);

    const fabricatedDomain = structuredClone(index);
    fabricatedDomain.profiles[0]!.domainId = "fabricated-domain";
    await writeJson(root, "generated/decision-index.json", fabricatedDomain);
    await expect(loadDecisionIndex(root)).rejects.toThrow(/fabricated-domain.*Complete v1|Complete v1.*fabricated-domain/i);

    const fabricatedProfileCapability = structuredClone(index);
    fabricatedProfileCapability.profiles[0]!.coreCapabilityId = "fabricated-profile-capability";
    await writeJson(root, "generated/decision-index.json", fabricatedProfileCapability);
    await expect(loadDecisionIndex(root)).rejects.toThrow(/fabricated-profile-capability.*Complete v1|Complete v1.*fabricated-profile-capability/i);

    const fabricatedCandidateAndEvidenceCapability = structuredClone(index);
    const fabricatedCandidateIndex = fabricatedCandidateAndEvidenceCapability.candidates
      .findIndex(({ id }) => id === "monday-crm");
    const fabricatedCandidate = fabricatedCandidateAndEvidenceCapability.candidates[fabricatedCandidateIndex]!;
    fabricatedCandidate.providedCapabilityIds = ["fabricated-capability"];
    for (const evidence of fabricatedCandidateAndEvidenceCapability.candidateEvidence) {
      if (evidence.candidateId === fabricatedCandidate.id) {
        evidence.capabilityId = "fabricated-capability";
        evidence.support = "direct";
      }
    }
    syncCandidateEvidence(fabricatedCandidateAndEvidenceCapability);
    await writeJson(root, "generated/decision-index.json", fabricatedCandidateAndEvidenceCapability);
    await expect(loadDecisionIndex(root)).rejects.toThrow(
      new RegExp(`candidates\\/${fabricatedCandidateIndex}\\/providedCapabilityIds\\/0.*fabricated-capability`, "i")
    );
    await expect(loadDecisionIndex(root)).rejects.toThrow(/evidence\/\d+\/capabilityId.*fabricated-capability/i);
  });

  it("binds a root decision index catalogVersion to the current validated manifest projection", async () => {
    const root = await createFixtureRoot();
    const index = await rootedDecisionIndex(root);
    await mkdir(join(root, "generated"), { recursive: true });
    await writeJson(root, "generated/decision-index.json", index);

    const intents = await readDocument<IntentDocument>(root, "manifests/decision-intents.yaml");
    intents.profiles[0]!.phrases.ko[0] = "쇼핑몰 운영 변경";
    await writeJson(root, "manifests/decision-intents.yaml", intents);

    await expect(loadDecisionIndex(root)).rejects.toThrow(/catalogVersion.*manifest|manifest.*catalogVersion/i);
  });

  it("rejects a substituted catalogVersion even when the index digest is recomputed", async () => {
    const root = await createFixtureRoot();
    const index = await rootedDecisionIndex(root);
    index.catalogVersion = "f".repeat(64);
    refreshDecisionIndexDigest(index);
    await mkdir(join(root, "generated"), { recursive: true });
    await writeJson(root, "generated/decision-index.json", index);

    await expect(loadDecisionIndex(root)).rejects.toThrow(/catalogVersion.*manifest|manifest.*catalogVersion/i);
  });

  it("brands only root-validated marketplace identities and derives their install route", async () => {
    const root = await createFixtureRoot({ eligible: true });
    const index = await rootedDecisionIndex(root);
    await mkdir(join(root, "generated"), { recursive: true });
    await writeJson(root, "generated/decision-index.json", index);

    const loaded = await loadDecisionIndex(root);
    const candidate = loaded.candidates.find(({ id }) => id === "exa")!;
    const identity = verifiedOfficialMarketplaceIdentityFor(loaded, candidate);
    expectDeepFrozen(loaded);
    expect(identity).toEqual({
      marketplaceId: "claude-plugins-official",
      pluginName: "exa",
      displayName: "exa",
      description: "Exa AI web search, deep research, and content extraction. Provides MCP tools and research skills for comprehensive web search, people discovery, company research, academic papers, and more.",
      marketplaceSource: "anthropics/claude-plugins-official",
      scope: "user",
      argv: ["claude", "plugin", "install", "exa@claude-plugins-official", "--scope", "user"],
      installRoute: "claude plugin install exa@claude-plugins-official --scope user"
    });

    expect(() => {
      candidate.sourceId = "tampered-source";
    }).toThrow(TypeError);
    expect(() => {
      candidate.permissions.evidence.push({ path: "tampered", contentSha256: "0".repeat(64) });
    }).toThrow(TypeError);

    const targetCompatibilityEvidence = [{
      candidateId: candidate.id,
      runtime: "claude-code" as const,
      platform: "darwin" as const,
      compatibility: "verified" as const
    }];
    const authorized = projectDecisionCandidates(loaded, {
      runtime: "claude-code",
      platform: "darwin",
      asOf: loaded.observedThrough,
      targetCompatibilityEvidence
    }).find(({ id }) => id === candidate.id);
    expect(authorized).toMatchObject({
      state: "eligible-with-disclosures",
      stateReasons: expect.arrayContaining(["target-verified:claude-code/darwin"])
    });

    const fabricated = projectDecisionCandidates(structuredClone(loaded), {
      runtime: "claude-code",
      platform: "darwin",
      asOf: loaded.observedThrough,
      targetCompatibilityEvidence
    }).find(({ id }) => id === candidate.id);
    expect(fabricated).toMatchObject({
      state: "held",
      stateReasons: ["exact-path-approval-required"]
    });

    const unboundCandidate = structuredClone(candidate);
    unboundCandidate.sourceId = "tampered-source";
    expect(verifiedOfficialMarketplaceIdentityFor(loaded, unboundCandidate)).toBeUndefined();
    expect(projectCandidate({
      candidate: unboundCandidate,
      runtime: "claude-code",
      platform: "darwin",
      asOf: loaded.observedThrough,
      catalogFresh: true,
      officialMarketplaceIdentity: identity,
      individualSafetyReview: "not-complete",
      targetCompatibility: targetCompatibilityEvidence[0],
      evidenceCurrent: true
    })).toMatchObject({ state: "held", stateReasons: ["exact-path-approval-required"] });
  });

  it.each([
    ["source", (index: DecisionIndexDocument) => {
      index.candidates[0]!.claudeInstall!.marketplaceSource = "attacker/marketplace";
    }],
    ["plugin", (index: DecisionIndexDocument) => {
      index.candidates[0]!.claudeInstall!.pluginName = "wrong-plugin";
      index.candidates[0]!.claudeInstall!.argv[3] = "wrong-plugin@claude-plugins-official";
    }],
    ["literal argv", (index: DecisionIndexDocument) => {
      index.candidates[0]!.claudeInstall!.argv[3] = "exa;touch@claude-plugins-official";
    }]
  ])("rejects a generated official install binding with a wrong %s", async (_label, mutate) => {
    const root = await createFixtureRoot({ eligible: true });
    const index = await rootedDecisionIndex(root);
    const installCandidate = index.candidates.find(({ claudeInstall }) => claudeInstall !== undefined);
    if (installCandidate === undefined) throw new Error("eligible fixture omitted its official install binding");
    const candidateIndex = index.candidates.indexOf(installCandidate);
    const reordered = {
      ...index,
      candidates: [installCandidate, ...index.candidates.filter((_, currentIndex) => currentIndex !== candidateIndex)]
    };
    mutate(reordered);
    syncCandidateEvidence(reordered);
    refreshDecisionIndexDigest(reordered);
    await mkdir(join(root, "generated"), { recursive: true });
    await writeJson(root, "generated/decision-index.json", reordered);

    await expect(loadDecisionIndex(root)).rejects.toThrow(/install binding|pluginName|argv/i);
  });

  it("does not let delegated marketplace identity bypass a current human hold", async () => {
    const root = await createFixtureRoot({ eligible: true });
    const index = await rootedDecisionIndex(root);
    await mkdir(join(root, "generated"), { recursive: true });
    await writeJson(root, "generated/decision-index.json", index);

    const loaded = await loadDecisionIndex(root);
    const candidate = loaded.candidates[0]!;
    expect(() => {
      candidate.sourceId = "tampered-source";
    }).toThrow(TypeError);
    expect(candidate.sourceId).toBe("anthropic-plugins-official");

    const [projected] = projectDecisionCandidates(loaded, {
      runtime: "claude-code",
      platform: "darwin",
      asOf: loaded.observedThrough,
      targetCompatibilityEvidence: [{
        candidateId: candidate.id,
        runtime: "claude-code",
        platform: "darwin",
        compatibility: "verified"
      }],
      materializedReviewState: [{
        sourceId: candidate.sourceId,
        skillPath: null,
        state: "held",
        reason: "current",
        decisionId: "human-held-decision",
        invalidatedDecisionId: null,
        snapshotId: "snapshot-a",
        inspectedCommit: "a".repeat(40),
        observedAt: "2026-07-29T00:00:00Z",
        changeStatus: "unchanged"
      }]
    });

    expect(projected).toMatchObject({ state: "held", stateReasons: ["review-held"] });
  });

  it.each([
    ["nonexistent official marketplace pointer", async (root: string) => {
      const index = await rootedDecisionIndex(root);
      index.candidateEvidence[0]!.reference = "research/marketplaces/claude-plugins-official-e3e378c.json#/plugins/999";
      await mkdir(join(root, "generated"), { recursive: true });
      await writeJson(root, "generated/decision-index.json", index);
    }, /reference/i],
    ["zero official marketplace hash", async (root: string) => {
      const index = await rootedDecisionIndex(root);
      index.candidateEvidence[0]!.contentSha256 = "0".repeat(64);
      await mkdir(join(root, "generated"), { recursive: true });
      await writeJson(root, "generated/decision-index.json", index);
    }, /contentSha256/i]
  ])("rejects runtime indexes with %s", async (_caseName, mutate, expected) => {
    const root = await createFixtureRoot();
    await mutate(root);

    await expect(loadDecisionIndex(root)).rejects.toThrow(expected);
  });

  it("rejects runtime indexes when Complete v1 capability collections diverge from the catalog", async () => {
    const root = await createFixtureRoot();
    const index = await rootedDecisionIndex(root);
    await mkdir(join(root, "generated"), { recursive: true });
    await writeJson(root, "generated/decision-index.json", index);

    const collectionPath = "manifests/capabilities/software-engineering.yaml";
    const collection = await readDocument<{ capabilities: Array<{ id: string }> }>(root, collectionPath);
    collection.capabilities.push({ ...collection.capabilities[0]!, id: "foreign-collection-capability" });
    await writeJson(root, collectionPath, collection);

    await expect(loadDecisionIndex(root)).rejects.toThrow(
      /Complete v1 capability identity[\s\S]*Catalog capability IDs do not equal loaded capability IDs/i
    );

    collection.capabilities.pop();
    collection.capabilities.splice(0, 1);
    await writeJson(root, collectionPath, collection);

    await expect(loadDecisionIndex(root)).rejects.toThrow(
      /Complete v1 capability identity[\s\S]*Catalog capability IDs do not equal loaded capability IDs/i
    );
  });
});

function validCandidateEvidence(): CandidateEvidenceDocument {
  return {
    schemaVersion: 3,
    candidates: [{
      id: "official-commerce-promotion",
      sourceId: "official-marketplace-baseline",
      skillPath: null,
      runtime: "claude-code",
      state: "eligible-with-disclosures",
      stateReasons: ["marketplace-listed"],
      providedCapabilityIds: ["run-promotions-and-analyze-revenue"],
      capabilityEvidenceIds: ["official-commerce-promotion-evidence"],
      revisionBinding: "unavailable",
      permissions: { status: "unknown", evidence: [] },
      license: { status: "unknown", evidence: [] },
      trust: { status: "unknown", evidence: [] },
      dependencies: { status: "unknown", evidence: [] }
    }],
    evidence: [{
      id: "official-commerce-promotion-evidence",
      candidateId: "official-commerce-promotion",
      capabilityId: "run-promotions-and-analyze-revenue",
      kind: "official-baseline",
      current: true,
      reference: "official-marketplace-baseline/commerce-promotion",
      contentSha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      support: "direct"
    }]
  };
}

async function createFixtureRoot(options: { eligible?: boolean } = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "decision-contracts-"));
  temporaryRoots.push(root);
  await cp(join(projectRoot, "manifests"), join(root, "manifests"), { recursive: true });
  await cp(join(projectRoot, "research"), join(root, "research"), { recursive: true });
  await cp(join(projectRoot, "governance"), join(root, "governance"), { recursive: true });
  if (options.eligible === true) await materializeApprovedOfficialMarketplaceFixture(root);
  return root;
}

interface IntentDocument {
  schemaVersion: number;
  profiles: IntentProfileDocument[];
}

interface IntentProfileDocument {
  id: string;
  domainId: string;
  phrases: { ko: string[]; en: string[] };
  coreCapabilityId: string;
  requiredCapabilityIds: string[];
  unexpected?: boolean;
}

interface CandidateDocument extends Record<string, unknown> {
  id: string;
  sourceId: string;
  skillPath: string | null;
  runtime: "claude-code" | "codex";
  state: "eligible-with-disclosures" | "held" | "blocked";
  stateReasons: string[];
  providedCapabilityIds: string[];
  capabilityEvidenceIds: string[];
  revisionBinding: "exact" | "unavailable";
  permissions: { status: string; evidence: unknown[] };
  license: { status: string; evidence: unknown[] };
  trust: { status: string; evidence: unknown[] };
  dependencies: { status: string; evidence: unknown[] };
  claudeInstall?: {
    sourceId: string;
    pluginName: string;
    marketplaceId: string;
    marketplaceSource: string;
    scope: "user";
    argv: ["claude", "plugin", "install", string, "--scope", "user"];
  };
  codexInstall?: {
    repository: string;
    commit: string;
    skillPath: string;
    reviewDecisionId: string;
    compatibilityEvidence: string;
    targetPlatform: "darwin" | "linux" | "win32";
  };
}

interface CandidateEvidenceDocument {
  schemaVersion: number;
  candidates: CandidateDocument[];
  candidateRevisions?: Array<{ candidate: CandidateDocument }>;
  officialTargetCompatibilityEvidence?: Array<{ candidateRevisionId?: string }>;
  evidence: Array<{
    id: string;
    candidateId: string;
    capabilityId: string;
    kind: "official-baseline" | "official-listing" | "observation";
    current: boolean;
    reference: string;
    contentSha256: string;
    support?: "direct" | "inferred" | "related";
    sourceBlobs?: unknown[];
    listingExcerpt?: string;
    listingExcerptSha256?: string;
    candidateRevisionId?: string;
  }>;
}

interface OfficialListingClaimsDocument {
  candidates: Array<{
    marketplaceReference: string;
    assignments: Array<{
      capabilityClaims: Array<{
        capabilityId: string;
        listingExcerptSha256: string;
      }>;
    }>;
  }>;
}

function stripCandidateRevisionTail(document: CandidateEvidenceDocument): void {
  delete document.candidateRevisions;
  document.evidence = document.evidence.filter(({ candidateRevisionId }) => candidateRevisionId === undefined);
  document.officialTargetCompatibilityEvidence = document.officialTargetCompatibilityEvidence?.filter(
    ({ candidateRevisionId }) => candidateRevisionId === undefined
  );
}

interface DecisionIndexDocument {
  schemaVersion: number;
  catalogVersion: string;
  observedThrough: string;
  catalogExpiresAt: string;
  profiles: IntentProfileDocument[];
  candidates: CandidateDocument[];
  candidateEvidence: Array<CandidateEvidenceDocument["evidence"][number] & { candidate: CandidateDocument }>;
  intentFixtures?: unknown[];
  digest: string;
}

async function rootedDecisionIndex(root: string): Promise<DecisionIndexDocument> {
  return JSON.parse(await generateDecisionIndex(root)) as DecisionIndexDocument;
}

function refreshDecisionIndexDigest(index: DecisionIndexDocument): void {
  const { digest: _digest, ...withoutDigest } = index;
  index.digest = decisionIndexDigest(withoutDigest as never);
}

function syncCandidateEvidence(index: DecisionIndexDocument): void {
  const candidateById = new Map(index.candidates.map((candidate) => [candidate.id, candidate]));
  for (const evidence of index.candidateEvidence) {
    evidence.candidate = structuredClone(candidateById.get(evidence.candidateId)!);
  }
}

function validDecisionIndex(): DecisionIndexDocument {
  const candidateEvidence = validCandidateEvidence();
  const candidate = candidateEvidence.candidates[0]!;
  const evidence = candidateEvidence.evidence[0]!;
  return {
    schemaVersion: 3,
    catalogVersion: "test-catalog",
    observedThrough: "2026-07-29T00:00:00Z",
    catalogExpiresAt: "2026-08-07T00:00:00Z",
    profiles: [{
      id: "commerce",
      domainId: "commerce",
      phrases: { ko: ["쇼핑몰"], en: ["commerce"] },
      coreCapabilityId: "operate-stores-and-marketplaces",
      requiredCapabilityIds: ["run-promotions-and-analyze-revenue"]
    }],
    candidates: [candidate],
    candidateEvidence: [{ ...evidence, candidate: structuredClone(candidate) }],
    intentFixtures: [{
      id: "single-commerce",
      runtime: "claude-code",
      platform: "darwin",
      asOf: "2026-07-29T00:00:00Z",
      domainIds: ["commerce"]
    }],
    digest: "0".repeat(64)
  };
}

async function readDocument<T>(root: string, relativePath: string): Promise<T> {
  const contents = await readFile(join(root, relativePath), "utf8");
  return parse(contents) as T;
}

async function writeJson(root: string, relativePath: string, value: unknown): Promise<void> {
  await writeFile(join(root, relativePath), JSON.stringify(value));
}

function expectDeepFrozen(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const key of Reflect.ownKeys(value)) {
    expectDeepFrozen(Reflect.get(value, key), seen);
  }
}
