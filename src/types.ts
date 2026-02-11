import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { Server } from "node:http";

export type AccessMode = "token" | "basic" | "none";
export type ExposureType = "port" | "files";
export type ExposureStatus = "starting" | "running" | "stopped" | "error" | "expired";
export type LogComponent = "tunnel" | "origin" | "manager";
export type FilePresentationMode = "download" | "preview" | "raw";

export type RateLimitPolicy = {
  enabled: boolean;
  windowMs: number;
  maxRequests: number;
};

export type CfsharePolicy = {
  defaultTtlSeconds: number;
  maxTtlSeconds: number;
  defaultExposePortAccess: AccessMode;
  defaultExposeFilesAccess: AccessMode;
  blockedPorts: number[];
  allowedPathRoots: string[];
  tunnel: {
    edgeIpVersion: "4" | "6" | "auto";
    protocol: "http2" | "quic" | "auto";
  };
  rateLimit: RateLimitPolicy;
};

export type CfsharePluginConfig = Partial<CfsharePolicy> & {
  stateDir?: string;
  cloudflaredPath?: string;
  policyFile?: string;
  ignoreFile?: string;
};

export type LogEntry = {
  ts: string;
  component: LogComponent;
  line: string;
};

export type ExposureStats = {
  requests: number;
  downloads: number;
  bytesSent: number;
  lastAccessAt?: string;
};

export type AccessState = {
  mode: AccessMode;
  protectOrigin: boolean;
  token?: string;
  username?: string;
  password?: string;
  allowlistPaths: string[];
};

export type ManifestEntry = {
  name: string;
  size: number;
  sha256: string;
  relative_url: string;
  modified_at?: string;
  is_binary?: boolean;
  preview_supported?: boolean;
};

export type ExposureSession = {
  id: string;
  type: ExposureType;
  status: ExposureStatus;
  createdAt: string;
  expiresAt: string;
  localUrl: string;
  publicUrl?: string;
  originPort: number;
  tunnelPort: number;
  sourcePort?: number;
  workspaceDir?: string;
  manifest?: ManifestEntry[];
  fileMode?: "normal" | "zip";
  filePresentation?: FilePresentationMode;
  maxDownloads?: number;
  process?: ChildProcessWithoutNullStreams;
  originServer?: Server;
  proxyServer?: Server;
  timeoutHandle?: NodeJS.Timeout;
  logs: LogEntry[];
  stats: ExposureStats;
  access: AccessState;
  lastError?: string;
};

export type AuditEvent = {
  ts: string;
  event: string;
  id?: string;
  type?: ExposureType;
  details?: Record<string, unknown>;
};

export type ExposureRecord = {
  id: string;
  type: ExposureType;
  status: ExposureStatus;
  public_url?: string;
  local_url: string;
  expires_at: string;
};
