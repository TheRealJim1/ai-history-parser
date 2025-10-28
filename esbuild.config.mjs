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
  },
  // Handle SQL.js dependencies
  resolveExtensions: ['.tsx', '.ts', '.js', '.jsx'],
  // Use external instead of alias for Node.js modules
  external: ['obsidian'],
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
