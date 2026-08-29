import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { isSamePathOrInside } from "../paths.mjs";

const AVATARS = [
  ["octopus-engineer", "Octopus engineer", "章鱼工程师"],
  ["cat-wizard", "Cat wizard", "猫咪魔法师"],
  ["duck-pilot", "Duck pilot", "鸭子飞行员"],
  ["capybara-detective", "Capybara detective", "水豚侦探"],
  ["raccoon-mechanic", "Raccoon mechanic", "浣熊机械师"],
  ["plant-bot", "Plant robot", "植物机器人"],
];

export async function loadBuiltInAvatars() {
  return Promise.all(AVATARS.map(async ([id, en, zh]) => ({
    id,
    labels: { en, zh },
    dataUrl: `data:image/jpeg;base64,${(await readFile(
      new URL(`../../../assets/avatars/${id}.jpg`, import.meta.url)
    )).toString("base64")}`,
  })));
}

export async function saveAvatar(dataRoot, ownerKey, dataUrl) {
  const match = String(dataUrl).match(
    /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)$/,
  );
  if (!match) throw new Error("Avatar must be a PNG, JPEG, WebP, or GIF image");
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || !matchesImageSignature(match[1], bytes)) {
    throw new Error("Avatar content does not match its declared image type");
  }
  if (bytes.length > 2 * 1024 * 1024) {
    throw new Error("Avatar image must be smaller than 2 MB");
  }
  const extension = match[1] === "jpeg" ? "jpg" : match[1];
  const directory = path.join(dataRoot, "avatars");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, `${ownerKey}-${randomUUID()}.${extension}`);
  await writeFile(file, bytes, { mode: 0o600 });
  return file;
}

export async function avatarForUi(file, cache, dataRoot) {
  if (!file || !isSamePathOrInside(file, path.join(dataRoot, "avatars"))) return null;
  try {
    const metadata = await lstat(file);
    if (!metadata.isFile() || metadata.size > 2 * 1024 * 1024) return null;
    const signature = `${metadata.size}:${metadata.mtimeMs}`;
    const cached = cache.get(file);
    if (cached?.signature === signature) return cached.dataUrl;
    const extension = path.extname(file).slice(1).toLowerCase();
    const type = extension === "jpg" || extension === "jpeg" ? "jpeg" : extension;
    if (!["png", "jpeg", "webp", "gif"].includes(type)) return null;
    const bytes = await readFile(file);
    if (!matchesImageSignature(type, bytes)) return null;
    const mime = type === "jpeg" ? "image/jpeg" : `image/${type}`;
    const dataUrl = `data:${mime};base64,${bytes.toString("base64")}`;
    cache.set(file, { signature, dataUrl });
    return dataUrl;
  } catch {
    cache.delete(file);
    return null;
  }
}

export function isManagedAvatar(dataRoot, file) {
  return Boolean(file) && isSamePathOrInside(file, path.join(dataRoot, "avatars"));
}

function matchesImageSignature(type, bytes) {
  if (type === "png") {
    return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  if (type === "jpeg") return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (type === "gif") return ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"));
  if (type === "webp") {
    return bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
      bytes.subarray(8, 12).toString("ascii") === "WEBP";
  }
  return false;
}
