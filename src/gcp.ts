import { Storage } from '@google-cloud/storage';
import { Readable } from 'stream';
import { UploadFileProvider } from './types';

export default function uploadFileFactory(providerOptions): UploadFileProvider {
  const { bucket, makePublic, ...otherProviderOptions } = providerOptions;

  if (!bucket) {
    throw new Error('bucket is required for providerOptions');
  }

  const storage = new Storage(otherProviderOptions);

  return (source: Readable, destFileName: string, contentType: string, metadata: { [key: string]: string }) => {
    return new Promise((resolve, reject) => {
      const writeStream = storage
        .bucket(bucket)
        .file(destFileName)
        .createWriteStream({
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
  };
}
