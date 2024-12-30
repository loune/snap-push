import { Writable, WritableOptions } from 'stream';
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import crypto from 'crypto';
import zlib from 'zlib';
import { Storage } from '@google-cloud/storage';
import fg from 'fast-glob';
import { StorageSharedKeyCredential, BlobServiceClient, BlobItem } from '@azure/storage-blob';
import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import push, { pathTrimStart } from './push.js';
import s3FileProvider from './s3.js';
import azureFileProvider from './azure.js';
import gcpFileProvider from './gcp.js';
import { UploadFileProvider, UploadFile, AbstractLogger, UploadArgs } from './types.js';

const s3TestBucketName = 'pouch-test';

jest.setTimeout(60000);

interface MockProvider extends UploadFileProvider {
  files: UploadFile[];
}

class Md5LengthStream extends Writable {
  size = 0;

  md5: crypto.Hash;
  decodedMd5: crypto.Hash;

  hash = '';
  decodedHash = '';
  contentDecoder?: (buffer: Buffer, callback: (err: Error | null, result: Buffer) => void) => void;
  buffer: Buffer[] = [];
  enc: BufferEncoding | undefined;

  constructor(opt?: WritableOptions, contentEncoding?: string) {
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

  _write(chunk: Buffer, enc: BufferEncoding, callback: (err?: Error | null) => void) {
    // store chunk, then call cb when done
    this.size += chunk.length;

    // md5
    this.md5.write(chunk, enc, callback);

    this.enc = enc;
    this.buffer.push(chunk);
  }

  finish(callback: (err?: Error | null) => void) {
    this.md5.end();
    this.hash = this.md5.read() as string;

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
            this.decodedHash = this.decodedMd5.read() as string;
            callback();
          });
        });
      });
      return;
    }

    callback();
  }
}

function getMockProvider(initalFiles: UploadFile[], customUploadHook?: (args: UploadArgs) => void): UploadFileProvider {
  let files: UploadFile[] = [...initalFiles];
  const mockProvider: UploadFileProvider = {
    async upload(args) {
      let contentEncoding: string | undefined;
      if (args.destFileName.endsWith('.gz')) {
        contentEncoding = 'gzip';
      } else if (args.destFileName.endsWith('.br')) {
        contentEncoding = 'br';
      }

      customUploadHook?.(args);

      const lstream = new Md5LengthStream(undefined, contentEncoding);

      return new Promise((resolve) => {
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
    // eslint-disable-next-line @typescript-eslint/require-await
    async list() {
      return files;
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async delete(key) {
      files = files.filter((f) => f.name !== key);
    },
  };

  (mockProvider as MockProvider).files = files;

  return mockProvider;
}

function findMockFile(provider: UploadFileProvider, filename: string): UploadFile | undefined {
  return (provider as MockProvider).files.find((file: UploadFile) => file.name === filename);
}

class MockLogger implements AbstractLogger {
  logs: string[] = [];
  logToConsole = false;

  constructor(logToConsole: boolean) {
    this.logToConsole = logToConsole;
  }

  info(message: string, ...args: unknown[]) {
    this.logs.push(message);
    if (this.logToConsole) {
      console.log(message, ...args);
    }
  }

  warn(message: string, ...args: unknown[]) {
    this.logs.push(message);
    if (this.logToConsole) {
      console.warn(message, ...args);
    }
  }

  error(message: string, ...args: unknown[]) {
    this.logs.push(message);
    if (this.logToConsole) {
      console.error(message, ...args);
    }
  }
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
      .sort(),
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
    encoding: { contentEncodings: ['raw', 'br', 'gzip'], fileExtensions: ['ts'] },
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
  const pat = ['.gitignore', './src/cli.ts', './src/s3.ts'];
  const initialFiles: UploadFile[] = [];
  const provider = getMockProvider(initialFiles);

  // act
  const result = await push({
    files: pat,
    provider,
    encoding: { fileExtensions: ['gitignore'], contentEncodings: ['raw', 'br', 'gzip'] },
  });

  // assert
  expect(result.uploadedFiles).toEqual(expect.arrayContaining(['src/cli.ts', 'src/s3.ts']));
  expect(result.uploadedKeys).toEqual(
    expect.arrayContaining(['.gitignore.br', '.gitignore.gz', '.gitignore', 'src/cli.ts', 'src/s3.ts']),
  );
  expect(result.uploadedKeys).not.toEqual(expect.arrayContaining(['src/s3.ts.br', 'src/s3.ts.gz']));

  const gitMd5 = findMockFile(provider, '.gitignore')?.md5;
  expect(findMockFile(provider, '.gitignore.br')?.metadata.decodedHash).toEqual(gitMd5);
  expect(findMockFile(provider, '.gitignore.gz')?.metadata.decodedHash).toEqual(gitMd5);
  expect(findMockFile(provider, '.gitignore')?.metadata.hash).toEqual(gitMd5);
});

test('upload with compressed copies of certain files determined with function', async () => {
  const pat = ['./src/cli.ts', './src/s3.ts'];
  const initialFiles: UploadFile[] = [];
  const provider = getMockProvider(initialFiles);

  // act
  const result = await push({
    files: pat,
    provider,
    encoding: (fileName) =>
      fileName.includes('s3.ts')
        ? [
            { destFileName: `${fileName}.br`, encoding: 'br' },
            { destFileName: fileName, encoding: 'raw' },
          ]
        : undefined,
  });

  // assert
  expect(result.uploadedFiles).toEqual(expect.arrayContaining(['src/cli.ts', 'src/s3.ts']));
  expect(result.uploadedKeys).toEqual(expect.arrayContaining(['src/cli.ts', 'src/s3.ts.br', 'src/s3.ts']));
  expect(result.uploadedKeys).not.toEqual(expect.arrayContaining(['src/cli.ts.br', 'src/cli.ts.gz', 'src/s3.ts.gz']));

  const mimeMd5 = findMockFile(provider, 'src/s3.ts')?.md5;
  expect(findMockFile(provider, 'src/s3.ts.br')?.metadata.decodedHash).toEqual(mimeMd5);
  expect(findMockFile(provider, 'src/s3.ts')?.metadata.hash).toEqual(mimeMd5);
});

test('pretend to upload files to mock file provider with dryRun', async () => {
  const pat = ['./src/cli.ts', './src/s3.ts'];
  const initialFiles: UploadFile[] = [];
  const provider = getMockProvider(initialFiles);
  const logger = new MockLogger(false);

  // act
  const result = await push({
    files: pat,
    provider,
    tags: (fileName) => ({ tagFN: fileName }),
    dryRun: true,
    logger,
    mimeTypes: {
      'application/typescript': ['ts'],
    },
  });

  // assert
  expect(result.uploadedFiles).toEqual(expect.arrayContaining(['src/cli.ts', 'src/s3.ts']));
  expect(result.uploadedKeys).toEqual(expect.arrayContaining(['src/cli.ts', 'src/s3.ts']));

  expect(logger.logs[0]).toEqual('Pretend upload: src/cli.ts (application/typescript)');
  expect(logger.logs[2]).toEqual('Pretend upload: src/s3.ts (application/typescript)');
  expect(findMockFile(provider, 'src/cli.ts')).toBeUndefined();
  expect(findMockFile(provider, 'src/s3.ts')).toBeUndefined();
});

test('upload files with substituteFile to mock file provider', async () => {
  const pat = ['./src/cli.ts', './src/s3.ts'];
  const initialFiles: UploadFile[] = [];
  const provider = getMockProvider(initialFiles);
  const logger = new MockLogger(false);

  // act
  const result = await push({
    files: pat,
    provider,
    tags: (fileName) => ({ tagFN: fileName }),
    substituteFile: (filename: string) => (filename === 'src/s3.ts' ? 'src/azure.ts' : undefined),
    logger,
  });

  // assert
  expect(result.uploadedFiles).toEqual(expect.arrayContaining(['src/cli.ts', 'src/azure.ts']));
  expect(result.uploadedKeys).toEqual(expect.arrayContaining(['src/cli.ts', 'src/s3.ts']));

  expect(findMockFile(provider, 'src/cli.ts')?.metadata.tags).toEqual(JSON.stringify({ tagFN: 'src/cli.ts' }));
  expect(findMockFile(provider, 'src/s3.ts')?.metadata.tags).toEqual(JSON.stringify({ tagFN: 'src/azure.ts' }));
  expect(findMockFile(provider, 'src/cli.ts')?.size).toEqual(fs.statSync('src/cli.ts').size);
  expect(findMockFile(provider, 'src/s3.ts')?.size).toEqual(fs.statSync('src/azure.ts').size);
  expect(findMockFile(provider, 'src/cli.ts')?.metadata.hash).toEqual(findMockFile(provider, 'src/cli.ts')?.md5);
  expect(findMockFile(provider, 'src/s3.ts')?.metadata.hash).toEqual(findMockFile(provider, 'src/s3.ts')?.md5);
});

test('upload files with substituteFile to mock file provider on changed working directory', async () => {
  const pat = ['./cli.ts', './s3.ts'];
  const initialFiles: UploadFile[] = [];
  const provider = getMockProvider(initialFiles);
  const logger = new MockLogger(false);

  // act
  const result = await push({
    files: pat,
    provider,
    tags: (fileName) => ({ tagFN: fileName }),
    substituteFile: (filename: string) => (filename === 's3.ts' ? 'azure.ts' : undefined),
    logger,
    currentWorkingDirectory: 'src',
  });

  // assert
  expect(result.uploadedFiles).toEqual(expect.arrayContaining(['cli.ts', 'azure.ts']));
  expect(result.uploadedKeys).toEqual(expect.arrayContaining(['cli.ts', 's3.ts']));

  expect(findMockFile(provider, 'cli.ts')?.metadata.tags).toEqual(JSON.stringify({ tagFN: 'cli.ts' }));
  expect(findMockFile(provider, 's3.ts')?.metadata.tags).toEqual(JSON.stringify({ tagFN: 'azure.ts' }));
  expect(findMockFile(provider, 'cli.ts')?.size).toEqual(fs.statSync('src/cli.ts').size);
  expect(findMockFile(provider, 's3.ts')?.size).toEqual(fs.statSync('src/azure.ts').size);
  expect(findMockFile(provider, 'cli.ts')?.metadata.hash).toEqual(findMockFile(provider, 'cli.ts')?.md5);
  expect(findMockFile(provider, 's3.ts')?.metadata.hash).toEqual(findMockFile(provider, 's3.ts')?.md5);
});

test('upload files error in mock file provider', async () => {
  const pat = ['./src/cli.ts', './src/s3.ts'];
  const initialFiles: UploadFile[] = [];
  const provider = getMockProvider(initialFiles, (args) => {
    if (args.destFileName === 'src/s3.ts') {
      throw new Error('test upload error');
    }
  });
  const logger = new MockLogger(false);

  // act
  const result = await push({
    files: pat,
    provider,
    tags: (fileName) => ({ tagFN: fileName }),
    substituteFile: (filename: string) => (filename === 'src/s3.ts' ? 'src/azure.ts' : undefined),
    logger,
  });

  // assert
  expect(result.uploadedFiles).toEqual(expect.arrayContaining(['src/cli.ts']));
  expect(result.uploadedKeys).toEqual(expect.arrayContaining(['src/cli.ts']));
  expect(result.errorKeys).toEqual(expect.arrayContaining(['src/s3.ts']));

  expect(findMockFile(provider, 'src/s3.ts')).toBeUndefined();
  expect(findMockFile(provider, 'src/cli.ts')?.metadata.tags).toEqual(JSON.stringify({ tagFN: 'src/cli.ts' }));
  expect(findMockFile(provider, 'src/cli.ts')?.size).toEqual(fs.statSync('src/cli.ts').size);
  expect(findMockFile(provider, 'src/cli.ts')?.metadata.hash).toEqual(findMockFile(provider, 'src/cli.ts')?.md5);
});

test('upload files with ignoreFile', async () => {
  const pat = ['./src/cli.ts', './src/s3.ts'];
  const initialFiles: UploadFile[] = [];
  const provider = getMockProvider(initialFiles);
  const logger = new MockLogger(false);

  // act
  const result = await push({
    files: pat,
    provider,
    tags: (fileName) => ({ tagFN: fileName }),
    ignoreFile: (filename: string) => filename === 'src/cli.ts',
    logger,
  });

  // assert
  expect(result.uploadedFiles).toEqual(expect.arrayContaining(['src/s3.ts']));
  expect(result.uploadedKeys).toEqual(expect.arrayContaining(['src/s3.ts']));

  expect(findMockFile(provider, 'src/cli.ts')).toBeUndefined();
  expect(findMockFile(provider, 'src/s3.ts')?.metadata.tags).toEqual(JSON.stringify({ tagFN: 'src/s3.ts' }));
  expect(findMockFile(provider, 'src/s3.ts')?.size).toEqual(fs.statSync('src/s3.ts').size);
  expect(findMockFile(provider, 'src/s3.ts')?.metadata.hash).toEqual(findMockFile(provider, 'src/s3.ts')?.md5);
});

test('upload files to mock file provider', async () => {
  const pat = ['./src/cli.ts', './src/s3.ts'];
  const initialFiles: UploadFile[] = [];
  const provider = getMockProvider(initialFiles);

  // act
  const result = await push({
    files: pat,
    provider,
    tags: (fileName) => ({ tagFN: fileName }),
  });

  // assert
  expect(result.uploadedFiles).toEqual(expect.arrayContaining(['src/cli.ts', 'src/s3.ts']));
  expect(result.uploadedKeys).toEqual(expect.arrayContaining(['src/cli.ts', 'src/s3.ts']));

  expect(findMockFile(provider, 'src/cli.ts')?.metadata.tags).toEqual(JSON.stringify({ tagFN: 'src/cli.ts' }));
  expect(findMockFile(provider, 'src/s3.ts')?.metadata.tags).toEqual(JSON.stringify({ tagFN: 'src/s3.ts' }));
  expect(findMockFile(provider, 'src/cli.ts')?.size).toEqual(fs.statSync('src/cli.ts').size);
  expect(findMockFile(provider, 'src/s3.ts')?.size).toEqual(fs.statSync('src/s3.ts').size);
  expect(findMockFile(provider, 'src/cli.ts')?.metadata.hash).toEqual(findMockFile(provider, 'src/cli.ts')?.md5);
  expect(findMockFile(provider, 'src/s3.ts')?.metadata.hash).toEqual(findMockFile(provider, 'src/s3.ts')?.md5);
});

test('change working directory', async () => {
  const pat = ['./**/*'];
  const filesFromPat = await fg(pat, { cwd: 'src' });
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
  const filesFromPat = await fg(pat);

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
    logger: new MockLogger(true),
  });

  // assert
  expect(result.uploadedFiles.sort()).toEqual(filesFromPat.map(pathTrimStart).sort());
  expect(result.uploadedKeys.sort()).toEqual(filesFromPat.map((x) => `${prefix}${pathTrimStart(x)}`).sort());
  expect(result.elasped).toBeGreaterThan(0);

  const s3 = new S3Client({});
  const s3result = await s3.send(new ListObjectsV2Command({ Bucket: s3TestBucketName, Prefix: prefix }));
  expect(s3result.Contents?.map((x) => x.Key).sort()).toEqual(
    filesFromPat.map((x) => `${prefix}${pathTrimStart(x)}`).sort(),
  );
  expect(s3result.Contents?.map((x) => x.Key).sort()).toEqual(result.uploadedKeys.sort());

  // cleanup
  // await Promise.all(
  //   result.uploadedKeys.map((key) => s3.deleteObject({ Bucket: s3TestBucketName, Key: key }).promise())
  // );
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
    '--loose',
    '--blobPort',
    '39878',
  ]);

  azurite.stdout.on('data', (data) => {
    console.log(`azurite stdout: ${data}`);
  });

  azurite.stderr.on('data', (data) => {
    console.error(`azurite stderr: ${data}`);
  });

  const azuriteEnd = new Promise<void>((resolve) => {
    azurite.on('close', (code) => {
      console.log(`azurite exited with code ${code}`);
      resolve();
    });
  });

  await new Promise((r) => {
    setTimeout(r, 4000);
  });

  try {
    const prefix = `__snap-push-test${Date.now()}/`;
    // test with azurite
    const accountName = 'devstoreaccount1';
    const providerOptions = {
      credential: new StorageSharedKeyCredential(
        accountName,
        'Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==',
      ),
      serviceUrl: `http://127.0.0.1:39878/${accountName}`,
      containerName: `snap-push-test-${new Date().getTime()}`,
    };
    const pat = ['./src/**/*'];
    const filesFromPat = await fg(pat);

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

    for await (const blob of listBlobsResponse) {
      blobs.push(blob);
    }

    expect(blobs.map((x) => x.name).sort()).toEqual(filesFromPat.map((x) => `${prefix}${pathTrimStart(x)}`).sort());
    expect(blobs.map((x) => x.name).sort()).toEqual(result.uploadedKeys.sort());

    // cleanup
    await containerClient.delete();
  } finally {
    if (azurite.pid) {
      spawnSync('kill', ['-9', azurite.pid.toString()]);
    }
    await azuriteEnd;
  }
});

test('push with gcp', async () => {
  const gcpTestBucketName = 'snap-push-test';
  const prefix = `__snap-push-test${Date.now()}/`;
  const providerOptions = { bucket: gcpTestBucketName };
  const pat = ['./src/**/*'];
  const filesFromPat = await fg(pat);

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
