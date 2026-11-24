// 原生 ZIP 打包：不引入新依赖，用 zlib 的 deflateRaw 自己写 zip 结构。
// 只支持 ZIP 的常用子集：deflate/store、UTF-8 文件名、无 ZIP64、无加密。
// 上限写死在调用方（条目数、总字节），这里只做结构与路径校验。
import {deflateRawSync} from 'node:zlib';
import fs from 'node:fs/promises';
import path from 'node:path';

const MAX_NAME = 512;
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let value = i;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[i] = value >>> 0;
  }
  return table;
})();

export function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// 归档内路径统一成 '/'，拒绝绝对路径、盘符、'..' 段和反斜杠，避免解压时跑到目标目录外。
export function normalizeEntryName(name) {
  if (typeof name !== 'string' || !name || name.length > MAX_NAME) throw new Error('压缩包内的路径无效。');
  if (name.includes('\0')) throw new Error('压缩包内的路径无效。');
  const unified = name.replace(/\\/g, '/');
  if (unified.startsWith('/') || /^[a-zA-Z]:/.test(unified)) throw new Error('压缩包内不能使用绝对路径。');
  const parts = unified.split('/').filter(part => part && part !== '.');
  if (!parts.length || parts.some(part => part === '..')) throw new Error('压缩包内不能使用上级目录。');
  return parts.join('/');
}

function dosStamp(date) {
  const clamped = date instanceof Date && Number.isFinite(date.getTime()) ? date : new Date();
  const year = Math.min(Math.max(clamped.getFullYear(), 1980), 2107);
  const time = (clamped.getHours() << 11) | (clamped.getMinutes() << 5) | Math.floor(clamped.getSeconds() / 2);
  const day = ((year - 1980) << 9) | ((clamped.getMonth() + 1) << 5) | clamped.getDate();
  return {time: time & 0xffff, date: day & 0xffff};
}

/** 把 [{name, data, mtime}] 打成 zip Buffer。data 必须是 Buffer。 */
export function buildZip(entries, {compress = true} = {}) {
  const seen = new Set();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = normalizeEntryName(entry.name);
    if (seen.has(name)) throw new Error(`压缩包内有重名文件：${name}`);
    seen.add(name);
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data ?? '');
    const nameBytes = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const deflated = compress ? deflateRawSync(data, {level: 6}) : null;
    const useDeflate = compress && deflated && deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const method = useDeflate ? 8 : 0;
    const {time, date} = dosStamp(entry.mtime);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 名称
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBytes, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);

    offset += local.length + nameBytes.length + body.length;
    if (offset > 0xffffffff) throw new Error('压缩包超过 4 GB，当前不支持。');
  }
  const centralBytes = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(seen.size, 8);
  end.writeUInt16LE(seen.size, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  if (offset + centralBytes.length + end.length > 0xffffffff) throw new Error('压缩包超过 4 GB，当前不支持。');
  return Buffer.concat([...locals, centralBytes, end]);
}

/**
 * 遍历目录并返回可打包的条目。不跟随符号链接，跳过调用方给的私密文件判断。
 * 目录本身不产生条目（空目录会被丢弃）。
 */
export async function collectDirectory({root, relative = '', maxEntries = 2000, maxBytes = 256 * 1024 * 1024, skip = () => false, now = Date.now()}) {
  const base = path.resolve(root, relative);
  const entries = [];
  let totalBytes = 0;
  let skipped = 0;
  const walk = async current => {
    const items = await fs.readdir(current, {withFileTypes: true});
    items.sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const item of items) {
      const absolute = path.join(current, item.name);
      const name = path.relative(base, absolute).replace(/\\/g, '/');
      if (item.isSymbolicLink()) { skipped += 1; continue; }
      if (skip(name, item.isDirectory())) { skipped += 1; continue; }
      if (item.isDirectory()) { await walk(absolute); continue; }
      if (!item.isFile()) { skipped += 1; continue; }
      const info = await fs.lstat(absolute);
      if (!info.isFile()) { skipped += 1; continue; }
      totalBytes += info.size;
      if (entries.length + 1 > maxEntries) throw new Error(`项目文件超过 ${maxEntries} 个，无法打包。请先清理目录。`);
      if (totalBytes > maxBytes) throw new Error(`项目超过 ${Math.round(maxBytes / 1024 / 1024)} MB，无法打包。`);
      entries.push({name, data: await fs.readFile(absolute), mtime: info.mtime, size: info.size, ageMs: now - info.mtimeMs});
    }
  };
  await walk(base);
  return {entries, totalBytes, skipped};
}
