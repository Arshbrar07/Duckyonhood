const ROBINHOOD_MSTR_URL = "https://api.robinhood.com/rhj/prices/MSTR";

function corsHeaders(origin) {
  const allowed =
    origin === "https://duckyonhood.pages.dev" ||
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

    if (request.method !== "GET" || url.pathname !== "/mstr-price") {
      return Response.json({ error: "Not found" }, { status: 404, headers });
    }

    try {
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
      console.error(JSON.stringify({ event: "mstr_price_fetch_failed", message: String(error) }));
      return Response.json(
        { error: "Price service temporarily unavailable" },
        { status: 502, headers },
      );
    }
  },
};
