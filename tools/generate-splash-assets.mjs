/**
 * Generates splash layers + app logo assets from approved Famy artwork.
 *
 * Usage:
 *   node tools/generate-splash-assets.mjs <wordmark.jpg> [app-icon.jpg]
 *
 * Wordmark source: 1774×887 (pink Famy on near-white)
 * App icon source: 1254×1254 (white Famy on #F10E72 square)
 */
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SPLASH_DIR = path.join(__dirname, "../src/assets/splash");
const ASSETS_DIR = path.join(__dirname, "../src/assets");

const BRAND_RGB = [0xf1, 0x0e, 0x72];

const SOURCE = {
  width: 1774,
  height: 887,
  fam: { x: 330, y: 267, width: 814, height: 304 },
  y: { x: 1160, y: 285, width: 262, height: 326 },
  wordmarkCrop: { x: 330, y: 267, width: 1092, height: 344 },
};

const ASSEMBLED = {
  width: 1092,
  height: 344,
  fam: { x: 0, y: 0, width: 814, height: 304 },
  y: { x: 830, y: 18, width: 262, height: 326 },
};

const EYES_BAND_TOP = 0;
const EYES_BAND_HEIGHT = 78;

function alphaFromPixel(r, g, b) {
  const minimum = Math.min(r, g, b);
  return Math.round(255 * Math.max(0, Math.min(1, (248 - minimum) / 220)));
}

function toMaskedRgba(buffer, width, height, colorize) {
  const out = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    const r = buffer[o];
    const g = buffer[o + 1];
    const b = buffer[o + 2];
    const alpha = alphaFromPixel(r, g, b);
    const [or, og, ob] = colorize(r, g, b, alpha);
    out[o] = or;
    out[o + 1] = og;
    out[o + 2] = ob;
    out[o + 3] = alpha;
  }
  return out;
}

const toWhite = () => [255, 255, 255];
const toBrand = () => BRAND_RGB;

async function extractRegion(input, region, colorize) {
  const { data, info } = await sharp(input)
    .extract({ left: region.x, top: region.y, width: region.width, height: region.height })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const rgba = toMaskedRgba(data, info.width, info.height, (r, g, b, a) =>
    a > 0 ? colorize(r, g, b, a) : [0, 0, 0],
  );
  return { rgba, width: info.width, height: info.height };
}

async function writePng(filePath, rgba, width, height) {
  await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toFile(filePath);
}

function subtractEyesFromBody(bodyRgba, eyesRgba, width, height, eyesBandHeight) {
  const out = Buffer.from(bodyRgba);
  for (let y = 0; y < Math.min(eyesBandHeight, height); y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (eyesRgba[i + 3] > 8) out[i + 3] = 0;
    }
  }
  return out;
}

async function buildWordmarkPink(wordmarkPath) {
  const crop = SOURCE.wordmarkCrop;
  const { data, info } = await sharp(wordmarkPath)
    .extract({ left: crop.x, top: crop.y, width: crop.width, height: crop.height })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const rgba = toMaskedRgba(data, info.width, info.height, (_r, _g, _b, a) =>
    a > 0 ? toBrand() : [0, 0, 0],
  );
  await writePng(path.join(ASSETS_DIR, "famy-wordmark.png"), rgba, info.width, info.height);
}

async function buildWordmarkWhite(famRgba, famW, famH, yBody, yEyes, yW, yH) {
  await sharp({
    create: {
      width: ASSEMBLED.width,
      height: ASSEMBLED.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      { input: famRgba, raw: { width: famW, height: famH, channels: 4 }, left: 0, top: 0 },
      {
        input: yBody,
        raw: { width: yW, height: yH, channels: 4 },
        left: ASSEMBLED.y.x,
        top: ASSEMBLED.y.y,
      },
      {
        input: yEyes,
        raw: { width: yW, height: yH, channels: 4 },
        left: ASSEMBLED.y.x,
        top: ASSEMBLED.y.y,
      },
    ])
    .png()
    .toFile(path.join(SPLASH_DIR, "wordmark-white.png"));
}

async function buildAppIcon(iconPath) {
  await sharp(iconPath).png().toFile(path.join(ASSETS_DIR, "famy-logo.png"));
}

async function main() {
  const wordmarkPath = process.argv[2];
  const iconPath = process.argv[3];
  if (!wordmarkPath) {
    console.error("Usage: node tools/generate-splash-assets.mjs <wordmark.jpg> [app-icon.jpg]");
    process.exit(1);
  }

  const meta = await sharp(wordmarkPath).metadata();
  if (meta.width !== SOURCE.width || meta.height !== SOURCE.height) {
    console.warn(
      `Warning: wordmark source is ${meta.width}×${meta.height}, expected ${SOURCE.width}×${SOURCE.height}.`,
    );
  }

  await mkdir(SPLASH_DIR, { recursive: true });

  const fam = await extractRegion(wordmarkPath, SOURCE.fam, toWhite);
  const yFull = await extractRegion(wordmarkPath, SOURCE.y, toWhite);

  const eyesRgba = Buffer.alloc(yFull.width * yFull.height * 4);
  for (let y = EYES_BAND_TOP; y < EYES_BAND_HEIGHT; y++) {
    for (let x = 0; x < yFull.width; x++) {
      const i = (y * yFull.width + x) * 4;
      eyesRgba[i] = yFull.rgba[i];
      eyesRgba[i + 1] = yFull.rgba[i + 1];
      eyesRgba[i + 2] = yFull.rgba[i + 2];
      eyesRgba[i + 3] = yFull.rgba[i + 3];
    }
  }

  const yBody = subtractEyesFromBody(yFull.rgba, eyesRgba, yFull.width, yFull.height, EYES_BAND_HEIGHT);

  await writePng(path.join(SPLASH_DIR, "fam-white.png"), fam.rgba, fam.width, fam.height);
  await writePng(path.join(SPLASH_DIR, "y-body-white.png"), yBody, yFull.width, yFull.height);
  await writePng(path.join(SPLASH_DIR, "y-eyes-white.png"), eyesRgba, yFull.width, yFull.height);
  await buildWordmarkWhite(fam.rgba, fam.width, fam.height, yBody, eyesRgba, yFull.width, yFull.height);
  await buildWordmarkPink(wordmarkPath);

  if (iconPath) {
    await buildAppIcon(iconPath);
  }

  const manifest = {
    source: { width: SOURCE.width, height: SOURCE.height },
    assembled: ASSEMBLED,
    colors: { background: "#F10E72", foreground: "#FFFFFF" },
    outputs: {
      splash: ["fam-white.png", "y-body-white.png", "y-eyes-white.png", "wordmark-white.png"],
      app: ["../famy-wordmark.png", iconPath ? "../famy-logo.png" : null].filter(Boolean),
    },
  };

  await writeFile(path.join(SPLASH_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log("Wrote splash + wordmark assets from approved artwork");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
