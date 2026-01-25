'use strict';

const BaseDriver = require('../../lib/base-driver');

/**
 * Driver for Mammotion Luba AWD mowers
 */
class LubaDriver extends BaseDriver {
  /**
   * Get the model type this driver handles
   * @returns {string}
   */
  getModelType() {
    return 'LUBA';
  }

  /**
   * Get display name for this model
   * @returns {string}
   */
  getModelDisplayName() {
    return 'Luba AWD';
  }

  /**
   * onInit is called when the driver is initialized
   */
  async onInit() {
    await super.onInit();

    // Register flow triggers
    this._mowingStartedTrigger = this.homey.flow.getDeviceTriggerCard('mowing_started');
    this._mowingFinishedTrigger = this.homey.flow.getDeviceTriggerCard('mowing_finished');
    this._mowerDockedTrigger = this.homey.flow.getDeviceTriggerCard('mower_docked');
    this._mowerErrorTrigger = this.homey.flow.getDeviceTriggerCard('mower_error');
    this._batteryLowTrigger = this.homey.flow.getDeviceTriggerCard('battery_low');
  }

  /**
   * Trigger mowing started flow
   * @param {Device} device
   */
  triggerMowingStarted(device) {
    this._mowingStartedTrigger.trigger(device).catch((err) => this.error('Trigger error:', err));
  }

  /**
   * Trigger mowing finished flow
   * @param {Device} device
   */
  triggerMowingFinished(device) {
    this._mowingFinishedTrigger.trigger(device).catch((err) => this.error('Trigger error:', err));
  }

  /**
   * Trigger mower docked flow
   * @param {Device} device
   */
  triggerMowerDocked(device) {
    this._mowerDockedTrigger.trigger(device).catch((err) => this.error('Trigger error:', err));
  }

  /**
   * Trigger mower error flow
   * @param {Device} device
   */
  triggerMowerError(device) {
    this._mowerErrorTrigger.trigger(device).catch((err) => this.error('Trigger error:', err));
  }

  /**
   * Trigger battery low flow
   * @param {Device} device
   */
  triggerBatteryLow(device) {
    this._batteryLowTrigger.trigger(device).catch((err) => this.error('Trigger error:', err));
  }
}

module.exports = LubaDriver;
