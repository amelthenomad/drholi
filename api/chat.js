export const config = {
  api: {
    bodyParser: false,
  },
};

const SYSTEM_PROMPT = `
You are "DrHoli AI", a clinical-grade herbal and supplement advisor...
[INSERT FULL MASTER PROMPT HERE OR IMPORT FROM FILE]
`;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://drholi.webflow.io");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const buffers = [];
    for await (const chunk of req) buffers.push(chunk);
    const body = JSON.parse(Buffer.concat(buffers).toString());

    const { messages = [], lang = "en", complianceMode = false } = body;
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Missing OpenAI API key" });

    // Force inject the system prompt
    const finalMessages = [
      {
        role: "system",
        content: SYSTEM_PROMPT + (complianceMode ? "\n[compliance_mode: strict]" : ""),
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

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const decoder = new TextDecoder("utf-8");
    const reader = openaiRes.body.getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split("\n").filter(line => line.trim().startsWith("data:"));

      for (const line of lines) {
        const message = line.replace(/^data: /, "").trim();
        if (message === "[DONE]") {
          res.write("[DONE]\n\n");
          return res.end();
        }
        try {
          const json = JSON.parse(message);
          const token = json.choices[0]?.delta?.content || "";
          res.write(token);
        } catch (err) {
          console.error("Stream parse error:", err);
        }
      }
    }
  } catch (err) {
    console.error("Handler error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}

// Optional: Apply logit_bias for preferred language (e.g., bias tokens toward certain phrases)
function getLanguageBias(lang) {
  const biases = {
    sr: { "26739": 5 }, // e.g., bias toward "zdravlje"
    fr: { "368": 5 },   // bias toward "la"
    es: { "22191": 5 }, // bias toward "el"
    de: { "671": 5 },   // bias toward "der"
  };
  return biases[lang] || {};
}



