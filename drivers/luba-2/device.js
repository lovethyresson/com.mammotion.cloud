'use strict';

const BaseMowerDevice = require('../../lib/base-mower-device');

/**
 * Device class for Mammotion Luba 2 AWD mowers
 */
class Luba2Device extends BaseMowerDevice {
  /**
   * onInit is called when the device is initialized
   */
  async onInit() {
    this.log('Luba 2 AWD device initializing...');
    await super.onInit();
    this.log('Luba 2 AWD device initialized');
  }
}

module.exports = Luba2Device;
