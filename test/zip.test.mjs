import test from 'node:test';
import assert from 'node:assert/strict';
import { createStoredZip } from '../public/zip.js';

function readStoredEntries(bytes) {
  const endOffset = bytes.length - 22;
  assert.equal(bytes.readUInt32LE(endOffset), 0x06054b50);
  const count = bytes.readUInt16LE(endOffset + 10);
  const centralSize = bytes.readUInt32LE(endOffset + 12);
  const centralOffset = bytes.readUInt32LE(endOffset + 16);
  assert.ok(centralOffset + centralSize <= endOffset);

  const entries = [];
  let offset = centralOffset;
  for (let index = 0; index < count; index += 1) {
    assert.equal(bytes.readUInt32LE(offset), 0x02014b50);
    const method = bytes.readUInt16LE(offset + 10);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const localOffset = bytes.readUInt32LE(offset + 42);
    const name = bytes.toString('utf8', offset + 46, offset + 46 + nameLength);

    assert.equal(bytes.readUInt32LE(localOffset), 0x04034b50);
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const content = bytes.toString('utf8', dataOffset, dataOffset + compressedSize);
    entries.push({ name, method, content });

    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

test('builds a valid store-only ZIP with unique UTF-8 filenames', async () => {
  const zip = await createStoredZip([
    { name: 'photo.txt', blob: new Blob(['first']) },
    { name: 'photo.txt', blob: new Blob(['second']) },
    { name: '中文图片.png', blob: new Blob(['png-data']) },
  ]);
  const bytes = Buffer.from(await zip.arrayBuffer());

  assert.equal(bytes.readUInt32LE(0), 0x04034b50);
  const entries = readStoredEntries(bytes);
  assert.deepEqual(entries.map((entry) => entry.name), ['photo.txt', 'photo (2).txt', '中文图片.png']);
  assert.deepEqual(entries.map((entry) => entry.method), [0, 0, 0]);
  assert.deepEqual(entries.map((entry) => entry.content), ['first', 'second', 'png-data']);
});

test('rejects an empty ZIP request', async () => {
  await assert.rejects(() => createStoredZip([]), /没有可打包/);
});
