declare module "openclaw/plugin-sdk" {
  import type { TSchema } from "@sinclair/typebox";

  export type OpenClawToolContext = {
    workspaceDir?: string;
  };

  export type OpenClawToolDefinition = {
    name: string;
    label: string;
    description: string;
    parameters?: TSchema | Record<string, unknown>;
    execute: (...args: any[]) => unknown | Promise<unknown>;
  };

  export type OpenClawPluginApi = {
    logger: {
      info: (...args: unknown[]) => void;
      warn: (...args: unknown[]) => void;
      error: (...args: unknown[]) => void;
      debug: (...args: unknown[]) => void;
    };
    resolvePath: (input: string) => string;
    pluginConfig?: Record<string, unknown>;
    registerTool: (
      factory:
        | ((ctx: OpenClawToolContext) => OpenClawToolDefinition[])
        | ((ctx: OpenClawToolContext) => Promise<OpenClawToolDefinition[]>),
      options?: {
        names?: string[];
      },
    ) => void;
  };

  export function emptyPluginConfigSchema(): Record<string, unknown>;
  export function jsonResult<T>(value: T): T;
  export function stringEnum<const T extends readonly string[]>(
    values: T,
    options?: Record<string, unknown>,
  ): TSchema;
}

declare module "yazl" {
  class ZipFile {
    outputStream: NodeJS.ReadableStream;
    addFile(realPath: string, metadataPath: string, options?: Record<string, unknown>): void;
    end(options?: Record<string, unknown>, callback?: () => void): void;
  }

  const yazl: {
    ZipFile: typeof ZipFile;
  };

  export default yazl;
}
