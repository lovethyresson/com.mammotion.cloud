'use strict';

const https = require('https');
const { URL } = require('url');
const {
  APP_KEY,
  OAUTH_BASE_URL,
  ALIYUN_OPENACCOUNT_URL,
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

    // Authentication state
    this.deviceId = null;
    this.vid = null;
    this.iotToken = null;
    this.refreshToken = null;
    this.identityId = null;
    this.iotTokenExpiry = null;
    this.refreshTokenExpiry = null;

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
   * Step 1: Connect to get device ID and VID
   * @returns {Promise<Object>} Device ID and VID
   */
  async connect() {
    this.logger.log('Connecting to Mammotion cloud...');

    const connectUrl = `${ALIYUN_OPENACCOUNT_URL}/api/appauth/getAppConfig`;
    const response = await this._postForm(connectUrl, {
      appKey: APP_KEY,
      language: 'en',
    });

    if (!response.data) {
      throw new ApiError('Failed to get app config', null, response);
    }

    this.deviceId = generateUUID();
    this.vid = response.data.vid || generateUUID();

    this.logger.log('Connected, deviceId:', this.deviceId);
    return { deviceId: this.deviceId, vid: this.vid };
  }

  /**
   * Step 2: Login with OAuth (email/password)
   * @param {string} email - User email
   * @param {string} password - User password
   * @returns {Promise<string>} Authorization code
   */
  async loginByOAuth(email, password) {
    this.logger.log('Logging in with OAuth...');

    // Store credentials for re-authentication
    this.email = email;
    this.password = password;

    // Step 2a: Build authorization parameters for OAuth
    const authParams = {
      response_type: 'code',
      client_id: APP_KEY,
      redirect_uri: 'https://localhost/callback',
      state: generateUUID(),
    };

    // Login request
    const loginUrl = `${OAUTH_BASE_URL}/oauth/login`;
    const response = await this._postForm(loginUrl, {
      username: email,
      password,
      ...authParams,
    });

    if (!response.code && !response.authorization_code) {
      // Try alternate endpoint
      const altResponse = await this._postForm(`${OAUTH_BASE_URL}/api/user/login`, {
        email,
        password,
        client_id: APP_KEY,
      });

      if (altResponse.data && altResponse.data.authorization_code) {
        return altResponse.data.authorization_code;
      }

      throw new AuthenticationError('Login failed: ' + (response.message || 'Unknown error'));
    }

    return response.code || response.authorization_code;
  }

  /**
   * Step 3: Create session with authorization code
   * @param {string} authCode - Authorization code from OAuth
   * @returns {Promise<Object>} Session data with tokens
   */
  async createSession(authCode) {
    this.logger.log('Creating session...');

    const tokenUrl = `${OAUTH_BASE_URL}/oauth/token`;
    const response = await this._postForm(tokenUrl, {
      grant_type: 'authorization_code',
      code: authCode,
      client_id: APP_KEY,
      redirect_uri: 'https://localhost/callback',
    });

    if (!response.access_token && !response.iotToken) {
      throw new AuthenticationError('Failed to get session token');
    }

    // Extract tokens
    this.iotToken = response.iotToken || response.access_token;
    this.refreshToken = response.refreshToken || response.refresh_token;
    this.identityId = response.identityId || response.user_id;

    // Set expiration times
    const now = Date.now();
    this.iotTokenExpiry = now + (response.expires_in ? response.expires_in * 1000 : IOT_TOKEN_LIFETIME);
    this.refreshTokenExpiry = now + (response.refresh_expires_in ? response.refresh_expires_in * 1000 : 30 * 24 * 60 * 60 * 1000);

    // Detect region from response
    if (response.region) {
      this.region = response.region;
    }

    this.logger.log('Session created, identityId:', this.identityId);
    return {
      iotToken: this.iotToken,
      refreshToken: this.refreshToken,
      identityId: this.identityId,
      region: this.region,
    };
  }

  /**
   * Refresh the session using refresh token
   * @returns {Promise<Object>} New session data
   */
  async refreshSession() {
    this.logger.log('Refreshing session...');

    if (!this.refreshToken) {
      throw new AuthenticationError('No refresh token available');
    }

    try {
      const tokenUrl = `${OAUTH_BASE_URL}/oauth/token`;
      const response = await this._postForm(tokenUrl, {
        grant_type: 'refresh_token',
        refresh_token: this.refreshToken,
        client_id: APP_KEY,
      });

      if (response.access_token || response.iotToken) {
        this.iotToken = response.iotToken || response.access_token;
        if (response.refresh_token || response.refreshToken) {
          this.refreshToken = response.refreshToken || response.refresh_token;
        }
        this.iotTokenExpiry = Date.now() + IOT_TOKEN_LIFETIME;

        this.logger.log('Session refreshed successfully');
        return { iotToken: this.iotToken };
      }
    } catch (error) {
      // If refresh fails, try full re-authentication
      if (this.email && this.password) {
        this.logger.log('Refresh failed, attempting full re-authentication...');
        return this.authenticate(this.email, this.password);
      }
      throw error;
    }

    throw new AuthenticationError('Failed to refresh session');
  }

  /**
   * Full authentication flow
   * @param {string} email - User email
   * @param {string} password - User password
   * @returns {Promise<Object>} Session data
   */
  async authenticate(email, password) {
    await this.connect();
    const authCode = await this.loginByOAuth(email, password);
    return this.createSession(authCode);
  }

  /**
   * Check if authentication is valid
   * @returns {boolean}
   */
  isAuthenticated() {
    return !!(this.iotToken && this.iotTokenExpiry > Date.now());
  }

  /**
   * Get authentication state for storage
   * @returns {Object} Auth state
   */
  getAuthState() {
    return {
      deviceId: this.deviceId,
      vid: this.vid,
      iotToken: this.iotToken,
      refreshToken: this.refreshToken,
      identityId: this.identityId,
      iotTokenExpiry: this.iotTokenExpiry,
      refreshTokenExpiry: this.refreshTokenExpiry,
      region: this.region,
      email: this.email,
    };
  }

  /**
   * Restore authentication state
   * @param {Object} state - Stored auth state
   */
  restoreAuthState(state) {
    if (state) {
      this.deviceId = state.deviceId;
      this.vid = state.vid;
      this.iotToken = state.iotToken;
      this.refreshToken = state.refreshToken;
      this.identityId = state.identityId;
      this.iotTokenExpiry = state.iotTokenExpiry;
      this.refreshTokenExpiry = state.refreshTokenExpiry;
      this.region = state.region || DEFAULT_REGION;
      this.email = state.email;
    }
  }

  /**
   * List devices bound to account
   * @returns {Promise<Array>} List of devices
   */
  async listDevices() {
    this.logger.log('Fetching device list...');

    const response = await this._retry(async () => {
      return this._signedRequest('/uc/listBindingByAccount', {
        pageNo: 1,
        pageSize: 100,
      });
    });

    if (!response.data) {
      return [];
    }

    const devices = response.data.data || response.data || [];
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
