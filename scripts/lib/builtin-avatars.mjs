import { readFile } from "node:fs/promises";

const AVATARS = [
  ["octopus-engineer", "章鱼工程师"],
  ["cat-wizard", "猫咪魔法师"],
  ["duck-pilot", "鸭子飞行员"],
  ["capybara-detective", "水豚侦探"],
  ["raccoon-mechanic", "浣熊机械师"],
  ["plant-bot", "植物机器人"],
];

export async function loadBuiltInAvatars() {
  return Promise.all(AVATARS.map(async ([id, name]) => ({
    id,
    name,
    dataUrl: `data:image/jpeg;base64,${(await readFile(
      new URL(`../../assets/avatars/${id}.jpg`, import.meta.url)
    )).toString("base64")}`,
  })));
}
