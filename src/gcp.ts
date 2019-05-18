import { Storage } from '@google-cloud/storage';
import { UploadFileProvider } from './types';

export default function uploadFileFactory(providerOptions): UploadFileProvider {
  const { bucket, makePublic, ...otherProviderOptions } = providerOptions;

  if (!bucket) {
    throw new Error('bucket is required for providerOptions');
  }

  const storage = new Storage(otherProviderOptions);

  return async (
    srcFileName: string,
    destFileName: string,
    contentType: string,
    metadata: { [key: string]: string }
  ) => {
    await storage.bucket(bucket).upload(srcFileName, {
      destination: destFileName,
      // gzip: true,
      contentType,
      public: makePublic,
      metadata: {
        ...metadata,
        // cacheControl: 'public, max-age=31536000',
      },
    });
  };
}
