import * as fs from 'fs'
import * as path from 'path'
import Queue from 'queue'
import { typeHandlers } from './types'
import { detector } from './detector'
import { ISizes, ISize } from './types/interface'
import './fs.promises'

type CallbackFn = (e: Error | null, b?: Buffer) => void
type Dimensions = ISize | ISizes | null | undefined

// Maximum buffer size, with a default of 512 kilobytes.
// TO-DO: make this adaptive based on the initial signature of the image
const MaxBufferSize = 512 * 1024

// This queue is for async `fs` operations, to avoid reaching file-descriptor limits
const queue = new Queue({ concurrency: 100, autostart: true })

/**
 * Return size information based on a buffer
 *
 * @param {Buffer} buffer
 * @param {String} filepath
 * @returns {Object}
 */
function lookup(buffer: Buffer, filepath?: string): Dimensions {
  // detect the file type.. don't rely on the extension
  const type = detector(buffer)

  // find an appropriate handler for this file type
  if (type && type in typeHandlers) {
    const size = typeHandlers[type].calculate(buffer, filepath)
    if (size !== undefined) {
      size.type = type
      return size
    }
  }

  // throw up, if we don't understand the file
  throw new TypeError('unsupported file type: ' + type + ' (file: ' + filepath + ')')
}

/**
 * Reads a file into a buffer.
 * @param {String} filepath
 * @returns {Promise<Buffer>}
 */
async function asyncFileToBuffer(filepath: string) {
  const handle = await fs.promises.open(filepath, 'r')
  const { size } = await handle.stat()
  if (size <= 0) {
    throw new Error('Empty file')
  }
  const bufferSize = Math.min(size, MaxBufferSize)
  const buffer = Buffer.alloc(bufferSize)
  await handle.read(buffer, 0, bufferSize, 0)
  await handle.close()
  return buffer
}

/**
 * Synchronously reads a file into a buffer, blocking the nodejs process.
 *
 * @param {String} filepath
 * @returns {Buffer}
 */
function syncFileToBuffer(filepath: string) {
  // read from the file, synchronously
  const descriptor = fs.openSync(filepath, 'r')
  const size = fs.fstatSync(descriptor).size
  const bufferSize = Math.min(size, MaxBufferSize)
  const buffer = Buffer.alloc(bufferSize)
  fs.readSync(descriptor, buffer, 0, bufferSize, 0)
  fs.closeSync(descriptor)
  return buffer
}

module.exports = exports = imageSize // backwards compatibility

export function imageSize(input: Buffer | string): Dimensions
export function imageSize(input: string, callback: CallbackFn): void
/**
 * @param {Buffer|string} input - buffer or relative/absolute path of the image file
 * @param {Function=} [callback] - optional function for async detection
 */
export function imageSize(input: Buffer | string, callback?: CallbackFn): any {
  // Handle buffer input
  if (Buffer.isBuffer(input)) {
    return lookup(input)
  }

  // input should be a string at this point
  if (typeof input !== 'string') {
    throw new TypeError('invalid invocation')
  }

  // resolve the file path
  const filepath = path.resolve(input)
  if (typeof callback === 'function') {
    queue.push(() => asyncFileToBuffer(filepath)
      .then((buffer) => process.nextTick(callback, null, lookup(buffer, filepath)))
      .catch(callback))
  } else {
    const buffer = syncFileToBuffer(filepath)
    return lookup(buffer, filepath)
  }
}

export const setConcurrency = (c: number) => { queue.concurrency = c }
export const types = Object.keys(typeHandlers)
