import { Readable } from 'stream';

// eslint-disable-next-line import/prefer-default-export
export type UploadFileProvider = (
  source: Readable,
  destFileName: string,
  contentType: string,
  metadata: { [key: string]: string }
) => Promise<void>;
