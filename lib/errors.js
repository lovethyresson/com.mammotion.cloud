'use strict';

/**
 * Custom error classes for Mammotion API
 */

class MammotionError extends Error {
  constructor(message, code = null, details = null) {
    super(message);
    this.name = 'MammotionError';
    this.code = code;
    this.details = details;
  }
}

class AuthenticationError extends MammotionError {
  constructor(message, code = null, details = null) {
    super(message, code, details);
    this.name = 'AuthenticationError';
  }
}

class TokenExpiredError extends AuthenticationError {
  constructor(message = 'Token has expired', code = 460) {
    super(message, code);
    this.name = 'TokenExpiredError';
  }
}

class SessionInvalidError extends AuthenticationError {
  constructor(message = 'Session is invalid', code = 2401) {
    super(message, code);
    this.name = 'SessionInvalidError';
  }
}

class RateLimitError extends MammotionError {
  constructor(message = 'Rate limit exceeded', retryAfter = null) {
    super(message, 429);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

class DeviceOfflineError extends MammotionError {
  constructor(message = 'Device is offline', deviceId = null) {
    super(message, 6205);
    this.name = 'DeviceOfflineError';
    this.deviceId = deviceId;
  }
}

class DeviceNotFoundError extends MammotionError {
  constructor(message = 'Device not found', deviceId = null) {
    super(message, 404);
    this.name = 'DeviceNotFoundError';
    this.deviceId = deviceId;
  }
}

class ApiError extends MammotionError {
  constructor(message, code = null, response = null) {
    super(message, code);
    this.name = 'ApiError';
    this.response = response;
  }
}

class NetworkError extends MammotionError {
  constructor(message = 'Network error occurred', originalError = null) {
    super(message);
    this.name = 'NetworkError';
    this.originalError = originalError;
  }
}

class CommandError extends MammotionError {
  constructor(message, command = null, deviceId = null) {
    super(message);
    this.name = 'CommandError';
    this.command = command;
    this.deviceId = deviceId;
  }
}

module.exports = {
  MammotionError,
  AuthenticationError,
  TokenExpiredError,
  SessionInvalidError,
  RateLimitError,
  DeviceOfflineError,
  DeviceNotFoundError,
  ApiError,
  NetworkError,
  CommandError,
};
