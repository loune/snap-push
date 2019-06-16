#!/usr/bin/env node
import push from './push';

function getProvider(argv) {
  const [, proto, bucket] = /^([a-zA-Z0-9]+):\/\/([a-zA-Z0-9-]+)\/*/.exec(argv.destination) || [null, null, null];

  if (proto === null) {
    throw new Error(`destination should be in the format of <provider>://<bucket> e.g. s3://my-bucket-name`);
  }

  if (proto === 's3') {
    const providerOptions = { bucket, listMetaDataConcurrency: argv.concurrency };
    // eslint-disable-next-line global-require,@typescript-eslint/no-var-requires
    const s3FileProvider = require('./s3').default;
    return s3FileProvider(providerOptions);
  }

  if (proto === 'gcp') {
    const providerOptions = { bucket };
    // eslint-disable-next-line global-require,@typescript-eslint/no-var-requires
    const gcpProvider = require('./gcp').default;
    return gcpProvider(providerOptions);
  }

  if (proto === 'azure') {
    // eslint-disable-next-line @typescript-eslint/no-var-requires,global-require
    const { SharedKeyCredential } = require('@azure/storage-blob');
    const providerOptions = {
      account: argv.accountName,
      containerName: bucket,
      credential: argv.accountName ? new SharedKeyCredential(argv.accountName, argv.accountKey) : undefined,
    };
    // eslint-disable-next-line global-require,@typescript-eslint/no-var-requires
    const gcpProvider = require('./azure').default;
    return gcpProvider(providerOptions);
  }

  throw new Error(`${proto} is not supported`);
}

const logger = {
  info(...args) {
    console.log(...args);
  },
  error(...args) {
    console.error(...args);
  },
  warn(...args) {
    console.warn(...args);
  },
};

require('yargs') // eslint-disable-line
  .command(
    '* <source> <destination>',
    'Push files to the remote file service.',
    yargs => {
      yargs.positional('source', {
        describe: 'source files glob',
      });
      yargs.positional('destination', {
        describe: 'destination bucket',
      });
    },
    argv => {
      const startTime = Date.now();
      // act
      push({
        files: argv.source.split(','),
        provider: getProvider(argv),
        destPathPrefix: argv.prefix,
        logger,
        concurrency: argv.concurrency,
      }).then(result => {
        logger.info(
          `Finished in ${Math.round((Date.now() - startTime) / 1000)}s. (Uploaded ${
            result.uploadedKeys.length
          }. Deleted ${result.deletedKeys.length}. Skipped ${result.skippedKeys.length}.)`
        );
      });
    }
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
  }).argv;
