const express = require('express');
const path = require('path');
const cors = require('cors');
const fetch = require('node-fetch');
const {
  initializeDatabase,
  createUser,
  loginUser,
  updateSyllabus,
  getUserById,
  saveQuizResult,
  getQuizHistory
} = require('./database');
const { getChapters, getAvailableClasses } = require('./chapters-data');

const app = express();
const PORT = process.env.PORT || 3000;

// API Keys
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || 'AIzaSyAVfPNDMuwRKLbqRRTZkcpScvOheClh-vM';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize database
initializeDatabase();

// ==================== AUTH ROUTES ====================

app.post('/api/auth/signup', (req, res) => {
  const { username, userClass, password } = req.body;
  if (!username || !userClass || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  if (password.length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters' });
  }
  const result = createUser(username.trim(), userClass, password);
  if (result.success) {
    res.json({ message: 'Account created successfully', userId: result.userId });
  } else {
    res.status(400).json({ error: result.error });
  }
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  const result = loginUser(username.trim(), password);
  if (result.success) {
    res.json({ user: result.user });
  } else {
    res.status(401).json({ error: result.error });
  }
});

// ==================== SYLLABUS ROUTES ====================

app.post('/api/syllabus/set', (req, res) => {
  const { userId, syllabus } = req.body;
  if (!userId || !syllabus) {
    return res.status(400).json({ error: 'User ID and syllabus are required' });
  }
  updateSyllabus(userId, syllabus);
  res.json({ message: 'Syllabus updated successfully' });
});

app.get('/api/chapters/:syllabus/:userClass', (req, res) => {
  const { syllabus, userClass } = req.params;
  const { term } = req.query;
  const chapters = getChapters(syllabus, userClass, term);
  if (!chapters) {
    return res.status(404).json({ error: 'No chapters found for the given class and syllabus' });
  }
  res.json({ chapters });
});

// ==================== YOUTUBE ROUTES ====================

function parseISODurationToSeconds(duration) {
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const hours = parseInt(match[1] || '0', 10);
  const minutes = parseInt(match[2] || '0', 10);
  const seconds = parseInt(match[3] || '0', 10);
  return hours * 3600 + minutes * 60 + seconds;
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function isShortsLike(video) {
  const title = (video.title || '').toLowerCase();
  const desc = (video.description || '').toLowerCase();
  return title.includes('#shorts') || title.includes('shorts') || desc.includes('#shorts') || title.includes('yt shorts');
}

function isLikelyIrrelevant(video) {
  const title = (video.title || '').toLowerCase();
  const description = (video.description || '').toLowerCase();
  const blocked = ['live', 'livestream', 'trailer', 'teaser', 'status', 'whatsapp status', 'reaction'];
  return blocked.some(token => title.includes(token) || description.includes(token));
}

function scoreVideo(video, chapter) {
  const title = (video.title || '').toLowerCase();
  const description = (video.description || '').toLowerCase();
  const chapterWords = chapter.toLowerCase().split(/\s+/).filter(Boolean);
  const keywordBoost = ['animation', 'animated', 'history', 'lesson', 'education', 'cbse', 'samacheer'];

  let score = 0;
  let chapterHits = 0;
  for (const word of chapterWords) {
    if (word.length <= 2) continue;
    if (title.includes(word)) {
      score += 7;
      chapterHits += 1;
    } else if (description.includes(word)) {
      score += 3;
      chapterHits += 1;
    }
  }

  if (chapterHits === 0) score -= 12;
  else if (chapterHits >= 2) score += 5;

  for (const key of keywordBoost) {
    if (title.includes(key)) score += 4;
    else if (description.includes(key)) score += 1;
  }

  if (video.durationSeconds >= 180 && video.durationSeconds <= 1200) score += 6;
  else if (video.durationSeconds >= 120) score += 2;

  const views = Number(video.viewCount || 0);
  if (views > 500000) score += 4;
  else if (views > 100000) score += 3;
  else if (views > 10000) score += 2;

  return score;
}

async function fetchVideoDetails(videoIds) {
  if (!videoIds.length) return [];
  const detailsUrl = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails,snippet,statistics&id=${videoIds.join(',')}&key=${YOUTUBE_API_KEY}`;
  const detailsResp = await fetch(detailsUrl);
  const detailsData = await detailsResp.json();
  if (detailsData.error) {
    console.error('YouTube video details error:', detailsData.error);
    return [];
  }
  return detailsData.items || [];
}

function normalizeTitle(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function searchYouTube(query, chapter, options = {}) {
  if (!YOUTUBE_API_KEY) return [];
  const params = new URLSearchParams({
    part: 'snippet',
    q: query,
    type: 'video',
    maxResults: String(options.maxResults || 16),
    videoEmbeddable: 'true',
    videoDefinition: 'high',
    order: 'relevance',
    key: YOUTUBE_API_KEY
  });

  if (options.relevanceLanguage) {
    params.set('relevanceLanguage', options.relevanceLanguage);
  }

  const url = `https://www.googleapis.com/youtube/v3/search?${params.toString()}`;
  try {
    const response = await fetch(url);
    const data = await response.json();
    if (data.error) {
      console.error('YouTube API error:', data.error);
      return [];
    }

    const videoIds = (data.items || []).map(item => item.id.videoId).filter(Boolean);
    const details = await fetchVideoDetails(videoIds);

    const mapped = details.map(item => {
      const durationSeconds = parseISODurationToSeconds(item.contentDetails?.duration || 'PT0S');
      return {
        videoId: item.id,
        title: item.snippet?.title || '',
        thumbnail: item.snippet?.thumbnails?.high?.url || item.snippet?.thumbnails?.medium?.url || '',
        channel: item.snippet?.channelTitle || '',
        description: item.snippet?.description || '',
        durationSeconds,
        durationLabel: formatDuration(durationSeconds),
        viewCount: item.statistics?.viewCount || '0'
      };
    });

    const filtered = mapped
      .filter(v => v.durationSeconds >= 120)
      .filter(v => !isShortsLike(v))
      .filter(v => !isLikelyIrrelevant(v))
      .map(v => ({ ...v, relevanceScore: scoreVideo(v, chapter) }))
      .sort((a, b) => b.relevanceScore - a.relevanceScore);

    return filtered;
  } catch (err) {
    console.error('YouTube fetch error:', err);
    return [];
  }
}

app.get('/api/youtube/search', async (req, res) => {
  const { chapter, syllabus } = req.query;
  if (!chapter) {
    return res.status(400).json({ error: 'Chapter name is required' });
  }

  const picked = [];
  const seen = new Set();
  const seenTitleRoots = new Set();

  async function collect(query, options, sourceTier) {
    if (picked.length >= 2) return;
    const results = await searchYouTube(query, chapter, options);
    for (const video of results) {
      if (picked.length >= 2) break;
      if (seen.has(video.videoId)) continue;
      const titleRoot = normalizeTitle(video.title).slice(0, 55);
      if (seenTitleRoots.has(titleRoot)) continue;
      seen.add(video.videoId);
      seenTitleRoots.add(titleRoot);
      picked.push({
        ...video,
        sourceTier
      });
    }
  }

  const normalizedSyllabus = String(syllabus || '').toLowerCase();
  const isSamacheer = normalizedSyllabus === 'samacheer';

  if (isSamacheer) {
    await collect(`${chapter} history animation tamil`, { relevanceLanguage: 'ta' }, 'Tamil');
    await collect(`${chapter} history animation english`, { relevanceLanguage: 'en' }, 'English');
  } else {
    await collect(`${chapter} history animation english`, { relevanceLanguage: 'en' }, 'English');
    await collect(`${chapter} history animation tamil`, { relevanceLanguage: 'ta' }, 'Tamil');
  }

  await collect(`${chapter} history animation`, {}, 'Any Language');
  await collect(`${chapter} animated history lesson`, {}, 'Any Language');

  res.json({ videos: picked.slice(0, 2) });
});

// ==================== LOCAL QUIZ ROUTES ====================

function buildLocalQuestions(chapterName, userClass) {
  const chapter = String(chapterName || 'this chapter').trim();
  const chapterLower = chapter.toLowerCase();
  const classNum = Number.parseInt(userClass, 10);
  const level = Number.isFinite(classNum) ? classNum : 10;

  const starter = [
    {
      question: `Which statement best describes "${chapter}"?`,
      options: [
        'It is unrelated to history',
        'It explains important historical changes and their impact',
        'It is only about mathematics',
        'It focuses only on modern technology'
      ],
      correct: 1
    },
    {
      question: `For class ${level}, what is the best way to study "${chapter}"?`,
      options: [
        'Memorize one paragraph only',
        'Understand timeline, causes, and outcomes',
        'Skip maps and sources',
        'Read only once before exam'
      ],
      correct: 1
    },
    {
      question: `Why do historians compare multiple sources for topics like "${chapter}"?`,
      options: [
        'To increase confusion',
        'To avoid evidence',
        'To cross-check facts and reduce bias',
        'To memorize dates only'
      ],
      correct: 2
    },
    {
      question: `Which is usually a primary source in history?`,
      options: [
        'A school rumor',
        'An inscription from the same period',
        'A random social media post',
        'A fictional comic story'
      ],
      correct: 1
    },
    {
      question: `What does a timeline help students do in "${chapter}"?`,
      options: [
        'Arrange events in sequence',
        'Avoid understanding changes',
        'Replace all textbooks',
        'Ignore cause and effect'
      ],
      correct: 0
    },
    {
      question: `Which skill is most useful when answering history questions?`,
      options: [
        'Connecting events with reasons and results',
        'Guessing without reading',
        'Ignoring chapter vocabulary',
        'Writing unrelated points'
      ],
      correct: 0
    },
    {
      question: `In school history, "cause and effect" means:`,
      options: [
        'Events have no relationship',
        'One event can lead to another change',
        'Only kings matter',
        'Only dates matter'
      ],
      correct: 1
    },
    {
      question: `Which revision method helps most before a quiz on "${chapter}"?`,
      options: [
        'Active recall with short self-tests',
        'Reading headings only',
        'Skipping difficult parts',
        'Studying only the night before'
      ],
      correct: 0
    },
    {
      question: `What is a good historical explanation?`,
      options: [
        'One with evidence and context',
        'One based on rumors',
        'One without dates or places',
        'One that avoids sources'
      ],
      correct: 0
    },
    {
      question: `After learning "${chapter}", a student should be able to:`,
      options: [
        'Explain key developments clearly',
        'Avoid all discussion',
        'Ignore historical terms',
        'Confuse causes with effects'
      ],
      correct: 0
    }
  ];

  const topicBoosters = [];
  if (chapterLower.includes('revolution')) {
    topicBoosters.push({
      question: 'Which condition often contributes to a revolution?',
      options: ['Stable equality with no tension', 'Social and economic inequality', 'No public ideas', 'No political conflict'],
      correct: 1
    });
  }
  if (chapterLower.includes('harappa') || chapterLower.includes('civilisation') || chapterLower.includes('civilization')) {
    topicBoosters.push({
      question: 'A key feature of many early civilizations is:',
      options: ['Planned settlements and organized life', 'No agriculture', 'No trade', 'No material remains'],
      correct: 0
    });
  }
  if (chapterLower.includes('buddhism') || chapterLower.includes('jainism')) {
    topicBoosters.push({
      question: 'Religious reform movements are often important because they:',
      options: ['Stop all social change', 'Shape ethical and social ideas', 'Remove all beliefs', 'End cultural exchange'],
      correct: 1
    });
  }

  const merged = [...topicBoosters, ...starter];
  return merged.slice(0, 10);
}

app.post('/api/quiz/generate', (req, res) => {
  const { chapterName, userClass } = req.body;
  if (!chapterName) {
    return res.status(400).json({ error: 'Chapter name is required' });
  }

  const questions = buildLocalQuestions(chapterName, userClass);
  res.json({ questions, source: 'local' });
});

// ==================== QUIZ HISTORY ROUTES ====================

app.post('/api/quiz/save', (req, res) => {
  const { userId, chapterName, chapterNumber, syllabus, term, score, total, questions } = req.body;
  if (!userId || !chapterName || score === undefined || !total) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const result = saveQuizResult(userId, chapterName, chapterNumber || 0, syllabus || '', term, score, total, questions || []);
  res.json(result);
});

app.get('/api/quiz/history/:userId', (req, res) => {
  const { userId } = req.params;
  const history = getQuizHistory(parseInt(userId));
  res.json({ history });
});

// ==================== USER ROUTE ====================

app.get('/api/user/:userId', (req, res) => {
  const user = getUserById(parseInt(req.params.userId));
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  res.json({ user });
});

// Serve SPA
app.get('/sitemap.xml', (req, res) => {
  res.sendFile(path.join(__dirname, 'sitemap.xml'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🎓 History Learning Platform running at http://localhost:${PORT}\n`);
});
