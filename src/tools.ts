import type { TSchema } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { jsonResult } from "openclaw/plugin-sdk";
import { CfshareManager } from "./manager.js";
import {
  AuditExportSchema,
  AuditQuerySchema,
  EnvCheckSchema,
  ExposeFilesSchema,
  ExposePortSchema,
  ExposureGetSchema,
  ExposureListSchema,
  ExposureLogsSchema,
  ExposureStopSchema,
  MaintenanceSchema,
} from "./schemas.js";

let managerSingleton: CfshareManager | null = null;

function getManager(api: OpenClawPluginApi): CfshareManager {
  if (!managerSingleton) {
    managerSingleton = new CfshareManager(api);
  }
  return managerSingleton;
}

type ToolContext = {
  workspaceDir?: string;
};

type RegisteredTool = {
  name: string;
  label: string;
  description: string;
  parameters: TSchema | Record<string, unknown>;
  execute: (...args: any[]) => Promise<unknown>;
};

function registerToolsForContext(api: OpenClawPluginApi, ctx: ToolContext): RegisteredTool[] {
  const manager = getManager(api);

  return [
    {
      name: "env_check",
      label: "CFShare Env Check",
      description: "Check cloudflared runtime, defaults, and policy capabilities",
      parameters: EnvCheckSchema,
      async execute() {
        return jsonResult(await manager.envCheck());
      },
    },
    {
      name: "expose_port",
      label: "CFShare Expose Port",
      description:
        "Expose an existing local service port through Cloudflare Quick Tunnel with optional auth and origin protection",
      parameters: ExposePortSchema,
      async execute(_toolCallId: string, params: { port: number; opts?: Record<string, unknown> }) {
        return jsonResult(await manager.exposePort(params));
      },
    },
    {
      name: "expose_files",
      label: "CFShare Expose Files",
      description:
        "Expose one or more files/directories by creating a temporary local static server and tunneling it",
      parameters: ExposeFilesSchema,
      async execute(
        _toolCallId: string,
        params: {
          paths: string[];
          opts?: {
            mode?: "normal" | "zip";
            presentation?: "download" | "preview" | "raw";
            ttl_seconds?: number;
            access?: "token" | "basic" | "none";
            max_downloads?: number;
          };
        },
      ) {
        return jsonResult(await manager.exposeFiles(params, ctx));
      },
    },
    {
      name: "exposure_list",
      label: "CFShare Exposure List",
      description: "List all active and tracked exposure sessions",
      parameters: ExposureListSchema,
      async execute() {
        return jsonResult(manager.exposureList());
      },
    },
    {
      name: "exposure_get",
      label: "CFShare Exposure Get",
      description: "Get detailed exposure info by id(s) or filter, with optional field projection",
      parameters: ExposureGetSchema,
      async execute(
        _toolCallId: string,
        params: {
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
      ) {
        return jsonResult(await manager.exposureGet(params));
      },
    },
    {
      name: "exposure_stop",
      label: "CFShare Exposure Stop",
      description:
        "Stop one exposure, multiple exposures, or all exposures; terminate processes and clean temporary resources",
      parameters: ExposureStopSchema,
      async execute(
        _toolCallId: string,
        params: {
          id?: string;
          ids?: string[];
          opts?: {
            reason?: string;
          };
        },
      ) {
        const target = params.ids ?? params.id;
        if (!target) {
          return jsonResult({
            stopped: [],
            failed: [{ id: "unknown", error: "id or ids is required" }],
            cleaned: [],
          });
        }
        return jsonResult(await manager.stopExposure(target, params.opts));
      },
    },
    {
      name: "exposure_logs",
      label: "CFShare Exposure Logs",
      description: "Fetch merged logs from cloudflared and origin components for one or many exposures",
      parameters: ExposureLogsSchema,
      async execute(
        _toolCallId: string,
        params: {
          id?: string;
          ids?: string[];
          opts?: {
            lines?: number;
            since_seconds?: number;
            component?: "tunnel" | "origin" | "all";
          };
        },
      ) {
        const target = params.ids ?? params.id;
        if (!target) {
          return jsonResult({
            items: [],
            missing_ids: [],
            error: "id or ids is required",
          });
        }
        return jsonResult(manager.exposureLogs(target, params.opts));
      },
    },
    {
      name: "maintenance",
      label: "CFShare Maintenance",
      description:
        "Run guard lifecycle actions, garbage collection, or policy updates for cfshare runtime",
      parameters: MaintenanceSchema,
      async execute(
        _toolCallId: string,
        params: {
          action: "start_guard" | "run_gc" | "set_policy";
          opts?: {
            policy?: unknown;
            ignore_patterns?: string[];
          };
        },
      ) {
        return jsonResult(await manager.maintenance(params.action, params.opts));
      },
    },
    {
      name: "audit_query",
      label: "CFShare Audit Query",
      description: "Query cfshare audit records with filters",
      parameters: AuditQuerySchema,
      async execute(
        _toolCallId: string,
        params: {
          filters?: {
            id?: string;
            event?: string;
            type?: "port" | "files";
            from_ts?: string;
            to_ts?: string;
            limit?: number;
          };
        },
      ) {
        return jsonResult(await manager.auditQuery(params.filters));
      },
    },
    {
      name: "audit_export",
      label: "CFShare Audit Export",
      description: "Export filtered audit records to a local JSONL file",
      parameters: AuditExportSchema,
      async execute(
        _toolCallId: string,
        params: {
          range?: {
            from_ts?: string;
            to_ts?: string;
            id?: string;
            event?: string;
            type?: "port" | "files";
            output_path?: string;
          };
        },
      ) {
        return jsonResult(await manager.auditExport(params.range));
      },
    },
  ];
}

export function registerCfshareTools(api: OpenClawPluginApi) {
  const names = [
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
  ];

  api.registerTool((ctx: ToolContext) => registerToolsForContext(api, ctx), {
    names,
  });
}
