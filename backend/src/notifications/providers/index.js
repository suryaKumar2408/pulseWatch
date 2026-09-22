'use strict';

const BaseNotificationProvider = require('./baseProvider');
const EmailProvider = require('./emailProvider');
const WebhookProvider = require('./webhookProvider');

class ProviderRegistry {
  constructor() {
    this.providers = new Map();
    // Register default built-in providers
    this.register('EMAIL', new EmailProvider());
    this.register('WEBHOOK', new WebhookProvider());
  }

  register(channel, provider) {
    if (!channel || typeof channel !== 'string') {
      throw new Error('Channel name is required and must be a string');
    }
    if (!provider || typeof provider.send !== 'function') {
      throw new Error('Provider must implement a send() method');
    }
    this.providers.set(channel.toUpperCase(), provider);
  }

  get(channel) {
    const provider = this.providers.get(channel.toUpperCase());
    if (!provider) {
      throw new Error(`No notification provider registered for channel: "${channel}"`);
    }
    return provider;
  }

  has(channel) {
    return this.providers.has(channel.toUpperCase());
  }
}

const defaultRegistry = new ProviderRegistry();

module.exports = {
  BaseNotificationProvider,
  EmailProvider,
  WebhookProvider,
  ProviderRegistry,
  defaultRegistry,
};
