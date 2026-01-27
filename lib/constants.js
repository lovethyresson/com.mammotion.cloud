'use strict';

/**
 * Mammotion Cloud API Constants
 * Based on PyMammotion implementation
 */

// Alibaba Cloud IoT App credentials (legacy - kept for device commands)
const APP_KEY = '34231230';
const APP_SECRET = '1ba85698bb10e19c6437413b61ba3445';

// New Mammotion OAuth2 credentials (from PyMammotion)
const MAMMOTION_OAUTH2_CLIENT_ID = 'GxebgSt8si6pKqR';
const MAMMOTION_OAUTH2_CLIENT_SECRET = 'JP0508SRJFa0A90ADpzLINDBxMa4Vj';

// Mammotion API endpoints
const MAMMOTION_DOMAIN = 'https://id.mammotion.com';
const MAMMOTION_API_DOMAIN = 'https://domestic.mammotion.com';

// Legacy OAuth endpoints (kept for reference)
const OAUTH_BASE_URL = 'https://id.mammotion.com';
const OAUTH_AUTHORIZE_URL = `${OAUTH_BASE_URL}/oauth/authorize`;
const OAUTH_TOKEN_URL = `${OAUTH_BASE_URL}/oauth/token`;

// Alibaba Cloud IoT API endpoint (still used for device commands)
const ALIYUN_IOT_API_URL = 'https://api.link.aliyun.com';

// Regional IoT Gateway endpoints
const REGIONS = {
  EU: {
    name: 'Europe',
    iotEndpoint: 'a1tuOt0llT8.iot-as-eu-central-1.aliyuncs.com',
    region: 'eu-central-1',
  },
  US: {
    name: 'United States',
    iotEndpoint: 'a1tuOt0llT8.iot-as-us-east-1.aliyuncs.com',
    region: 'us-east-1',
  },
  AP: {
    name: 'Asia Pacific',
    iotEndpoint: 'a1tuOt0llT8.iot-as-ap-southeast-1.aliyuncs.com',
    region: 'ap-southeast-1',
  },
  AU: {
    name: 'Australia',
    iotEndpoint: 'a1tuOt0llT8.iot-as-ap-southeast-2.aliyuncs.com',
    region: 'ap-southeast-2',
  },
};

// Default region for initial connection
const DEFAULT_REGION = 'EU';

// Token expiration times (in milliseconds)
const IOT_TOKEN_LIFETIME = 2 * 60 * 60 * 1000; // 2 hours
const REFRESH_TOKEN_LIFETIME = 30 * 24 * 60 * 60 * 1000; // 30 days

// Polling intervals
const DEFAULT_POLL_INTERVAL = 30000; // 30 seconds
const MIN_POLL_INTERVAL = 15000; // 15 seconds
const MAX_POLL_INTERVAL = 60000; // 60 seconds

// API retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second base delay
const RETRY_MULTIPLIER = 2; // Exponential backoff multiplier

// Mower states
const MOWER_STATES = {
  IDLE: 'idle',
  MOWING: 'mowing',
  CHARGING: 'charging',
  RETURNING: 'returning',
  PAUSED: 'paused',
  ERROR: 'error',
  OFFLINE: 'offline',
};

// Mower model identification patterns
const MODEL_PATTERNS = {
  LUBA: {
    patterns: ['luba', 'LubaAWD'],
    excludePatterns: ['luba2', 'luba-2', 'luba 2', 'luba mini', 'lubamini'],
  },
  LUBA_2: {
    patterns: ['luba2', 'luba-2', 'luba 2', 'Luba2', 'luba mini', 'lubamini', 'luba-mini'],
  },
  YUKA: {
    patterns: ['yuka'],
  },
};

// Command types for IoT service invocation
const COMMANDS = {
  START_MOWING: 'start_task',
  PAUSE_MOWING: 'pause_task',
  RESUME_MOWING: 'resume_task',
  RETURN_TO_DOCK: 'return_to_dock',
  STOP: 'stop_task',
};

// Device properties to request
const DEVICE_PROPERTIES = [
  'batteryLevel',
  'chargeState',
  'workState',
  'errorCode',
  'location',
  'speed',
  'totalArea',
  'mowedArea',
];

// Error codes
const ERROR_CODES = {
  TOKEN_EXPIRED: 460,
  SESSION_INVALID: 2401,
  RATE_LIMITED: 429,
  DEVICE_OFFLINE: 6205,
  UNAUTHORIZED: 401,
};

module.exports = {
  APP_KEY,
  APP_SECRET,
  MAMMOTION_OAUTH2_CLIENT_ID,
  MAMMOTION_OAUTH2_CLIENT_SECRET,
  MAMMOTION_DOMAIN,
  MAMMOTION_API_DOMAIN,
  OAUTH_BASE_URL,
  OAUTH_AUTHORIZE_URL,
  OAUTH_TOKEN_URL,
  ALIYUN_IOT_API_URL,
  REGIONS,
  DEFAULT_REGION,
  IOT_TOKEN_LIFETIME,
  REFRESH_TOKEN_LIFETIME,
  DEFAULT_POLL_INTERVAL,
  MIN_POLL_INTERVAL,
  MAX_POLL_INTERVAL,
  MAX_RETRIES,
  RETRY_DELAY,
  RETRY_MULTIPLIER,
  MOWER_STATES,
  MODEL_PATTERNS,
  COMMANDS,
  DEVICE_PROPERTIES,
  ERROR_CODES,
};
