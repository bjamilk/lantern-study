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
  // `@noble/ciphers` (the AES-256-GCM behind secureSessionStorage) ships ESM
  // only. Metro transpiles it for the app; jest's default CJS runtime would
  // choke on its `import` statements, so it is the one package excluded from
  // transformIgnorePatterns and handed to ts-jest, which downlevels it. The
  // tsconfig already has `allowJs: true` (expo/tsconfig.base), so no compiler
  // option changes with it. Everything else in node_modules stays untouched.
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {}],
    '^.+\\.m?js$': ['ts-jest', { isolatedModules: true }],
  },
  transformIgnorePatterns: ['/node_modules/(?!@noble/)'],
};
