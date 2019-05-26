import glob from 'fast-glob';
import pLimit from 'p-limit';
import fs from 'fs';
import crypto from 'crypto';
import { UploadFileProvider, UploadFile } from './types';
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
  shouldDeleteExtraFiles?: string | ((extraFile: UploadFile) => boolean);
  uploadNewFilesFirst?: boolean;
}

export interface PushResult {
  /** Milliseconds it took to upload */
  elasped: number;
  uploadedFiles: string[];
  uploadedKeys: string[];
  deletedKeys: string[];
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

export function pathTrimStart(path: string) {
  if (path.startsWith('./')) {
    path = path.substring(2);
  }
  if (path.startsWith('/')) {
    path = path.substring(1);
  }
  return path;
}

export default async function push({
  currentWorkingDirectory,
  files,
  concurrency,
  metadata,
  destPathPrefix,
  provider,
  cacheControl,
  onlyUploadChanges,
  shouldDeleteExtraFiles,
}: PushOptions): Promise<PushResult> {
  const uploadFileProvider = provider;
  const limit = pLimit(concurrency || 1);
  const filesFromGlob = await glob(files, { ...(currentWorkingDirectory ? { cwd: currentWorkingDirectory } : {}) });
  const uploadedFiles: string[] = [];
  const uploadedKeys: string[] = [];
  const processedKeys: string[] = [];
  const startTime = Date.now();
  const defaultContentType = 'application/octet-stream';
  const getCacheControl = typeof cacheControl === 'string' ? () => cacheControl : cacheControl;
  let existingFiles: UploadFile[] = [];
  const existingFilesMap = new Map<string, UploadFile>();
  if (onlyUploadChanges || shouldDeleteExtraFiles) {
    existingFiles = await provider.list(destPathPrefix);
    existingFiles.forEach(file => {
      existingFilesMap[file.name] = file;
    });
  }

  await Promise.all(
    filesFromGlob.map(file =>
      limit(async () => {
        const fileName = pathTrimStart(file as string);
        const contentType = (await getFileMimeType(fileName)) || defaultContentType;
        const key = `${destPathPrefix}${fileName}`;
        const md5Hash = await getMD5(fileName);
        processedKeys.push(key);
        const existingFile = existingFilesMap.get(key);
        if (existingFile && existingFile.md5 === md5Hash) {
          // same file
          return;
        }
        await uploadFileProvider.upload({
          source: fs.createReadStream(fileName, { highWaterMark: BUFFER_SIZE }),
          destFileName: key,
          contentType,
          md5Hash,
          metadata,
          cacheControl: getCacheControl ? getCacheControl(fileName) : undefined,
        });
        uploadedFiles.push(fileName);
        uploadedKeys.push(key);
      })
    )
  );

  const deletedKeys = [];
  if (shouldDeleteExtraFiles) {
    const processedKeysMap = new Map<string, UploadFile>();
    processedKeys.forEach(file => {
      processedKeysMap[file] = file;
    });
    const extraFiles = existingFiles.filter(file => processedKeysMap.get(file.name) === undefined);
    const shouldDeleteExtraFilesFunc =
      typeof shouldDeleteExtraFiles === 'function' ? shouldDeleteExtraFiles : () => shouldDeleteExtraFiles;
    await Promise.all(
      extraFiles.map(file =>
        limit(async () => {
          if (shouldDeleteExtraFilesFunc(file)) {
            await uploadFileProvider.delete(file.name);
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
  };
}
