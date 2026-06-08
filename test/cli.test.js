import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("cli help lists core commands", async () => {
  const { stdout } = await execFileAsync(process.execPath, ["src/cli.js", "--help"]);

  assert.match(stdout, /interfact open/);
  assert.match(stdout, /interfact poll/);
});
