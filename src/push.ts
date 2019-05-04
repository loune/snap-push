import mime from 'mime';
import glob from 'fast-glob';
import pLimit from 'p-limit';
import fs from 'fs';
import s3UploadFileFactory from './s3';

export interface PushOptions {
  files: string[];
  metadata?: { [key: string]: string };
  mimeTypes?: { [suffix: string]: string };
  concurrency?: number;
  destPathPrefix?: string;
  provider: 'aws' | 'azure';
  providerOptions: any;
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

function getProviderUpload(provider: PushOptions['provider'], providerOptions) {
  switch (provider) {
    case 'aws':
      return s3UploadFileFactory(providerOptions);
    default:
      break;
  }

  throw new Error(`Unknown provider ${provider}`);
}

export default async function push({
  files,
  concurrency,
  metadata,
  provider,
  providerOptions,
  destPathPrefix,
}: PushOptions): Promise<void> {
  const uploadFile = getProviderUpload(provider, providerOptions);
  const limit = pLimit(concurrency || 1);
  const filesFromGlob = await glob(files);
  await Promise.all(
    filesFromGlob.map(file =>
      limit(async () => {
        const fileName = file as string;
        const type = await getFileMimeType(fileName);
        await uploadFile(fileName, `${destPathPrefix}${fileName}`, type, metadata);
      })
    )
  );
}
