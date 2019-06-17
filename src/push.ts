import glob from 'fast-glob';
import pLimit from 'p-limit';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { UploadFileProvider, UploadFile, AbstractLogger } from './types';
import getFileMimeType from './contentType';

const BUFFER_SIZE = 4 * 1024 * 1024;

export interface PushOptions {
  currentWorkingDirectory?: string;
  files: string[];
  metadata?: { [key: string]: string };
  mimeTypes?: { [suffix: string]: string };
  concurrency?: number;
  destPathPrefix?: string;
  provider: UploadFileProvider;
  cacheControl?: string | ((filename: string) => string);
  onlyUploadChanges?: boolean;
  shouldDeleteExtraFiles?: boolean | ((extraFile: UploadFile) => boolean);
  uploadNewFilesFirst?: boolean;
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
  const getCacheControl = typeof cacheControl === 'string' ? () => cacheControl : cacheControl;
  const getMakePublic = typeof makePublic === 'boolean' ? () => makePublic : makePublic;
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
        const contentType = (await getFileMimeType(localFileName)) || defaultContentType;
        const md5Hash = await getMD5(localFileName);
        processedKeys.push(key);
        const existingFile = existingFilesMap.get(key);
        if (onlyUploadChanges && existingFile && existingFile.md5 === md5Hash) {
          // same file
          skippedKeys.push(key);
          logger.info(`Skipped ${key} as there were no changes`);
          return;
        }
        await uploadFileProvider.upload({
          source: fs.createReadStream(localFileName, { highWaterMark: BUFFER_SIZE }),
          destFileName: key,
          contentType,
          md5Hash,
          metadata,
          cacheControl: getCacheControl ? getCacheControl(fileName) : undefined,
          makePublic: getMakePublic ? getMakePublic(fileName) : undefined,
        });
        logger.info(`Uploaded ${key} of type ${contentType} hash ${md5Hash}`);
        uploadedFiles.push(fileName);
        uploadedKeys.push(key);
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
            await uploadFileProvider.delete(file.name);
            logger.info(`Deleted ${file.name} as it no longer exists in source`);
            deletedKeys.push(file.name);
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
