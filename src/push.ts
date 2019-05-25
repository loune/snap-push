import glob from 'fast-glob';
import pLimit from 'p-limit';
import fs from 'fs';
import crypto from 'crypto';
import { UploadFileProvider } from './types';
import getFileMimeType from './contentType';

const BUFFER_SIZE = 4 * 1024 * 1024;

export interface PushOptions {
  files: string[];
  metadata?: { [key: string]: string };
  mimeTypes?: { [suffix: string]: string };
  concurrency?: number;
  destPathPrefix?: string;
  provider: UploadFileProvider;
  cacheControl?: string | ((filename: string) => string);
}

export interface PushResult {
  /** Milliseconds it took to upload */
  elasped: number;
  uploadedFiles: string[];
  uploadedKeys: string[];
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
  files,
  concurrency,
  metadata,
  destPathPrefix,
  provider,
  cacheControl,
}: PushOptions): Promise<PushResult> {
  const uploadFileProvider = provider;
  const limit = pLimit(concurrency || 1);
  const filesFromGlob = await glob(files);
  const uploadedFiles = [];
  const uploadedKeys = [];
  const startTime = Date.now();
  const defaultContentType = 'application/octet-stream';
  const getCacheControl = typeof cacheControl === 'string' ? () => cacheControl : cacheControl;

  await Promise.all(
    filesFromGlob.map(file =>
      limit(async () => {
        const fileName = pathTrimStart(file as string);
        const contentType = (await getFileMimeType(fileName)) || defaultContentType;
        const key = `${destPathPrefix}${fileName}`;
        const md5Hash = await getMD5(fileName);
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

  return {
    elasped: Date.now() - startTime,
    uploadedFiles,
    uploadedKeys,
  };
}
