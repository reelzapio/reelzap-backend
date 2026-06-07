api const https = require('https');

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function fetchData(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: options.method || 'GET',
      headers: options.headers || {}
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ ok: res.statusCode < 400, status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ ok: false, data: {} }); }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function extractVideoId(url) {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = '';
  await new Promise(resolve => { req.on('data', c => body += c); req.on('end', resolve); });

  let parsed;
  try { parsed = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }

  const { url, assemblyai_key } = parsed;
  const apiKey = assemblyai_key || process.env.ASSEMBLYAI_KEY;

  if (!url) return res.status(400).json({ error: 'Missing url' });
  if (!apiKey) return res.status(400).json({ error: 'Missing API key' });

  const videoId = extractVideoId(url);
  if (!videoId) return res.status(400).json({ error: 'Invalid YouTube URL' });

  try {
    const oembedRes = await fetchData(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
    const meta = oembedRes.data;

    const submitBody = JSON.stringify({
      audio_url: `https://www.youtube.com/watch?v=${videoId}`,
      auto_chapters: true,
      sentiment_analysis: true,
      auto_highlights: true,
      language_detection: true
    });

    const submitRes = await fetchData('https://api.assemblyai.com/v2/transcript', {
      method: 'POST',
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(submitBody)
      },
      body: submitBody
    });

    if (!submitRes.ok || submitRes.data.error) {
      throw new Error(submitRes.data.error || 'AssemblyAI submission failed');
    }

    return res.status(200).json({
      success: true,
      transcript_id: submitRes.data.id,
      video_info: {
        id: videoId,
        title: meta.title || 'YouTube Video',
        author: meta.author_name || 'Unknown',
        thumbnail: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`
      }
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
