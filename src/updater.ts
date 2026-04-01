import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";

export async function setupAutoUpdates() {
  try {
    const update = await check();
    if (!update) {
      return;
    }

    await update.downloadAndInstall();
    await relaunch();
  } catch (error) {
    console.error("Updater check failed", error);
  }
}
