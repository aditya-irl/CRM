module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts', '**/tests/**/*.test.tsx'],
  transform: {
    '^.+\\.(ts|tsx)$': '<rootDir>/jest-transformer.js',
  },
};
