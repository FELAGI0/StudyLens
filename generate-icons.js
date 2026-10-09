// Генератор иконок без внешних зависимостей: синий квадрат с белой буквой S.
// Запуск: node generate-icons.js

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const BG = [37, 99, 235]; // синий
const FG = [255, 255, 255]; // белый

// Битовая карта буквы S, 5x7
const S_GLYPH = [
  "01111",
  "10000",
  "10000",
  "01110",
  "00001",
  "00001",
  "11110",
];

const SIZES = [16, 32, 48, 128];

function buildPixels(size) {
  const px = Buffer.alloc(size * size * 4);

  const cols = S_GLYPH[0].length;
  const rows = S_GLYPH.length;
  // Вписываем глиф примерно в 70% площади иконки
  const target = Math.round(size * 0.7);
  const scale = Math.max(1, Math.floor(target / Math.max(cols, rows)));
  const glyphW = cols * scale;
  const glyphH = rows * scale;
  const offX = Math.floor((size - glyphW) / 2);
  const offY = Math.floor((size - glyphH) / 2);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let color = BG;

      const gx = Math.floor((x - offX) / scale);
      const gy = Math.floor((y - offY) / scale);
      if (
        x >= offX &&
        x < offX + glyphW &&
        y >= offY &&
        y < offY + glyphH &&
        S_GLYPH[gy][gx] === "1"
      ) {
        color = FG;
      }

      const i = (y * size + x) * 4;
      px[i] = color[0];
      px[i + 1] = color[1];
      px[i + 2] = color[2];
      px[i + 3] = 255;
    }
  }

  return px;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(size, pixels) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // Добавляем байт фильтра (0) перед каждой строкой
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function main() {
  const outDir = path.join(__dirname, "icons");
  fs.mkdirSync(outDir, { recursive: true });

  for (const size of SIZES) {
    const pixels = buildPixels(size);
    const png = encodePng(size, pixels);
    const file = path.join(outDir, `icon${size}.png`);
    fs.writeFileSync(file, png);
    console.log(`written ${file} (${png.length} bytes)`);
  }
}

main();