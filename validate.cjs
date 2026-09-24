const fs = require('fs');
const {parseManifest} = require('@remnote/plugin-sdk/dist/lib');
const result = parseManifest(JSON.parse(fs.readFileSync('public/manifest.json','utf8')));
if (!result.success) { console.error(result.errors); process.exit(1); }
const manifest = JSON.parse(fs.readFileSync('public/manifest.json','utf8'));
if (process.argv.includes('--local')) {
  console.log('SDK schema passed for localhost development only; this is not upload validation.');
  process.exit(0);
}
const repo = new URL(manifest.repoUrl);
if (repo.protocol !== 'https:' || repo.hostname !== 'github.com' ||
    !/^\/[^/]+\/[^/]+\/?$/.test(repo.pathname) || repo.search || repo.hash) {
  console.error('Upload blocked: repoUrl must identify this plugin\'s real public GitHub repository. A placeholder or unrelated repository is not acceptable. Use localhost development until the source repository is available.');
  process.exit(1);
}
console.log('SDK schema and GitHub URL format passed; public source ownership still requires verification.');
