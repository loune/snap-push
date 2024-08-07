import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import zlib from 'zlib';
import { Readable } from 'stream';
import pLimit from 'p-limit';
import glob from 'fast-glob';
import { UploadFileProvider, UploadFile, AbstractLogger } from './types.js';
import getFileMimeType from './contentType.js';
import dryRunProvider from './dryrun.js';

const BUFFER_SIZE = 4 * 1024 * 1024;

export type SupportedContentEncoding = 'raw' | 'gzip' | 'br';

/** Options for the content encoding. */
export interface EncodingOptions {
  /** File extensions to compress. */
  fileExtensions?: string[];
  /** File mime types to compress. */
  mimeTypes?: (string | RegExp)[];
  /** Minimum file size to compress. (default: 0) */
  minFileSize?: number;
  /** Which content encoding to apply to files which match the criteria. */
  contentEncodings: SupportedContentEncoding[];
}

/** Options for the push function. */
export interface PushOptions {
  /** Change the current working directory. Affects the files glob and the upload file name */
  currentWorkingDirectory?: string;
  /** Glob pattern for files */
  files: string[];
  /** Extra metadata to include with each file */
  metadata?: Record<string, string> | ((filename: string) => Record<string, string>);
  /** Object tags to include (AWS and Azure)  */
  tags?: Record<string, string> | ((filename: string) => Record<string, string>);
  /** Mapping of custom content type to an array of file extensions */
  mimeTypes?: Record<string, string[]>;
  /** Maximum number of concurrent upload and list API requests */
  concurrency?: number;
  /** A path prefix to prepend to the upload file name */
  destPathPrefix?: string;
  /** The storage provider to use */
  provider: UploadFileProvider;
  /** Set the cache control header */
  cacheControl?: string | ((filename: string) => string);
  /** Use the MD5 checksum to determine whether the file has changed */
  onlyUploadChanges?: boolean;
  /** Delete files in remote that does not exist locally */
  shouldDeleteExtraFiles?: boolean | ((extraFile: UploadFile) => boolean);
  /** Function to determine whether file should be uploaded or skipped/ignored. All files in the `files` pattern array are uploaded by default. */
  ignoreFile?: (filename: string) => boolean;
  /** Function to replace uploading of a local file with another local file, but keep the original name. If undefined, don't do substitution. */
  substituteFile?: (filename: string) => string | undefined;
  /** Priorities upload of new files. Useful for website to ensure there are no broken links due to missing files during upload */
  uploadNewFilesFirst?: boolean;
  /** Try to get metadata when listing existing files so it will be available in UploadFile of shouldDeleteExtraFiles */
  listIncludeMetadata?: boolean;
  /** Set file to be publicly accessible */
  makePublic?: boolean | ((filename: string) => boolean);
  /** automtically generate compressed versions of files with certain conditions */
  encoding?:
    | EncodingOptions
    | ((
        fileName: string,
        fileSize: number,
        mimeType: string,
      ) => { destFileName: string; encoding: SupportedContentEncoding }[] | undefined);
  /** If dryRun, then pretend to upload but don't actually do it. */
  dryRun?: boolean;
  /** Logger instance to use */
  logger?: AbstractLogger;
}

/** Result of the push function. */
export interface PushResult {
  /** Milliseconds it took to upload. */
  elasped: number;
  /** Source file names that were uploaded. */
  uploadedFiles: string[];
  /** Uploaded destination keys. */
  uploadedKeys: string[];
  /** Deleted keys at the destination. */
  deletedKeys: string[];
  /** Skipped upload for unchanged keys at the destination. */
  skippedKeys: string[];
  /** Destination keys which failed to be uploaded or deleted. */
  errorKeys: string[];
}

const encodingExtensionsMap: Record<string, string> = {
  raw: '',
  gzip: '.gz',
  br: '.br',
};

async function getMD5(fileName: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const md5 = crypto.createHash('md5');
    md5.setEncoding('hex');
    const stream = fs.createReadStream(fileName, { highWaterMark: BUFFER_SIZE });
    stream.on('end', () => {
      md5.end();
      resolve(md5.read() as string);
    });
    stream.on('error', (err) => {
      reject(err);
    });
    stream.pipe(md5);
  });
}

async function getSize(fileName: string): Promise<number> {
  return new Promise((resolve, reject) => {
    fs.stat(fileName, (err, stat) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(stat.size);
    });
  });
}

function getSourceStream(fileName: string, encoding: SupportedContentEncoding): Readable {
  if (encoding === 'gzip') {
    // apply gzip
    const gz = zlib.createGzip();
    const stream = fs.createReadStream(fileName, { highWaterMark: BUFFER_SIZE }).pipe(gz);
    return stream;
  }

  if (encoding === 'br') {
    // apply br
    // brotli check
    if (!zlib.createBrotliCompress) {
      throw new Error('zlib.createBrotliCompress is not supported. Cannot compress with brotli.');
    }

    const br = zlib.createBrotliCompress();
    const stream = fs.createReadStream(fileName, { highWaterMark: BUFFER_SIZE }).pipe(br);
    return stream;
  }

  return fs.createReadStream(fileName, { highWaterMark: BUFFER_SIZE });
}

function getFileEncodings(
  options: EncodingOptions | undefined,
  fileName: string,
  fileSize: number,
  fileMime: string,
): SupportedContentEncoding[] {
  if (!options) {
    return ['raw'];
  }

  if (options.minFileSize && fileSize < options.minFileSize) {
    return ['raw'];
  }

  let shouldCompress = false;
  if (options.fileExtensions) {
    shouldCompress = options.fileExtensions.some(
      (ext) => (ext.startsWith('.') && fileName.endsWith(ext)) || fileName.endsWith(`.${ext}`),
    );
  }

  if (!shouldCompress && options.mimeTypes) {
    shouldCompress = options.mimeTypes.some((mimeType) => {
      if (typeof mimeType === 'string') {
        return mimeType === fileMime;
      }

      return mimeType.test(fileMime);
    });
  }

  if (!shouldCompress) {
    return ['raw'];
  }

  return options.contentEncodings;
}

function getFileEncodingKeys(
  fileName: string,
  encodings: SupportedContentEncoding[],
): { destFileName: string; encoding: SupportedContentEncoding }[] {
  const zippedFiles = encodings.map((encoding) => ({
    destFileName: `${fileName}${encodingExtensionsMap[encoding]}`,
    encoding,
  }));
  return zippedFiles;
}

export function pathTrimStart(filePath: string): string {
  if (filePath.startsWith('./')) {
    filePath = filePath.substring(2);
  }
  if (filePath.startsWith('/')) {
    filePath = filePath.substring(1);
  }
  return filePath;
}

/**
 * Upload files
 * @param options - Push options
 * @returns Push result
 * */
export default async function push({
  currentWorkingDirectory,
  files,
  concurrency,
  metadata,
  tags,
  mimeTypes,
  destPathPrefix = '',
  provider,
  cacheControl,
  onlyUploadChanges = true,
  ignoreFile,
  substituteFile,
  shouldDeleteExtraFiles = false,
  uploadNewFilesFirst = true,
  listIncludeMetadata = false,
  makePublic = false,
  encoding: encodingOption,
  dryRun = false,
  logger = { info() {}, warn() {}, error() {} }, // eslint-disable-line @typescript-eslint/no-empty-function
}: PushOptions): Promise<PushResult> {
  const uploadFileProvider = dryRun ? dryRunProvider({ logger, realProvider: provider }) : provider;
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
  const limit = pLimit(concurrency || 1);
  const filesFromGlob = await glob(files, { ...(currentWorkingDirectory ? { cwd: currentWorkingDirectory } : {}) });
  const uploadedFiles: string[] = [];
  const uploadedKeys: string[] = [];
  const skippedKeys: string[] = [];
  const processedKeys: string[] = [];
  const errorKeys: string[] = [];
  const startTime = Date.now();
  const defaultContentType = 'application/octet-stream';
  const getMetadata = typeof metadata === 'function' ? metadata : () => metadata;
  const getCacheControl = typeof cacheControl === 'function' ? cacheControl : () => cacheControl;
  const getMakePublic = typeof makePublic === 'function' ? makePublic : () => makePublic;
  const getTags = typeof tags === 'function' ? tags : () => tags;

  let existingFiles: UploadFile[] = [];
  const existingFilesMap = new Map<string, UploadFile>();
  if (onlyUploadChanges || shouldDeleteExtraFiles || uploadNewFilesFirst) {
    existingFiles = await provider.list(destPathPrefix, listIncludeMetadata);
    existingFiles.forEach((file) => {
      existingFilesMap.set(file.name, file);
    });
  }

  if (uploadNewFilesFirst) {
    // sort new files to be uploaded first
    filesFromGlob.sort((a, b) => {
      const keyAExists = existingFilesMap.get(`${destPathPrefix}${pathTrimStart(a)}`);
      const keyBExists = existingFilesMap.get(`${destPathPrefix}${pathTrimStart(b)}`);
      if (keyAExists && !keyBExists) {
        return -1;
      }
      if (!keyAExists && keyBExists) {
        return 1;
      }
      return 0;
    });
  }

  // parallel upload files
  await Promise.all(
    filesFromGlob.map((file) =>
      limit(async () => {
        let fileName = pathTrimStart(file);

        if (ignoreFile?.(fileName)) {
          return;
        }

        const destKey = `${destPathPrefix}${fileName}`;

        const replacementFileName = substituteFile?.(fileName);
        if (replacementFileName !== undefined) {
          fileName = replacementFileName;
        }

        const localFileName = currentWorkingDirectory ? path.join(currentWorkingDirectory, fileName) : fileName;
        const contentType = (await getFileMimeType(localFileName, mimeTypes)) ?? defaultContentType;
        const contentLength = await getSize(localFileName);
        const md5Hash = await getMD5(localFileName);

        let encodedFileMap =
          typeof encodingOption === 'function'
            ? encodingOption(destKey, contentLength, contentType)
            : getFileEncodingKeys(destKey, getFileEncodings(encodingOption, destKey, contentLength, contentType));

        if (encodedFileMap === undefined) {
          encodedFileMap = getFileEncodingKeys(destKey, ['raw']);
        }

        processedKeys.push(...encodedFileMap.map((fileNameEnc) => fileNameEnc.destFileName));
        const existingFile = existingFilesMap.get(destKey);
        if (onlyUploadChanges && existingFile && existingFile.md5 === md5Hash) {
          // same file
          skippedKeys.push(destKey);
          logger.info(`Skipped ${destKey} as there were no changes`);
          return;
        }

        for (const fileNameEnc of encodedFileMap) {
          try {
            const stream = getSourceStream(localFileName, fileNameEnc.encoding);
            const contentEncoding = fileNameEnc.encoding === 'raw' ? undefined : fileNameEnc.encoding;

            await uploadFileProvider.upload({
              contentLength,
              source: stream,
              destFileName: fileNameEnc.destFileName,
              contentType,
              contentEncoding,
              md5Hash,
              metadata: getMetadata ? getMetadata(fileName) : undefined,
              tags: getTags ? getTags(fileName) : undefined,
              cacheControl: getCacheControl ? getCacheControl(fileName) : undefined,
              makePublic: getMakePublic ? getMakePublic(fileName) : undefined,
            });
            logger.info(`Uploaded ${fileNameEnc.destFileName} of type ${contentType} hash ${md5Hash}`);
            uploadedKeys.push(fileNameEnc.destFileName);
          } catch (err: any) {
            logger.error(`Failed to upload ${fileNameEnc.destFileName}: ${err}`);
            errorKeys.push(fileNameEnc.destFileName);
          }
        }

        uploadedFiles.push(fileName);
      }),
    ),
  );

  const deletedKeys: string[] = [];
  if (shouldDeleteExtraFiles) {
    const processedKeysMap = new Map<string, boolean>();
    processedKeys.forEach((file) => {
      processedKeysMap.set(file, true);
    });
    const extraFiles = existingFiles.filter((file) => processedKeysMap.get(file.name) === undefined);
    const shouldDeleteExtraFilesFunc =
      typeof shouldDeleteExtraFiles === 'function' ? shouldDeleteExtraFiles : () => shouldDeleteExtraFiles;
    await Promise.all(
      extraFiles.map((file) =>
        limit(async () => {
          if (shouldDeleteExtraFilesFunc(file)) {
            try {
              await uploadFileProvider.delete(file.name);
              logger.info(`Deleted ${file.name} as it no longer exists in source`);
              deletedKeys.push(file.name);
            } catch (err: any) {
              logger.error(`Failed to delete ${file.name}: ${err}`);
              errorKeys.push(file.name);
            }
          }
        }),
      ),
    );
  }

  return {
    elasped: Date.now() - startTime,
    uploadedFiles,
    uploadedKeys,
    deletedKeys,
    skippedKeys,
    errorKeys,
  };
}
