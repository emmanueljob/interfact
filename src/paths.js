import os from "node:os";
import path from "node:path";
import { mkdir } from "node:fs/promises";

export const LOOPBACK_HOST = "127.0.0.1";

export function defaultPort() {
  return Number(process.env.INTERFACT_PORT || 4397);
}

export function stateDir(cwd = process.cwd()) {
  return process.env.INTERFACT_STATE_DIR || path.join(cwd, ".interfact");
}

export async function ensureStateDir(cwd = process.cwd()) {
  const dir = stateDir(cwd);
  await mkdir(dir, { recursive: true });
  return dir;
}

export function stateFile(cwd = process.cwd()) {
  return path.join(stateDir(cwd), "state.json");
}

export function serverLogFile(cwd = process.cwd()) {
  return path.join(stateDir(cwd), "server.log");
}

export function homeRelative(file) {
  const home = os.homedir();
  return file.startsWith(home + path.sep) ? "~" + file.slice(home.length) : file;
}
