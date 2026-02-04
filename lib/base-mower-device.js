'use strict';

const Homey = require('homey');
const MammotionApi = require('./mammotion-api');
const {
  DEFAULT_POLL_INTERVAL,
  MOWER_STATES,
} = require('./constants');
const {
  TokenExpiredError,
  SessionInvalidError,
  DeviceOfflineError,
} = require('./errors');

/**
 * Base device class for Mammotion mowers
 * Provides shared polling, status updates, and command handling
 */
class BaseMowerDevice extends Homey.Device {
  /**
   * onInit is called when the device is initialized
   */
  async onInit() {
    this.log('Initializing device:', this.getName());

    // Initialize state
    this._pollInterval = null;
    this._api = null;
    this._lastState = null;

    // Register capability listeners
    this.registerCapabilityListener('onoff', this.onCapabilityOnOff.bind(this));

    // Initialize API and start polling
    await this.initApi();
    this.startPolling();

    this.log('Device initialized:', this.getName());
  }

  /**
   * Initialize or restore API client
   */
  async initApi() {
    try {
      const authState = this.getStoreValue('authState');

      if (!authState) {
        this.setUnavailable(this.homey.__('device.no_credentials') || 'No credentials stored');
        return;
      }

      this._api = new MammotionApi({ logger: this });
      this._api.restoreAuthState(authState);

      // Check if we need to refresh
      if (!this._api.isAuthenticated()) {
        this.log('Token expired, refreshing...');
        try {
          await this._api.refreshSession();
          await this.setStoreValue('authState', this._api.getAuthState());
        } catch (error) {
          this.error('Failed to refresh session:', error.message);
          this.setUnavailable(this.homey.__('device.auth_failed') || 'Authentication failed');
          return;
        }
      }

      await this.setAvailable();
    } catch (error) {
      this.error('Failed to initialize API:', error.message);
      this.setUnavailable(error.message);
    }
  }

  /**
   * Get device IoT ID
   * @returns {string}
   */
  getIotId() {
    const data = this.getData();
    return data.iotId || data.id;
  }

  /**
   * Start polling for device status
   */
  startPolling() {
    this.stopPolling();

    const interval = this.getSetting('pollInterval') * 1000 || DEFAULT_POLL_INTERVAL;
    this.log(`Starting polling every ${interval}s`);

    // Poll immediately
    this.pollStatus();

    // Set up interval
    this._pollInterval = this.homey.setInterval(() => {
      this.pollStatus();
    }, interval);
  }

  /**
   * Stop polling
   */
  stopPolling() {
    if (this._pollInterval) {
      this.homey.clearInterval(this._pollInterval);
      this._pollInterval = null;
    }
  }

  /**
   * Poll device status
   */
  async pollStatus() {
    if (!this._api) {
      return;
    }

    try {
      const status = await this._api.getDeviceStatus(this.getIotId());
      await this.updateStatus(status);
      await this.setAvailable();
    } catch (error) {
      this.error('Poll failed:', error.message);

      if (error instanceof TokenExpiredError || error instanceof SessionInvalidError) {
        try {
          await this._api.refreshSession();
          await this.setStoreValue('authState', this._api.getAuthState());
        } catch (refreshError) {
          this.setUnavailable(this.homey.__('device.auth_failed') || 'Authentication failed');
        }
      } else if (error instanceof DeviceOfflineError) {
        await this.setCapabilityValue('mower_state', MOWER_STATES.OFFLINE).catch(() => {});
        // Don't set unavailable, just show offline state
      } else {
        // For other errors, log but don't set unavailable unless persistent
      }
    }
  }

  /**
   * Update device status from API response
   * @param {Object} status - Status from API
   */
  async updateStatus(status) {
    const previousState = this._lastState;

    // Update battery
    if (status.batteryLevel !== undefined) {
      await this.setCapabilityValue('measure_battery', status.batteryLevel).catch(() => {});

      // Update low battery alarm
      const lowBattery = status.batteryLevel < 20;
      await this.setCapabilityValue('alarm_battery', lowBattery).catch(() => {});
    }

    // Determine mower state
    let mowerState = MOWER_STATES.IDLE;
    if (status.workState !== undefined) {
      switch (status.workState) {
        case 1: // Mowing
          mowerState = MOWER_STATES.MOWING;
          break;
        case 2: // Charging
          mowerState = MOWER_STATES.CHARGING;
          break;
        case 3: // Returning
          mowerState = MOWER_STATES.RETURNING;
          break;
        case 4: // Paused
          mowerState = MOWER_STATES.PAUSED;
          break;
        case 5: // Error
          mowerState = MOWER_STATES.ERROR;
          break;
        default:
          mowerState = MOWER_STATES.IDLE;
      }
    } else if (status.chargeState === 1) {
      mowerState = MOWER_STATES.CHARGING;
    }

    // Update mower state capability
    if (this.hasCapability('mower_state')) {
      await this.setCapabilityValue('mower_state', mowerState).catch(() => {});
    }

    // Update onoff based on mowing state
    const isMowing = mowerState === MOWER_STATES.MOWING;
    await this.setCapabilityValue('onoff', isMowing).catch(() => {});

    // Update activity description
    if (this.hasCapability('mower_activity')) {
      const activity = this.getActivityDescription(mowerState, status);
      await this.setCapabilityValue('mower_activity', activity).catch(() => {});
    }

    // Trigger flows based on state changes
    this._lastState = mowerState;
    if (previousState && previousState !== mowerState) {
      this.triggerStateChangeFlows(previousState, mowerState);
    }
  }

  /**
   * Get activity description for current state
   * @param {string} state - Mower state
   * @param {Object} status - Full status object
   * @returns {string}
   */
  getActivityDescription(state, status) {
    const descriptions = {
      [MOWER_STATES.IDLE]: this.homey.__('state.idle') || 'Idle',
      [MOWER_STATES.MOWING]: this.homey.__('state.mowing') || 'Mowing',
      [MOWER_STATES.CHARGING]: this.homey.__('state.charging') || 'Charging',
      [MOWER_STATES.RETURNING]: this.homey.__('state.returning') || 'Returning to dock',
      [MOWER_STATES.PAUSED]: this.homey.__('state.paused') || 'Paused',
      [MOWER_STATES.ERROR]: this.homey.__('state.error') || 'Error',
      [MOWER_STATES.OFFLINE]: this.homey.__('state.offline') || 'Offline',
    };

    let description = descriptions[state] || 'Unknown';

    // Add progress info if mowing
    if (state === MOWER_STATES.MOWING && status.mowedArea && status.totalArea) {
      const progress = Math.round((status.mowedArea / status.totalArea) * 100);
      description += ` (${progress}%)`;
    }

    return description;
  }

  /**
   * Trigger flow cards based on state changes
   * @param {string} previousState - Previous state
   * @param {string} newState - New state
   */
  triggerStateChangeFlows(previousState, newState) {
    // Mowing started
    if (newState === MOWER_STATES.MOWING && previousState !== MOWER_STATES.MOWING) {
      this.driver.triggerMowingStarted(this);
    }

    // Mowing finished (went from mowing to idle/charging)
    if (previousState === MOWER_STATES.MOWING &&
        (newState === MOWER_STATES.IDLE || newState === MOWER_STATES.CHARGING)) {
      this.driver.triggerMowingFinished(this);
    }

    // Docked
    if (newState === MOWER_STATES.CHARGING && previousState !== MOWER_STATES.CHARGING) {
      this.driver.triggerMowerDocked(this);
    }

    // Error
    if (newState === MOWER_STATES.ERROR && previousState !== MOWER_STATES.ERROR) {
      this.driver.triggerMowerError(this);
    }
  }

  /**
   * Handle on/off capability
   * @param {boolean} value - true = start mowing, false = stop
   */
  async onCapabilityOnOff(value) {
    this.log('onoff capability changed to:', value);

    if (!this._api) {
      throw new Error(this.homey.__('device.not_connected') || 'Not connected');
    }

    try {
      if (value) {
        await this._api.startMowing(this.getIotId());
      } else {
        await this._api.stopMowing(this.getIotId());
      }

      // Poll immediately to update status
      await this.pollStatus();
    } catch (error) {
      this.error('Command failed:', error.message);
      throw new Error(error.message);
    }
  }

  /**
   * Start mowing (for flow actions)
   */
  async startMowing() {
    if (!this._api) {
      throw new Error('Not connected');
    }
    await this._api.startMowing(this.getIotId());
    await this.pollStatus();
  }

  /**
   * Pause mowing (for flow actions)
   */
  async pauseMowing() {
    if (!this._api) {
      throw new Error('Not connected');
    }
    await this._api.pauseMowing(this.getIotId());
    await this.pollStatus();
  }

  /**
   * Return to dock (for flow actions)
   */
  async returnToDock() {
    if (!this._api) {
      throw new Error('Not connected');
    }
    await this._api.returnToDock(this.getIotId());
    await this.pollStatus();
  }

  /**
   * Check if mower is currently mowing
   * @returns {boolean}
   */
  isMowing() {
    return this._lastState === MOWER_STATES.MOWING;
  }

  /**
   * Check if mower is docked/charging
   * @returns {boolean}
   */
  isDocked() {
    return this._lastState === MOWER_STATES.CHARGING;
  }

  /**
   * Get current battery level
   * @returns {number}
   */
  getBatteryLevel() {
    return this.getCapabilityValue('measure_battery') || 0;
  }

  /**
   * onSettings is called when settings are changed
   */
  async onSettings({ oldSettings: _oldSettings, newSettings: _newSettings, changedKeys }) {
    this.log('Settings changed:', changedKeys);

    if (changedKeys.includes('pollInterval')) {
      this.startPolling();
    }
  }

  /**
   * onDeleted is called when the device is deleted
   */
  async onDeleted() {
    this.log('Device deleted:', this.getName());
    this.stopPolling();
  }
}

module.exports = BaseMowerDevice;
