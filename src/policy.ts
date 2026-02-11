import fs from "node:fs/promises";
import path from "node:path";
import ignore from "ignore";
import type { CfsharePluginConfig, CfsharePolicy } from "./types.js";

export const DEFAULT_POLICY: CfsharePolicy = {
  defaultTtlSeconds: 3600,
  maxTtlSeconds: 86400,
  defaultExposePortAccess: "token",
  defaultExposeFilesAccess: "none",
  blockedPorts: [22, 2375, 2376],
  allowedPathRoots: [],
  tunnel: {
    edgeIpVersion: "4",
    protocol: "http2",
  },
  rateLimit: {
    enabled: true,
    windowMs: 60_000,
    maxRequests: 240,
  },
};

export type LoadedPolicy = {
  effective: CfsharePolicy;
  warnings: string[];
  matcher: ReturnType<typeof ignore>;
};

function isAccessMode(value: unknown): value is CfsharePolicy["defaultExposePortAccess"] {
  return value === "token" || value === "basic" || value === "none";
}

function normalizeAccess(
  value: unknown,
  fallback: CfsharePolicy["defaultExposePortAccess"],
): CfsharePolicy["defaultExposePortAccess"] {
  return isAccessMode(value) ? value : fallback;
}

function asPortArray(input: unknown): number[] | undefined {
  if (!Array.isArray(input)) {
    return undefined;
  }
  const ports = input
    .map((value) => (typeof value === "number" ? Math.trunc(value) : Number.NaN))
    .filter((value) => Number.isInteger(value) && value > 0 && value <= 65535);
  return Array.from(new Set(ports));
}

function asStringArray(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) {
    return undefined;
  }
  return input
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function mergePolicy(
  defaults: CfsharePolicy,
  pluginConfig: CfsharePluginConfig,
  fileConfig: Record<string, unknown>,
): CfsharePolicy {
  const fileTunnel = (fileConfig.tunnel as Record<string, unknown> | undefined) ?? {};
  const fileRateLimit = (fileConfig.rateLimit as Record<string, unknown> | undefined) ?? {};

  const merged: CfsharePolicy = {
    defaultTtlSeconds:
      typeof fileConfig.defaultTtlSeconds === "number"
        ? fileConfig.defaultTtlSeconds
        : pluginConfig.defaultTtlSeconds ?? defaults.defaultTtlSeconds,
    maxTtlSeconds:
      typeof fileConfig.maxTtlSeconds === "number"
        ? fileConfig.maxTtlSeconds
        : pluginConfig.maxTtlSeconds ?? defaults.maxTtlSeconds,
    defaultExposePortAccess: normalizeAccess(
      fileConfig.defaultExposePortAccess,
      normalizeAccess(pluginConfig.defaultExposePortAccess, defaults.defaultExposePortAccess),
    ),
    defaultExposeFilesAccess: normalizeAccess(
      fileConfig.defaultExposeFilesAccess,
      normalizeAccess(pluginConfig.defaultExposeFilesAccess, defaults.defaultExposeFilesAccess),
    ),
    blockedPorts:
      asPortArray(fileConfig.blockedPorts) ??
      asPortArray(pluginConfig.blockedPorts) ??
      defaults.blockedPorts,
    allowedPathRoots:
      asStringArray(fileConfig.allowedPathRoots) ??
      asStringArray(pluginConfig.allowedPathRoots) ??
      defaults.allowedPathRoots,
    tunnel: {
      ...defaults.tunnel,
      ...(pluginConfig.tunnel ?? {}),
      ...(fileTunnel as Partial<CfsharePolicy["tunnel"]>),
    },
    rateLimit: {
      ...defaults.rateLimit,
      ...(pluginConfig.rateLimit ?? {}),
      ...(fileRateLimit as Partial<CfsharePolicy["rateLimit"]>),
    },
  };

  merged.defaultTtlSeconds = Math.max(60, Math.trunc(merged.defaultTtlSeconds));
  merged.maxTtlSeconds = Math.max(merged.defaultTtlSeconds, Math.trunc(merged.maxTtlSeconds));

  const edge = merged.tunnel.edgeIpVersion;
  if (edge !== "4" && edge !== "6" && edge !== "auto") {
    merged.tunnel.edgeIpVersion = defaults.tunnel.edgeIpVersion;
  }
  const protocol = merged.tunnel.protocol;
  if (protocol !== "http2" && protocol !== "quic" && protocol !== "auto") {
    merged.tunnel.protocol = defaults.tunnel.protocol;
  }

  merged.rateLimit.enabled = merged.rateLimit.enabled !== false;
  merged.rateLimit.windowMs = Math.min(3_600_000, Math.max(1000, Math.trunc(merged.rateLimit.windowMs)));
  merged.rateLimit.maxRequests = Math.min(
    100_000,
    Math.max(1, Math.trunc(merged.rateLimit.maxRequests)),
  );

  return merged;
}

export async function loadPolicy(params: {
  policyFile: string;
  ignoreFile: string;
  pluginConfig: CfsharePluginConfig;
}): Promise<LoadedPolicy> {
  const warnings: string[] = [];
  let fileConfig: Record<string, unknown> = {};

  try {
    const raw = await fs.readFile(params.policyFile, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") {
      fileConfig = parsed as Record<string, unknown>;
    } else {
      warnings.push(`policy file is not an object: ${params.policyFile}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
      warnings.push(`failed to read policy file (${params.policyFile}): ${message}`);
    }
  }

  const effective = mergePolicy(DEFAULT_POLICY, params.pluginConfig, fileConfig);

  const matcher = ignore();
  matcher.add([".git/**", ".openclaw/**"]);

  try {
    const ignoreText = await fs.readFile(params.ignoreFile, "utf8");
    matcher.add(ignoreText.split(/\r?\n/));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`failed to read ignore file (${params.ignoreFile}): ${message}`);
    }
  }

  const cwdIgnore = path.join(process.cwd(), ".gitignore");
  try {
    const ignoreText = await fs.readFile(cwdIgnore, "utf8");
    matcher.add(ignoreText.split(/\r?\n/));
  } catch {
    // ignore missing cwd .gitignore
  }

  return { effective, warnings, matcher };
}
