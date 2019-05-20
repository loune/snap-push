import { Storage } from '@google-cloud/storage';
import fs from 'fs';
import uploadFileFactory from './gcp';

const testBucketName = 'snap-push-test';

jest.setTimeout(10000);

test('gcp uploadFile', async () => {
  const testFile = 'jest.config.js';
  const testKeyName = '__s3.test';
  const options = { bucket: testBucketName };
  const uploadFile = uploadFileFactory(options);

  // act
  await uploadFile.upload(
    fs.createReadStream(testFile, { highWaterMark: 4 * 1024 * 1024 }),
    testKeyName,
    'text/plain',
    '0f0d514cf6a4dbf1f5d74b7152f440d1',
    null
  );
  const list = await uploadFile.list(testKeyName);

  // assert
  const storage = new Storage();
  const [data] = await storage
    .bucket(testBucketName)
    .file(testKeyName)
    .download();
  const [metadata] = await storage
    .bucket(testBucketName)
    .file(testKeyName)
    .getMetadata();

  const fileStat = fs.statSync(testFile);
  expect(Number(metadata.size)).toBe(fileStat.size);
  expect(metadata.contentType).toBe('text/plain');
  expect(data.toString()).toBe(fs.readFileSync(testFile).toString());

  expect(list).toEqual([{ name: testKeyName, md5: '0f0d514cf6a4dbf1f5d74b7152f440d1', size: fileStat.size }]);

  await storage
    .bucket(testBucketName)
    .file(testKeyName)
    .delete();
});
