import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  ConversionError,
  MAX_INPUT_BYTES,
  MAX_TARGET_BYTES,
  MIN_TARGET_BYTES,
  convertJpegToPng,
} from './lib/convert.mjs';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const publicDirectory = path.join(currentDirectory, 'public');
const host = '127.0.0.1';
const port = Number(process.env.PORT) || 5174;

const staticFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml; charset=utf-8']],
]);

let conversionInProgress = false;

function commonHeaders(contentType = 'application/json; charset=utf-8') {
  return {
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' blob: data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    'Cache-Control': 'no-store',
  };
}

function sendJson(response, statusCode, payload, extraHeaders = {}) {
  const body = Buffer.from(JSON.stringify(payload));
  response.writeHead(statusCode, {
    ...commonHeaders(),
    'Content-Length': body.length,
    ...extraHeaders,
  });
  response.end(body);
}

function parseTargetBytes(value) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new ConversionError('目标文件大小无效。');
  }

  const targetBytes = Number(value);
  if (targetBytes < MIN_TARGET_BYTES) {
    throw new ConversionError('目标大小不能小于 0.05 MB。');
  }
  if (targetBytes > MAX_TARGET_BYTES) {
    throw new ConversionError('目标大小不能超过 100 MB。');
  }
  return targetBytes;
}

function parseFilename(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return 'image.jpg';
  }

  try {
    return path.basename(decodeURIComponent(value)).slice(0, 180) || 'image.jpg';
  } catch {
    return 'image.jpg';
  }
}

async function readBody(request) {
  const declaredLength = Number(request.headers['content-length'] || 0);
  if (declaredLength > MAX_INPUT_BYTES) {
    throw new ConversionError('JPG 文件不能超过 50 MB。', 413);
  }

  const chunks = [];
  let receivedLength = 0;

  for await (const chunk of request) {
    receivedLength += chunk.length;
    if (receivedLength > MAX_INPUT_BYTES) {
      throw new ConversionError('JPG 文件不能超过 50 MB。', 413);
    }
    chunks.push(chunk);
  }

  if (receivedLength === 0) {
    throw new ConversionError('没有收到图片内容。');
  }

  return Buffer.concat(chunks, receivedLength);
}

function outputFilename(inputFilename) {
  const withoutExtension = inputFilename.replace(/\.(jpe?g)$/i, '');
  return `${withoutExtension || 'image'}-converted.png`;
}

async function handleConvert(request, response) {
  if (conversionInProgress) {
    sendJson(response, 429, { error: '当前已有一个转换任务，请稍后再试。' });
    return;
  }

  conversionInProgress = true;
  try {
    const targetBytes = parseTargetBytes(request.headers['x-target-bytes']);
    const filename = parseFilename(request.headers['x-file-name']);
    const inputBuffer = await readBody(request);
    const result = await convertJpegToPng(inputBuffer, targetBytes);
    const downloadName = outputFilename(filename);

    response.writeHead(200, {
      ...commonHeaders('image/png'),
      'Content-Length': result.buffer.length,
      'Content-Disposition': `attachment; filename="converted.png"; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
      'X-Original-Filename': encodeURIComponent(filename),
      'X-Output-Filename': encodeURIComponent(downloadName),
      'X-Output-Size': String(result.size),
      'X-Target-Size': String(targetBytes),
      'X-Original-Width': String(result.originalWidth),
      'X-Original-Height': String(result.originalHeight),
      'X-Result-Width': String(result.width),
      'X-Result-Height': String(result.height),
      'X-Result-Colours': String(result.colours),
      'X-Result-Scale': String(result.scale),
      'X-Result-Mode': result.mode,
      'X-Conversion-Attempts': String(result.attempts),
      'X-Processing-Time': String(result.processingMs),
    });
    response.end(result.buffer);
  } catch (error) {
    if (response.headersSent) {
      response.destroy();
      return;
    }

    const statusCode = error instanceof ConversionError ? error.statusCode : 500;
    if (statusCode >= 500) {
      console.error(error);
    }
    sendJson(response, statusCode, {
      error: statusCode >= 500 ? '转换失败，请稍后重试。' : error.message,
    });
  } finally {
    conversionInProgress = false;
  }
}

async function serveStatic(pathname, response, method) {
  const entry = staticFiles.get(pathname);
  if (!entry) {
    sendJson(response, 404, { error: '页面不存在。' });
    return;
  }

  const [filename, contentType] = entry;
  try {
    const content = await readFile(path.join(publicDirectory, filename));
    response.writeHead(200, {
      ...commonHeaders(contentType),
      'Content-Length': content.length,
    });
    if (method === 'HEAD') {
      response.end();
    } else {
      response.end(content);
    }
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { error: '页面资源读取失败。' });
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || `${host}:${port}`}`);

  if (request.method === 'GET' && url.pathname === '/api/health') {
    sendJson(response, 200, { ok: true, app: 'jpg-to-png-local' });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/convert') {
    await handleConvert(request, response);
    return;
  }

  if (request.method === 'GET' || request.method === 'HEAD') {
    await serveStatic(url.pathname, response, request.method);
    return;
  }

  sendJson(response, 405, { error: '不支持的请求方式。' }, { Allow: 'GET, HEAD, POST' });
});

server.requestTimeout = 5 * 60 * 1000;
server.headersTimeout = 30 * 1000;

server.listen(port, host, () => {
  const address = `http://${host}:${port}`;
  console.log('');
  console.log('  JPG → PNG 本地转换器已启动');
  console.log(`  打开地址: ${address}`);
  console.log('  按 Ctrl+C 停止');
  console.log('');

  if (process.env.OPEN_BROWSER === '1') {
    if (process.platform === 'win32') {
      spawn('cmd.exe', ['/c', 'start', '', address], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [address], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [address], { detached: true, stdio: 'ignore' }).unref();
    }
  }
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`端口 ${port} 已被占用，请关闭占用该端口的程序后重试。`);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
