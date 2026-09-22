'use strict';

const {
  QUEUE_NAME,
  DEFAULT_JOB_OPTIONS,
  getHealthCheckQueue,
  enqueueHealthCheck,
  closeHealthCheckQueue,
} = require('./healthCheckQueue');

const {
  DEFAULT_CONCURRENCY,
  processMonitorCheckJob,
  createHealthCheckWorker,
} = require('./healthCheckWorker');

module.exports = {
  QUEUE_NAME,
  DEFAULT_JOB_OPTIONS,
  DEFAULT_CONCURRENCY,
  getHealthCheckQueue,
  enqueueHealthCheck,
  closeHealthCheckQueue,
  processMonitorCheckJob,
  createHealthCheckWorker,
};
