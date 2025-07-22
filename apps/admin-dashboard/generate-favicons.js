#!/usr/bin/env node

/**
 * Favicon Generation Script for Admin Dashboard
 * 
 * This script helps generate PNG favicons from the SVG file.
 * 
 * Prerequisites:
 * - Install ImageMagick: brew install imagemagick (macOS) or apt-get install imagemagick (Ubuntu)
 * - Or use an online converter like https://convertio.co/svg-png/
 * 
 * Usage:
 * 1. Install ImageMagick
 * 2. Run: node generate-favicons.js
 * 
 * Alternative manual process:
 * 1. Open favicon.svg in a browser
 * 2. Take screenshots at different sizes
 * 3. Save as PNG files with appropriate names
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, 'public');
const svgFile = path.join(publicDir, 'favicon.svg');

console.log('🎨 Admin Dashboard Favicon Generator');
console.log('=====================================');

// Check if SVG file exists
if (!fs.existsSync(svgFile)) {
    console.error('❌ favicon.svg not found in public directory');
    process.exit(1);
}

console.log('✅ Found favicon.svg');

// Check if ImageMagick is available
try {
    execSync('convert --version', { stdio: 'ignore' });
    console.log('✅ ImageMagick is available');

    // Generate different sizes
    const sizes = [
        { name: 'favicon-16x16.png', size: '16x16' },
        { name: 'favicon-32x32.png', size: '32x32' },
        { name: 'apple-touch-icon.png', size: '180x180' }
    ];

    sizes.forEach(({ name, size }) => {
        const outputFile = path.join(publicDir, name);
        try {
            execSync(`convert -background transparent -size ${size} ${svgFile} ${outputFile}`, { stdio: 'ignore' });
            console.log(`✅ Generated ${name}`);
        } catch (error) {
            console.error(`❌ Failed to generate ${name}:`, error.message);
        }
    });

    console.log('\n🎉 Favicon generation complete!');
    console.log('📁 Check the public directory for the generated files.');

} catch (error) {
    console.log('⚠️  ImageMagick not found. Manual conversion required.');
    console.log('\n📋 Manual Steps:');
    console.log('1. Open favicon.svg in a web browser');
    console.log('2. Take screenshots at these sizes:');
    console.log('   - 16x16 pixels → save as favicon-16x16.png');
    console.log('   - 32x32 pixels → save as favicon-32x32.png');
    console.log('   - 180x180 pixels → save as apple-touch-icon.png');
    console.log('3. Place all PNG files in the public directory');
    console.log('\n🌐 Or use an online converter:');
    console.log('   https://convertio.co/svg-png/');
    console.log('   https://favicon.io/favicon-converter/');
}

console.log('\n📝 Next steps:');
console.log('1. Replace placeholder files with actual PNG images');
console.log('2. Test the favicon in different browsers');
console.log('3. Verify it appears in bookmarks and tabs'); 