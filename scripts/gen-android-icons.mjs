// Generates HashHustle-branded Android launcher icons from src/logo.png.
// Overwrites the Capacitor default icons in android/app/src/main/res/.
// Run: node scripts/gen-android-icons.mjs
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const LOGO = join(SCRIPT_DIR, "..", "src", "logo.png");
const RES = join(SCRIPT_DIR, "..", "android", "app", "src", "main", "res");

// density -> launcher px / adaptive foreground px (108dp equivalent)
const DENSITIES = {
  mdpi: { icon: 48, fg: 108 },
  hdpi: { icon: 72, fg: 162 },
  xhdpi: { icon: 96, fg: 216 },
  xxhdpi: { icon: 144, fg: 324 },
  xxxhdpi: { icon: 192, fg: 432 },
};

const src = await readFile(LOGO);

for (const [dpi, { icon, fg }] of Object.entries(DENSITIES)) {
  const dir = join(RES, `mipmap-${dpi}`);
  await mkdir(dir, { recursive: true });

  // Legacy launcher icon: logo scaled to fill the square.
  await sharp(src).resize(icon, icon).png().toFile(join(dir, "ic_launcher.png"));
  await sharp(src).resize(icon, icon).png().toFile(join(dir, "ic_launcher_round.png"));

  // Adaptive foreground: logo fitted inside the safe zone (~66% of canvas),
  // centered on a transparent canvas.
  const inner = Math.round(fg * 0.66);
  await sharp(src)
    .resize(inner, inner)
    .png()
    .toBuffer()
    .then((buf) =>
      sharp({ create: { width: fg, height: fg, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: buf, gravity: "center" }])
        .png()
        .toFile(join(dir, "ic_launcher_foreground.png")),
    );

  console.log(`[gen-icons] ${dpi}: icon=${icon}px foreground=${fg}px`);
}

console.log("[gen-icons] done — HashHustle launcher icons written to android/app/src/main/res/");
