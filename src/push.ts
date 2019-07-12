import glob from 'fast-glob';
import pLimit from 'p-limit';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { UploadFileProvider, UploadFile, AbstractLogger } from './types';
import getFileMimeType from './contentType';

const BUFFER_SIZE = 4 * 1024 * 1024;

export interface PushOptions {
  /** Change the current working directory. Affects the files glob and the upload file name */
  currentWorkingDirectory?: string;
  /** Glob pattern for files */
  files: string[];
  /** Extra metadata to include with each file */
  metadata?: { [key: string]: string } | ((filename: string) => { [key: string]: string });
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

async function getMD5(fileName: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const md5 = crypto.createHash('md5');
    md5.setEncoding('hex');
    const stream = fs.createReadStream(fileName, { highWaterMark: BUFFER_SIZE });
    stream.on('end', () => {
      md5.end();
      resolve(md5.read());
    });
    stream.on('error', err => {
      reject(err);
    });
    stream.pipe(md5);
  });
}

export function pathTrimStart(filePath: string) {
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
  mimeTypes,
  destPathPrefix = '',
  provider,
  cacheControl,
  onlyUploadChanges = true,
  shouldDeleteExtraFiles = false,
  uploadNewFilesFirst = true,
  listIncludeMetadata = false,
  makePublic = false,
  logger = { info() {}, warn() {}, error() {} },
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

  let existingFiles: UploadFile[] = [];
  const existingFilesMap = new Map<string, UploadFile>();
  if (onlyUploadChanges || shouldDeleteExtraFiles || uploadNewFilesFirst) {
    existingFiles = await provider.list(destPathPrefix, listIncludeMetadata);
    existingFiles.forEach(file => {
      existingFilesMap.set(file.name, file);
    });
  }

  if (uploadNewFilesFirst) {
    // sort new files first
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

  await Promise.all(
    filesFromGlob.map(file =>
      limit(async () => {
        const fileName = pathTrimStart(file as string);
        const localFileName = currentWorkingDirectory ? path.join(currentWorkingDirectory, fileName) : fileName;
        const key = `${destPathPrefix}${fileName}`;
        const contentType = (await getFileMimeType(localFileName, mimeTypes)) || defaultContentType;
        const md5Hash = await getMD5(localFileName);
        processedKeys.push(key);
        const existingFile = existingFilesMap.get(key);
        if (onlyUploadChanges && existingFile && existingFile.md5 === md5Hash) {
          // same file
          skippedKeys.push(key);
          logger.info(`Skipped ${key} as there were no changes`);
          return;
        }
        try {
          await uploadFileProvider.upload({
            source: fs.createReadStream(localFileName, { highWaterMark: BUFFER_SIZE }),
            destFileName: key,
            contentType,
            md5Hash,
            metadata: getMetadata ? getMetadata(fileName) : undefined,
            cacheControl: getCacheControl ? getCacheControl(fileName) : undefined,
            makePublic: getMakePublic ? getMakePublic(fileName) : undefined,
          });
          logger.info(`Uploaded ${key} of type ${contentType} hash ${md5Hash}`);
          uploadedFiles.push(fileName);
          uploadedKeys.push(key);
        } catch (err) {
          logger.error(`Failed to upload ${key}: ${err}`);
        }
      })
    )
  );

  const deletedKeys = [];
  if (shouldDeleteExtraFiles) {
    const processedKeysMap = new Map<string, string>();
    processedKeys.forEach(file => {
      processedKeysMap.set(file, file);
    });
    const extraFiles = existingFiles.filter(file => processedKeysMap.get(file.name) === undefined);
    const shouldDeleteExtraFilesFunc =
      typeof shouldDeleteExtraFiles === 'function' ? shouldDeleteExtraFiles : () => shouldDeleteExtraFiles;
    await Promise.all(
      extraFiles.map(file =>
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
