// Mediaverse AI Buddy server.
// The Groq key lives ONLY here (as an environment variable), never in the website.
import express from "express";
import { Groq } from "groq-sdk";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { GROQ_API_KEY, FIREBASE_API_KEY, PORT = 3000, ALLOW_ORIGIN } = process.env;
if (!GROQ_API_KEY || !FIREBASE_API_KEY) {
  console.error("Missing GROQ_API_KEY or FIREBASE_API_KEY. See .env.example.");
  process.exit(1);
}

const groq = new Groq({ apiKey: GROQ_API_KEY });
const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "20kb" }));

// Only needed if the website is hosted somewhere other than this server.
app.use((req, res, next) => {
  if (ALLOW_ORIGIN) {
    res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN);
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Serve only the website file (never the folder, so .env can't be downloaded).
app.get("/", (req, res) => res.sendFile(path.join(here, "index.html")));

// ---- only logged-in Mediaverse users may chat (checks their Firebase login) ----
const verified = new Map(); // token -> { uid, until }
async function verify(token) {
  const hit = verified.get(token);
  if (hit && hit.until > Date.now()) return hit.uid;
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken: token }),
  });
  if (!r.ok) return null;
  const u = (await r.json()).users?.[0];
  if (!u || u.disabled) return null;
  verified.set(token, { uid: u.localId, until: Date.now() + 5 * 60 * 1000 });
  return u.localId;
}

// ---- simple per-user limit: 20 messages every 10 minutes ----
const hits = new Map();
function limited(uid) {
  const now = Date.now();
  const list = (hits.get(uid) || []).filter((t) => now - t < 600000);
  list.push(now);
  hits.set(uid, list);
  return list.length > 20;
}
setInterval(() => {
  const n = Date.now();
  for (const [k, v] of verified) if (v.until < n) verified.delete(k);
  for (const [k, l] of hits) if (!l.some((t) => n - t < 600000)) hits.delete(k);
}, 60000).unref();

const SYSTEM = `You are AI Buddy, the friendly robot helper on Mediaverse, a community site for drawings, tournaments, communities and friends.
Be warm, upbeat and brief. Many users are young, so keep everything age-appropriate.
Never ask for or encourage sharing personal info (real name, address, school, phone, passwords).
Do not help with anything violent, sexual, hateful or dangerous; gently steer back to something kind and fun.
Never pretend to be human. If someone seems upset or unsafe, be kind and suggest talking to a trusted adult.
You can suggest community ideas, tournament ideas and drawing prompts, and explain how the site works.`;

app.post("/api/chat", async (req, res) => {
  try {
    const token = (req.headers.authorization || "").replace(/^Bearer /, "");
    const uid = token && (await verify(token));
    if (!uid) return res.status(401).json({ error: "Please log in to chat with AI Buddy." });
    if (limited(uid)) return res.status(429).json({ error: "You’re chatting fast! Give AI Buddy a minute to rest." });

    const msgs = (Array.isArray(req.body?.messages) ? req.body.messages : [])
      .slice(-12)
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .map((m) => ({ role: m.role, content: m.content.slice(0, 1000) }));
    if (!msgs.length || msgs[msgs.length - 1].role !== "user") {
      return res.status(400).json({ error: "Say something first!" });
    }

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Accel-Buffering", "no");

    const stream = await groq.chat.completions.create({
      messages: [{ role: "system", content: SYSTEM }, ...msgs],
      model: "openai/gpt-oss-120b",
      temperature: 1,
      max_completion_tokens: 2048,
      top_p: 1,
      stream: true,
      reasoning_effort: "medium",
      stop: null,
    });
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content;
      if (text) res.write(text);
    }
    res.end();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: "AI Buddy is having a nap. Try again soon." });
    else res.end();
  }
});

app.listen(PORT, () => console.log(`Mediaverse is running on http://localhost:${PORT}`));
