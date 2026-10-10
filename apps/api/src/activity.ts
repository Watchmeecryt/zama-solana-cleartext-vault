import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { paths } from './env.js';

export type ActivityEvent = {
  readonly signature: string;
  readonly label: string;
  readonly at: number;
};

const MAX_EVENTS = 200;
let cache: ActivityEvent[] | null = null;

const load = async (): Promise<ActivityEvent[]> => {
  if (cache) return cache;
  try {
    cache = JSON.parse(await readFile(paths.activity, 'utf8')) as ActivityEvent[];
  } catch {
    cache = [];
  }
  return cache;
};

export const recordActivity = async (label: string, signature: string): Promise<void> => {
  const events = await load();
  events.unshift({ signature, label, at: Date.now() });
  cache = events.slice(0, MAX_EVENTS);
  await mkdir(path.dirname(paths.activity), { recursive: true });
  await writeFile(paths.activity, JSON.stringify(cache, null, 2));
};

export const listActivity = async (): Promise<ActivityEvent[]> => load();

export const clearActivity = async (): Promise<void> => {
  cache = [];
  await mkdir(path.dirname(paths.activity), { recursive: true });
  await writeFile(paths.activity, '[]');
};
