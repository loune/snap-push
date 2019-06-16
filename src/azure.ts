import {
  Aborter,
  BlobURL,
  BlockBlobURL,
  ContainerURL,
  ServiceURL,
  StorageURL,
  uploadStreamToBlockBlob,
} from '@azure/storage-blob';
import { UploadFileProvider, UploadFile } from './types';

const BUFFER_SIZE = 4 * 1024 * 1024;
const MAX_BUFFER = 5;

export default function uploadFileFactory(providerOptions): UploadFileProvider {
  const { credential, account, containerName, serviceUrl } = providerOptions;

  if (!containerName) {
    throw new Error('containerName is required for providerOptions');
  }

  const pipeline = StorageURL.newPipeline(credential);

  const serviceURLObj = new ServiceURL(serviceUrl || `https://${account}.blob.core.windows.net`, pipeline);
  const containerURL = ContainerURL.fromServiceURL(serviceURLObj, containerName);

  return {
    upload: async ({ source, destFileName, contentType, md5Hash, metadata, cacheControl }) => {
      const blobURL = BlobURL.fromContainerURL(containerURL, destFileName);
      const blockBlobURL = BlockBlobURL.fromBlobURL(blobURL);

      await uploadStreamToBlockBlob(Aborter.none, source, blockBlobURL, BUFFER_SIZE, MAX_BUFFER, {
        blobHTTPHeaders: {
          blobContentType: contentType,
          blobContentMD5: new Uint8Array(Buffer.from(md5Hash, 'hex')),
          blobCacheControl: cacheControl,
        },
        metadata,
      });
    },
    list: async (prefix: string, includeMetadata: boolean) => {
      let marker: string;
      const results: UploadFile[] = [];

      do {
        // eslint-disable-next-line no-await-in-loop
        const response = await containerURL.listBlobFlatSegment(Aborter.none, marker, {
          prefix,
          ...(includeMetadata ? { include: ['metadata'] } : {}),
        });
        marker = response.nextMarker;
        response.segment.blobItems
          .map(x => ({
            name: x.name,
            md5: x.properties.contentMD5 ? Buffer.from(x.properties.contentMD5).toString('hex') : null,
            size: x.properties.contentLength,
            metadata: x.metadata || {},
          }))
          .forEach(x => results.push(x));
      } while (marker);
      return results;
    },
    delete: async (key: string) => {
      const blobURL = BlobURL.fromContainerURL(containerURL, key);
      const blockBlobURL = BlockBlobURL.fromBlobURL(blobURL);
      await blockBlobURL.delete(Aborter.none);
    },
  };
}
