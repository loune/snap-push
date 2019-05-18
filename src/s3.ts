import AWS from 'aws-sdk';
import { Readable } from 'stream';
import { UploadFileProvider } from './types';

const isEmpty = obj => Object.keys(obj).length === 0 && obj.constructor === Object;

export default function uploadFileFactory(providerOptions): UploadFileProvider {
  const { bucket, makePublic, ...otherProviderOptions } = providerOptions;
  const myS3 = !isEmpty(otherProviderOptions) ? new AWS.S3(otherProviderOptions) : new AWS.S3();

  if (!bucket) {
    throw new Error('bucket is required for providerOptions');
  }

  return async (source: Readable, destFileName: string, contentType: string, metadata: { [key: string]: string }) => {
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
          },
          (err): void => {
            if (err) {
              reject(err);
              return;
            }
            resolve();
            // console.log(`Uploaded the file ${data.Location}`);
          }
        );
      }
    );
  };
}
