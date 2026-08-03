import { lstat, readFile, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, sep } from "node:path";
import { canonicalSetupStateJson } from "../state/setup-state.js";

export interface SetupPublisherRuntimeIdentity {
  executablePath: string;
  version: string;
  sha256: string;
}

export const SETUP_STATE_SNAPSHOT_PLACEHOLDER = "<BASE64URL_CANONICAL_SETUP_SNAPSHOT>";
export const SETUP_STATE_PUBLISHER_RUNTIME_PATH_PLACEHOLDER = "<SHELL_QUOTED_ABSOLUTE_NODE_PATH>";
export const SETUP_STATE_PUBLISHER_RUNTIME_IDENTITY_PLACEHOLDER = "<BASE64URL_PUBLISHER_RUNTIME_IDENTITY>";
export const SETUP_STATE_EXPECTED_PRIOR_DIGEST_PLACEHOLDER = "<EXPECTED_PRIOR_SETUP_STATE_DIGEST>";

export const SETUP_STATE_PUBLISHER_PROGRAM = `const f=require("node:fs"),o=require("node:os"),p=require("node:path"),c=require("node:crypto");const bad=m=>{throw new Error(m)};const missing=e=>e&&e.code==="ENOENT";const runtimeRaw=Buffer.from(process.argv[1],"base64url").toString("utf8"),runtime=JSON.parse(runtimeRaw),runtimeCanonical=JSON.stringify(runtime,null,2)+"\\n";if(runtimeRaw!==runtimeCanonical)bad("publisher runtime identity is not canonical JSON");const actual=p.resolve(f.realpathSync(process.execPath));if(actual!==runtime.executablePath||process.versions.node!==runtime.version||c.createHash("sha256").update(f.readFileSync(actual)).digest("hex")!==runtime.sha256)bad("publisher runtime identity changed after approval");const noLinks=(x,allowMissing)=>{const a=p.resolve(x),parts=a.split(p.sep).filter(Boolean);let q=p.parse(a).root;for(const part of parts){q=p.join(q,part);try{const s=f.lstatSync(q);if(s.isSymbolicLink())bad("setup state path contains a symlink");if(q!==a&&!s.isDirectory())bad("setup state ancestor is not a directory")}catch(e){if(allowMissing&&missing(e))return;throw e}}};const regularDir=x=>{const s=f.lstatSync(x);if(s.isSymbolicLink()||!s.isDirectory())bad("setup state directory is not regular")};const regularFile=x=>{const s=f.lstatSync(x);if(s.isSymbolicLink()||!s.isFile())bad("setup state file is not regular")};if(!Number.isInteger(f.constants.O_NOFOLLOW)||!Number.isInteger(f.constants.O_DIRECTORY))bad("required atomic state flags unavailable");const raw=Buffer.from(process.argv[2],"base64url").toString("utf8"),value=JSON.parse(raw),canonical=JSON.stringify(value,null,2)+"\\n";if(raw!==canonical)bad("setup snapshot is not canonical JSON");const project=p.join(o.homedir(),".claude","claude-code-skillsets"),dir=p.join(project,"state"),target=p.join(dir,"install-lock.json"),temp=p.join(dir,".install-lock.json.tmp-"+c.randomBytes(16).toString("hex"));let fd,renamed=false;try{noLinks(dir,true);f.mkdirSync(dir,{recursive:true,mode:448});noLinks(dir,false);regularDir(project);regularDir(dir);f.chmodSync(project,448);f.chmodSync(dir,448);noLinks(temp,true);fd=f.openSync(temp,f.constants.O_WRONLY|f.constants.O_CREAT|f.constants.O_EXCL|f.constants.O_NOFOLLOW,384);f.fchmodSync(fd,384);regularFile(temp);f.writeFileSync(fd,raw,"utf8");f.fsyncSync(fd);f.closeSync(fd);fd=undefined;regularFile(temp);noLinks(target,true);try{regularFile(target)}catch(e){if(!missing(e))throw e}f.renameSync(temp,target);renamed=true;const d=f.openSync(dir,f.constants.O_RDONLY|f.constants.O_DIRECTORY);try{f.fsyncSync(d)}finally{f.closeSync(d)}}finally{if(fd!==undefined)try{f.closeSync(fd)}catch{}if(!renamed)try{f.rmSync(temp,{force:true})}catch{}}`;

/**
 * The expected-prior-digest stale check detects changed durable state before
 * rename. It is not a compare-and-swap primitive: a same-user writer that
 * ignores the execution lock can still write after this check and before rename.
 */
export const SETUP_STATE_PUBLISHER_PROGRAM_WITH_EXPECTED_PRIOR_DIGEST_STALE_CHECK = publisherProgramWithExpectedPriorDigestStaleCheck(
  SETUP_STATE_PUBLISHER_PROGRAM
);

export const LEGACY_SETUP_STATE_PUBLISHER_COMMAND_TEMPLATE = `${SETUP_STATE_PUBLISHER_RUNTIME_PATH_PLACEHOLDER} -e '${SETUP_STATE_PUBLISHER_PROGRAM}' '${SETUP_STATE_PUBLISHER_RUNTIME_IDENTITY_PLACEHOLDER}' '${SETUP_STATE_SNAPSHOT_PLACEHOLDER}'`;

/**
 * Complete standard-Claude Bash command template used by the installed prompt.
 * Only the base64url canonical snapshot argument is substituted after verified
 * phase results exist; the approval preview binds every other byte.
 */
export const SETUP_STATE_PUBLISHER_COMMAND_TEMPLATE = `${SETUP_STATE_PUBLISHER_RUNTIME_PATH_PLACEHOLDER} -e '${SETUP_STATE_PUBLISHER_PROGRAM_WITH_EXPECTED_PRIOR_DIGEST_STALE_CHECK}' '${SETUP_STATE_PUBLISHER_RUNTIME_IDENTITY_PLACEHOLDER}' '${SETUP_STATE_SNAPSHOT_PLACEHOLDER}' '${SETUP_STATE_EXPECTED_PRIOR_DIGEST_PLACEHOLDER}'`;

export async function observeSetupPublisherRuntimeIdentity(): Promise<SetupPublisherRuntimeIdentity> {
  const executablePath = resolve(await realpath(process.execPath));
  const metadata = await lstat(executablePath);
  if (!isCanonicalAbsolutePath(executablePath) || metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error("Setup publisher runtime path is not one canonical regular executable");
  }
  return {
    executablePath,
    version: process.versions.node,
    sha256: createHash("sha256").update(await readFile(executablePath)).digest("hex")
  };
}

export async function verifySetupPublisherRuntimeIdentity(
  expected: SetupPublisherRuntimeIdentity
): Promise<void> {
  assertPublisherRuntimeIdentity(expected);
  const current = await observeSetupPublisherRuntimeIdentity();
  if (current.executablePath !== expected.executablePath
    || current.version !== expected.version
    || current.sha256 !== expected.sha256) {
    throw new Error("Setup publisher runtime identity changed after approval");
  }
}

export function setupStatePublisherCommandTemplate(identity: SetupPublisherRuntimeIdentity): string {
  assertPublisherRuntimeIdentity(identity);
  const encodedIdentity = Buffer.from(serializeSnapshot(identity), "utf8").toString("base64url");
  return SETUP_STATE_PUBLISHER_COMMAND_TEMPLATE
    .replace(SETUP_STATE_PUBLISHER_RUNTIME_PATH_PLACEHOLDER, shellQuote(identity.executablePath))
    .replace(SETUP_STATE_PUBLISHER_RUNTIME_IDENTITY_PLACEHOLDER, encodedIdentity);
}

export function legacySetupStatePublisherCommandTemplate(
  identity: SetupPublisherRuntimeIdentity
): string {
  assertPublisherRuntimeIdentity(identity);
  const encodedIdentity = Buffer.from(serializeSnapshot(identity), "utf8").toString("base64url");
  return LEGACY_SETUP_STATE_PUBLISHER_COMMAND_TEMPLATE
    .replace(SETUP_STATE_PUBLISHER_RUNTIME_PATH_PLACEHOLDER, shellQuote(identity.executablePath))
    .replace(SETUP_STATE_PUBLISHER_RUNTIME_IDENTITY_PLACEHOLDER, encodedIdentity);
}

/** Renders the exact installed-skill tool command from a verified snapshot. */
export function renderSetupStatePublisherCommand(
  value: unknown,
  identity: SetupPublisherRuntimeIdentity,
  expectedPriorDigest: string | null
): string {
  if (expectedPriorDigest !== null && !/^[0-9a-f]{64}$/u.test(expectedPriorDigest)) {
    throw new Error("Invalid expected setup state digest");
  }
  const serialized = canonicalSetupStateJson(value);
  const encoded = Buffer.from(serialized, "utf8").toString("base64url");
  return setupStatePublisherCommandTemplate(identity)
    .replace(SETUP_STATE_SNAPSHOT_PLACEHOLDER, encoded)
    .replace(SETUP_STATE_EXPECTED_PRIOR_DIGEST_PLACEHOLDER, expectedPriorDigest ?? "missing");
}

function publisherProgramWithExpectedPriorDigestStaleCheck(program: string): string {
  const expected = program.replace(
    "const project=p.join",
    "const expected=process.argv[3];if(expected!==\"missing\"&&!/^[0-9a-f]{64}$/.test(expected))bad(\"invalid expected setup state digest\");const project=p.join"
  );
  const guarded = expected.replace(
    "noLinks(target,true);try{regularFile(target)}catch(e){if(!missing(e))throw e}f.renameSync(temp,target)",
    "noLinks(target,true);let prior=\"missing\";try{regularFile(target);prior=c.createHash(\"sha256\").update(f.readFileSync(target)).digest(\"hex\")}catch(e){if(!missing(e))throw e}if(prior!==expected)bad(\"expected-prior-digest stale check failed; run /skillset-manager:doctor\");f.renameSync(temp,target)"
  );
  if (expected === program || guarded === expected) {
    throw new Error("Setup state publisher expected-prior-digest stale-check transform is stale");
  }
  return guarded;
}

function serializeSnapshot(value: unknown): string {
  const serialized = JSON.stringify(value, null, 2);
  if (serialized === undefined) throw new Error("Setup lock snapshot must be JSON-serializable");
  return `${serialized}\n`;
}

function assertPublisherRuntimeIdentity(value: SetupPublisherRuntimeIdentity): void {
  if (!isCanonicalAbsolutePath(value.executablePath)
    || !/^\d+\.\d+\.\d+$/.test(value.version)
    || !/^[0-9a-f]{64}$/.test(value.sha256)) {
    throw new Error("Invalid setup publisher runtime identity");
  }
}

function isCanonicalAbsolutePath(value: string): boolean {
  return value.startsWith(sep) && resolve(value) === value && value === value.normalize("NFC")
    && !value.includes("\0");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}
