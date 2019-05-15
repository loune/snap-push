import { SharedKeyCredential, StorageURL, ServiceURL, ContainerURL, Aborter, BlobURL } from '@azure/storage-blob';
import fs from 'fs';
import uploadFileFactory from './azure';

test('azure uploadFile', async () => {
  const testFile = 'jest.config.js';
  const testKeyName = '__s3.test';
  // test with azurite
  const accountName = 'devstoreaccount1';
  const options = {
    credential: new SharedKeyCredential(
      accountName,
      'Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw=='
    ),
    serviceUrl: `http://127.0.0.1:10000/${accountName}`,
    containerName: `newcontainer${new Date().getTime()}`,
  };

  // Create a container
  const pipeline = StorageURL.newPipeline(options.credential);

  const serviceURL = new ServiceURL(options.serviceUrl, pipeline);
  const containerURL = ContainerURL.fromServiceURL(serviceURL, options.containerName);

  const createContainerResponse = await containerURL.create(Aborter.none);

  const uploadFile = uploadFileFactory(options);

  // act
  await uploadFile(testFile, testKeyName, 'text/plain', null);

  const blobURL = BlobURL.fromContainerURL(containerURL, testKeyName);
  const downloadBlockBlobResponse = await blobURL.download(Aborter.none, 0);

  const fileStat = fs.statSync(testFile);
  expect(downloadBlockBlobResponse.contentLength).toBe(fileStat.size);
  expect(downloadBlockBlobResponse.contentType).toBe('text/plain');

  // await s3.deleteObject({ Key: testKeyName, Bucket: testBucketName }).promise();
});
