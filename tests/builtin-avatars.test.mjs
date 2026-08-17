import assert from "node:assert/strict";
import test from "node:test";

import { loadBuiltInAvatars } from "../scripts/lib/builtin-avatars.mjs";

test("six built-in member avatars are bundled as usable image data", async () => {
  const avatars = await loadBuiltInAvatars();
  assert.equal(avatars.length, 6);
  assert.equal(new Set(avatars.map((avatar) => avatar.id)).size, 6);
  assert.ok(avatars.every((avatar) => avatar.dataUrl.startsWith("data:image/jpeg;base64,")));
});
