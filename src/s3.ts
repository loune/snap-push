import {
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  ListObjectsV2CommandOutput,
  S3Client,
  S3ClientConfig,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import pLimit from 'p-limit';
import querystring from 'querystring';
import { UploadFileProvider, UploadFile } from './types';

const isEmpty = (obj: any) => Object.keys(obj).length === 0 && obj.constructor === Object;

export interface S3ProviderOptions extends S3ClientConfig {
  bucket: string;
  /** Default 3 */
  listMetaDataConcurrency?: number;
}

export default function uploadFileFactory(providerOptions: S3ProviderOptions): UploadFileProvider {
  const { bucket, listMetaDataConcurrency, ...otherProviderOptions } = providerOptions;
  const myS3 = !isEmpty(otherProviderOptions) ? new S3Client(otherProviderOptions) : new S3Client({});

  if (!bucket) {
    throw new Error('bucket is required for providerOptions');
  }

  return {
    upload: async ({
      source,
      destFileName,
      contentType,
      md5Hash,
      metadata,
      tags,
      cacheControl,
      contentEncoding,
      makePublic,
    }) => {
      // Upload the stream
      const s3upload = new Upload({
        client: myS3,
        params: {
          Body: source,
          Bucket: bucket,
          Key: destFileName,
          ContentType: contentType,
          Metadata: metadata,
          Tagging: tags ? querystring.stringify(tags) : undefined,
          ACL: makePublic ? 'public-read' : undefined,
          // ContentMD5: Buffer.from(md5Hash, 'hex').toString('base64'), // doesn't work for multipart uploads
          CacheControl: cacheControl,
          ContentEncoding: contentEncoding,
        },
      });

      await s3upload.done();
    },
    list: async (prefix: string, includeMetadata: boolean) => {
      const results: UploadFile[] = [];
      let s3result: ListObjectsV2CommandOutput | undefined;
      do {
        const lastToken = s3result ? s3result.NextContinuationToken : undefined;
        // eslint-disable-next-line no-await-in-loop
        s3result = await myS3.send(
          new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: lastToken })
        );
        if (!s3result.Contents) {
          break;
        }
        s3result.Contents.map((x) => ({
          name: x.Key || '',
          md5: x.ETag?.replace(/"/g, ''),
          size: x.Size || 0,
          metadata: {},
        })).forEach((x) => results.push(x));
      } while (s3result.IsTruncated);

      if (includeMetadata) {
        const limit = pLimit(listMetaDataConcurrency || 3);
        await Promise.all(
          results.map((x) =>
            limit(async () => {
              const response = await myS3.send(new HeadObjectCommand({ Bucket: bucket, Key: x.name }));
              x.metadata = response.Metadata || {};
            })
          )
        );
      }

      return results;
    },
    delete: async (key: string) => {
      await myS3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}
