// eslint-disable-next-line import/prefer-default-export
export type UploadFileProvider = (
  srcFileName: string,
  destFileName: string,
  contentType: string,
  metadata: { [key: string]: string }
) => Promise<void>;
