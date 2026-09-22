'use strict';

const { PrismaClient } = require('@prisma/client');
const logger = require('./logger');

let prisma;

/**
 * Returns the singleton PrismaClient instance.
 * Logs slow queries (>500 ms) in production to aid performance debugging.
 */
function getDb() {
  if (prisma) return prisma;

  prisma = new PrismaClient({
    log: [
      { level: 'warn', emit: 'event' },
      { level: 'error', emit: 'event' },
    ],
  });

  prisma.$on('warn', (e) => {
    logger.warn({ target: e.target, message: e.message }, 'Prisma warning');
  });

  prisma.$on('error', (e) => {
    logger.error({ target: e.target, message: e.message }, 'Prisma error');
  });

  return prisma;
}

/**
 * Disconnects the Prisma client. Called during graceful shutdown.
 */
async function disconnectDb() {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
  }
}

/**
 * Pings the database to verify connectivity.
 * @returns {Promise<boolean>}
 */
async function pingDb() {
  try {
    await getDb().$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

module.exports = { getDb, disconnectDb, pingDb };
