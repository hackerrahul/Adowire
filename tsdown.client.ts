import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    adowire: './client/index.ts',
  },
  outDir: './build',
  format: 'iife',
  target: 'es2020',
  minify: true,
  dts: false,
  clean: false,
  platform: 'browser',
  noExternal: ['morphdom'],
})
