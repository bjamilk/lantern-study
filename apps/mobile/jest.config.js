/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleNameMapper: {
    // `expo-audio` calls into the native module at import time, which has no
    // runtime under plain ts-jest on node. The stand-in lets the lecture audio
    // engine be imported for its pure exports.
    '^expo-audio$': '<rootDir>/src/services/__mocks__/expoAudio.ts',
    '^@lantern/shared/utils$': '<rootDir>/src/utils/__mocks__/sharedUtils.ts',
    '^@lantern/shared/(.*)$': '<rootDir>/../../packages/shared/src/$1',
  },
};
