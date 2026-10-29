import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { ConversionError, convertJpegToPng } from '../lib/convert.mjs';

function makePhotoLikeJpeg(width = 1200, height = 900) {
  const pixels = Buffer.alloc(width * height * 3);
  let seed = 0x12345678;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      const noise = (seed & 255) - 128;
      const offset = (y * width + x) * 3;
      pixels[offset] = Math.max(0, Math.min(255, (x / width) * 180 + 35 + noise * 0.18));
      pixels[offset + 1] = Math.max(0, Math.min(255, (y / height) * 130 + 80 + noise * 0.12));
      pixels[offset + 2] = Math.max(0, Math.min(255, 210 - (x / width) * 120 + noise * 0.08));
    }
  }

  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 91, chromaSubsampling: '4:4:4' })
    .toBuffer();
}

test('converts JPG to a PNG smaller than the requested limit', { timeout: 120_000 }, async () => {
  const jpeg = await makePhotoLikeJpeg();
  const targetBytes = 150_000;
  const result = await convertJpegToPng(jpeg, targetBytes);

  assert.ok(result.size < targetBytes);
  assert.equal(result.buffer[0], 0x89);
  assert.equal(result.buffer.toString('ascii', 1, 4), 'PNG');

  const metadata = await sharp(result.buffer).metadata();
  assert.equal(metadata.format, 'png');
  assert.equal(metadata.width, result.width);
  assert.equal(metadata.height, result.height);
  assert.ok(result.attempts > 0);
});

test('rejects a non-JPEG input', async () => {
  const png = await sharp({
    create: {
      width: 20,
      height: 20,
      channels: 4,
      background: { r: 20, g: 120, b: 80, alpha: 1 },
    },
  }).png().toBuffer();

  await assert.rejects(
    () => convertJpegToPng(png, 50_000),
    (error) => error instanceof ConversionError && error.statusCode === 415,
  );
});

test('rejects a target below the supported minimum', async () => {
  await assert.rejects(
    () => convertJpegToPng(Buffer.from('not-an-image'), 10_000),
    (error) => error instanceof ConversionError && error.message.includes('0.05 MB'),
  );
});
