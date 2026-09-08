/**
 * One-time generator: extracts white Fam / smiling-y layers from the approved
 * 1774×887 source artwork. Run: node tools/generate-splash-assets.mjs <source.jpg>
 */
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "../src/assets/splash");

const SOURCE = {
  width: 1774,
  height: 887,
  fam: { x: 330, y: 267, width: 814, height: 304 },
  y: { x: 1160, y: 285, width: 262, height: 326 },
};

const ASSEMBLED = {
  width: 1092,
  height: 344,
  fam: { x: 0, y: 0, width: 814, height: 304 },
  y: { x: 830, y: 18, width: 262, height: 326 },
};

/** Eyes band within the smiling-y crop (source pixels, tuned to artwork). */
const EYES_BAND_TOP = 0;
const EYES_BAND_HEIGHT = 78;

function toWhiteMaskedRgba(buffer, width, height) {
  const out = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    const r = buffer[o];
    const g = buffer[o + 1];
    const b = buffer[o + 2];
    const minimum = Math.min(r, g, b);
    const alpha = Math.round(255 * Math.max(0, Math.min(1, (248 - minimum) / 220)));
    out[o] = 255;
    out[o + 1] = 255;
    out[o + 2] = 255;
    out[o + 3] = alpha;
  }
  return out;
}

async function extractRegion(input, region) {
  const { data, info } = await sharp(input)
    .extract({ left: region.x, top: region.y, width: region.width, height: region.height })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const rgba = toWhiteMaskedRgba(data, info.width, info.height);
  return { rgba, width: info.width, height: info.height };
}

async function writePng(name, rgba, width, height) {
  const file = path.join(OUT_DIR, name);
  await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toFile(file);
  return file;
}

function subtractEyesFromBody(bodyRgba, eyesRgba, width, height, eyesBandHeight) {
  const out = Buffer.from(bodyRgba);
  for (let y = 0; y < Math.min(eyesBandHeight, height); y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (eyesRgba[i + 3] > 8) {
        out[i + 3] = 0;
      }
    }
  }
  return out;
}

async function main() {
  const sourcePath = process.argv[2];
  if (!sourcePath) {
    console.error("Usage: node tools/generate-splash-assets.mjs <source.jpg>");
    process.exit(1);
  }

  const meta = await sharp(sourcePath).metadata();
  if (meta.width !== SOURCE.width || meta.height !== SOURCE.height) {
    console.warn(
      `Warning: source is ${meta.width}×${meta.height}, expected ${SOURCE.width}×${SOURCE.height}. Coordinates may need scaling.`,
    );
  }

  await mkdir(OUT_DIR, { recursive: true });

  const fam = await extractRegion(sourcePath, SOURCE.fam);
  const yFull = await extractRegion(sourcePath, SOURCE.y);

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

  await writePng("fam-white.png", fam.rgba, fam.width, fam.height);
  await writePng("y-body-white.png", yBody, yFull.width, yFull.height);
  await writePng("y-eyes-white.png", eyesRgba, yFull.width, yFull.height);

  const manifest = {
    source: { width: SOURCE.width, height: SOURCE.height },
    assembled: ASSEMBLED,
    assets: {
      fam: { file: "fam-white.png", ...ASSEMBLED.fam },
      yBody: { file: "y-body-white.png", ...ASSEMBLED.y },
      yEyes: { file: "y-eyes-white.png", ...ASSEMBLED.y, eyesBandHeight: EYES_BAND_HEIGHT },
    },
    colors: { background: "#F10E72", foreground: "#FFFFFF" },
  };

  await writeFile(path.join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log("Wrote splash assets to", OUT_DIR);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
