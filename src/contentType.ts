import mime from 'mime';
import Mime from 'mime/Mime';
import fs from 'fs';

async function readChars(filename: string, numOfChars: number): Promise<string> {
  const buf = [];
  let bufLen = 0;
  return new Promise((resolve, reject): void => {
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
  });
}

export default async function getFileMimeType(filename: string, customMime: any = null): Promise<string> {
  if (customMime && (!customMime.constructor || customMime.constructor.name !== 'Mime')) {
    const types = customMime;
    // eslint-disable-next-line global-require
    customMime = new Mime(require('mime/types/standard'), require('mime/types/other'));
    customMime.define(types, true);
  }
  const myMime = customMime || mime;
  let type = myMime.getType(filename);
  if (type === null) {
    try {
      const chars = await readChars(filename, 200);
      const charsLower = chars.toLowerCase();
      if (charsLower.indexOf('<html>') !== -1 || charsLower.indexOf('<!doctype html>') !== -1) {
        type = myMime.getType('.html');
      }
      // eslint-disable-next-line no-empty
    } catch (err) {}
  }

  return type;
}
