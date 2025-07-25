import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)
const openai = new OpenAI({ apiKey: process.env.OPENAI_KEY })

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { messages } = req.body
  const lastMsg = messages?.[messages.length - 1]?.content || ''

  const keyword = lastMsg.split(' ').slice(0, 3).join(' ')
  const { data } = await supabase
    .from('herb_condition_clean_view')
    .select('*')
    .ilike('condition', `%${keyword}%`)
    .limit(5)

  const chat = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [
      { role: 'system', content: 'You are DrHoli, a cautious and clinically-aware herbal advisor.' },
      ...messages,
      { role: 'user', content: `Relevant database entries: ${JSON.stringify(data)}` }
    ],
    temperature: 0.7
  })

  res.status(200).json({ reply: chat.choices[0].message.content })
}

