import { UploadFileProvider, AbstractLogger } from './types';

export interface DryRunOptions {
  realProvider: UploadFileProvider;
  logger: AbstractLogger;
}

/** A provider that doesn't delete or upload, only lists the contents of with the real provider */
export default function uploadFileFactory(providerOptions: DryRunOptions): UploadFileProvider {
  const { realProvider, logger } = providerOptions;

  return {
    upload: async ({ destFileName, contentType }) => {
      logger.info(`Pretend upload: ${destFileName} (${contentType})`);
    },
    list: async (prefix: string, includeMetadata: boolean) => {
      return realProvider.list(prefix, includeMetadata);
    },
    delete: async (key: string) => {
      logger.info(`Pretend delete: ${key}`);
    },
  };
}
