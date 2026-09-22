'use strict';

/**
 * Base Notification Provider Interface
 */
class BaseNotificationProvider {
  constructor(name) {
    this.name = name;
  }

  /**
   * Sends a notification payload.
   * Must return { success: true, response: any } on success,
   * or throw an Error on failure.
   *
   * @param {object} payload
   * @param {string} payload.recipient
   * @param {string} payload.subject
   * @param {string} payload.body
   * @param {object} [payload.metadata]
   * @returns {Promise<{ success: boolean, response?: any }>}
   */
  async send(_payload) {
    throw new Error(`Provider "${this.name}" must implement send()`);
  }
}

module.exports = BaseNotificationProvider;
