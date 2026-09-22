'use strict';

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  collectCoverageFrom: ['src/**/*.js', '!src/server.js'],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  // Clear mocks between tests
  clearMocks: true,
  resetMocks: false,
  restoreMocks: true,
  // Longer timeout for integration-style tests
  testTimeout: 15000,
  // Setup file to load env before tests
  setupFiles: ['./tests/setup.js'],
};
