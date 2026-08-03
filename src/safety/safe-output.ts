import { lstat, mkdir, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, parse, resolve, sep } from "node:path";

export async function createExclusiveOutputDirectory(directory: string): Promise<void> {
  const target = canonicalAbsolute(directory, "Output directory");
  await assertCanonicalDirectoryAncestors(dirname(target));
  try {
    await lstat(target);
    throw new Error(`Output directory already exists: ${target}`);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  await mkdir(target, { recursive: false, mode: 0o700 });
  const metadata = await lstat(target);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error("Output directory is not a regular directory");
  }
}

export async function writeExclusiveOutputFile(path: string, content: string): Promise<void> {
  const target = canonicalAbsolute(path, "Output file");
  await assertCanonicalDirectoryAncestors(dirname(target));
  try {
    await writeFile(target, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
  } catch (error) {
    if (isAlreadyExists(error)) {
      throw new Error(`Output file already exists: ${target}`);
    }
    throw error;
  }
  const metadata = await lstat(target);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error("Output file is not a regular file");
  }
}

export async function assertCanonicalExistingDirectory(directory: string, label: string): Promise<string> {
  const target = canonicalAbsolute(directory, label);
  await assertCanonicalDirectoryAncestors(target);
  return target;
}

async function assertCanonicalDirectoryAncestors(directory: string): Promise<void> {
  const canonical = await realpath(directory);
  if (resolve(canonical) !== directory) {
    throw new Error(`Output path contains a symbolic link or noncanonical ancestor: ${directory}`);
  }
  const { root } = parse(directory);
  let current = root;
  for (const segment of directory.slice(root.length).split(sep).filter(Boolean)) {
    current = resolve(current, segment);
    const metadata = await lstat(current);
    if (metadata.isSymbolicLink()) throw new Error(`Output path contains a symbolic link: ${current}`);
    if (!metadata.isDirectory()) throw new Error(`Output path ancestor is not a directory: ${current}`);
  }
}

function canonicalAbsolute(path: string, label: string): string {
  if (!isAbsolute(path)) throw new Error(`${label} must be absolute`);
  if (path.split(sep).includes("..")) throw new Error(`${label} must not contain parent traversal`);
  const target = resolve(path);
  if (target !== path) throw new Error(`${label} must be canonical`);
  return target;
}

function isMissing(error: unknown): boolean {
  return isCode(error, "ENOENT");
}

function isAlreadyExists(error: unknown): boolean {
  return isCode(error, "EEXIST");
}

function isCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && (error as { code?: unknown }).code === code;
}
