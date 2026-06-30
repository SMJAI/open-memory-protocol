const esbuild = require('esbuild')

async function build() {
  const shared = {
    bundle: true,
    platform: 'browser',
    target: 'chrome120',
    minify: false,
  }

  await Promise.all([
    esbuild.build({ ...shared, entryPoints: ['src/background.ts'], outfile: 'dist/background.js' }),
    esbuild.build({ ...shared, entryPoints: ['src/content.ts'], outfile: 'dist/content.js' }),
    esbuild.build({ ...shared, entryPoints: ['src/popup.ts'], outfile: 'dist/popup.js' }),
  ])

  console.log('OMP Bridge built successfully')
}

build().catch(err => { console.error(err); process.exit(1) })
