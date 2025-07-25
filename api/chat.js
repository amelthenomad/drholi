import { createClient } from '@supabase/supabase-js';
import { OpenAI } from 'openai';

export default async function handler(req, res) {
  try {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Invalid message format.' });
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_KEY
    );

    const openai = new OpenAI({ apiKey: process.env.OPENAI_KEY });

    const lastMsg = messages[messages.length - 1]?.content || '';
    const keyword = lastMsg.split(' ').slice(0, 3).join(' ');

    const { data } = await supabase
      .from('herb_condition_clean_view')
      .select('*')
      .ilike('condition', `%${keyword}%`)
      .limit(5);

    const chat = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: 'You are DrHoli, a cautious and clinically-aware herbal advisor.' },
        ...messages,
        { role: 'user', content: `Relevant database entries: ${JSON.stringify(data)}` }
      ],
      temperature: 0.7,
    });

    res.status(200).json({ reply: chat.choices[0].message.content });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
