import fs from 'fs';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import uploadFileFactory from './s3.js';

jest.setTimeout(10000);

const testBucketName = process.env.S3_TEST_BUCKET;

if (!testBucketName) {
  throw new Error('S3_TEST_BUCKET env is missing');
}

test('s3 uploadFile', async () => {
  const testFile = 'jest.config.js';
  const hash = 'e16b86ba6de4a2aab341704ff3ba0072';
  const testKeyName = '__s3.test';
  const options = { bucket: testBucketName };
  const uploadFile = uploadFileFactory(options);

  // act
  await uploadFile.upload({
    contentLength: fs.statSync(testFile).size,
    source: fs.createReadStream(testFile),
    destFileName: testKeyName,
    contentType: 'text/plain',
    md5Hash: hash,
    metadata: { test: 's3' },
  });
  const list = await uploadFile.list(testKeyName, true);

  // assert
  const s3 = new S3Client({});
  const data = await s3.send(new GetObjectCommand({ Bucket: testBucketName, Key: testKeyName }));

  const fileStat = fs.statSync(testFile);
  expect(data.ContentLength).toBe(fileStat.size);
  expect(data.ContentType).toBe('text/plain');
  expect(await data.Body?.transformToString()).toBe(fs.readFileSync(testFile).toString());

  expect(list).toEqual([{ name: testKeyName, md5: hash, size: fileStat.size, metadata: { test: 's3' } }]);

  await uploadFile.delete(testKeyName);
  const listAfterDelete = await uploadFile.list(testKeyName, false);
  expect(listAfterDelete).toEqual([]);
});
