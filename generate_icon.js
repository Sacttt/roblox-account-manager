const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// CRC32 implementation
const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[n] = c >>> 0;
}
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  const crcVal = crc32(Buffer.concat([typeBuf, data]));
  crcBuf.writeUInt32BE(crcVal, 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function createGoldRobloxIconPNG(size) {
  const width = size;
  const height = size;
  const rawData = Buffer.alloc((width * 4 + 1) * height);

  const cx = width / 2;
  const cy = height / 2;
  const angle = -15 * Math.PI / 180; // Classic Roblox cube tilt
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);

  const outerRadius = size * 0.38;
  const innerRadius = size * 0.13;
  const cornerRadius = size * 0.05;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * (width * 4 + 1);
    rawData[rowOffset] = 0; // Filter type 0 (None)

    for (let x = 0; x < width; x++) {
      const pxOffset = rowOffset + 1 + x * 4;

      // Transform coordinate to tilted cube space
      const dx = x - cx;
      const dy = y - cy;
      const rotX = dx * cosA - dy * sinA;
      const rotY = dx * sinA + dy * cosA;

      const absX = Math.abs(rotX);
      const absY = Math.abs(rotY);

      // Distance to outer rounded square
      const qx = Math.max(0, absX - (outerRadius - cornerRadius));
      const qy = Math.max(0, absY - (outerRadius - cornerRadius));
      const outerDist = Math.sqrt(qx * qx + qy * qy) + Math.min(0, Math.max(absX - outerRadius, absY - outerRadius));

      // Distance to inner square hole
      const innerDist = Math.max(absX - innerRadius, absY - innerRadius);

      // Shadow distance (soft glow behind)
      const shadowDist = Math.sqrt(dx * dx + (dy - size * 0.04) * (dy - size * 0.04));

      let r = 0, g = 0, b = 0, a = 0;

      if (outerDist <= 0 && innerDist >= 0) {
        // Inside the iconic Roblox block
        // Luxury gold & metallic gradient with top-left highlight
        const gradT = (rotX + rotY + outerRadius * 2) / (outerRadius * 4); // 0 to 1
        
        // Edge bevel highlight
        const edgeDist = Math.min(-outerDist, innerDist);
        const bevel = Math.min(1, edgeDist / (size * 0.04));

        // Gold palette:
        // Highlight: #FFF2A7 (255, 242, 167)
        // Mid Gold:  #F5BD1F (245, 189, 31)
        // Deep Gold: #C68A0C (198, 138, 12)
        // Shadow:    #754D05 (117, 77, 5)

        const baseR = 255 - gradT * 60;
        const baseG = 215 - gradT * 85;
        const baseB = 45 - gradT * 40;

        // Radial shine from top-left
        const shineDx = rotX + outerRadius * 0.5;
        const shineDy = rotY + outerRadius * 0.5;
        const shineDist = Math.sqrt(shineDx * shineDx + shineDy * shineDy);
        const shineFactor = Math.max(0, 1 - shineDist / (outerRadius * 1.4)) * 0.45;

        r = Math.min(255, Math.round((baseR + shineFactor * 120) * (0.6 + bevel * 0.4)));
        g = Math.min(255, Math.round((baseG + shineFactor * 100) * (0.6 + bevel * 0.4)));
        b = Math.min(255, Math.round((baseB + shineFactor * 120) * (0.6 + bevel * 0.4)));
        a = 255;

        // Anti-aliasing on outer and inner edges
        if (outerDist > -1.2) {
          const edgeAlpha = Math.max(0, Math.min(1, -outerDist / 1.2));
          a = Math.round(a * edgeAlpha);
        }
        if (innerDist < 1.2) {
          const holeAlpha = Math.max(0, Math.min(1, innerDist / 1.2));
          a = Math.round(a * holeAlpha);
        }
      } else if (outerDist > 0 && outerDist < size * 0.12) {
        // Outer soft luxury gold glow
        const glowFactor = Math.max(0, 1 - outerDist / (size * 0.12));
        r = 245;
        g = 190;
        b = 35;
        a = Math.round(glowFactor * glowFactor * 70);
      }

      rawData[pxOffset] = r;
      rawData[pxOffset + 1] = g;
      rawData[pxOffset + 2] = b;
      rawData[pxOffset + 3] = a;
    }
  }

  // Build PNG Buffer
  const header = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8 bit depth
  ihdr[9] = 6; // Color type 6 (RGBA)
  ihdr[10] = 0; // Compression
  ihdr[11] = 0; // Filter
  ihdr[12] = 0; // Interlace

  const ihdrChunk = makeChunk('IHDR', ihdr);
  const compressedData = zlib.deflateSync(rawData);
  const idatChunk = makeChunk('IDAT', compressedData);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([header, ihdrChunk, idatChunk, iendChunk]);
}

function generateIco(pngBuffers, sizes) {
  const count = pngBuffers.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // Reserved
  header.writeUInt16LE(1, 2); // Type: 1 = ICO
  header.writeUInt16LE(count, 4); // Count

  let offset = 6 + count * 16;
  const dirEntries = [];

  for (let i = 0; i < count; i++) {
    const size = sizes[i];
    const png = pngBuffers[i];
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // Width (0 for 256)
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // Height (0 for 256)
    entry.writeUInt8(0, 2); // Color palette
    entry.writeUInt8(0, 3); // Reserved
    entry.writeUInt16LE(1, 4); // Color planes
    entry.writeUInt16LE(32, 6); // Bits per pixel
    entry.writeUInt32LE(png.length, 8); // Image size in bytes
    entry.writeUInt32LE(offset, 12); // Offset of image data
    dirEntries.push(entry);
    offset += png.length;
  }

  return Buffer.concat([header, ...dirEntries, ...pngBuffers]);
}

const sizes = [256, 128, 64, 48, 32, 16];
const pngs = sizes.map(s => createGoldRobloxIconPNG(s));
const ico = generateIco(pngs, sizes);

const outIcoPath = path.join(__dirname, 'src', 'icon.ico');
const outPngPath = path.join(__dirname, 'src', 'icon.png');

fs.writeFileSync(outIcoPath, ico);
fs.writeFileSync(outPngPath, pngs[0]); // 256x256 PNG

console.log(`Generated luxury icon.ico (${ico.length} bytes) and icon.png (${pngs[0].length} bytes)`);
