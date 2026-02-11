function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderMarkdownPreviewTemplate(params: { title: string; payload: string }): string {
  const title = escapeHtml(params.title);
  return `<!doctype html>
<html lang="zh">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <script src="https://cdn.jsdelivr.net/npm/markdown-it/dist/markdown-it.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/markdown-it-footnote/dist/markdown-it-footnote.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/markdown-it-task-lists/dist/markdown-it-task-lists.min.js"></script>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/prismjs/themes/prism.css" />
    <script src="https://cdn.jsdelivr.net/npm/prismjs/prism.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/prismjs/components/prism-core.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/prismjs/plugins/autoloader/prism-autoloader.min.js"></script>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css" />
    <script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/mermaid@10.6.1/dist/mermaid.min.js"></script>
    <style>
      :root { color-scheme: light; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background: #f7f7f8;
        color: #1f2937;
        font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      }
      .container {
        max-width: 960px;
        margin: 0 auto;
        padding: 20px 16px 40px;
      }
      .header {
        margin-bottom: 14px;
        color: #6b7280;
        font-size: 13px;
      }
      #preview {
        background: #ffffff;
        border: 1px solid #e5e7eb;
        border-radius: 10px;
        padding: 20px;
      }
      pre {
        margin: 0.9em 0;
        overflow: auto;
        font-size: 13px;
        background: #f5f5f5 !important;
        border-radius: 6px;
        padding: 0;
      }
      pre code {
        display: block;
        padding: 0.85em;
        font-family: "Consolas", "Fira Code", monospace;
      }
      code:not(pre > code) {
        background: #f2f4f7;
        border-radius: 4px;
        padding: 0.15em 0.4em;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th, td {
        border: 1px solid #ddd;
        padding: 8px;
      }
      blockquote {
        margin: 0.8em 0;
        border-left: 4px solid #d1d5db;
        padding: 0.3em 1em;
        color: #4b5563;
        background: #f9fafb;
      }
      .mermaid-container {
        border: 1px solid #ddd;
        border-radius: 6px;
        overflow: hidden;
        margin: 0.9em 0;
      }
      .mermaid-header {
        background: #f9fafb;
        border-bottom: 1px solid #ddd;
        padding: 7px 10px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 12px;
        color: #6b7280;
      }
      .mermaid-toggle {
        border: 0;
        background: #2563eb;
        color: #fff;
        border-radius: 4px;
        padding: 4px 8px;
        cursor: pointer;
      }
      .mermaid-content {
        background: #fff;
        padding: 10px;
      }
      .mermaid-code {
        display: none;
      }
      .error {
        color: #dc2626;
        font-size: 13px;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">cfshare preview: ${title}</div>
      <div id="preview"></div>
    </div>
    <script>
      Prism.plugins.autoloader.languages_path = "https://cdn.jsdelivr.net/npm/prismjs/components/";
      mermaid.initialize({ startOnLoad: false, theme: "default", securityLevel: "loose" });

      const markdownBase64 = "${params.payload}";
      const bytes = Uint8Array.from(atob(markdownBase64), function (char) { return char.charCodeAt(0); });
      const source = new TextDecoder("utf-8").decode(bytes);
      let mermaidSeq = 0;
      let md = window.markdownit({ html: true, linkify: true, typographer: true });
      if (window.markdownitFootnote) {
        md = md.use(window.markdownitFootnote);
      }
      if (window.markdownitTaskLists) {
        md = md.use(window.markdownitTaskLists, { enabled: true, label: true });
      }

      function processMermaidBlock(codeBlock) {
        const mermaidCode = codeBlock.textContent || "";
        const preElement = codeBlock.parentNode;

        const container = document.createElement("div");
        container.className = "mermaid-container";

        const header = document.createElement("div");
        header.className = "mermaid-header";
        const title = document.createElement("span");
        title.textContent = "Mermaid";
        const toggle = document.createElement("button");
        toggle.className = "mermaid-toggle";
        toggle.textContent = "查看代码";
        header.appendChild(title);
        header.appendChild(toggle);

        const content = document.createElement("div");
        content.className = "mermaid-content";
        const diagram = document.createElement("div");
        const codeView = document.createElement("div");
        codeView.className = "mermaid-code";
        const pre = document.createElement("pre");
        pre.innerHTML = "<code class=\\"language-mermaid\\"></code>";
        const codeEl = pre.querySelector("code");
        if (codeEl) codeEl.textContent = mermaidCode;
        codeView.appendChild(pre);
        content.appendChild(diagram);
        content.appendChild(codeView);

        container.appendChild(header);
        container.appendChild(content);
        if (preElement.parentNode) {
          preElement.parentNode.replaceChild(container, preElement);
        }

        mermaid.render("cfshare-mermaid-" + String(++mermaidSeq), mermaidCode).then(function (result) {
          diagram.innerHTML = result.svg;
        }).catch(function (error) {
          diagram.innerHTML = "<div class=\\"error\\">Mermaid 渲染失败: " + String(error && error.message ? error.message : error) + "</div>";
        });

        toggle.addEventListener("click", function () {
          const showingDiagram = diagram.style.display !== "none";
          if (showingDiagram) {
            diagram.style.display = "none";
            codeView.style.display = "block";
            toggle.textContent = "查看图表";
            if (codeEl) Prism.highlightElement(codeEl);
          } else {
            diagram.style.display = "block";
            codeView.style.display = "none";
            toggle.textContent = "查看代码";
          }
        });
      }

      function highlightAndRender(preview) {
        preview.querySelectorAll("pre code").forEach(function (block) {
          const match = (block.className || "").match(/language-([a-zA-Z0-9_-]+)/);
          const lang = match ? match[1].toLowerCase() : "";
          if (lang === "mermaid") {
            processMermaidBlock(block);
          } else if (lang) {
            Prism.highlightElement(block);
          }
        });
      }

      const preview = document.getElementById("preview");
      const backslash = String.fromCharCode(92);
      const latexBlockStart = backslash + "[";
      const latexBlockEnd = backslash + "]";
      const latexInlineStart = backslash + "(";
      const latexInlineEnd = backslash + ")";
      const protectedSource = source
        .replaceAll(latexBlockStart, "⟦LATEX_BLOCK_START⟧")
        .replaceAll(latexBlockEnd, "⟦LATEX_BLOCK_END⟧")
        .replaceAll(latexInlineStart, "⟦LATEX_INLINE_START⟧")
        .replaceAll(latexInlineEnd, "⟦LATEX_INLINE_END⟧");
      let rendered = md.render(protectedSource);
      rendered = rendered
        .replaceAll("⟦LATEX_BLOCK_START⟧", latexBlockStart)
        .replaceAll("⟦LATEX_BLOCK_END⟧", latexBlockEnd)
        .replaceAll("⟦LATEX_INLINE_START⟧", latexInlineStart)
        .replaceAll("⟦LATEX_INLINE_END⟧", latexInlineEnd);
      preview.innerHTML = rendered;
      highlightAndRender(preview);
      renderMathInElement(preview, {
        delimiters: [
          { left: "$$", right: "$$", display: true },
          { left: "\\\\[", right: "\\\\]", display: true },
          { left: "$", right: "$", display: false },
          { left: "\\\\(", right: "\\\\)", display: false }
        ]
      });
    </script>
  </body>
</html>`;
}
