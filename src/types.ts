import { Readable } from 'stream';

export interface UploadFile {
  name: string;
  md5: string;
  size: number;
}

export interface UploadArgs {
  source: Readable;
  destFileName: string;
  contentType: string;
  md5Hash: string;
  metadata?: { [key: string]: string };
  cacheControl?: string;
}

// eslint-disable-next-line import/prefer-default-export
export interface UploadFileProvider {
  upload: (args: UploadArgs) => Promise<void>;
  list: (prefix: string) => Promise<UploadFile[]>;
  delete: (key: string) => Promise<void>;
}

export interface AbstractLogger {
  info: (...args) => void;
  warn: (...args) => void;
  error: (...args) => void;
}
