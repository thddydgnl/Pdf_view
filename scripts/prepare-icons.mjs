import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import pngToIco from "png-to-ico";
import sharp from "sharp";

const projectRoot = process.cwd();
const sourcePngPath = path.join(projectRoot, "build", "icon.png");
const squarePngPath = path.join(projectRoot, "build", "icon.square.png");
const targetIcoPath = path.join(projectRoot, "build", "icon.ico");
const targetIcnsPath = path.join(projectRoot, "build", "icon.icns");

const iconsetEntries = [
  { filename: "icon_16x16.png", size: 16 },
  { filename: "icon_16x16@2x.png", size: 32 },
  { filename: "icon_32x32.png", size: 32 },
  { filename: "icon_32x32@2x.png", size: 64 },
  { filename: "icon_128x128.png", size: 128 },
  { filename: "icon_128x128@2x.png", size: 256 },
  { filename: "icon_256x256.png", size: 256 },
  { filename: "icon_256x256@2x.png", size: 512 },
  { filename: "icon_512x512.png", size: 512 },
  { filename: "icon_512x512@2x.png", size: 1024 }
];

async function createIcnsIcon() {
  if (process.platform !== "darwin") {
    return;
  }

  const iconsetPath = path.join(projectRoot, "build", "icon.iconset");
  await fs.rm(iconsetPath, { recursive: true, force: true });
  await fs.mkdir(iconsetPath, { recursive: true });

  try {
    await Promise.all(
      iconsetEntries.map(async ({ filename, size }) => {
        await sharp(squarePngPath)
          .resize(size, size, {
            fit: "cover",
            position: "centre"
          })
          .png()
          .toFile(path.join(iconsetPath, filename));
      })
    );

    const result = spawnSync("iconutil", ["--convert", "icns", "--output", targetIcnsPath, iconsetPath], {
      stdio: "inherit"
    });

    if (result.status !== 0) {
      throw new Error("iconutil failed while creating build/icon.icns");
    }

    console.log(`Created ${targetIcnsPath}`);
  } finally {
    await fs.rm(iconsetPath, { recursive: true, force: true });
  }
}

async function main() {
  await fs.access(sourcePngPath);
  await sharp(sourcePngPath)
    .resize(1024, 1024, {
      fit: "cover",
      position: "centre"
    })
    .png()
    .toFile(squarePngPath);

  const icoBuffer = await pngToIco(squarePngPath);
  await fs.writeFile(targetIcoPath, icoBuffer);
  console.log(`Created ${targetIcoPath}`);

  await createIcnsIcon();
}

main().catch((error) => {
  console.error("Failed to prepare icons:", error);
  process.exitCode = 1;
});
