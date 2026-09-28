// Cloudflare Worker: отдаёт подарки пользователя, открывшего Mini App.
// Секрет BOT_TOKEN задаётся командой `npx wrangler secret put BOT_TOKEN`.

const ALLOWED_ORIGIN = "https://zabatv.github.io";
const INIT_DATA_MAX_AGE = 24 * 60 * 60; // секунд
const MAX_PAGES = 5; // до 500 подарков

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    const url = new URL(request.url);
    if (url.pathname !== "/gifts" || request.method !== "POST") {
      return json({ error: "not_found" }, 404, cors);
    }

    let body;
    try { body = await request.json(); } catch { return json({ error: "bad_json" }, 400, cors); }

    const user = await validateInitData(body?.initData, env.BOT_TOKEN);
    if (!user) return json({ error: "unauthorized" }, 401, cors);

    try {
      const owned = await fetchAllGifts(user.id, env.BOT_TOKEN);
      return json(await summarize(owned), 200, cors);
    } catch (e) {
      return json({ error: "telegram_error", message: e.message }, 502, cors);
    }
  },
};

// ---------- Проверка initData (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app) ----------
async function validateInitData(initData, botToken) {
  if (typeof initData !== "string" || !initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");

  const secret = await hmac(new TextEncoder().encode("WebAppData"), botToken);
  const expected = toHex(await hmac(secret, dataCheckString));
  if (!timingSafeEqual(expected, hash)) return null;

  const authDate = Number(params.get("auth_date"));
  if (!authDate || Date.now() / 1000 - authDate > INIT_DATA_MAX_AGE) return null;

  try { return JSON.parse(params.get("user")); } catch { return null; }
}

async function hmac(keyBytes, message) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

const toHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------- Bot API ----------
async function fetchAllGifts(userId, botToken) {
  const gifts = [];
  let offset = "";
  let total = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/getUserGifts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, offset, limit: 100 }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.description || "getUserGifts failed");
    total = data.result.total_count;
    gifts.push(...data.result.gifts);
    offset = data.result.next_offset;
    if (!offset) break;
  }
  return { total, gifts };
}

// ---------- Оценка уникальных подарков по Fragment ----------
// У Bot API нет рыночной цены, поэтому берём минимальную цену коллекции на fragment.com (в TON)
// и переводим в звёзды по цене, за которую Fragment продаёт звёзды.
async function fragmentHtml(path) {
  const res = await fetch(`https://fragment.com${path}`, {
    headers: { "User-Agent": "Mozilla/5.0" },
    cf: { cacheTtl: 600, cacheEverything: true },
  });
  if (!res.ok) throw new Error(`fragment ${res.status}`);
  return res.text();
}

// "9<span class="mini-frac">.4347</span>" → 9.4347, "1,000" → 1000
const parseValue = (raw) => Number(raw.replace(/<[^>]+>/g, "").replace(/[,\s]/g, ""));

async function starsPerTon() {
  const html = await fragmentHtml("/stars/buy");
  const block = html.slice(html.indexOf('name="stars" value="1000"'));
  const m = block.match(/icon-ton">([\s\S]*?)<\/div>/);
  const ton = m && parseValue(m[1]);
  if (!ton) throw new Error("stars rate not found");
  return 1000 / ton;
}

async function collectionFloorTon(collection) {
  const html = await fragmentHtml(`/gifts/${collection}?sort=price_asc&filter=sale`);
  const m = html.match(/tm-grid-item-value tm-value icon-before icon-ton">([\s\S]*?)<\/div>/);
  return m ? parseValue(m[1]) : null;
}

async function priceUniqueGifts(items) {
  const unique = items.filter((i) => i.type === "unique" && i.slug);
  if (!unique.length) return;

  let rate;
  try { rate = await starsPerTon(); } catch { return; }

  const collections = [...new Set(unique.map((i) => i.slug.split("-")[0].toLowerCase()))];
  const floors = Object.fromEntries(
    await Promise.all(collections.map(async (c) => [c, await collectionFloorTon(c).catch(() => null)])),
  );

  for (const item of unique) {
    const floor = floors[item.slug.split("-")[0].toLowerCase()];
    if (!floor) continue;
    item.floorTon = floor;
    item.stars = Math.round(floor * rate);
    item.estimated = true;
  }
}

// Оставляем только то, что нужно приложению
async function summarize({ total, gifts }) {
  const items = gifts.map((g) => {
    if (g.type === "unique") {
      const u = g.gift;
      const c = u.backdrop?.colors;
      return {
        type: "unique",
        title: u.base_name,
        number: u.number,
        slug: u.name,
        emoji: u.model?.sticker?.emoji || "🎁",
        model: u.model?.name,
        backdrop: c && { center: hexColor(c.center_color), edge: hexColor(c.edge_color), text: hexColor(c.text_color) },
        date: g.send_date,
        sender: g.sender_user?.first_name,
      };
    }
    return {
      type: "regular",
      emoji: g.gift?.sticker?.emoji || "🎁",
      stars: g.gift?.star_count || 0,
      limited: Boolean(g.gift?.total_count),
      date: g.send_date,
      sender: g.sender_user?.first_name,
      text: g.text,
    };
  });

  await priceUniqueGifts(items);

  return {
    total,
    unique: items.filter((i) => i.type === "unique").length,
    estimated: items.some((i) => i.estimated),
    stars: items.reduce((sum, i) => sum + (i.stars || 0), 0),
    items,
  };
}

const hexColor = (n) => "#" + n.toString(16).padStart(6, "0");

function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
  });
}
