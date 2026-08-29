#!/usr/bin/env node

import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const pluginRoot = path.join(root, "plugins", "codex-agent-team");
const manifestFile = path.join(pluginRoot, ".codex-plugin", "plugin.json");
const marketplaceFile = path.join(root, ".agents", "plugins", "marketplace.json");

const manifest = await readJson(manifestFile);
const marketplace = await readJson(marketplaceFile);

assert(manifest.name === "codex-agent-team", "Plugin name must be codex-agent-team");
assert(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+codex\.[0-9A-Za-z.-]+)?$/.test(manifest.version),
  "Plugin version must be valid SemVer with at most one Codex cachebuster");
assert(manifest.skills === "./skills/", "Plugin skills path must be ./skills/");
assert(marketplace.name === "codex-agent-team", "Marketplace name must be codex-agent-team");
assert(marketplace.interface?.displayName === "CodexAgentTeam", "Marketplace display name must match the product brand");

const entry = marketplace.plugins?.find((plugin) => plugin.name === manifest.name);
assert(entry, "Marketplace must expose the plugin");
assert(entry.source?.source === "local" && entry.source?.path === "./plugins/codex-agent-team",
  "Marketplace source must point to the installable plugin");
assert(["AVAILABLE", "INSTALLED_BY_DEFAULT"].includes(entry.policy?.installation),
  "Marketplace installation policy is invalid");
assert(["ON_INSTALL", "ON_USE"].includes(entry.policy?.authentication),
  "Marketplace authentication policy is invalid");
assert(typeof entry.category === "string" && entry.category, "Marketplace category is required");

for (const skillName of ["launch", "collaborate"]) {
  const skillRoot = path.join(pluginRoot, "skills", skillName);
  const skill = await readFile(path.join(skillRoot, "SKILL.md"), "utf8");
  const metadata = await readFile(path.join(skillRoot, "agents", "openai.yaml"), "utf8");
  assert(skill.startsWith("---\n"), `${skillName} Skill requires YAML frontmatter`);
  assert(new RegExp(`\\nname: ${skillName}\\n`).test(skill), `${skillName} Skill name must match its directory`);
  assert(/\ndescription: .+\n/.test(skill), `${skillName} Skill requires a description`);
  for (const field of ["display_name", "short_description", "default_prompt", "allow_implicit_invocation"]) {
    assert(new RegExp(`\\b${field}:`).test(metadata), `${skillName} openai.yaml requires ${field}`);
  }
}

for (const avatar of [
  "capybara-detective.jpg",
  "cat-wizard.jpg",
  "duck-pilot.jpg",
  "octopus-engineer.jpg",
  "plant-bot.jpg",
  "raccoon-mechanic.jpg",
]) {
  await access(path.join(pluginRoot, "assets", "avatars", avatar));
}
await access(path.join(root, "docs", "assets", "dashboard.webp"));
await access(path.join(root, "docs", "assets", "collaboration.webp"));
await access(path.join(root, "docs", "assets", "native-team-model.svg"));

const forbiddenRoots = ["scripts", "CONTEXT.md", "ARCHITECTURE.md", "COMPATIBILITY-ENGINEERING.md"];
const rootEntries = new Set(await readdir(root));
for (const item of forbiddenRoots) {
  assert(!rootEntries.has(item), `${item} is internal or duplicates the installable runtime and must not be published`);
}

for (const file of ["README.md", "README.zh-CN.md", "SECURITY.md", "SUPPORT.md", "CONTRIBUTING.md", "ASSETS.md"]) {
  const content = await readFile(path.join(root, file), "utf8");
  assert(!/\b(?:TODO|FIXME)\b/.test(content), `${file} contains unfinished text`);
}

console.log("Repository distribution validation passed");

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
