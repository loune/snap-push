import { Storage } from '@google-cloud/storage';
import { Readable } from 'stream';
import { UploadFileProvider } from './types';

export default function uploadFileFactory(providerOptions): UploadFileProvider {
  const { bucket, makePublic, ...otherProviderOptions } = providerOptions;

  if (!bucket) {
    throw new Error('bucket is required for providerOptions');
  }

  const storage = new Storage(otherProviderOptions);
  const storageBucket = storage.bucket(bucket);

  return {
    upload: (
      source: Readable,
      destFileName: string,
      contentType: string,
      md5: string,
      metadata: { [key: string]: string }
    ) => {
      return new Promise((resolve, reject) => {
        const writeStream = storageBucket.file(destFileName).createWriteStream({
          // gzip: true,
          contentType,
          public: makePublic,
          metadata: {
            ...metadata,
            // cacheControl: 'public, max-age=31536000',
          },
        });
        writeStream.on('error', err => {
          reject(err);
        });
        writeStream.on('finish', () => {
          resolve();
        });
        source.pipe(
          writeStream,
          { end: true }
        );
      });
    },
    list: async (prefix: string) => {
      const [files] = await storageBucket.getFiles({ prefix, autoPaginate: true });
      return files.map(f => ({
        name: f.name,
        md5: Buffer.from(f.metadata.md5Hash, 'base64').toString('hex'),
        size: Number(f.metadata.size),
      }));
    },
  };
}
