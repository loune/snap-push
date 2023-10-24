export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  modulePathIgnorePatterns: ['<rootDir>/dist/', '<rootDir>/dist-cjs/', '<rootDir>/dist-esm/', '<rootDir>/dist-types/'],
  moduleNameMapper: {
    '^(\\.\\.?\\/.+)\\.js$': '$1',
  },
};
