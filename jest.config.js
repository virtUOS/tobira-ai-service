/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: [
    'src/utils/**/*.ts',
    'src/services/cache.service.ts',
  ],
  coverageReporters: ['text', 'lcov'],
  // @plussub/srt-vtt-parser ships ESM; map it to a CJS shim for Jest
  moduleNameMapper: {
    '^@plussub/srt-vtt-parser$': '<rootDir>/tests/__mocks__/srt-vtt-parser.js',
  },
  // Allow Jest to exit cleanly even if CacheService leaves an open setInterval
  forceExit: true,
};
