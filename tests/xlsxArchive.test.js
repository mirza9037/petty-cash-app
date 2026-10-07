import { test } from 'node:test'
import assert from 'node:assert/strict'
import { crc32, deflateRawSync } from 'node:zlib'
import { checkArchiveSize, boundedWorkbookArchive, MAX_EXPANDED_BYTES } from '../src/lib/xlsxArchive.js'
import { templateBuffer, parseImport } from '../src/lib/excel.js'

// Independent ZIP fixture writer using Node's compressor/checksum. Claimed
// lengths can differ from the actual DEFLATE output to exercise the hard cap.
function archive(data, { size = data.length, method = 8, descriptor = false } = {}) {
  const name = Buffer.from('padding.txt')
  const payload = method === 8 ? deflateRawSync(data) : data
  const localSize = 30 + name.length + payload.length + (descriptor ? 16 : 0)
  const centralSize = 46 + name.length
  const zip = Buffer.alloc(localSize + centralSize + 22)
  const flags = descriptor ? 8 : 0
  zip.writeUInt32LE(0x04034b50, 0)
  zip.writeUInt16LE(20, 4)
  zip.writeUInt16LE(flags, 6)
  zip.writeUInt16LE(method, 8)
  if (!descriptor) {
    zip.writeUInt32LE(crc32(data), 14)
    zip.writeUInt32LE(payload.length, 18)
    zip.writeUInt32LE(size, 22)
  }
  zip.writeUInt16LE(name.length, 26)
  name.copy(zip, 30)
  payload.copy(zip, 30 + name.length)
  if (descriptor) {
    zip.writeUInt32LE(0x08074b50, localSize - 16)
    zip.writeUInt32LE(crc32(data), localSize - 12)
    zip.writeUInt32LE(payload.length, localSize - 8)
    zip.writeUInt32LE(size, localSize - 4)
  }
  zip.writeUInt32LE(0x02014b50, localSize)
  zip.writeUInt16LE(20, localSize + 4)
  zip.writeUInt16LE(20, localSize + 6)
  zip.writeUInt16LE(flags, localSize + 8)
  zip.writeUInt16LE(method, localSize + 10)
  zip.writeUInt32LE(crc32(data), localSize + 16)
  zip.writeUInt32LE(payload.length, localSize + 20)
  zip.writeUInt32LE(size, localSize + 24)
  zip.writeUInt16LE(name.length, localSize + 28)
  name.copy(zip, localSize + 46)
  const end = localSize + centralSize
  zip.writeUInt32LE(0x06054b50, end)
  zip.writeUInt16LE(1, end + 8)
  zip.writeUInt16LE(1, end + 10)
  zip.writeUInt32LE(centralSize, end + 12)
  zip.writeUInt32LE(localSize, end + 16)
  return zip
}

test('rejects the review exploit: workbook with forged zero or partial directory count', async () => {
  for (const count of [0, 1]) {
    const zip = Buffer.from(await templateBuffer())
    zip.writeUInt16LE(count, zip.length - 14)
    zip.writeUInt16LE(count, zip.length - 12)
    await assert.rejects(() => parseImport(zip), /Cannot read/)
  }
})

test('actual decompression is capped even when both length declarations lie', () => {
  const zip = archive(Buffer.alloc(24 * 1024 * 1024, 65), { size: MAX_EXPANDED_BYTES })
  assert.ok(zip.length < 40000)
  assert.equal(checkArchiveSize(zip).entries.length, 1)
  assert.throws(() => boundedWorkbookArchive(zip), /exceeds 20 MB/)
  const tinyClaim = archive(Buffer.alloc(1024 * 1024, 65), { size: 1 })
  assert.throws(() => boundedWorkbookArchive(tinyClaim), /Cannot read/)
})

test('accepts valid STORE, DEFLATE and streaming descriptor archives and normalizes them', () => {
  for (const options of [{ method: 0 }, { method: 8 }, { method: 8, descriptor: true }]) {
    const result = boundedWorkbookArchive(archive(Buffer.from('safe contents'), options))
    const checked = checkArchiveSize(result)
    assert.equal(checked.entries[0].method, 0)
    assert.deepEqual(boundedWorkbookArchive(result), result)
  }
})

test('rejects malformed directory boundaries, local pointers, names, sizes and checksums', () => {
  const original = archive(Buffer.from('safe contents'))
  const end = original.length - 22
  const central = original.readUInt32LE(end + 16)
  const mutations = [
    (z) => z.writeUInt32LE(1, end + 12),
    (z) => z.writeUInt16LE(2, end + 8),
    (z) => z.writeUInt16LE(1, end + 4),
    (z) => z.writeUInt32LE(central, central + 42),
    (z) => z.writeUInt16LE(0xffff, central + 30),
    (z) => z.writeUInt16LE(1, central + 8),
    (z) => z.writeUInt32LE(0, central + 16),
    (z) => z.writeUInt32LE(0xffffffff, central + 24),
    (z) => { z[30] = 120 },
    (z) => z.writeUInt32LE(0, central + 20),
  ]
  for (const mutate of mutations) {
    const changed = Buffer.from(original)
    mutate(changed)
    assert.throws(() => boundedWorkbookArchive(changed), /Cannot read/)
  }
})
