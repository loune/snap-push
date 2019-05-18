import AWS from 'aws-sdk';
import fs from 'fs';
import uploadFileFactory from './s3';

const testBucketName = 'pouch-test';

test('s3 uploadFile', async () => {
  const testFile = 'jest.config.js';
  const testKeyName = '__s3.test';
  const options = { bucket: testBucketName };
  const uploadFile = uploadFileFactory(options);

  // act
  await uploadFile(fs.createReadStream(testFile), testKeyName, 'text/plain', null);

  // assert
  const s3 = new AWS.S3();
  const data = await s3.getObject({ Bucket: testBucketName, Key: testKeyName }).promise();

  const fileStat = fs.statSync(testFile);
  expect(data.ContentLength).toBe(fileStat.size);
  expect(data.ContentType).toBe('text/plain');
  expect(data.Body.toString()).toBe(fs.readFileSync(testFile).toString());

  await s3.deleteObject({ Key: testKeyName, Bucket: testBucketName }).promise();
});
