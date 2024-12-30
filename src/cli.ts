#!/usr/bin/env node
import yargs from 'yargs/yargs';
import push from './push.js';
import { UploadFileProvider } from './types.js';

interface Argv {
  source: string;
  destination: string;
  prefix?: string;
  concurrency?: number;
  public?: boolean;
  force?: boolean;
  accountName?: string;
  accountKey?: string;
}

type UploadFileProviderConstructor = (options: unknown) => UploadFileProvider;

async function getProvider(argv: Argv): Promise<UploadFileProvider> {
  const [, proto, bucket] = /^([a-zA-Z0-9]+):\/\/([a-zA-Z0-9-.]+)\/*/.exec(argv.destination) ?? [null, null, null];

  if (proto === null) {
    throw new Error(
      `destination ${argv.destination} is not valid. It should be in the format of <provider>://<bucket> e.g. s3://my-bucket-name`,
    );
  }

  if (proto === 's3') {
    const providerOptions = { bucket, listMetaDataConcurrency: argv.concurrency };
    const s3FileProvider = (await import('./s3.js')).default as UploadFileProviderConstructor;
    return s3FileProvider(providerOptions);
  }

  if (proto === 'gcp') {
    const providerOptions = { bucket };
    const gcpProvider = (await import('./gcp.js')).default as UploadFileProviderConstructor;
    return gcpProvider(providerOptions);
  }

  if (proto === 'azure') {
    const { StorageSharedKeyCredential } = await import('@azure/storage-blob');
    const { accountName, accountKey } = argv;

    const providerOptions = {
      account: accountName,
      containerName: bucket,
      credential: accountName && accountKey ? new StorageSharedKeyCredential(accountName, accountKey) : undefined,
    };
    const gcpProvider = (await import('./azure.js')).default as UploadFileProviderConstructor;
    return gcpProvider(providerOptions);
  }

  throw new Error(`${proto} is not supported`);
}

const logger = {
  info(...args: unknown[]) {
    console.log(...args);
  },
  error(...args: unknown[]) {
    console.error(...args);
  },
  warn(...args: unknown[]) {
    console.warn(...args);
  },
};

const result = yargs(process.argv.slice(2))
  .scriptName('snap-push')
  .command<Argv>(
    '* <source> <destination>',
    'Push files to the remote file service.',
    (myargs) => {
      myargs.positional('source', {
        describe: 'source files glob',
      });
      myargs.positional('destination', {
        describe: 'destination bucket',
      });
    },
    async (argv) => {
      const startTime = Date.now();
      try {
        // act
        const result = await push({
          files: argv.source.split(','),
          provider: await getProvider(argv),
          destPathPrefix: argv.prefix,
          logger,
          concurrency: argv.concurrency,
          makePublic: argv.public,
          onlyUploadChanges: !argv.force,
        });

        logger.info(
          `Finished in ${Math.round((Date.now() - startTime) / 1000)}s. (Uploaded ${
            result.uploadedKeys.length
          }. Deleted ${result.deletedKeys.length}. Skipped ${result.skippedKeys.length}.)`,
        );
      } catch (error: any) {
        logger.error(`Error: ${error}`);
      }
    },
  )
  .option('concurrency', {
    alias: 'c',
    default: 3,
  })
  .option('prefix', {
    default: '',
  })
  .option('accountName', {
    default: null,
  })
  .option('accountKey', {
    default: null,
  })
  .option('public', {
    default: false,
  })
  .option('force', {
    default: false,
  }).argv;

if (result instanceof Promise) {
  result.catch((err: any) => logger.error(err));
}
