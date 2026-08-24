import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const kit = path.join(root, "docs/branding/avably-logo-kit/png");
const sizes = [16, 24, 32, 48];

const pngs = await Promise.all(
  sizes.map((size) => readFile(path.join(kit, "favicon", `avably-favicon-${size}.png`))),
);

const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);

let dataOffset = header.length;
for (const [index, size] of sizes.entries()) {
  const entry = 6 + index * 16;
  header[entry] = size;
  header[entry + 1] = size;
  header[entry + 2] = 0;
  header[entry + 3] = 0;
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(pngs[index].length, entry + 8);
  header.writeUInt32LE(dataOffset, entry + 12);
  dataOffset += pngs[index].length;
}

const favicon = Buffer.concat([header, ...pngs]);
const icon = await readFile(path.join(kit, "app-icon/avably-app-icon-512.png"));
const appleIcon = await readFile(path.join(kit, "app-icon/avably-app-icon-180.png"));

for (const app of ["panel", "storefront"]) {
  const appRoot = path.join(root, "apps", app, "app");
  await Promise.all([
    writeFile(path.join(appRoot, "favicon.ico"), favicon),
    writeFile(path.join(appRoot, "icon.png"), icon),
    writeFile(path.join(appRoot, "apple-icon.png"), appleIcon),
  ]);
}

console.log("Avably application icons synchronized: panel + storefront");
