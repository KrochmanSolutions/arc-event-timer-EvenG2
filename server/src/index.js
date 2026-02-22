import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import Groq from 'groq-sdk';
import { ARCS, ITEMS, QUESTS, TRADERS, ALL_MAPS, MAP_ABBREV, buildKnowledgePrompt } from './game-knowledge.js';

const GROQ_API_KEY = process.env.GROQ_API_KEY;
if (!GROQ_API_KEY) {
  console.warn('[Groq] Warning: GROQ_API_KEY not set. Voice transcription will fail.');
}
const groq = new Groq({ apiKey: GROQ_API_KEY });
const KNOWLEDGE_PROMPT = buildKnowledgePrompt();

const METAFORGE_API = 'https://metaforge.app/api/arc-raiders';
const METAFORGE_CDN = 'https://cdn.metaforge.app/arc-raiders';

// Supabase for map marker data
const SUPABASE_URL = 'https://sb.metaforge.app/rest/v1';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVuaGJ2a3N6d2hjemJqeGdldGdrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDQ5NjgwMjUsImV4cCI6MjA2MDU0NDAyNX0.gckCmxnlpwwJOGmc5ebLYDnaWaxr5PW31eCrSPR5aRQ';

// G2 glasses display constraints
const G2_WIDTH = 640;
const G2_HEIGHT = 400;

// Map configuration - dimensions from MetaForge
const MAPS = {
  'spaceport': { name: 'The Spaceport', slug: 'spaceport' },
  'dam': { name: 'The Dam', slug: 'dam' },
  'buried-city': { name: 'Buried City', slug: 'buried-city' },
  'blue-gate': { name: 'Blue Gate', slug: 'blue-gate' },
  'stella-montis': { name: 'Stella Montis', slug: 'stella-montis' },
};

// Cache with TTL for API responses (5 minute cache)
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

// Get map markers from cached data (no API calls)
function fetchMapMarkers(map, subcategory = null, category = null) {
  const mapData = ALL_MAPS[map];
  if (!mapData) {
    console.log(`[MapMarkers] Unknown map: ${map}`);
    return [];
  }
  
  let results = mapData;
  
  // Filter by category if provided
  if (category) {
    results = results.filter(m => m.category?.toLowerCase() === category.toLowerCase());
  }
  
  // Filter by subcategory if provided
  if (subcategory) {
    const sub = subcategory.toLowerCase().trim();
    results = results.filter(m => m.subcategory?.toLowerCase().includes(sub));
  }
  
  console.log(`[MapMarkers] Found ${results.length} markers for ${subcategory || 'all'} on ${map}`);
  return results;
}

// Glasses display state - stores latest message to show
let glassesDisplay = {
  id: 0,
  lines: ['Waiting for OpenClaw...', '', 'Send a message to get started'],
  timestamp: Date.now(),
};

// Strip emojis from text (glasses can't display them)
function stripEmojis(text) {
  return text.replace(/[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F900}-\u{1F9FF}]|[\u{1FA00}-\u{1FA6F}]|[\u{1FA70}-\u{1FAFF}]|[\u{231A}-\u{231B}]|[\u{23E9}-\u{23F3}]|[\u{23F8}-\u{23FA}]|[\u{25AA}-\u{25AB}]|[\u{25B6}]|[\u{25C0}]|[\u{25FB}-\u{25FE}]|[\u{2614}-\u{2615}]|[\u{2648}-\u{2653}]|[\u{267F}]|[\u{2693}]|[\u{26A1}]|[\u{26AA}-\u{26AB}]|[\u{26BD}-\u{26BE}]|[\u{26C4}-\u{26C5}]|[\u{26CE}]|[\u{26D4}]|[\u{26EA}]|[\u{26F2}-\u{26F3}]|[\u{26F5}]|[\u{26FA}]|[\u{26FD}]|[\u{2702}]|[\u{2705}]|[\u{2708}-\u{270D}]|[\u{270F}]|[\u{2712}]|[\u{2714}]|[\u{2716}]|[\u{271D}]|[\u{2721}]|[\u{2728}]|[\u{2733}-\u{2734}]|[\u{2744}]|[\u{2747}]|[\u{274C}]|[\u{274E}]|[\u{2753}-\u{2755}]|[\u{2757}]|[\u{2763}-\u{2764}]|[\u{2795}-\u{2797}]|[\u{27A1}]|[\u{27B0}]|[\u{27BF}]|[\u{2934}-\u{2935}]|[\u{2B05}-\u{2B07}]|[\u{2B1B}-\u{2B1C}]|[\u{2B50}]|[\u{2B55}]|[\u{3030}]|[\u{303D}]|[\u{3297}]|[\u{3299}]/gu, '').trim();
}

// G2 display constraints: 640x400px => ~38 chars/line, ~6 lines max
const MAX_LINE_LENGTH = 38;
const MAX_LINES = 6;

function updateGlassesDisplay(lines) {
  // Strip emojis from all lines
  let cleanLines = (Array.isArray(lines) ? lines : [lines]).map(line => stripEmojis(line));
  
  // Truncate each line to max length
  cleanLines = cleanLines.map(line => {
    if (line.length > MAX_LINE_LENGTH) {
      return line.substring(0, MAX_LINE_LENGTH - 2) + '..';
    }
    return line;
  });
  
  // Limit number of lines
  if (cleanLines.length > MAX_LINES) {
    cleanLines = cleanLines.slice(0, MAX_LINES - 1);
    cleanLines.push(`...more`);
  }
  
  glassesDisplay = {
    id: glassesDisplay.id + 1,
    lines: cleanLines,
    timestamp: Date.now(),
  };
  console.log(`[Glasses] Display updated (id=${glassesDisplay.id}):`, glassesDisplay.lines.slice(0, 2).join(' | '));
}

function getCached(key) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.time < CACHE_TTL) {
    return entry.data;
  }
  cache.delete(key);
  return null;
}

function setCache(key, data) {
  cache.set(key, { data, time: Date.now() });
}

// Fetch from MetaForge API with caching
async function fetchMetaForge(endpoint, params = {}) {
  const url = new URL(`${METAFORGE_API}${endpoint}`);
  for (const [key, val] of Object.entries(params)) {
    url.searchParams.set(key, String(val));
  }
  
  const cacheKey = url.toString();
  const cached = getCached(cacheKey);
  if (cached) return cached;
  
  console.log(`[MetaForge] Fetching: ${url}`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`MetaForge API error: ${res.status}`);
  }
  
  const data = await res.json();
  setCache(cacheKey, data);
  return data;
}

// Fetch all pages of a paginated endpoint
async function fetchAllPages(endpoint, params = {}) {
  const items = [];
  let page = 1;
  let hasMore = true;
  
  while (hasMore) {
    const data = await fetchMetaForge(endpoint, { ...params, page, limit: 100 });
    items.push(...(data.data || []));
    hasMore = data.pagination?.hasNextPage ?? false;
    page++;
  }
  
  return items;
}

// Search across cached items, quests, ARCs, and traders (no API calls)
function search(query, options = {}) {
  const q = query.toLowerCase().trim();
  const results = [];
  
  // Search items (cached)
  for (const item of ITEMS) {
    if (item.name?.toLowerCase().includes(q) || 
        item.item_type?.toLowerCase().includes(q) ||
        item.description?.toLowerCase().includes(q)) {
      results.push({
        type: 'item',
        id: item.id,
        name: item.name,
        description: item.description,
        rarity: item.rarity,
        itemType: item.item_type,
        icon: item.icon,
        locations: item.locations || [],
      });
    }
  }
  
  // Search quests (cached)
  for (const quest of QUESTS) {
    if (quest.name?.toLowerCase().includes(q) ||
        quest.trader_name?.toLowerCase().includes(q) ||
        quest.objectives?.some(obj => obj?.toLowerCase().includes(q))) {
      results.push({
        type: 'quest',
        id: quest.id,
        name: quest.name,
        trader: quest.trader_name,
        objectives: quest.objectives,
        position: quest.position,
        locations: quest.locations || [],
        rewards: quest.rewards?.map(r => ({
          name: r.item?.name,
          quantity: r.quantity,
          icon: r.item?.icon,
        })).filter(r => r.name),
        image: quest.image,
        guideLinks: quest.guide_links,
      });
    }
  }
  
  // Search ARCs (cached)
  for (const arc of ARCS) {
    if (arc.name?.toLowerCase().includes(q) ||
        arc.description?.toLowerCase().includes(q)) {
      results.push({
        type: 'arc',
        id: arc.id,
        name: arc.name,
        description: arc.description,
        icon: arc.icon,
        image: arc.image,
        loot: arc.loot,
      });
    }
  }
  
  // Search traders (cached)
  for (const [traderName, items] of Object.entries(TRADERS)) {
    if (traderName.toLowerCase().includes(q)) {
      results.push({
        type: 'trader',
        id: traderName.toLowerCase(),
        name: traderName,
        description: `Sells ${items.length} items`,
        items: items.slice(0, 5).map(i => i.name),
      });
    }
  }
  
  // Sort: exact matches first, then by type priority
  results.sort((a, b) => {
    const aExact = a.name?.toLowerCase() === q ? 0 : 1;
    const bExact = b.name?.toLowerCase() === q ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    
    const typePriority = { arc: 0, item: 1, quest: 2, trader: 3 };
    return (typePriority[a.type] || 99) - (typePriority[b.type] || 99);
  });
  
  return results.slice(0, options.limit || 10);
}

// Get quest details from cached data
function getQuest(id) {
  return QUESTS.find(q => q.id === id || q.name?.toLowerCase() === id?.toLowerCase());
}

// Get item details from cached data
function getItem(id) {
  return ITEMS.find(i => i.id === id || i.name?.toLowerCase() === id?.toLowerCase());
}

// Get ARC details from cached data
function getArc(id) {
  return ARCS.find(a => a.id === id || a.name?.toLowerCase() === id?.toLowerCase());
}

// Get trader inventory
async function getTraders() {
  const data = await fetchMetaForge('/traders');
  return data.data;
}

// Get events schedule
async function getEvents() {
  const data = await fetchMetaForge('/events-schedule');
  return data.data;
}

// Format events for glasses display
function formatEventsForGlasses(events, query = '') {
  if (!events?.length) {
    return ['No events found'];
  }
  
  const mapAbbrev = { 'Spaceport': 'SP', 'Dam': 'Dam', 'Buried City': 'BC', 'Blue Gate': 'BG', 'Stella Montis': 'SM' };
  const now = Date.now();
  const lines = [];
  
  // Filter by query if provided
  const q = query.toLowerCase();
  let filtered = events;
  if (q && !q.includes('event') && !q.includes('timer') && !q.includes('schedule')) {
    filtered = events.filter(e => e.name?.toLowerCase().includes(q) || e.type?.toLowerCase().includes(q));
  }
  
  if (filtered.length === 0) {
    return ['No matching events', `Query: ${query.substring(0, 30)}`];
  }
  
  lines.push(`${filtered.length} Events:`);
  
  filtered.slice(0, 5).forEach(e => {
    const map = mapAbbrev[e.map] || e.map?.substring(0, 3) || '?';
    const startTime = new Date(e.startTime);
    const diffMs = startTime - now;
    
    let timeStr;
    if (diffMs <= 0) {
      timeStr = 'NOW';
    } else if (diffMs < 60000) {
      timeStr = `${Math.round(diffMs / 1000)}s`;
    } else if (diffMs < 3600000) {
      timeStr = `${Math.round(diffMs / 60000)}m`;
    } else {
      const hours = Math.floor(diffMs / 3600000);
      const mins = Math.round((diffMs % 3600000) / 60000);
      timeStr = `${hours}h${mins}m`;
    }
    
    const name = e.name?.substring(0, 14) || 'Event';
    lines.push(`${name}@${map} ${timeStr}`);
  });
  
  return lines;
}

// Format response for glasses (text-based, optimized for small display)
function formatForGlasses(result) {
  if (!result) return { text: 'Not found', lines: ['Not found'] };
  
  const lines = [];
  const MAX_NAME = 32;
  const MAX_DESC = 35;
  
  switch (result.type) {
    case 'quest':
      lines.push(result.name.substring(0, MAX_NAME));
      if (result.trader) lines.push(`From: ${result.trader}`);
      if (result.objectives?.length) {
        result.objectives.slice(0, 2).forEach((obj, i) => {
          lines.push(`${i + 1}. ${obj.substring(0, MAX_DESC)}`);
        });
      }
      if (result.position) {
        lines.push(`Pos: ${Math.round(result.position.x)},${Math.round(result.position.y)}`);
      }
      break;
      
    case 'item':
      lines.push(result.name.substring(0, MAX_NAME));
      if (result.rarity) lines.push(`${result.rarity}`);
      if (result.itemType) lines.push(`Type: ${result.itemType}`);
      if (result.description) {
        lines.push(result.description.substring(0, MAX_DESC * 2));
      }
      break;
      
    case 'arc':
      lines.push(result.name.substring(0, MAX_NAME));
      if (result.description) {
        // Split description into readable chunks
        const desc = result.description.substring(0, 100);
        const words = desc.split(' ');
        let line = '';
        for (const word of words) {
          if ((line + ' ' + word).length > MAX_DESC) {
            lines.push(line.trim());
            line = word;
          } else {
            line += ' ' + word;
          }
        }
        if (line.trim()) lines.push(line.trim());
      }
      if (result.loot?.length) {
        lines.push('---');
        lines.push('Drops:');
        result.loot.slice(0, 4).forEach(l => {
          const itemName = l.item?.name || l.item_id;
          lines.push(`• ${itemName}`);
        });
      }
      break;
      
    default:
      lines.push(result.name || 'Unknown');
  }
  
  return {
    text: lines.join('\n'),
    lines,
    result,
  };
}

// Format map markers for glasses display
function formatMapMarkersForGlasses(markers, query, map) {
  const mapNames = {
    'spaceport': 'SP',
    'dam': 'Dam',
    'buried-city': 'BC',
    'blue-gate': 'BG',
    'stella-montis': 'SM',
  };
  
  if (!markers?.length) {
    return {
      text: `No ${query} on ${mapNames[map] || map}`,
      lines: [`No ${query} on ${mapNames[map] || map}`],
      markers: [],
    };
  }
  
  const lines = [];
  const shortQuery = query.substring(0, 20).toUpperCase();
  lines.push(`${shortQuery} @ ${mapNames[map] || map}`);
  lines.push(`${markers.length} found:`);
  
  // Show up to 4 locations
  markers.slice(0, 4).forEach((m, i) => {
    const x = Math.round(m.lng);
    const y = Math.round(m.lat);
    lines.push(`${i + 1}. X:${x} Y:${y}`);
  });
  
  if (markers.length > 4) {
    lines.push(`+${markers.length - 4} more`);
  }
  
  return {
    text: lines.join('\n'),
    lines,
    markers,
  };
}

// Format multiple results for glasses
function formatListForGlasses(results, query) {
  if (!results?.length) {
    return {
      text: `No results: ${query}`,
      lines: [`No results: ${query.substring(0, 25)}`],
      results: [],
    };
  }
  
  const lines = [`${results.length} results:`];
  
  // Limit to 4 results to fit display
  results.slice(0, 4).forEach((r, i) => {
    const name = r.name.substring(0, 30);
    lines.push(`${i + 1}. ${name}`);
  });
  
  if (results.length > 4) {
    lines.push(`+${results.length - 4} more`);
  }
  
  return {
    text: lines.join('\n'),
    lines,
    results,
  };
}

// --- Hono App ---
const app = new Hono();
app.use('/*', cors({ origin: '*' }));

// Health check
app.get('/api/health', (c) => c.json({ 
  status: 'ok',
  version: '2.0.0',
  mode: 'dynamic',
  source: 'metaforge.app',
}));

// List available maps
app.get('/api/maps', (c) => {
  return c.json({
    maps: Object.entries(MAPS).map(([id, meta]) => ({
      id,
      name: meta.name,
      slug: meta.slug,
    })),
  });
});

// Search endpoint - main entry point for OpenClaw
app.get('/api/search', async (c) => {
  const query = c.req.query('q');
  const limit = parseInt(c.req.query('limit') || '10', 10);
  const format = c.req.query('format') || 'json';
  
  if (!query) {
    return c.json({ error: 'Missing query parameter: q' }, 400);
  }
  
  try {
    const results = await search(query, { limit });
    
    if (format === 'glasses') {
      return c.json(formatListForGlasses(results, query));
    }
    
    return c.json({ query, results, count: results.length });
  } catch (err) {
    console.error('Search error:', err);
    return c.json({ error: err.message }, 500);
  }
});

// Get single result formatted for glasses
app.get('/api/lookup', async (c) => {
  const query = c.req.query('q');
  
  if (!query) {
    return c.json({ error: 'Missing query parameter: q' }, 400);
  }
  
  try {
    const results = await search(query, { limit: 1 });
    const result = results[0];
    
    return c.json(formatForGlasses(result));
  } catch (err) {
    console.error('Lookup error:', err);
    return c.json({ error: err.message }, 500);
  }
});

// Get quest details
app.get('/api/quests/:id', async (c) => {
  const id = c.req.param('id');
  
  try {
    const quest = await getQuest(id);
    if (!quest) {
      return c.json({ error: 'Quest not found' }, 404);
    }
    return c.json(quest);
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

// Get item details
app.get('/api/items/:id', async (c) => {
  const id = c.req.param('id');
  
  try {
    const item = await getItem(id);
    if (!item) {
      return c.json({ error: 'Item not found' }, 404);
    }
    return c.json(item);
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

// Get all traders
app.get('/api/traders', async (c) => {
  try {
    const traders = await getTraders();
    return c.json({ traders });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

// Get events schedule
app.get('/api/events', async (c) => {
  try {
    const events = await getEvents();
    return c.json({ events });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

// Glasses display endpoints
app.get('/api/glasses/latest', (c) => {
  const after = parseInt(c.req.query('after') || '0', 10);
  
  if (glassesDisplay.id > after) {
    return c.json(glassesDisplay);
  }
  
  return c.json({ id: glassesDisplay.id, lines: null });
});

app.post('/api/glasses/display', async (c) => {
  const body = await c.req.json();
  const lines = body.lines || body.text?.split('\n') || ['No content'];
  
  updateGlassesDisplay(lines);
  
  return c.json({ success: true, id: glassesDisplay.id });
});

// Voice query endpoint - receives PCM audio, transcribes with Groq Whisper API, and queries
// Now with SSE streaming for real-time updates

// Convert PCM to WAV buffer for Groq API
function pcmToWav(pcmData, sampleRate = 16000) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcmData.length;
  const headerSize = 44;
  const buffer = Buffer.alloc(headerSize + dataSize);
  
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  Buffer.from(pcmData).copy(buffer, 44);
  
  return buffer;
}

// Transcribe audio using Groq Whisper API
async function transcribeWithGroq(pcmData) {
  console.log('[Groq] Transcribing audio...');
  const wavBuffer = pcmToWav(pcmData);
  
  const file = new File([wavBuffer], 'audio.wav', { type: 'audio/wav' });
  
  const transcription = await groq.audio.transcriptions.create({
    file: file,
    model: 'whisper-large-v3',
    language: 'en',
    response_format: 'text',
  });
  
  console.log('[Groq] Transcription:', transcription);
  return transcription.trim();
}

// Check if query needs live event data
function needsLiveEventData(query) {
  const eventKeywords = ['when', 'next', 'timer', 'schedule', 'event', 'upcoming'];
  const q = query.toLowerCase();
  return eventKeywords.some(kw => q.includes(kw));
}

// Stream LLM response using Groq with full game knowledge - answers directly in display lines
async function* streamKnowledgeAnswer(transcript) {
  console.log(`[Groq LLM] Answering: "${transcript}"`);
  
  try {
    const stream = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: KNOWLEDGE_PROMPT },
        { role: 'user', content: transcript }
      ],
      temperature: 0.2,
      max_tokens: 200,
      stream: true,
    });
    
    let fullResponse = '';
    
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        fullResponse += content;
        yield { type: 'thinking', text: fullResponse.substring(0, 35) + '...' };
      }
    }
    
    console.log(`[Groq LLM] Raw response: "${fullResponse}"`);
    
    // Check if LLM needs live event data
    if (fullResponse.includes('LIVE DATA NEEDED')) {
      yield { type: 'needs_events', query: transcript };
      return;
    }
    
    // Parse response lines (separated by | or newlines)
    let displayLines = fullResponse
      .split(/[|\n]/)
      .map(l => l.trim())
      .filter(l => l && l.length > 0)
      .slice(0, 6)
      .map(l => l.substring(0, 38));
    
    if (displayLines.length === 0) {
      displayLines = ['No info found', transcript.substring(0, 30)];
    }
    
    yield { type: 'answer', lines: displayLines };
    
  } catch (err) {
    console.error('[Groq LLM] Error:', err);
    yield { type: 'answer', lines: ['Error', 'Try again'] };
  }
}

// Streaming voice query endpoint with SSE
app.post('/api/voice/stream', async (c) => {
  const pcmData = await c.req.arrayBuffer();
  console.log(`[Voice] Received ${pcmData.byteLength} bytes of PCM audio`);
  
  if (pcmData.byteLength < 100) {
    return c.json({ error: 'Audio too short' }, 400);
  }
  
  // Create SSE stream
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data) => {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`));
        // Also update glasses display
        if (data.lines) {
          updateGlassesDisplay(data.lines);
        }
      };
      
      try {
        send({ type: 'status', lines: ['Transcribing...', '', 'Listening...'] });
        
        // Transcribe with Groq Whisper
        const transcript = await transcribeWithGroq(new Uint8Array(pcmData));
        
        if (!transcript) {
          send({ type: 'error', lines: ['Could not understand', '', 'Try again'] });
          controller.close();
          return;
        }
        
        console.log(`[Voice] Transcript: "${transcript}"`);
        const shortTranscript = transcript.substring(0, 35);
        send({ type: 'transcript', transcript, lines: ['Heard:', `"${shortTranscript}"`, '', 'Thinking...'] });
        
        // Use knowledge-based LLM to answer directly
        let finalLines = null;
        for await (const update of streamKnowledgeAnswer(transcript)) {
          if (update.type === 'thinking') {
            send({ type: 'thinking', lines: ['Thinking...', update.text] });
          } else if (update.type === 'needs_events') {
            // LLM needs live event data - fetch from API
            send({ type: 'fetching', lines: ['Getting live events...'] });
            const events = await getEvents();
            const eventLines = formatEventsForGlasses(events, update.query);
            finalLines = eventLines;
          } else if (update.type === 'answer') {
            finalLines = update.lines;
          }
        }
        
        if (!finalLines) {
          finalLines = ['No response', 'Try again'];
        }
        
        send({ type: 'result', lines: finalLines });
        console.log(`[Voice] Complete:`, finalLines[0]);
        
      } catch (err) {
        console.error('[Voice] Stream error:', err);
        send({ type: 'error', lines: ['Error: ' + err.message.substring(0, 30)] });
      }
      
      controller.close();
    }
  });
  
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    }
  });
});

// Execute intent and return response (extracted for reuse)
function executeIntent(intent, transcript) {
  const now = Date.now();
  const formatEventTime = (timestamp) => {
    const diff = timestamp - now;
    if (diff <= 0) return 'Active now';
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 0) return `in ${hours}h ${mins}m`;
    return `in ${mins}m`;
  };
  
  switch (intent.action) {
    case 'events':
      return { needsEvents: true, query: intent.query };
      
    case 'lookup':
      const lookupResults = search(intent.query || transcript, { limit: 1 });
      return formatForGlasses(lookupResults[0]);
      
    case 'item':
      // Try exact match first, then partial
      let item = getItem(intent.query);
      if (item) {
        return formatForGlasses({ ...item, type: 'item' });
      }
      const itemResults = ITEMS.filter(i => 
        i.name?.toLowerCase().includes(intent.query?.toLowerCase())
      ).slice(0, 4);
      if (itemResults.length > 0) {
        return formatListForGlasses(itemResults.map(i => ({ ...i, type: 'item' })), intent.query);
      }
      return formatForGlasses(null);
      
    case 'quest':
      // Try exact match first, then partial
      let quest = getQuest(intent.query);
      if (quest) {
        return formatForGlasses({ ...quest, type: 'quest' });
      }
      const questResults = QUESTS.filter(q => 
        q.name?.toLowerCase().includes(intent.query?.toLowerCase()) ||
        q.trader_name?.toLowerCase().includes(intent.query?.toLowerCase())
      ).slice(0, 4);
      if (questResults.length > 0) {
        return formatListForGlasses(questResults.map(q => ({ ...q, type: 'quest' })), intent.query);
      }
      return formatForGlasses(null);
      
    case 'traders':
      const traderName = intent.query?.toLowerCase();
      if (traderName && TRADERS) {
        const traderKey = Object.keys(TRADERS).find(k => 
          k.toLowerCase().includes(traderName.replace(/\s+/g, ''))
        );
        if (traderKey && TRADERS[traderKey]) {
          const items = TRADERS[traderKey].slice(0, 4);
          return { text: traderKey, lines: [`${traderKey}:`, ...items.map(i => i.name.substring(0, 30))] };
        }
      }
      const names = TRADERS ? Object.keys(TRADERS).slice(0, 5) : [];
      return { text: 'Traders', lines: ['Traders:', ...names] };
      
    case 'map_location':
      const markers = fetchMapMarkers(intent.map, intent.query, null);
      return formatMapMarkersForGlasses(markers, intent.query, intent.map);
      
    case 'arc_loot':
      // Try exact match first, then partial
      let arc = ARCS.find(a => a.name?.toLowerCase() === intent.query?.toLowerCase());
      if (!arc) {
        arc = ARCS.find(a => a.name?.toLowerCase().includes(intent.query?.toLowerCase()));
      }
      if (arc && arc.loot) {
        const lootLines = arc.loot.slice(0, 4).map(l => (l.item?.name || l.name || 'Unknown').substring(0, 30));
        return { text: arc.name, lines: [`${arc.name} drops:`, ...lootLines] };
      }
      return { text: 'No loot', lines: [`No loot: ${intent.query}`] };
      
    case 'arc':
      // Search for ARC info
      let arcInfo = ARCS.find(a => a.name?.toLowerCase() === intent.query?.toLowerCase());
      if (!arcInfo) {
        arcInfo = ARCS.find(a => a.name?.toLowerCase().includes(intent.query?.toLowerCase()));
      }
      if (arcInfo) {
        const desc = arcInfo.description?.substring(0, 80) || 'No description';
        return { 
          text: arcInfo.name, 
          lines: [arcInfo.name, desc.substring(0, 38), desc.substring(38, 76) || ''].filter(Boolean)
        };
      }
      return { text: 'Not found', lines: [`ARC not found: ${intent.query}`] };
      
    case 'search':
    default:
      const results = search(intent.query || transcript, { limit: 4 });
      return formatListForGlasses(results, intent.query || transcript);
  }
}

// Legacy non-streaming endpoint (kept for compatibility)
app.post('/api/voice/query', async (c) => {
  try {
    const pcmData = await c.req.arrayBuffer();
    console.log(`[Voice] Received ${pcmData.byteLength} bytes of PCM audio`);
    
    if (pcmData.byteLength < 100) {
      return c.json({ error: 'Audio too short' }, 400);
    }
    
    updateGlassesDisplay(['Transcribing...']);
    
    // Transcribe with Groq Whisper
    const transcript = await transcribeWithGroq(new Uint8Array(pcmData));
    
    if (!transcript) {
      updateGlassesDisplay(['Could not understand']);
      return c.json({ error: 'No transcript' }, 500);
    }
    
    console.log(`[Voice] Transcript: "${transcript}"`);
    updateGlassesDisplay(['Heard:', `"${transcript.substring(0, 35)}"`]);
    
    // Use Groq LLM to get answer
    let finalLines = null;
    for await (const update of streamKnowledgeAnswer(transcript)) {
      if (update.type === 'thinking') {
        updateGlassesDisplay(['Thinking...', update.text]);
      } else if (update.type === 'needs_events') {
        const events = await getEvents();
        finalLines = formatEventsForGlasses(events, update.query);
      } else if (update.type === 'answer') {
        finalLines = update.lines;
      }
    }
    
    if (!finalLines) finalLines = ['No response', 'Try again'];
    
    updateGlassesDisplay(finalLines);
    
    return c.json({
      success: true,
      transcript,
      response: finalLines.join('\n'),
    });
    
  } catch (err) {
    console.error('[Voice] Error:', err);
    updateGlassesDisplay(['Voice query failed', '', 'Try again']);
    return c.json({ error: err.message }, 500);
  }
});

// OpenClaw integration - call OpenClaw agent and get response
async function callOpenClaw(message) {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);
  
  try {
    // Call OpenClaw agent with the message
    const { stdout, stderr } = await execAsync(
      `openclaw agent --local --message "${message.replace(/"/g, '\\"')}" --json`,
      { timeout: 60000 }
    );
    
    const result = JSON.parse(stdout);
    return {
      success: true,
      response: result.response || result.message || result,
      raw: result,
    };
  } catch (err) {
    console.error('[OpenClaw] CLI error:', err.message);
    return {
      success: false,
      error: err.message,
    };
  }
}

// Direct endpoint - handles ARC Raiders queries locally (fast path)
app.post('/api/query', async (c) => {
  const body = await c.req.json();
  const message = body.message || body.text || body.content;
  
  if (!message) {
    return c.json({ error: 'No message provided' }, 400);
  }
  
  console.log(`[Query] Received: "${message}"`);
  
  try {
    const intent = await getIntentFromLLM(message);
    let response;
    
    switch (intent.action) {
      case 'search':
        const results = search(intent.query, { limit: 5 });
        response = formatListForGlasses(results, intent.query);
        break;
        
      case 'lookup':
        const lookupResults = search(intent.query, { limit: 1 });
        response = formatForGlasses(lookupResults[0]);
        break;
        
      case 'quest':
        // Try exact match first, then search for partial matches
        const quest = getQuest(intent.query);
        if (quest) {
          response = formatForGlasses({ ...quest, type: 'quest' });
        } else {
          const questResults = QUESTS.filter(q => 
            q.name?.toLowerCase().includes(intent.query?.toLowerCase()) ||
            q.trader_name?.toLowerCase().includes(intent.query?.toLowerCase())
          ).slice(0, 5);
          response = formatListForGlasses(questResults.map(q => ({ ...q, type: 'quest' })), intent.query);
        }
        break;
        
      case 'item':
        // Try exact match first, then search for partial matches
        const item = getItem(intent.query);
        if (item) {
          response = formatForGlasses({ ...item, type: 'item' });
        } else {
          const itemResults = ITEMS.filter(i => 
            i.name?.toLowerCase().includes(intent.query?.toLowerCase()) ||
            i.item_type?.toLowerCase().includes(intent.query?.toLowerCase())
          ).slice(0, 5);
          response = formatListForGlasses(itemResults.map(i => ({ ...i, type: 'item' })), intent.query);
        }
        break;
        
      case 'events':
        const events = await getEvents();
        response = {
          text: events.slice(0, 3).map(e => `${e.name}: ${e.status || 'Active'}`).join('\n'),
          lines: events.slice(0, 3).map(e => `${e.name}: ${e.status || 'Active'}`),
          events,
        };
        break;
        
      case 'map_location':
        const markers = fetchMapMarkers(intent.map, intent.query, null);
        response = formatMapMarkersForGlasses(markers, intent.query, intent.map);
        break;
        
      case 'arc_loot':
        // Try exact match first, then partial
        let arc = ARCS.find(a => a.name?.toLowerCase() === intent.query?.toLowerCase());
        if (!arc) {
          arc = ARCS.find(a => a.name?.toLowerCase().includes(intent.query?.toLowerCase()));
        }
        if (arc && arc.loot) {
          const lootLines = arc.loot.slice(0, 4).map(l => (l.item?.name || l.name || 'Unknown').substring(0, 30));
          response = { text: arc.name, lines: [`${arc.name} drops:`, ...lootLines] };
        } else {
          response = { text: 'No loot', lines: [`No loot: ${intent.query}`] };
        }
        break;
        
      case 'traders':
        const traderName = intent.query?.toLowerCase();
        if (traderName && TRADERS) {
          const traderKey = Object.keys(TRADERS).find(k => 
            k.toLowerCase().includes(traderName.replace(/\s+/g, ''))
          );
          if (traderKey && TRADERS[traderKey]) {
            const items = TRADERS[traderKey].slice(0, 4);
            response = { text: traderKey, lines: [`${traderKey}:`, ...items.map(i => i.name.substring(0, 30))] };
            break;
          }
        }
        const names = TRADERS ? Object.keys(TRADERS).slice(0, 5) : [];
        response = { text: 'Traders', lines: ['Traders:', ...names] };
        break;
        
      case 'arc':
        // Search for ARC info
        let arcInfo = ARCS.find(a => a.name?.toLowerCase() === intent.query?.toLowerCase());
        if (!arcInfo) {
          arcInfo = ARCS.find(a => a.name?.toLowerCase().includes(intent.query?.toLowerCase()));
        }
        if (arcInfo) {
          const desc = arcInfo.description?.substring(0, 80) || 'No description';
          response = { 
            text: arcInfo.name, 
            lines: [arcInfo.name, desc.substring(0, 38), desc.substring(38, 76) || ''].filter(Boolean)
          };
        } else {
          response = { text: 'Not found', lines: [`ARC not found: ${intent.query}`] };
        }
        break;
        
      default:
        const defaultResults = search(message, { limit: 5 });
        response = formatListForGlasses(defaultResults, message);
    }
    
    console.log(`[Query] Response: ${response.text.substring(0, 100)}...`);
    
    return c.json({
      success: true,
      intent,
      response,
    });
  } catch (err) {
    console.error('[Query] Error:', err);
    return c.json({
      success: false,
      error: err.message,
      response: { text: `Error: ${err.message}`, lines: [`Error: ${err.message}`] },
    });
  }
});

// OpenClaw AI endpoint - uses OpenClaw for more complex reasoning
app.post('/api/openclaw/message', async (c) => {
  const body = await c.req.json();
  const message = body.message || body.text || body.content;
  
  if (!message) {
    return c.json({ error: 'No message provided' }, 400);
  }
  
  console.log(`[OpenClaw] Received: "${message}"`);
  
  try {
    // Use LLM to parse intent
    const intent = await getIntentFromLLM(message);
    
    // Handle ARC Raiders queries
    if (['search', 'lookup', 'quest', 'item', 'events', 'map_location'].includes(intent.action)) {
      let response;
      
      switch (intent.action) {
        case 'search':
          const results = await search(intent.query, { limit: 5 });
          response = formatListForGlasses(results, intent.query);
          break;
          
        case 'lookup':
          const lookupResults = await search(intent.query, { limit: 1 });
          response = formatForGlasses(lookupResults[0]);
          break;
          
        case 'quest':
          const quest = await getQuest(intent.query);
          response = formatForGlasses(quest ? { ...quest, type: 'quest' } : null);
          break;
          
        case 'item':
          const item = await getItem(intent.query);
          response = formatForGlasses(item ? { ...item, type: 'item' } : null);
          break;
          
        case 'events':
          const allEvents = await getEvents();
          let filteredEvents = allEvents;
          
          // Filter by specific event type if query is provided
          if (intent.query) {
            filteredEvents = allEvents.filter(e => 
              e.name.toLowerCase().includes(intent.query.toLowerCase())
            );
          }
          
          // Format event times
          const now = Date.now();
          const formatEventTime = (timestamp) => {
            const diff = timestamp - now;
            if (diff <= 0) return 'Active now';
            const hours = Math.floor(diff / (1000 * 60 * 60));
            const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            if (hours > 0) return `in ${hours}h ${mins}m`;
            return `in ${mins}m`;
          };
          
          const eventLines = filteredEvents.slice(0, 5).map(e => {
            const timeStr = formatEventTime(e.startTime);
            return `${e.name} @ ${e.map}: ${timeStr}`;
          });
          
          const eventTitle = intent.query 
            ? `🎯 ${intent.query.toUpperCase()} Events`
            : '🎮 Upcoming Events';
          
          response = {
            text: [eventTitle, ...eventLines].join('\n'),
            lines: [eventTitle, ...eventLines],
            events: filteredEvents,
          };
          break;
          
        case 'map_location':
          const markers = await fetchMapMarkers(intent.map, intent.query, null);
          response = formatMapMarkersForGlasses(markers, intent.query, intent.map);
          break;
      }
      
      console.log(`[OpenClaw] Fast path response: ${response.text.substring(0, 100)}...`);
      
      // Push to glasses display
      updateGlassesDisplay(response.lines || response.text.split('\n'));
      
      return c.json({
        success: true,
        intent,
        response,
        source: 'local',
      });
    }
    
    // For complex queries, call OpenClaw agent
    const openclawResult = await callOpenClaw(message);
    
    if (openclawResult.success) {
      const lines = openclawResult.response.split('\n');
      
      // Push to glasses display
      updateGlassesDisplay(lines);
      
      return c.json({
        success: true,
        intent,
        response: {
          text: openclawResult.response,
          lines,
        },
        source: 'openclaw',
      });
    }
    
    // Fallback to search
    const fallbackResults = await search(message, { limit: 5 });
    const fallbackResponse = formatListForGlasses(fallbackResults, message);
    
    // Push to glasses display
    updateGlassesDisplay(fallbackResponse.lines || fallbackResponse.text.split('\n'));
    
    return c.json({
      success: true,
      intent,
      response: fallbackResponse,
      source: 'fallback',
    });
  } catch (err) {
    console.error('[OpenClaw] Error:', err);
    
    // Show error on glasses
    updateGlassesDisplay([`Error: ${err.message}`, '', 'Try again']);
    
    return c.json({
      success: false,
      error: err.message,
      response: { text: `Error: ${err.message}`, lines: [`Error: ${err.message}`] },
    });
  }
});

// Get intent from LLM using Groq (non-streaming version for endpoints that need it)
async function getIntentFromLLM(message) {
  console.log(`[Intent] Groq parsing: "${message}"`);
  
  try {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { 
          role: 'system', 
          content: `Parse user queries about ARC Raiders game. Return JSON with:
- action: "events", "search", "lookup", "quest", "item", "traders", "map_location", "arc_loot"
- query: the search term (item/ARC/quest name)
- map: map slug if mentioned (spaceport, dam, buried-city, blue-gate, stella-montis)

Examples:
"when is night raid" -> {"action":"events","query":"night raid"}
"bastion locations on blue gate" -> {"action":"map_location","query":"bastion","map":"blue-gate"}
"what does bombardier drop" -> {"action":"arc_loot","query":"bombardier"}
"find anvil" -> {"action":"search","query":"anvil"}

Return ONLY valid JSON, no explanation.`
        },
        { role: 'user', content: message }
      ],
      temperature: 0.1,
      max_tokens: 100,
    });
    
    const responseText = completion.choices[0]?.message?.content || '';
    console.log(`[Intent] Raw: ${responseText}`);
    
    // Extract JSON from response
    const jsonMatch = responseText.match(/\{[^}]+\}/);
    if (jsonMatch) {
      const intent = JSON.parse(jsonMatch[0]);
      console.log(`[Intent] Result: ${intent.action}, query: "${intent.query}"`);
      return intent;
    }
  } catch (err) {
    console.error('[Intent] Groq error:', err.message);
  }
  
  console.log(`[Intent] Failed, defaulting to search`);
  return { action: 'search', query: message, map: null };
}

// Catch-all route for OpenClaw's made-up endpoints
// Handles requests like /api/harvester_events, /api/events/matriarch/upcoming, etc.
app.all('/api/*', async (c) => {
  const fullPath = c.req.path.replace(/^\/api\//, '');
  console.log(`[Catch-all] Received request for: /api/${fullPath}`);
  
  // Extract query from path (e.g., "events/electromagnetic-storm/upcoming" -> "electromagnetic storm event")
  const query = fullPath
    .replace(/\//g, ' ')      // Replace slashes with spaces
    .replace(/_/g, ' ')       // Replace underscores with spaces
    .replace(/-/g, ' ')       // Replace dashes with spaces
    .replace(/upcoming|schedule|next|current/gi, '')  // Remove common suffixes
    .replace(/events?/gi, 'event')  // Normalize "events" to "event"
    .replace(/\s+/g, ' ')     // Collapse multiple spaces
    .trim();
  
  console.log(`[Catch-all] Converted to query: "${query}"`);
  
  // Use LLM to parse intent
  const intent = await getIntentFromLLM(query);
  let response;
  
  switch (intent.action) {
    case 'events':
      const allEvents = await getEvents();
      let filteredEvents = allEvents;
      
      if (intent.query) {
        filteredEvents = allEvents.filter(e => 
          e.name.toLowerCase().includes(intent.query.toLowerCase())
        );
      }
      
      const now = Date.now();
      const formatEventTime = (timestamp) => {
        const diff = timestamp - now;
        if (diff <= 0) return 'Active now';
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        if (hours > 0) return `in ${hours}h ${mins}m`;
        return `in ${mins}m`;
      };
      
      const eventLines = filteredEvents.slice(0, 5).map(e => {
        const timeStr = formatEventTime(e.startTime);
        return `${e.name} @ ${e.map}: ${timeStr}`;
      });
      
      const eventTitle = intent.query 
        ? `🎯 ${intent.query.toUpperCase()} Events`
        : '🎮 Upcoming Events';
      
      response = {
        text: [eventTitle, ...eventLines].join('\n'),
        lines: [eventTitle, ...eventLines],
        events: filteredEvents,
      };
      break;
      
    default:
      const results = await search(query, { limit: 5 });
      response = formatListForGlasses(results, query);
  }
  
  // Push to glasses display
  updateGlassesDisplay(response.lines || response.text.split('\n'));
  
  // Return clean response for OpenClaw to display
  return c.json({
    success: true,
    message: response.text,
    glasses_updated: true,
    display: response.lines,
  });
});

// --- Server Start ---
const PORT = process.env.PORT || 3001;

console.log(`
╔═══════════════════════════════════════════════════════════════╗
║          ARC Raiders - Even Realities Server v2.0             ║
║                    Dynamic Mode (MetaForge)                   ║
╠═══════════════════════════════════════════════════════════════╣
║  Endpoints:                                                   ║
║    GET  /api/health          - Health check                   ║
║    GET  /api/maps            - List available maps            ║
║    GET  /api/search?q=       - Search items/quests/ARCs       ║
║    GET  /api/lookup?q=       - Get single result for glasses  ║
║    GET  /api/quests/:id      - Get quest details              ║
║    GET  /api/items/:id       - Get item details               ║
║    GET  /api/traders         - Get trader inventories         ║
║    GET  /api/events          - Get event schedule             ║
║    POST /api/openclaw/message - OpenClaw webhook              ║
╠═══════════════════════════════════════════════════════════════╣
║  Data source: https://metaforge.app/api/arc-raiders           ║
║  Cache TTL: 5 minutes                                         ║
╚═══════════════════════════════════════════════════════════════╝
`);

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
