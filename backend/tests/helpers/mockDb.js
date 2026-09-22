'use strict';

/**
 * Factory that returns a fresh Jest mock of the Prisma client.
 * Call this in beforeEach so mocks don't bleed between tests.
 */
function createMockDb() {
  const mockClient = {
    user: {
      create:     jest.fn(),
      findUnique: jest.fn(),
      findFirst:  jest.fn(),
    },
    monitor: {
      create:     jest.fn(),
      findUnique: jest.fn(),
      findFirst:  jest.fn(),
      findMany:   jest.fn(),
      update:     jest.fn(),
      delete:     jest.fn(),
      count:      jest.fn(),
    },
    checkResult: {
      create:   jest.fn(({ data } = {}) => Promise.resolve({ id: 'mock-check-id', ...data })),
      findMany: jest.fn().mockResolvedValue([]),
      count:    jest.fn().mockResolvedValue(0),
    },
    incident: {
      create:     jest.fn(({ data } = {}) => Promise.resolve({ id: 'mock-inc-id', ...data })),
      findUnique: jest.fn(),
      findFirst:  jest.fn().mockResolvedValue(null),
      findMany:   jest.fn().mockResolvedValue([]),
      update:     jest.fn(({ data } = {}) => Promise.resolve({ id: 'mock-inc-id', ...data })),
      count:      jest.fn().mockResolvedValue(0),
    },
    notification: {
      create:     jest.fn(({ data } = {}) => Promise.resolve({ id: 'mock-notif-id', ...data })),
      findUnique: jest.fn(),
      findFirst:  jest.fn().mockResolvedValue(null),
      findMany:   jest.fn().mockResolvedValue([]),
      update:     jest.fn(({ data } = {}) => Promise.resolve({ id: 'mock-notif-id', ...data })),
      count:      jest.fn().mockResolvedValue(0),
    },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn(async (cb) => {
      if (typeof cb === 'function') {
        return cb(mockClient);
      }
      return Promise.all(cb);
    }),
  };

  return mockClient;
}

module.exports = createMockDb;
