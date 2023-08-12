import { Storage, StorageOptions } from '@google-cloud/storage';
import { UploadFileProvider } from './types';

export interface GcpProviderOptions extends StorageOptions {
  bucket: string;
}

export default function uploadFileFactory(providerOptions: GcpProviderOptions): UploadFileProvider {
  const { bucket, ...otherProviderOptions } = providerOptions;

  if (!bucket) {
    throw new Error('bucket is required for providerOptions');
  }

  const storage = new Storage(otherProviderOptions);
  const storageBucket = storage.bucket(bucket);

  return {
    upload: ({ source, destFileName, contentType, metadata, cacheControl, contentEncoding, makePublic }) => {
      return new Promise((resolve, reject) => {
        const writeStream = storageBucket.file(destFileName).createWriteStream({
          // gzip: true,
          contentType,
          public: makePublic,
          metadata: {
            metadata,
            cacheControl,
            contentEncoding,
          },
        });
        writeStream.on('error', (err) => {
          reject(err);
        });
        writeStream.on('finish', () => {
          resolve();
        });
        source.pipe(writeStream, { end: true });
      });
    },
    list: async (prefix: string, includeMetadata: boolean) => {
      const [files] = await storageBucket.getFiles({ prefix, autoPaginate: true });
      return files.map((f) => ({
        name: f.name,
        md5: f.metadata.md5Hash ? Buffer.from(f.metadata.md5Hash, 'base64').toString('hex') : undefined,
        size: Number(f.metadata.size),
        metadata: includeMetadata ? f.metadata.metadata ?? {} : {},
      }));
    },
    delete: async (key: string) => {
      await storageBucket.file(key).delete();
    },
  };
}
