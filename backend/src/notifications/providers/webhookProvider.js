'use strict';

const BaseNotificationProvider = require('./baseProvider');
const logger = require('../../lib/logger');
const { validateUrlSsrf } = require('../../lib/ssrf');

/**
 * Webhook Notification Provider
 * Delivers alerts via HTTP POST JSON webhooks.
 */
class WebhookProvider extends BaseNotificationProvider {
  constructor(options = {}) {
    super('WEBHOOK');
    this.fetchFn = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.skipSsrf = options.skipSsrf ?? false;
  }

  async send(payload) {
    const { recipient: webhookUrl, subject, body, metadata } = payload;

    if (!webhookUrl || !webhookUrl.startsWith('http')) {
      throw new Error(`Invalid webhook URL: "${webhookUrl}"`);
    }

    if (!this.skipSsrf) {
      const ssrfCheck = await validateUrlSsrf(webhookUrl);
      if (!ssrfCheck.safe) {
        throw new Error(`Webhook URL rejected by SSRF policy: ${ssrfCheck.reason}`);
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchFn(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'PulseWatch-Webhook/1.0',
        },
        body: JSON.stringify({
          event: metadata?.event,
          subject,
          body,
          metadata,
          timestamp: new Date().toISOString(),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Webhook endpoint returned HTTP ${response.status}`);
      }

      logger.info({ webhookUrl, status: response.status }, 'Webhook notification delivered');

      return {
        success: true,
        response: { status: response.status },
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

module.exports = WebhookProvider;
