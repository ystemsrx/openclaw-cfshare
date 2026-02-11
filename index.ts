import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { registerCfshareTools } from "./src/tools.js";

const plugin = {
  id: "cfshare",
  name: "CFShare",
  description: "Cloudflare Quick Tunnel wrapper for secure temporary sharing",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    registerCfshareTools(api);
  },
};

export default plugin;
