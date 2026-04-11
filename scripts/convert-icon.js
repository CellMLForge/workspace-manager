#!/usr/bin/env node

/**
 * Convert the tracked public compact mark into build/icon.ico for Windows packaging.
 * First squares up the image using sharp, then converts to ICO.
 */

const sharp = require('sharp');
const pngToIco = require('png-to-ico').default;
const path = require('path');
const fs = require('fs');

const inputPath = path.join(__dirname, '../public/branding/compact-mark.png');
const tempPath = path.join(__dirname, '../build/icon-squared.png');
const outputPath = path.join(__dirname, '../build/icon.ico');
const buildDir = path.dirname(outputPath);

console.log(`Preparing ${inputPath} for icon conversion...`);

// CI checkouts may not include the build directory; ensure it exists.
fs.mkdirSync(buildDir, { recursive: true });

// First, read the original image metadata
sharp(inputPath)
  .metadata()
  .then(metadata => {
    const size = Math.max(metadata.width, metadata.height);
    console.log(`Original size: ${metadata.width}x${metadata.height}, squared to: ${size}x${size}`);
    
    // Resize/square the image with transparent padding
    return sharp(inputPath)
      .resize(size, size, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png()
      .toFile(tempPath);
  })
  .then(() => {
    console.log(`✓ Image squared: ${tempPath}`);
    console.log(`Converting to ICO format...`);
    
    // Convert squared PNG to ICO
    return pngToIco(tempPath);
  })
  .then(buf => {
    fs.writeFileSync(outputPath, buf);
    console.log(`✓ Icon conversion complete: ${outputPath}`);
    
    // Clean up temp file
    fs.unlinkSync(tempPath);
    console.log(`✓ Cleaned up temporary files`);
  })
  .catch(err => {
    console.error(`✗ Icon preparation failed: ${err.message}`);
    process.exit(1);
  });
