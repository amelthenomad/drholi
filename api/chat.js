// api/chat.js

export const config = {
  api: {
    bodyParser: false,
  },
};

const SYSTEM_PROMPT = `
You are "DrHoli AI", a clinical‑grade herbal and supplement advisor...
[INSERT FULL MASTER PROMPT HERE OR IMPORT FROM FILE]
`;

export default async function handler(req, res) {
  // — CORS: allow all origins for OPTIONS & POST —
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "OPTIONS,POST");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Handle preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  // Only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Parse JSON body
  let body;
  try {
    const bufs = [];
    for await (const chunk of req) bufs.push(chunk);
    body = JSON.parse(Buffer.concat(bufs).toString());
  } catch {
    return res.status(400).json({ error: "Invalid JSON" });
  }

  const { messages = [], lang = "en", complianceMode = false } = body;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("Missing OPENAI_API_KEY");
    return res.status(500).json({ error: "Missing OpenAI API key" });
  }

  // Build the ChatGPT messages array
  const finalMessages = [
    {
      role: "system",
      content:
        SYSTEM_PROMPT + (complianceMode ? "\n[compliance_mode: strict]" : ""),
    },
    ...messages,
  ];

  // Call OpenAI with streaming enabled
  let openaiRes;
  try {
    openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4",
        messages: finalMessages,
        temperature: 0.7,
        stream: true,
        ...(lang !== "en" ? { logit_bias: getLanguageBias(lang) } : {}),
      }),
    });
  } catch (err) {
    console.error("OpenAI request failed:", err);
    return res.status(502).json({ error: "Failed to reach OpenAI" });
  }

  if (!openaiRes.ok || !openaiRes.body) {
    console.error("OpenAI bad response:", await openaiRes.text());
    return res.status(500).json({ error: "OpenAI failed to stream" });
  }

  // Stream back as Server‑Sent Events
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const reader = openaiRes.body.getReader();
  const decoder = new TextDecoder("utf-8");
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    for (const line of chunk.split("\n").filter(l => l.startsWith("data:"))) {
      const data = line.replace(/^data:\s*/, "");
      if (data === "[DONE]") {
        res.write("data: [DONE]\n\n");
        return res.end();
      }
      try {
        const parsed = JSON.parse(data);
        const token = parsed.choices[0].delta.content || "";
        res.write(`data: ${token}\n\n`);
      } catch (e) {
        console.error("Stream parse error:", e);
      }
    }
  }
  res.end();
}

function getLanguageBias(lang) {
  return {
    sr: { "26739": 5 },
    fr: { "368": 5 },
    es: { "22191": 5 },
    de: { "671": 5 },
  }[lang] || {};
}

