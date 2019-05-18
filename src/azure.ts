import {
  Aborter,
  BlobURL,
  BlockBlobURL,
  ContainerURL,
  ServiceURL,
  StorageURL,
  uploadStreamToBlockBlob,
} from '@azure/storage-blob';
import { Readable } from 'stream';
import { UploadFileProvider } from './types';

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

  return async (source: Readable, destFileName: string, contentType: string, metadata: { [key: string]: string }) => {
    const blobURL = BlobURL.fromContainerURL(containerURL, destFileName);
    const blockBlobURL = BlockBlobURL.fromBlobURL(blobURL);

    await uploadStreamToBlockBlob(Aborter.none, source, blockBlobURL, BUFFER_SIZE, MAX_BUFFER, {
      blobHTTPHeaders: { blobContentType: contentType },
      metadata,
    });
  };
}
