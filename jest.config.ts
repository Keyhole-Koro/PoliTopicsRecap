import type { Config } from 'jest';
import fs from 'fs';
import path from 'path';

const localstackSetup = path.join(__dirname, 'tests/setup/localstack.ts');
const testEnvSetup = path.join(__dirname, 'tests/setup/testEnv.ts');

const config: Config = {
  preset: 'ts-jest',
  setupFiles: [testEnvSetup, ...(fs.existsSync(localstackSetup) ? [localstackSetup] : [])],
  testEnvironment: 'node',
  roots: ['<rootDir>/tests', '<rootDir>/src'],
  testMatch: ['**/?(*.)+(spec|test).[tj]s?(x)'],
  moduleNameMapper: {
    '^@interfaces/(.*)$': '<rootDir>/src/interfaces/$1',
    '^@DynamoDBHandler/(.*)$': '<rootDir>/src/DynamoDBHandler/$1',
    '^@LLMSummarize/(.*)$': '<rootDir>/src/LLMSummarize/$1',
    '^@NationalDietAPIHandler/(.*)$': '<rootDir>/src/NationalDietAPIHandler/$1',
    '^@llm/(.*)$': '<rootDir>/src/llm/$1',
    '^@services/(.*)$': '<rootDir>/src/services/$1',
    '^@utils/(.*)$': '<rootDir>/src/utils/$1',
    '^@S3/(.*)$': '<rootDir>/src/S3/$1',
    '^src/(.*)$': '<rootDir>/src/$1',
  },
  transform: {
    '^.+\\.(t|j)sx?$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.json',
        isolatedModules: false,
      },
    ],
  },
  clearMocks: true,
  testTimeout: 45000,
  verbose: false,
};

export default config;
