#!/usr/bin/env node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { CfshareManager, type CfshareRuntimeApi } from "./manager.js";
import type { CfsharePluginConfig } from "./types.js";

type CliOptions = {
  command?: string;
  paramsJson?: string;
  paramsFile?: string;
  configJson?: string;
  configFile?: string;
  workspaceDir?: string;
  keepAlive?: boolean;
  compact?: boolean;
  help?: boolean;
  version?: boolean;
};

const TOOL_NAMES = new Set([
  "env_check",
  "expose_port",
  "expose_files",
  "exposure_list",
  "exposure_get",
  "exposure_stop",
  "exposure_logs",
  "maintenance",
  "audit_query",
  "audit_export",
]);

const CLI_DEFAULT_STATE_DIR = "~/.cfshare";

function normalizeCommand(input: string): string {
  return input.trim().toLowerCase().replace(/-/g, "_");
}

function expandHome(input: string): string {
  if (input === "~") {
    return os.homedir();
  }
  if (input.startsWith("~/")) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

function resolvePathFromCwd(input: string): string {
  const expanded = expandHome(input);
  return path.isAbsolute(expanded) ? path.normalize(expanded) : path.resolve(process.cwd(), expanded);
}

function printHelp() {
  const lines = [
    "CFShare CLI",
    "",
    "Usage:",
    "  cfshare <tool> [params-json] [options]",
    "",
    "Tools:",
    "  env_check",
    "  expose_port",
    "  expose_files",
    "  exposure_list",
    "  exposure_get",
    "  exposure_stop",
    "  exposure_logs",
    "  maintenance",
    "  audit_query",
    "  audit_export",
    "",
    "Options:",
    "  --params <json>        Tool parameters as JSON",
    "  --params-file <path>   Read tool parameters from JSON file",
    "  --config <json>        Runtime config JSON (same as plugin config)",
    "  --config-file <path>   Read runtime config from JSON file",
    "  --workspace-dir <dir>  Workspace dir for expose_files context",
    "  --keep-alive           Keep process running after expose_*",
    "  --no-keep-alive        Exit immediately after expose_* result",
    "  --compact              Compact JSON output",
    "  -h, --help             Show help",
    "  -v, --version          Show version",
    "",
    "Examples:",
    "  cfshare env_check",
    "  cfshare expose_port '{\"port\":3000,\"opts\":{\"access\":\"token\"}}'",
    "  cfshare expose_files --params '{\"paths\":[\"./build\"],\"opts\":{\"access\":\"none\"}}'",
    "  cfshare exposure_stop --params '{\"id\":\"all\"}'",
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

function assertValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("-")) {
    throw new Error(`missing value for ${flag}`);
  }
  return value;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {};
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token) {
      continue;
    }
    if (token === "-h" || token === "--help") {
      opts.help = true;
      continue;
    }
    if (token === "-v" || token === "--version") {
      opts.version = true;
      continue;
    }
    if (token === "--params") {
      opts.paramsJson = assertValue(argv, i + 1, token);
      i += 1;
      continue;
    }
    if (token === "--params-file") {
      opts.paramsFile = assertValue(argv, i + 1, token);
      i += 1;
      continue;
    }
    if (token === "--config") {
      opts.configJson = assertValue(argv, i + 1, token);
      i += 1;
      continue;
    }
    if (token === "--config-file") {
      opts.configFile = assertValue(argv, i + 1, token);
      i += 1;
      continue;
    }
    if (token === "--workspace-dir") {
      opts.workspaceDir = assertValue(argv, i + 1, token);
      i += 1;
      continue;
    }
    if (token === "--keep-alive") {
      opts.keepAlive = true;
      continue;
    }
    if (token === "--no-keep-alive") {
      opts.keepAlive = false;
      continue;
    }
    if (token === "--compact") {
      opts.compact = true;
      continue;
    }
    if (token.startsWith("-")) {
      throw new Error(`unknown option: ${token}`);
    }
    positionals.push(token);
  }

  if (positionals.length > 0) {
    opts.command = positionals[0];
  }
  if (positionals.length > 1) {
    if (opts.paramsJson || opts.paramsFile) {
      throw new Error("params-json conflicts with --params/--params-file");
    }
    opts.paramsJson = positionals[1];
  }
  if (positionals.length > 2) {
    throw new Error("too many positional arguments");
  }

  return opts;
}

async function parseJsonInput(source: string, label: string): Promise<unknown> {
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`failed to parse ${label}: ${String(error)}`);
  }
}

async function parseJsonFile(filePath: string, label: string): Promise<unknown> {
  const resolved = resolvePathFromCwd(filePath);
  const content = await fs.readFile(resolved, "utf8");
  return await parseJsonInput(content, `${label} (${resolved})`);
}

function asObject(input: unknown, label: string): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return input as Record<string, unknown>;
}

function createRuntimeApi(config: CfsharePluginConfig): CfshareRuntimeApi {
  const stringifyArgs = (args: unknown[]) =>
    args
      .map((value) => {
        if (typeof value === "string") {
          return value;
        }
        try {
          return JSON.stringify(value);
        } catch {
          return String(value);
        }
      })
      .join(" ");

  const logger = {
    info: (...args: unknown[]) => {
      if (process.env.CFSHARE_LOG_LEVEL === "info" || process.env.CFSHARE_LOG_LEVEL === "debug") {
        process.stderr.write(`[cfshare] ${stringifyArgs(args)}\n`);
      }
    },
    warn: (...args: unknown[]) => {
      process.stderr.write(`[cfshare][warn] ${stringifyArgs(args)}\n`);
    },
    error: (...args: unknown[]) => {
      process.stderr.write(`[cfshare][error] ${stringifyArgs(args)}\n`);
    },
    debug: (...args: unknown[]) => {
      if (process.env.CFSHARE_LOG_LEVEL === "debug") {
        process.stderr.write(`[cfshare][debug] ${stringifyArgs(args)}\n`);
      }
    },
  } as unknown as CfshareRuntimeApi["logger"];

  const runtimeConfig: CfsharePluginConfig = {
    stateDir: CLI_DEFAULT_STATE_DIR,
    ...config,
  };

  return {
    logger,
    resolvePath: resolvePathFromCwd,
    pluginConfig: runtimeConfig,
  };
}

function shouldKeepAlive(command: string, keepAliveFlag: boolean | undefined): boolean {
  if (typeof keepAliveFlag === "boolean") {
    return keepAliveFlag;
  }
  return command === "expose_port" || command === "expose_files";
}

async function waitUntilExposureStops(manager: CfshareManager, id: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let stopping = false;
    let interval: NodeJS.Timeout | undefined;

    const shutdown = async (reason: string) => {
      if (stopping) {
        return;
      }
      stopping = true;
      if (interval) {
        clearInterval(interval);
      }
      process.removeListener("SIGINT", onSigint);
      process.removeListener("SIGTERM", onSigterm);
      try {
        await manager.stopExposure(id, { reason });
      } catch {
        // best effort cleanup on signal
      } finally {
        resolve();
      }
    };

    const onSigint = () => {
      void shutdown("cli interrupted");
    };
    const onSigterm = () => {
      void shutdown("cli terminated");
    };
    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);

    interval = setInterval(async () => {
      try {
        const detail = (await manager.exposureGet({ id })) as { status?: unknown };
        const statusValue = detail.status;
        const state =
          typeof statusValue === "string"
            ? statusValue
            : typeof statusValue === "object" && statusValue && "state" in statusValue
              ? String((statusValue as { state?: unknown }).state ?? "")
              : "";
        if (state === "stopped" || state === "expired" || state === "error" || state === "not_found") {
          clearInterval(interval);
          process.removeListener("SIGINT", onSigint);
          process.removeListener("SIGTERM", onSigterm);
          resolve();
        }
      } catch (error) {
        clearInterval(interval);
        process.removeListener("SIGINT", onSigint);
        process.removeListener("SIGTERM", onSigterm);
        reject(error);
      }
    }, 1000);
  });
}

async function runTool(
  manager: CfshareManager,
  command: string,
  params: Record<string, unknown>,
  opts: CliOptions,
): Promise<unknown> {
  if (command === "env_check") {
    return await manager.envCheck();
  }
  if (command === "expose_port") {
    return await manager.exposePort(params as { port: number; opts?: Record<string, unknown> });
  }
  if (command === "expose_files") {
    const ctx = opts.workspaceDir ? { workspaceDir: opts.workspaceDir } : undefined;
    return await manager.exposeFiles(
      params as {
        paths: string[];
        opts?: {
          mode?: "normal" | "zip";
          presentation?: "download" | "preview" | "raw";
          ttl_seconds?: number;
          access?: "token" | "basic" | "none";
          max_downloads?: number;
        };
      },
      ctx,
    );
  }
  if (command === "exposure_list") {
    return manager.exposureList();
  }
  if (command === "exposure_get") {
    return await manager.exposureGet(
      params as {
        id?: string;
        ids?: string[];
        filter?: {
          status?: "starting" | "running" | "stopped" | "error" | "expired";
          type?: "port" | "files";
        };
        fields?: Array<
          | "id"
          | "type"
          | "status"
          | "port"
          | "public_url"
          | "expires_at"
          | "local_url"
          | "stats"
          | "file_sharing"
          | "last_error"
          | "manifest"
          | "created_at"
        >;
        opts?: {
          probe_public?: boolean;
        };
      },
    );
  }
  if (command === "exposure_stop") {
    const stopParams = params as { id?: string; ids?: string[]; opts?: { reason?: string } };
    const target = stopParams.ids ?? stopParams.id;
    if (!target) {
      throw new Error("exposure_stop requires id or ids");
    }
    return await manager.stopExposure(target, stopParams.opts);
  }
  if (command === "exposure_logs") {
    const logParams = params as {
      id?: string;
      ids?: string[];
      opts?: { lines?: number; since_seconds?: number; component?: "tunnel" | "origin" | "all" };
    };
    const target = logParams.ids ?? logParams.id;
    if (!target) {
      throw new Error("exposure_logs requires id or ids");
    }
    return manager.exposureLogs(target, logParams.opts);
  }
  if (command === "maintenance") {
    const maintenanceParams = params as {
      action: "start_guard" | "run_gc" | "set_policy";
      opts?: { policy?: unknown; ignore_patterns?: string[] };
    };
    return await manager.maintenance(maintenanceParams.action, maintenanceParams.opts);
  }
  if (command === "audit_query") {
    const queryParams = params as {
      filters?: {
        id?: string;
        event?: string;
        type?: "port" | "files";
        from_ts?: string;
        to_ts?: string;
        limit?: number;
      };
    };
    return await manager.auditQuery(queryParams.filters);
  }
  if (command === "audit_export") {
    const exportParams = params as {
      range?: {
        from_ts?: string;
        to_ts?: string;
        id?: string;
        event?: string;
        type?: "port" | "files";
        output_path?: string;
      };
    };
    return await manager.auditExport(exportParams.range);
  }
  throw new Error(`unsupported command: ${command}`);
}

async function readVersion(): Promise<string> {
  const packagePath = new URL("../../package.json", import.meta.url);
  const content = await fs.readFile(packagePath, "utf8");
  const parsed = JSON.parse(content) as { version?: string };
  return parsed.version ?? "unknown";
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.version) {
    process.stdout.write(`${await readVersion()}\n`);
    return;
  }

  if (options.help || !options.command) {
    printHelp();
    process.exit(options.help ? 0 : 1);
  }

  const command = normalizeCommand(options.command);
  if (!TOOL_NAMES.has(command)) {
    throw new Error(`unknown tool: ${options.command}`);
  }

  const paramsInput =
    options.paramsJson !== undefined
      ? await parseJsonInput(options.paramsJson, "--params")
      : options.paramsFile
        ? await parseJsonFile(options.paramsFile, "--params-file")
        : {};
  const configInput =
    options.configJson !== undefined
      ? await parseJsonInput(options.configJson, "--config")
      : options.configFile
        ? await parseJsonFile(options.configFile, "--config-file")
        : {};

  const params = asObject(paramsInput, "params");
  const config = asObject(configInput, "config") as CfsharePluginConfig;
  const manager = new CfshareManager(createRuntimeApi(config));

  const result = await runTool(manager, command, params, options);
  process.stdout.write(`${JSON.stringify(result, null, options.compact ? undefined : 2)}\n`);

  if (shouldKeepAlive(command, options.keepAlive)) {
    const exposureId = typeof result === "object" && result ? (result as { id?: unknown }).id : undefined;
    if (typeof exposureId !== "string" || !exposureId) {
      return;
    }
    process.stderr.write(
      `cfshare: exposure ${exposureId} is running. Press Ctrl+C to stop or use --no-keep-alive.\n`,
    );
    await waitUntilExposureStops(manager, exposureId);
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`cfshare error: ${message}\n`);
  process.exit(1);
});
