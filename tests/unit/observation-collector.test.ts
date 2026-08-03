import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it, vi } from "vitest";
import { validateObservationEvidence } from "../../src/contracts/observation.js";
import {
  MAX_BLOB_BYTES,
  MAX_SOURCE_BYTES,
  collectObservationEvidence,
  writeObservationEvidenceToStaging
} from "../../src/research/observation-collector.js";

const require = createRequire(import.meta.url);
const observationEvidenceSchema = require("../../schemas/v3/observation-evidence.schema.json") as { $id: string };
const sourceObservationSchema = require("../../schemas/v3/source-observation.schema.json") as { $id: string };
const commit = "a".repeat(40);
const blob = "b".repeat(40);

function input(overrides: Partial<Parameters<typeof collectObservationEvidence>[0]> = {}) {
  const readBlob = vi.fn(async (path: string) => Buffer.from(path === "plugin.json"
    ? JSON.stringify({
      license: "MIT",
      permissions: ["network"],
      author: "fixture-owner",
      dependencies: { ajv: "8.20.0" },
      scripts: { test: "vitest" }
    })
    : "# Fixture\n", "utf8"));
  return {
    id: "2026-07-29-fixture",
    sourceId: "fixture",
    observedAt: "2026-07-29T00:00:00Z",
    inspectedCommit: commit,
    blobs: [
      { path: "plugin.json", gitBlobSha: blob, byteSize: Buffer.byteLength(JSON.stringify({
        license: "MIT",
        permissions: ["network"],
        author: "fixture-owner",
        dependencies: { ajv: "8.20.0" },
        scripts: { test: "vitest" }
      })) },
      { path: "README.md", gitBlobSha: "c".repeat(40), byteSize: 10 }
    ],
    readBlob,
    ...overrides
  };
}

describe("observation collector", () => {
  it("uses the exact bounded read limits", () => {
    expect(MAX_BLOB_BYTES).toBe(256 * 1024);
    expect(MAX_SOURCE_BYTES).toBe(4 * 1024 * 1024);
  });

  it("validates a large sorted blob inventory within a linear-time budget", () => {
    const evidence = {
      schemaVersion: 3,
      id: "2026-07-29-scale-fixture",
      sourceId: "scale-fixture",
      observedAt: "2026-07-29T00:00:00Z",
      inspectedCommit: commit,
      blobs: Array.from({ length: 15_000 }, (_, index) => ({
        path: `unobserved/${String(index).padStart(5, "0")}.txt`,
        gitBlobSha: (index % 16).toString(16).repeat(40),
        byteSize: 0,
        readStatus: "unknown" as const
      })),
      fields: unknownFields()
    };
    const startedAt = performance.now();

    expect(() => validateObservationEvidence(evidence)).not.toThrow();

    expect(performance.now() - startedAt).toBeLessThan(1_500);
  });

  it("rejects duplicate blob paths even when the blob records differ", () => {
    expect(() => validateObservationEvidence({
      schemaVersion: 3,
      id: "2026-07-29-duplicate-fixture",
      sourceId: "duplicate-fixture",
      observedAt: "2026-07-29T00:00:00Z",
      inspectedCommit: commit,
      blobs: [
        { path: "duplicate.txt", gitBlobSha: "a".repeat(40), byteSize: 0, readStatus: "unknown" },
        { path: "duplicate.txt", gitBlobSha: "b".repeat(40), byteSize: 1, readStatus: "unknown" }
      ],
      fields: unknownFields()
    })).toThrow(/paths must be code-point sorted and unique/i);
  });

  it("records direct hashes only for the bounded allowlist", async () => {
    const fixture = input();
    const result = await collectObservationEvidence(fixture);

    expect(fixture.readBlob).toHaveBeenCalledTimes(1);
    expect(fixture.readBlob).toHaveBeenCalledWith("plugin.json");
    expect(result.blobs).toEqual([
      {
        path: "README.md",
        gitBlobSha: "c".repeat(40),
        byteSize: 10,
        readStatus: "unknown"
      },
      {
        path: "plugin.json",
        gitBlobSha: blob,
        byteSize: fixture.blobs[0]!.byteSize,
        readStatus: "observed",
        contentSha256: createHash("sha256").update(await fixture.readBlob("plugin.json")).digest("hex")
      }
    ]);
    expect(result.fields).toEqual({
      license: { status: "observed", evidence: [{ path: "plugin.json", contentSha256: result.blobs[1]!.contentSha256! }] },
      permissions: { status: "observed", evidence: [{ path: "plugin.json", contentSha256: result.blobs[1]!.contentSha256! }] },
      ownership: { status: "observed", evidence: [{ path: "plugin.json", contentSha256: result.blobs[1]!.contentSha256! }] },
      dependencies: { status: "observed", evidence: [{ path: "plugin.json", contentSha256: result.blobs[1]!.contentSha256! }] },
      executableSurface: { status: "observed", evidence: [{ path: "plugin.json", contentSha256: result.blobs[1]!.contentSha256! }] }
    });
  });

  it("collects a newline-containing Git path through observation validation", async () => {
    const path = "skills/new\nline/SKILL.md";
    const contents = Buffer.from("# Fixture\n", "utf8");
    const result = await collectObservationEvidence(input({
      blobs: [{ path, gitBlobSha: blob, byteSize: contents.byteLength }],
      readBlob: vi.fn(async () => contents)
    }));

    expect(result.blobs).toEqual([{
      path,
      gitBlobSha: blob,
      byteSize: contents.byteLength,
      readStatus: "observed",
      contentSha256: createHash("sha256").update(contents).digest("hex")
    }]);
  });

  it.each([
    "../plugin.json",
    "skills/../plugin.json",
    "skills/tab\tname/SKILL.md",
    "skills/carriage\rreturn/SKILL.md",
    "skills/delete\x7fname/SKILL.md",
    "skills/nul\0name/SKILL.md"
  ])("rejects traversal and forbidden control bytes in repository path %j", async (path) => {
    await expect(collectObservationEvidence(input({
      blobs: [{ path, gitBlobSha: blob, byteSize: 1 }],
      readBlob: vi.fn(async () => Buffer.from("x", "utf8"))
    }))).rejects.toThrow(/unsafe|invalid observation evidence/i);
  });

  it("marks an oversized manifest unknown without inventing sensitive facts", async () => {
    const fixture = input({
      blobs: [{ path: "plugin.json", gitBlobSha: blob, byteSize: MAX_BLOB_BYTES + 1 }]
    });
    const result = await collectObservationEvidence(fixture);

    expect(fixture.readBlob).not.toHaveBeenCalled();
    expect(result.blobs[0]).toMatchObject({ readStatus: "unknown" });
    expect(result.fields.permissions.status).toBe("unknown");
    expect(result.fields.license.status).toBe("unknown");
  });

  it("marks later allowlisted blobs unknown once the exact source limit is exhausted", async () => {
    const boundedBlobs = Array.from({ length: MAX_SOURCE_BYTES / MAX_BLOB_BYTES }, (_, index) => ({
      path: `scripts/${String(index).padStart(2, "0")}.sh`,
      gitBlobSha: (index % 10).toString().repeat(40),
      byteSize: MAX_BLOB_BYTES
    }));
    const fixture = input({
      blobs: [
        ...boundedBlobs,
        { path: "scripts/zz.sh", gitBlobSha: "c".repeat(40), byteSize: 1 }
      ],
      readBlob: vi.fn(async (path: string) => Buffer.alloc(path === "scripts/zz.sh" ? 1 : MAX_BLOB_BYTES, "x"))
    });
    const result = await collectObservationEvidence(fixture);

    expect(fixture.readBlob).toHaveBeenCalledTimes(16);
    expect(fixture.readBlob).not.toHaveBeenCalledWith("scripts/zz.sh");
    expect(result.blobs.map(({ readStatus }) => readStatus)).toEqual([...Array(16).fill("observed"), "unknown"]);
  });

  it("keeps unread and unparsable sensitive content unknown", async () => {
    const fixture = input({
      blobs: [{ path: "plugin.json", gitBlobSha: blob, byteSize: 1 }],
      readBlob: vi.fn(async () => Buffer.from("{", "utf8"))
    });
    const result = await collectObservationEvidence(fixture);

    expect(result.blobs[0]).toMatchObject({ readStatus: "observed" });
    expect(Object.values(result.fields).every(({ status }) => status === "unknown")).toBe(true);
  });

  it.each([
    ["permissions", { permissions: ["network", 7] }, "permissions"],
    ["dependencies", { dependencies: { ajv: 7 } }, "dependencies"],
    ["scripts", { scripts: { test: 7 } }, "executableSurface"]
  ] as const)("keeps malformed manifest %s unknown", async (_label, replacement, fieldName) => {
    const manifest = {
      license: "MIT",
      permissions: ["network"],
      author: "fixture-owner",
      dependencies: { ajv: "8.20.0" },
      scripts: { test: "vitest" },
      ...replacement
    };
    const contents = Buffer.from(JSON.stringify(manifest), "utf8");
    const result = await collectObservationEvidence(input({
      blobs: [{ path: "plugin.json", gitBlobSha: blob, byteSize: contents.byteLength }],
      readBlob: vi.fn(async () => contents)
    }));

    expect(result.fields[fieldName]).toEqual({ status: "unknown", evidence: [] });
  });

  it("keeps syntactically invalid MCP configuration unknown", async () => {
    const contents = Buffer.from("{", "utf8");
    const result = await collectObservationEvidence(input({
      blobs: [{ path: ".mcp.json", gitBlobSha: blob, byteSize: contents.byteLength }],
      readBlob: vi.fn(async () => contents)
    }));

    expect(result.fields.executableSurface).toEqual({ status: "unknown", evidence: [] });
  });

  it.each([
    ["plugin.json", ["license: MIT", "permissions:", "  - network", "author: fixture-owner", "dependencies:", "  ajv: 8.20.0", "scripts:", "  test: vitest"].join("\n"), ["license", "permissions", "ownership", "dependencies", "executableSurface"]],
    [".mcp.json", ["mcpServers:", "  fixture:", "    command: node"].join("\n"), ["executableSurface"]]
  ] as const)("does not parse YAML as JSON for %s", async (path, text, fields) => {
    const contents = Buffer.from(text, "utf8");
    const result = await collectObservationEvidence(input({
      blobs: [{ path, gitBlobSha: blob, byteSize: contents.byteLength }],
      readBlob: vi.fn(async () => contents)
    }));

    for (const field of fields) {
      expect(result.fields[field]).toEqual({ status: "unknown", evidence: [] });
    }
  });

  it.each([
    ["manifest.yaml", "permissions:\n  - network\n", "permissions"],
    ["mcp.yaml", "mcpServers:\n  fixture:\n    command: node\n", "executableSurface"]
  ] as const)("parses YAML only from a YAML-named %s", async (path, text, field) => {
    const contents = Buffer.from(text, "utf8");
    const result = await collectObservationEvidence(input({
      blobs: [{ path, gitBlobSha: blob, byteSize: contents.byteLength }],
      readBlob: vi.fn(async () => contents)
    }));

    expect(result.fields[field].status).toBe("observed");
  });

  it.each(validLockfiles())("records dependency evidence from a validated %s", async (path, contents) => {
    const result = await collectObservationEvidence(input({
      blobs: [{ path, gitBlobSha: blob, byteSize: contents.byteLength }],
      readBlob: vi.fn(async () => contents)
    }));

    expect(result.fields.dependencies).toEqual({
      status: "observed",
      evidence: [{ path, contentSha256: result.blobs[0]!.contentSha256! }]
    });
  });

  it.each(malformedLockfiles())("keeps malformed %s dependency evidence unknown", async (path, contents) => {
    const result = await collectObservationEvidence(input({
      blobs: [{ path, gitBlobSha: blob, byteSize: contents.byteLength }],
      readBlob: vi.fn(async () => contents)
    }));

    expect(result.fields.dependencies).toEqual({ status: "unknown", evidence: [] });
  });

  it.each([
    "bin/unreviewed.js",
    "tools/unreviewed.sh",
    ".github/workflows/unreviewed.yml"
  ])("does not fetch arbitrary executable-looking path %s", async (path) => {
    const fixture = input({
      blobs: [{ path, gitBlobSha: blob, byteSize: 1 }],
      readBlob: vi.fn(async () => Buffer.from("x", "utf8"))
    });
    const result = await collectObservationEvidence(fixture);

    expect(fixture.readBlob).not.toHaveBeenCalled();
    expect(result.blobs).toEqual([{ path, gitBlobSha: blob, byteSize: 1, readStatus: "unknown" }]);
    expect(result.fields.executableSurface).toEqual({ status: "unknown", evidence: [] });
  });

  it("rejects externally supplied observed blobs outside the collection allowlist", () => {
    expect(() => validateObservationEvidence({
      schemaVersion: 3,
      id: "2026-07-29-fixture",
      sourceId: "fixture",
      observedAt: "2026-07-29T00:00:00Z",
      inspectedCommit: commit,
      blobs: [{
        path: "README.md",
        gitBlobSha: blob,
        byteSize: 1,
        readStatus: "observed",
        contentSha256: "d".repeat(64)
      }],
      fields: unknownFields()
    })).toThrow(/allowlist/i);
  });

  it("rejects externally supplied observed blobs larger than 256 KiB", () => {
    expect(() => validateObservationEvidence({
      schemaVersion: 3,
      id: "2026-07-29-fixture",
      sourceId: "fixture",
      observedAt: "2026-07-29T00:00:00Z",
      inspectedCommit: commit,
      blobs: [{
        path: "plugin.json",
        gitBlobSha: blob,
        byteSize: MAX_BLOB_BYTES + 1,
        readStatus: "observed",
        contentSha256: "d".repeat(64)
      }],
      fields: unknownFields()
    })).toThrow(/256|262144/i);
  });

  it("rejects externally supplied observed blobs over the 4 MiB total", () => {
    expect(() => validateObservationEvidence({
      schemaVersion: 3,
      id: "2026-07-29-fixture",
      sourceId: "fixture",
      observedAt: "2026-07-29T00:00:00Z",
      inspectedCommit: commit,
      blobs: Array.from({ length: 17 }, (_, index) => ({
        path: `scripts/${String(index).padStart(2, "0")}.sh`,
        gitBlobSha: "0123456789abcdef0"[index]!.repeat(40),
        byteSize: MAX_BLOB_BYTES,
        readStatus: "observed" as const,
        contentSha256: "d".repeat(64)
      })),
      fields: unknownFields()
    })).toThrow(/4 MiB/i);
  });

  it("removes the temporary staging file when beforeCommit fails", async () => {
    const stagingDirectory = await mkdtemp(join(tmpdir(), "observation-staging-"));
    const evidence = await collectObservationEvidence(input());
    const beforeCommit = vi.fn(() => {
      throw new Error("before commit fault");
    });
    try {
      await expect(writeObservationEvidenceToStaging({ evidence, stagingDirectory, beforeCommit })).rejects.toThrow("before commit fault");
      expect(beforeCommit).toHaveBeenCalledTimes(1);
      expect(await readdir(stagingDirectory)).toEqual([]);
    } finally {
      await rm(stagingDirectory, { recursive: true, force: true });
    }
  });

  it("keeps a transport read failure unknown without publishing inferred fields", async () => {
    const fixture = input({
      blobs: [{ path: "plugin.json", gitBlobSha: blob, byteSize: 2 }],
      readBlob: vi.fn(async () => { throw new Error("fixture read failure"); })
    });
    const result = await collectObservationEvidence(fixture);

    expect(result.blobs[0]).toMatchObject({ readStatus: "unknown" });
    expect(Object.values(result.fields).every(({ status }) => status === "unknown")).toBe(true);
  });
});

describe.each([
  ["observation evidence", observationEvidenceSchema],
  ["source observation", sourceObservationSchema]
] as const)("%s raw repositoryPath schema", (_name, schema) => {
  const validatePath = rawRepositoryPathValidator(schema);

  it.each([
    ["preserves an LF-containing Git path", "skills/new\nline/SKILL.md", true],
    ["rejects an empty path segment", "a//b", false],
    ["rejects a trailing separator", "a/", false],
    ["rejects traversal", "skills/../example/SKILL.md", false],
    ["rejects a forbidden control byte", "skills/tab\tname/SKILL.md", false]
  ])("%s", (_label, path, expected) => {
    expect(validatePath(path)).toBe(expected);
  });
});

function unknownFields() {
  return {
    license: { status: "unknown", evidence: [] },
    permissions: { status: "unknown", evidence: [] },
    ownership: { status: "unknown", evidence: [] },
    dependencies: { status: "unknown", evidence: [] },
    executableSurface: { status: "unknown", evidence: [] }
  };
}

function rawRepositoryPathValidator(schema: { $id: string }) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  ajv.addSchema(schema);
  return ajv.compile({ $ref: `${schema.$id}#/$defs/repositoryPath` });
}

function validLockfiles(): Array<[string, Buffer]> {
  return [
    ["package-lock.json", json({ lockfileVersion: 1, dependencies: { ajv: { version: "8.20.0" } } })],
    ["package-lock.json", json({ lockfileVersion: 3, packages: { "node_modules/ajv": { version: "8.20.0" } } })],
    ["npm-shrinkwrap.json", json({ lockfileVersion: 2, dependencies: { ajv: { version: "8.20.0" } } })],
    ["yarn.lock", Buffer.from("# yarn lockfile v1\n\najv@^8.20.0:\n  version \"8.20.0\"\n", "utf8")],
    ["pnpm-lock.yaml", Buffer.from("lockfileVersion: '9.0'\npackages:\n  ajv@8.20.0:\n    resolution:\n      integrity: sha512-fixture\n", "utf8")]
  ];
}

function malformedLockfiles(): Array<[string, Buffer]> {
  return [
    ["package-lock.json", Buffer.from("packages:\n  ajv:\n    version: 8.20.0\n", "utf8")],
    ["npm-shrinkwrap.json", Buffer.from("dependencies:\n  ajv:\n    version: 8.20.0\n", "utf8")],
    ["package-lock.json", json({ lockfileVersion: 999, packages: { "node_modules/ajv": { version: "8.20.0" } } })],
    ["yarn.lock", Buffer.from("ajv@^8.20.0:\n  version\n", "utf8")],
    ["yarn.lock", Buffer.from("ajv@^8.20.0:\n  version \"8.20.0\"\n", "utf8")],
    ["yarn.lock", Buffer.from("# yarn lockfile v999\n\najv@^8.20.0:\n  version \"8.20.0\"\n", "utf8")],
    ["yarn.lock", Buffer.from("# yarn lockfile v1\n\najv@^8.20.0:\n  dependencies:\n    nested:\n      version \"8.20.0\"\n", "utf8")],
    ["pnpm-lock.yaml", Buffer.from("lockfileVersion: '9.0'\npackages: []\n", "utf8")],
    ["pnpm-lock.yaml", Buffer.from("lockfileVersion: 999\npackages:\n  ajv@8.20.0:\n    resolution:\n      integrity: sha512-fixture\n", "utf8")]
  ];
}

function json(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value), "utf8");
}
