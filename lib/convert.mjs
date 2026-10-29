import sharp from 'sharp';

export const MAX_INPUT_BYTES = 50 * 1_000_000;
export const MAX_TARGET_BYTES = 100 * 1_000_000;
export const MIN_TARGET_BYTES = 50_000;
const MAX_INPUT_PIXELS = 100_000_000;

export class ConversionError extends Error {
  constructor(message, statusCode = 422) {
    super(message);
    this.name = 'ConversionError';
    this.statusCode = statusCode;
  }
}

function effectiveDimensions(metadata) {
  const swapsAxes = [5, 6, 7, 8].includes(metadata.orientation);
  return {
    width: swapsAxes ? metadata.height : metadata.width,
    height: swapsAxes ? metadata.width : metadata.height,
  };
}

function validateTarget(targetBytes) {
  if (!Number.isFinite(targetBytes) || !Number.isInteger(targetBytes)) {
    throw new ConversionError('目标文件大小无效。');
  }

  if (targetBytes < MIN_TARGET_BYTES) {
    throw new ConversionError('目标大小不能小于 0.05 MB。');
  }

  if (targetBytes > MAX_TARGET_BYTES) {
    throw new ConversionError('目标大小不能超过 100 MB。');
  }
}

export async function convertJpegToPng(inputBuffer, targetBytes) {
  validateTarget(targetBytes);

  if (!Buffer.isBuffer(inputBuffer) || inputBuffer.length === 0) {
    throw new ConversionError('没有收到图片内容。');
  }

  if (inputBuffer.length > MAX_INPUT_BYTES) {
    throw new ConversionError('JPG 文件不能超过 50 MB。', 413);
  }

  let metadata;
  try {
    metadata = await sharp(inputBuffer, {
      failOn: 'error',
      limitInputPixels: MAX_INPUT_PIXELS,
    }).metadata();
  } catch {
    throw new ConversionError('无法读取这张图片，请确认文件没有损坏。');
  }

  if (metadata.format !== 'jpeg') {
    throw new ConversionError('仅支持 JPG/JPEG 格式。', 415);
  }

  const { width: originalWidth, height: originalHeight } = effectiveDimensions(metadata);
  if (!originalWidth || !originalHeight) {
    throw new ConversionError('无法识别图片尺寸。');
  }

  const startedAt = performance.now();
  let attempts = 0;

  const render = async (scale, colours) => {
    attempts += 1;
    const width = Math.max(1, Math.round(originalWidth * scale));
    const height = Math.max(1, Math.round(originalHeight * scale));
    const pipeline = sharp(inputBuffer, {
      failOn: 'error',
      limitInputPixels: MAX_INPUT_PIXELS,
      sequentialRead: true,
    }).rotate();

    if (width !== originalWidth || height !== originalHeight) {
      pipeline.resize({
        width,
        height,
        fit: 'fill',
        kernel: sharp.kernel.lanczos3,
      });
    }

    const { data, info } = await pipeline
      .png({
        compressionLevel: 8,
        adaptiveFiltering: true,
        palette: true,
        quality: 100,
        colours,
        dither: colours <= 32 ? 0 : 0.7,
        effort: 3,
      })
      .toBuffer({ resolveWithObject: true });

    return {
      buffer: data,
      width: info.width,
      height: info.height,
      size: data.length,
      colours,
      scale,
    };
  };

  const success = (output, mode) => ({
    ...output,
    targetBytes,
    originalWidth,
    originalHeight,
    attempts,
    mode,
    processingMs: Math.round(performance.now() - startedAt),
  });

  // First preserve the original resolution and as much colour depth as possible.
  const fullColour = await render(1, 256);
  if (fullColour.size < targetBytes) {
    return success(fullColour, 'palette');
  }

  const minimumColour = await render(1, 16);
  if (minimumColour.size < targetBytes) {
    for (const colours of [128, 64, 32]) {
      const candidate = await render(1, colours);
      if (candidate.size < targetBytes) {
        return success(candidate, 'palette');
      }
    }
    return success(minimumColour, 'palette');
  }

  // A 16-colour PNG at full resolution is still too large. Find the largest
  // resolution that fits while retaining a useful 128-colour palette.
  let lowScale = 0.25;
  let lowResult = await render(lowScale, 128);

  while (lowResult.size >= targetBytes && lowScale > 1 / 8192) {
    lowScale /= 2;
    lowResult = await render(lowScale, 128);
  }

  if (lowResult.size >= targetBytes) {
    const singlePixel = await render(Math.min(1 / originalWidth, 1 / originalHeight), 16);
    if (singlePixel.size < targetBytes) {
      return success(singlePixel, 'downscaled');
    }
    throw new ConversionError('目标大小过小，无法生成符合条件的 PNG。');
  }

  let highScale = 1;
  for (let index = 0; index < 7; index += 1) {
    const midScale = (lowScale + highScale) / 2;
    const candidate = await render(midScale, 128);
    if (candidate.size < targetBytes) {
      lowScale = midScale;
      lowResult = candidate;
    } else {
      highScale = midScale;
    }
  }

  const higherColour = await render(lowScale, 256);
  if (higherColour.size < targetBytes) {
    return success(higherColour, 'downscaled');
  }

  return success(lowResult, 'downscaled');
}
