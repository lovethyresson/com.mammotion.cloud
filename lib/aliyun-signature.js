'use strict';

const crypto = require('crypto');
const { APP_KEY, APP_SECRET } = require('./constants');

/**
 * Alibaba Cloud IoT Gateway signature generation
 * Implements HMAC-SHA256 signing as per Alibaba Cloud IoT specification
 */

/**
 * Generate a UUID v4
 * @returns {string} UUID string
 */
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Get current timestamp in milliseconds
 * @returns {string} Timestamp as string
 */
function getTimestamp() {
  return Date.now().toString();
}

/**
 * Create HMAC-SHA256 signature
 * @param {string} stringToSign - The string to sign
 * @param {string} secret - The secret key
 * @returns {string} Base64 encoded signature
 */
function hmacSha256(stringToSign, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(stringToSign);
  return hmac.digest('base64');
}

/**
 * Sort parameters and create query string
 * @param {Object} params - Parameters object
 * @returns {string} Sorted query string
 */
function sortParams(params) {
  return Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');
}

/**
 * Generate API signature for Alibaba Cloud IoT requests
 * @param {string} path - API path (e.g., '/uc/listBindingByAccount')
 * @param {Object} params - Request parameters
 * @param {Object} options - Additional options
 * @param {string} options.iotToken - IoT token for authenticated requests
 * @returns {Object} Headers and signed parameters
 */
function generateApiSignature(path, params = {}, options = {}) {
  const timestamp = getTimestamp();
  const nonce = generateUUID();

  // Build the common parameters
  const commonParams = {
    appKey: APP_KEY,
    timestamp,
    nonce,
  };

  // Add iotToken if provided (for authenticated requests)
  if (options.iotToken) {
    commonParams.iotToken = options.iotToken;
  }

  // Merge common params with request params
  const allParams = { ...commonParams, ...params };

  // Create string to sign: path + sorted params
  const sortedParamString = sortParams(allParams);
  const stringToSign = `${path}&${sortedParamString}`;

  // Generate signature
  const signature = hmacSha256(stringToSign, APP_SECRET);

  // Return headers with signature
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    'X-Ca-Signature': signature,
    'X-Ca-Signature-Method': 'HmacSHA256',
    'X-Ca-Key': APP_KEY,
    'X-Ca-Timestamp': timestamp,
    'X-Ca-Nonce': nonce,
  };

  return {
    headers,
    params: allParams,
    signature,
  };
}

/**
 * Generate OAuth signature for Mammotion OAuth requests
 * @param {Object} params - OAuth parameters
 * @returns {string} Signature
 */
function generateOAuthSignature(params) {
  const sortedParamString = sortParams(params);
  return hmacSha256(sortedParamString, APP_SECRET);
}

/**
 * Generate device session signature
 * @param {string} deviceId - Device ID
 * @param {string} identityId - User identity ID
 * @param {string} timestamp - Timestamp
 * @returns {string} Signature
 */
function generateSessionSignature(deviceId, identityId, timestamp) {
  const stringToSign = `${deviceId}&${identityId}&${timestamp}`;
  return hmacSha256(stringToSign, APP_SECRET);
}

/**
 * URL encode a string for OAuth
 * @param {string} str - String to encode
 * @returns {string} URL encoded string
 */
function urlEncode(str) {
  return encodeURIComponent(str)
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A');
}

module.exports = {
  generateUUID,
  getTimestamp,
  hmacSha256,
  sortParams,
  generateApiSignature,
  generateOAuthSignature,
  generateSessionSignature,
  urlEncode,
};
