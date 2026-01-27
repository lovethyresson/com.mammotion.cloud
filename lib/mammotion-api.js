'use strict';

const https = require('https');
const { URL } = require('url');
const {
  MAMMOTION_OAUTH2_CLIENT_ID,
  MAMMOTION_DOMAIN,
  MAMMOTION_API_DOMAIN,
  ALIYUN_IOT_API_URL,
  DEFAULT_REGION,
  IOT_TOKEN_LIFETIME,
  ERROR_CODES,
  MAX_RETRIES,
  RETRY_DELAY,
  RETRY_MULTIPLIER,
  COMMANDS,
  DEVICE_PROPERTIES,
} = require('./constants');
const {
  generateApiSignature,
  generateUUID,
  createMammotionOAuthSignature,
  generateMammotionClientId,
} = require('./aliyun-signature');
const {
  AuthenticationError,
  TokenExpiredError,
  SessionInvalidError,
  RateLimitError,
  DeviceOfflineError,
  ApiError,
  NetworkError,
} = require('./errors');

/**
 * Mammotion Cloud API Client
 * Handles authentication, token management, and device communication
 */
class MammotionApi {
  constructor(options = {}) {
    this.region = options.region || DEFAULT_REGION;
    this.logger = options.logger || console;

    // Authentication state (new OAuth2 flow)
    this.accessToken = null;
    this.refreshToken = null;
    this.tokenExpiry = null;
    this.identityId = null;
    this.clientId = null;
    this.iotEndpoint = null; // IoT endpoint from JWT

    // Legacy iotToken alias for backward compatibility
    this.iotToken = null;
    this.iotTokenExpiry = null;

    // User credentials (stored for re-authentication)
    this.email = null;
    this.password = null;
  }

  /**
   * Make an HTTPS request
   * @param {string} url - Full URL to request
   * @param {Object} options - Request options
   * @returns {Promise<Object>} Response data
   */
  async _request(url, options = {}) {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const requestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: parsedUrl.pathname + parsedUrl.search,
        method: options.method || 'GET',
        headers: {
          'User-Agent': 'Homey/1.0',
          ...options.headers,
        },
      };

      const req = https.request(requestOptions, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const jsonData = JSON.parse(data);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(jsonData);
            } else {
              reject(new ApiError(`HTTP ${res.statusCode}`, res.statusCode, jsonData));
            }
          } catch (e) {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(data);
            } else {
              reject(new ApiError(`HTTP ${res.statusCode}: ${data}`, res.statusCode));
            }
          }
        });
      });

      req.on('error', (e) => {
        reject(new NetworkError(e.message, e));
      });

      if (options.body) {
        req.write(options.body);
      }
      req.end();
    });
  }

  /**
   * Make a POST request with form data
   * @param {string} url - URL to post to
   * @param {Object} data - Form data
   * @param {Object} headers - Additional headers
   * @returns {Promise<Object>} Response data
   */
  async _postForm(url, data, headers = {}) {
    const body = Object.entries(data)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join('&');

    return this._request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        ...headers,
      },
      body,
    });
  }

  /**
   * Make a signed API request to Alibaba Cloud IoT
   * @param {string} path - API path
   * @param {Object} params - Request parameters
   * @param {boolean} authenticated - Whether to use iotToken
   * @returns {Promise<Object>} Response data
   */
  async _signedRequest(path, params = {}, authenticated = true) {
    const options = authenticated && this.iotToken ? { iotToken: this.iotToken } : {};
    const { headers, params: signedParams } = generateApiSignature(path, params, options);

    const body = Object.entries(signedParams)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join('&');

    const url = `${ALIYUN_IOT_API_URL}${path}`;

    const response = await this._request(url, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Length': Buffer.byteLength(body),
      },
      body,
    });

    // Check for error responses
    if (response.code) {
      if (response.code === ERROR_CODES.TOKEN_EXPIRED) {
        throw new TokenExpiredError();
      }
      if (response.code === ERROR_CODES.SESSION_INVALID) {
        throw new SessionInvalidError();
      }
      if (response.code === ERROR_CODES.RATE_LIMITED) {
        throw new RateLimitError();
      }
      if (response.code === ERROR_CODES.DEVICE_OFFLINE) {
        throw new DeviceOfflineError();
      }
      if (response.code !== 200) {
        throw new ApiError(response.message || 'API error', response.code, response);
      }
    }

    return response;
  }

  /**
   * Retry a function with exponential backoff
   * @param {Function} fn - Function to retry
   * @param {number} maxRetries - Maximum number of retries
   * @returns {Promise<any>} Result of function
   */
  async _retry(fn, maxRetries = MAX_RETRIES) {
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;

        // Don't retry authentication errors
        if (error instanceof AuthenticationError && !(error instanceof TokenExpiredError)) {
          throw error;
        }

        // Handle token expiration by refreshing
        if (error instanceof TokenExpiredError && this.refreshToken) {
          await this.refreshSession();
          continue; // Retry with new token
        }

        // Handle rate limiting
        if (error instanceof RateLimitError) {
          const delay = (error.retryAfter || RETRY_DELAY) * RETRY_MULTIPLIER ** attempt;
          await this._sleep(delay);
          continue;
        }

        // Exponential backoff for other errors
        if (attempt < maxRetries) {
          const delay = RETRY_DELAY * RETRY_MULTIPLIER ** attempt;
          await this._sleep(delay);
        }
      }
    }
    throw lastError;
  }

  /**
   * Sleep for specified milliseconds
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise<void>}
   */
  async _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Full authentication flow using Mammotion OAuth2 API
   * Implements the login_v2 flow from PyMammotion
   *
   * @param {string} email - User email
   * @param {string} password - User password
   * @returns {Promise<Object>} Session data
   */
  async authenticate(email, password) {
    this.logger.log('Authenticating with Mammotion OAuth2...');

    // Store credentials for re-authentication
    this.email = email;
    this.password = password;

    // Generate client ID if not exists
    if (!this.clientId) {
      this.clientId = generateMammotionClientId();
    }

    // Build login request (password must be base64 encoded)
    const loginRequest = {
      username: email,
      password: Buffer.from(password, 'utf8').toString('base64'),
      client_id: MAMMOTION_OAUTH2_CLIENT_ID,
      grant_type: 'password',
      authType: '0',
    };

    // Create OAuth signature
    const tokenEndpoint = '/oauth2/token';
    const { signature } = createMammotionOAuthSignature(loginRequest, tokenEndpoint);

    // Build headers - Ma-Timestamp uses seconds (independent from signature timestamp)
    const headers = {
      'User-Agent': 'okhttp/4.9.3',
      'App-Version': 'android,6.11.305',
      'Ma-App-Key': MAMMOTION_OAUTH2_CLIENT_ID,
      'Ma-Signature': signature,
      'Ma-Timestamp': Math.floor(Date.now() / 1000).toString(),
      'Client-Id': this.clientId,
      'Client-Type': '1',
    };

    // Build query string from login request
    const queryString = Object.entries(loginRequest)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join('&');

    // Make request
    const url = `${MAMMOTION_DOMAIN}${tokenEndpoint}?${queryString}`;
    const response = await this._request(url, {
      method: 'POST',
      headers,
    });

    // Validate response
    if (!response.data || !response.data.access_token) {
      const errorMsg = response.msg || response.message || 'Login failed';
      this.logger.log('Authentication failed:', errorMsg, response);
      throw new AuthenticationError(errorMsg, response.code);
    }

    // Extract tokens
    this.accessToken = response.data.access_token;
    this.refreshToken = response.data.refresh_token;
    this.tokenExpiry = Date.now() + (response.data.expires_in * 1000);
    this.identityId = response.data.userInformation?.userId;

    // Decode JWT to get IoT endpoint
    try {
      const jwtPayload = JSON.parse(Buffer.from(this.accessToken.split('.')[1], 'base64').toString('utf8'));
      this.iotEndpoint = jwtPayload.iot || null;
      this.logger.log('IoT endpoint from JWT:', this.iotEndpoint);
    } catch (e) {
      this.logger.log('Failed to decode JWT:', e.message);
    }

    // Set legacy aliases for backward compatibility
    this.iotToken = this.accessToken;
    this.iotTokenExpiry = this.tokenExpiry;

    this.logger.log('Authentication successful, userId:', this.identityId);

    return {
      accessToken: this.accessToken,
      refreshToken: this.refreshToken,
      identityId: this.identityId,
      // Legacy fields
      iotToken: this.accessToken,
    };
  }

  /**
   * Refresh the session using OAuth2 refresh token
   * @returns {Promise<Object>} New session data
   */
  async refreshSession() {
    this.logger.log('Refreshing OAuth2 session...');

    if (!this.refreshToken) {
      throw new AuthenticationError('No refresh token available');
    }

    // Build refresh request
    const refreshRequest = {
      client_id: MAMMOTION_OAUTH2_CLIENT_ID,
      refresh_token: this.refreshToken,
      grant_type: 'refresh_token',
    };

    // Create OAuth signature
    const tokenEndpoint = '/oauth2/token';
    const { signature } = createMammotionOAuthSignature(refreshRequest, tokenEndpoint);

    // Build headers (use Ma-Iot-Signature for refresh, not Ma-Signature)
    const headers = {
      'User-Agent': 'okhttp/4.9.3',
      'App-Version': 'android,6.11.305',
      'Ma-App-Key': MAMMOTION_OAUTH2_CLIENT_ID,
      'Ma-Iot-Signature': signature,
      'Ma-Timestamp': Math.floor(Date.now() / 1000).toString(),
      'Client-Id': this.clientId,
      'Client-Type': '1',
    };

    try {
      // Build query string
      const queryString = Object.entries(refreshRequest)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join('&');

      const url = `${MAMMOTION_DOMAIN}${tokenEndpoint}?${queryString}`;
      const response = await this._request(url, {
        method: 'POST',
        headers,
      });

      if (response.data && response.data.access_token) {
        this.accessToken = response.data.access_token;
        this.iotToken = this.accessToken;

        if (response.data.refresh_token) {
          this.refreshToken = response.data.refresh_token;
        }

        this.tokenExpiry = Date.now() + (response.data.expires_in * 1000);
        this.iotTokenExpiry = this.tokenExpiry;

        this.logger.log('Session refreshed successfully');
        return { accessToken: this.accessToken, iotToken: this.accessToken };
      }
    } catch (error) {
      this.logger.log('Refresh failed:', error.message);
      // If refresh fails, try full re-authentication
      if (this.email && this.password) {
        this.logger.log('Attempting full re-authentication...');
        return this.authenticate(this.email, this.password);
      }
      throw error;
    }

    throw new AuthenticationError('Failed to refresh session');
  }

  /**
   * Check if authentication is valid
   * Consider token expired if less than 5 minutes remaining
   * @returns {boolean}
   */
  isAuthenticated() {
    const bufferTime = 5 * 60 * 1000; // 5 minutes
    const token = this.accessToken || this.iotToken;
    const expiry = this.tokenExpiry || this.iotTokenExpiry;
    return !!(token && expiry > (Date.now() + bufferTime));
  }

  /**
   * Get authentication state for storage
   * @returns {Object} Auth state
   */
  getAuthState() {
    return {
      // New OAuth2 fields
      accessToken: this.accessToken,
      refreshToken: this.refreshToken,
      tokenExpiry: this.tokenExpiry,
      identityId: this.identityId,
      clientId: this.clientId,
      iotEndpoint: this.iotEndpoint,
      region: this.region,
      email: this.email,
      // Legacy fields for backward compatibility
      iotToken: this.accessToken || this.iotToken,
      iotTokenExpiry: this.tokenExpiry || this.iotTokenExpiry,
    };
  }

  /**
   * Restore authentication state
   * Handles both new OAuth2 format and legacy format
   * @param {Object} state - Stored auth state
   */
  restoreAuthState(state) {
    if (state) {
      // New OAuth2 state format
      this.accessToken = state.accessToken || state.iotToken;
      this.refreshToken = state.refreshToken;
      this.tokenExpiry = state.tokenExpiry || state.iotTokenExpiry;
      this.identityId = state.identityId;
      this.clientId = state.clientId || generateMammotionClientId();
      this.iotEndpoint = state.iotEndpoint;
      this.region = state.region || DEFAULT_REGION;
      this.email = state.email;

      // Legacy aliases for backward compatibility
      this.iotToken = this.accessToken;
      this.iotTokenExpiry = this.tokenExpiry;
    }
  }

  /**
   * List devices bound to account using new Mammotion API
   * Tries both the domestic API and the IoT endpoint from JWT
   * @returns {Promise<Array>} List of devices
   */
  async listDevices() {
    this.logger.log('Fetching device list from Mammotion API...');

    const token = this.accessToken || this.iotToken;
    if (!token) {
      throw new AuthenticationError('Not authenticated');
    }

    const headers = {
      Authorization: `Bearer ${token}`,
      'User-Agent': 'okhttp/4.9.3',
      'App-Version': 'android,6.11.305',
    };

    // First try the domestic API endpoint
    let response = await this._retry(async () => {
      const url = `${MAMMOTION_API_DOMAIN}/device-server/v1/device/list`;
      return this._request(url, { method: 'GET', headers });
    });

    let devices = [];
    if (response.data) {
      devices = Array.isArray(response.data) ? response.data : (response.data.data || []);
    }

    // If no devices found, try the IoT endpoint from JWT
    if (devices.length === 0 && this.iotEndpoint) {
      this.logger.log('No devices from domestic API, trying IoT endpoint...');
      try {
        response = await this._retry(async () => {
          const url = `${this.iotEndpoint}/v1/user/device/page`;
          return this._request(url, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          });
        });

        if (response.data && response.data.records) {
          devices = response.data.records;
        }
      } catch (error) {
        this.logger.log('IoT endpoint failed:', error.message);
      }
    }

    this.logger.log(`Found ${devices.length} device(s)`);
    return devices;
  }

  /**
   * Get device status/properties
   * @param {string} iotId - Device IoT ID
   * @returns {Promise<Object>} Device properties
   */
  async getDeviceStatus(iotId) {
    const response = await this._retry(async () => {
      return this._signedRequest('/thing/properties/get', {
        iotId,
        propertyKeys: JSON.stringify(DEVICE_PROPERTIES),
      });
    });

    return response.data || {};
  }

  /**
   * Send command to device
   * @param {string} iotId - Device IoT ID
   * @param {string} command - Command name
   * @param {Object} params - Command parameters
   * @returns {Promise<Object>} Command response
   */
  async sendCommand(iotId, command, params = {}) {
    this.logger.log(`Sending command ${command} to device ${iotId}`);

    const response = await this._retry(async () => {
      return this._signedRequest('/thing/service/invoke', {
        iotId,
        identifier: command,
        args: JSON.stringify(params),
      });
    });

    return response.data || {};
  }

  /**
   * Start mowing
   * @param {string} iotId - Device IoT ID
   * @returns {Promise<Object>}
   */
  async startMowing(iotId) {
    return this.sendCommand(iotId, COMMANDS.START_MOWING);
  }

  /**
   * Pause mowing
   * @param {string} iotId - Device IoT ID
   * @returns {Promise<Object>}
   */
  async pauseMowing(iotId) {
    return this.sendCommand(iotId, COMMANDS.PAUSE_MOWING);
  }

  /**
   * Resume mowing
   * @param {string} iotId - Device IoT ID
   * @returns {Promise<Object>}
   */
  async resumeMowing(iotId) {
    return this.sendCommand(iotId, COMMANDS.RESUME_MOWING);
  }

  /**
   * Return to dock
   * @param {string} iotId - Device IoT ID
   * @returns {Promise<Object>}
   */
  async returnToDock(iotId) {
    return this.sendCommand(iotId, COMMANDS.RETURN_TO_DOCK);
  }

  /**
   * Stop mowing
   * @param {string} iotId - Device IoT ID
   * @returns {Promise<Object>}
   */
  async stopMowing(iotId) {
    return this.sendCommand(iotId, COMMANDS.STOP);
  }
}

module.exports = MammotionApi;
