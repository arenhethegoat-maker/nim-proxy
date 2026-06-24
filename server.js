import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 3000;

// NVIDIA API config
const NVIDIA_API_URL = "https://integrate.api.nvidia.com/v1";
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
const MODEL = "moonshotai/kimi-k2-instruct"; // Kimi K2 on NVIDIA NIM

app.use(express.json({ limit: "10mb" }));

// CORS — allows Janitor AI to reach your proxy
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// Optional: simple auth so only you can use this proxy.
// Set PROXY_PASSWORD in your Render env vars, then put it as
// the API key in Janitor AI's custom API key field.
app.use((req, res, next) => {
  const proxyPassword = process.env.PROXY_PASSWORD;
  if (!proxyPassword) return next(); // no password set = open proxy

  const auth = req.headers.authorization || "";
  const token = auth.replace("Bearer ", "").trim();
  if (token !== proxyPassword) {
    return res.status(401).json({ error: { message: "Unauthorized", type: "invalid_request_error" } });
  }
  next();
});

// Health check — Render uses this to confirm the service is up
app.get("/", (req, res) => {
  res.json({ status: "ok", model: MODEL });
});

// Models list — Janitor AI sometimes calls this endpoint
app.get("/v1/models", (req, res) => {
  res.json({
    object: "list",
    data: [
      {
        id: MODEL,
        object: "model",
        created: Date.now(),
        owned_by: "moonshotai",
      },
    ],
  });
});

// Main chat completions endpoint
app.post("/v1/chat/completions", async (req, res) => {
  if (!NVIDIA_API_KEY) {
    return res.status(500).json({
      error: { message: "NVIDIA_API_KEY is not set on the server.", type: "server_error" },
    });
  }

  try {
    const body = {
      ...req.body,
      model: MODEL, // always override with Kimi K2
    };

    const isStream = body.stream === true;

    const upstream = await fetch(`${NVIDIA_API_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${NVIDIA_API_KEY}`,
      },
      body: JSON.stringify(body),
    });

    // Forward HTTP errors from NVIDIA back to the client
    if (!upstream.ok) {
      const errText = await upstream.text();
      return res.status(upstream.status).send(errText);
    }

    if (isStream) {
      // Stream mode: pipe NVIDIA's SSE stream directly to Janitor AI
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      upstream.body.pipe(res);
    } else {
      // Non-stream mode: forward JSON response
      const data = await upstream.json();
      res.json(data);
    }
  } catch (err) {
    console.error("Proxy error:", err);
    res.status(500).json({
      error: { message: err.message, type: "server_error" },
    });
  }
});

app.listen(PORT, () => {
  console.log(`Proxy running on port ${PORT}`);
  console.log(`Model: ${MODEL}`);
  console.log(`NVIDIA key loaded: ${!!NVIDIA_API_KEY}`);
});
