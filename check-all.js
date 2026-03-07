#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const files = [
  'frontend/data-store.js',
  'frontend/sync-engine.js',
  'frontend/service-worker.js',
  'frontend/member-dashboard.js',
  'frontend/owner-dashboard.js'
];

// Using Node's built-in mechanism to check syntax
const { execSync } = require('child_process');

console.log('Checking JavaScript syntax...\n');

files.forEach(file => {
  const filePath = path.join(__dirname, file);
  process.stdout.write(`1. ${file}: `);
  
  try {
    execSync(`node --check "${filePath}"`, { stdio: 'pipe' });
    console.log('✓ PASS');
  } catch (error) {
    console.log('✗ FAIL');
    console.log(`   ${error.stderr.toString().trim()}\n`);
  }
});
