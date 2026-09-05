const ROBINHOOD_MSTR_URL = "https://api.robinhood.com/rhj/prices/MSTR";
const BLOCKSCOUT_TOKEN_URL = "https://robinhoodchain.blockscout.com/api/v2/tokens/0x6C08a59f65D9979aB848D6788DAd111db754d90D";
const BLOCKSCOUT_LOGS_URL = "https://robinhoodchain.blockscout.com/api";
const DUCKY_TOKEN = "0x6C08a59f65D9979aB848D6788DAd111db754d90D";
const MSTR_TOKEN = "0xec262a75e413fAfD0dF80480274532C79D42da09";
const FEE_RECIPIENT = "0xB2fb19F669081c8f600fC34E9DF013D1eF99ACE1";
const FEE_ESCROW = "0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e";
const DUCKY_CURVE = "0x66245E33efc9C328D8B59Ca5214518A39e186FEE";
const FIRST_FEE_BLOCK = 55060000;
const CREDITED_TOKEN_TOPIC = "0x5d104c62f50449fadfe6f4013c8f36588d32737f94b5ac9b83ddad33b3e1ffdf";
const VERIFIED_SNAPSHOT = {
  token: { address: DUCKY_TOKEN, name: "Mr. Ducky", symbol: "DUCKY", holders: 57 },
  rewardAsset: { address: MSTR_TOKEN, symbol: "MSTR" },
  creatorFees: { credited: "5.240438", sweeps: 37 },
  feeRecipient: FEE_RECIPIENT,
  explorerUrl: `https://robinhoodchain.blockscout.com/token/${DUCKY_TOKEN}`,
  updatedAt: "2026-09-05T12:15:00.000Z",
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

async function fetchDuckyData() {
  const logsUrl = new URL(BLOCKSCOUT_LOGS_URL);
  logsUrl.search = new URLSearchParams({
    module: "logs",
    action: "getLogs",
    fromBlock: String(FIRST_FEE_BLOCK),
    toBlock: "latest",
    address: FEE_ESCROW,
    topic0: CREDITED_TOKEN_TOPIC,
    topic1: topicAddress(FEE_RECIPIENT),
    topic2: topicAddress(MSTR_TOKEN),
    topic3: topicAddress(DUCKY_CURVE),
    topic0_1_opr: "and",
    topic0_2_opr: "and",
    topic0_3_opr: "and",
    topic1_2_opr: "and",
    topic1_3_opr: "and",
    topic2_3_opr: "and",
  }).toString();
  const logsPromise = fetch(logsUrl, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; DuckyRewards/1.0; +https://mrducky.xyz)",
    },
    cf: { cacheEverything: true, cacheTtl: 30 },
  }).then(async (response) => {
    const payload = await response.json();
    if (!response.ok || payload.status !== "1" || !Array.isArray(payload.result)) {
      throw new Error(`Explorer log request failed: ${payload.message || response.status}`);
    }
    return payload.result;
  });
  const holderPromise = fetch(BLOCKSCOUT_TOKEN_URL, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; DuckyRewards/1.0; +https://mrducky.xyz)",
    },
    cf: { cacheEverything: true, cacheTtl: 30 },
  }).then((response) => response.ok ? response.json() : null).catch(() => null);

  const [logs, tokenInfo] = await Promise.all([logsPromise, holderPromise]);
  const totalCredited = logs.reduce((sum, log) => sum + BigInt(log.data), 0n);

  return {
    token: { address: DUCKY_TOKEN, name: "Mr. Ducky", symbol: "DUCKY", holders: Number(tokenInfo?.holders_count || VERIFIED_SNAPSHOT.token.holders) },
    rewardAsset: { address: MSTR_TOKEN, symbol: "MSTR" },
    creatorFees: { credited: formatTokenAmount(totalCredited), sweeps: logs.length },
    feeRecipient: FEE_RECIPIENT,
    explorerUrl: `https://robinhoodchain.blockscout.com/token/${DUCKY_TOKEN}`,
    updatedAt: new Date().toISOString(),
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
  async fetch(request) {
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
        const data = await fetchDuckyData();
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
};
