import fs from 'fs';

const standardContentTypeExtMap = new Map<string, string[]>([
  // keep this list sorted to avoid duplicates
  ['application/epub+zip', ['epub']],
  ['application/gzip', ['gz']],
  ['application/java-archive', ['jar']],
  ['application/json', ['json']],
  ['application/ld+json', ['jsonld']],
  ['application/msword', ['doc']],
  ['application/octet-stream', ['bin']],
  ['application/ogg', ['ogx']],
  ['application/pdf', ['pdf']],
  ['application/rtf', ['rtf']],
  ['application/vnd.amazon.ebook', ['azw']],
  ['application/vnd.apple.installer+xml', ['mpkg']],
  ['application/vnd.mozilla.xul+xml', ['xul']],
  ['application/vnd.ms-excel', ['xls']],
  ['application/vnd.ms-fontobject', ['eot']],
  ['application/vnd.ms-powerpoint', ['ppt']],
  ['application/vnd.oasis.opendocument.presentation', ['odp']],
  ['application/vnd.oasis.opendocument.spreadsheet', ['ods']],
  ['application/vnd.oasis.opendocument.text', ['odt']],
  ['application/vnd.openxmlformats-officedocument.presentationml.presentation', ['pptx']],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ['xlsx']],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', ['docx']],
  ['application/vnd.rar', ['rar']],
  ['application/vnd.visio', ['vsd']],
  ['application/x-7z-compressed', ['7z']],
  ['application/x-abiword', ['abw']],
  ['application/x-bzip', ['bz']],
  ['application/x-bzip2', ['bz2']],
  ['application/x-cdf', ['cda']],
  ['application/x-csh', ['csh']],
  ['application/x-freearc', ['arc']],
  ['application/x-httpd-php', ['php']],
  ['application/x-sh', ['sh']],
  ['application/x-tar', ['tar']],
  ['application/xhtml+xml', ['xhtml']],
  ['application/xml', ['xml']],
  ['application/zip', ['zip']],
  ['audio/aac', ['aac']],
  ['audio/midi', ['mid', 'midi']],
  ['audio/mpeg', ['mp3']],
  ['audio/ogg', ['oga']],
  ['audio/opus', ['opus']],
  ['audio/wav', ['wav']],
  ['audio/webm', ['weba']],
  ['audio/x-midi', ['mid', 'midi']],
  ['font/otf', ['otf']],
  ['font/ttf', ['ttf']],
  ['font/woff', ['woff']],
  ['font/woff2', ['woff2']],
  ['image/avif', ['avif']],
  ['image/bmp', ['bmp']],
  ['image/gif', ['gif']],
  ['image/jpeg', ['jpeg', 'jpg']],
  ['image/png', ['png']],
  ['image/svg+xml', ['svg']],
  ['image/tiff', ['tif', 'tiff']],
  ['image/vnd.microsoft.icon', ['ico']],
  ['image/webp', ['webp']],
  ['text/calendar', ['ics']],
  ['text/css', ['css']],
  ['text/csv', ['csv']],
  ['text/html', ['htm', 'html']],
  ['text/javascript', ['js', 'mjs']],
  ['text/plain', ['txt']],
  ['text/xml', ['xml']],
  ['video/3gpp', ['3gp']],
  ['video/3gpp2', ['3g2']],
  ['video/mp2t', ['ts']],
  ['video/mp4', ['mp4']],
  ['video/mpeg', ['mpeg']],
  ['video/ogg', ['ogv']],
  ['video/webm', ['webm']],
  ['video/x-msvideo', ['avi']],
]);

function reverseMap(contentTypeExtMap: Map<string, string[]> | Record<string, string[]>): Map<string, string[]> {
  const newMap = new Map<string, string[]>();
  const entries = contentTypeExtMap instanceof Map ? contentTypeExtMap.entries() : Object.entries(contentTypeExtMap);
  for (const entry of entries) {
    for (const key of entry[1]) {
      let values = newMap.get(key);
      if (!values) {
        values = [];
        newMap.set(key, values);
      }

      values.push(entry[0]);
    }
  }

  return newMap;
}

const standardExtContentTypeMap = reverseMap(standardContentTypeExtMap);

async function readChars(filename: string, numOfChars: number): Promise<string> {
  const buf: (Buffer | string)[] = [];
  let bufLen = 0;
  return new Promise((resolve, reject): void => {
    const rs = fs.createReadStream(filename, { encoding: 'utf8' });
    rs.on('data', (chunk) => {
      buf.push(chunk);
      bufLen += chunk.length;
      if (bufLen >= numOfChars) {
        rs.close();
      }
    })
      .on('close', () => {
        const str = buf.join('');
        resolve(str.substring(0, Math.min(str.length, numOfChars)));
      })
      .on('error', (err) => {
        reject(err);
      });
  });
}

export default async function getFileMimeType(
  filename: string,
  customMimeTypes?: Record<string, string[]> | undefined,
): Promise<string | undefined> {
  const extension = filename.substring(filename.lastIndexOf('.') + 1);

  let type: string | undefined;
  if (extension) {
    if (customMimeTypes) {
      const customExtContentTypeMap = reverseMap(customMimeTypes);

      type = customExtContentTypeMap.get(extension)?.[0];
      if (type !== undefined) {
        return type;
      }
    }

    type = standardExtContentTypeMap.get(extension)?.[0];
  }

  if (type === undefined) {
    try {
      const chars = await readChars(filename, 200);
      const charsLower = chars.toLowerCase();
      if (charsLower.indexOf('<html>') !== -1 || charsLower.indexOf('<!doctype html>') !== -1) {
        type = standardExtContentTypeMap.get('html')?.[0];
      }
      // eslint-disable-next-line no-empty
    } catch (err) {}
  }

  return type;
}
