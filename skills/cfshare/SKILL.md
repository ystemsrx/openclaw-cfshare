---
name: cfshare
description: Expose local ports, files, or directories to temporary public https://*.trycloudflare.com links through the cfshare plugin tools. Use when users ask to share localhost services, send downloadable files, inspect exposure status/logs, stop exposures, or audit exposure history.
metadata: { "openclaw": { "emoji": "☁️", "skillKey": "cfshare", "requires": { "config": ["plugins.entries.cfshare.enabled"] } } }
---

# CFShare

Use CFShare tools to create short-lived public links with safer defaults.

## Preferred workflow

1. Call `env_check` first.
2. For existing local service, call `expose_port`.
3. For file sharing, call `expose_files`.
4. After creation, call `exposure_get` to present status and usage snippets.
5. Use `exposure_logs` when connection/auth problems appear.
6. Use `exposure_stop` as soon as sharing is finished.

## Safety defaults

- Default TTL is temporary (policy-driven, usually 3600 seconds).
- `expose_port` defaults to token access and origin protection.
- `expose_files` defaults to no auth unless explicitly requested.
- Path/file deny patterns use `.gitignore` semantics from policy ignore rules.

## Tool quick reference

- `env_check`: validate cloudflared/path/version and effective defaults.
- `expose_port`: share `localhost:<port>` with optional token/basic auth.
- `expose_files`: copy files into temporary workspace, start read-only server, expose it. Use `opts.mode` as `normal` (single file direct, multi-file index) or `zip` (bundle download), and `opts.presentation` to control delivery style: `download` (default), `preview`, or `raw`.
- `exposure_list`: list sessions.
- `exposure_get`: full status + usage snippets. Supports `id`, `ids`, or `filter` with optional `fields` projection.
- `exposure_stop`: stop one, many (`ids`), or all sessions and cleanup.
- `exposure_logs`: inspect tunnel/origin logs for one or many sessions.
- `maintenance`: guard/gc/set_policy lifecycle.
- `audit_query`: search audit events.
- `audit_export`: export audit events to local JSONL file.

## Good response behavior

- Always show `public_url` and `expires_at` after exposure creation.
- Warn when access mode is `none`.
- Include `exposure_stop` guidance after successful sharing.
