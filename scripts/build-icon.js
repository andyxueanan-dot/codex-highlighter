"use strict";

// Optional design-time tool: npm install --no-save sharp, then node scripts/build-icon.js.
// Normal builds use the checked-in ICO and do not need Node or Sharp.
const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

(async () => {
  const assets = path.resolve(__dirname, "../assets");
  const svg = fs.readFileSync(path.join(assets, "icon.svg"));
  const sizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
  const frames = await Promise.all(sizes.map((size) =>
    sharp(svg, { density: 384 }).resize(size, size).png().toBuffer(),
  ));
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  frames.forEach((frame, index) => {
    const entry = 6 + index * 16;
    header[entry] = sizes[index] === 256 ? 0 : sizes[index];
    header[entry + 1] = header[entry];
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(frame.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += frame.length;
  });
  fs.writeFileSync(path.join(assets, "codex-highlighter.ico"), Buffer.concat([header, ...frames]));
  fs.writeFileSync(path.join(assets, "icon-preview.png"), frames.at(-1));
  process.stdout.write(`Built ICO with ${sizes.join(", ")} px frames\n`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
