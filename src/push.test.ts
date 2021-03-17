import AWS from 'aws-sdk';
import { StorageSharedKeyCredential, BlobServiceClient, BlobItem } from '@azure/storage-blob';
import fg from 'fast-glob';
import { Storage } from '@google-cloud/storage';
import { Writable } from 'stream';
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import crypto from 'crypto';
import zlib from 'zlib';
import push, { pathTrimStart } from './push';
import s3FileProvider from './s3';
import azureFileProvider from './azure';
import gcpFileProvider from './gcp';
import { UploadFileProvider, UploadFile } from './types';

const s3TestBucketName = 'pouch-test';

jest.setTimeout(60000);

class Md5LengthStream extends Writable {
  size = 0;

  md5: crypto.Hash;
  decodedMd5: crypto.Hash;

  hash = '';
  decodedHash = '';
  contentDecoder?: (buffer: Buffer, callback: (err: Error | null, result: Buffer) => void) => void;
  buffer: Buffer[] = [];
  enc = '';

  constructor(opt?: any, contentEncoding?: string) {
    super(opt);

    this.md5 = crypto.createHash('md5');
    this.md5.setEncoding('hex');

    this.decodedMd5 = crypto.createHash('md5');
    this.decodedMd5.setEncoding('hex');

    if (contentEncoding === 'gzip') {
      this.contentDecoder = (buffer, callback) =>
        zlib.unzip(buffer, { finishFlush: zlib.constants.Z_SYNC_FLUSH }, callback);
    } else if (contentEncoding === 'br') {
      this.contentDecoder = (buffer, callback) => zlib.brotliDecompress(buffer, {}, callback);
    } else {
      this.contentDecoder = undefined;
    }
  }

  // eslint-disable-next-line no-underscore-dangle
  _write(chunk: any, enc: string, callback: (err?: Error | null) => void) {
    // store chunk, then call cb when done
    this.size += chunk.length;

    // md5
    this.md5.write(chunk, enc, callback);

    this.enc = enc;
    this.buffer.push(chunk);
  }

  // eslint-disable-next-line no-underscore-dangle
  finish(callback: (err?: Error | null) => void) {
    this.md5.end();
    this.hash = this.md5.read();

    const content = Buffer.concat(this.buffer);

    if (this.contentDecoder) {
      this.contentDecoder(content, (err, result) => {
        if (err) {
          callback(err);
          return;
        }
        this.decodedMd5.write(result, this.enc, (md5err) => {
          if (md5err) {
            callback(md5err);
            return;
          }
          setImmediate(() => {
            this.decodedMd5.end();
            this.decodedHash = this.decodedMd5.read();
            callback();
          });
        });
      });
      return;
    }

    callback();
  }
}

function getMockProvider(initalFiles: UploadFile[]): UploadFileProvider {
  let files: UploadFile[] = [...initalFiles];
  const mockProvider: UploadFileProvider = {
    async upload(args) {
      let contentEncoding: string | undefined;
      if (args.destFileName.endsWith('.gz')) {
        contentEncoding = 'gzip';
      } else if (args.destFileName.endsWith('.br')) {
        contentEncoding = 'br';
      }

      const lstream = new Md5LengthStream(undefined, contentEncoding);

      return new Promise((resolve, reject) => {
        args.source.pipe(lstream, { end: true }).on('finish', () => {
          lstream.finish(() => {
            files.push({
              md5: args.md5Hash,
              name: args.destFileName,
              size: lstream.size,
              metadata: { hash: lstream.hash, decodedHash: lstream.decodedHash, tags: JSON.stringify(args.tags) },
            });
            resolve();
          });
        });
      });
    },
    async list(prefix, includeMetadata) {
      return files;
    },
    async delete(key) {
      files = files.filter((f) => f.name !== key);
    },
  };

  (mockProvider as any).files = files;

  return mockProvider;
}

test('delete files that no longer exists', async () => {
  const pat = ['./src/**/*'];
  const initialFiles = [{ name: 'f1', size: 4, md5: 'sdf', metadata: {} }];
  const provider = getMockProvider(initialFiles);

  // act
  const result = await push({ shouldDeleteExtraFiles: true, files: pat, provider });

  // assert
  expect(result.deletedKeys.sort()).toEqual(initialFiles.map((f) => f.name).sort());
});

test('delete files that no longer exists including compressed versions because we did not specify the compress option', async () => {
  const pat = ['./src/s3.ts'];
  const initialFiles = [
    { name: 'src/s3.ts', size: 4, md5: 'sdf', metadata: {} },
    { name: 'src/s3.ts.br', size: 4, md5: 'sdf', metadata: {} },
    { name: 'src/s3.ts.gz', size: 4, md5: 'sdf', metadata: {} },
  ];
  const provider = getMockProvider(initialFiles);

  // act
  const result = await push({ shouldDeleteExtraFiles: true, files: pat, provider });

  // assert
  expect(result.deletedKeys.sort()).toEqual(
    initialFiles
      .filter((f) => f.name !== 'src/s3.ts')
      .map((f) => f.name)
      .sort()
  );
});

test('delete files that no longer exists, but leaving compressed versions', async () => {
  const pat = ['./src/s3.ts'];
  const initialFiles = [
    { name: 'src/s3.ts', size: 4, md5: 'sdf', metadata: {} },
    { name: 'src/s3.ts.br', size: 2, md5: 'sdf', metadata: {} },
    { name: 'src/s3.ts.gz', size: 3, md5: 'sdf', metadata: {} },
  ];
  const provider = getMockProvider(initialFiles);

  // act
  const result = await push({
    shouldDeleteExtraFiles: true,
    files: pat,
    provider,
    autoCompress: { encodings: ['br', 'gzip'], fileExtensions: ['ts'] },
  });

  // assert
  expect(result.deletedKeys.sort()).toEqual([]);
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

test('upload with compressed copies of certain files', async () => {
  const pat = ['./src/Mime.d.ts', './src/s3.ts'];
  const initialFiles: UploadFile[] = [];
  const provider = getMockProvider(initialFiles);

  // act
  const result = await push({
    files: pat,
    provider,
    autoCompress: { fileExtensions: ['d.ts'], encodings: ['br', 'gzip'] },
  });

  // assert
  expect(result.uploadedFiles).toEqual(expect.arrayContaining(['src/Mime.d.ts', 'src/s3.ts']));
  expect(result.uploadedKeys).toEqual(
    expect.arrayContaining(['src/Mime.d.ts.br', 'src/Mime.d.ts.gz', 'src/Mime.d.ts', 'src/s3.ts'])
  );
  expect(result.uploadedKeys).not.toEqual(expect.arrayContaining(['src/s3.ts.br', 'src/s3.ts.gz']));

  const mimeMd5 = (provider as any).files[0].md5;
  expect((provider as any).files[0].metadata.decodedHash).toEqual(mimeMd5);
  expect((provider as any).files[1].metadata.decodedHash).toEqual(mimeMd5);
  expect((provider as any).files[2].metadata.hash).toEqual(mimeMd5);
});

test('upload files to mock file provider', async () => {
  const pat = ['./src/Mime.d.ts', './src/s3.ts'];
  const initialFiles: UploadFile[] = [];
  const provider = getMockProvider(initialFiles);

  // act
  const result = await push({
    files: pat,
    provider,
    tags: (fileName) => ({ tagFN: fileName }),
  });

  // assert
  expect(result.uploadedFiles).toEqual(expect.arrayContaining(['src/Mime.d.ts', 'src/s3.ts']));
  expect(result.uploadedKeys).toEqual(expect.arrayContaining(['src/Mime.d.ts', 'src/s3.ts']));

  expect((provider as any).files[0].metadata.tags).toEqual(JSON.stringify({ tagFN: 'src/Mime.d.ts' }));
  expect((provider as any).files[1].metadata.tags).toEqual(JSON.stringify({ tagFN: 'src/s3.ts' }));
  expect((provider as any).files[0].size).toEqual(fs.statSync('src/Mime.d.ts').size);
  expect((provider as any).files[1].size).toEqual(fs.statSync('src/s3.ts').size);
  expect((provider as any).files[0].metadata.hash).toEqual((provider as any).files[0].md5);
  expect((provider as any).files[1].metadata.hash).toEqual((provider as any).files[1].md5);
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
  const prefix = `__snap-push-test${Date.now()}/`;
  const providerOptions = { bucket: s3TestBucketName };
  const pat = ['./src/**/*'];
  const filesFromPat = (await fg(pat)) as string[];

  // act
  const result = await push({
    files: pat,
    provider: s3FileProvider(providerOptions),
    destPathPrefix: prefix,
    onlyUploadChanges: false,
    tags: {
      Test: 'test string 1',
      Test2: 'test string 2',
    },
  });

  // assert
  expect(result.uploadedFiles.sort()).toEqual(filesFromPat.map(pathTrimStart).sort());
  expect(result.uploadedKeys.sort()).toEqual(filesFromPat.map((x) => `${prefix}${pathTrimStart(x)}`).sort());
  expect(result.elasped).toBeGreaterThan(0);

  const s3 = new AWS.S3();
  const s3result = await s3.listObjectsV2({ Bucket: s3TestBucketName, Prefix: prefix }).promise();
  expect(s3result.Contents?.map((x) => x.Key).sort()).toEqual(
    filesFromPat.map((x) => `${prefix}${pathTrimStart(x)}`).sort()
  );
  expect(s3result.Contents?.map((x) => x.Key).sort()).toEqual(result.uploadedKeys.sort());

  // cleanup
  await Promise.all(
    result.uploadedKeys.map((key) => s3.deleteObject({ Bucket: s3TestBucketName, Key: key }).promise())
  );
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
  await new Promise((r) => setTimeout(r, 4000));

  try {
    const prefix = `__snap-push-test${Date.now()}/`;
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
      tags: {
        Test: 'test string 1',
        Test2: 'test string 2',
      },
    });

    // assert
    expect(result.uploadedFiles.sort()).toEqual(filesFromPat.map(pathTrimStart).sort());
    expect(result.uploadedKeys.sort()).toEqual(filesFromPat.map((x) => `${prefix}${pathTrimStart(x)}`).sort());
    expect(result.elasped).toBeGreaterThan(0);

    const blobs: BlobItem[] = [];
    const listBlobsResponse = containerClient.listBlobsFlat();

    // eslint-disable-next-line no-await-in-loop
    for await (const blob of listBlobsResponse) {
      blobs.push(blob);
    }

    expect(blobs.map((x) => x.name).sort()).toEqual(filesFromPat.map((x) => `${prefix}${pathTrimStart(x)}`).sort());
    expect(blobs.map((x) => x.name).sort()).toEqual(result.uploadedKeys.sort());

    // cleanup
    await containerClient.delete();
  } finally {
    spawnSync('kill', ['-9', azurite.pid.toString()]);
  }
});

test('push with gcp', async () => {
  const gcpTestBucketName = 'snap-push-test';
  const prefix = `__snap-push-test${Date.now()}/`;
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
  expect(result.uploadedKeys.sort()).toEqual(filesFromPat.map((x) => `${prefix}${pathTrimStart(x)}`).sort());
  expect(result.elasped).toBeGreaterThan(0);

  const storage = new Storage();
  const [files] = await storage.bucket(gcpTestBucketName).getFiles({ prefix });

  expect(files.map((x) => x.name).sort()).toEqual(filesFromPat.map((x) => `${prefix}${pathTrimStart(x)}`).sort());
  expect(files.map((x) => x.name).sort()).toEqual(result.uploadedKeys.sort());

  // cleanup
  await Promise.all(result.uploadedKeys.map((key) => storage.bucket(gcpTestBucketName).file(key).delete()));
});
