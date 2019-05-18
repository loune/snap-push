import { Storage } from '@google-cloud/storage';
import fs from 'fs';
import uploadFileFactory from './gcp';

const testBucketName = 'snap-push-test';

test('gcp uploadFile', async () => {
  const testFile = 'jest.config.js';
  const testKeyName = '__s3.test';
  const options = { bucket: testBucketName };
  const uploadFile = uploadFileFactory(options);

  // act
  await uploadFile(testFile, testKeyName, 'text/plain', null);

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

  await storage
    .bucket(testBucketName)
    .file(testKeyName)
    .delete();
});
