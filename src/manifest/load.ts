import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import { parse } from "yaml";
import type {
  DomainManifest,
  ExternalSourceManifest,
  LocalPluginManifest,
  PackManifest
} from "../model/manifest.js";

const require = createRequire(import.meta.url);
const domainSchema = require("../../schemas/domain.schema.json") as object;
const packSchema = require("../../schemas/pack.schema.json") as object;
const pluginSchema = require("../../schemas/plugin.schema.json") as object;
const externalSourceSchema = require("../../schemas/external-source.schema.json") as object;

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateDomainSchema = ajv.compile<DomainManifest>(domainSchema);
const validatePackSchema = ajv.compile<PackManifest>(packSchema);
const validatePluginSchema = ajv.compile<LocalPluginManifest>(pluginSchema);
const validateExternalSourceSchema = ajv.compile<ExternalSourceManifest>(externalSourceSchema);

export async function loadYaml<T>(path: string): Promise<T> {
  return parse(await readFile(path, "utf8")) as T;
}

export function validateDomain(value: unknown): DomainManifest {
  return validateManifest("domain", validateDomainSchema, value);
}

export function validatePack(value: unknown): PackManifest {
  return validateManifest("pack", validatePackSchema, value);
}

export function validatePlugin(value: unknown): LocalPluginManifest {
  return validateManifest("plugin", validatePluginSchema, value);
}

export function validateExternalSource(value: unknown): ExternalSourceManifest {
  return validateManifest("external source", validateExternalSourceSchema, value);
}

function validateManifest<T>(kind: string, validator: ValidateFunction<T>, value: unknown): T {
  if (validator(value)) {
    return value;
  }

  const errors = (validator.errors ?? [])
    .slice()
    .sort((left, right) => errorPath(left).localeCompare(errorPath(right)))
    .map(formatError);
  throw new Error(`Invalid ${kind} manifest:\n${errors.join("\n")}`);
}

function errorPath(error: ErrorObject): string {
  if (error.keyword === "required") {
    return `${error.instancePath}/${String(error.params.missingProperty)}`;
  }
  if (error.keyword === "additionalProperties") {
    return `${error.instancePath}/${String(error.params.additionalProperty)}`;
  }
  return error.instancePath || "/";
}

function formatError(error: ErrorObject): string {
  const path = errorPath(error);
  const message = error.keyword === "pattern" && path.endsWith("/version")
    ? `${error.message ?? "must match pattern"} (semver)`
    : (error.message ?? error.keyword);
  return `${path}: ${message}`;
}
