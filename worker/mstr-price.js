const ROBINHOOD_MSTR_URL = "https://api.robinhood.com/rhj/prices/MSTR";
const BLOCKSCOUT_TOKEN_URL = "https://robinhoodchain.blockscout.com/api/v2/tokens/0x6C08a59f65D9979aB848D6788DAd111db754d90D";
const DUCKY_TOKEN = "0x6C08a59f65D9979aB848D6788DAd111db754d90D";
const MSTR_TOKEN = "0xec262a75e413fAfD0dF80480274532C79D42da09";
const FEE_RECIPIENT = "0xB2fb19F669081c8f600fC34E9DF013D1eF99ACE1";
const FEE_ESCROW = "0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e";
const DUCKY_CURVE = "0x66245E33efc9C328D8B59Ca5214518A39e186FEE";
const CREDITED_TOKEN_TOPIC = "0x5d104c62f50449fadfe6f4013c8f36588d32737f94b5ac9b83ddad33b3e1ffdf";
const STATE_KEY = "ducky-fee-state";
const BASELINE_STATE = {
  lastBlock: 55115385,
  totalWei: "5305797743943837178",
  sweeps: 38,
  updatedAt: "2026-09-05T12:20:00.000Z",
};
const VERIFIED_SNAPSHOT = {
  token: { address: DUCKY_TOKEN, name: "Mr. Ducky", symbol: "DUCKY", holders: 57 },
  rewardAsset: { address: MSTR_TOKEN, symbol: "MSTR" },
  creatorFees: { credited: "5.305797", sweeps: 38 },
  feeRecipient: FEE_RECIPIENT,
  explorerUrl: `https://robinhoodchain.blockscout.com/token/${DUCKY_TOKEN}`,
  updatedAt: BASELINE_STATE.updatedAt,
  source: "verified-snapshot",
};

function topicAddress(address) {
  return "0x" + address.toLowerCase().slice(2).padStart(64, "0");
}

function formatTokenAmount(value, decimals = 18, places = 6) {
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = (value % base).toString().padStart(decimals, "0").slice(0, places);
  return `${whole}.${fraction}`;
}

async function rpc(rpcUrl, method, params) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const payload = await response.json();
  if (!response.ok || payload.error || payload.result === undefined) {
    const code = payload.error?.code ?? response.status;
    const message = payload.error?.message ?? "invalid RPC response";
    throw new Error(`RPC ${method} failed (${code}): ${message}`);
  }
  return payload.result;
}

async function updateDuckyState(env) {
  if (!env.ROBINHOOD_RPC_URL) throw new Error("ROBINHOOD_RPC_URL secret is not configured");
  const state = (await env.DUCKY_STATE.get(STATE_KEY, "json")) || BASELINE_STATE;
  const latestHex = await rpc(env.ROBINHOOD_RPC_URL, "eth_blockNumber", []);
  const latestBlock = Number.parseInt(latestHex, 16);
  let lastBlock = state.lastBlock;
  let totalWei = BigInt(state.totalWei);
  let sweeps = state.sweeps;
  const targetBlock = Math.min(latestBlock, lastBlock + 400);

  while (lastBlock < targetBlock) {
    const fromBlock = lastBlock + 1;
    const toBlock = Math.min(fromBlock + 9, targetBlock);
    const logs = await rpc(env.ROBINHOOD_RPC_URL, "eth_getLogs", [{
      fromBlock: `0x${fromBlock.toString(16)}`,
      toBlock: `0x${toBlock.toString(16)}`,
      address: FEE_ESCROW,
      topics: [
        CREDITED_TOKEN_TOPIC,
        topicAddress(FEE_RECIPIENT),
        topicAddress(MSTR_TOKEN),
        topicAddress(DUCKY_CURVE),
      ],
    }]);
    totalWei += logs.reduce((sum, log) => sum + BigInt(log.data), 0n);
    sweeps += logs.length;
    lastBlock = toBlock;
  }

  const nextState = { lastBlock, totalWei: totalWei.toString(), sweeps, updatedAt: new Date().toISOString() };
  await env.DUCKY_STATE.put(STATE_KEY, JSON.stringify(nextState));
  return nextState;
}

async function fetchDuckyData(env) {
  const state = (await env.DUCKY_STATE.get(STATE_KEY, "json")) || BASELINE_STATE;
  const holderPromise = fetch(BLOCKSCOUT_TOKEN_URL, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; DuckyRewards/1.0; +https://mrducky.xyz)",
    },
    cf: { cacheEverything: true, cacheTtl: 30 },
  }).then((response) => response.ok ? response.json() : null).catch(() => null);

  const tokenInfo = await holderPromise;

  return {
    token: { address: DUCKY_TOKEN, name: "Mr. Ducky", symbol: "DUCKY", holders: Number(tokenInfo?.holders_count || VERIFIED_SNAPSHOT.token.holders) },
    rewardAsset: { address: MSTR_TOKEN, symbol: "MSTR" },
    creatorFees: { credited: formatTokenAmount(BigInt(state.totalWei)), sweeps: state.sweeps },
    feeRecipient: FEE_RECIPIENT,
    explorerUrl: `https://robinhoodchain.blockscout.com/token/${DUCKY_TOKEN}`,
    updatedAt: state.updatedAt,
    source: "live-on-chain",
  };
}

function corsHeaders(origin) {
  const allowed =
    origin === "https://duckyonhood.pages.dev" ||
    origin === "https://mrducky.xyz" ||
    origin === "https://www.mrducky.xyz" ||
    /^https:\/\/[a-z0-9-]+\.duckyonhood\.pages\.dev$/.test(origin);

  return {
    "Access-Control-Allow-Origin": allowed ? origin : "https://duckyonhood.pages.dev",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const headers = corsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    if (request.method !== "GET" || !["/mstr-price", "/ducky-data"].includes(url.pathname)) {
      return Response.json({ error: "Not found" }, { status: 404, headers });
    }

    try {
      if (url.pathname === "/ducky-data") {
        const data = await fetchDuckyData(env);
        return Response.json(data, {
          headers: { ...headers, "Cache-Control": "public, max-age=30" },
        });
      }

      const upstream = await fetch(ROBINHOOD_MSTR_URL, {
        headers: { Accept: "application/json" },
        cf: { cacheEverything: true, cacheTtl: 15 },
      });

      if (!upstream.ok) {
        return Response.json(
          { error: "Price service temporarily unavailable" },
          { status: 502, headers },
        );
      }

      return new Response(upstream.body, {
        status: 200,
        headers: {
          ...headers,
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=15",
        },
      });
    } catch (error) {
      console.error(JSON.stringify({ event: "upstream_fetch_failed", path: url.pathname, message: String(error) }));
      if (url.pathname === "/ducky-data") {
        return Response.json(VERIFIED_SNAPSHOT, {
          headers: { ...headers, "Cache-Control": "public, max-age=300", "X-Data-Source": "verified-snapshot" },
        });
      }
      return Response.json(
        { error: "Live data temporarily unavailable" },
        { status: 502, headers },
      );
    }
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(updateDuckyState(env));
  },
};
