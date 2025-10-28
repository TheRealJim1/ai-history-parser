// esbuild.config.mjs
import esbuild from 'esbuild';

const options = {
  entryPoints: ['src/main.ts'],
  bundle: true,
  outfile: 'main.js',
  sourcemap: true,
  format: 'cjs',
  target: ['chrome109', 'safari15'],
  external: ['obsidian'],
  loader: { '.tsx': 'tsx', '.ts': 'ts' },
  jsx: 'automatic',
  jsxImportSource: 'react',
  logLevel: 'info',
  platform: 'browser',
  define: {
    'process.env.NODE_ENV': '"production"',
    'global': 'globalThis',
  },
  // Handle SQL.js dependencies
  resolveExtensions: ['.tsx', '.ts', '.js', '.jsx'],
  // External modules that SQL.js tries to use
  external: ['obsidian', 'fs', 'path', 'crypto'],
  // Polyfills for Node.js modules
  banner: {
    js: `
      // Polyfills for SQL.js
      if (typeof global === 'undefined') {
        var global = globalThis;
      }
      if (typeof process === 'undefined') {
        var process = { env: {} };
      }
    `,
  },
};

const isWatch = process.argv.includes('--watch');

if (isWatch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('watching… (Ctrl+C to stop)');
} else {
  await esbuild.build(options);
  console.log('build done');
}
