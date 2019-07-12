import fs from 'fs';
import Mime from 'mime/Mime';
import getFileMimeType from './contentType';

jest.setTimeout(10000);

test('test content type html', async () => {
  const filename = `test-html-${Date.now()}`;
  const ws = fs.createWriteStream(filename, { encoding: 'utf8' });
  ws.write('<!DOCTYPE html>\n<html></html>');
  ws.close();

  const type = await getFileMimeType(filename);

  expect(type).toEqual('text/html');

  fs.unlinkSync(filename);
});

test('test content type not html', async () => {
  const filename = `test-nothtml-${Date.now()}`;
  const ws = fs.createWriteStream(filename, { encoding: 'utf8' });
  ws.write('<!DOCTYsdfsdfsPE htmdsfdsfdsl>dfdsn<htmsadsfl></html>');
  ws.close();

  const type = await getFileMimeType(filename);

  expect(type).toEqual(null);

  fs.unlinkSync(filename);
});

test('test content type txt', async () => {
  const filename = `test-text-${Date.now()}.txt`;
  const ws = fs.createWriteStream(filename, { encoding: 'utf8' });
  ws.write('<!DOCTYPE html>\n<html></html>');
  ws.close();

  const type = await getFileMimeType(filename);

  expect(type).toEqual('text/plain');

  fs.unlinkSync(filename);
});

test('test content type override (Mime class)', async () => {
  const filename = `test-custom-${Date.now()}.pub`;
  // eslint-disable-next-line global-require
  const customMime = new Mime(require('mime/types/standard'), require('mime/types/other'));
  customMime.define({ 'text/plain': ['pub'] }, true);
  const type = await getFileMimeType(filename, customMime);

  expect(type).toEqual('text/plain');
});

test('test content type override', async () => {
  const filename = `test-custom-${Date.now()}.pub`;
  const type = await getFileMimeType(filename, { 'text/plain': ['pub'] });

  expect(type).toEqual('text/plain');
});

test('test content type override with fallback', async () => {
  const filename = `test-custom-${Date.now()}.svg`;
  const type = await getFileMimeType(filename, { 'text/plain': ['pub'] });

  expect(type).toEqual('image/svg+xml');
});
