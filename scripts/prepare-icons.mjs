import fs from "node:fs/promises";
import path from "node:path";
import pngToIco from "png-to-ico";
import sharp from "sharp";

const projectRoot = process.cwd();
const sourcePngPath = path.join(projectRoot, "build", "icon.png");
const squarePngPath = path.join(projectRoot, "build", "icon.square.png");
const targetIcoPath = path.join(projectRoot, "build", "icon.ico");

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
}

main().catch((error) => {
  console.error("Failed to prepare icons:", error);
  process.exitCode = 1;
});
