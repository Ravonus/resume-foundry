import { access, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { Cookie } from "playwright";

type StorageState = {
  cookies: Cookie[];
  origins: Array<{
    origin: string;
    localStorage: Array<{ name: string; value: string }>;
  }>;
};

const storagePath = resolve(
  process.env.SCRAPER_STORAGE_STATE_PATH ?? "storageState.json",
);

export const storageStatePath = storagePath;

export const loadStorageState = async (): Promise<StorageState | null> => {
  try {
    const raw = await readFile(storagePath, "utf-8");
    return JSON.parse(raw) as StorageState;
  } catch {
    return null;
  }
};

export const saveStorageState = async (state: StorageState) => {
  await mkdir(dirname(storagePath), { recursive: true });
  await writeFile(storagePath, JSON.stringify(state, null, 2), "utf-8");
};

export const clearStorageState = async () => {
  try {
    await unlink(storagePath);
    return true;
  } catch {
    return false;
  }
};

export const hasStorageState = async () => {
  try {
    await access(storagePath);
    return true;
  } catch {
    return false;
  }
};
