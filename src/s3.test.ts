import AWS from 'aws-sdk';
import fs from 'fs';
import uploadFileFactory from './s3';

const testBucketName = 'pouch-test';

test('s3 uploadFile', async () => {
  const testFile = 'jest.config.js';
  const hash = '0f0d514cf6a4dbf1f5d74b7152f440d1';
  const testKeyName = '__s3.test';
  const options = { bucket: testBucketName };
  const uploadFile = uploadFileFactory(options);

  // act
  await uploadFile.upload({
    source: fs.createReadStream(testFile),
    destFileName: testKeyName,
    contentType: 'text/plain',
    md5Hash: hash,
  });
  const list = await uploadFile.list(testKeyName);

  // assert
  const s3 = new AWS.S3();
  const data = await s3.getObject({ Bucket: testBucketName, Key: testKeyName }).promise();

  const fileStat = fs.statSync(testFile);
  expect(data.ContentLength).toBe(fileStat.size);
  expect(data.ContentType).toBe('text/plain');
  expect(data.Body.toString()).toBe(fs.readFileSync(testFile).toString());

  expect(list).toEqual([{ name: testKeyName, md5: hash, size: fileStat.size }]);

  await uploadFile.delete(testKeyName);
  const listAfterDelete = await uploadFile.list(testKeyName);
  expect(listAfterDelete).toEqual([]);
});
