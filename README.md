# snap-push - Upload static website files to the cloud

## Highlights

- Upload with support for:
  - Amazon S3
  - Azure
  - Google Cloud Storage
  - MinIO
- Automatically detect and set correct `Content-Type` for uploaded files.
- Create `gzip` and `br` compressed versions of uploaded file and set the appropriate `Content-Encoding`.
- Set custom `Cache-Control`.
- Concurrent uploads.
- Only upload changed files.
- Remove files that were deleted locally.
- Prioritise upload of new files first.
- Dry Run / Pretend mode

## Installation

### For Amazon S3

```bash
yarn add snap-push @aws-sdk/client-s3 @aws-sdk/lib-storage
```

or use npm

```bash
npm install snap-push @aws-sdk/client-s3 @aws-sdk/lib-storage
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
$ cd dist && ../node_modules/.bin/snap-push './**/*' s3://example-bucket --public
```

### Using the Library with S3

CommonJS require

```js
const push = require('snap-push').default;
const s3FileProvider = require('snap-push/s3').default;
```

ES Modules import

```js
import push from 'snap-push';
import s3FileProvider from 'snap-push/s3';
```

Code

```js
const providerOptions = {
  bucket: 'example-bucket',
  region: 'ap-southeast-2',
};

(async () => {
  const result = await push({
    currentWorkingDirectory: 'directory-to-upload',
    files: './**/*',
    makePublic: true,
    provider: s3FileProvider(providerOptions),
  });

  console.log(result);
})();
```

### Using the Library with Azure

CommonJS require

```js
const push = require('snap-push').default;
const azureFileProvider = require('snap-push/azure').default;
```

ES Modules import

```js
import push from 'snap-push';
import azureFileProvider from 'snap-push/azure';
```

Code

```typescript
const providerOptions: AzureProviderOptions = {
  credential: new StorageSharedKeyCredential(
    'my-account-name',
    'my-account-key'
  ),
  serviceUrl: `https://myaccount.blob.core.windows.net/`,
  containerName: `my-test-container`,
};

(async () => {
  const result = await push({
    currentWorkingDirectory: 'directory-to-upload',
    files: './**/*',
    makePublic: true,
    provider: azureFileProvider(providerOptions),
  });

  console.log(result);
})();
```

### Using the Library with Google Cloud Storage

CommonJS require

```js
const push = require('snap-push').default;
const gcpFileProvider = require('snap-push/gcp').default;
```

ES Modules import

```js
import push from 'snap-push';
import gcpFileProvider from 'snap-push/gcp';
```

Code

```js
const providerOptions = {
  bucket: 'example-bucket'
};

(async () => {
  const result = await push({
    currentWorkingDirectory: 'directory-to-upload',
    files: './**/*',
    makePublic: true,
    provider: gcpFileProvider(providerOptions),
  });

  console.log(result);
})();
```

### Using the Library with Cloudflare R2

CommonJS require

```js
const push = require('snap-push').default;
const s3FileProvider = require('snap-push/s3').default;
```

ES Modules import

```js
import push from 'snap-push';
import s3FileProvider from 'snap-push/s3';
```

Code

```js
const providerOptions = {
  bucket: 'example-bucket',
  region: 'auto',
  endpoint: `https://my-region-endpoint.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: 'my-account-key',
    secretAccessKey: 'my-secret-access-key',
  },
};

(async () => {
  const result = await push({
    currentWorkingDirectory: 'directory-to-upload',
    files: './**/*',
    makePublic: true,
    provider: s3FileProvider(providerOptions),
  });

  console.log(result);
})();
```

### Auto compression

Files uploaded with specific `fileExtensions` or `mimeTypes` could be automatically compressed with `br` (Brotli) and/or `gzip` (GZip) using the `encoding` option. This is useful when used in conjuction with a CDN with rules to route requests with the appropriate `Accept-Encoding` to the compressed copy.

#### Examples

Encode files with `.txt` or `.html` file name extensions or mime/content-type containing `text` or `xml`, with `raw` (orginal, no encoding), `br` (brotli) and `gz` (gzip) encodings. `raw` will have the original file name. `br` will have a the original file name appended with `.br`, and `gzip` original appended with `.gz`.

```js
const result = await push({
  currentWorkingDirectory: 'dist',
  files: './**/*',
  makePublic: true,
  encoding: {
    fileExtensions: ['txt', 'html'],
    mimeTypes: [/text/, /xml/],
    contentEncodings: ['raw', 'br', 'gzip'],
  },
  provider: s3FileProvider(providerOptions),
});
```

Encode files with `gzip` using the original file name.

```js
const result = await push({
  currentWorkingDirectory: 'dist',
  files: './**/*',
  makePublic: true,
  encoding: (fileName) => {
    return [
      {
        destFileName: fileName,
        encoding: 'gzip',
      },
    ];
  },
  provider: s3FileProvider(providerOptions),
});
```
