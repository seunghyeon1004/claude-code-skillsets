import { constants, type BigIntStats } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export interface ContainedReadRoot {
  path: string;
}

export async function canonicalizeContainedReadRoot(root: string): Promise<ContainedReadRoot> {
  const path = resolve(await realpath(root));
  const stat = await lstat(path);
  if (!stat.isDirectory()) throw new Error("repository root: must be a directory");
  return { path };
}

/** Reads one contained regular file through a stable descriptor. */
export async function readContainedRegularFile(
  root: ContainedReadRoot,
  relativePath: string
): Promise<Buffer> {
  const { canonicalPath } = await resolveContainedPath(root, relativePath);
  let handle;
  try {
    handle = await open(canonicalPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) throw new Error(`${relativePath}: must be a regular non-symlink file`);
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (!sameFileState(before, after) || BigInt(bytes.byteLength) !== after.size) {
      throw new Error(`${relativePath}: changed while it was being read`);
    }
    return bytes;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(`${relativePath}:`)) throw error;
    throw new Error(`${relativePath}: unable to safely read regular file`, { cause: error });
  } finally {
    await handle?.close();
  }
}

async function resolveContainedPath(
  root: ContainedReadRoot,
  relativePath: string
): Promise<{ lexicalPath: string; canonicalPath: string }> {
  const lexicalPath = resolve(root.path, relativePath);
  assertWithinRoot(root.path, lexicalPath, relativePath);
  let canonicalPath: string;
  try {
    const stat = await lstat(lexicalPath);
    if (stat.isSymbolicLink()) {
      throw new Error(`${relativePath}: must be a regular non-symlink path`);
    }
    canonicalPath = resolve(await realpath(lexicalPath));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(`${relativePath}:`)) throw error;
    throw new Error(`${relativePath}: missing required path`, { cause: error });
  }
  assertWithinRoot(root.path, canonicalPath, relativePath);
  return { lexicalPath, canonicalPath };
}

function assertWithinRoot(root: string, path: string, relativePath: string): void {
  const withinRoot = relative(root, path);
  if (withinRoot === ".." || withinRoot.startsWith(`..${sep}`) || isAbsolute(withinRoot)) {
    throw new Error(`${relativePath}: resolved path escapes repository root`);
  }
}

function sameFileState(
  left: BigIntStats,
  right: BigIntStats
): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}
