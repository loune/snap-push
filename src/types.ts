import { Readable } from 'stream';

export interface UploadFile {
  name: string;
  md5?: string;
  size: number;
  metadata: { [key: string]: string };
}

export interface UploadArgs {
  source: Readable;
  destFileName: string;
  contentType: string;
  contentLength: number;
  md5Hash: string;
  metadata?: { [key: string]: string };
  cacheControl?: string;
  makePublic?: boolean;
}

// eslint-disable-next-line import/prefer-default-export
export interface UploadFileProvider {
  upload: (args: UploadArgs) => Promise<void>;
  list: (prefix: string, includeMetadata: boolean) => Promise<UploadFile[]>;
  delete: (key: string) => Promise<void>;
}

export interface AbstractLogger {
  info: (...args: any) => void;
  warn: (...args: any) => void;
  error: (...args: any) => void;
}
