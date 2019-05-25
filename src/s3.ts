import AWS from 'aws-sdk';
import { Readable } from 'stream';
import { UploadFileProvider, UploadFile } from './types';

const isEmpty = obj => Object.keys(obj).length === 0 && obj.constructor === Object;

export default function uploadFileFactory(providerOptions): UploadFileProvider {
  const { bucket, makePublic, ...otherProviderOptions } = providerOptions;
  const myS3 = !isEmpty(otherProviderOptions) ? new AWS.S3(otherProviderOptions) : new AWS.S3();

  if (!bucket) {
    throw new Error('bucket is required for providerOptions');
  }

  return {
    upload: async ({ source, destFileName, contentType, md5Hash, metadata, cacheControl }) => {
      // Upload the stream
      return new Promise(
        (resolve, reject): void => {
          myS3.upload(
            {
              Body: source,
              Bucket: bucket,
              Key: destFileName,
              ContentType: contentType,
              Metadata: metadata,
              ACL: makePublic ? 'public-read' : undefined,
              ContentMD5: Buffer.from(md5Hash, 'hex').toString('base64'),
              CacheControl: cacheControl,
            },
            (err): void => {
              if (err) {
                reject(err);
                return;
              }
              resolve();
            }
          );
        }
      );
    },
    list: async (prefix: string) => {
      const results: UploadFile[] = [];
      let s3result: AWS.S3.ListObjectsV2Output;
      do {
        const lastToken = s3result ? s3result.NextContinuationToken : undefined;
        // eslint-disable-next-line no-await-in-loop
        s3result = await myS3.listObjectsV2({ Bucket: bucket, Prefix: prefix, ContinuationToken: lastToken }).promise();
        s3result.Contents.map(x => ({ name: x.Key, md5: x.ETag.replace(/"/g, ''), size: x.Size })).forEach(x =>
          results.push(x)
        );
      } while (s3result.IsTruncated);
      return results;
    },
  };
}
