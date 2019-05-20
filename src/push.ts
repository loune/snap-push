import mime from 'mime';
import glob from 'fast-glob';
import pLimit from 'p-limit';
import fs from 'fs';
import crypto from 'crypto';
import { UploadFileProvider } from './types';

const BUFFER_SIZE = 4 * 1024 * 1024;

export interface PushOptions {
  files: string[];
  metadata?: { [key: string]: string };
  mimeTypes?: { [suffix: string]: string };
  concurrency?: number;
  destPathPrefix?: string;
  provider: UploadFileProvider;
}

export interface PushResult {
  /** Milliseconds it took to upload */
  elasped: number;
  uploadedFiles: string[];
  uploadedKeys: string[];
}

async function readChars(filename: string, numOfChars: number): Promise<string> {
  const buf = [];
  let bufLen = 0;
  return new Promise(
    (resolve, reject): void => {
      const rs = fs.createReadStream(filename, { encoding: 'utf8' });
      rs.on('data', chunk => {
        buf.push(chunk);
        bufLen += chunk.length;
        if (bufLen >= numOfChars) {
          rs.close();
        }
      })
        .on('close', () => {
          const str = buf.join('');
          resolve(str.substring(0, Math.min(str.length, numOfChars)));
        })
        .on('error', err => {
          reject(err);
        });
    }
  );
}

async function getFileMimeType(filename: string): Promise<string> {
  let type = mime.getType(filename);
  if (type === null) {
    const chars = await readChars(filename, 200);
    if (chars.toLowerCase().indexOf('<html>')) {
      type = mime.getType('.html');
    }
  }

  return type;
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
  provider,
  destPathPrefix,
}: PushOptions): Promise<PushResult> {
  const uploadFileProvider = provider;
  const limit = pLimit(concurrency || 1);
  const filesFromGlob = await glob(files);
  const uploadedFiles = [];
  const uploadedKeys = [];
  const startTime = Date.now();

  await Promise.all(
    filesFromGlob.map(file =>
      limit(async () => {
        const fileName = pathTrimStart(file as string);
        const type = await getFileMimeType(fileName);
        const key = `${destPathPrefix}${fileName}`;
        const hash = await getMD5(fileName);
        await uploadFileProvider.upload(
          fs.createReadStream(fileName, { highWaterMark: BUFFER_SIZE }),
          key,
          type,
          hash,
          metadata
        );
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
