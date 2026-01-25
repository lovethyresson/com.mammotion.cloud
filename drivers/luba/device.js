'use strict';

const BaseMowerDevice = require('../../lib/base-mower-device');

/**
 * Device class for Mammotion Luba AWD mowers
 */
class LubaDevice extends BaseMowerDevice {
  /**
   * onInit is called when the device is initialized
   */
  async onInit() {
    this.log('Luba AWD device initializing...');
    await super.onInit();
    this.log('Luba AWD device initialized');
  }
}

module.exports = LubaDevice;
