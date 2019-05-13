import AWS from 'aws-sdk';
import fg from 'fast-glob';
import push, { pathTrimStart } from './push';

const testBucketName = 'pouch-test';

test('push with s3', async () => {
  const prefix = '__test3/';
  const providerOptions = { bucket: testBucketName };
  const pat = ['./src/**/*'];
  const filesFromPat = (await fg(pat)) as string[];

  const result = await push({ files: pat, provider: 'aws', destPathPrefix: prefix, providerOptions });
  expect(result.uploadedFiles.sort()).toEqual(filesFromPat.map(pathTrimStart).sort());
  expect(result.uploadedKeys.sort()).toEqual(filesFromPat.map(x => `${prefix}${pathTrimStart(x)}`).sort());
  expect(result.elasped).toBeGreaterThan(0);

  const s3 = new AWS.S3();
  const s3result = await s3.listObjectsV2({ Bucket: testBucketName, Prefix: prefix }).promise();
  expect(s3result.Contents.map(x => x.Key).sort()).toEqual(
    filesFromPat.map(x => `${prefix}${pathTrimStart(x)}`).sort()
  );
  expect(s3result.Contents.map(x => x.Key).sort()).toEqual(result.uploadedKeys.sort());

  // cleanup
  await Promise.all(result.uploadedKeys.map(key => s3.deleteObject({ Bucket: testBucketName, Key: key }).promise()));
});
