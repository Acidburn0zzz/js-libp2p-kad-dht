'use strict'

const debug = require('debug')
const multihashing = require('multihashing-async')
const mh = require('multihashes')
const { Key } = require('interface-datastore')
const base32 = require('base32.js')
const distance = require('xor-distance')
const pMap = require('p-map')
const { Record } = require('libp2p-record')
const PeerId = require('peer-id')
const errcode = require('err-code')
const { Buffer } = require('buffer')

/**
 * Creates a DHT ID by hashing a given buffer.
 *
 * @param {Buffer} buf
 * @returns {Promise<Buffer>}
 */
exports.convertBuffer = (buf) => {
  return multihashing.digest(buf, 'sha2-256')
}

/**
 * Creates a DHT ID by hashing a Peer ID
 *
 * @param {PeerId} peer
 * @returns {Promise<Buffer>}
 */
exports.convertPeerId = (peer) => {
  return multihashing.digest(peer.id, 'sha2-256')
}

/**
 * Convert a buffer to their SHA2-256 hash.
 *
 * @param {Buffer} buf
 * @returns {Key}
 */
exports.bufferToKey = (buf) => {
  return new Key('/' + exports.encodeBase32(buf), false)
}

/**
 * Generate the key for a public key.
 *
 * @param {PeerId} peer
 * @returns {Buffer}
 */
exports.keyForPublicKey = (peer) => {
  return Buffer.concat([
    Buffer.from('/pk/'),
    peer.id
  ])
}

exports.isPublicKeyKey = (key) => {
  return key.slice(0, 4).toString() === '/pk/'
}

exports.fromPublicKeyKey = (key) => {
  return new PeerId(key.slice(4))
}

/**
 * Get the current time as timestamp.
 *
 * @returns {number}
 */
exports.now = () => {
  return Date.now()
}

/**
 * Encode a given buffer into a base32 string.
 * @param {Buffer} buf
 * @returns {string}
 */
exports.encodeBase32 = (buf) => {
  const enc = new base32.Encoder()
  return enc.write(buf).finalize()
}

/**
 * Decode a given base32 string into a buffer.
 * @param {string} raw
 * @returns {Buffer}
 */
exports.decodeBase32 = (raw) => {
  const dec = new base32.Decoder()
  return Buffer.from(dec.write(raw).finalize())
}

/**
 * Sort peers by distance to the given `target`.
 *
 * @param {Array<PeerId>} peers
 * @param {Buffer} target
 * @returns {Array<PeerId>}
 */
exports.sortClosestPeers = async (peers, target) => {
  const distances = await pMap(peers, async (peer) => {
    const id = await exports.convertPeerId(peer)

    return {
      peer: peer,
      distance: distance(id, target)
    }
  })

  return distances.sort(exports.xorCompare).map((d) => d.peer)
}

/**
 * Compare function to sort an array of elements which have a distance property which is the xor distance to a given element.
 *
 * @param {Object} a
 * @param {Object} b
 * @returns {number}
 */
exports.xorCompare = (a, b) => {
  return distance.compare(a.distance, b.distance)
}

/**
 * Computes how many results to collect on each disjoint path, rounding up.
 * This ensures that we look for at least one result per path.
 *
 * @param {number} resultsWanted
 * @param {number} numPaths - total number of paths
 * @returns {number}
 */
exports.pathSize = (resultsWanted, numPaths) => {
  return Math.ceil(resultsWanted / numPaths)
}

/**
 * Create a new put record, encodes and signs it if enabled.
 *
 * @param {Buffer} key
 * @param {Buffer} value
 * @returns {Buffer}
 */
exports.createPutRecord = (key, value) => {
  const timeReceived = new Date()
  const rec = new Record(key, value, timeReceived)

  return rec.serialize()
}

/**
 * Creates a logger for the given subsystem
 *
 * @param {PeerId} [id]
 * @param {string} [subsystem]
 * @returns {debug}
 *
 * @private
 */
exports.logger = (id, subsystem) => {
  const name = ['libp2p', 'dht']
  if (subsystem) {
    name.push(subsystem)
  }
  if (id) {
    name.push(`${id.toB58String().slice(0, 8)}`)
  }

  // Add a formatter for converting to a base58 string
  debug.formatters.b = (v) => {
    return mh.toB58String(v)
  }

  const logger = debug(name.join(':'))
  logger.error = debug(name.concat(['error']).join(':'))

  return logger
}

exports.TimeoutError = class TimeoutError extends Error {
  get code () {
    return 'ETIMEDOUT'
  }
}

/**
 * Creates an async function that calls the given `asyncFn` and Errors
 * if it does not resolve within `time` ms
 *
 * @param {Function} [asyncFn]
 * @param {Number} [time]
 * @returns {Function}
 *
 * @private
 */
exports.withTimeout = (asyncFn, time) => {
  return async (...args) => { // eslint-disable-line require-await
    return Promise.race([
      asyncFn(...args),
      new Promise((resolve, reject) => {
        setTimeout(() => {
          reject(errcode(new Error('Async function did not complete before timeout'), 'ETIMEDOUT'))
        }, time)
      })
    ])
  }
}
