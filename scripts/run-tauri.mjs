import { spawn } from "node:child_process";
import { join } from "node:path";
import process from "node:process";

const cargoBin = join(process.env.USERPROFILE ?? "", ".cargo", "bin");
const env = {
  ...process.env,
  PATH: `${cargoBin};${process.env.PATH ?? ""}`,
};

const forwardedArgs =
  process.argv[1] && process.argv[1].endsWith(".mjs")
    ? process.argv.slice(2)
    : process.argv.slice(1);

const child = spawn("tauri", forwardedArgs, {
  stdio: "inherit",
  shell: true,
  env,
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
