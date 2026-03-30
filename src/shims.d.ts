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
