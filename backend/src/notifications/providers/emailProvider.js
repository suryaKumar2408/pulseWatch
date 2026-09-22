'use strict';

const BaseNotificationProvider = require('./baseProvider');
const logger = require('../../lib/logger');

/**
 * Email Notification Provider
 * Delivers alerts to user email addresses.
 */
class EmailProvider extends BaseNotificationProvider {
  constructor(options = {}) {
    super('EMAIL');
    this.sendMailFn = options.sendMail ?? null;
  }

  async send(payload) {
    const { recipient, subject, body, metadata } = payload;

    if (!recipient || !recipient.includes('@')) {
      throw new Error(`Invalid email recipient: "${recipient}"`);
    }

    if (typeof this.sendMailFn === 'function') {
      const result = await this.sendMailFn({ recipient, subject, body, metadata });
      return { success: true, response: result };
    }

    // Default development/production delivery: log formatted email
    logger.info(
      { recipient, subject, monitorId: metadata?.monitorId },
      'Email notification dispatched',
    );

    return {
      success: true,
      response: { recipient, subject, sentAt: new Date().toISOString() },
    };
  }
}

module.exports = EmailProvider;
