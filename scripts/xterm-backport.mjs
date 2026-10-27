/** Rebuild both shipped WebGL entry points from pinned stable sources plus the pnpm patch. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { build, version as esbuildVersion } from 'esbuild-wasm';

const root = path.resolve(import.meta.dirname, '..');
const req = createRequire(path.join(root, 'package.json'));
const core = path.dirname(req.resolve('@xterm/xterm/package.json'));
const installedAddon = path.dirname(req.resolve('@xterm/addon-webgl/package.json'));
const writeIndex = process.argv.indexOf('--write');
const addon = writeIndex >= 0 ? path.resolve(process.argv[writeIndex + 1]) : installedAddon;
const check = process.argv.includes('--check');
if (!check && writeIndex < 0) throw new Error('Use --check or --write <prepared-package>');
const readJSON = p => JSON.parse(fs.readFileSync(p, 'utf8'));
if (readJSON(path.join(core, 'package.json')).version !== '6.0.0' || readJSON(path.join(addon, 'package.json')).version !== '0.19.0' || esbuildVersion !== '0.28.2') {
  throw new Error('Backport requires reviewed core6.0.0/addon0.19.0/esbuild0.28.2; audit before changing');
}
const inputs = new Map();
const plugin = {
  name: 'stable-xterm-source',
  setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => {
      let key;
      if (args.kind === 'entry-point') key = 'addon/src/WebglAddon.ts';
      else if (args.path.startsWith('.')) key = path.posix.normalize(path.posix.join(path.posix.dirname(args.importer), args.path));
      else if (/^(common|browser|vs)\//.test(args.path)) key = 'core/src/' + args.path;
      else throw new Error(`Unexpected runtime import ${args.path}; do not silently bundle a different core`);
      if (!key.endsWith('.ts')) key += '.ts';
      if (!/^(addon|core)\/src\//.test(key) || key.includes('..')) throw new Error('Source escapes pinned package');
      return { path: key, namespace: 'xterm-stable-backport' };
    });
    builder.onLoad({ filter: /.*/, namespace: 'xterm-stable-backport' }, args => {
      const [kind, ...parts] = args.path.split('/');
      const contents = fs.readFileSync(path.join(kind === 'core' ? core : addon, ...parts), 'utf8');
      inputs.set(args.path, hash(contents));
      return { contents, loader: 'ts' };
    });
  },
};
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const license = `/**
 * Copyright (c) 2014-2024 The xterm.js authors. All rights reserved. @license MIT
 * Copyright (c) 2012-2013 Christopher Jeffrey. @license MIT
 * Copyright (c) 2011 Fabrice Bellard. Originally forked with permission. @license MIT
 * Copyright (c) Microsoft Corporation. Licensed under the MIT License.
 * Stable addon0.19.0/core6.0.0 with reviewed atlas fixes; see Voltius patches/xterm-webgl.
 */`;
const umdOpen = `(function(root,factory){if(typeof exports==='object'&&typeof module==='object')module.exports=factory();else if(typeof define==='function'&&define.amd)define([],factory);else if(typeof exports==='object')exports.WebglAddon=factory();else root.WebglAddon=factory();})(globalThis,function(){`;
const outputs = {};
for (const format of ['esm', 'iife']) {
  const outfile = format === 'esm' ? 'addon-webgl.mjs' : 'addon-webgl.js';
  const result = await build({
    absWorkingDir: root, entryPoints: ['stable-addon-entry'], outfile, plugins: [plugin],
    bundle: true, format, target: 'es2021', minify: true, treeShaking: true,
    sourcemap: true, sourcesContent: true, legalComments: 'inline', write: false,
    tsconfigRaw: { compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false } },
    ...(format === 'iife' ? { globalName: '__voltiusXtermWebgl', banner: { js: license + '\n' + umdOpen }, footer: { js: 'return __voltiusXtermWebgl;\n});' } } : { banner: { js: license } }),
  });
  for (const file of result.outputFiles) {
    const name = 'lib/' + path.basename(file.path);
    // pnpm's patch application preserves the original UMD file's no-final-newline convention.
    if (file.contents.at(-1) !== 10) throw new Error('Unexpected compiler newline convention');
    const contents = name.endsWith('.js') ? Buffer.from(file.contents).subarray(0, file.contents.length - 1) : file.contents;
    outputs[name] = hash(contents);
    if (check) {
      if (!fs.readFileSync(path.join(addon, name)).equals(contents)) throw new Error(`Source/bundle mismatch: ${name}`);
    } else fs.writeFileSync(path.join(addon, name), contents);
  }
}
const manifest = { core: '6.0.0', addon: '0.19.0', builder: 'esbuild-wasm', esbuild: esbuildVersion, target: 'es2021', sourceInputs: Object.fromEntries([...inputs].sort()), outputs };
const manifestPath = path.join(root, 'patches/xterm-webgl/build-manifest.json');
if (check) {
  if (JSON.stringify(readJSON(manifestPath)) !== JSON.stringify(manifest)) throw new Error('Build manifest differs');
  console.log('Stable xterm backport: source, ESM/UMD bundles, maps and manifest match');
} else fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
