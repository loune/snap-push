# snap-push - Upload static website files to the cloud

## Highlights

- Upload with support for:
  - Amazon S3
  - Azure
  - Google Cloud Storage
  - MinIO
- Automatically detect and set correct `Content-Type` for uploaded files.
- Set custom `Cache-Control`.
- Concurrent uploads.
- Only upload changed files.
- Remove files that were deleted locally.
- Prioritise upload of new files first.

## Installation

### For Amazon S3

```bash
yarn add snap-push aws-sdk
```

or use npm

```bash
npm install snap-push aws-sdk
```

### For Azure Storage

```bash
yarn add snap-push @azure/storage-blob
```

### For Google Cloud Storage

```bash
yarn add snap-push @google-cloud/storage
```

## Basic Usage

`snap-push` can be used as a command line utility or as a library. For example, to push all the files in the `dist` folder to the root of the `example-bucket` S3 bucket and make them public:

### Command line

```bash
$ cd dist && ../node_modules/.bin/snap-push ./**/* s3://example-bucket --public
```

### Library code

```js
const AWS = require('aws-sdk');
const push = require('snap-push').default;
const s3FileProvider = require('snap-push/dist/s3').default;

const providerOptions = {
  bucket: 'example-bucket',
  region: 'ap-southeast-2',
};

(async () => {
  const result = await push({
    currentWorkingDirectory: 'dist',
    files: './**/*',
    makePublic: true,
    provider: s3FileProvider(providerOptions),
  });

  console.log(result);
})();
```
