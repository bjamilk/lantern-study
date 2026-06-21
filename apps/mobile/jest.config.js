/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleNameMapper: {
    '^@lantern/shared/utils$': '<rootDir>/src/utils/__mocks__/sharedUtils.ts',
    '^@lantern/shared/(.*)$': '<rootDir>/../../packages/shared/src/$1',
  },
};
