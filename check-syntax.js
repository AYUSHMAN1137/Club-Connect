const fs = require('fs');
const path = require('path');
const { parse } = require('acorn');

const files = [
  'frontend/data-store.js',
  'frontend/sync-engine.js',
  'frontend/service-worker.js',
  'frontend/member-dashboard.js',
  'frontend/owner-dashboard.js'
];

console.log('Syntax checking JavaScript files...\n');

files.forEach(file => {
  const filePath = path.join(__dirname, file);
  console.log(`Checking: ${file}`);
  
  try {
    if (!fs.existsSync(filePath)) {
      console.log('  ✗ FAIL - File not found\n');
      return;
    }
    
    const code = fs.readFileSync(filePath, 'utf8');
    parse(code, { ecmaVersion: 2020 });
    console.log('  ✓ PASS\n');
  } catch (error) {
    console.log(`  ✗ FAIL`);
    console.log(`  Error: ${error.message}\n`);
  }
});
