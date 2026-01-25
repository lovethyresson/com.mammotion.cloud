'use strict';

const BaseMowerDevice = require('../../lib/base-mower-device');

/**
 * Device class for Mammotion Yuka mowers
 */
class YukaDevice extends BaseMowerDevice {
  /**
   * onInit is called when the device is initialized
   */
  async onInit() {
    this.log('Yuka device initializing...');
    await super.onInit();
    this.log('Yuka device initialized');
  }
}

module.exports = YukaDevice;
