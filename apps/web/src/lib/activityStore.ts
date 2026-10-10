const KEY = 'cleartext-vault-activity';

export type LocalActivity = {
  readonly signature: string;
  readonly label: string;
  readonly at: number;
};

export const rememberActivity = (event: LocalActivity): void => {
  try {
    const current = listLocalActivity();
    localStorage.setItem(KEY, JSON.stringify([event, ...current].slice(0, 50)));
  } catch {
    // private mode
  }
};

export const listLocalActivity = (): LocalActivity[] => {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as LocalActivity[]) : [];
  } catch {
    return [];
  }
};
