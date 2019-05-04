import fs from 'fs';
import AWS from 'aws-sdk';
import { Readable } from 'stream';

const isEmpty = obj => Object.keys(obj).length === 0 && obj.constructor === Object;

export default function uploadFileFactory(providerOptions) {
  const { bucket, makePublic, ...otherProviderOptions } = providerOptions;
  const myS3 = !isEmpty(otherProviderOptions) ? new AWS.S3(otherProviderOptions) : new AWS.S3();

  return async (srcFileName: string, destFileName: string, type: string, metadata: { [key: string]: string }) => {
    const body: Readable = fs.createReadStream(srcFileName);

    // Upload the stream
    return new Promise(
      (resolve, reject): void => {
        myS3.upload(
          {
            Body: body,
            Bucket: bucket,
            Key: destFileName,
            ContentType: type,
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
