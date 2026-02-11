import type { FilePresentationMode, ManifestEntry } from "../types.js";

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type RenderFileExplorerTemplateParams = {
  title: string;
  mode: "normal" | "zip";
  presentation: FilePresentationMode;
  manifest: ManifestEntry[];
  autoEnterSingleDirectory?: boolean;
  rootDirectories?: string[];
};

export function renderFileExplorerTemplate(params: RenderFileExplorerTemplateParams): string {
  const title = escapeHtml(params.title);
  const payload = Buffer.from(
    JSON.stringify({
      title: params.title,
      mode: params.mode,
      presentation: params.presentation,
      manifest: params.manifest,
      autoEnterSingleDirectory: params.autoEnterSingleDirectory !== false,
      rootDirectories: Array.isArray(params.rootDirectories) ? params.rootDirectories : [],
    }),
    "utf8",
  ).toString("base64");

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://unpkg.com/lucide@0.469.0/dist/umd/lucide.min.js"></script>
  </head>
  <body>
    <div class="flex h-screen w-full bg-gray-50 text-slate-800 font-sans overflow-hidden select-none">
      <main class="flex-1 flex flex-col h-full overflow-hidden relative">
        <header class="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-4 md:px-6 shrink-0">
          <div id="breadcrumb" class="hidden md:flex items-center gap-1 overflow-hidden flex-1 mr-4"></div>

          <div class="flex items-center gap-3">
            <div class="relative">
              <i data-lucide="search" class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" style="width: 16px; height: 16px"></i>
              <input
                id="search-input"
                type="text"
                placeholder="搜索文件..."
                class="pl-9 pr-4 py-2 bg-gray-100 border-none rounded-full text-sm w-48 focus:w-64 focus:ring-2 focus:ring-blue-100 focus:bg-white transition-all outline-none placeholder-gray-400"
              />
            </div>

            <div class="h-6 w-px bg-gray-200 mx-1"></div>

            <div class="flex bg-gray-100 p-1 rounded-lg">
              <button
                id="view-grid"
                class="p-1.5 rounded-md transition-all bg-white shadow-sm text-blue-600"
              >
                <i data-lucide="grid-3x3" style="width: 18px; height: 18px"></i>
              </button>
              <button
                id="view-list"
                class="p-1.5 rounded-md transition-all text-gray-500 hover:text-gray-700"
              >
                <i data-lucide="list" style="width: 18px; height: 18px"></i>
              </button>
            </div>
          </div>
        </header>

        <div id="mobile-breadcrumb" class="md:hidden bg-white border-b border-gray-200 px-3 py-2 overflow-x-auto whitespace-nowrap"></div>

        <div id="file-area" class="flex-1 overflow-y-auto p-6 scroll-smooth"></div>

        <aside
          id="details-panel"
          class="absolute right-0 top-0 bottom-0 w-80 bg-white border-l border-gray-200 shadow-2xl z-30 flex flex-col transform transition-transform duration-300 ease-in-out translate-x-full"
        ></aside>
      </main>
    </div>

    <script>
      (function () {
        const rawPayload = "${payload}";
        const bytes = Uint8Array.from(atob(rawPayload), function (char) { return char.charCodeAt(0); });
        const payload = JSON.parse(new TextDecoder("utf-8").decode(bytes));

        const imageExtensions = new Set([
          "png",
          "jpg",
          "jpeg",
          "gif",
          "webp",
          "ico",
          "bmp",
          "tiff",
          "tif",
          "heic",
          "raw",
          "svg",
        ]);

        const specialNamesConfig = {
          dockerfile: { icon: "package", color: "text-blue-500" },
          makefile: { icon: "terminal", color: "text-slate-600" },
          license: { icon: "shield", color: "text-yellow-600" },
          jenkinsfile: { icon: "settings", color: "text-red-500" },
          gemfile: { icon: "code-2", color: "text-red-600" },
          "package.json": { icon: "file-json", color: "text-red-500" },
          "package-lock.json": { icon: "file-cog", color: "text-slate-500" },
          "yarn.lock": { icon: "file-cog", color: "text-blue-400" },
          "tsconfig.json": { icon: "file-code", color: "text-blue-600" },
          ".gitignore": { icon: "file-cog", color: "text-slate-500" },
          ".env": { icon: "settings", color: "text-slate-600" },
          ".env.local": { icon: "settings", color: "text-slate-600" },
          ".editorconfig": { icon: "settings", color: "text-slate-600" },
          "readme.md": { icon: "file-text", color: "text-blue-500" },
          "changelog.md": { icon: "clock", color: "text-orange-500" },
        };

        const extensionGroups = [
          {
            icon: "image",
            color: "text-purple-500",
            exts: ["png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "tiff", "tif", "heic", "raw"],
          },
          { icon: "image", color: "text-orange-500", exts: ["svg"] },
          { icon: "palette", color: "text-pink-500", exts: ["fig", "sketch", "xd", "ai", "psd", "eps", "indd"] },
          { icon: "file-text", color: "text-red-500", exts: ["pdf"] },
          { icon: "file-text", color: "text-blue-600", exts: ["doc", "docx", "pages", "odt", "rtf"] },
          { icon: "file-text", color: "text-slate-500", exts: ["txt", "log", "md", "markdown"] },
          { icon: "file-spreadsheet", color: "text-emerald-600", exts: ["xlsx", "xls", "numbers", "ods"] },
          { icon: "table", color: "text-emerald-500", exts: ["csv", "tsv", "dat"] },
          { icon: "layout", color: "text-orange-500", exts: ["ppt", "pptx", "key", "odp"] },
          { icon: "music", color: "text-violet-500", exts: ["mp3", "wav", "flac", "ogg", "m4a", "aac", "wma", "aiff"] },
          { icon: "video", color: "text-rose-500", exts: ["mp4", "mov", "avi", "mkv", "webm", "wmv", "flv", "3gp", "m4v"] },
          { icon: "file-code", color: "text-yellow-500", exts: ["js", "jsx", "mjs", "cjs"] },
          { icon: "file-code", color: "text-blue-500", exts: ["ts", "tsx"] },
          { icon: "globe", color: "text-orange-600", exts: ["html", "htm"] },
          { icon: "file-code", color: "text-sky-500", exts: ["css", "scss", "less", "sass", "styl"] },
          { icon: "file-json", color: "text-yellow-600", exts: ["json", "json5"] },
          { icon: "file-code", color: "text-emerald-500", exts: ["vue", "svelte"] },
          { icon: "file-code", color: "text-blue-600", exts: ["py", "pyc", "whl"] },
          { icon: "file-code", color: "text-red-600", exts: ["java", "jar", "class", "war"] },
          { icon: "file-code", color: "text-slate-600", exts: ["c", "h", "m"] },
          { icon: "file-code", color: "text-blue-700", exts: ["cpp", "hpp", "cc", "cxx"] },
          { icon: "file-code", color: "text-cyan-600", exts: ["go"] },
          { icon: "code-2", color: "text-orange-600", exts: ["rs"] },
          { icon: "file-code", color: "text-indigo-500", exts: ["php"] },
          { icon: "code-2", color: "text-red-500", exts: ["rb", "erb"] },
          { icon: "file-code", color: "text-orange-500", exts: ["swift"] },
          { icon: "file-code", color: "text-purple-600", exts: ["kt", "kts"] },
          { icon: "file-code", color: "text-blue-400", exts: ["dart"] },
          { icon: "file-code", color: "text-blue-800", exts: ["lua"] },
          { icon: "file-code", color: "text-gray-600", exts: ["pl", "pm"] },
          { icon: "file-code", color: "text-blue-300", exts: ["r"] },
          { icon: "database", color: "text-pink-600", exts: ["sql", "db", "sqlite", "db3", "pgsql"] },
          { icon: "terminal", color: "text-green-600", exts: ["sh", "bat", "cmd", "ps1", "bash", "zsh", "fish"] },
          {
            icon: "settings",
            color: "text-slate-600",
            exts: ["yaml", "yml", "toml", "ini", "conf", "config", "env", "properties"],
          },
          { icon: "archive", color: "text-amber-600", exts: ["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "iso", "tgz"] },
          { icon: "package", color: "text-slate-700", exts: ["exe", "dmg", "msi", "bin", "app", "deb", "rpm", "apk", "ipa"] },
        ];

        const extensionConfig = Object.fromEntries(
          extensionGroups.flatMap(function (group) {
            return group.exts.map(function (ext) {
              return [ext, { icon: group.icon, color: group.color }];
            });
          }),
        );

        function escapeHtml(value) {
          return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\"/g, "&quot;")
            .replace(/'/g, "&#39;");
        }

        function formatBytes(input) {
          const bytes = Number(input);
          if (!Number.isFinite(bytes) || bytes < 0) {
            return "-";
          }
          if (bytes < 1024) {
            return String(bytes) + " B";
          }
          const units = ["KB", "MB", "GB", "TB", "PB"];
          let value = bytes / 1024;
          let unitIndex = 0;
          while (value >= 1024 && unitIndex < units.length - 1) {
            value /= 1024;
            unitIndex += 1;
          }
          return value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2) + " " + units[unitIndex];
        }

        function formatDate(input) {
          if (!input) {
            return "-";
          }
          const ms = Date.parse(String(input));
          if (!Number.isFinite(ms)) {
            return "-";
          }
          return new Date(ms).toLocaleDateString("zh-CN");
        }

        function getExtension(name) {
          const lower = String(name || "").toLowerCase();
          const index = lower.lastIndexOf(".");
          if (index < 0 || index === lower.length - 1) {
            return "file";
          }
          return lower.slice(index + 1);
        }

        function normalizePath(value) {
          return String(value || "")
            .replace(/\\\\/g, "/")
            .replace(/^\\/+/, "")
            .replace(/\\/+$/, "");
        }

        function getIconMeta(fileName, type) {
          if (type === "folder") {
            return { icon: "folder", color: "text-blue-500 fill-blue-500/20" };
          }

          const safeName = String(fileName || "").toLowerCase();
          const safeType = String(type || "").toLowerCase();

          if (specialNamesConfig[safeName]) {
            return specialNamesConfig[safeName];
          }

          let extension = safeType;
          if (!extension || extension === "file") {
            const parts = safeName.split(".");
            if (parts.length > 1) {
              extension = parts.pop();
            }
          }

          if (extension && extensionConfig[extension]) {
            return extensionConfig[extension];
          }

          return { icon: "file", color: "text-gray-300" };
        }

        function renderIcon(fileName, type, size) {
          const meta = getIconMeta(fileName, type);
          return '<i data-lucide="' + meta.icon + '" class="' + meta.color + '" style="width: ' + String(size) + 'px; height: ' + String(size) + 'px"></i>';
        }

        function buildData(manifest, rootDirectories) {
          const items = [];
          const byId = new Map();
          const folderByPath = new Map();
          const folderStats = new Map();

          const rootItem = {
            id: "root",
            parentId: "",
            pathKey: "",
            name: payload.title || "cfshare",
            type: "folder",
            size: "-",
            sizeBytes: 0,
            date: "-",
            dateMs: 0,
            relativeUrl: "",
          };

          items.push(rootItem);
          byId.set(rootItem.id, rootItem);
          folderByPath.set("", rootItem);
          folderStats.set("", { sizeBytes: 0, dateMs: 0 });

          let seq = 0;
          const getFolder = function (pathKey, name, parentKey) {
            if (folderByPath.has(pathKey)) {
              return folderByPath.get(pathKey);
            }
            const parentFolder = folderByPath.get(parentKey) || rootItem;
            const folder = {
              id: "d_" + String(++seq),
              parentId: parentFolder.id,
              pathKey: pathKey,
              name: name,
              type: "folder",
              size: "-",
              sizeBytes: 0,
              date: "-",
              dateMs: 0,
              relativeUrl: "",
            };
            items.push(folder);
            byId.set(folder.id, folder);
            folderByPath.set(pathKey, folder);
            folderStats.set(pathKey, { sizeBytes: 0, dateMs: 0 });
            return folder;
          };

          for (const rootNameRaw of Array.isArray(rootDirectories) ? rootDirectories : []) {
            const rootName = normalizePath(rootNameRaw);
            if (!rootName || rootName.includes("/")) {
              continue;
            }
            getFolder(rootName, rootName, "");
          }

          for (const entry of manifest) {
            const normalized = normalizePath(entry && entry.name ? entry.name : "");
            if (!normalized) {
              continue;
            }
            const parts = normalized.split("/").filter(Boolean);
            if (parts.length === 0) {
              continue;
            }

            let parentKey = "";
            for (let i = 0; i < parts.length - 1; i += 1) {
              const segment = parts[i];
              const currentKey = parentKey ? parentKey + "/" + segment : segment;
              getFolder(currentKey, segment, parentKey);
              parentKey = currentKey;
            }

            const fileName = parts[parts.length - 1];
            const parentFolder = folderByPath.get(parentKey) || rootItem;
            const sizeBytes = Number(entry && entry.size ? entry.size : 0);
            const modifiedAt = entry && entry.modified_at ? String(entry.modified_at) : "";
            const modifiedMs = Date.parse(modifiedAt);
            const extension = getExtension(fileName);
            const fileItem = {
              id: "f_" + String(++seq),
              parentId: parentFolder.id,
              pathKey: normalized,
              name: fileName,
              type: extension,
              size: formatBytes(sizeBytes),
              sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : 0,
              date: formatDate(modifiedAt),
              dateMs: Number.isFinite(modifiedMs) ? modifiedMs : 0,
              relativeUrl: entry && entry.relative_url ? String(entry.relative_url) : "/" + normalized,
              isBinary: entry && typeof entry.is_binary === "boolean" ? Boolean(entry.is_binary) : undefined,
              previewSupported:
                entry && typeof entry.preview_supported === "boolean"
                  ? Boolean(entry.preview_supported)
                  : undefined,
            };
            items.push(fileItem);
            byId.set(fileItem.id, fileItem);

            let walker = parentKey;
            for (;;) {
              const stats = folderStats.get(walker);
              if (stats) {
                stats.sizeBytes += fileItem.sizeBytes;
                if (fileItem.dateMs > stats.dateMs) {
                  stats.dateMs = fileItem.dateMs;
                }
              }
              if (!walker) {
                break;
              }
              const lastSlash = walker.lastIndexOf("/");
              walker = lastSlash < 0 ? "" : walker.slice(0, lastSlash);
            }
          }

          for (const [pathKey, stats] of folderStats.entries()) {
            const folder = folderByPath.get(pathKey);
            if (!folder) {
              continue;
            }
            folder.sizeBytes = stats.sizeBytes;
            folder.size = formatBytes(stats.sizeBytes);
            folder.dateMs = stats.dateMs;
            folder.date = stats.dateMs > 0 ? formatDate(new Date(stats.dateMs).toISOString()) : "-";
          }

          return { items: items, byId: byId };
        }

        const data = buildData(
          Array.isArray(payload.manifest) ? payload.manifest : [],
          Array.isArray(payload.rootDirectories) ? payload.rootDirectories : [],
        );
        const rootChildren = data.items.filter(function (item) {
          return item.parentId === "root";
        });
        const rootFolders = rootChildren.filter(function (item) {
          return item.type === "folder";
        });
        const rootFiles = rootChildren.filter(function (item) {
          return item.type !== "folder";
        });
        const shouldAutoEnterSingleDirectory = payload.autoEnterSingleDirectory !== false;
        const autoEnterFolder =
          shouldAutoEnterSingleDirectory && rootFolders.length === 1 && rootFiles.length === 0
            ? rootFolders[0]
            : null;

        const state = {
          currentPath: autoEnterFolder
            ? [
                { id: "root", name: payload.title || "cfshare" },
                { id: autoEnterFolder.id, name: autoEnterFolder.name },
              ]
            : [{ id: "root", name: payload.title || "cfshare" }],
          selectedFileId: null,
          viewMode: "grid",
          searchQuery: "",
          panelFile: null,
          isPanelOpen: false,
          presentation: payload.presentation || "download",
          suppressClicksUntil: 0,
        };

        const breadcrumbEl = document.getElementById("breadcrumb");
        const mobileBreadcrumbEl = document.getElementById("mobile-breadcrumb");
        const fileAreaEl = document.getElementById("file-area");
        const panelEl = document.getElementById("details-panel");
        const searchInputEl = document.getElementById("search-input");
        const viewGridEl = document.getElementById("view-grid");
        const viewListEl = document.getElementById("view-list");

        let panelTimer = null;
        let panelCloseTimer = null;
        const PANEL_ANIMATION_MS = 320;

        function closestFromEventTarget(target, selector) {
          if (!target) {
            return null;
          }
          if (target instanceof Element) {
            return target.closest(selector);
          }
          if (target instanceof Node && target.parentElement) {
            return target.parentElement.closest(selector);
          }
          return null;
        }

        function getCurrentFolderId() {
          return state.currentPath[state.currentPath.length - 1].id;
        }

        function shouldSuppressClick() {
          return Date.now() < state.suppressClicksUntil;
        }

        function suppressInteraction(durationMs) {
          const until = Date.now() + Math.max(0, Number(durationMs) || 0);
          if (until > state.suppressClicksUntil) {
            state.suppressClicksUntil = until;
          }
        }

        function applyMobilePanelOpenState(open) {
          const backdrop = document.getElementById("panel-backdrop");
          const modalCard = document.getElementById("panel-modal-card");
          if (!backdrop || !modalCard) {
            return false;
          }
          backdrop.classList.remove("opacity-0", "opacity-100");
          backdrop.classList.add(open ? "opacity-100" : "opacity-0");

          modalCard.classList.remove(
            "-translate-y-[46%]",
            "-translate-y-[50%]",
            "opacity-0",
            "opacity-100",
            "scale-95",
            "scale-100",
          );
          if (open) {
            modalCard.classList.add("-translate-y-[50%]", "opacity-100", "scale-100");
          } else {
            modalCard.classList.add("-translate-y-[46%]", "opacity-0", "scale-95");
          }
          return true;
        }

        function getCurrentFiles() {
          if (state.searchQuery.trim() !== "") {
            const q = state.searchQuery.trim().toLowerCase();
            return data.items.filter(function (item) {
              return item.id !== "root" && String(item.name).toLowerCase().includes(q);
            });
          }
          const folderId = getCurrentFolderId();
          return data.items.filter(function (item) {
            return item.parentId === folderId;
          });
        }

        function isImageItem(item) {
          if (!item || item.type === "folder") {
            return false;
          }
          return imageExtensions.has(String(item.type).toLowerCase());
        }

        const textLikeExtensions = new Set([
          "txt",
          "log",
          "md",
          "markdown",
          "rmd",
          "qmd",
          "json",
          "json5",
          "yaml",
          "yml",
          "toml",
          "ini",
          "conf",
          "config",
          "env",
          "properties",
          "xml",
          "csv",
          "tsv",
          "dat",
          "sql",
          "graphql",
          "js",
          "jsx",
          "mjs",
          "cjs",
          "ts",
          "tsx",
          "html",
          "htm",
          "css",
          "scss",
          "less",
          "sass",
          "styl",
          "vue",
          "svelte",
          "py",
          "java",
          "c",
          "h",
          "cpp",
          "hpp",
          "cc",
          "cxx",
          "go",
          "rs",
          "php",
          "rb",
          "erb",
          "swift",
          "kt",
          "kts",
          "dart",
          "lua",
          "pl",
          "pm",
          "r",
          "sh",
          "bat",
          "cmd",
          "ps1",
          "bash",
          "zsh",
          "fish",
          "dockerfile",
          "makefile",
          "gitignore",
          "editorconfig",
        ]);

        const previewSupportedExtensions = new Set([
          "md",
          "markdown",
          "rmd",
          "qmd",
          "html",
          "htm",
          "svg",
        ]);

        const knownBinaryExtensions = new Set([
          "pdf",
          "doc",
          "docx",
          "pages",
          "odt",
          "rtf",
          "xlsx",
          "xls",
          "numbers",
          "ods",
          "ppt",
          "pptx",
          "key",
          "odp",
          "mp3",
          "wav",
          "flac",
          "ogg",
          "m4a",
          "aac",
          "wma",
          "aiff",
          "mp4",
          "mov",
          "avi",
          "mkv",
          "webm",
          "wmv",
          "flv",
          "3gp",
          "m4v",
          "zip",
          "rar",
          "7z",
          "tar",
          "gz",
          "bz2",
          "xz",
          "iso",
          "tgz",
          "exe",
          "dmg",
          "msi",
          "bin",
          "app",
          "deb",
          "rpm",
          "apk",
          "ipa",
          "db",
          "sqlite",
          "db3",
          "whl",
          "jar",
          "class",
          "war",
        ]);

        function getItemExtension(item) {
          if (!item) {
            return "";
          }
          return String(item.type || getExtension(item.name)).toLowerCase();
        }

        function isBinaryItem(item) {
          if (!item || item.type === "folder") {
            return false;
          }
          if (typeof item.isBinary === "boolean") {
            return item.isBinary;
          }
          const extension = getItemExtension(item);
          if (textLikeExtensions.has(extension)) {
            return false;
          }
          if (imageExtensions.has(extension)) {
            return true;
          }
          if (knownBinaryExtensions.has(extension)) {
            return true;
          }
          return false;
        }

        function supportsPreview(item) {
          if (!item || item.type === "folder") {
            return false;
          }
          if (typeof item.previewSupported === "boolean") {
            return item.previewSupported;
          }
          if (isBinaryItem(item)) {
            return false;
          }
          return previewSupportedExtensions.has(getItemExtension(item));
        }

        function buildActionUrl(item, action) {
          if (!item) {
            return null;
          }

          let relativeUrl = "";
          if (action === "folder-zip") {
            const folderPath = normalizePath(item.pathKey || "");
            if (!folderPath) {
              return null;
            }
            relativeUrl = "/__cfshare__/download-folder.zip?path=" + encodeURIComponent(folderPath);
          } else {
            if (!item.relativeUrl) {
              return null;
            }
            relativeUrl = item.relativeUrl;
          }

          try {
            const target = new URL(relativeUrl, window.location.origin);
            const current = new URL(window.location.href);
            const currentToken = current.searchParams.get("token");
            if (currentToken && !target.searchParams.get("token")) {
              target.searchParams.set("token", currentToken);
            }
            if (action === "preview" || action === "raw" || action === "download") {
              target.searchParams.set("delivery", action);
            }
            return target.toString();
          } catch {
            return null;
          }
        }

        function openItemAction(item, action) {
          const openUrl = buildActionUrl(item, action);
          if (!openUrl) {
            return;
          }
          if (action === "preview" || action === "raw") {
            window.open(openUrl, "_blank", "noopener");
            return;
          }
          window.location.href = openUrl;
        }

        function openPreviewOrRaw(item) {
          if (!item || item.type === "folder") {
            return;
          }
          openItemAction(item, supportsPreview(item) ? "preview" : "raw");
        }

        function getInlinePreviewUrl(item) {
          if (!item || item.type === "folder") {
            return null;
          }
          if (supportsPreview(item)) {
            return buildActionUrl(item, "preview");
          }
          if (!isBinaryItem(item)) {
            return buildActionUrl(item, "raw");
          }
          return null;
        }

        function isMobileViewport() {
          return window.matchMedia("(max-width: 768px)").matches;
        }

        function setSelectedFile(itemId) {
          state.selectedFileId = itemId;
          const selected = itemId ? data.byId.get(itemId) || null : null;
          if (selected) {
            if (panelCloseTimer) {
              clearTimeout(panelCloseTimer);
              panelCloseTimer = null;
            }
            state.panelFile = selected;
          }
          if (panelTimer) {
            clearTimeout(panelTimer);
            panelTimer = null;
          }
          if (itemId) {
            state.isPanelOpen = false;
            renderPanel();
            panelTimer = setTimeout(function () {
              state.isPanelOpen = true;
              if (isMobileViewport() && applyMobilePanelOpenState(true)) {
                return;
              }
              renderPanel();
            }, 200);
          } else {
            state.isPanelOpen = false;
            const mobileClosingAnimated = isMobileViewport() && applyMobilePanelOpenState(false);
            if (isMobileViewport()) {
              suppressInteraction(PANEL_ANIMATION_MS + 520);
            }
            if (panelCloseTimer) {
              clearTimeout(panelCloseTimer);
            }
            panelCloseTimer = setTimeout(function () {
              panelCloseTimer = null;
              if (state.selectedFileId || state.isPanelOpen) {
                return;
              }
              state.panelFile = null;
              renderPanel();
            }, PANEL_ANIMATION_MS);
            if (!mobileClosingAnimated) {
              renderPanel();
            }
          }
          renderFileArea();
        }

        function navigateToFolder(folderId, folderName) {
          state.searchQuery = "";
          if (searchInputEl) {
            searchInputEl.value = "";
          }
          state.currentPath = state.currentPath.concat([{ id: folderId, name: folderName }]);
          setSelectedFile(null);
          renderBreadcrumb();
          renderFileArea();
        }

        function onBreadcrumbClick(index) {
          state.searchQuery = "";
          if (searchInputEl) {
            searchInputEl.value = "";
          }
          state.currentPath = state.currentPath.slice(0, index + 1);
          setSelectedFile(null);
          renderBreadcrumb();
          renderFileArea();
        }

        function onItemDoubleClick(item) {
          if (!item) {
            return;
          }
          if (item.type === "folder") {
            navigateToFolder(item.id, item.name);
            return;
          }
          if (supportsPreview(item)) {
            openItemAction(item, "preview");
            return;
          }
          if (isBinaryItem(item)) {
            openItemAction(item, "download");
            return;
          }
          openPreviewOrRaw(item);
        }

        function renderBreadcrumb() {
          if (!breadcrumbEl) {
            return;
          }
          breadcrumbEl.innerHTML = state.currentPath
            .map(function (item, index) {
              const isCurrent = index === state.currentPath.length - 1;
              return '<div class="flex items-center whitespace-nowrap">'
                + (index > 0
                  ? '<i data-lucide="chevron-right" class="text-gray-400 mx-1" style="width: 16px; height: 16px"></i>'
                  : "")
                + '<button data-breadcrumb-index="'
                + String(index)
                + '" class="px-2 py-1 rounded-md text-sm transition-colors '
                + (isCurrent
                  ? "font-semibold text-slate-900 bg-gray-100"
                  : "text-gray-500 hover:bg-gray-50 hover:text-slate-700")
                + '">'
                + escapeHtml(item.name)
                + "</button></div>";
            })
            .join("");
          if (mobileBreadcrumbEl) {
            mobileBreadcrumbEl.innerHTML = state.currentPath
              .map(function (item, index) {
                const isCurrent = index === state.currentPath.length - 1;
                return '<button data-breadcrumb-index="'
                  + String(index)
                  + '" class="inline-flex items-center text-sm '
                  + (isCurrent ? "font-semibold text-slate-900" : "text-slate-500")
                  + '">'
                  + (index > 0 ? '<span class="mx-1.5 text-slate-300">/</span>' : "")
                  + '<span>'
                  + escapeHtml(item.name)
                  + "</span></button>";
              })
              .join("");
          }
          if (window.lucide && window.lucide.createIcons) {
            window.lucide.createIcons();
          }
        }

        function renderEmptyFolder() {
          return '<div class="h-full flex flex-col items-center justify-center text-gray-400">'
            + '<i data-lucide="folder" class="mb-4 opacity-20" style="width: 64px; height: 64px"></i>'
            + "<p>此文件夹为空</p>"
            + "</div>";
        }

        function renderFileCard(file, selected) {
          return '<div data-item-id="'
            + escapeHtml(file.id)
            + '" class="group relative p-4 rounded-xl border flex flex-col items-center gap-3 cursor-pointer transition-all duration-200 '
            + (selected
              ? "bg-blue-50 border-blue-400 shadow-[0_0_0_1px_rgba(96,165,250,1)]"
              : "bg-white border-gray-100 hover:border-gray-300 hover:shadow-md")
            + '">'
            + '<div class="w-12 h-12 flex items-center justify-center transition-transform group-hover:scale-110 duration-300">'
            + renderIcon(file.name, file.type, 32)
            + "</div>"
            + '<div class="text-center w-full">'
            + '<p class="text-sm font-medium text-slate-700 truncate w-full px-2" title="'
            + escapeHtml(file.name)
            + '">'
            + escapeHtml(file.name)
            + "</p>"
            + '<p class="text-xs text-gray-400 mt-1">'
            + escapeHtml(file.date)
            + "</p>"
            + "</div></div>";
        }

        function renderFileRow(file, selected) {
          return '<tr data-item-id="'
            + escapeHtml(file.id)
            + '" class="cursor-pointer transition-colors group '
            + (selected ? "bg-blue-50" : "hover:bg-gray-50")
            + '">'
            + '<td class="px-6 py-4 whitespace-nowrap">'
            + '<div class="flex items-center">'
            + '<div class="shrink-0 h-8 w-8 flex items-center justify-center">'
            + renderIcon(file.name, file.type, 20)
            + "</div>"
            + '<div class="ml-4"><div class="text-sm font-medium text-gray-900">'
            + escapeHtml(file.name)
            + "</div></div></div></td>"
            + '<td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">'
            + escapeHtml(file.size)
            + "</td>"
            + '<td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">'
            + escapeHtml(file.date)
            + "</td>"
            + '<td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">'
            + '<button data-download-id="'
            + escapeHtml(file.id)
            + '" class="text-gray-400 hover:text-blue-600 transition-colors" title="'
            + (file.type === "folder" ? "打包下载" : "下载文件")
            + '">'
            + '<i data-lucide="download" style="width: 18px; height: 18px"></i>'
            + "</button></td></tr>";
        }

        function renderPanelActions(panelFile, mobileLayout) {
          if (panelFile.type === "folder") {
            return '<button id="panel-folder-download" class="w-full bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-xl font-medium transition-colors shadow-sm flex items-center justify-center gap-2">'
              + '<i data-lucide="download" style="width: 16px; height: 16px"></i>'
              + "打包下载"
              + "</button>";
          }

          if (isImageItem(panelFile)) {
            return '<button id="panel-download" class="w-full '
              + (mobileLayout ? "bg-blue-600 hover:bg-blue-700 text-white" : "bg-white hover:bg-gray-100 border border-gray-200 text-slate-700")
              + ' py-2.5 rounded-xl font-medium transition-colors shadow-sm flex items-center justify-center gap-2">'
              + '<i data-lucide="download" style="width: 16px; height: 16px"></i>'
              + "下载"
              + "</button>";
          }

          if (supportsPreview(panelFile) || !isBinaryItem(panelFile)) {
            return '<div class="grid grid-cols-2 gap-2.5">'
              + '<button id="panel-preview" class="bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-xl font-medium transition-colors shadow-sm flex items-center justify-center gap-2">'
              + '<i data-lucide="eye" style="width: 16px; height: 16px"></i>'
              + "预览"
              + "</button>"
              + '<button id="panel-download" class="bg-white hover:bg-gray-100 border border-gray-200 text-slate-700 py-2.5 rounded-xl font-medium transition-colors shadow-sm flex items-center justify-center gap-2">'
              + '<i data-lucide="download" style="width: 16px; height: 16px"></i>'
              + "下载"
              + "</button>"
              + "</div>";
          }

          return '<button id="panel-download" class="w-full bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-xl font-medium transition-colors shadow-sm flex items-center justify-center gap-2">'
            + '<i data-lucide="download" style="width: 16px; height: 16px"></i>'
            + "下载文件"
            + "</button>";
        }

        function renderFileArea() {
          if (!fileAreaEl) {
            return;
          }

          const currentFiles = getCurrentFiles();
          if (currentFiles.length === 0) {
            fileAreaEl.innerHTML = renderEmptyFolder();
            if (window.lucide && window.lucide.createIcons) {
              window.lucide.createIcons();
            }
            return;
          }

          if (state.viewMode === "grid") {
            const cards = currentFiles
              .map(function (file) {
                return renderFileCard(file, state.selectedFileId === file.id);
              })
              .join("");
            fileAreaEl.innerHTML = '<div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">'
              + cards
              + "</div>";
          } else {
            const rows = currentFiles
              .map(function (file) {
                return renderFileRow(file, state.selectedFileId === file.id);
              })
              .join("");
            fileAreaEl.innerHTML = '<div class="min-w-full inline-block align-middle">'
              + '<div class="border border-gray-200 rounded-lg overflow-hidden">'
              + '<table class="min-w-full divide-y divide-gray-200">'
              + '<thead class="bg-gray-50"><tr>'
              + '<th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">名称</th>'
              + '<th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">大小</th>'
              + '<th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">修改日期</th>'
              + '<th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>'
              + '</tr></thead><tbody class="bg-white divide-y divide-gray-200">'
              + rows
              + "</tbody></table></div></div>";
          }

          if (window.lucide && window.lucide.createIcons) {
            window.lucide.createIcons();
          }
        }

        function renderPanel() {
          if (!panelEl) {
            return;
          }

          const panelFile = state.panelFile;
          const mobileLayout = isMobileViewport();
          if (!panelFile) {
            panelEl.className = mobileLayout
              ? "fixed inset-0 z-40 pointer-events-none"
              : "absolute right-0 top-0 bottom-0 w-80 bg-white border-l border-gray-200 shadow-2xl z-30 flex flex-col transform transition-transform duration-300 ease-in-out translate-x-full";
            panelEl.innerHTML = "";
            return;
          }

          if (mobileLayout) {
            const previewUrl = getInlinePreviewUrl(panelFile);
            const modalHeightClass = isImageItem(panelFile) ? "max-h-[86vh]" : "max-h-[68vh]";
            panelEl.className = "fixed inset-0 z-40 pointer-events-auto";
            panelEl.innerHTML = '<div id="panel-backdrop" class="absolute inset-0 bg-slate-900/45 transition-opacity duration-200 '
              + (state.isPanelOpen ? "opacity-100" : "opacity-0")
              + '"></div>'
              + '<div id="panel-modal-card" class="absolute inset-x-3 top-1/2 rounded-2xl bg-white shadow-2xl border border-slate-200 flex flex-col overflow-hidden transform transition-all duration-300 '
              + modalHeightClass
              + " "
              + "-translate-y-[46%] opacity-0 scale-95"
              + '">'
              + '<div class="p-4 border-b border-gray-100 flex items-center justify-between bg-white/95 backdrop-blur">'
              + '<span class="font-semibold text-slate-800">详细信息</span>'
              + '<button id="panel-close" class="text-gray-400 hover:text-gray-600 rounded-full p-1.5 hover:bg-gray-100">'
              + '<i data-lucide="x" style="width: 18px; height: 18px"></i>'
              + "</button></div>"
              + (isImageItem(panelFile)
                ? '<div class="w-full aspect-[16/9] bg-slate-200 overflow-hidden">'
                  + (previewUrl
                    ? '<img src="'
                      + escapeHtml(previewUrl)
                      + '" alt="'
                      + escapeHtml(panelFile.name)
                      + '" class="w-full h-full object-cover" loading="lazy" />'
                    : '<div class="w-full h-full flex items-center justify-center text-gray-400"><i data-lucide="image" style="width: 28px; height: 28px"></i></div>')
                  + "</div>"
                : "")
              + '<div class="p-5 space-y-4 flex-1 min-h-0 overflow-y-auto">'
              + (!isImageItem(panelFile)
                ? '<div class="flex items-center gap-3"><div class="w-14 h-14 bg-gray-50 rounded-xl flex items-center justify-center shadow-inner">'
                  + renderIcon(panelFile.name, panelFile.type, 30)
                  + '</div><div class="min-w-0"><h3 class="text-base font-bold text-slate-800 break-all">'
                  + escapeHtml(panelFile.name)
                  + '</h3><p class="text-xs text-gray-500 mt-1 uppercase">'
                  + escapeHtml(panelFile.type === "file" ? "FILE" : String(panelFile.type).toUpperCase())
                  + "</p></div></div>"
                : '<div><h3 class="text-base font-bold text-slate-800 break-all">'
                  + escapeHtml(panelFile.name)
                  + '</h3><p class="text-xs text-gray-500 mt-1 uppercase">'
                  + escapeHtml(panelFile.type === "file" ? "FILE" : String(panelFile.type).toUpperCase())
                  + "</p></div>")
              + '<div class="space-y-3 pt-1">'
              + '<div class="flex items-start gap-3"><div class="mt-0.5 text-gray-400"><i data-lucide="hard-drive" style="width: 16px; height: 16px"></i></div><div><p class="text-xs font-medium text-gray-500">大小</p><p class="text-sm text-slate-700 font-medium">'
              + escapeHtml(panelFile.size)
              + "</p></div></div>"
              + '<div class="flex items-start gap-3"><div class="mt-0.5 text-gray-400"><i data-lucide="clock" style="width: 16px; height: 16px"></i></div><div><p class="text-xs font-medium text-gray-500">修改时间</p><p class="text-sm text-slate-700 font-medium">'
              + escapeHtml(panelFile.date)
              + "</p></div></div>"
              + '<div class="flex items-start gap-3"><div class="mt-0.5 text-gray-400"><i data-lucide="folder" style="width: 16px; height: 16px"></i></div><div><p class="text-xs font-medium text-gray-500">位置</p><p class="text-sm text-slate-700 font-medium">'
              + escapeHtml(state.currentPath[state.currentPath.length - 1].name)
              + "</p></div></div>"
              + "</div></div>"
              + '<div class="p-4 border-t border-gray-100 bg-white/95 backdrop-blur">'
              + renderPanelActions(panelFile, true)
              + "</div></div>";
          } else {
            panelEl.className = "absolute right-0 top-0 bottom-0 w-80 bg-white border-l border-gray-200 shadow-2xl z-30 flex flex-col transform transition-transform duration-300 ease-in-out " + (state.isPanelOpen ? "translate-x-0" : "translate-x-full");

            panelEl.innerHTML = '<div class="p-4 border-b border-gray-100 flex items-center justify-between">'
              + '<span class="font-semibold text-slate-700">详细信息</span>'
              + '<button id="panel-close" class="text-gray-400 hover:text-gray-600 rounded-full p-1 hover:bg-gray-100">'
              + '<i data-lucide="x" style="width: 18px; height: 18px"></i>'
              + "</button></div>"
              + '<div class="p-6 flex flex-col items-center border-b border-gray-100">'
              + '<div class="w-24 h-24 bg-gray-50 rounded-2xl flex items-center justify-center mb-4 shadow-inner">'
              + renderIcon(panelFile.name, panelFile.type, 48)
              + "</div>"
              + '<h3 class="text-lg font-bold text-slate-800 text-center break-all">'
              + escapeHtml(panelFile.name)
              + "</h3>"
              + '<p class="text-sm text-gray-500 mt-1 uppercase">'
              + escapeHtml(panelFile.type === "file" ? "FILE" : String(panelFile.type).toUpperCase())
              + "</p></div>"
              + '<div class="p-6 space-y-6 flex-1 min-h-0 overflow-y-auto">'
              + '<div class="space-y-4">'
              + '<div class="flex items-start gap-3"><div class="mt-0.5 text-gray-400"><i data-lucide="hard-drive" style="width: 16px; height: 16px"></i></div><div><p class="text-xs font-medium text-gray-500">大小</p><p class="text-sm text-slate-700 font-medium">'
              + escapeHtml(panelFile.size)
              + "</p></div></div>"
              + '<div class="flex items-start gap-3"><div class="mt-0.5 text-gray-400"><i data-lucide="clock" style="width: 16px; height: 16px"></i></div><div><p class="text-xs font-medium text-gray-500">修改时间</p><p class="text-sm text-slate-700 font-medium">'
              + escapeHtml(panelFile.date)
              + "</p></div></div>"
              + '<div class="flex items-start gap-3"><div class="mt-0.5 text-gray-400"><i data-lucide="folder" style="width: 16px; height: 16px"></i></div><div><p class="text-xs font-medium text-gray-500">位置</p><p class="text-sm text-slate-700 font-medium">'
              + escapeHtml(state.currentPath[state.currentPath.length - 1].name)
              + "</p></div></div>"
              + "</div>"
              + (isImageItem(panelFile)
                ? '<div class="bg-gray-50 rounded-lg p-3"><p class="text-xs font-semibold text-gray-400 mb-2">预览</p><div class="w-full max-h-72 overflow-auto bg-gray-200 rounded flex items-center justify-center">'
                  + (getInlinePreviewUrl(panelFile)
                    ? '<img src="'
                      + escapeHtml(getInlinePreviewUrl(panelFile) || "")
                      + '" alt="'
                      + escapeHtml(panelFile.name)
                      + '" class="max-w-full max-h-72 object-contain" loading="lazy" />'
                    : '<i data-lucide="image" style="width: 24px; height: 24px"></i>')
                  + "</div></div>"
                : "")
              + "</div>"
              + '<div class="p-4 border-t border-gray-100 bg-gray-50">'
              + renderPanelActions(panelFile, false)
              + "</div>";
          }

          const closeButton = document.getElementById("panel-close");
          if (closeButton) {
            closeButton.addEventListener("click", function (event) {
              event.preventDefault();
              event.stopPropagation();
              suppressInteraction(PANEL_ANIMATION_MS + 520);
              setSelectedFile(null);
            });
          }

          const backdrop = document.getElementById("panel-backdrop");
          if (backdrop) {
            backdrop.addEventListener("click", function (event) {
              event.preventDefault();
              event.stopPropagation();
              suppressInteraction(PANEL_ANIMATION_MS + 520);
              setSelectedFile(null);
            });
          }

          const modalCard = document.getElementById("panel-modal-card");
          if (modalCard) {
            modalCard.addEventListener("click", function (event) {
              event.stopPropagation();
            });
          }

          if (mobileLayout && state.isPanelOpen) {
            requestAnimationFrame(function () {
              applyMobilePanelOpenState(true);
            });
          }

          const panelPreviewButton = document.getElementById("panel-preview");
          if (panelPreviewButton) {
            panelPreviewButton.addEventListener("click", function () {
              if (!state.panelFile || state.panelFile.type === "folder") {
                return;
              }
              openPreviewOrRaw(state.panelFile);
            });
          }

          const panelDownloadButton = document.getElementById("panel-download");
          if (panelDownloadButton) {
            panelDownloadButton.addEventListener("click", function () {
              if (!state.panelFile || state.panelFile.type === "folder") {
                return;
              }
              openItemAction(state.panelFile, "download");
            });
          }

          const panelFolderDownloadButton = document.getElementById("panel-folder-download");
          if (panelFolderDownloadButton) {
            panelFolderDownloadButton.addEventListener("click", function () {
              if (!state.panelFile || state.panelFile.type !== "folder") {
                return;
              }
              openItemAction(state.panelFile, "folder-zip");
            });
          }

          if (window.lucide && window.lucide.createIcons) {
            window.lucide.createIcons();
          }
        }

        if (breadcrumbEl) {
          breadcrumbEl.addEventListener("click", function (event) {
            const target = closestFromEventTarget(event.target, "[data-breadcrumb-index]");
            if (!target) {
              return;
            }
            const index = Number.parseInt(target.getAttribute("data-breadcrumb-index") || "", 10);
            if (!Number.isFinite(index) || index < 0) {
              return;
            }
            onBreadcrumbClick(index);
          });
        }

        if (mobileBreadcrumbEl) {
          mobileBreadcrumbEl.addEventListener("click", function (event) {
            const target = closestFromEventTarget(event.target, "[data-breadcrumb-index]");
            if (!target) {
              return;
            }
            const index = Number.parseInt(target.getAttribute("data-breadcrumb-index") || "", 10);
            if (!Number.isFinite(index) || index < 0) {
              return;
            }
            onBreadcrumbClick(index);
          });
        }

        if (searchInputEl) {
          searchInputEl.addEventListener("input", function () {
            state.searchQuery = searchInputEl.value || "";
            setSelectedFile(null);
            renderFileArea();
          });
        }

        if (viewGridEl) {
          viewGridEl.addEventListener("click", function () {
            state.viewMode = "grid";
            viewGridEl.className = "p-1.5 rounded-md transition-all bg-white shadow-sm text-blue-600";
            if (viewListEl) {
              viewListEl.className = "p-1.5 rounded-md transition-all text-gray-500 hover:text-gray-700";
            }
            renderFileArea();
          });
        }

        if (viewListEl) {
          viewListEl.addEventListener("click", function () {
            state.viewMode = "list";
            viewListEl.className = "p-1.5 rounded-md transition-all bg-white shadow-sm text-blue-600";
            if (viewGridEl) {
              viewGridEl.className = "p-1.5 rounded-md transition-all text-gray-500 hover:text-gray-700";
            }
            renderFileArea();
          });
        }

        if (fileAreaEl) {
          fileAreaEl.addEventListener("click", function (event) {
            if (shouldSuppressClick()) {
              event.preventDefault();
              event.stopPropagation();
              return;
            }
            const downloadButton = closestFromEventTarget(event.target, "[data-download-id]");
            if (downloadButton) {
              event.stopPropagation();
              const fileId = String(downloadButton.getAttribute("data-download-id") || "");
              const file = data.byId.get(fileId);
              if (file) {
                openItemAction(file, file.type === "folder" ? "folder-zip" : "download");
              }
              return;
            }

            const itemEl = closestFromEventTarget(event.target, "[data-item-id]");
            if (itemEl) {
              event.stopPropagation();
              const fileId = String(itemEl.getAttribute("data-item-id") || "");
              const file = data.byId.get(fileId);
              if (file) {
                if (event.detail >= 2) {
                  onItemDoubleClick(file);
                  return;
                }
                setSelectedFile(fileId);
              }
              return;
            }

            setSelectedFile(null);
          });
        }

        const suppressGlobalEvent = function (event) {
          if (!shouldSuppressClick()) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
        };
        document.addEventListener("pointerdown", suppressGlobalEvent, true);
        document.addEventListener("pointerup", suppressGlobalEvent, true);
        document.addEventListener("touchend", suppressGlobalEvent, true);
        document.addEventListener("click", suppressGlobalEvent, true);

        window.addEventListener("resize", function () {
          if (state.panelFile) {
            renderPanel();
          }
        });

        renderBreadcrumb();
        renderFileArea();
        renderPanel();
      })();
    </script>
  </body>
</html>`;
}
