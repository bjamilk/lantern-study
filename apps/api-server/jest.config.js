/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  // Jest's 5s default is too tight for the suites that do real work rather than
  // mocking it — sharp image encoding and rate-limit timer windows both run in
  // seconds locally and intermittently blew the limit on a loaded machine, so
  // imageProcessing and rateLimit failed at random while passing in isolation.
  // 30s absorbs a slow CI runner while still failing a genuinely hung test.
  testTimeout: 30_000,
};
