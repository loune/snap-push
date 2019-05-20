import { Readable } from 'stream';

export interface UploadFile {
  name: string;
  md5: string;
  size: number;
}

// eslint-disable-next-line import/prefer-default-export
export interface UploadFileProvider {
  upload: (
    source: Readable,
    destFileName: string,
    contentType: string,
    md5: string,
    metadata: { [key: string]: string }
  ) => Promise<void>;
  list: (prefix: string) => Promise<UploadFile[]>;
}
