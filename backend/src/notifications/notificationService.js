'use strict';

/**
 * Notification Service
 *
 * Coordinates delivery of alerts for monitoring state change events (outages and recoveries).
 *
 * Guarantees:
 *  - Does not repeatedly notify for ongoing outages.
 *  - Records all notification attempts and outcomes (PENDING, DELIVERED, FAILED) in PostgreSQL.
 *  - Fault isolation: Notification delivery failures NEVER throw to the monitoring worker
 *    and NEVER disrupt health check processing or incident tracking.
 *  - Recoverability: Failed notifications can be retried automatically or via API.
 */

const { getDb } = require('../lib/db');
const { defaultRegistry } = require('./providers');
const logger = require('../lib/logger');

const NotificationEvents = Object.freeze({
  MONITOR_DOWN:      'MONITOR_DOWN',
  MONITOR_RECOVERED: 'MONITOR_RECOVERED',
});

/**
 * Formats subject and body for a state change alert.
 */
function formatNotificationContent({ monitor, event, transition, incident, checkResult }) {
  const monitorName = monitor.name || 'Unnamed Monitor';
  const monitorUrl  = monitor.url || '';
  const timestamp   = (transition.timestamp instanceof Date ? transition.timestamp : new Date()).toISOString();

  if (event === NotificationEvents.MONITOR_DOWN) {
    const reason = checkResult?.errorMessage ?? incident?.cause ?? '3 consecutive check failures';
    const code = checkResult?.errorCode ?? incident?.errorCode ?? 'UNKNOWN';

    return {
      subject: `[Outage Alert] ${monitorName} is DOWN`,
      body: `Monitor "${monitorName}" (${monitorUrl}) is DOWN.\nReason: ${reason} (${code})\nOutage started at: ${timestamp}`,
    };
  }

  if (event === NotificationEvents.MONITOR_RECOVERED) {
    const duration = incident?.durationSeconds != null ? `${incident.durationSeconds}s` : 'unknown duration';

    return {
      subject: `[Recovery] ${monitorName} is UP`,
      body: `Monitor "${monitorName}" (${monitorUrl}) has recovered.\nOutage duration: ${duration}\nRecovered at: ${timestamp}`,
    };
  }

  return {
    subject: `[Alert] ${monitorName} status changed`,
    body: `Monitor "${monitorName}" (${monitorUrl}) status changed at ${timestamp}`,
  };
}

/**
 * Dispatches a notification for a monitor state transition.
 * Safely handles and records delivery failures without throwing.
 *
 * @param {object} params
 * @param {object} params.monitor
 * @param {object} params.transition
 * @param {object} [params.incident]
 * @param {object} [params.checkResult]
 * @param {object} [params.user]
 * @param {object} [params.db]
 * @param {object} [params.registry]
 * @returns {Promise<object|null>} Result object containing notification record
 */
async function dispatchStateChangeNotification(params = {}) {
  const { monitor, transition, incident, checkResult, user } = params;

  if (!monitor || !transition) {
    return null;
  }

  // Determine if this transition warrants a notification
  let event = null;
  if (transition.to === 'DOWN') {
    event = NotificationEvents.MONITOR_DOWN;
  } else if (transition.from === 'DOWN' && transition.to === 'UP') {
    event = NotificationEvents.MONITOR_RECOVERED;
  } else {
    // Non-outage/recovery transitions (e.g. UNKNOWN -> UP, or UP -> UP) do not notify
    return null;
  }

  const db       = params.db ?? getDb();
  const registry = params.registry ?? defaultRegistry;
  const channel  = 'EMAIL';

  let recipient = user?.email;
  if (!recipient && monitor.userId) {
    try {
      const dbUser = await db.user.findUnique({ where: { id: monitor.userId } });
      recipient = dbUser?.email;
    } catch {
      // Ignore user lookup error; fallback will handle missing recipient
    }
  }

  // Fallback recipient if user email could not be loaded
  recipient = recipient || `user-${monitor.userId}@pulsewatch.internal`;

  const { subject, body } = formatNotificationContent({
    monitor,
    event,
    transition,
    incident,
    checkResult,
  });

  let notificationRecord;

  // 1. Record pending notification attempt in database
  try {
    notificationRecord = await db.notification.create({
      data: {
        userId:     monitor.userId,
        monitorId:  monitor.id,
        incidentId: incident?.id ?? null,
        event,
        channel,
        recipient,
        subject,
        body,
        status:   'PENDING',
        attempts: 0,
      },
    });
  } catch (err) {
    logger.error(
      { monitorId: monitor.id, err: err.message },
      'Failed to create notification record in database',
    );
    // Fault isolation: Never throw to the worker
    return null;
  }

  // 2. Attempt delivery through the registered provider
  try {
    const provider = registry.get(channel);

    await provider.send({
      recipient,
      subject,
      body,
      metadata: {
        notificationId: notificationRecord.id,
        monitorId:      monitor.id,
        incidentId:     incident?.id ?? null,
        event,
      },
    });

    // 3. Mark as delivered on success
    const updated = await db.notification.update({
      where: { id: notificationRecord.id },
      data: {
        status:   'DELIVERED',
        sentAt:   new Date(),
        attempts: { increment: 1 },
        error:    null,
      },
    });

    logger.info(
      { notificationId: updated.id, monitorId: monitor.id, event, recipient },
      'Notification successfully delivered',
    );

    return { notification: updated, delivered: true };
  } catch (deliveryErr) {
    // 4. Mark as failed and record error detail
    logger.error(
      {
        notificationId: notificationRecord.id,
        monitorId:      monitor.id,
        recipient,
        err:            deliveryErr.message,
      },
      'Notification delivery failed — recorded for recovery',
    );

    let updatedFailed;
    try {
      updatedFailed = await db.notification.update({
        where: { id: notificationRecord.id },
        data: {
          status:   'FAILED',
          error:    deliveryErr.message || 'Delivery error',
          attempts: { increment: 1 },
        },
      });
    } catch {
      updatedFailed = notificationRecord;
    }

    // Fault isolation: Return failed result without throwing
    return { notification: updatedFailed, delivered: false, error: deliveryErr.message };
  }
}

/**
 * Re-attempts delivery for a failed notification.
 *
 * @param {string} notificationId
 * @param {object} [options]
 * @param {object} [options.db]
 * @param {object} [options.registry]
 * @returns {Promise<object>}
 */
async function retryNotification(notificationId, options = {}) {
  const db       = options.db ?? getDb();
  const registry = options.registry ?? defaultRegistry;

  const notification = await db.notification.findUnique({
    where: { id: notificationId },
  });

  if (!notification) {
    throw new Error(`Notification not found: ${notificationId}`);
  }

  if (notification.status === 'DELIVERED') {
    return { notification, delivered: true, alreadyDelivered: true };
  }

  const provider = registry.get(notification.channel);

  try {
    await provider.send({
      recipient: notification.recipient,
      subject:   notification.subject,
      body:      notification.body,
      metadata: {
        notificationId: notification.id,
        monitorId:      notification.monitorId,
        incidentId:     notification.incidentId,
        event:          notification.event,
        retry:          true,
      },
    });

    const updated = await db.notification.update({
      where: { id: notification.id },
      data: {
        status:   'DELIVERED',
        sentAt:   new Date(),
        attempts: { increment: 1 },
        error:    null,
      },
    });

    return { notification: updated, delivered: true };
  } catch (err) {
    const updated = await db.notification.update({
      where: { id: notification.id },
      data: {
        status:   'FAILED',
        error:    err.message || 'Retry delivery error',
        attempts: { increment: 1 },
      },
    });

    return { notification: updated, delivered: false, error: err.message };
  }
}

module.exports = {
  NotificationEvents,
  formatNotificationContent,
  dispatchStateChangeNotification,
  retryNotification,
};
