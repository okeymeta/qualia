import { spawn } from "node:child_process";
import { join } from "node:path";
import process from "node:process";

const cargoBin = join(process.env.USERPROFILE ?? "", ".cargo", "bin");
const env = {
  ...process.env,
  PATH: `${cargoBin};${process.env.PATH ?? ""}`,
};

const child = spawn("tauri", process.argv.slice(2), {
  stdio: "inherit",
  shell: true,
  env,
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
