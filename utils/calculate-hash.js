#!/usr/bin/env node
/**
 * @file scripts/calculate-hash.js
 * @description Calculate HMAC-SHA256 hash for user access
 * 
 * Usage: node scripts/calculate-hash.js <UUID> [secret]
 */

const crypto = require('crypto');

const uuid = process.argv[2];
const secret = process.argv[3];

if (!uuid) {
  console.error('❌ Error: UUID is required');
  console.log('\nUsage: node scripts/calculate-hash.js <UUID> [secret]');
  console.log('\nExample: node scripts/calculate-hash.js 550e8400-e29b-41d4-a716-446655440000');
  console.log('\nIf secret is not provided, you will be prompted to enter it.');
  process.exit(1);
}

if (!secret) {
  console.log('📝 Secret not provided as argument.');
  console.log('💡 Get your secret from APP_ACCESS_JSON in .env.local');
  console.log('   or generate new secrets with: node scripts/generate-app-secrets.js');
  console.log('\nPaste your 64-character hex secret here:');
  
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.question('Secret: ', (inputSecret) => {
    rl.close();
    calculateAndDisplay(uuid, inputSecret.trim());
  });
} else {
  calculateAndDisplay(uuid, secret);
}

function calculateAndDisplay(uuid, secret) {
  // Validate secret format
  if (!/^[0-9a-f]{64}$/i.test(secret)) {
    console.error('\n❌ Error: Secret must be a 64-character hexadecimal string');
    console.log('Example: a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890');
    process.exit(1);
  }

  // Calculate hash
  const secretBuffer = Buffer.from(secret, 'hex');
  const hmac = crypto.createHmac('sha256', secretBuffer);
  hmac.update(uuid);
  const hash = hmac.digest('hex');

  // Display results
  console.log('\n✅ Hash calculated successfully!\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📋 User Access Details:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`\nUUID (pid):  ${uuid}`);
  console.log(`Hash:        ${hash}`);
  console.log('\n🔗 Access URL (localhost):');
  console.log(`   http://localhost:3000/?pid=${uuid}&hash=${hash}`);
  console.log('\n🔗 Access URL (production - update domain):');
  console.log(`   https://alerts-dashboard.yourdomain.com/?pid=${uuid}&hash=${hash}`);
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('💡 Save this URL for the user to access the dashboard');
  console.log('⚠️  Keep the hash secret - it grants access to the user\'s account\n');
}

