'use strict';

const Homey = require('homey');
const MammotionApi = require('./mammotion-api');
const { MODEL_PATTERNS } = require('./constants');

/**
 * Base driver class for Mammotion mowers
 * Provides shared pairing logic for all mower types
 */
class BaseDriver extends Homey.Driver {
  /**
   * Get the model type this driver handles
   * Override in subclass
   * @returns {string} Model type (LUBA, LUBA_2, YUKA)
   */
  getModelType() {
    throw new Error('getModelType must be implemented by subclass');
  }

  /**
   * Get display name for this model
   * Override in subclass
   * @returns {string} Display name
   */
  getModelDisplayName() {
    return this.getModelType();
  }

  /**
   * Check if a device matches this driver's model type
   * @param {Object} device - Device from API
   * @returns {boolean}
   */
  isMatchingModel(device) {
    const modelType = this.getModelType();
    const patterns = MODEL_PATTERNS[modelType];

    if (!patterns) {
      return false;
    }

    const productName = (device.productName || device.name || '').toLowerCase();
    const productModel = (device.productModel || device.model || '').toLowerCase();
    const categoryKey = (device.categoryKey || '').toLowerCase();
    const combined = `${productName} ${productModel} ${categoryKey}`;

    // Check exclude patterns first (for LUBA vs LUBA_2 distinction)
    if (patterns.excludePatterns) {
      for (const pattern of patterns.excludePatterns) {
        if (combined.includes(pattern.toLowerCase())) {
          return false;
        }
      }
    }

    // Check include patterns
    for (const pattern of patterns.patterns) {
      if (combined.includes(pattern.toLowerCase())) {
        return true;
      }
    }

    return false;
  }

  /**
   * onInit is called when the driver is initialized
   */
  async onInit() {
    this.log(`${this.getModelDisplayName()} driver initialized`);
  }

  /**
   * onPairListDevices is called when a user is adding a device
   * and the 'list_devices' view is called
   */
  async onPairListDevices() {
    // This is handled in the pair session
    return [];
  }

  /**
   * onPair is called when pairing is initiated
   */
  onPair(session) {
    let api = null;
    let devices = [];

    // Handle login credentials
    session.setHandler('login', async (data) => {
      this.log('Login attempt for', data.username);

      try {
        api = new MammotionApi({ logger: this });
        await api.authenticate(data.username, data.password);

        // Store API instance in the app for sharing
        if (this.homey.app) {
          this.homey.app.api = api;
        }

        return true;
      } catch (error) {
        this.error('Login failed:', error.message);
        throw new Error(this.homey.__('pair.login.error') || 'Login failed: ' + error.message);
      }
    });

    // Handle device list request
    session.setHandler('list_devices', async () => {
      this.log('Listing devices...');

      if (!api) {
        throw new Error('Not authenticated');
      }

      try {
        const allDevices = await api.listDevices();

        // Filter devices by model type
        devices = allDevices
          .filter((device) => this.isMatchingModel(device))
          .map((device) => ({
            name: device.nickName || device.productName || device.name || 'Mammotion Mower',
            data: {
              id: device.iotId || device.deviceId,
              iotId: device.iotId,
              deviceId: device.deviceId,
              productKey: device.productKey,
            },
            store: {
              authState: api.getAuthState(),
            },
            settings: {
              model: device.productModel || device.model || 'Unknown',
              firmware: device.firmwareVersion || 'Unknown',
            },
          }));

        this.log(`Found ${devices.length} ${this.getModelDisplayName()} device(s)`);
        return devices;
      } catch (error) {
        this.error('Failed to list devices:', error.message);
        throw new Error('Failed to list devices: ' + error.message);
      }
    });

    // Handle settings requests during pairing
    session.setHandler('getSettings', async () => {
      return {
        dualAccountWarning: true,
      };
    });

    // Log when pairing is done
    session.setHandler('done', async () => {
      this.log('Pairing completed');
    });
  }

  /**
   * onRepair is called when repair is initiated
   */
  onRepair(session, device) {
    let api = null;

    session.setHandler('login', async (data) => {
      this.log('Repair login attempt for', data.username);

      try {
        api = new MammotionApi({ logger: this });
        await api.authenticate(data.username, data.password);

        // Update device store with new auth state
        await device.setStoreValue('authState', api.getAuthState());

        // Reinitialize the device
        if (device.initApi) {
          await device.initApi();
        }

        return true;
      } catch (error) {
        this.error('Repair login failed:', error.message);
        throw new Error('Login failed: ' + error.message);
      }
    });

    session.setHandler('done', async () => {
      this.log('Repair completed for', device.getName());
    });
  }
}

module.exports = BaseDriver;
