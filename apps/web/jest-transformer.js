const { TsJestTransformer } = require('ts-jest');

const tsTransformer = new TsJestTransformer({
  tsconfig: {
    jsx: 'react-jsx',
    esModuleInterop: true,
  },
});

module.exports = {
  process(sourceText, sourcePath, options) {
    const modified = sourceText.replace(/\(?import\.meta\s*(as\s+any)?\)?\.env/g, 'process.env');
    return tsTransformer.process(modified, sourcePath, options);
  },
  getCacheKey(sourceText, sourcePath, options) {
    return tsTransformer.getCacheKey(sourceText, sourcePath, options);
  },
};
