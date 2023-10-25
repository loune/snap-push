import fs from 'fs';

const standardContentTypeExtMap = new Map<string, string[]>([
  ['audio/aac', ['aac']],
  ['application/x-abiword', ['abw']],
  ['application/x-freearc', ['arc']],
  ['image/avif', ['avif']],
  ['video/x-msvideo', ['avi']],
  ['application/vnd.amazon.ebook', ['azw']],
  ['application/octet-stream', ['bin']],
  ['image/bmp', ['bmp']],
  ['application/x-bzip', ['bz']],
  ['application/x-bzip2', ['bz2']],
  ['application/x-cdf', ['cda']],
  ['application/x-csh', ['csh']],
  ['text/css', ['css']],
  ['text/csv', ['csv']],
  ['application/msword', ['doc']],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', ['docx']],
  ['application/vnd.ms-fontobject', ['eot']],
  ['application/epub+zip', ['epub']],
  ['application/gzip', ['gz']],
  ['image/gif', ['gif']],
  ['text/html', ['htm', 'html']],
  ['image/vnd.microsoft.icon', ['ico']],
  ['text/calendar', ['ics']],
  ['application/java-archive', ['jar']],
  ['image/jpeg', ['jpeg', 'jpg']],
  ['text/javascript', ['js']],
  ['application/json', ['json']],
  ['application/ld+json', ['jsonld']],
  ['audio/midi', ['mid, .midi']],
  ['audio/x-midi', ['mid, .midi']],
  ['text/javascript', ['mjs']],
  ['audio/mpeg', ['mp3']],
  ['video/mp4', ['mp4']],
  ['video/mpeg', ['mpeg']],
  ['application/vnd.apple.installer+xml', ['mpkg']],
  ['application/vnd.oasis.opendocument.presentation', ['odp']],
  ['application/vnd.oasis.opendocument.spreadsheet', ['ods']],
  ['application/vnd.oasis.opendocument.text', ['odt']],
  ['audio/ogg', ['oga']],
  ['video/ogg', ['ogv']],
  ['application/ogg', ['ogx']],
  ['audio/opus', ['opus']],
  ['font/otf', ['otf']],
  ['image/png', ['png']],
  ['application/pdf', ['pdf']],
  ['application/x-httpd-php', ['php']],
  ['application/vnd.ms-powerpoint', ['ppt']],
  ['application/vnd.openxmlformats-officedocument.presentationml.presentation', ['pptx']],
  ['application/vnd.rar', ['rar']],
  ['application/rtf', ['rtf']],
  ['application/x-sh', ['sh']],
  ['image/svg+xml', ['svg']],
  ['application/x-tar', ['tar']],
  ['image/tiff', ['tif, .tiff']],
  ['video/mp2t', ['ts']],
  ['font/ttf', ['ttf']],
  ['text/plain', ['txt']],
  ['application/vnd.visio', ['vsd']],
  ['audio/wav', ['wav']],
  ['audio/webm', ['weba']],
  ['video/webm', ['webm']],
  ['image/webp', ['webp']],
  ['font/woff', ['woff']],
  ['font/woff2', ['woff2']],
  ['application/xhtml+xml', ['xhtml']],
  ['application/vnd.ms-excel', ['xls']],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ['xlsx']],
  ['application/xml', ['xml']],
  ['text/xml', ['xml']],
  ['application/vnd.mozilla.xul+xml', ['xul']],
  ['application/zip', ['zip']],
  ['video/3gpp', ['3gp']],
  ['video/3gpp2', ['3g2']],
  ['application/x-7z-compressed', ['7z']],
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
  customMimeTypes?: Record<string, string[]> | undefined
): Promise<string | undefined> {
  const [, extension] = filename.split('.');

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
