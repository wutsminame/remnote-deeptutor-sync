const fs = require('fs');
const {parseManifest} = require('@remnote/plugin-sdk/dist/lib');
const manifest = JSON.parse(fs.readFileSync('public/manifest.json','utf8'));
const result = parseManifest(manifest);
if (!result.success) { console.error(result.errors); process.exit(1); }
// All covers Rem access; kb.getCurrentKnowledgeBaseData needs its own scope.
for (const type of ['All','KnowledgeBaseInfo']) {
  if (!manifest.requiredScopes?.some(scope=>scope.type===type && scope.level==='Read')) {
    console.error(`Build blocked: requiredScopes must include ${type} / Read for this plugin's API calls.`);
    process.exit(1);
  }
}
if (process.argv.includes('--local')) {
  console.log('SDK schema and required read scopes passed for localhost development; this is not upload validation.');
  process.exit(0);
}
const repo = new URL(manifest.repoUrl);
if (repo.protocol !== 'https:' || repo.hostname !== 'github.com' ||
    !/^\/[^/]+\/[^/]+\/?$/.test(repo.pathname) || repo.search || repo.hash) {
  console.error('Upload blocked: repoUrl must identify this plugin\'s real public GitHub repository. A placeholder or unrelated repository is not acceptable. Use localhost development until the source repository is available.');
  process.exit(1);
}
console.log('SDK schema, required read scopes and GitHub URL format passed; public source ownership still requires verification.');
