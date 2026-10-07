import { Inflate } from 'pako'

export const MAX_EXPANDED_BYTES = 20 * 1024 * 1024
const invalid = () => { throw new Error('Cannot read this workbook archive. Use a clean, unencrypted .xlsx template.') }
const tooLarge = () => { throw new Error('Expanded workbook exceeds 20 MB. Copy records into a clean template.') }

// Traverse the actual directory extent, not the untrusted entry count.
export function checkArchiveSize(buffer) {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) { end = i; break }
  }
  if (end < 0) invalid()
  const count = view.getUint16(end + 10, true)
  const start = view.getUint32(end + 16, true)
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) ||
      view.getUint16(end + 8, true) !== count || start + view.getUint32(end + 12, true) !== end) invalid()
  const entries = [], names = new Set()
  let offset = start, declared = 0
  while (offset < end) {
    if (entries.length >= 1000 || offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) invalid()
    const flags = view.getUint16(offset + 8, true), method = view.getUint16(offset + 10, true)
    const compressed = view.getUint32(offset + 20, true), size = view.getUint32(offset + 24, true)
    const nameLength = view.getUint16(offset + 28, true), extraLength = view.getUint16(offset + 30, true)
    const next = offset + 46 + nameLength + extraLength + view.getUint16(offset + 32, true)
    const local = view.getUint32(offset + 42, true)
    if (next > end || !nameLength || nameLength > 1024 || flags & ~0x080e || ![0, 8].includes(method) ||
        view.getUint16(offset + 34, true) || size === 0xffffffff || compressed === 0xffffffff || local + 30 > start) invalid()
    const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLength)
    let name
    try { name = new TextDecoder('utf-8', { fatal: true }).decode(nameBytes) } catch { invalid() }
    if (names.has(name) || name.includes('\\') || name.includes(String.fromCharCode(0)) || name.startsWith('/') || name.split('/').some((part) => part === '..' || part === '.')) invalid()
    names.add(name)
    if (view.getUint32(local, true) !== 0x04034b50 || view.getUint16(local + 6, true) !== flags ||
        view.getUint16(local + 8, true) !== method || view.getUint16(local + 26, true) !== nameLength) invalid()
    const dataStart = local + 30 + nameLength + view.getUint16(local + 28, true)
    if (dataStart + compressed > start || nameBytes.some((b, i) => b !== bytes[local + 30 + i])) invalid()
    declared += size
    if (declared > MAX_EXPANDED_BYTES) tooLarge()
    entries.push({ nameBytes, method, size, crc: view.getUint32(offset + 16, true), local, dataStart, compressed })
    offset = next
  }
  if (!entries.length || offset !== end || entries.length !== count) invalid()
  const ranges = [...entries].sort((a, b) => a.local - b.local)
  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i].local < ranges[i - 1].dataStart + ranges[i - 1].compressed) invalid()
  }
  return { bytes, entries }
}

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})

// Limit actual output in 16 KiB chunks before ExcelJS sees any content. Rebuild
// a STORE-only archive so downstream ZIP parsing cannot reinterpret attacker
// metadata or decompress unchecked streams.
export function boundedWorkbookArchive(buffer) {
  const { bytes, entries } = checkArchiveSize(buffer)
  let total = 0
  for (const entry of entries) {
    entry.chunks = []
    let actual = 0, crc = 0xffffffff
    const accept = (chunk) => {
      total += chunk.length
      actual += chunk.length
      if (total > MAX_EXPANDED_BYTES) tooLarge()
      // Do not let a forged smaller size defer rejection until end of stream.
      if (actual > entry.size) invalid()
      for (const byte of chunk) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8)
      entry.chunks.push(chunk)
    }
    const input = bytes.subarray(entry.dataStart, entry.dataStart + entry.compressed)
    if (entry.method === 0) accept(input)
    else {
      const inflater = new Inflate({ raw: true, chunkSize: 16384 })
      inflater.onData = accept
      inflater.push(input, true)
      if (inflater.err || !inflater.ended || inflater.strm.avail_in !== 0) invalid()
    }
    if (actual !== entry.size || ((crc ^ 0xffffffff) >>> 0) !== entry.crc) invalid()
  }
  const localSize = entries.reduce((sum, e) => sum + 30 + e.nameBytes.length + e.size, 0)
  const directorySize = entries.reduce((sum, e) => sum + 46 + e.nameBytes.length, 0)
  const output = new Uint8Array(localSize + directorySize + 22)
  const view = new DataView(output.buffer)
  let offset = 0, directory = localSize
  for (const entry of entries) {
    const nameLength = entry.nameBytes.length
    view.setUint32(offset, 0x04034b50, true)
    view.setUint16(offset + 4, 20, true)
    view.setUint16(offset + 6, 0x0800, true)
    view.setUint32(offset + 14, entry.crc, true)
    view.setUint32(offset + 18, entry.size, true)
    view.setUint32(offset + 22, entry.size, true)
    view.setUint16(offset + 26, nameLength, true)
    output.set(entry.nameBytes, offset + 30)
    view.setUint32(directory, 0x02014b50, true)
    view.setUint16(directory + 4, 20, true)
    view.setUint16(directory + 6, 20, true)
    view.setUint16(directory + 8, 0x0800, true)
    view.setUint32(directory + 16, entry.crc, true)
    view.setUint32(directory + 20, entry.size, true)
    view.setUint32(directory + 24, entry.size, true)
    view.setUint16(directory + 28, nameLength, true)
    view.setUint32(directory + 42, offset, true)
    output.set(entry.nameBytes, directory + 46)
    directory += 46 + nameLength
    offset += 30 + nameLength
    for (const chunk of entry.chunks) { output.set(chunk, offset); offset += chunk.length }
    entry.chunks = null
  }
  view.setUint32(directory, 0x06054b50, true)
  view.setUint16(directory + 8, entries.length, true)
  view.setUint16(directory + 10, entries.length, true)
  view.setUint32(directory + 12, directorySize, true)
  view.setUint32(directory + 16, localSize, true)
  return output
}
