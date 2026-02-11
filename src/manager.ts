import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import ignore from "ignore";
import { lookup as mimeLookup } from "mime-types";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import yazl from "yazl";
import { renderMarkdownPreviewTemplate } from "./markdownPreviewTemplate.js";
import { loadPolicy } from "./policy.js";
import type {
  AccessMode,
  AccessState,
  AuditEvent,
  CfsharePluginConfig,
  CfsharePolicy,
  ExposureRecord,
  ExposureSession,
  ExposureStatus,
  ExposureType,
  FilePresentationMode,
  ManifestEntry,
  RateLimitPolicy,
} from "./types.js";

const MAX_LOG_LINES = 4000;
const DEFAULT_PROBE_TIMEOUT_MS = 3000;
const CLOUDFLARE_URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/i;
const MARKDOWN_PREVIEW_EXTENSIONS = new Set([".md", ".rmd", ".qmd"]);

type RateLimitState = {
  windowStart: number;
  count: number;
};

type ReverseProxyHandle = {
  server: http.Server;
  port: number;
};

type FileServerHandle = {
  server: http.Server;
  port: number;
  manifest: ManifestEntry[];
};

type CloudflaredStartResult = {
  process: ChildProcessWithoutNullStreams;
  publicUrl: string;
};

type EnvCheckResult = {
  cloudflared: {
    ok: boolean;
    path?: string;
    version?: string;
  };
  defaults: Record<string, unknown>;
  warnings: string[];
};

type ToolContext = {
  workspaceDir?: string;
};

type ExposureFilter = {
  status?: ExposureStatus;
  type?: ExposureType;
};

type ExposureGetField =
  | "id"
  | "type"
  | "status"
  | "port"
  | "public_url"
  | "expires_at"
  | "local_url"
  | "stats"
  | "usage_snippets"
  | "file_sharing"
  | "last_error"
  | "manifest"
  | "created_at";

type ExposureGetParams = {
  id?: string;
  ids?: string[];
  filter?: ExposureFilter;
  fields?: ExposureGetField[];
  opts?: {
    probe_public?: boolean;
  };
};

type ExposureLogsOpts = {
  lines?: number;
  since_seconds?: number;
  component?: "tunnel" | "origin" | "all";
};

function nowIso(): string {
  return new Date().toISOString();
}

function randomId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`;
}

function maskSecret(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  if (value.length <= 6) {
    return "*".repeat(value.length);
  }
  return `${value.slice(0, 3)}***${value.slice(-2)}`;
}

function isSubPath(target: string, base: string): boolean {
  const rel = path.relative(base, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function normalizePathForIgnore(input: string): string | undefined {
  const normalized = input.split(path.sep).join("/");
  if (!normalized || normalized === "." || normalized === "..") {
    return undefined;
  }
  if (
    normalized.startsWith("/") ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    normalized.endsWith("/..")
  ) {
    return undefined;
  }
  return normalized.replace(/^\.\/+/, "");
}

function getIgnoreMatchCandidates(realPath: string): string[] {
  const candidates = new Set<string>();
  const relToCwd = normalizePathForIgnore(path.relative(process.cwd(), realPath));
  const relToRoot = normalizePathForIgnore(path.relative(path.parse(realPath).root, realPath));
  const baseName = normalizePathForIgnore(path.basename(realPath));
  if (relToCwd) {
    candidates.add(relToCwd);
  }
  if (relToRoot) {
    candidates.add(relToRoot);
  }
  if (baseName) {
    candidates.add(baseName);
  }
  return Array.from(candidates);
}

function normalizeAllowlistPaths(values: string[] | undefined): string[] {
  if (!values) {
    return [];
  }
  const out = values
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => (entry.startsWith("/") ? entry : `/${entry}`));
  return Array.from(new Set(out));
}

function normalizeAccessMode(value: unknown, fallback: AccessMode): AccessMode {
  if (value === "token" || value === "basic" || value === "none") {
    return value;
  }
  return fallback;
}

function normalizeTtl(value: unknown, policy: CfsharePolicy): number {
  const n = typeof value === "number" ? Math.trunc(value) : policy.defaultTtlSeconds;
  return Math.max(60, Math.min(policy.maxTtlSeconds, n));
}

function normalizeFilePresentation(value: unknown): FilePresentationMode {
  if (value === "preview" || value === "raw" || value === "download") {
    return value;
  }
  return "download";
}

function sanitizeFilename(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_");
}

function ensureString(input: unknown): string | undefined {
  if (typeof input !== "string") {
    return undefined;
  }
  const trimmed = input.trim();
  return trimmed || undefined;
}

function buildContentDisposition(params: {
  mode: FilePresentationMode;
  filePath: string;
  downloadName?: string;
}): string | undefined {
  if (params.mode === "raw") {
    return undefined;
  }
  const verb = params.mode === "preview" ? "inline" : "attachment";
  const filename = params.downloadName ?? path.basename(params.filePath);
  return `${verb}; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function isTextLikeMime(mime: string): boolean {
  const base = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!base) {
    return false;
  }
  if (base.startsWith("text/")) {
    return true;
  }
  if (base.endsWith("+json") || base.endsWith("+xml")) {
    return true;
  }
  return (
    base === "application/json" ||
    base === "application/xml" ||
    base === "application/javascript" ||
    base === "application/x-javascript" ||
    base === "application/typescript" ||
    base === "application/x-typescript" ||
    base === "application/yaml" ||
    base === "application/x-yaml" ||
    base === "application/toml" ||
    base === "application/graphql" ||
    base === "application/sql"
  );
}

function shouldRenderMarkdownPreview(filePath: string, presentation: FilePresentationMode): boolean {
  if (presentation !== "preview") {
    return false;
  }
  return MARKDOWN_PREVIEW_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function stripLeadingFrontMatter(input: string): string {
  const source = input.replace(/^\uFEFF/, "");
  const match = source.match(/^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)\r?\n?/);
  if (!match) {
    return source;
  }
  return source.slice(match[0].length);
}

function buildMarkdownPreviewHtml(params: { title: string; markdown: string }): string {
  const payload = Buffer.from(stripLeadingFrontMatter(params.markdown), "utf8").toString("base64");
  return renderMarkdownPreviewTemplate({
    title: params.title,
    payload,
  });
}

function resolveBinPath(bin: string): string | undefined {
  if (path.isAbsolute(bin)) {
    return bin;
  }

  const pathEnv = process.env.PATH ?? "";
  const dirs = pathEnv.split(path.delimiter).filter(Boolean);
  const candidates =
    process.platform === "win32" ? [bin, `${bin}.exe`, `${bin}.cmd`, `${bin}.bat`] : [bin];

  for (const dir of dirs) {
    for (const candidate of candidates) {
      const full = path.join(dir, candidate);
      try {
        const stat = spawnSync(full, ["--version"], {
          timeout: 1500,
          stdio: "ignore",
        });
        if (!stat.error) {
          return full;
        }
      } catch {
        // ignore candidate
      }
    }
  }
  return undefined;
}

function extractCloudflaredVersion(output: string): string | undefined {
  const match = output.match(/version\s+([0-9]+\.[0-9]+\.[0-9]+)/i);
  return match?.[1];
}

async function fileExists(input: string): Promise<boolean> {
  try {
    await fs.access(input);
    return true;
  } catch {
    return false;
  }
}

async function mkdirp(input: string): Promise<void> {
  await fs.mkdir(input, { recursive: true });
}

async function findFreePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("failed to resolve free port"));
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function probeLocalPort(port: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    const done = (ok: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.setTimeout(1200, () => done(false));
  });
}

function formatRelativeUrl(input: string): string {
  return input
    .split(path.sep)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

async function walkFiles(dir: string, baseDir = dir): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(abs, baseDir)));
      continue;
    }
    if (entry.isFile()) {
      files.push(path.relative(baseDir, abs));
    }
  }
  return files;
}

async function sha256File(input: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  const stream = createReadStream(input);
  for await (const chunk of stream) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

function parseBasicAuth(input: string | undefined): { username: string; password: string } | null {
  if (!input || !input.startsWith("Basic ")) {
    return null;
  }
  const encoded = input.slice("Basic ".length).trim();
  try {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const index = decoded.indexOf(":");
    if (index < 0) {
      return null;
    }
    return { username: decoded.slice(0, index), password: decoded.slice(index + 1) };
  } catch {
    return null;
  }
}

function parseBearerToken(authHeader: string | undefined): string | undefined {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return undefined;
  }
  const token = authHeader.slice("Bearer ".length).trim();
  return token || undefined;
}

function shouldAllowPath(pathname: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) {
    return true;
  }
  return allowlist.some((prefix) => {
    if (prefix === "/") {
      return true;
    }
    if (pathname === prefix) {
      return true;
    }
    return pathname.startsWith(`${prefix.endsWith("/") ? prefix : `${prefix}/`}`);
  });
}

function matchAuditFilters(
  event: AuditEvent,
  filters: {
    id?: string;
    event?: string;
    type?: string;
    from_ts?: string;
    to_ts?: string;
  },
): boolean {
  if (filters.id && event.id !== filters.id) {
    return false;
  }
  if (filters.event && event.event !== filters.event) {
    return false;
  }
  if (filters.type && event.type !== filters.type) {
    return false;
  }
  if (filters.from_ts && event.ts < filters.from_ts) {
    return false;
  }
  if (filters.to_ts && event.ts > filters.to_ts) {
    return false;
  }
  return true;
}

export class CfshareManager {
  private readonly logger: OpenClawPluginApi["logger"];
  private readonly resolvePath: (input: string) => string;
  private readonly pluginConfig: CfsharePluginConfig;
  private readonly cloudflaredPathInput: string;
  private readonly stateDir: string;
  private readonly policyFile: string;
  private readonly ignoreFile: string;
  private readonly workspaceRoot: string;
  private readonly auditFile: string;
  private readonly sessionsFile: string;
  private readonly exportsDir: string;

  private initialized = false;
  private initializing?: Promise<void>;
  private policy!: CfsharePolicy;
  private policyWarnings: string[] = [];
  private ignoreMatcher = ignore();
  private cloudflaredResolvedPath?: string;
  private guardTimer?: NodeJS.Timeout;
  private readonly sessions = new Map<string, ExposureSession>();

  constructor(api: OpenClawPluginApi) {
    this.logger = api.logger;
    this.resolvePath = api.resolvePath;
    this.pluginConfig = (api.pluginConfig ?? {}) as CfsharePluginConfig;

    this.stateDir = this.resolvePath(this.pluginConfig.stateDir ?? "~/.openclaw/cfshare");
    this.policyFile = this.resolvePath(
      this.pluginConfig.policyFile ?? path.join(this.stateDir, "policy.json"),
    );
    this.ignoreFile = this.resolvePath(
      this.pluginConfig.ignoreFile ?? path.join(this.stateDir, "policy.ignore"),
    );
    this.workspaceRoot = path.join(this.stateDir, "workspaces");
    this.auditFile = path.join(this.stateDir, "audit.jsonl");
    this.sessionsFile = path.join(this.stateDir, "sessions.json");
    this.exportsDir = path.join(this.stateDir, "exports");
    this.cloudflaredPathInput = this.pluginConfig.cloudflaredPath ?? "cloudflared";
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }
    if (!this.initializing) {
      this.initializing = this.initialize();
    }
    await this.initializing;
  }

  private async initialize(): Promise<void> {
    await mkdirp(this.stateDir);
    await mkdirp(this.workspaceRoot);
    await mkdirp(this.exportsDir);
    await this.reloadPolicy();
    this.startGuard();
    this.initialized = true;
  }

  private async reloadPolicy(): Promise<void> {
    const loaded = await loadPolicy({
      policyFile: this.policyFile,
      ignoreFile: this.ignoreFile,
      pluginConfig: this.pluginConfig,
    });
    this.policy = loaded.effective;
    this.policyWarnings = loaded.warnings;
    this.ignoreMatcher = loaded.matcher;
  }

  private appendLog(session: ExposureSession, component: "tunnel" | "origin" | "manager", line: string) {
    const entry = { ts: nowIso(), component, line };
    session.logs.push(entry);
    if (session.logs.length > MAX_LOG_LINES) {
      session.logs.splice(0, session.logs.length - MAX_LOG_LINES);
    }
  }

  private async writeAudit(event: AuditEvent): Promise<void> {
    try {
      await fs.appendFile(this.auditFile, `${JSON.stringify(event)}\n`, "utf8");
    } catch (error) {
      this.logger.warn(`cfshare: failed to write audit event: ${String(error)}`);
    }
  }

  private async persistSessionsSnapshot(): Promise<void> {
    const records = Array.from(this.sessions.values()).map((session) => ({
      id: session.id,
      type: session.type,
      status: session.status,
      expiresAt: session.expiresAt,
      workspaceDir: session.workspaceDir,
      processPid: session.process?.pid,
    }));
    await fs.writeFile(this.sessionsFile, JSON.stringify(records, null, 2), "utf8");
  }

  private makeAccessState(params: {
    mode: AccessMode;
    protectOrigin: boolean;
    allowlistPaths?: string[];
  }): AccessState {
    const allowlistPaths = normalizeAllowlistPaths(params.allowlistPaths);
    if (params.mode === "token") {
      return {
        mode: "token",
        protectOrigin: params.protectOrigin,
        allowlistPaths,
        token: crypto.randomBytes(16).toString("hex"),
      };
    }
    if (params.mode === "basic") {
      return {
        mode: "basic",
        protectOrigin: params.protectOrigin,
        allowlistPaths,
        username: "cfshare",
        password: crypto.randomBytes(12).toString("base64url"),
      };
    }
    return {
      mode: "none",
      protectOrigin: params.protectOrigin,
      allowlistPaths,
    };
  }

  private buildRateLimiter(policy: RateLimitPolicy): (ip: string) => boolean {
    if (!policy.enabled) {
      return () => true;
    }
    const state = new Map<string, RateLimitState>();
    return (ip: string) => {
      const now = Date.now();
      const row = state.get(ip);
      if (!row || now - row.windowStart >= policy.windowMs) {
        state.set(ip, { windowStart: now, count: 1 });
        return true;
      }
      if (row.count >= policy.maxRequests) {
        return false;
      }
      row.count += 1;
      return true;
    };
  }

  private isAuthorized(req: IncomingMessage, access: AccessState): boolean {
    if (!access.protectOrigin || access.mode === "none") {
      return true;
    }
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (access.mode === "token") {
      const queryToken = ensureString(url.searchParams.get("token"));
      const headerToken = ensureString(req.headers["x-cfshare-token"] as string | undefined);
      const bearer = parseBearerToken(req.headers.authorization);
      return queryToken === access.token || headerToken === access.token || bearer === access.token;
    }
    const basic = parseBasicAuth(req.headers.authorization);
    return basic?.username === access.username && basic.password === access.password;
  }

  private async startReverseProxy(params: {
    upstreamPort: number;
    session: ExposureSession;
    access: AccessState;
  }): Promise<ReverseProxyHandle> {
    const proxyPort = await findFreePort();
    const allowRequest = this.buildRateLimiter(this.policy.rateLimit);
    const upstreamBase = `http://127.0.0.1:${params.upstreamPort}`;

    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const clientIp = req.socket.remoteAddress ?? "unknown";

      params.session.stats.requests += 1;
      params.session.stats.lastAccessAt = nowIso();

      if (!allowRequest(clientIp)) {
        res.writeHead(429, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "rate_limited" }));
        this.appendLog(params.session, "origin", `rate limit blocked ip=${clientIp}`);
        return;
      }

      if (!shouldAllowPath(url.pathname, params.access.allowlistPaths)) {
        res.writeHead(403, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "path_not_allowed", path: url.pathname }));
        return;
      }

      if (!this.isAuthorized(req, params.access)) {
        const headers: Record<string, string> = {
          "content-type": "application/json",
        };
        if (params.access.mode === "basic") {
          headers["www-authenticate"] = 'Basic realm="cfshare"';
        }
        res.writeHead(401, headers);
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }

      const upstreamUrl = new URL(url.pathname + url.search, upstreamBase);
      const transport = upstreamUrl.protocol === "https:" ? https : http;
      const proxyReq = transport.request(
        {
          protocol: upstreamUrl.protocol,
          hostname: upstreamUrl.hostname,
          port: upstreamUrl.port,
          method: req.method,
          path: upstreamUrl.pathname + upstreamUrl.search,
          headers: {
            ...req.headers,
            host: upstreamUrl.host,
          },
        },
        (proxyRes) => {
          res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
          proxyRes.on("data", (chunk: Buffer) => {
            params.session.stats.bytesSent += chunk.length;
          });
          proxyRes.pipe(res);
        },
      );

      proxyReq.on("error", (error) => {
        this.appendLog(params.session, "origin", `proxy error: ${String(error)}`);
        if (!res.headersSent) {
          res.writeHead(502, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "proxy_error" }));
          return;
        }
        res.end();
      });

      req.pipe(proxyReq);
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(proxyPort, "127.0.0.1", () => resolve());
    });

    this.appendLog(params.session, "origin", `reverse proxy listening on 127.0.0.1:${proxyPort}`);
    return { server, port: proxyPort };
  }

  private async sendFileResponse(params: {
    req: IncomingMessage;
    res: ServerResponse;
    session: ExposureSession;
    filePath: string;
    downloadName?: string;
    presentation?: FilePresentationMode;
    countAsDownload?: boolean;
  }): Promise<void> {
    const stat = await fs.stat(params.filePath);
    const presentation = params.presentation ?? "download";
    const detectedMime = String(mimeLookup(params.filePath) || "application/octet-stream");
    const mime =
      presentation === "raw" && isTextLikeMime(detectedMime)
        ? "text/plain; charset=utf-8"
        : detectedMime;
    const method = (params.req.method ?? "GET").toUpperCase();

    if (method !== "GET" && method !== "HEAD") {
      params.res.writeHead(405, { "content-type": "application/json" });
      params.res.end(JSON.stringify({ error: "method_not_allowed" }));
      return;
    }

    if (shouldRenderMarkdownPreview(params.filePath, presentation)) {
      const fileRaw = await fs.readFile(params.filePath, "utf8");
      const previewHtml = buildMarkdownPreviewHtml({
        title: params.downloadName ?? path.basename(params.filePath),
        markdown: fileRaw,
      });
      const body = Buffer.from(previewHtml, "utf8");
      const headers: Record<string, string> = {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "content-length": String(body.length),
      };
      params.res.writeHead(200, headers);
      if (method === "HEAD") {
        params.res.end();
        return;
      }
      if (params.countAsDownload) {
        params.session.stats.downloads += 1;
      }
      params.session.stats.bytesSent += body.length;
      params.res.end(body);
      return;
    }

    const headers: Record<string, string> = {
      "content-type": String(mime),
      "accept-ranges": "bytes",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    };
    const contentDisposition = buildContentDisposition({
      mode: presentation,
      filePath: params.filePath,
      downloadName: params.downloadName,
    });
    if (contentDisposition) {
      headers["content-disposition"] = contentDisposition;
    }

    const range = ensureString(params.req.headers.range);
    if (!range) {
      headers["content-length"] = String(stat.size);
      params.res.writeHead(200, headers);
      if (method === "HEAD") {
        params.res.end();
        return;
      }
      if (params.countAsDownload) {
        params.session.stats.downloads += 1;
      }
      params.session.stats.bytesSent += stat.size;
      await pipeline(createReadStream(params.filePath), params.res);
      return;
    }

    const match = range.match(/^bytes=(\d*)-(\d*)$/i);
    if (!match) {
      params.res.writeHead(416, { "content-type": "application/json" });
      params.res.end(JSON.stringify({ error: "invalid_range" }));
      return;
    }

    const start = match[1] ? Number.parseInt(match[1], 10) : 0;
    const end = match[2] ? Number.parseInt(match[2], 10) : stat.size - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || end >= stat.size) {
      params.res.writeHead(416, { "content-type": "application/json" });
      params.res.end(JSON.stringify({ error: "invalid_range" }));
      return;
    }

    headers["content-length"] = String(end - start + 1);
    headers["content-range"] = `bytes ${start}-${end}/${stat.size}`;
    params.res.writeHead(206, headers);
    if (method === "HEAD") {
      params.res.end();
      return;
    }
    if (params.countAsDownload) {
      params.session.stats.downloads += 1;
    }
    params.session.stats.bytesSent += end - start + 1;
    await pipeline(createReadStream(params.filePath, { start, end }), params.res);
  }

  private async createZipArchive(workspaceDir: string): Promise<{ zipPath: string; size: number }> {
    const zipPath = path.join(workspaceDir, "_cfshare_bundle.zip");
    const files = await walkFiles(workspaceDir);

    await new Promise<void>((resolve, reject) => {
      const zip = new yazl.ZipFile();
      const out = createWriteStream(zipPath);

      out.once("error", reject);
      out.once("close", () => resolve());
      zip.outputStream.pipe(out);

      for (const relPath of files) {
        if (relPath === path.basename(zipPath)) {
          continue;
        }
        zip.addFile(path.join(workspaceDir, relPath), relPath);
      }
      zip.end();
    });

    const stat = await fs.stat(zipPath);
    return { zipPath, size: stat.size };
  }

  private async startFileServer(params: {
    session: ExposureSession;
    workspaceDir: string;
    mode: "normal" | "zip";
    presentation: FilePresentationMode;
    maxDownloads?: number;
  }): Promise<FileServerHandle> {
    const port = await findFreePort();

    const files = await walkFiles(params.workspaceDir);
    const manifest: ManifestEntry[] = [];
    for (const relPath of files) {
      if (relPath === "_cfshare_bundle.zip") {
        continue;
      }
      const abs = path.join(params.workspaceDir, relPath);
      const stat = await fs.stat(abs);
      manifest.push({
        name: relPath,
        size: stat.size,
        sha256: await sha256File(abs),
        relative_url: `/${formatRelativeUrl(relPath)}`,
      });
    }

    let zipBundle: { zipPath: string; size: number } | undefined;
    if (params.mode === "zip") {
      zipBundle = await this.createZipArchive(params.workspaceDir);
      manifest.push({
        name: path.basename(zipBundle.zipPath),
        size: zipBundle.size,
        sha256: await sha256File(zipBundle.zipPath),
        relative_url: "/download.zip",
      });
    }

    const allowRequest = this.buildRateLimiter(this.policy.rateLimit);

    const server = http.createServer(async (req, res) => {
      const clientIp = req.socket.remoteAddress ?? "unknown";
      params.session.stats.requests += 1;
      params.session.stats.lastAccessAt = nowIso();

      if (!allowRequest(clientIp)) {
        res.writeHead(429, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "rate_limited" }));
        return;
      }

      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const pathname = decodeURIComponent(url.pathname);

      const checkMaxDownloads = async () => {
        if (typeof params.maxDownloads !== "number") {
          return;
        }
        if (params.session.stats.downloads >= params.maxDownloads) {
          await this.stopExposure(params.session.id, { reason: "max_downloads_reached", expired: false });
        }
      };

      try {
        if (params.mode === "zip") {
          if (pathname === "/") {
            res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
            res.end(`<html><body><a href="/download.zip">download.zip</a></body></html>`);
            return;
          }
          if (pathname !== "/download.zip" || !zipBundle) {
            res.writeHead(404, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: "not_found" }));
            return;
          }
          await this.sendFileResponse({
            req,
            res,
            session: params.session,
            filePath: zipBundle.zipPath,
            presentation: params.presentation,
            countAsDownload: true,
          });
          await checkMaxDownloads();
          return;
        }

        if (pathname === "/") {
          if (manifest.length === 1) {
            const filePath = path.join(params.workspaceDir, manifest[0].name);
            await this.sendFileResponse({
              req,
              res,
              session: params.session,
              filePath,
              presentation: params.presentation,
              countAsDownload: true,
            });
            await checkMaxDownloads();
            return;
          }
          const list = manifest
            .map((entry) => `<li><a href="${entry.relative_url}">${entry.name}</a> (${entry.size} bytes)</li>`)
            .join("\n");
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          res.end(`<html><body><h1>cfshare</h1><ul>${list}</ul></body></html>`);
          return;
        }

        const normalized = pathname.replace(/^\/+/, "");
        const target = path.join(params.workspaceDir, normalized);
        if (!isSubPath(target, params.workspaceDir) || !(await fileExists(target))) {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "not_found" }));
          return;
        }

        const stat = await fs.stat(target);
        if (!stat.isFile()) {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "not_file" }));
          return;
        }

        await this.sendFileResponse({
          req,
          res,
          session: params.session,
          filePath: target,
          presentation: params.presentation,
          countAsDownload: true,
        });
        await checkMaxDownloads();
      } catch (error) {
        this.appendLog(params.session, "origin", `file server error: ${String(error)}`);
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "internal_error" }));
          return;
        }
        res.end();
      }
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => resolve());
    });

    this.appendLog(params.session, "origin", `file server listening on 127.0.0.1:${port}`);
    return { server, port, manifest };
  }

  private async copyInputsToWorkspace(
    pathsInput: string[],
    workspaceDir: string,
    ctx?: ToolContext,
  ): Promise<void> {
    const allowedRoots = this.policy.allowedPathRoots.map((root) => this.resolvePath(root));
    const workspaceRoot = ctx?.workspaceDir ? this.resolvePath(ctx.workspaceDir) : undefined;

    for (const item of pathsInput) {
      const resolved = path.resolve(item);
      const real = await fs.realpath(resolved).catch(() => resolved);
      const ignoreCandidates = getIgnoreMatchCandidates(real);
      if (ignoreCandidates.some((candidate) => this.ignoreMatcher.ignores(candidate))) {
        throw new Error(`path blocked by ignore policy: ${item}`);
      }

      if (allowedRoots.length > 0 && !allowedRoots.some((root) => isSubPath(real, root))) {
        throw new Error(`path outside allowed roots: ${item}`);
      }

      if (workspaceRoot && !isSubPath(real, workspaceRoot)) {
        this.logger.warn(`cfshare: exposing path outside workspace (${item})`);
      }

      const sourceStat = await fs.stat(real);
      const baseName = sanitizeFilename(path.basename(real) || "item");
      let target = path.join(workspaceDir, baseName);
      let seq = 1;
      while (await fileExists(target)) {
        target = path.join(workspaceDir, `${baseName}_${seq}`);
        seq += 1;
      }

      if (sourceStat.isDirectory()) {
        await fs.cp(real, target, { recursive: true, dereference: true });
      } else if (sourceStat.isFile()) {
        await mkdirp(path.dirname(target));
        await fs.copyFile(real, target);
      } else {
        throw new Error(`unsupported path type: ${item}`);
      }
    }
  }

  private makeExposureRecord(session: ExposureSession): ExposureRecord {
    return {
      id: session.id,
      type: session.type,
      status: session.status,
      public_url: session.publicUrl,
      local_url: session.localUrl,
      expires_at: session.expiresAt,
    };
  }

  private startGuard() {
    if (this.guardTimer) {
      return;
    }
    this.guardTimer = setInterval(() => {
      void this.reapExpired();
    }, 30_000);
    this.guardTimer.unref();
  }

  private async reapExpired(): Promise<void> {
    const now = Date.now();
    const toStop = Array.from(this.sessions.values()).filter(
      (session) => session.status === "running" && new Date(session.expiresAt).getTime() <= now,
    );
    for (const session of toStop) {
      await this.stopExposure(session.id, { reason: "expired", expired: true });
    }
  }

  private async startTunnel(session: ExposureSession, targetPort: number): Promise<CloudflaredStartResult> {
    const cloudflaredBin = this.cloudflaredResolvedPath ?? resolveBinPath(this.cloudflaredPathInput);
    if (!cloudflaredBin) {
      throw new Error(`cloudflared not found in PATH: ${this.cloudflaredPathInput}`);
    }
    this.cloudflaredResolvedPath = cloudflaredBin;

    const edgeIpVersion = this.policy.tunnel.edgeIpVersion;
    const protocol = this.policy.tunnel.protocol;

    const args = [
      "tunnel",
      "--url",
      `http://127.0.0.1:${targetPort}`,
      "--edge-ip-version",
      edgeIpVersion,
      "--protocol",
      protocol,
      "--no-autoupdate",
    ];

    this.appendLog(session, "tunnel", `spawn: ${cloudflaredBin} ${args.join(" ")}`);

    const proc = spawn(cloudflaredBin, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let settled = false;

    return await new Promise<CloudflaredStartResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        proc.kill("SIGTERM");
        reject(new Error("timed out waiting for cloudflared URL"));
      }, 30_000);

      const onLine = (line: string) => {
        this.appendLog(session, "tunnel", line);
        const match = line.match(CLOUDFLARE_URL_RE);
        if (match && !settled) {
          settled = true;
          clearTimeout(timeout);
          resolve({ process: proc, publicUrl: match[0] });
        }
      };

      const attachStream = (stream: NodeJS.ReadableStream) => {
        let buffer = "";
        stream.on("data", (chunk: Buffer | string) => {
          buffer += chunk.toString();
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (line.trim()) {
              onLine(line.trim());
            }
          }
        });
        stream.on("end", () => {
          if (buffer.trim()) {
            onLine(buffer.trim());
          }
        });
      };

      attachStream(proc.stdout);
      attachStream(proc.stderr);

      proc.once("error", (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        reject(error);
      });

      proc.once("exit", (code, signal) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(new Error(`cloudflared exited before URL (code=${String(code)}, signal=${String(signal)})`));
        }
      });
    });
  }

  private async terminateProcess(proc?: ChildProcessWithoutNullStreams): Promise<void> {
    if (!proc || proc.killed) {
      return;
    }
    const pid = proc.pid;
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }

    proc.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
          // ignore
        }
        resolve();
      }, 2500);
      proc.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  async envCheck(): Promise<EnvCheckResult> {
    await this.ensureInitialized();
    await this.reloadPolicy();

    const warnings: string[] = [...this.policyWarnings];
    let cloudflaredPath = resolveBinPath(this.cloudflaredPathInput);
    let cloudflaredVersion: string | undefined;

    if (!cloudflaredPath && path.isAbsolute(this.cloudflaredPathInput)) {
      cloudflaredPath = this.cloudflaredPathInput;
    }

    if (cloudflaredPath) {
      const result = spawnSync(cloudflaredPath, ["--version"], {
        timeout: 2000,
        encoding: "utf8",
      });
      if (result.error) {
        warnings.push(`cloudflared exists but version check failed: ${String(result.error)}`);
      } else {
        const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
        cloudflaredVersion = extractCloudflaredVersion(combined) ?? combined.trim().split(/\r?\n/)[0];
      }
    } else {
      warnings.push(`cloudflared binary not found (${this.cloudflaredPathInput})`);
    }

    const defaults = {
      ...this.policy,
      state_dir: this.stateDir,
      policy_file: this.policyFile,
      ignore_file: this.ignoreFile,
      os: {
        platform: process.platform,
        arch: process.arch,
        release: os.release(),
        uid: typeof process.getuid === "function" ? process.getuid() : undefined,
      },
    };

    return {
      cloudflared: {
        ok: Boolean(cloudflaredPath && cloudflaredVersion),
        path: cloudflaredPath,
        version: cloudflaredVersion,
      },
      defaults,
      warnings,
    };
  }

  async exposePort(
    params: {
      port: number;
      opts?: {
        ttl_seconds?: number;
        access?: AccessMode;
        protect_origin?: boolean;
        allowlist_paths?: string[];
      };
    },
  ): Promise<Record<string, unknown>> {
    await this.ensureInitialized();

    const port = Math.trunc(params.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("invalid port");
    }
    if (this.policy.blockedPorts.includes(port)) {
      throw new Error(`port blocked by policy: ${port}`);
    }

    const alive = await probeLocalPort(port);
    if (!alive) {
      throw new Error(`local service is not reachable on 127.0.0.1:${port}`);
    }

    const ttlSeconds = normalizeTtl(params.opts?.ttl_seconds, this.policy);
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    const accessMode = normalizeAccessMode(params.opts?.access, this.policy.defaultExposePortAccess);
    const protectOrigin =
      typeof params.opts?.protect_origin === "boolean" ? params.opts.protect_origin : accessMode !== "none";

    const id = randomId("port");
    const session: ExposureSession = {
      id,
      type: "port",
      status: "starting",
      createdAt: nowIso(),
      expiresAt,
      localUrl: `http://127.0.0.1:${port}`,
      sourcePort: port,
      originPort: port,
      tunnelPort: port,
      logs: [],
      stats: { requests: 0, downloads: 0, bytesSent: 0 },
      access: this.makeAccessState({
        mode: accessMode,
        protectOrigin,
        allowlistPaths: params.opts?.allowlist_paths,
      }),
    };

    this.sessions.set(id, session);

    try {
      let tunnelTargetPort = port;
      if (protectOrigin || session.access.allowlistPaths.length > 0 || this.policy.rateLimit.enabled) {
        const proxy = await this.startReverseProxy({
          upstreamPort: port,
          session,
          access: session.access,
        });
        session.proxyServer = proxy.server;
        session.tunnelPort = proxy.port;
        tunnelTargetPort = proxy.port;
      }

      const tunnel = await this.startTunnel(session, tunnelTargetPort);
      session.process = tunnel.process;
      session.publicUrl = tunnel.publicUrl;
      session.status = "running";

      session.process.on("exit", (code, signal) => {
        if (session.status === "running") {
          session.status = "error";
          session.lastError = `cloudflared exited (code=${String(code)}, signal=${String(signal)})`;
          this.appendLog(session, "tunnel", session.lastError);
        }
      });

      session.timeoutHandle = setTimeout(() => {
        void this.stopExposure(session.id, { reason: "expired", expired: true });
      }, ttlSeconds * 1000);
      session.timeoutHandle.unref();

      await this.persistSessionsSnapshot();
      await this.writeAudit({
        ts: nowIso(),
        event: "exposure_started",
        id: session.id,
        type: session.type,
        details: {
          source_port: port,
          public_url: session.publicUrl,
          expires_at: expiresAt,
          access_mode: session.access.mode,
        },
      });

      return {
        id: session.id,
        public_url: session.publicUrl,
        local_url: session.localUrl,
        expires_at: session.expiresAt,
        access_info: {
          mode: session.access.mode,
          protect_origin: session.access.protectOrigin,
          token: maskSecret(session.access.token),
          username: session.access.username,
          password: maskSecret(session.access.password),
          allowlist_paths: session.access.allowlistPaths,
        },
      };
    } catch (error) {
      session.status = "error";
      session.lastError = error instanceof Error ? error.message : String(error);
      await this.stopExposure(id, { reason: session.lastError, expired: false, keepAudit: true });
      throw error;
    }
  }

  async exposeFiles(
    params: {
      paths: string[];
      opts?: {
        mode?: "normal" | "zip";
        presentation?: FilePresentationMode;
        ttl_seconds?: number;
        access?: AccessMode;
        max_downloads?: number;
      };
    },
    ctx?: ToolContext,
  ): Promise<Record<string, unknown>> {
    await this.ensureInitialized();

    if (!Array.isArray(params.paths) || params.paths.length === 0) {
      throw new Error("paths is required");
    }

    const ttlSeconds = normalizeTtl(params.opts?.ttl_seconds, this.policy);
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    const mode = params.opts?.mode ?? "normal";
    const presentation = normalizeFilePresentation(params.opts?.presentation);
    const accessMode = normalizeAccessMode(params.opts?.access, this.policy.defaultExposeFilesAccess);
    const protectOrigin = accessMode !== "none";

    const id = randomId("files");
    const workspaceDir = path.join(this.workspaceRoot, id);
    await mkdirp(workspaceDir);

    const session: ExposureSession = {
      id,
      type: "files",
      status: "starting",
      createdAt: nowIso(),
      expiresAt,
      localUrl: "",
      originPort: 0,
      tunnelPort: 0,
      workspaceDir,
      fileMode: mode,
      filePresentation: presentation,
      logs: [],
      stats: { requests: 0, downloads: 0, bytesSent: 0 },
      access: this.makeAccessState({
        mode: accessMode,
        protectOrigin,
      }),
      maxDownloads:
        typeof params.opts?.max_downloads === "number" ? Math.trunc(params.opts.max_downloads) : undefined,
    };

    this.sessions.set(id, session);

    try {
      await this.copyInputsToWorkspace(params.paths, workspaceDir, ctx);
      const fileServer = await this.startFileServer({
        session,
        workspaceDir,
        mode,
        presentation,
        maxDownloads: session.maxDownloads,
      });

      session.originServer = fileServer.server;
      session.manifest = fileServer.manifest;
      session.originPort = fileServer.port;
      session.localUrl = `http://127.0.0.1:${fileServer.port}`;

      let tunnelTargetPort = fileServer.port;
      if (protectOrigin) {
        const proxy = await this.startReverseProxy({
          upstreamPort: fileServer.port,
          session,
          access: session.access,
        });
        session.proxyServer = proxy.server;
        session.tunnelPort = proxy.port;
        tunnelTargetPort = proxy.port;
      }

      if (!session.tunnelPort) {
        session.tunnelPort = tunnelTargetPort;
      }

      const tunnel = await this.startTunnel(session, tunnelTargetPort);
      session.process = tunnel.process;
      session.publicUrl = tunnel.publicUrl;
      session.status = "running";

      session.process.on("exit", (code, signal) => {
        if (session.status === "running") {
          session.status = "error";
          session.lastError = `cloudflared exited (code=${String(code)}, signal=${String(signal)})`;
          this.appendLog(session, "tunnel", session.lastError);
        }
      });

      session.timeoutHandle = setTimeout(() => {
        void this.stopExposure(session.id, { reason: "expired", expired: true });
      }, ttlSeconds * 1000);
      session.timeoutHandle.unref();

      await this.persistSessionsSnapshot();
      await this.writeAudit({
        ts: nowIso(),
        event: "exposure_started",
        id: session.id,
        type: session.type,
        details: {
          public_url: session.publicUrl,
          expires_at: session.expiresAt,
          files_count: session.manifest?.length ?? 0,
          mode,
          presentation,
        },
      });

      return {
        id: session.id,
        public_url: session.publicUrl,
        expires_at: session.expiresAt,
        mode,
        presentation,
        manifest: session.manifest,
      };
    } catch (error) {
      session.status = "error";
      session.lastError = error instanceof Error ? error.message : String(error);
      await this.stopExposure(id, { reason: session.lastError, expired: false, keepAudit: true });
      throw error;
    }
  }

  exposureList(): ExposureRecord[] {
    return Array.from(this.sessions.values()).map((session) => this.makeExposureRecord(session));
  }

  private normalizeRequestedIds(rawIds: string[]): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const item of rawIds) {
      if (typeof item !== "string") {
        continue;
      }
      const id = item.trim();
      if (!id || seen.has(id)) {
        continue;
      }
      seen.add(id);
      out.push(id);
    }
    return out;
  }

  private matchesExposureFilter(session: ExposureSession, filter?: ExposureFilter): boolean {
    if (!filter) {
      return true;
    }
    if (filter.status && session.status !== filter.status) {
      return false;
    }
    if (filter.type && session.type !== filter.type) {
      return false;
    }
    return true;
  }

  private resolveExposureSelection(query: {
    id?: string;
    ids?: string[];
    filter?: ExposureFilter;
  }): { selectorUsed: boolean; selectedIds: string[]; missingIds: string[] } {
    const explicitIds = this.normalizeRequestedIds([
      ...(typeof query.id === "string" ? [query.id] : []),
      ...((query.ids ?? []).filter((value): value is string => typeof value === "string")),
    ]);

    const hasAll = explicitIds.includes("all");
    const allSessions = Array.from(this.sessions.values());

    if (hasAll) {
      const selectedIds = allSessions
        .filter((session) => this.matchesExposureFilter(session, query.filter))
        .map((session) => session.id);
      return { selectorUsed: true, selectedIds, missingIds: [] };
    }

    if (explicitIds.length > 0) {
      const selectedIds: string[] = [];
      const missingIds: string[] = [];
      for (const id of explicitIds) {
        const session = this.sessions.get(id);
        if (!session) {
          missingIds.push(id);
          continue;
        }
        if (this.matchesExposureFilter(session, query.filter)) {
          selectedIds.push(id);
        }
      }
      return { selectorUsed: true, selectedIds, missingIds };
    }

    if (query.filter) {
      const selectedIds = allSessions
        .filter((session) => this.matchesExposureFilter(session, query.filter))
        .map((session) => session.id);
      return { selectorUsed: true, selectedIds, missingIds: [] };
    }

    return { selectorUsed: false, selectedIds: [], missingIds: [] };
  }

  private makeUsageSnippets(session: ExposureSession): Record<string, string> {
    const usageSnippets: Record<string, string> = {};
    if (!session.publicUrl) {
      return usageSnippets;
    }

    if (session.access.mode === "token" && session.access.token) {
      usageSnippets.curl = `curl -L '${session.publicUrl}?token=${session.access.token}'`;
      usageSnippets.wget = `wget -O - '${session.publicUrl}?token=${session.access.token}'`;
      usageSnippets.powershell = `iwr '${session.publicUrl}?token=${session.access.token}'`;
      return usageSnippets;
    }

    if (session.access.mode === "basic" && session.access.username && session.access.password) {
      usageSnippets.curl = `curl -u '${session.access.username}:${session.access.password}' -L '${session.publicUrl}'`;
      usageSnippets.wget = `wget --user='${session.access.username}' --password='${session.access.password}' -O - '${session.publicUrl}'`;
      usageSnippets.powershell = `$p='${session.access.password}';$u='${session.access.username}';iwr '${session.publicUrl}' -Authentication Basic -Credential (New-Object System.Management.Automation.PSCredential($u,(ConvertTo-SecureString $p -AsPlainText -Force)))`;
      return usageSnippets;
    }

    usageSnippets.curl = `curl -L '${session.publicUrl}'`;
    usageSnippets.wget = `wget -O - '${session.publicUrl}'`;
    usageSnippets.powershell = `iwr '${session.publicUrl}'`;
    return usageSnippets;
  }

  private async buildExposureDetail(
    session: ExposureSession,
    opts?: {
      probe_public?: boolean;
    },
  ): Promise<Record<string, unknown>> {
    const tunnelAlive = Boolean(session.process && !session.process.killed);
    const originAlive =
      session.type === "port"
        ? await probeLocalPort(session.sourcePort ?? session.originPort)
        : Boolean(session.originServer?.listening);

    let publicProbe: { ok: boolean; status?: number; error?: string } | undefined;
    if (opts?.probe_public && session.publicUrl) {
      try {
        const probeUrl = new URL(session.publicUrl);
        if (session.access.mode === "token" && session.access.token) {
          probeUrl.searchParams.set("token", session.access.token);
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), DEFAULT_PROBE_TIMEOUT_MS);
        const headers: Record<string, string> = {};
        if (session.access.mode === "basic" && session.access.username && session.access.password) {
          headers.authorization = `Basic ${Buffer.from(
            `${session.access.username}:${session.access.password}`,
          ).toString("base64")}`;
        }

        const response = await fetch(probeUrl.toString(), {
          method: "HEAD",
          signal: controller.signal,
          headers,
        });
        clearTimeout(timer);
        publicProbe = { ok: response.ok, status: response.status };
      } catch (error) {
        publicProbe = { ok: false, error: String(error) };
      }
    }

    const fileSharing =
      session.type === "files"
        ? {
            mode: session.fileMode ?? "normal",
            presentation: session.filePresentation ?? "download",
          }
        : undefined;

    return {
      id: session.id,
      type: session.type,
      created_at: session.createdAt,
      status: {
        state: session.status,
        tunnel_alive: tunnelAlive,
        origin_alive: originAlive,
        public_probe: publicProbe,
      },
      port: {
        source_port: session.sourcePort,
        origin_port: session.originPort,
        tunnel_port: session.tunnelPort,
      },
      public_url: session.publicUrl,
      expires_at: session.expiresAt,
      local_url: session.localUrl,
      stats: session.stats,
      usage_snippets: this.makeUsageSnippets(session),
      file_sharing: fileSharing,
      last_error: session.lastError,
      manifest: session.manifest,
    };
  }

  private projectExposureDetail(
    detail: Record<string, unknown>,
    fields?: ExposureGetField[],
  ): Record<string, unknown> {
    if (!fields || fields.length === 0) {
      return detail;
    }
    const out: Record<string, unknown> = {
      id: detail.id,
    };
    for (const field of fields) {
      if (field === "id") {
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(detail, field)) {
        out[field] = detail[field];
      }
    }
    return out;
  }

  private makeExposureGetNotFound(id: string, fields?: ExposureGetField[]): Record<string, unknown> {
    const out: Record<string, unknown> = { id, error: "not_found" };
    if (fields?.includes("status")) {
      out.status = "not_found";
    }
    return out;
  }

  async exposureGet(params: ExposureGetParams): Promise<Record<string, unknown>> {
    await this.ensureInitialized();

    const fields = Array.isArray(params.fields) ? this.normalizeRequestedIds(params.fields) : undefined;
    const typedFields = fields as ExposureGetField[] | undefined;
    const legacySingle =
      Boolean(params.id) && params.id !== "all" && !params.ids && !params.filter && !params.fields;

    const selection = this.resolveExposureSelection({
      id: params.id,
      ids: params.ids,
      filter: params.filter,
    });

    if (!selection.selectorUsed) {
      throw new Error("id, ids, or filter is required");
    }

    if (legacySingle) {
      const legacyId = params.id as string;
      const session = this.sessions.get(legacyId);
      if (!session) {
        return { id: legacyId, status: "not_found" };
      }
      return await this.buildExposureDetail(session, params.opts);
    }

    const items: Record<string, unknown>[] = [];
    for (const id of selection.selectedIds) {
      const session = this.sessions.get(id);
      if (!session) {
        items.push(this.makeExposureGetNotFound(id, typedFields));
        continue;
      }
      const detail = await this.buildExposureDetail(session, params.opts);
      items.push(this.projectExposureDetail(detail, typedFields));
    }
    for (const missingId of selection.missingIds) {
      items.push(this.makeExposureGetNotFound(missingId, typedFields));
    }

    return {
      items,
      count: items.length,
      matched_ids: selection.selectedIds,
      missing_ids: selection.missingIds,
      filter: params.filter,
      fields: typedFields,
    };
  }

  async stopExposure(
    idOrIds: string | string[],
    opts?: { reason?: string; expired?: boolean; keepAudit?: boolean },
  ): Promise<Record<string, unknown>> {
    await this.ensureInitialized();

    const requested = this.normalizeRequestedIds(Array.isArray(idOrIds) ? idOrIds : [idOrIds]);
    if (requested.length === 0) {
      return { stopped: [], failed: [{ id: "unknown", error: "id or ids is required" }], cleaned: [] };
    }

    const includeAll = requested.includes("all");
    const ids: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];

    if (includeAll) {
      ids.push(...Array.from(this.sessions.keys()));
      if (ids.length === 0) {
        return { stopped: [], failed: [{ id: "all", error: "not_found" }], cleaned: [] };
      }
    } else {
      for (const id of requested) {
        if (this.sessions.has(id)) {
          ids.push(id);
        } else {
          failed.push({ id, error: "not_found" });
        }
      }
    }

    const stopIds = this.normalizeRequestedIds(ids);
    if (stopIds.length === 0) {
      return { stopped: [], failed, cleaned: [] };
    }

    const stopped: string[] = [];
    const cleaned: string[] = [];

    for (const id of stopIds) {
      const session = this.sessions.get(id);
      if (!session) {
        failed.push({ id, error: "not_found" });
        continue;
      }
      try {
        if (session.timeoutHandle) {
          clearTimeout(session.timeoutHandle);
          session.timeoutHandle = undefined;
        }

        await this.terminateProcess(session.process);

        if (session.proxyServer?.listening) {
          await new Promise<void>((resolve) => session.proxyServer?.close(() => resolve()));
        }
        if (session.originServer?.listening) {
          await new Promise<void>((resolve) => session.originServer?.close(() => resolve()));
        }

        if (session.workspaceDir && (await fileExists(session.workspaceDir))) {
          await fs.rm(session.workspaceDir, { recursive: true, force: true });
          cleaned.push(session.workspaceDir);
        }

        session.status = opts?.expired ? "expired" : "stopped";
        if (opts?.reason) {
          session.lastError = opts.reason;
          this.appendLog(session, "manager", `stop reason: ${opts.reason}`);
        }
        stopped.push(id);

        await this.writeAudit({
          ts: nowIso(),
          event: opts?.expired ? "exposure_expired" : "exposure_stopped",
          id: session.id,
          type: session.type,
          details: {
            reason: opts?.reason,
            public_url: session.publicUrl,
          },
        });
      } catch (error) {
        failed.push({ id, error: String(error) });
      } finally {
        this.sessions.delete(id);
      }
    }

    await this.persistSessionsSnapshot();
    return { stopped, failed, cleaned };
  }

  private exposureLogsOne(session: ExposureSession, opts?: ExposureLogsOpts): Record<string, unknown> {
    const lines = Math.max(1, Math.min(10_000, Math.trunc(opts?.lines ?? 200)));
    const component = opts?.component ?? "all";
    const threshold =
      typeof opts?.since_seconds === "number"
        ? Date.now() - Math.max(1, Math.trunc(opts.since_seconds)) * 1000
        : undefined;

    const filtered = session.logs.filter((entry) => {
      if (component !== "all" && entry.component !== component) {
        return false;
      }
      if (threshold !== undefined && new Date(entry.ts).getTime() < threshold) {
        return false;
      }
      return true;
    });

    return {
      id: session.id,
      component,
      lines: filtered
        .slice(-lines)
        .map((entry) => `${entry.ts} [${entry.component}] ${entry.line}`),
    };
  }

  exposureLogs(idOrIds: string | string[], opts?: ExposureLogsOpts): Record<string, unknown> {
    const requested = this.normalizeRequestedIds(Array.isArray(idOrIds) ? idOrIds : [idOrIds]);
    if (requested.length === 0) {
      return { items: [], missing_ids: [], error: "id or ids is required" };
    }

    const includeAll = requested.includes("all");
    const targetIds = includeAll ? Array.from(this.sessions.keys()) : requested;

    const singleLegacy = !Array.isArray(idOrIds) && !includeAll;
    if (singleLegacy) {
      const session = this.sessions.get(targetIds[0] ?? "");
      if (!session) {
        return { id: idOrIds, component: opts?.component ?? "all", lines: [], error: "not_found" };
      }
      return this.exposureLogsOne(session, opts);
    }

    const missingIds: string[] = [];
    const items: Record<string, unknown>[] = [];
    for (const id of targetIds) {
      const session = this.sessions.get(id);
      if (!session) {
        missingIds.push(id);
        items.push({ id, component: opts?.component ?? "all", lines: [], error: "not_found" });
        continue;
      }
      items.push(this.exposureLogsOne(session, opts));
    }

    return {
      items,
      requested_count: targetIds.length,
      found_count: targetIds.length - missingIds.length,
      missing_ids: missingIds,
    };
  }

  async maintenance(
    action: "start_guard" | "run_gc" | "set_policy",
    opts?: {
      policy?: unknown;
      ignore_patterns?: string[];
    },
  ): Promise<Record<string, unknown>> {
    await this.ensureInitialized();

    if (action === "start_guard") {
      this.startGuard();
      return {
        ok: true,
        action,
        details: {
          running: Boolean(this.guardTimer),
        },
      };
    }

    if (action === "run_gc") {
      const details = await this.runGc();
      return { ok: true, action, details };
    }

    if (!opts?.policy && !opts?.ignore_patterns) {
      return {
        ok: false,
        action,
        details: "set_policy requires opts.policy or opts.ignore_patterns",
      };
    }

    const current = await this.readPolicyJson();
    const nextPolicy = this.deepMerge(current, (opts.policy ?? {}) as Record<string, unknown>);
    await fs.writeFile(this.policyFile, `${JSON.stringify(nextPolicy, null, 2)}\n`, "utf8");

    if (Array.isArray(opts.ignore_patterns)) {
      await fs.writeFile(this.ignoreFile, `${opts.ignore_patterns.join("\n")}\n`, "utf8");
    }

    await this.reloadPolicy();
    await this.writeAudit({
      ts: nowIso(),
      event: "policy_updated",
      details: {
        policy_file: this.policyFile,
      },
    });

    return {
      ok: true,
      action,
      details: {
        policy_file: this.policyFile,
        ignore_file: this.ignoreFile,
        effective: this.policy,
      },
    };
  }

  private deepMerge(
    base: Record<string, unknown>,
    patch: Record<string, unknown>,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(patch)) {
      if (
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        typeof out[key] === "object" &&
        out[key] !== null &&
        !Array.isArray(out[key])
      ) {
        out[key] = this.deepMerge(out[key] as Record<string, unknown>, value as Record<string, unknown>);
      } else {
        out[key] = value;
      }
    }
    return out;
  }

  private async readPolicyJson(): Promise<Record<string, unknown>> {
    try {
      const raw = await fs.readFile(this.policyFile, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // fallback to empty
    }
    return {};
  }

  private async runGc(): Promise<Record<string, unknown>> {
    const removedWorkspaces: string[] = [];
    const killedPids: number[] = [];

    const activeWorkspaces = new Set(
      Array.from(this.sessions.values())
        .map((session) => session.workspaceDir)
        .filter((entry): entry is string => Boolean(entry)),
    );

    const workspaces = await fs.readdir(this.workspaceRoot, { withFileTypes: true }).catch(() => []);
    for (const entry of workspaces) {
      if (!entry.isDirectory()) {
        continue;
      }
      const abs = path.join(this.workspaceRoot, entry.name);
      if (activeWorkspaces.has(abs)) {
        continue;
      }
      await fs.rm(abs, { recursive: true, force: true });
      removedWorkspaces.push(abs);
    }

    try {
      const raw = await fs.readFile(this.sessionsFile, "utf8");
      const rows = JSON.parse(raw) as Array<{ id?: string; processPid?: number; workspaceDir?: string }>;
      for (const row of rows ?? []) {
        if (!row.processPid || this.sessions.has(String(row.id ?? ""))) {
          continue;
        }
        try {
          process.kill(row.processPid, 0);
          process.kill(row.processPid, "SIGTERM");
          killedPids.push(row.processPid);
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore missing snapshot
    }

    await this.persistSessionsSnapshot();
    await this.writeAudit({
      ts: nowIso(),
      event: "gc_run",
      details: {
        removed_workspaces: removedWorkspaces.length,
        killed_pids: killedPids.length,
      },
    });

    return {
      removed_workspaces: removedWorkspaces,
      killed_pids: killedPids,
    };
  }

  async auditQuery(filters?: {
    id?: string;
    event?: string;
    type?: "port" | "files";
    from_ts?: string;
    to_ts?: string;
    limit?: number;
  }): Promise<AuditEvent[]> {
    await this.ensureInitialized();

    const limit = Math.max(1, Math.min(10_000, Math.trunc(filters?.limit ?? 500)));
    let raw = "";
    try {
      raw = await fs.readFile(this.auditFile, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
        return [];
      }
      throw error;
    }

    const events = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as AuditEvent;
        } catch {
          return null;
        }
      })
      .filter((event): event is AuditEvent => Boolean(event));

    return events.filter((event) => matchAuditFilters(event, filters ?? {})).slice(-limit);
  }

  async auditExport(range?: {
    from_ts?: string;
    to_ts?: string;
    id?: string;
    event?: string;
    type?: "port" | "files";
    output_path?: string;
  }): Promise<Record<string, unknown>> {
    await this.ensureInitialized();

    const events = await this.auditQuery({
      id: range?.id,
      event: range?.event,
      type: range?.type,
      from_ts: range?.from_ts,
      to_ts: range?.to_ts,
      limit: 10_000,
    });

    const outputPath = this.resolvePath(
      range?.output_path ?? path.join(this.exportsDir, `audit-${Date.now().toString(36)}.jsonl`),
    );
    await mkdirp(path.dirname(outputPath));

    const data = events.map((event) => JSON.stringify(event)).join("\n");
    await fs.writeFile(outputPath, data ? `${data}\n` : "", "utf8");

    await this.writeAudit({
      ts: nowIso(),
      event: "audit_exported",
      details: {
        output_path: outputPath,
        count: events.length,
      },
    });

    return {
      ok: true,
      output_path: outputPath,
      count: events.length,
    };
  }
}
