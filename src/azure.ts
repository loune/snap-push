import { BlobServiceClient } from '@azure/storage-blob';
import { UploadFileProvider, UploadFile } from './types';

export interface AzureProviderOptions {
  credential: any;
  account?: string;
  containerName: string;
  serviceUrl?: string;
}

export default function uploadFileFactory(providerOptions: AzureProviderOptions): UploadFileProvider {
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
    upload: async ({
      source,
      destFileName,
      contentLength,
      contentType,
      md5Hash,
      metadata,
      tags,
      cacheControl,
      contentEncoding,
    }) => {
      const blockBlobClient = containerClient.getBlockBlobClient(destFileName);

      await blockBlobClient.upload(() => source, contentLength, {
        blobHTTPHeaders: {
          blobContentType: contentType,
          blobContentMD5: new Uint8Array(Buffer.from(md5Hash, 'hex')),
          blobCacheControl: cacheControl,
          blobContentEncoding: contentEncoding,
        },
        metadata,
        tags,
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
          md5: blob.properties.contentMD5 ? Buffer.from(blob.properties.contentMD5).toString('hex') : undefined,
          size: blob.properties.contentLength || 0,
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
