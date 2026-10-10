import { parseDemoConfigResponse, type DemoConfig } from '@zama-demo/kit';

const asJson = async (response: Response, name: string): Promise<unknown> => {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (body as { error?: string } | null)?.error;
    throw new Error(error ?? `${name} failed (${response.status})`);
  }
  return body;
};

export const loadDemoConfig = async (): Promise<DemoConfig> =>
  parseDemoConfigResponse(await asJson(await fetch('/api/config'), 'config'));

export const requestFaucet = async (address: string, sol = 1, amount = 1000): Promise<void> => {
  await asJson(
    await fetch('/api/faucet', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address, sol, amount }),
    }),
    'faucet',
  );
};

export const requestUsdc = async (address: string, amount = 1000): Promise<void> => {
  await asJson(
    await fetch('/api/faucet/usdc', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address, amount }),
    }),
    'mint USDC',
  );
};

export type ActivityEvent = {
  readonly signature: string;
  readonly label: string;
  readonly at: number;
};

export const loadActivity = async (): Promise<ActivityEvent[]> => {
  const body = (await asJson(await fetch('/api/activity'), 'activity')) as { events?: ActivityEvent[] };
  return body.events ?? [];
};

export const publicRpcUrls = () => {
  const origin = window.location.origin;
  const ws = origin.startsWith('https') ? origin.replace('https', 'wss') : origin.replace('http', 'ws');
  return { rpcUrl: `${origin}/rpc`, wsUrl: `${ws}/rpc-ws` };
};
