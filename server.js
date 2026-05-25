require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pdf = require('pdf-parse');
const axios = require('axios');
const cheerio = require('cheerio');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// ==================== SETUP ====================
const app = express();
const PORT = process.env.PORT || 3000;

if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');
if (!fs.existsSync('public')) fs.mkdirSync('public');

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_')),
});
const upload = multer({ storage, limits: { fileSize: 200 * 1024 * 1024 } });

// ==================== JSON DATABASE ====================
const DB_FILE = 'noteai-data.json';

function readDB() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    return { notebooks: [], sources: [], messages: [], _nextId: 1 };
  }
}

function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function nextId() {
  const db = readDB();
  const id = db._nextId || 1;
  db._nextId = id + 1;
  writeDB(db);
  return id;
}

function now() { return Math.floor(Date.now() / 1000); }

// ==================== GEMINI AI ====================
let geminiModel = null;

function initGemini() {
  const key = process.env.GEMINI_API_KEY;
  if (key && key.trim() && key !== 'your_gemini_api_key_here') {
    try {
      const genAI = new GoogleGenerativeAI(key.trim());
      geminiModel = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      console.log('✅ Gemini 1.5 Flash initialized');
      return true;
    } catch (e) {
      console.warn('⚠️  Gemini init failed:', e.message);
    }
  } else {
    console.warn('⚠️  No GEMINI_API_KEY found in .env — running in demo mode');
  }
  return false;
}

const geminiReady = initGemini();

async function callGemini(prompt, maxTokens = 2048) {
  if (!geminiModel) return null;
  try {
    const result = await geminiModel.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 },
    });
    return result.response.text();
  } catch (err) {
    console.error('Gemini error:', err.message);
    return null;
  }
}

function buildSourcesContext(sources) {
  if (!sources || !sources.length) return '';
  return sources.map((s, i) =>
    `=== [Source ${i + 1}: ${s.name}] ===\n${(s.content || '').substring(0, 12000)}`
  ).join('\n\n');
}

// ==================== HELPERS ====================
function getFileIcon(filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  const map = { pdf:'📕', docx:'📘', doc:'📘', txt:'📄', md:'📝', pptx:'📊', xlsx:'📊', csv:'📊', html:'🌐' };
  return map[ext] || '📄';
}

async function extractPdfText(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    const data = await pdf(buf);
    return data.text || '';
  } catch (e) {
    return `[PDF could not be parsed: ${e.message}]`;
  }
}

async function scrapeUrl(url) {
  const { data } = await axios.get(url, {
    timeout: 15000,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NoteAI/1.0; +https://noteai.app)' },
    maxRedirects: 5,
  });
  const $ = cheerio.load(data);
  $('script, style, nav, footer, header, aside, .ads, .ad, noscript').remove();
  const title = $('title').text().trim() || new URL(url).hostname;
  const body = $('article, main, [role="main"], .content, .post, body').first().text()
    .replace(/\s+/g, ' ').trim().substring(0, 50000);
  return { title, content: body };
}

async function getYoutubeTranscript(url) {
  try {
    const { YoutubeTranscript } = require('youtube-transcript');
    const videoId = url.match(/(?:v=|youtu\.be\/)([^&\s?#]+)/)?.[1];
    if (!videoId) throw new Error('Invalid YouTube URL — could not extract video ID');
    const transcript = await YoutubeTranscript.fetchTranscript(videoId);
    const text = transcript.map(t => t.text).join(' ');
    return { title: `YouTube: ${videoId}`, content: text };
  } catch (err) {
    return {
      title: 'YouTube Video',
      content: `[Transcript unavailable: ${err.message}. Try adding the transcript manually via "Paste text".]`
    };
  }
}

// Demo AI responses when no Gemini key
const DEMO = [
  "Based on your sources, here are the key findings:\n\n**Main Themes:**\nThe source material explores several interconnected ideas. [Source 1] provides foundational context while establishing the primary argument.\n\n**Key Points:**\n- Current approaches show measurable limitations\n- Evidence-based alternatives demonstrate significant improvement\n- Cross-sector collaboration is highlighted as essential\n\n*💡 Tip: Add your GEMINI_API_KEY to .env for real AI responses grounded in your actual documents.*",
  "Great question! Looking at your sources:\n\n[Source 1] addresses this directly. The core argument is that systematic change requires both theoretical grounding and practical evidence.\n\n**Supporting Evidence:**\nMultiple data points converge on the same conclusion, strengthening the overall case presented.\n\n*💡 Add GEMINI_API_KEY to .env for real Gemini-powered responses.*",
];
let demoI = 0;

// ==================== NOTEBOOK ROUTES ====================

app.get('/api/notebooks', (req, res) => {
  const db = readDB();
  const notebooks = (db.notebooks || []).map(nb => {
    const sc = (db.sources || []).filter(s => s.notebook_id === nb.id).length;
    const mc = (db.messages || []).filter(m => m.notebook_id === nb.id).length;
    return { ...nb, source_count: sc, message_count: mc };
  }).sort((a, b) => b.updated_at - a.updated_at);
  res.json(notebooks);
});

app.post('/api/notebooks', (req, res) => {
  const { name = 'Untitled Notebook', icon = '📓' } = req.body;
  const db = readDB();
  const nb = { id: nextId(), name, icon, created_at: now(), updated_at: now() };
  db.notebooks = db.notebooks || [];
  db.notebooks.push(nb);
  writeDB(db);
  res.json({ ...nb, source_count: 0, message_count: 0 });
});

app.put('/api/notebooks/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const { name, icon } = req.body;
  const db = readDB();
  const nb = (db.notebooks || []).find(n => n.id === id);
  if (nb) { nb.name = name; nb.icon = icon; nb.updated_at = now(); writeDB(db); }
  res.json({ ok: true });
});

app.delete('/api/notebooks/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const db = readDB();
  // Clean up uploaded files
  (db.sources || []).filter(s => s.notebook_id === id && s.file_path).forEach(s => {
    if (fs.existsSync(s.file_path)) fs.unlinkSync(s.file_path);
  });
  db.notebooks = (db.notebooks || []).filter(n => n.id !== id);
  db.sources = (db.sources || []).filter(s => s.notebook_id !== id);
  db.messages = (db.messages || []).filter(m => m.notebook_id !== id);
  writeDB(db);
  res.json({ ok: true });
});

// ==================== SOURCE ROUTES ====================

app.get('/api/notebooks/:id/sources', (req, res) => {
  const id = parseInt(req.params.id);
  const db = readDB();
  const sources = (db.sources || [])
    .filter(s => s.notebook_id === id)
    .map(({ id, name, type, icon, url, created_at }) => ({ id, name, type, icon, url, created_at }))
    .sort((a, b) => a.created_at - b.created_at);
  res.json(sources);
});

app.get('/api/notebooks/:id/sources/:sid/content', (req, res) => {
  const db = readDB();
  const src = (db.sources || []).find(s => s.id === parseInt(req.params.sid) && s.notebook_id === parseInt(req.params.id));
  if (!src) return res.status(404).json({ error: 'Source not found' });
  res.json(src);
});

// Add file source
app.post('/api/notebooks/:id/sources/file', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No file uploaded' });
    const ext = path.extname(file.originalname).toLowerCase();
    let content = '';
    if (ext === '.pdf') content = await extractPdfText(file.path);
    else if (['.txt', '.md', '.html', '.csv'].includes(ext)) content = fs.readFileSync(file.path, 'utf8');
    else content = `[File: ${file.originalname} — binary format, text extraction not available]`;

    const db = readDB();
    const src = {
      id: nextId(), notebook_id: parseInt(req.params.id),
      name: file.originalname, type: 'File',
      icon: getFileIcon(file.originalname),
      content, file_path: file.path, url: null,
      created_at: now(),
    };
    db.sources = db.sources || [];
    db.sources.push(src);
    const nb = (db.notebooks || []).find(n => n.id === src.notebook_id);
    if (nb) nb.updated_at = now();
    writeDB(db);
    const { content: _, file_path: __, ...safeSource } = src;
    res.json(safeSource);
  } catch (err) {
    console.error('File error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Add URL source
app.post('/api/notebooks/:id/sources/url', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL required' });
    const { title, content } = await scrapeUrl(url);
    const db = readDB();
    const src = {
      id: nextId(), notebook_id: parseInt(req.params.id),
      name: title, type: 'Website', icon: '🌐',
      content, file_path: null, url, created_at: now(),
    };
    db.sources = db.sources || [];
    db.sources.push(src);
    const nb = (db.notebooks || []).find(n => n.id === src.notebook_id);
    if (nb) nb.updated_at = now();
    writeDB(db);
    const { content: _, ...safe } = src;
    res.json(safe);
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch URL: ' + err.message });
  }
});

// Add text source
app.post('/api/notebooks/:id/sources/text', (req, res) => {
  const { title = 'Text snippet', content } = req.body;
  if (!content) return res.status(400).json({ error: 'Content required' });
  const db = readDB();
  const src = {
    id: nextId(), notebook_id: parseInt(req.params.id),
    name: title, type: 'Text', icon: '📝',
    content, file_path: null, url: null, created_at: now(),
  };
  db.sources = db.sources || [];
  db.sources.push(src);
  const nb = (db.notebooks || []).find(n => n.id === src.notebook_id);
  if (nb) nb.updated_at = now();
  writeDB(db);
  const { content: _, ...safe } = src;
  res.json(safe);
});

// Add YouTube source
app.post('/api/notebooks/:id/sources/youtube', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL required' });
    const { title, content } = await getYoutubeTranscript(url);
    const db = readDB();
    const src = {
      id: nextId(), notebook_id: parseInt(req.params.id),
      name: title, type: 'YouTube', icon: '▶',
      content, file_path: null, url, created_at: now(),
    };
    db.sources = db.sources || [];
    db.sources.push(src);
    const nb = (db.notebooks || []).find(n => n.id === src.notebook_id);
    if (nb) nb.updated_at = now();
    writeDB(db);
    const { content: _, ...safe } = src;
    res.json(safe);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete source
app.delete('/api/notebooks/:id/sources/:sid', (req, res) => {
  const db = readDB();
  const src = (db.sources || []).find(s => s.id === parseInt(req.params.sid));
  if (src?.file_path && fs.existsSync(src.file_path)) fs.unlinkSync(src.file_path);
  db.sources = (db.sources || []).filter(s => !(s.id === parseInt(req.params.sid) && s.notebook_id === parseInt(req.params.id)));
  writeDB(db);
  res.json({ ok: true });
});

// ==================== CHAT ROUTES ====================

app.get('/api/notebooks/:id/messages', (req, res) => {
  const db = readDB();
  const msgs = (db.messages || [])
    .filter(m => m.notebook_id === parseInt(req.params.id))
    .sort((a, b) => a.created_at - b.created_at);
  res.json(msgs);
});

app.post('/api/notebooks/:id/chat', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });
  const nbId = parseInt(req.params.id);
  const db = readDB();

  // Save user message
  db.messages = db.messages || [];
  db.messages.push({ id: nextId(), notebook_id: nbId, role: 'user', content: message, created_at: now() });
  const nb = (db.notebooks || []).find(n => n.id === nbId);
  if (nb) nb.updated_at = now();
  writeDB(db);

  // Get sources for context
  const sources = (db.sources || []).filter(s => s.notebook_id === nbId);
  let aiResponse = '';

  if (geminiReady && sources.length > 0) {
    const srcCtx = buildSourcesContext(sources);
    const history = (db.messages || [])
      .filter(m => m.notebook_id === nbId)
      .sort((a, b) => a.created_at - b.created_at)
      .slice(-12)
      .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n\n');

    const prompt = `You are NoteAI, an expert AI research assistant. Answer the user's question based ONLY on the provided source documents. Always cite sources using [Source N] notation inline. Format responses with markdown (bold, bullets, headers). Be thorough, accurate, and helpful.

SOURCES:
${srcCtx}

CONVERSATION:
${history}

User: ${message}

Answer (with [Source N] citations):`;

    aiResponse = await callGemini(prompt, 1500);
  } else if (geminiReady && sources.length === 0) {
    aiResponse = "I don't have any sources to reference yet! Please click **\"Add source\"** to upload PDFs, paste a URL, or add text. Once you've added sources, I'll answer your questions with citations grounded in your documents.";
  }

  if (!aiResponse) {
    aiResponse = sources.length === 0
      ? "Please add sources first! Click **\"Add source\"** to upload PDFs, URLs, or text. Then I can answer your questions about them.\n\n💡 *Add your GEMINI_API_KEY to `.env` for real AI-powered responses.*"
      : DEMO[demoI++ % DEMO.length];
  }

  // Save AI response
  const freshDB = readDB();
  freshDB.messages = freshDB.messages || [];
  freshDB.messages.push({ id: nextId(), notebook_id: nbId, role: 'ai', content: aiResponse, created_at: now() });
  writeDB(freshDB);

  res.json({ response: aiResponse });
});

app.delete('/api/notebooks/:id/messages', (req, res) => {
  const db = readDB();
  db.messages = (db.messages || []).filter(m => m.notebook_id !== parseInt(req.params.id));
  writeDB(db);
  res.json({ ok: true });
});

// ==================== ARTIFACT ROUTES ====================
app.post('/api/notebooks/:id/artifacts', async (req, res) => {
  const { type } = req.body;
  const db = readDB();
  const sources = (db.sources || []).filter(s => s.notebook_id === parseInt(req.params.id));

  if (!sources.length) {
    return res.json({ content: '## No Sources Found\n\nAdd sources to your notebook before generating content.' });
  }

  const srcCtx = buildSourcesContext(sources);

  const prompts = {
    'study-guide': `Create a comprehensive, well-structured study guide from these sources. Include:\n1. **Core Concepts** — key terms with definitions\n2. **Key Facts & Findings** — bullet list of important points\n3. **Review Questions** — 6 questions with detailed answers\n4. **Summary & Takeaways** — 3-5 actionable insights\n\nUse markdown formatting.\n\nSOURCES:\n${srcCtx}`,
    'briefing': `Write a professional executive briefing document from these sources. Include:\n1. **Executive Summary** (2-3 paragraphs)\n2. **Background & Context**\n3. **Key Findings** (numbered list with specifics)\n4. **Implications & Recommendations**\n5. **Conclusion**\n\nBe professional and concise. Use markdown.\n\nSOURCES:\n${srcCtx}`,
    'faq': `Generate a comprehensive FAQ (8-10 questions) from these sources. Cover the most important topics a reader would wonder about. Use **Q:** and **A:** format. Make answers detailed and informative.\n\nSOURCES:\n${srcCtx}`,
    'timeline': `Create a detailed chronological timeline of events, phases, or developments from these sources. Format each entry as:\n**[Date/Period]** — Event: Description\n\nGroup by era if applicable. Use markdown.\n\nSOURCES:\n${srcCtx}`,
    'outline': `Create a detailed hierarchical outline of the ideas in these sources. Use:\n- Roman numerals (I, II, III) for main sections\n- Capital letters (A, B, C) for subsections\n- Numbers (1, 2, 3) for details\n\nBe comprehensive. Use markdown bold for headers.\n\nSOURCES:\n${srcCtx}`,
    'audio': `Write a podcast-style "Deep Dive" script for two AI hosts named Alex and Sam. They should have a lively, engaging conversation about the key ideas in these sources — explaining concepts, making connections, and asking each other questions.\n\nLength: 600-800 words. Format strictly as:\n[Alex]: text\n[Sam]: text\n\nMake it educational and entertaining.\n\nSOURCES:\n${srcCtx}`,
  };

  const prompt = prompts[type];
  if (!prompt) return res.status(400).json({ error: 'Unknown artifact type' });

  let content = await callGemini(prompt, 2500);

  if (!content) {
    // Demo fallbacks
    const fallbacks = {
      'study-guide': `## Study Guide\n\n### Core Concepts\n- **Primary Framework**: The foundational theory underpinning the source material\n- **Methodology**: Research approach combining quantitative and qualitative methods\n- **Key Variables**: Independent and dependent factors under study\n\n### Key Findings\n- Current approaches have significant measurable limitations\n- Alternative frameworks show up to 40% improvement in key metrics\n- Cross-sector collaboration is highlighted as essential for success\n\n### Review Questions\n1. **What is the central argument?** — The evidence supports a systematic paradigm shift\n2. **What methodology was used?** — Mixed-methods with n=1,247 participants\n3. **What are the main conclusions?** — Three primary findings support the core hypothesis\n\n### Key Takeaways\n- Evidence-based reform is both necessary and achievable\n- Implementation requires stakeholder alignment\n- Further longitudinal research is recommended\n\n---\n*Add GEMINI_API_KEY to .env for AI-generated content from your actual sources.*`,
      'briefing': `## Executive Briefing\n\n### Executive Summary\nThis briefing synthesizes insights from your uploaded sources. The materials collectively address significant challenges and propose evidence-based solutions supported by empirical research.\n\n### Key Findings\n1. Current practices show measurable gaps (r=0.76, p<0.01)\n2. Alternative approaches demonstrate validated improvement\n3. Stakeholder collaboration is critical for implementation\n\n### Recommendations\n- Prioritize evidence-based approaches in high-impact areas\n- Invest in cross-disciplinary training\n- Establish monitoring frameworks\n\n### Conclusion\nImmediate action is recommended to capitalize on identified opportunities.\n\n---\n*Add GEMINI_API_KEY to .env for AI-generated content.*`,
      'faq': `## Frequently Asked Questions\n\n**Q: What is the main argument?**\nA: The sources argue that evidence-based reform of current approaches is both necessary and achievable.\n\n**Q: What evidence is provided?**\nA: Statistical analysis, case studies, and expert consensus across multiple independent sources.\n\n**Q: What are the key limitations?**\nA: Sample representativeness, rapidly changing context, and need for longitudinal validation.\n\n**Q: What action is recommended?**\nA: Immediate adoption of validated frameworks with ongoing monitoring and evaluation.\n\n---\n*Add GEMINI_API_KEY to .env for AI-generated content.*`,
      'timeline': `## Timeline\n\n**Early Period** — Foundation of theoretical framework established\n\n**Development Phase** — First empirical studies conducted; methodology refined\n\n**Validation Period** — Peer review, replication studies, and growing consensus\n\n**Current Phase** — Active implementation with strong early results\n\n**Future (Projected)** — Expected milestones and developments over next 5 years\n\n---\n*Add GEMINI_API_KEY to .env for AI-generated content.*`,
      'outline': `## Outline\n\n**I. Introduction**\n- A. Problem statement and context\n- B. Research objectives\n- C. Scope and significance\n\n**II. Theoretical Framework**\n- A. Historical background\n- B. Core models and theories\n- C. Identified gaps\n\n**III. Methodology**\n- A. Research design\n- B. Data collection\n- C. Analysis approach\n\n**IV. Findings**\n- A. Primary results\n- B. Secondary themes\n- C. Unexpected discoveries\n\n**V. Conclusion**\n- A. Summary of contributions\n- B. Recommendations\n\n---\n*Add GEMINI_API_KEY to .env for AI-generated content.*`,
      'audio': `[Alex]: Welcome to the NoteAI Deep Dive! I'm Alex, and today Sam and I are diving into some really interesting material.\n\n[Sam]: That's right, Alex! And I have to say, these sources pack a lot of insight into a compact space.\n\n[Alex]: Let's start with the big picture. What's the central argument you took away from the sources?\n\n[Sam]: The core claim is compelling: current approaches have measurable limitations, and there's strong evidence for better alternatives. The data really backs it up.\n\n[Alex]: What struck me was the methodology. It's rigorous — mixed methods, large sample sizes, statistical significance testing. This isn't just opinion.\n\n[Sam]: Exactly. And the practical implications are significant. The 40% improvement figure mentioned in the research? That's not marginal — that's transformative.\n\n[Alex]: For our listeners, the key takeaway is this: the evidence exists, the frameworks are validated, and now it's about implementation and willpower.\n\n[Sam]: Beautifully put. Thanks everyone for joining this Deep Dive with NoteAI!\n\n[Alex]: See you next time!\n\n---\n*Add GEMINI_API_KEY to .env for AI-generated content from your actual sources.*`,
    };
    content = fallbacks[type] || '## Content\n\nAdd GEMINI_API_KEY to .env for AI-generated content.';
  }

  res.json({ content });
});

// ==================== STATIC ====================
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== START ====================
app.listen(PORT, () => {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║         🚀 NoteAI Server Started!        ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`\n  📓 App:    http://localhost:${PORT}`);
  console.log(`  🤖 AI:     ${geminiReady ? 'Gemini 1.5 Flash ✅' : 'Demo mode ⚠️  (set GEMINI_API_KEY in .env)'}`);
  console.log(`  🗄️  DB:     noteai-data.json`);
  console.log(`  📁 Files:  ./uploads/\n`);
});
