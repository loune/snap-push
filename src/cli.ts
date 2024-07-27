#!/usr/bin/env node
import yargs from 'yargs';
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

function getProvider(argv: Argv): UploadFileProvider {
  const [, proto, bucket] = /^([a-zA-Z0-9]+):\/\/([a-zA-Z0-9-.]+)\/*/.exec(argv.destination) ?? [null, null, null];

  if (proto === null) {
    throw new Error(
      `destination ${argv.destination} is not valid. It should be in the format of <provider>://<bucket> e.g. s3://my-bucket-name`,
    );
  }

  if (proto === 's3') {
    const providerOptions = { bucket, listMetaDataConcurrency: argv.concurrency };
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-member-access
    const s3FileProvider = require('./s3').default as UploadFileProviderConstructor;
    return s3FileProvider(providerOptions);
  }

  if (proto === 'gcp') {
    const providerOptions = { bucket };
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-member-access
    const gcpProvider = require('./gcp').default as UploadFileProviderConstructor;
    return gcpProvider(providerOptions);
  }

  if (proto === 'azure') {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-assignment
    const { SharedKeyCredential } = require('@azure/storage-blob');
    const providerOptions = {
      account: argv.accountName,
      containerName: bucket,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
      credential: argv.accountName ? new SharedKeyCredential(argv.accountName, argv.accountKey) : undefined,
    };
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-member-access
    const gcpProvider = require('./azure').default as UploadFileProviderConstructor;
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

const result = yargs
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
    (argv) => {
      const startTime = Date.now();
      // act
      push({
        files: argv.source.split(','),
        provider: getProvider(argv),
        destPathPrefix: argv.prefix,
        logger,
        concurrency: argv.concurrency,
        makePublic: argv.public,
        onlyUploadChanges: !argv.force,
      })
        .then((result) => {
          logger.info(
            `Finished in ${Math.round((Date.now() - startTime) / 1000)}s. (Uploaded ${
              result.uploadedKeys.length
            }. Deleted ${result.deletedKeys.length}. Skipped ${result.skippedKeys.length}.)`,
          );
        })
        .catch((error) => {
          logger.error(`Error: ${error}`);
        });
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
