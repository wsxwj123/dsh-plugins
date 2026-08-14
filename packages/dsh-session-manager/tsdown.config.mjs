// dsh-session-manager node-half build — esm node bundle.
// The node half is a Cordis plugin with a pure, dependency-injected core; it
// depends only on node builtins and cordis service injects, so everything is
// inlined into lib/*.js with no external runtime table needed.
export default [
  {
    entry: {
      index: 'src/index.ts',
      handler: 'src/handler.ts',
      trash: 'src/trash.ts',
      paths: 'src/paths.ts',
      'trust-fence': 'src/trust-fence.ts',
      'http-util': 'src/http-util.ts',
    },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    fixedExtension: false,
    dts: false,
    sourcemap: false,
    clean: false,
  },
]
