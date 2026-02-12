---
name: cfshare
description: Expose local services, ports, files, or directories as temporary public HTTPS links via Cloudflare Quick Tunnel. Use for sharing local services, sending downloadable files, previewing content, etc.
metadata:
  {
    "openclaw":
      {
        "emoji": "☁️",
        "skillKey": "cfshare",
        "requires":
          {
            "bins": ["cloudflared"],
            "config": ["plugins.entries.cfshare.enabled"],
          },
      },
  }
---

# CFShare — Cloudflare Quick Tunnel Exposure

Expose local services, ports, files, or directories as temporary public `https://*.trycloudflare.com` links.

**This tool is useful when you need to:**

1. Share or send files;
2. Present web pages, services, lengthy Markdown content, PDFs, images, audio, video, and other media.

---

## Standard Workflow

1. **`env_check()`** — Always call first to verify `cloudflared` is available and see current policy defaults.
2. **Create exposure:**
   - Have a running local service? → `expose_port(port, opts?)`
   - Need to share/preview files or directories? → `expose_files(paths, opts?)`
3. **After creation succeeds:** Present `public_url` and `expires_at` to the user. Remind them to call `exposure_stop` when finished.
4. **Inspect / monitor:** `exposure_get(id)` with optional `probe_public: true` to verify end-to-end reachability.
5. **Troubleshoot:** `exposure_logs(id)` when something goes wrong.
6. **Cleanup:** `exposure_stop(id)` or `exposure_stop(id="all")`.

---

## Tool Reference

### 1. `env_check`

Check that `cloudflared` is installed, resolve its version, and return effective policy defaults.

---

### 2. `expose_port`

Expose an already-running local service via Cloudflare Quick Tunnel. The tool probes `127.0.0.1:<port>` before proceeding and rejects blocked ports.

**Errors:** `"invalid port"`, `"port blocked by policy: <N>"`, `"local service is not reachable on 127.0.0.1:<N>"`.

---

### 3. `expose_files`

Copy files/directories into a temporary workspace, start a read-only static file server, and tunnel it publicly.

**File Serving Behavior**

Mode: normal

- Single file → served directly at the root URL.
- Multiple files or a directory → displayed in an intuitive file explorer interface.

Mode: zip

- All files are packaged into a ZIP archive.

**Presentation**

- Default behaviors: download | preview | raw
- Behavior can be overridden via query parameters.
  - download → forces browser file save.
  - preview → renders inline (images, PDF, Markdown, audio/video, HTML, text, etc.).
  - raw → serves original content without any wrapper.
- If a file type is not previewable, preview automatically falls back to raw, then to download.

---

### 4. `exposure_list`

List all tracked sessions (both active and recently-stopped within-process).

---

### 5. `exposure_get`

Get detailed information about one or more sessions. Supports three selection modes (mutually exclusive input shapes via union schema):

---

### 6. `exposure_stop`

Stop one, several, or all exposures. Terminates cloudflared process, shuts down origin/proxy servers, and deletes temporary workspace files.

---

### 7. `exposure_logs`

Fetch merged logs from cloudflared tunnel and origin server components.

---

### 8. `maintenance`

Lifecycle management operations.

**Action details:**

- **`start_guard`** — Start the TTL expiration reaper (runs periodically; usually auto-started).
- **`run_gc`** — Clean up orphaned workspace directories and stale processes not tracked by any active session.
- **`set_policy`** — Persist a policy change to disk and reload. Requires at least one of `opts.policy` or `opts.ignore_patterns`.

---

### 9. `audit_query`

Search audit event log.

---

### 10. `audit_export`

Export filtered audit events to a local JSONL file.

---

## Security & Policy Defaults

Policy priority (highest wins): **policy JSON file** > **plugin config** > **built-in defaults**.

---

## Response Behavior Rules

When presenting results to the user, the LLM **must**:

1. **Always display `public_url` and `expires_at`** after creating an exposure.
2. **Present timestamps** in the user’s local time zone using a human-readable format (`yyyy-mm-dd HH:MM:SS`). Never include timezone indicators or raw ISO strings.
3. **Warn** when `access` mode is `"none"` — the link is publicly accessible without authentication.
4. **Include cleanup instructions** — include `exposure_stop` guidance after successful sharing.
5. **On error**, suggest `exposure_logs(id)` for diagnostics.
6. **For security** — if user intent is ambiguous or potentially sensitive, request confirmation before creating exposure.
