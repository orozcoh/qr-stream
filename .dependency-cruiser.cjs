/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular imports are forbidden across the whole repository.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'core-only-imports-core',
      severity: 'error',
      comment: 'src/core may only import from src/core.',
      from: { path: '^src/core/' },
      to: { path: '^src', pathNot: '^src/core/' },
    },
    {
      name: 'qr-imports-core-or-qr',
      severity: 'error',
      comment: 'src/qr may only import from src/core or src/qr.',
      from: { path: '^src/qr/' },
      to: { path: '^src', pathNot: '^src/(core|qr)/' },
    },
    {
      name: 'browser-imports-core-qr-browser',
      severity: 'error',
      comment: 'src/browser may only import from src/core, src/qr or src/browser.',
      from: { path: '^src/browser/' },
      to: { path: '^src', pathNot: '^src/(core|qr|browser)/' },
    },
    {
      name: 'react-imports-any-layer',
      severity: 'error',
      comment: 'src/react may import from src/core, src/qr, src/browser or src/react.',
      from: { path: '^src/react/' },
      to: { path: '^src', pathNot: '^src/(core|qr|browser|react)/' },
    },
    {
      name: 'no-node-builtins-in-browser-or-react',
      severity: 'error',
      comment: 'src/browser and src/react must not import Node.js builtins.',
      from: { path: '^src/(browser|react)/' },
      to: { path: '^node:' },
    },
    {
      name: 'only-decoders-import-zxing-wasm',
      severity: 'error',
      comment: 'Only src/browser/decoders/* may import zxing-wasm.',
      from: { path: '^src', pathNot: '^src/browser/decoders/' },
      to: { path: '^zxing-wasm' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: {
      path: 'dist|demo/dist|coverage|\\.superpowers|node_modules',
    },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
  },
};
