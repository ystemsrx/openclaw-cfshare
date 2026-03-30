<h1 align="center">☁️ CFShare</h1>

<p align="center">
通过 Cloudflare 隧道安全地将本地文件与服务分享到公网
</p>

<p align="center">
  <img src="https://img.shields.io/badge/平台-macOS_|_Linux_|_Windows_(WSL2)-9cf?style=flat-square" alt="平台">
  <img src="https://img.shields.io/badge/Node-≥22-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node">
  <img src="https://img.shields.io/badge/许可-MIT-97CA00?style=flat-square" alt="MIT">
</p>

<p align="center">
  <strong>简体中文</strong>
  &nbsp;|&nbsp;
  <a href="./README.md">English</a>
</p>

---

## 📖 这是什么？

**CFShare** 是一个 Node.js 命令行工具，让你能够：

- 🔗 **一键将本地端口**暴露为临时公网 HTTPS 链接（`https://*.trycloudflare.com`）
- 📁 **分享文件/目录**——自动起本地静态服务器 + 隧道，对方打开链接即可浏览/下载/预览（支持加密）
- 🔒 **内置安全策略**——Token/Basic 认证、速率限制、端口黑名单、排除规则
- ⏱️ **自动过期清理**——TTL 到期自动关闭隧道并删除临时文件

> [!NOTE]
> **无需 Cloudflare 账号**。CFShare 使用的是 [Cloudflare Quick Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/)（`trycloudflare.com`），完全免费、即开即用。

---

## 🏗️ 工作原理

```mermaid
flowchart LR
    subgraph LOCAL["你的电脑"]
        A["本地服务 / 文件"]
        B["[可选] 反向代理<br/>(认证 + 限流)"]
        C["cloudflared tunnel"]

        A --> B
        B --> C
    end

    C ==>|Cloudflare Quick Tunnel| D["https://xxx.trycloudflare.com"]
    E["对方浏览器"] --> D
```

CFShare 在内部完成：路径校验 → 文件复制到临时目录 → 启动只读静态服务器 → 挂载认证/限流反代 → 开启 `cloudflared` 隧道 → 设置过期回收。你只需告诉它"我要分享什么"，它会帮你完成剩下的工作。

---

## 🚀 安装步骤

### 第一步：安装 `cloudflared`

CFShare 依赖 Cloudflare 的 `cloudflared` 命令行工具来创建隧道。

<details>
<summary><b>🍎 macOS</b></summary>

```bash
brew install cloudflare/cloudflare/cloudflared
```

</details>

<details>
<summary><b>🐧 Linux（Debian / Ubuntu）</b></summary>

```bash
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt-get update && sudo apt-get install cloudflared
```

</details>

<details>
<summary><b>🪟 Windows（WSL2 内操作）</b></summary>

```bash
# 在 WSL2 中：
curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared
```

或在 Windows 原生 PowerShell / CMD 中使用 winget：

```powershell
winget install --id Cloudflare.cloudflared
```

</details>

安装后验证：

```bash
cloudflared --version
# 输出类似: cloudflared version 2025.x.x
```

> [!IMPORTANT]
> 只需安装 `cloudflared`，**不需要**运行 `cloudflared tunnel login`。Quick Tunnel 无需账号认证。

---

### 第二步：安装 CFShare

```bash
npm install -g @ystemsrx/cfshare
```

验证安装：

```bash
cfshare --version
cfshare env_check
```

---

## 🖥️ 使用方法

```bash
cfshare <命令> [参数JSON] [选项]
```

### 常用示例

```bash
# 检查环境与策略
cfshare env_check

# 暴露已有本地服务
cfshare expose_port '{"port":3000,"opts":{"access":"token"}}'

# 分享文件/目录
cfshare expose_files '{"paths":["./dist"],"opts":{"access":"none"}}'

# 列出活跃的分享
cfshare exposure_list

# 停止分享
cfshare exposure_stop '{"id":"all"}'
```

`expose_port` 与 `expose_files` 默认会打印结果并退出。
如果你需要以前台方式保持生命周期管理（`Ctrl+C` 停止），可加 `--keep-alive`。

### 选项

| 选项                   | 说明                               |
| :--------------------- | :--------------------------------- |
| `--params <json>`      | 以 JSON 传递命令参数               |
| `--params-file <path>` | 从 JSON 文件读取命令参数           |
| `--config <json>`      | 运行时配置 JSON                    |
| `--config-file <path>` | 从 JSON 文件读取运行时配置         |
| `--workspace-dir <dir>`| `expose_files` 的工作目录上下文    |
| `--keep-alive`         | `expose_*` 后保持前台运行          |
| `--no-keep-alive`      | 输出结果后退出（默认）             |
| `--compact`            | 紧凑 JSON 输出                     |
| `-h, --help`           | 显示帮助                           |
| `-v, --version`        | 显示版本                           |

---

## ⚙️ 配置（可选）

CFShare 开箱即用，以下默认配置适合绝大多数场景。如需调整，通过 `--config` 或 `--config-file` 传入：

```bash
cfshare expose_port '{"port":3000}' --config '{"defaultTtlSeconds":7200}'
```

或创建配置文件（如 `~/.cfshare/config.json`）：

```json
{
  "cloudflaredPath": "cloudflared",
  "defaultTtlSeconds": 3600,
  "defaultExposePortAccess": "token"
}
```

```bash
cfshare expose_port '{"port":3000}' --config-file ~/.cfshare/config.json
```

### 可配置项速查

| 配置项                     | 默认值              | 说明                           |
| :------------------------- | :------------------ | :----------------------------- |
| `cloudflaredPath`          | `"cloudflared"`     | `cloudflared` 的路径或名称     |
| `stateDir`                 | `~/.cfshare`        | 状态文件存储目录               |
| `defaultTtlSeconds`        | `3600`（1 小时）    | 默认隧道存活时间               |
| `maxTtlSeconds`            | `86400`（24 小时）  | 最大 TTL 上限                  |
| `defaultExposePortAccess`  | `"token"`           | 端口暴露默认认证模式           |
| `defaultExposeFilesAccess` | `"none"`            | 文件分享默认认证模式           |
| `blockedPorts`             | `[22, 2375, 2376]`  | 禁止暴露的端口（SSH / Docker） |
| `rateLimit.enabled`        | `true`              | 是否启用速率限制               |
| `rateLimit.maxRequests`    | `240`               | 每窗口期最大请求数             |
| `rateLimit.windowMs`       | `60000`（1 分钟）   | 速率限制窗口（毫秒）           |

> [!TIP]
> **认证模式说明：**
>
> - `"token"` — 访问链接需要带 Token（适合暴露端口）
> - `"basic"` — HTTP Basic 认证（用户名/密码）
> - `"none"` — 无认证，任何人都可访问（适合临时分享文件）

---

## 🧰 命令一览

| 命令            | 作用                                  |
| :-------------- | :------------------------------------ |
| `env_check`     | 检查 `cloudflared` 是否可用及当前策略 |
| `expose_port`   | 暴露本地端口到公网                    |
| `expose_files`  | 分享文件/目录（自动起静态服务器）     |
| `exposure_list` | 列出所有活跃会话                      |
| `exposure_get`  | 获取指定会话详情                      |
| `exposure_stop` | 停止并清理指定/全部会话               |
| `exposure_logs` | 查看会话日志                          |
| `maintenance`   | TTL 守护 / 垃圾回收 / 策略更新        |
| `audit_query`   | 查询审计日志                          |
| `audit_export`  | 导出审计日志到文件                    |

---

## 🔐 安全设计

<table>
<tr><td>🛡️</td><td><b>默认安全</b></td><td>端口暴露默认开启 Token 认证 + 反向代理保护</td></tr>
<tr><td>🚫</td><td><b>端口黑名单</b></td><td>SSH (22)、Docker Daemon (2375/2376) 默认禁止暴露</td></tr>
<tr><td>⏳</td><td><b>自动过期</b></td><td>会话到期自动关闭隧道并删除临时文件</td></tr>
<tr><td>📊</td><td><b>速率限制</b></td><td>Per-IP 滑动窗口限流（默认 240 次/分钟）</td></tr>
<tr><td>📝</td><td><b>审计日志</b></td><td>所有操作记录到本地 JSONL 文件</td></tr>
<tr><td>🙈</td><td><b>文件排除</b></td><td>自动排除 <code>.git/</code>、<code>.cfshare/</code>，并遵守 <code>.gitignore</code> 规则</td></tr>
</table>

---

## ❓ 常见问题

<details>
<summary><b>Q: 需要 Cloudflare 付费账号吗？</b></summary>

不需要。CFShare 使用 Cloudflare Quick Tunnel（`trycloudflare.com`），完全免费，无需注册账号。

</details>

<details>
<summary><b>Q: 链接有效期多长？</b></summary>

默认 1 小时，可通过配置或每次分享时指定（最长 7 天）。到期后自动销毁。

</details>

<details>
<summary><b>Q: cloudflared 提示找不到怎么办？</b></summary>

1. 确认 `cloudflared` 已安装：`cloudflared --version`
2. 如果安装位置不在 `PATH` 中，通过 `--config` 指定完整路径：

```bash
cfshare env_check --config '{"cloudflaredPath":"/usr/local/bin/cloudflared"}'
```

</details>

<details>
<summary><b>Q: 可以在 Windows 上直接用吗？</b></summary>

推荐在 Windows 上通过 WSL2 环境使用 CFShare。

</details>

---

## 📄 许可

MIT © [ystemsrx](https://github.com/ystemsrx)
