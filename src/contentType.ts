import mime from 'mime';
import fs from 'fs';

async function readChars(filename: string, numOfChars: number): Promise<string> {
  const buf = [];
  let bufLen = 0;
  return new Promise(
    (resolve, reject): void => {
      const rs = fs.createReadStream(filename, { encoding: 'utf8' });
      rs.on('data', chunk => {
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
        .on('error', err => {
          reject(err);
        });
    }
  );
}

export default async function getFileMimeType(filename: string, customMime: any = null): Promise<string> {
  const myMime = customMime || mime;
  let type = myMime.getType(filename);
  if (type === null) {
    const chars = await readChars(filename, 200);
    const charsLower = chars.toLowerCase();
    if (charsLower.indexOf('<html>') !== -1 || charsLower.indexOf('<!doctype html>') !== -1) {
      type = myMime.getType('.html');
    }
  }

  return type;
}
