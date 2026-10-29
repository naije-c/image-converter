const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const year = Math.min(2107, Math.max(1980, date.getFullYear()));
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function uniqueName(name, usedNames) {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, '-').replace(/^\.+/, '') || 'image.png';
  const dot = cleaned.lastIndexOf('.');
  const base = dot > 0 ? cleaned.slice(0, dot) : cleaned;
  const extension = dot > 0 ? cleaned.slice(dot) : '';
  let candidate = cleaned;
  let suffix = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    candidate = `${base} (${suffix})${extension}`;
    suffix += 1;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

function localHeader(nameBytes, data, crc, dateTime) {
  const header = new Uint8Array(30 + nameBytes.length);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 0x0800, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, dateTime.time, true);
  view.setUint16(12, dateTime.date, true);
  view.setUint32(14, crc, true);
  view.setUint32(18, data.length, true);
  view.setUint32(22, data.length, true);
  view.setUint16(26, nameBytes.length, true);
  view.setUint16(28, 0, true);
  header.set(nameBytes, 30);
  return header;
}

function centralHeader(nameBytes, data, crc, dateTime, localOffset) {
  const header = new Uint8Array(46 + nameBytes.length);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, 0x0800, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, dateTime.time, true);
  view.setUint16(14, dateTime.date, true);
  view.setUint32(16, crc, true);
  view.setUint32(20, data.length, true);
  view.setUint32(24, data.length, true);
  view.setUint16(28, nameBytes.length, true);
  view.setUint16(30, 0, true);
  view.setUint16(32, 0, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, 0, true);
  view.setUint32(38, 0, true);
  view.setUint32(42, localOffset, true);
  header.set(nameBytes, 46);
  return header;
}

function endOfCentralDirectory(entryCount, centralSize, centralOffset) {
  const record = new Uint8Array(22);
  const view = new DataView(record.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, entryCount, true);
  view.setUint16(10, entryCount, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, centralOffset, true);
  view.setUint16(20, 0, true);
  return record;
}

export async function createStoredZip(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('没有可打包的文件。');
  }
  if (entries.length > 65535) {
    throw new Error('ZIP 文件数量过多。');
  }

  const encoder = new TextEncoder();
  const usedNames = new Set();
  const parts = [];
  const centralParts = [];
  const now = new Date();
  const dateTime = dosDateTime(now);
  let localOffset = 0;

  for (const entry of entries) {
    if (!(entry.blob instanceof Blob)) {
      throw new Error('ZIP 中的文件内容无效。');
    }
    const name = uniqueName(String(entry.name || 'image.png'), usedNames);
    const nameBytes = encoder.encode(name);
    const data = new Uint8Array(await entry.blob.arrayBuffer());
    const crc = crc32(data);
    const local = localHeader(nameBytes, data, crc, dateTime);
    const central = centralHeader(nameBytes, data, crc, dateTime, localOffset);
    parts.push(local, data);
    centralParts.push(central);
    localOffset += local.length + data.length;
  }

  const centralOffset = localOffset;
  const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
  parts.push(...centralParts, endOfCentralDirectory(entries.length, centralSize, centralOffset));
  return new Blob(parts, { type: 'application/zip' });
}
