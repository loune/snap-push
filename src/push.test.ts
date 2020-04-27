import AWS from 'aws-sdk';
import { StorageSharedKeyCredential, BlobServiceClient, BlobItem } from '@azure/storage-blob';
import fg from 'fast-glob';
import { Storage } from '@google-cloud/storage';
import { Writable } from 'stream';
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import push, { pathTrimStart } from './push';
import s3FileProvider from './s3';
import azureFileProvider from './azure';
import gcpFileProvider from './gcp';
import { UploadFileProvider, UploadFile } from './types';

const s3TestBucketName = 'pouch-test';

jest.setTimeout(60000);

class LengthStream extends Writable {
  size: 0;

  // eslint-disable-next-line no-underscore-dangle
  _write(chunk, enc, cb) {
    // store chunk, then call cb when done
    this.size += chunk.length;
    cb();
  }
}

function getMockProvider(initalFiles: UploadFile[]) {
  let files: UploadFile[] = [...initalFiles];
  const mockProvider: UploadFileProvider = {
    async upload(args) {
      const lstream = new LengthStream({});
      args.source.pipe(lstream);
      files.push({ md5: args.md5Hash, name: args.destFileName, size: lstream.size, metadata: {} });
    },
    async list(prefix, includeMetadata) {
      return files;
    },
    async delete(key) {
      files = files.filter(f => f.name !== key);
    },
  };
  return mockProvider;
}

test('delete files that no longer exists', async () => {
  const pat = ['./src/**/*'];
  const initialFiles = [{ name: 'f1', size: 4, md5: 'sdf', metadata: {} }];
  const provider = getMockProvider(initialFiles);

  // act
  const result = await push({ shouldDeleteExtraFiles: true, files: pat, provider });

  // assert
  expect(result.deletedKeys.sort()).toEqual(initialFiles.map(f => f.name).sort());
});

test('do not delete files that no longer exists', async () => {
  const pat = ['./src/**/*'];
  const initialFiles = [{ name: 'f1', size: 4, md5: 'sdf', metadata: {} }];
  const provider = getMockProvider(initialFiles);

  // act
  const result = await push({ files: pat, provider });

  // assert
  expect(result.deletedKeys.sort()).toEqual([]);
});

test('do not delete files that no longer exists with func', async () => {
  const pat = ['./src/**/*'];
  const initialFiles = [{ shouldDeleteExtraFiles: () => false, name: 'f1', size: 4, md5: 'sdf', metadata: {} }];
  const provider = getMockProvider(initialFiles);

  // act
  const result = await push({ files: pat, provider });

  // assert
  expect(result.deletedKeys.sort()).toEqual([]);
});

test('change working directory', async () => {
  const pat = ['./**/*'];
  const filesFromPat = (await fg(pat, { cwd: 'src' })) as string[];
  const provider = getMockProvider([]);

  // act
  const result = await push({ currentWorkingDirectory: 'src', files: pat, provider });

  // assert
  expect(result.uploadedFiles.sort()).toEqual(filesFromPat.map(pathTrimStart).sort());
});

test('push with s3', async () => {
  const prefix = '__test3/';
  const providerOptions = { bucket: s3TestBucketName };
  const pat = ['./src/**/*'];
  const filesFromPat = (await fg(pat)) as string[];

  // act
  const result = await push({
    files: pat,
    provider: s3FileProvider(providerOptions),
    destPathPrefix: prefix,
    onlyUploadChanges: false,
  });

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
  try {
    fs.mkdirSync('azurite2');
  } catch {} // eslint-disable-line no-empty
  const azurite = spawn('node', [
    'node_modules/.bin/azurite-blob',
    '--silent',
    '--location',
    'azurite2',
    '--blobPort',
    '39878',
  ]);
  await new Promise(r => setTimeout(r, 4000));

  try {
    const prefix = '__test3/';
    // test with azurite
    const accountName = 'devstoreaccount1';
    const providerOptions = {
      credential: new StorageSharedKeyCredential(
        accountName,
        'Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw=='
      ),
      serviceUrl: `http://127.0.0.1:39878/${accountName}`,
      containerName: `snap-push-test-${new Date().getTime()}`,
    };
    const pat = ['./src/**/*'];
    const filesFromPat = (await fg(pat)) as string[];

    // Create a container
    const blobServiceClient = new BlobServiceClient(providerOptions.serviceUrl, providerOptions.credential);

    const containerClient = blobServiceClient.getContainerClient(providerOptions.containerName);

    await containerClient.create();

    // act
    const result = await push({
      files: pat,
      provider: azureFileProvider(providerOptions),
      destPathPrefix: prefix,
      onlyUploadChanges: false,
    });

    // assert
    expect(result.uploadedFiles.sort()).toEqual(filesFromPat.map(pathTrimStart).sort());
    expect(result.uploadedKeys.sort()).toEqual(filesFromPat.map(x => `${prefix}${pathTrimStart(x)}`).sort());
    expect(result.elasped).toBeGreaterThan(0);

    const blobs: BlobItem[] = [];
    const listBlobsResponse = containerClient.listBlobsFlat();

    // eslint-disable-next-line no-await-in-loop
    for await (const blob of listBlobsResponse) {
      blobs.push(blob);
    }

    expect(blobs.map(x => x.name).sort()).toEqual(filesFromPat.map(x => `${prefix}${pathTrimStart(x)}`).sort());
    expect(blobs.map(x => x.name).sort()).toEqual(result.uploadedKeys.sort());

    // cleanup
    await containerClient.delete();
  } finally {
    spawnSync('kill', ['-9', azurite.pid.toString()]);
  }
});

test('push with gcp', async () => {
  const gcpTestBucketName = 'snap-push-test';
  const prefix = '__test3/';
  const providerOptions = { bucket: gcpTestBucketName };
  const pat = ['./src/**/*'];
  const filesFromPat = (await fg(pat)) as string[];

  // act
  const result = await push({
    files: pat,
    provider: gcpFileProvider(providerOptions),
    destPathPrefix: prefix,
    onlyUploadChanges: false,
  });

  // assert
  expect(result.uploadedFiles.sort()).toEqual(filesFromPat.map(pathTrimStart).sort());
  expect(result.uploadedKeys.sort()).toEqual(filesFromPat.map(x => `${prefix}${pathTrimStart(x)}`).sort());
  expect(result.elasped).toBeGreaterThan(0);

  const storage = new Storage();
  const [files] = await storage.bucket(gcpTestBucketName).getFiles({ prefix });

  expect(files.map(x => x.name).sort()).toEqual(filesFromPat.map(x => `${prefix}${pathTrimStart(x)}`).sort());
  expect(files.map(x => x.name).sort()).toEqual(result.uploadedKeys.sort());

  // cleanup
  await Promise.all(
    result.uploadedKeys.map(key =>
      storage
        .bucket(gcpTestBucketName)
        .file(key)
        .delete()
    )
  );
});
