'use strict';

const Homey = require('homey');

/**
 * Mammotion Cloud App for Homey
 * Controls Mammotion robot lawn mowers (Luba, Luba 2, Yuka)
 */
class MammotionApp extends Homey.App {
  /**
   * onInit is called when the app is initialized
   */
  async onInit() {
    this.log('Mammotion app initializing...');

    // Shared API instance (can be used across drivers)
    this.api = null;

    // Register flow action cards
    await this.registerFlowActions();

    // Register flow condition cards
    await this.registerFlowConditions();

    this.log('Mammotion app initialized');
  }

  /**
   * Register flow action cards
   */
  async registerFlowActions() {
    // Start mowing action
    const startMowingAction = this.homey.flow.getActionCard('start_mowing');
    startMowingAction.registerRunListener(async (args) => {
      this.log('Flow action: start_mowing for', args.device.getName());
      await args.device.startMowing();
    });

    // Pause mowing action
    const pauseMowingAction = this.homey.flow.getActionCard('pause_mowing');
    pauseMowingAction.registerRunListener(async (args) => {
      this.log('Flow action: pause_mowing for', args.device.getName());
      await args.device.pauseMowing();
    });

    // Return to dock action
    const returnToDockAction = this.homey.flow.getActionCard('return_to_dock');
    returnToDockAction.registerRunListener(async (args) => {
      this.log('Flow action: return_to_dock for', args.device.getName());
      await args.device.returnToDock();
    });
  }

  /**
   * Register flow condition cards
   */
  async registerFlowConditions() {
    // Is mowing condition
    const isMowingCondition = this.homey.flow.getConditionCard('is_mowing');
    isMowingCondition.registerRunListener(async (args) => {
      const isMowing = args.device.isMowing();
      this.log('Flow condition: is_mowing for', args.device.getName(), '=', isMowing);
      return isMowing;
    });

    // Is docked condition
    const isDockedCondition = this.homey.flow.getConditionCard('is_docked');
    isDockedCondition.registerRunListener(async (args) => {
      const isDocked = args.device.isDocked();
      this.log('Flow condition: is_docked for', args.device.getName(), '=', isDocked);
      return isDocked;
    });

    // Battery above condition
    const batteryAboveCondition = this.homey.flow.getConditionCard('battery_above');
    batteryAboveCondition.registerRunListener(async (args) => {
      const battery = args.device.getBatteryLevel();
      const isAbove = battery > args.percentage;
      this.log('Flow condition: battery_above for', args.device.getName(), '- battery:', battery, '> threshold:', args.percentage, '=', isAbove);
      return isAbove;
    });
  }

  /**
   * Get settings data for settings page
   * Called by Homey.get() from settings page
   */
  async getSettings(key) {
    if (key === 'connectionStatus') {
      return {
        connected: this.api && this.api.isAuthenticated(),
      };
    }

    if (key === 'devices') {
      const devices = [];

      // Get all drivers
      const drivers = this.homey.drivers.getDrivers();

      for (const driverId of Object.keys(drivers)) {
        const driver = drivers[driverId];
        const driverDevices = driver.getDevices();

        for (const device of driverDevices) {
          devices.push({
            name: device.getName(),
            online: device.getAvailable(),
          });
        }
      }

      return devices;
    }

    return null;
  }
}

module.exports = MammotionApp;
