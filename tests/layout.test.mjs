import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const plugin = path.join(root, "plugins", "codex-agent-team");
const skills = path.join(plugin, "skills");
const runtime = path.join(plugin, "scripts");

test("the installable plugin is the only runtime source tree", async () => {
  await access(path.join(runtime, "lib", "runtime", "run.mjs"));
  await assert.rejects(access(path.join(runtime, "team-cli.mjs")));
  await access(path.join(runtime, "lib", "runtime", "process-guard.mjs"));
  await assert.rejects(access(path.join(runtime, "app-server-guard.mjs")));
  await assert.rejects(access(path.join(runtime, "team-host.mjs")));
  await access(path.join(runtime, "codex-agent-team.mjs"));
  await assert.rejects(access(path.join(runtime, "agent-team.mjs")));
  await assert.rejects(access(path.join(root, "scripts")));
  await assert.rejects(access(path.join(root, "assets")));
  await assert.rejects(access(path.join(runtime, "mode-keeper.mjs")));
  await assert.rejects(access(path.join(runtime, "runtime-process.mjs")));
  await assert.rejects(access(path.join(runtime, "supervisor.mjs")));
  await assert.rejects(access(path.join(runtime, "lib", "ipc.mjs")));
  await assert.rejects(access(path.join(runtime, "lib", "app-server.mjs")));
  await assert.rejects(access(path.join(runtime, "lib", "daemon.mjs")));
  await assert.rejects(access(path.join(runtime, "lib", "shared-app-server.mjs")));
  await assert.rejects(access(path.join(runtime, "lib", "codex-daemon-connection.mjs")));
  await access(path.join(runtime, "lib", "runtime", "controller.mjs"));
  await access(path.join(runtime, "lib", "runtime", "session.mjs"));
  await assert.rejects(access(path.join(runtime, "lib", "runtime", "index.mjs")));
  await access(path.join(runtime, "lib", "runtime", "bundle.mjs"));
  await access(path.join(runtime, "lib", "file-lease.mjs"));
  await assert.rejects(access(path.join(runtime, "lib", "client-lifecycle.mjs")));
  await access(path.join(runtime, "lib", "runtime", "desktop", "process.mjs"));
  await access(path.join(runtime, "lib", "runtime", "app-server.mjs"));
  await access(path.join(runtime, "lib", "manager", "index.mjs"));
  await access(path.join(runtime, "lib", "manager", "codex-adapter.mjs"));
  await assert.rejects(access(path.join(runtime, "lib", "team-service.mjs")));
  await access(path.join(runtime, "lib", "runtime", "desktop", "navigation.mjs"));
  await access(path.join(runtime, "lib", "runtime", "desktop", "styles.mjs"));
  await access(path.join(runtime, "lib", "runtime", "desktop", "teams.mjs"));
  for (const retired of [
    "runtime.mjs",
    "mode-switch.mjs",
    "lib/codex-daemon.mjs",
    "lib/daemon-relay.mjs",
    "lib/mode-switcher.mjs",
    "lib/mode-transition-lock.mjs",
    "lib/runtime-lifecycle.mjs"
  ]) await assert.rejects(access(path.join(runtime, retired)));
  await assert.rejects(access(path.join(skills, "communicate")));
  await assert.rejects(access(path.join(skills, "team")));
  await access(path.join(plugin, "assets", "avatars"));
  for (const command of ["launch", "collaborate"]) {
    const skillFile = path.join(skills, command, "SKILL.md");
    const interfaceFile = path.join(skills, command, "agents", "openai.yaml");
    await access(skillFile);
    await access(interfaceFile);
    await assert.rejects(access(path.join(skills, command, "scripts")));
    const [skillSource, interfaceSource] = await Promise.all([
      readFile(skillFile, "utf8"),
      readFile(interfaceFile, "utf8")
    ]);
    assert.match(skillSource, new RegExp(`^---\\nname: ${command}\\ndescription: .+\\n---`, "s"));
    assert.match(skillSource, /Resolve `<plugin-root>` as two directories above this `SKILL\.md`/);
    assert.match(skillSource, /node "<plugin-root>\/scripts\/codex-agent-team\.mjs"/);
    const displayName = command === "launch" ? "Launch CodexAgentTeam" : "Collaborate in CodexAgentTeam";
    assert.match(interfaceSource, new RegExp(`display_name: "${displayName}"`));
    assert.match(interfaceSource, new RegExp(`\\$codex-agent-team:${command}`));
    assert.match(interfaceSource, /allow_implicit_invocation: true/);
    if (command === "collaborate") {
      assert.doesNotMatch(skillSource, /one[- ]hop|broadcast|auto-forward|reply chain|acceptance is not completion/i);
      assert.match(skillSource, /Do not use ordinary Codex task or thread messaging tools/);
      assert.match(skillSource, /works from both member conversations and ordinary Codex conversations/);
      assert.match(skillSource, /--team "<team name or id>"/);
      assert.match(skillSource, /Do not expose the command, JSON receipt, Turn ID, or transport semantics/);
    }
  }
  for (const retired of ["open", "setup", "message", "status", "diagnose", "close", "resume"]) {
    await assert.rejects(access(path.join(skills, retired)));
  }
  const launcher = await readFile(path.join(runtime, "codex-agent-team.mjs"), "utf8");
  assert.match(launcher, /command === "launch"/);
  assert.match(launcher, /command === "collaborate"/);
  await assert.rejects(access(path.join(runtime, "agent-team")));
});

test("only protocol connections use classes", async () => {
  const files = (await readdir(runtime, { recursive: true }))
    .filter((file) => file.endsWith(".mjs"));
  const classes = [];
  for (const file of files) {
    const source = await readFile(path.join(runtime, file), "utf8");
    classes.push(...[...source.matchAll(/export class (\w+)/g)].map((match) => match[1]));
  }
  assert.deepEqual(classes.sort(), ["AppServerClient", "CdpClient"]);
});

test("member protocol choreography stays behind the Codex module interface", async () => {
  const manager = await readFile(path.join(runtime, "lib", "manager", "index.mjs"), "utf8");
  const codex = await readFile(path.join(runtime, "lib", "manager", "codex-adapter.mjs"), "utf8");

  assert.doesNotMatch(manager, /_startMemberThread|_initializeMemberThread|_waitForThreadRollout|_configureMemberThread/);
  assert.doesNotMatch(manager, /request\("thread\/(?:start|resume|name\/set|archive|unarchive|turns\/list)"/);
  assert.doesNotMatch(manager, /request\("turn\/(?:start|steer)"/);
  for (const method of [
    "createMemberThread",
    "applyMemberInstructions",
    "updateMemberThread",
    "sendMemberMessage",
    "archiveMember",
    "restoreMember",
  ]) assert.match(codex, new RegExp(`\\b${method}\\b`));
});

test("plugin and marketplace metadata form one standard distributable identity", async () => {
  const manifest = JSON.parse(await readFile(path.join(plugin, ".codex-plugin", "plugin.json"), "utf8"));
  const marketplace = JSON.parse(await readFile(
    path.join(root, ".agents", "plugins", "marketplace.json"),
    "utf8"
  ));
  assert.equal(manifest.name, "codex-agent-team");
  assert.match(manifest.version, /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/);
  assert.equal(manifest.skills, "./skills/");
  assert.equal(manifest.repository, "https://github.com/zyfn/codex-agent-team");
  assert.equal(manifest.license, "MIT");
  assert.equal(manifest.mcpServers, undefined);
  assert.equal(manifest.apps, undefined);
  assert.deepEqual(manifest.interface.defaultPrompt, [
    "Use $codex-agent-team:launch to launch CodexAgentTeam.",
    "Use $codex-agent-team:collaborate to inspect Team context or contact a teammate."
  ]);
  assert.equal(marketplace.name, "codex-agent-team");
  assert.deepEqual(marketplace.plugins.map((entry) => ({
    name: entry.name,
    path: entry.source?.path
  })), [{ name: "codex-agent-team", path: "./plugins/codex-agent-team" }]);
});
