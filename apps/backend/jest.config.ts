import type { Config } from 'jest';

const config: Config = {
  rootDir: '.',

  testEnvironment: 'node',

  moduleFileExtensions: ['js', 'json', 'ts'],

  testRegex: '.*\\.(spec|e2e-spec)\\.ts$',

  transform: {
    '^.+\\.(t|j)s$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.test.json',
      },
    ],
  },

  transformIgnorePatterns: [
    'node_modules/(?!(\\.pnpm|@nestjs)/.*)',
  ],

  moduleNameMapper: {
    '^.*utils/load-package\\.util(\\.js)?$': '<rootDir>/test/mocks/load-package.util.ts',
  },

  collectCoverageFrom: ['**/*.(t|j)s'],

  coverageDirectory: './coverage',
};

export default config;