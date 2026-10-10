# Zama Solana confidential vault — cleartext demo

A single-service demo of Zama’s Solana confidential vault on the **cleartext** host. The vault itself is an ordinary public SPL vault. A confidential batcher sits in front of it: users join with encrypted (cleartext-attested) amounts, the keeper reveals **only the batch total**, and participants claim vault shares.

This repository vendors the Solana programs, clients, IDLs, and JS SDK slices from the public [`zama-ai/fhevm`](https://github.com/zama-ai/fhevm) `feature/solana` branch and wires the dApp to `@fhevm/sdk/solana/cleartext` instead of the production encrypted stack.

## Pinned source

| Field | Value |
| --- | --- |
| Upstream | https://github.com/zama-ai/fhevm |
| Branch | `feature/solana` |
| Commit | `9e244da02172ce79d6c2e24cf1eed3d45e0bb808` |
| Date | 2026-10-10 |
| Message | feat(solana): settle refunds a deposit batch worth zero vault shares (#4386) |

The same SHA is recorded in `vendor/PINNED`.

Program IDs (preview-env, loaded at genesis):

| Program | ID | Artifact |
| --- | --- | --- |
| zama_host (cleartext build) | `DPq5y89RDZPq9NcMh9X1NgjBWgYmSXg3QoipSBV3ZMzQ` | `zama_host_cleartext.so` |
| confidential_token | `FAWs7E52LZmXR5YzFy4aXanfBjNtXV2qooQVtkmBa3cL` | `confidential_token.so` |
| demo_vault | `DKuvkbkqo71fnbTsSNFzGCH1gT7FhKZU45bMqTSxxSFH` | `demo_vault.so` |
| confidential_batcher | `DAVFjzkMrUZnX9wqbYbAGiPTHQPTmdZ2C9kNsuSykJHb` | `confidential_batcher.so` |

Cleartext test coprocessor and KMS keys stay **server-side** in the vendored SDK (`FORGE_FHEVM_V1_*`). The browser never receives them.

## What the service does

One Railway container:

1. Starts `solana-test-validator` (Alpenglow) with the four programs at genesis.
2. Bootstraps zama-host with the cleartext coprocessor/KMS parties (`kmsCorruptionThreshold = 0`).
3. Seeds a mock USDC mint, the demo vault, cUSDC / cShares, and deposit + redeem batchers.
4. Runs a keeper that opens batches, dispatches after `min_batch_age`, produces public-decrypt certificates via the cleartext client, settles, claims, and after the settle deadline runs `cancel_dispatch` plus permissionless refunds. It also harvests illustrative yield.
5. Serves the React dApp as static files on the same `$PORT`.
6. Proxies validator JSON-RPC and WebSocket at `/rpc` and `/rpc-ws` so the page and external wallets can reach the cluster.
7. Exposes `/health`, a faucet, activity history, and `POST /api/reset`.

The validator ledger uses `--limit-ledger-size 1000000` so the leaf-record / MMR path can reconstruct handle history.

## Local run

Programs are built inside Docker (Anchor **1.2.0**, Solana **4.3.0**, Rust **1.91.1**). The Agave CLI is **linux/amd64** only.

```bash
docker build --platform=linux/amd64 -f Dockerfile.railway -t cleartext-vault .
docker run --rm -p 8080:8080 \
  -e PORT=8080 \
  -e DATA_DIR=/data \
  -v cleartext-vault-data:/data \
  cleartext-vault
```

Open http://127.0.0.1:8080. `/health` should report `ok` after the validator and seed finish (often 30–90 seconds).

Frontend-only iteration after a stack is already up:

```bash
npm install
npm run check:web
npm run build:web
```

The Vite dev server (`npm run dev -w web`) proxies `/api` and `/rpc` to `http://127.0.0.1:8080`.

### Reset / reseed

```bash
bash scripts/reset.sh http://127.0.0.1:8080
# or
curl -X POST http://127.0.0.1:8080/api/reset
```

If `RESET_TOKEN` is set, send `Authorization: Bearer $RESET_TOKEN`. Reset stops the validator, wipes the ledger, bootstraps, and reseeds.

## Railway

1. Create one service from this repo.
2. Builder: Dockerfile, path `Dockerfile.railway` (also set in `railway.json`).
3. Attach a volume at `/data` so the ledger and keypairs survive restarts.
4. Set `PORT` (Railway does this). Optionally set the variables below.
5. Generate a public domain. The API rewrites RPC/WS URLs from `X-Forwarded-Host` / `X-Forwarded-Proto`, or from `PUBLIC_URL`.

The container is safe to run as root (Railway’s default). Ledger directory is `/data/ledger` and created with open permissions for volume mounts.

Build time is long: the first stage compiles four Solana programs with the pinned toolchain.

## Environment variables

| Name | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | HTTP listen port (Railway injects this) |
| `DATA_DIR` | `/data` | Keypairs, demo-config, activity log |
| `LEDGER_DIR` | `$DATA_DIR/ledger` | Validator ledger (volume-friendly) |
| `PROGRAMS_DIR` | `/app/programs` | `.so` files loaded at genesis |
| `PUBLIC_DIR` | `/app/public` | Built frontend |
| `PUBLIC_URL` | (from request host) | Canonical public origin for RPC URLs |
| `RESET_TOKEN` | unset | If set, required to call `POST /api/reset` |
| `MIN_BATCH_AGE_SECS` | `10` | Time before a pending batch may dispatch |
| `SETTLE_DEADLINE_SECS` | `120` | After this, anyone may `cancel_dispatch` |
| `AUTHORITY_FUNDING_LAMPORTS` | `100000000` | Rent float for each batch authority PDA |
| `KEEPER_INTERVAL_MS` | `4000` | Keeper poll |
| `HARVEST_INTERVAL_MS` | `180000` | Illustrative 7% harvest cadence |
| `VALIDATOR_RPC_PORT` | `8899` | Internal validator RPC (not published) |
| `SOLANA_HOST_CHAIN_ID` | `72057594037940281` | `solanaHostChainId(12345)` |

## Using the dApp

- Default wallet is a built-in burner stored in `localStorage` (export / reset in the header).
- Phantom or Solflare can connect if they sign Solana version-1 transactions. Point them at `/rpc` and `/rpc-ws` via **Custom RPC**.
- Pages: Overview, Faucet / Shield, Deposit, Portfolio (decrypt + redeem), Activity.

Decrypt uses the cleartext user-decrypt client and a permit (`solana:signOffchainMessage` on the burner; required on external wallets).

## Layout

```
apps/api          Bun keeper + HTTP + RPC/WS proxy
apps/web          React 19 + Vite + MetalUI (light, blue/white)
packages/demo     Vault flows, settlement (cleartext certs), claim, harvest
vendor/fhevm      Pinned programs, SDK, clients, IDLs
Dockerfile.railway
```

`@fhevm/sdk` is **not** on npm. This repo vendors `sdk/js-sdk/src` and exports TypeScript (`./solana`, `./solana/cleartext`).
