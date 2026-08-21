const yaml = require('C:/Users/ballj/AppData/Local/npm-cache/_npx/1e7f6d9597241db0/node_modules/js-yaml');
const fs = require('fs');
const p = 'D:/DSH/fortress-store-list/.github/workflows/update-and-deploy.yml';
try {
  const doc = yaml.load(fs.readFileSync(p, 'utf8'));
  console.log('YAML OK');
  console.log('top keys:', Object.keys(doc).join(', '));
  console.log('schedule cron:', JSON.stringify(doc.on.schedule));
  console.log('jobs:', Object.keys(doc.jobs).join(', '));
  console.log('permissions:', JSON.stringify(doc.permissions));
} catch (e) {
  console.error('YAML ERROR:', e.message);
  process.exit(1);
}
