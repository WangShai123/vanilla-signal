import { defineConfig } from 'vite-plus';

export default defineConfig({
  pack: {
    entry: 'src/signal.js',
    outDir: 'dist',
    format: ['esm', 'umd'],
    globalName: 'signal',
    target: 'es2020',
    platform: 'browser',
    minify: true,
    clean: true,
    outExtensions({ format }) {
      return {
        js: format === 'es' ? '.mjs' : '.js',
      };
    },
    dts: {
      tsgo: true,
    },
    sourcemap: true,
    exports: true,
  },

  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
    ignorePatterns: ['dist/**'],
    rules: {},
  },

  fmt: {
    semi: true,
    singleQuote: true,
    tabWidth: 2,
    useTabs: false,
    printWidth: 80,
    trailingComma: 'es5',
    bracketSpacing: true,
    arrowParens: 'always',
    endOfLine: 'lf',
  },
});
