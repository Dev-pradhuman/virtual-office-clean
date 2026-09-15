const { Jimp } = require('jimp');
const pngToIco = require('png-to-ico').default || require('png-to-ico');
const fs = require('fs');
const path = require('path');

const srcPath = 'C:\\Users\\Pradhuman\\Downloads\\ChatGPT Image Jul 2, 2026, 01_39_23 AM.png';
const destDir = path.join(__dirname, 'frontend', 'assets');

async function main() {
  console.log('Processing source image:', srcPath);
  
  if (!fs.existsSync(srcPath)) {
    console.error('Source image does not exist!');
    process.exit(1);
  }

  // Create destination directory if not exists
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  const sizes = [16, 24, 32, 48, 64, 128, 256, 512];
  const pngPaths = [];

  // 1. Resize and save PNGs for each required size
  for (const size of sizes) {
    const img = await Jimp.read(srcPath);
    img.resize({ w: size, h: size });
    
    let destName = `icon-${size}.png`;
    if (size === 512) {
      destName = 'icon.png'; // Primary 512x512 icon
    }
    
    const destPath = path.join(destDir, destName);
    await img.write(destPath);
    console.log(`Saved: ${destPath} (${size}x${size})`);
    
    // Windows ICO file format only supports up to 256x256 pixels.
    // Exclude 512x512 to prevent NSIS "invalid icon file size" abort error.
    if (size < 512) {
      pngPaths.push(destPath);
    }
  }

  // 2. Generate icon.ico containing all sizes (using png-to-ico)
  console.log('Generating Windows icon.ico...');
  try {
    const icoBuffer = await pngToIco(pngPaths);
    const icoPath = path.join(destDir, 'icon.ico');
    fs.writeFileSync(icoPath, icoBuffer);
    console.log(`Saved: ${icoPath}`);
  } catch (err) {
    console.error('Failed to generate icon.ico:', err.message);
  }

  // 3. (REMOVED) Overwriting office.png with the new icon is incorrect, 
  // as office.png is the visual room layout backdrop and must be preserved.

  console.log('Icon generation completed successfully!');
}

main().catch(err => {
  console.error('Error running icon generation:', err.message);
});
