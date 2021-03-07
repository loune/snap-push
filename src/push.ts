import glob from 'fast-glob';
import pLimit from 'p-limit';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import zlib from 'zlib';
import { Readable } from 'stream';
import { UploadFileProvider, UploadFile, AbstractLogger } from './types';
import getFileMimeType from './contentType';

const BUFFER_SIZE = 4 * 1024 * 1024;

type SupportedContentEncoding = 'gzip' | 'br';

interface CompressOptions {
  /** file extensions to compress */
  fileExtensions?: string[];
  /** file mime types to compress */
  mimeTypes?: (string | RegExp)[];
  /** Minimum file size to compress (default: 0) */
  minFileSize?: number;
  /** which content-encoding to support */
  encodings: SupportedContentEncoding[];
}

export interface PushOptions {
  /** Change the current working directory. Affects the files glob and the upload file name */
  currentWorkingDirectory?: string;
  /** Glob pattern for files */
  files: string[];
  /** Extra metadata to include with each file */
  metadata?: { [key: string]: string } | ((filename: string) => { [key: string]: string });
  /** Object tags to include (AWS and Azure)  */
  tags?: { [key: string]: string } | ((filename: string) => { [key: string]: string });
  /** Mapping of custom content type to an array of file extensions */
  mimeTypes?: { [contentType: string]: string[] };
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
  /** Delete files in remote that are does not exist locally */
  shouldDeleteExtraFiles?: boolean | ((extraFile: UploadFile) => boolean);
  /** Priorities upload of new files. Useful for website to ensure there are no broken links due to missing files during upload */
  uploadNewFilesFirst?: boolean;
  /** Try to get metadata when listing existing files so it will be available in UploadFile of shouldDeleteExtraFiles */
  listIncludeMetadata?: boolean;
  /** Set file to be publicly accessible */
  makePublic?: boolean | ((filename: string) => boolean);
  /** automtically generate compressed versions of files with certain conditions */
  autoCompress?: CompressOptions | ((fileName: string, fileSize: number, mimeType: string) => SupportedContentEncoding);
  logger?: AbstractLogger;
}

export interface PushResult {
  /** Milliseconds it took to upload */
  elasped: number;
  uploadedFiles: string[];
  uploadedKeys: string[];
  deletedKeys: string[];
  skippedKeys: string[];
}

const encodingExtensionsMap: { [encoding: string]: string } = {
  gzip: 'gz',
  br: 'br',
};

async function getMD5(fileName: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const md5 = crypto.createHash('md5');
    md5.setEncoding('hex');
    const stream = fs.createReadStream(fileName, { highWaterMark: BUFFER_SIZE });
    stream.on('end', () => {
      md5.end();
      resolve(md5.read());
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

function getSourceStream(fileName: string, destFileName: string): { contentEncoding?: string; stream: Readable } {
  if (!fileName.toLowerCase().endsWith('.gz') && destFileName.toLowerCase().endsWith('.gz')) {
    // apply gzip
    const gz = zlib.createGzip();
    const stream = fs.createReadStream(fileName, { highWaterMark: BUFFER_SIZE }).pipe(gz);
    return { contentEncoding: 'gzip', stream };
  }

  if (!fileName.toLowerCase().endsWith('.br') && destFileName.toLowerCase().endsWith('.br')) {
    // apply br
    // brotli check
    if (!zlib.createBrotliCompress) {
      throw new Error('zlib.createBrotliCompress is not supported. Cannot compress with brotli.');
    }

    const br = zlib.createBrotliCompress();
    const stream = fs.createReadStream(fileName, { highWaterMark: BUFFER_SIZE }).pipe(br);
    return { contentEncoding: 'br', stream };
  }

  return { stream: fs.createReadStream(fileName, { highWaterMark: BUFFER_SIZE }) };
}

function getFileEncodings(
  options: CompressOptions | undefined,
  fileName: string,
  fileSize: number,
  fileMime: string
): string[] {
  if (!options) {
    return [fileName];
  }

  if (options.minFileSize && fileSize < options.minFileSize) {
    return [fileName];
  }

  let shouldCompress = false;
  if (options.fileExtensions) {
    shouldCompress = options.fileExtensions.some(
      (ext) => fileName.endsWith(`.${ext}`) || (ext[0] === '.' && fileName.endsWith(ext))
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

  if (shouldCompress) {
    const zippedFiles = options.encodings.map((encoding) => `${fileName}.${encodingExtensionsMap[encoding]}`);
    zippedFiles.push(fileName);
    return zippedFiles;
  }

  return [fileName];
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
  shouldDeleteExtraFiles = false,
  uploadNewFilesFirst = true,
  listIncludeMetadata = false,
  makePublic = false,
  autoCompress,
  logger = { info() {}, warn() {}, error() {} }, // eslint-disable-line @typescript-eslint/no-empty-function
}: PushOptions): Promise<PushResult> {
  const uploadFileProvider = provider;
  const limit = pLimit(concurrency || 1);
  const filesFromGlob = await glob(files, { ...(currentWorkingDirectory ? { cwd: currentWorkingDirectory } : {}) });
  const uploadedFiles: string[] = [];
  const uploadedKeys: string[] = [];
  const skippedKeys: string[] = [];
  const processedKeys: string[] = [];
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
      const keyAExists = existingFilesMap.get(`${destPathPrefix}${pathTrimStart(a as string)}`);
      const keyBExists = existingFilesMap.get(`${destPathPrefix}${pathTrimStart(b as string)}`);
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
        const fileName = pathTrimStart(file);
        const localFileName = currentWorkingDirectory ? path.join(currentWorkingDirectory, fileName) : fileName;
        const destKey = `${destPathPrefix}${fileName}`;
        const contentType = (await getFileMimeType(localFileName, mimeTypes)) || defaultContentType;
        const contentLength = await getSize(localFileName);
        const md5Hash = await getMD5(localFileName);

        const encodedFileKeys =
          typeof autoCompress === 'function'
            ? autoCompress(destKey, contentLength, contentType)
            : getFileEncodings(autoCompress, destKey, contentLength, contentType);

        processedKeys.push(...encodedFileKeys);
        const existingFile = existingFilesMap.get(destKey);
        if (onlyUploadChanges && existingFile && existingFile.md5 === md5Hash) {
          // same file
          skippedKeys.push(destKey);
          logger.info(`Skipped ${destKey} as there were no changes`);
          return;
        }

        for (const key of encodedFileKeys) {
          try {
            const { contentEncoding, stream } = getSourceStream(localFileName, key);
            // eslint-disable-next-line no-await-in-loop
            await uploadFileProvider.upload({
              contentLength,
              source: stream,
              destFileName: key,
              contentType,
              contentEncoding,
              md5Hash,
              metadata: getMetadata ? getMetadata(fileName) : undefined,
              tags: getTags ? getTags(fileName) : undefined,
              cacheControl: getCacheControl ? getCacheControl(fileName) : undefined,
              makePublic: getMakePublic ? getMakePublic(fileName) : undefined,
            });
            logger.info(`Uploaded ${key} of type ${contentType} hash ${md5Hash}`);
            uploadedKeys.push(key);
          } catch (err) {
            logger.error(`Failed to upload ${key}: ${err}`);
          }
        }

        uploadedFiles.push(fileName);
      })
    )
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
            } catch (err) {
              logger.error(`Failed to delete ${file.name}: ${err}`);
            }
          }
        })
      )
    );
  }

  return {
    elasped: Date.now() - startTime,
    uploadedFiles,
    uploadedKeys,
    deletedKeys,
    skippedKeys,
  };
}
