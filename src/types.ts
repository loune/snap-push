import { Readable } from 'stream';

export interface UploadFile {
  name: string;
  md5?: string;
  size: number;
  metadata: Record<string, string | number | boolean | null>;
}

export interface UploadArgs {
  source: Readable;
  destFileName: string;
  contentType: string;
  contentLength: number;
  contentEncoding?: string;
  md5Hash: string;
  metadata?: Record<string, string>;
  tags?: Record<string, string>;
  cacheControl?: string;
  makePublic?: boolean;
}

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
