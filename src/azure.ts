import {
  Aborter,
  BlobURL,
  BlockBlobURL,
  uploadFileToBlockBlob,
  ContainerURL,
  ServiceURL,
  StorageURL,
} from '@azure/storage-blob';
import { UploadFileProvider } from './types';

export default function uploadFileFactory(providerOptions): UploadFileProvider {
  const { credential, account, containerName, makePublic, serviceUrl, ...otherProviderOptions } = providerOptions;

  if (!containerName) {
    throw new Error('containerName is required for providerOptions');
  }

  const pipeline = StorageURL.newPipeline(credential);

  const serviceURLObj = new ServiceURL(serviceUrl || `https://${account}.blob.core.windows.net`, pipeline);
  const containerURL = ContainerURL.fromServiceURL(serviceURLObj, containerName);

  return async (srcFileName: string, destFileName: string, type: string, metadata: { [key: string]: string }) => {
    const blobURL = BlobURL.fromContainerURL(containerURL, destFileName);
    const blockBlobURL = BlockBlobURL.fromBlobURL(blobURL);

    const uploadBlobResponse = await uploadFileToBlockBlob(Aborter.none, srcFileName, blockBlobURL, {
      blobHTTPHeaders: { blobContentType: type },
      metadata,
    });
  };
}
