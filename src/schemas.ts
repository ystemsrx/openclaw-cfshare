import { Type } from "@sinclair/typebox";
import { stringEnum } from "openclaw/plugin-sdk";

const AccessMode = stringEnum(["token", "basic", "none"] as const, {
  description: "Access mode",
});

const FileMode = stringEnum(["single", "index", "zip"] as const, {
  description: "File exposure mode",
});

const FilePresentationMode = stringEnum(["download", "preview", "raw"] as const, {
  description: "How files should be served to clients",
});

const ComponentMode = stringEnum(["tunnel", "origin", "all"] as const, {
  description: "Log component",
});

const MaintenanceAction = stringEnum(["start_guard", "run_gc", "set_policy"] as const, {
  description: "Maintenance action",
});

const PortOptsSchema = Type.Object(
  {
    ttl_seconds: Type.Optional(Type.Number({ minimum: 60, maximum: 604800 })),
    access: Type.Optional(AccessMode),
    protect_origin: Type.Optional(Type.Boolean()),
    allowlist_paths: Type.Optional(Type.Array(Type.String(), { minItems: 1, maxItems: 128 })),
  },
  { additionalProperties: false },
);

const FilesOptsSchema = Type.Object(
  {
    mode: Type.Optional(FileMode),
    presentation: Type.Optional(FilePresentationMode),
    ttl_seconds: Type.Optional(Type.Number({ minimum: 60, maximum: 604800 })),
    access: Type.Optional(AccessMode),
    max_downloads: Type.Optional(Type.Number({ minimum: 1, maximum: 1_000_000 })),
  },
  { additionalProperties: false },
);

export const EnvCheckSchema = Type.Object({}, { additionalProperties: false });

export const ExposePortSchema = Type.Object(
  {
    port: Type.Number({ minimum: 1, maximum: 65535 }),
    opts: Type.Optional(PortOptsSchema),
  },
  { additionalProperties: false },
);

export const ExposeFilesSchema = Type.Object(
  {
    paths: Type.Array(Type.String(), { minItems: 1, maxItems: 256 }),
    opts: Type.Optional(FilesOptsSchema),
  },
  { additionalProperties: false },
);

export const ExposureListSchema = Type.Object({}, { additionalProperties: false });

export const ExposureGetSchema = Type.Object(
  {
    id: Type.String({ minLength: 2 }),
    opts: Type.Optional(
      Type.Object(
        {
          probe_public: Type.Optional(Type.Boolean()),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export const ExposureStopSchema = Type.Object(
  {
    id: Type.String({
      minLength: 1,
      description: `Exposure id or "all"`,
    }),
    opts: Type.Optional(
      Type.Object(
        {
          reason: Type.Optional(Type.String()),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export const ExposureLogsSchema = Type.Object(
  {
    id: Type.String({ minLength: 2 }),
    opts: Type.Optional(
      Type.Object(
        {
          lines: Type.Optional(Type.Number({ minimum: 1, maximum: 10_000 })),
          since_seconds: Type.Optional(Type.Number({ minimum: 1, maximum: 365 * 24 * 3600 })),
          component: Type.Optional(ComponentMode),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export const MaintenanceSchema = Type.Object(
  {
    action: MaintenanceAction,
    opts: Type.Optional(
      Type.Object(
        {
          policy: Type.Optional(Type.Any({ description: "Policy patch object" })),
          ignore_patterns: Type.Optional(Type.Array(Type.String(), { minItems: 1, maxItems: 4096 })),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export const AuditQuerySchema = Type.Object(
  {
    filters: Type.Optional(
      Type.Object(
        {
          id: Type.Optional(Type.String()),
          event: Type.Optional(Type.String()),
          type: Type.Optional(stringEnum(["port", "files"] as const)),
          from_ts: Type.Optional(Type.String({ description: "ISO timestamp" })),
          to_ts: Type.Optional(Type.String({ description: "ISO timestamp" })),
          limit: Type.Optional(Type.Number({ minimum: 1, maximum: 10000 })),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export const AuditExportSchema = Type.Object(
  {
    range: Type.Optional(
      Type.Object(
        {
          from_ts: Type.Optional(Type.String({ description: "ISO timestamp" })),
          to_ts: Type.Optional(Type.String({ description: "ISO timestamp" })),
          id: Type.Optional(Type.String()),
          event: Type.Optional(Type.String()),
          type: Type.Optional(stringEnum(["port", "files"] as const)),
          output_path: Type.Optional(Type.String()),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
