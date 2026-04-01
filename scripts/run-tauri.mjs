import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const cargoBin = join(process.env.USERPROFILE ?? "", ".cargo", "bin");
const env = {
  ...process.env,
  PATH: `${cargoBin};${process.env.PATH ?? ""}`,
};

const forwardedArgs =
  process.argv[1] && process.argv[1].endsWith(".mjs")
    ? process.argv.slice(2)
    : process.argv.slice(1);

const scriptDir = dirname(fileURLToPath(import.meta.url));
const cliEntrypoint = join(scriptDir, "..", "node_modules", "@tauri-apps", "cli", "tauri.js");
const cwd = process.cwd().startsWith("\\\\?\\") ? process.cwd().slice(4) : process.cwd();

const child = spawn(process.execPath, [cliEntrypoint, ...forwardedArgs], {
  stdio: "inherit",
  shell: false,
  cwd,
  env,
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
