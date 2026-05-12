#!/usr/bin/env node
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = new URL("..", import.meta.url).pathname;
const sourceIcon = join(root, "public", "icon.png");
const iconDir = join(root, "src-tauri", "icons");
const iconsetDir = join(iconDir, "icon.iconset");

const pngTargets = {
  "32x32.png": 32,
  "128x128.png": 128,
  "128x128@2x.png": 256,
  "Square30x30Logo.png": 30,
  "Square44x44Logo.png": 44,
  "Square71x71Logo.png": 71,
  "Square89x89Logo.png": 89,
  "Square107x107Logo.png": 107,
  "Square142x142Logo.png": 142,
  "Square150x150Logo.png": 150,
  "Square284x284Logo.png": 284,
  "Square310x310Logo.png": 310,
  "StoreLogo.png": 50,
};

const iconsetTargets = {
  "icon_16x16.png": 16,
  "icon_16x16@2x.png": 32,
  "icon_32x32.png": 32,
  "icon_32x32@2x.png": 64,
  "icon_128x128.png": 128,
  "icon_128x128@2x.png": 256,
  "icon_256x256.png": 256,
  "icon_256x256@2x.png": 512,
  "icon_512x512.png": 512,
  "icon_512x512@2x.png": 1024,
};

const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const icnsTypes = {
  16: "icp4",
  32: "icp5",
  64: "icp6",
  128: "ic07",
  256: "ic08",
  512: "ic09",
  1024: "ic10",
};

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function resize(size, out) {
  run("sips", ["-z", String(size), String(size), sourceIcon, "--out", out]);
}

function makeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries = images.map(({ size, buffer }) => {
    const entry = Buffer.alloc(16);
    entry[0] = size === 256 ? 0 : size;
    entry[1] = size === 256 ? 0 : size;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(buffer.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += buffer.length;
    return entry;
  });

  return Buffer.concat([header, ...entries, ...images.map(({ buffer }) => buffer)]);
}

function makeIcns(images) {
  const chunks = images.map(({ size, buffer }) => {
    const chunk = Buffer.alloc(8 + buffer.length);
    chunk.write(icnsTypes[size], 0, 4, "ascii");
    chunk.writeUInt32BE(chunk.length, 4);
    buffer.copy(chunk, 8);
    return chunk;
  });
  const header = Buffer.alloc(8);
  header.write("icns", 0, 4, "ascii");
  header.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4);
  return Buffer.concat([header, ...chunks]);
}

mkdirSync(iconDir, { recursive: true });
copyFileSync(sourceIcon, join(iconDir, "icon.png"));

for (const [name, size] of Object.entries(pngTargets)) {
  resize(size, join(iconDir, name));
}

rmSync(iconsetDir, { recursive: true, force: true });
mkdirSync(iconsetDir, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), "dioptase-ico-"));
const icnsImages = Object.values(iconsetTargets)
  .filter((size, index, sizes) => sizes.indexOf(size) === index)
  .map((size) => {
    const out = join(tmp, `icns-${size}.png`);
    resize(size, out);
    return { size, buffer: readFileSync(out) };
  });
const icoImages = icoSizes.map((size) => {
  const out = join(tmp, `icon-${size}.png`);
  resize(size, out);
  return { size, buffer: readFileSync(out) };
});
writeFileSync(join(iconDir, "icon.icns"), makeIcns(icnsImages));
writeFileSync(join(iconDir, "icon.ico"), makeIco(icoImages));
rmSync(tmp, { recursive: true, force: true });
rmSync(iconsetDir, { recursive: true, force: true });

console.log(`Generated icons from ${sourceIcon}`);
