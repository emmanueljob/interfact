import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("cli help lists core commands", async () => {
  const { stdout } = await execFileAsync(process.execPath, ["src/cli.js", "--help"]);

  assert.match(stdout, /interfact open/);
  assert.match(stdout, /interfact poll/);
});

test("cli runs when invoked through a symlinked bin", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "interfact-cli-"));
  const bin = path.join(dir, "interfact");
  await symlink(path.resolve("src/cli.js"), bin);

  const { stdout } = await execFileAsync(bin, ["--help"]);

  assert.match(stdout, /interfact open/);
  assert.match(stdout, /interfact poll/);
});
