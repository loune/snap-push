import fs from 'fs';
import { spawn, spawnSync } from 'child_process';
import { StorageSharedKeyCredential, BlobServiceClient } from '@azure/storage-blob';
import uploadFileFactory, { AzureProviderOptions } from './azure.js';

jest.setTimeout(20000);

test('azure uploadFile', async () => {
  try {
    fs.mkdirSync('azurite');
  } catch {} // eslint-disable-line no-empty
  const azurite = spawn('node', [
    'node_modules/.bin/azurite-blob',
    '--silent',
    '--location',
    'azurite',
    '--loose',
    '--blobPort',
    '39858',
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

  await new Promise((r) => setTimeout(r, 4000));

  try {
    const testFile = 'jest.config.js';
    const testKeyName = '__s3.test';
    // test with azurite
    const accountName = 'devstoreaccount1';
    const options: AzureProviderOptions = {
      credential: new StorageSharedKeyCredential(
        accountName,
        'Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw=='
      ),
      serviceUrl: `http://127.0.0.1:39858/${accountName}`,
      containerName: `snappushtest${new Date().getTime()}`,
    };

    // Create a container
    const blobServiceClient = new BlobServiceClient(options.serviceUrl ?? '', options.credential);

    const containerClient = blobServiceClient.getContainerClient(options.containerName);

    await containerClient.create();

    const uploadFile = uploadFileFactory(options);

    // act
    await uploadFile.upload({
      contentLength: fs.statSync(testFile).size,
      source: fs.createReadStream(testFile),
      destFileName: testKeyName,
      contentType: 'text/plain',
      md5Hash: 'e16b86ba6de4a2aab341704ff3ba0072',
      metadata: { test: 'azure' },
    });
    const list = await uploadFile.list(testKeyName, true);

    // assert
    const blockBlobClient = containerClient.getBlockBlobClient(testKeyName);
    const downloadBlockBlobResponse = await blockBlobClient.download();

    const fileStat = fs.statSync(testFile);
    expect(downloadBlockBlobResponse.contentLength).toBe(fileStat.size);
    expect(downloadBlockBlobResponse.contentType).toBe('text/plain');
    const streamString = await new Promise((resolve, reject) => {
      const buffers: Buffer[] = [];
      expect(downloadBlockBlobResponse.readableStreamBody).toBeTruthy();
      downloadBlockBlobResponse.readableStreamBody?.on('data', (data) => {
        buffers.push(data);
      });
      downloadBlockBlobResponse.readableStreamBody?.on('end', () => {
        resolve(Buffer.concat(buffers).toString());
      });
      downloadBlockBlobResponse.readableStreamBody?.on('error', (err) => {
        reject(err);
      });
    });
    expect(streamString).toBe(fs.readFileSync(testFile).toString());
    expect(list).toEqual([
      { name: testKeyName, md5: 'e16b86ba6de4a2aab341704ff3ba0072', size: fileStat.size, metadata: { test: 'azure' } },
    ]);

    await uploadFile.delete(testKeyName);

    const listAfterDelete = await uploadFile.list(testKeyName, false);
    expect(listAfterDelete).toEqual([]);

    await containerClient.delete();
  } finally {
    spawnSync('kill', ['-9', azurite.pid.toString()]);
    await azuriteEnd;
  }
});
