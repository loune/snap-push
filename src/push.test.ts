import AWS from 'aws-sdk';
import { SharedKeyCredential, StorageURL, ServiceURL, ContainerURL, Aborter } from '@azure/storage-blob';
import fg from 'fast-glob';
import { BlobItem } from '@azure/storage-blob/typings/lib/generated/lib/models';
import { Storage } from '@google-cloud/storage';
import push, { pathTrimStart } from './push';
import s3FileProvider from './s3';
import azureFileProvider from './azure';
import gcpFileProvider from './gcp';

const s3TestBucketName = 'pouch-test';

jest.setTimeout(30000);

test('push with s3', async () => {
  const prefix = '__test3/';
  const providerOptions = { bucket: s3TestBucketName };
  const pat = ['./src/**/*'];
  const filesFromPat = (await fg(pat)) as string[];

  // act
  const result = await push({ files: pat, provider: s3FileProvider(providerOptions), destPathPrefix: prefix });

  // assert
  expect(result.uploadedFiles.sort()).toEqual(filesFromPat.map(pathTrimStart).sort());
  expect(result.uploadedKeys.sort()).toEqual(filesFromPat.map(x => `${prefix}${pathTrimStart(x)}`).sort());
  expect(result.elasped).toBeGreaterThan(0);

  const s3 = new AWS.S3();
  const s3result = await s3.listObjectsV2({ Bucket: s3TestBucketName, Prefix: prefix }).promise();
  expect(s3result.Contents.map(x => x.Key).sort()).toEqual(
    filesFromPat.map(x => `${prefix}${pathTrimStart(x)}`).sort()
  );
  expect(s3result.Contents.map(x => x.Key).sort()).toEqual(result.uploadedKeys.sort());

  // cleanup
  await Promise.all(result.uploadedKeys.map(key => s3.deleteObject({ Bucket: s3TestBucketName, Key: key }).promise()));
});

test('push with azure', async () => {
  const prefix = '__test3/';
  // test with azurite
  const accountName = 'devstoreaccount1';
  const providerOptions = {
    credential: new SharedKeyCredential(
      accountName,
      'Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw=='
    ),
    serviceUrl: `http://127.0.0.1:10000/${accountName}`,
    containerName: `newcontainer${new Date().getTime()}`,
  };
  const pat = ['./src/**/*'];
  const filesFromPat = (await fg(pat)) as string[];

  // Create a container
  const pipeline = StorageURL.newPipeline(providerOptions.credential);

  const serviceURL = new ServiceURL(providerOptions.serviceUrl, pipeline);
  const containerURL = ContainerURL.fromServiceURL(serviceURL, providerOptions.containerName);

  await containerURL.create(Aborter.none);

  // act
  const result = await push({ files: pat, provider: azureFileProvider(providerOptions), destPathPrefix: prefix });

  // assert
  expect(result.uploadedFiles.sort()).toEqual(filesFromPat.map(pathTrimStart).sort());
  expect(result.uploadedKeys.sort()).toEqual(filesFromPat.map(x => `${prefix}${pathTrimStart(x)}`).sort());
  expect(result.elasped).toBeGreaterThan(0);

  const blobs: BlobItem[] = [];
  let marker;
  do {
    // eslint-disable-next-line no-await-in-loop
    const listBlobsResponse = await containerURL.listBlobFlatSegment(Aborter.none, marker);

    marker = listBlobsResponse.nextMarker;
    for (const blob of listBlobsResponse.segment.blobItems) {
      blobs.push(blob);
    }
  } while (marker);

  expect(blobs.map(x => x.name).sort()).toEqual(filesFromPat.map(x => `${prefix}${pathTrimStart(x)}`).sort());
  expect(blobs.map(x => x.name).sort()).toEqual(result.uploadedKeys.sort());

  // cleanup
  await containerURL.delete(Aborter.none);
});

test('push with gcp', async () => {
  const gcpTestBucketName = 'snap-push-test';
  const prefix = '__test3/';
  const providerOptions = { bucket: gcpTestBucketName };
  const pat = ['./src/**/*'];
  const filesFromPat = (await fg(pat)) as string[];

  // act
  const result = await push({ files: pat, provider: gcpFileProvider(providerOptions), destPathPrefix: prefix });

  // assert
  expect(result.uploadedFiles.sort()).toEqual(filesFromPat.map(pathTrimStart).sort());
  expect(result.uploadedKeys.sort()).toEqual(filesFromPat.map(x => `${prefix}${pathTrimStart(x)}`).sort());
  expect(result.elasped).toBeGreaterThan(0);

  const storage = new Storage();
  const [files] = await storage.bucket(gcpTestBucketName).getFiles({ prefix });

  expect(files.map(x => x.name).sort()).toEqual(filesFromPat.map(x => `${prefix}${pathTrimStart(x)}`).sort());
  expect(files.map(x => x.name).sort()).toEqual(result.uploadedKeys.sort());

  // cleanup;
  await Promise.all(
    result.uploadedKeys.map(key =>
      storage
        .bucket(gcpTestBucketName)
        .file(key)
        .delete()
    )
  );
});
