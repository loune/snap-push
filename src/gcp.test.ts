import fs from 'fs';
import { Storage } from '@google-cloud/storage';
import uploadFileFactory from './gcp.js';

const testBucketName = 'snap-push-test';

jest.setTimeout(20000);

test('gcp uploadFile', async () => {
  const testFile = 'jest.config.js';
  const testKeyName = '__s3.test';
  const options = { bucket: testBucketName };
  const uploadFile = uploadFileFactory(options);

  // act
  await uploadFile.upload({
    contentLength: fs.statSync(testFile).size,
    source: fs.createReadStream(testFile, { highWaterMark: 4 * 1024 * 1024 }),
    destFileName: testKeyName,
    contentType: 'text/plain',
    md5Hash: 'e16b86ba6de4a2aab341704ff3ba0072',
    metadata: { test: 'gcp' },
  });
  const list = await uploadFile.list(testKeyName, true);

  // assert
  const storage = new Storage();
  const [data] = await storage.bucket(testBucketName).file(testKeyName).download();
  const [metadata] = await storage.bucket(testBucketName).file(testKeyName).getMetadata();

  const fileStat = fs.statSync(testFile);
  expect(Number(metadata.size)).toBe(fileStat.size);
  expect(metadata.contentType).toBe('text/plain');
  expect(data.toString()).toBe(fs.readFileSync(testFile).toString());

  expect(list).toEqual([
    { name: testKeyName, md5: 'e16b86ba6de4a2aab341704ff3ba0072', size: fileStat.size, metadata: { test: 'gcp' } },
  ]);

  await uploadFile.delete(testKeyName);

  const listAfterDelete = await uploadFile.list(testKeyName, false);
  expect(listAfterDelete).toEqual([]);
});
