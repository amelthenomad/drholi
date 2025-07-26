// api/chat.js

export const config = {
  api: {
    bodyParser: false,
  },
};

const SYSTEM_PROMPT = `...`; // (keep your full system prompt here exactly as-is)

export default async function handler(req, res) {
  // ─── CORS PRE-FLIGHT ───
  res.setHeader("Access-Control-Allow-Origin", "https://drholi.webflow.io");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Handle OPTIONS preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Handle unsupported methods
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Read raw streamed body
    const buffers = [];
    for await (const chunk of req) buffers.push(chunk);
    const rawBody = Buffer.concat(buffers).toString();
    const { messages = [], lang = "en", complianceMode = false } = JSON.parse(rawBody);

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Missing OpenAI API key" });
    }

    const finalMessages = [
      {
        role: "system",
        content:
          SYSTEM_PROMPT +
          (complianceMode ? "\n[compliance_mode: strict]" : ""),
      },
      ...messages,
    ];

    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
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
        ...(lang && lang !== "en" ? { logit_bias: getLanguageBias(lang) } : {}),
      }),
    });

    if (!openaiRes.ok || !openaiRes.body) {
      return res.status(500).json({ error: "OpenAI failed to stream" });
    }

    // Streaming response
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const reader = openaiRes.body.getReader();
    const decoder = new TextDecoder("utf-8");

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split("\n")) {
        if (line.startsWith("data:")) {
          const data = line.replace(/^data:\s*/, "");
          if (data === "[DONE]") {
            res.write("data: [DONE]\n\n");
            return res.end();
          }
          try {
            const json = JSON.parse(data);
            const token = json.choices[0]?.delta?.content || "";
            res.write(`data: ${token}\n\n`);
          } catch {
            // skip non-JSON lines
          }
        }
      }
    }
  } catch (err) {
    console.error("Handler error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}

function getLanguageBias(lang) {
  const biases = {
    sr: { "26739": 5 },
    fr: { "368": 5 },
    es: { "22191": 5 },
    de: { "671": 5 },
  };
  return biases[lang] || {};
}

