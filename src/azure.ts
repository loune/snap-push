import { BlobServiceClient } from '@azure/storage-blob';
import { UploadFileProvider, UploadFile } from './types';

export default function uploadFileFactory(providerOptions): UploadFileProvider {
  const { credential, account, containerName, serviceUrl } = providerOptions;

  if (!containerName) {
    throw new Error('containerName is required for providerOptions');
  }

  if (!serviceUrl && !account) {
    throw new Error('account or serviceUrl is required for providerOptions');
  }

  const blobServiceClient = new BlobServiceClient(serviceUrl || `https://${account}.blob.core.windows.net`, credential);

  const containerClient = blobServiceClient.getContainerClient(containerName);

  return {
    upload: async ({ source, destFileName, contentLength, contentType, md5Hash, metadata, cacheControl }) => {
      const blockBlobClient = containerClient.getBlockBlobClient(destFileName);

      await blockBlobClient.upload(() => source, contentLength, {
        blobHTTPHeaders: {
          blobContentType: contentType,
          blobContentMD5: new Uint8Array(Buffer.from(md5Hash, 'hex')),
          blobCacheControl: cacheControl,
        },
        metadata,
      });
    },
    list: async (prefix: string, includeMetadata: boolean) => {
      const results: UploadFile[] = [];

      const response = containerClient.listBlobsFlat({
        prefix,
        ...(includeMetadata ? { include: ['metadata'] } : {}),
      });

      // eslint-disable-next-line no-await-in-loop
      for await (const blob of response) {
        results.push({
          name: blob.name,
          md5: blob.properties.contentMD5 ? Buffer.from(blob.properties.contentMD5).toString('hex') : null,
          size: blob.properties.contentLength,
          metadata: blob.metadata || {},
        });
      }

      return results;
    },
    delete: async (key: string) => {
      await containerClient.deleteBlob(key);
    },
  };
}
