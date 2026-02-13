// ==================== STATE ====================
const state = {
  user: null,
  currentSyllabus: null,
  currentTerm: null,
  currentChapter: null,
  quizQuestions: [],
  userAnswers: [],
  currentQuestion: 0,
  videosWatched: false,
  currentRoute: 'login',
  lastResult: null
};

const APP_STATE_KEY = 'historyAppState';
let syncingRoute = false;

// ==================== DOM HELPERS ====================
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function returnToHomeFromResult() {
  state.currentChapter = null;
  state.quizQuestions = [];
  state.userAnswers = [];
  state.currentQuestion = 0;
  state.videosWatched = false;
  state.lastResult = null;
  showPage('home');
  loadHome({ route: 'home' });
}

function getRouteFromHash() {
  const hash = (window.location.hash || '').replace(/^#/, '').trim();
  return hash || null;
}

function setRoute(route, options = {}) {
  state.currentRoute = route;
  if (!options.skipHashUpdate) {
    const nextHash = `#${route}`;
    if (window.location.hash !== nextHash) {
      syncingRoute = true;
      if (options.replace) {
        window.history.replaceState(null, '', nextHash);
      } else {
        window.location.hash = route;
      }
      setTimeout(() => { syncingRoute = false; }, 0);
    }
  }
  persistAppState();
}

function persistAppState() {
  const payload = {
    currentSyllabus: state.currentSyllabus,
    currentTerm: state.currentTerm,
    currentChapter: state.currentChapter,
    quizQuestions: state.quizQuestions,
    userAnswers: state.userAnswers,
    currentQuestion: state.currentQuestion,
    videosWatched: state.videosWatched,
    currentRoute: state.currentRoute,
    lastResult: state.lastResult
  };
  localStorage.setItem(APP_STATE_KEY, JSON.stringify(payload));
}

function hydrateAppState() {
  const raw = localStorage.getItem(APP_STATE_KEY);
  if (!raw) return;
  try {
    const data = JSON.parse(raw);
    state.currentSyllabus = data.currentSyllabus || null;
    state.currentTerm = data.currentTerm || null;
    state.currentChapter = data.currentChapter || null;
    state.quizQuestions = Array.isArray(data.quizQuestions) ? data.quizQuestions : [];
    state.userAnswers = Array.isArray(data.userAnswers) ? data.userAnswers : [];
    state.currentQuestion = Number.isInteger(data.currentQuestion) ? data.currentQuestion : 0;
    state.videosWatched = Boolean(data.videosWatched);
    state.currentRoute = data.currentRoute || 'home';
    state.lastResult = data.lastResult || null;
  } catch (_) {
    localStorage.removeItem(APP_STATE_KEY);
  }
}

function restoreByRoute(route) {
  const targetRoute = route || state.currentRoute || 'home';
  if (!state.user) {
    if (targetRoute === 'signup') {
      showPage('signup');
      setRoute('signup', { replace: true });
      return;
    }
    showPage('login');
    setRoute('login', { replace: true });
    return;
  }

  if (targetRoute === 'home') return loadHome({ route: 'home', skipHashUpdate: true });
  if (targetRoute === 'syllabus') return loadHome({ section: 'syllabus', route: 'syllabus', skipHashUpdate: true });
  if (targetRoute === 'cbse') {
    state.currentSyllabus = 'cbse';
    return loadHome({ section: 'chapters', route: 'cbse', skipHashUpdate: true });
  }
  if (targetRoute === 'samacheer') return loadHome({ section: 'terms', route: 'samacheer', skipHashUpdate: true });
  if (targetRoute === 'chapters') return loadHome({ section: 'chapters', route: 'chapters', skipHashUpdate: true });
  if (targetRoute === 'videos' && state.currentChapter) return loadVideos(state.currentChapter, { route: 'videos', skipHashUpdate: true });
  if (targetRoute === 'quiz') {
    if (state.quizQuestions.length) {
      showPage('quiz');
      setRoute('quiz', { skipHashUpdate: true, replace: true });
      $('#quiz-chapter-title').textContent = state.currentChapter?.name || 'Quiz';
      $('#quiz-loading').classList.add('hidden');
      $('#quiz-container').classList.remove('hidden');
      return renderQuestion();
    }
    if (state.currentChapter) return startQuiz({ route: 'quiz', skipHashUpdate: true });
  }
  if (targetRoute === 'result' && state.lastResult) {
    return showResult(state.lastResult.score, state.lastResult.total, state.lastResult.reviewData, { route: 'result', skipHashUpdate: true, skipPersistResult: true });
  }
  if (targetRoute === 'history') return loadHistory({ route: 'history', skipHashUpdate: true });
  loadHome({ route: 'home', skipHashUpdate: true });
}

function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve, reject) => {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.left = '-9999px';
    document.body.appendChild(area);
    area.focus();
    area.select();
    try {
      const ok = document.execCommand('copy');
      document.body.removeChild(area);
      if (ok) resolve();
      else reject(new Error('Copy failed'));
    } catch (err) {
      document.body.removeChild(area);
      reject(err);
    }
  });
}

function showPage(pageId) {
  $$('.page').forEach(p => p.classList.remove('active'));
  const page = $(`#page-${pageId}`);
  page.classList.add('active');
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function showToast(msg, type = '') {
  const toast = $('#toast');
  toast.textContent = msg;
  toast.className = 'toast show ' + type;
  setTimeout(() => toast.className = 'toast hidden', 3000);
}

async function api(url, options = {}) {
  try {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...options
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Something went wrong');
    return data;
  } catch (err) {
    throw err;
  }
}

// ==================== AUTH ====================
function initAuth() {
  // Check stored session
  const stored = localStorage.getItem('historyUser');
  if (stored) {
    state.user = JSON.parse(stored);
    hydrateAppState();
    const route = getRouteFromHash() || state.currentRoute || 'home';
    restoreByRoute(route);
    return;
  }

  const publicRoute = getRouteFromHash();
  if (publicRoute === 'signup') {
    showPage('signup');
    setRoute('signup', { replace: true });
  } else {
    showPage('login');
    setRoute('login', { replace: true });
  }

  // Switch between login and signup
  $('#goto-signup').addEventListener('click', (e) => {
    e.preventDefault();
    showPage('signup');
    setRoute('signup');
  });

  $('#goto-login').addEventListener('click', (e) => {
    e.preventDefault();
    showPage('login');
    setRoute('login');
  });

  const resultHomeBtn = $('#btn-back-home');
  if (resultHomeBtn) {
    resultHomeBtn.onclick = returnToHomeFromResult;
  }

  // Login form
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = $('#login-username').value.trim();
    const password = $('#login-password').value;
    const errEl = $('#login-error');
    errEl.classList.add('hidden');

    try {
      const data = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      });
      state.user = data.user;
      localStorage.setItem('historyUser', JSON.stringify(data.user));
      loadHome({ route: 'home' });
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    }
  });

  // Signup form
  $('#signup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = $('#signup-username').value.trim();
    const userClass = $('#signup-class').value;
    const password = $('#signup-password').value;
    const errEl = $('#signup-error');
    const successEl = $('#signup-success');
    errEl.classList.add('hidden');
    successEl.classList.add('hidden');

    if (!userClass) {
      errEl.textContent = 'Please select your class';
      errEl.classList.remove('hidden');
      return;
    }

    try {
      await api('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ username, userClass, password })
      });
      successEl.textContent = 'Account created! Redirecting to login...';
      successEl.classList.remove('hidden');
      setTimeout(() => {
        showPage('login');
        setRoute('login');
        $('#login-username').value = username;
        $('#login-password').focus();
      }, 1500);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    }
  });
}

// ==================== HOME ====================
function loadHome(options = {}) {
  showPage('home');
  setRoute(options.route || 'home', { skipHashUpdate: options.skipHashUpdate, replace: options.skipHashUpdate });

  // Set user info
  const name = state.user.username;
  $('#welcome-text').textContent = `Hi, ${name}!`;
  $('#user-avatar').textContent = name.charAt(0).toUpperCase();
  $('#user-class-display').textContent = `Class ${state.user.class}`;

  // If user has a saved syllabus, show it directly
  if (options.section === 'syllabus') {
    showSyllabusSelection({ skipHashUpdate: true });
  } else if (options.section === 'terms') {
    state.currentSyllabus = 'samacheer';
    showSyllabusContent({ skipHashUpdate: true, forceTerms: true });
  } else if (options.section === 'chapters') {
    state.currentSyllabus = state.currentSyllabus || state.user.syllabus;
    if (state.currentSyllabus) {
      if (state.currentSyllabus === 'samacheer' && !state.currentTerm) {
        showSyllabusContent({ skipHashUpdate: true, forceTerms: true });
      } else {
        loadChapters({ skipHashUpdate: true });
      }
    } else {
      showSyllabusSelection({ skipHashUpdate: true });
    }
  } else if (state.user.syllabus) {
    state.currentSyllabus = state.user.syllabus;
    showSyllabusContent();
  } else {
    showSyllabusSelection();
  }

  // Logout
  $('#btn-logout').onclick = () => {
    localStorage.removeItem('historyUser');
    localStorage.removeItem(APP_STATE_KEY);
    state.user = null;
    location.reload();
  };

  // Quiz history
  $('#btn-history').onclick = () => loadHistory();

  // Syllabus card clicks
  $$('.syllabus-card').forEach(card => {
    card.onclick = async () => {
      const syllabus = card.dataset.syllabus;
      state.currentSyllabus = syllabus;
      state.user.syllabus = syllabus;
      localStorage.setItem('historyUser', JSON.stringify(state.user));

      // Save to db
      await api('/api/syllabus/set', {
        method: 'POST',
        body: JSON.stringify({ userId: state.user.id, syllabus })
      });

      showSyllabusContent();
    };
  });

  // Back to syllabus
  $('#back-to-syllabus').onclick = () => {
    state.currentSyllabus = null;
    state.currentTerm = null;
    showSyllabusSelection();
  };

  // Term cards
  $$('.term-card').forEach(card => {
    card.onclick = () => {
      state.currentTerm = card.dataset.term;
      loadChapters();
    };
  });

  // Back to terms
  $('#back-to-terms').onclick = () => {
    if (state.currentSyllabus === 'samacheer') {
      $('#chapter-list').classList.add('hidden');
      $('#term-selection').classList.remove('hidden');
    } else {
      showSyllabusSelection();
    }
  };
}

function showSyllabusSelection(options = {}) {
  $('#syllabus-selection').classList.remove('hidden');
  $('#term-selection').classList.add('hidden');
  $('#chapter-list').classList.add('hidden');
  setRoute('syllabus', { skipHashUpdate: options.skipHashUpdate, replace: options.skipHashUpdate });
}

function showSyllabusContent(options = {}) {
  $('#syllabus-selection').classList.add('hidden');

  if (state.currentSyllabus === 'samacheer') {
    $('#term-selection').classList.remove('hidden');
    $('#chapter-list').classList.add('hidden');
    setRoute('samacheer', { skipHashUpdate: options.skipHashUpdate, replace: options.skipHashUpdate });
  } else {
    // CBSE - show chapters directly
    $('#term-selection').classList.add('hidden');
    loadChapters({ skipHashUpdate: options.skipHashUpdate });
  }
}

async function loadChapters(options = {}) {
  const chapterRoute = state.currentSyllabus === 'cbse' ? 'cbse' : 'chapters';
  setRoute(chapterRoute, { skipHashUpdate: options.skipHashUpdate, replace: options.skipHashUpdate });

  $('#syllabus-selection').classList.add('hidden');

  const syllabus = state.currentSyllabus;
  const userClass = state.user.class;
  let url = `/api/chapters/${syllabus}/${userClass}`;
  if (state.currentTerm) {
    url += `?term=${state.currentTerm}`;
  }

  try {
    const data = await api(url);
    const chapters = data.chapters;

    const container = $('#chapters-container');
    container.innerHTML = '';

    if (!chapters || chapters.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:30px;">No chapters available for your class.</p>';
      $('#chapter-list').classList.remove('hidden');
      return;
    }

    // Set title
    let title = 'Chapters';
    if (syllabus === 'samacheer' && state.currentTerm) {
      const termNum = state.currentTerm.replace('term', '');
      title = `Term ${termNum} - Chapters`;
    } else if (syllabus === 'cbse') {
      title = 'CBSE Chapters';
    }
    $('#chapters-title').textContent = title;

    chapters.forEach((ch, i) => {
      const card = document.createElement('div');
      card.className = 'chapter-card';
      card.style.animationDelay = `${i * 0.04}s`;
      card.innerHTML = `
        <div class="chapter-num">${ch.number}</div>
        <div class="chapter-info">
          <div class="chapter-name">${ch.name}</div>
        </div>
        <div class="chapter-arrow"><i class="fas fa-chevron-right"></i></div>
      `;
      card.onclick = () => {
        state.currentChapter = ch;
        loadVideos(ch);
      };
      container.appendChild(card);
    });

    // Update back button behavior
    $('#back-to-terms').onclick = () => {
      if (state.currentSyllabus === 'samacheer') {
        $('#chapter-list').classList.add('hidden');
        $('#term-selection').classList.remove('hidden');
      } else {
        state.currentSyllabus = null;
        state.user.syllabus = null;
        localStorage.setItem('historyUser', JSON.stringify(state.user));
        showSyllabusSelection();
      }
    };

    $('#chapter-list').classList.remove('hidden');
    if (syllabus === 'samacheer') {
      $('#term-selection').classList.add('hidden');
    } else {
      $('#term-selection').classList.add('hidden');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ==================== VIDEOS ====================
async function loadVideos(chapter, options = {}) {
  showPage('videos');
  setRoute('videos', { skipHashUpdate: options.skipHashUpdate, replace: options.skipHashUpdate });
  state.videosWatched = false;
  $('#btn-start-quiz').disabled = true;
  persistAppState();

  $('#video-chapter-title').textContent = chapter.name;
  $('#videos-container').innerHTML = `
    <div class="loading-spinner">
      <div class="spinner"></div>
      <p>Finding best videos for you...</p>
    </div>
  `;

  // Back button
  $('#back-to-chapters').onclick = () => {
    const route = state.currentSyllabus === 'cbse' ? 'cbse' : 'chapters';
    loadHome({ section: 'chapters', route });
  };

  try {
    const data = await api(`/api/youtube/search?chapter=${encodeURIComponent(chapter.name)}&syllabus=${encodeURIComponent(state.currentSyllabus || '')}`);
    const videos = data.videos;

    if (!videos || videos.length === 0) {
      $('#videos-container').innerHTML = `
        <div class="empty-state">
          <i class="fas fa-video-slash"></i>
          <h3>No videos found</h3>
          <p>We couldn't find suitable chapter animation videos longer than 2 minutes. You can proceed to quiz.</p>
        </div>
      `;
      enableQuizButton();
      return;
    }

    let html = '';
    videos.forEach((v, idx) => {
      const videoUrl = `https://www.youtube.com/watch?v=${v.videoId}`;
      html += `
        <div class="video-card" style="animation-delay:${idx * 0.08}s">
          <div class="video-embed">
            <iframe 
              src="https://www.youtube.com/embed/${v.videoId}?rel=0" 
              title="${escapeHtml(v.title)}"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
              loading="lazy"
              allowfullscreen>
            </iframe>
          </div>
          <div class="video-meta">
            <div class="video-title">${escapeHtml(v.title)}</div>
            <div class="video-tags-row">
              <span class="video-tag"><i class="fas fa-clock"></i> ${escapeHtml(v.durationLabel || '--:--')}</span>
              <span class="video-tag"><i class="fas fa-language"></i> ${escapeHtml(v.sourceTier || 'Any Language')}</span>
            </div>
            <div class="video-channel">${escapeHtml(v.channel)}</div>
            <div class="video-links-row">
              <a class="video-link-btn" href="${videoUrl}" target="_blank" rel="noopener noreferrer">
                <i class="fab fa-youtube"></i> Open in YouTube
              </a>
              <button class="video-link-btn copy-link-btn" data-link="${videoUrl}" type="button">
                <i class="fas fa-copy"></i> Copy Link
              </button>
            </div>
          </div>
        </div>
      `;
    });

    $('#videos-container').innerHTML = html;

    $$('.copy-link-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const link = btn.getAttribute('data-link') || '';
        try {
          await copyText(link);
          showToast('Video link copied', 'success');
        } catch (err) {
          showToast('Unable to copy link on this device', 'error');
        }
      });
    });

    // Enable quiz after a short delay (simulating watching)
    setTimeout(enableQuizButton, 3000);
  } catch (err) {
    $('#videos-container').innerHTML = `
      <div class="empty-state">
        <i class="fas fa-exclamation-triangle"></i>
        <h3>Error loading videos</h3>
        <p>${err.message}</p>
      </div>
    `;
    enableQuizButton();
  }
}

function enableQuizButton() {
  state.videosWatched = true;
  const btn = $('#btn-start-quiz');
  btn.disabled = false;
  btn.onclick = () => startQuiz();
  btn.classList.add('pulse-animate');
  persistAppState();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ==================== QUIZ ====================
async function startQuiz(options = {}) {
  showPage('quiz');
  setRoute('quiz', { skipHashUpdate: options.skipHashUpdate, replace: options.skipHashUpdate });
  state.quizQuestions = [];
  state.userAnswers = [];
  state.currentQuestion = 0;

  const chapter = state.currentChapter;
  $('#quiz-chapter-title').textContent = chapter.name;
  $('#quiz-loading').classList.remove('hidden');
  $('#quiz-container').classList.add('hidden');

  try {
    const data = await api('/api/quiz/generate', {
      method: 'POST',
      body: JSON.stringify({
        chapterName: chapter.name,
        userClass: state.user.class
      })
    });

    state.quizQuestions = data.questions;
    state.userAnswers = new Array(data.questions.length).fill(-1);
    persistAppState();

    $('#quiz-loading').classList.add('hidden');
    $('#quiz-container').classList.remove('hidden');

    renderQuestion();
  } catch (err) {
    $('#quiz-loading').innerHTML = `
      <div class="empty-state">
        <i class="fas fa-exclamation-triangle"></i>
        <h3>Failed to generate quiz</h3>
        <p>${err.message}</p>
        <button class="btn btn-primary" onclick="startQuiz()" style="margin-top:16px;">
          <i class="fas fa-redo"></i> Try Again
        </button>
      </div>
    `;
  }
}

function renderQuestion() {
  const q = state.quizQuestions[state.currentQuestion];
  const idx = state.currentQuestion;
  const total = state.quizQuestions.length;

  // Update progress
  $('#quiz-progress-text').textContent = `${idx + 1} / ${total}`;
  $('#quiz-progress-bar').style.width = `${((idx + 1) / total) * 100}%`;

  // Render question
  const letters = ['A', 'B', 'C', 'D'];
  let optionsHtml = '';
  q.options.forEach((opt, i) => {
    const selected = state.userAnswers[idx] === i ? 'selected' : '';
    optionsHtml += `
      <button class="option-btn ${selected}" data-index="${i}">
        <span class="option-letter">${letters[i]}</span>
        <span class="option-text">${escapeHtml(opt)}</span>
      </button>
    `;
  });

  $('#quiz-question-area').innerHTML = `
    <div class="quiz-question">
      <div class="question-text">Q${idx + 1}. ${escapeHtml(q.question)}</div>
      <div class="options-list">${optionsHtml}</div>
    </div>
  `;

  // Option clicks
  $$('.option-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const optIdx = parseInt(btn.dataset.index);
      state.userAnswers[idx] = optIdx;
      $$('.option-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      btn.querySelector('.option-letter').style.background = 'var(--primary)';
      btn.querySelector('.option-letter').style.color = 'white';
      persistAppState();
    });
  });

  // Navigation buttons
  const prevBtn = $('#btn-prev-question');
  const nextBtn = $('#btn-next-question');
  const submitBtn = $('#btn-submit-quiz');

  prevBtn.disabled = idx === 0;
  prevBtn.onclick = () => {
    if (idx > 0) {
      state.currentQuestion--;
      persistAppState();
      renderQuestion();
    }
  };

  if (idx === total - 1) {
    nextBtn.classList.add('hidden');
    submitBtn.classList.remove('hidden');
    submitBtn.onclick = submitQuiz;
  } else {
    nextBtn.classList.remove('hidden');
    submitBtn.classList.add('hidden');
    nextBtn.onclick = () => {
      state.currentQuestion++;
      persistAppState();
      renderQuestion();
    };
  }
}

async function submitQuiz() {
  // Check if all answered
  const unanswered = state.userAnswers.filter(a => a === -1).length;
  if (unanswered > 0) {
    showToast(`Please answer all questions (${unanswered} remaining)`, 'error');
    return;
  }

  // Calculate score
  let score = 0;
  const reviewData = [];
  state.quizQuestions.forEach((q, i) => {
    const isCorrect = state.userAnswers[i] === q.correct;
    if (isCorrect) score++;
    reviewData.push({
      question: q.question,
      options: q.options,
      userAnswer: state.userAnswers[i],
      correctAnswer: q.correct,
      isCorrect
    });
  });

  const total = state.quizQuestions.length;

  // Save to database
  try {
    await api('/api/quiz/save', {
      method: 'POST',
      body: JSON.stringify({
        userId: state.user.id,
        chapterName: state.currentChapter.name,
        chapterNumber: state.currentChapter.number,
        syllabus: state.currentSyllabus,
        term: state.currentTerm,
        score,
        total,
        questions: reviewData
      })
    });
  } catch (err) {
    console.error('Failed to save quiz:', err);
  }

  showResult(score, total, reviewData);
}

// ==================== RESULT ====================
function showResult(score, total, reviewData, options = {}) {
  showPage('result');
  setRoute(options.route || 'result', { skipHashUpdate: options.skipHashUpdate, replace: options.skipHashUpdate });

  if (!options.skipPersistResult) {
    state.lastResult = { score, total, reviewData };
    persistAppState();
  }

  const percentage = Math.round((score / total) * 100);

  // Score circle animation
  const circle = $('#result-circle');
  circle.style.background = `conic-gradient(${
    percentage >= 70 ? 'var(--success)' : percentage >= 40 ? 'var(--warning)' : 'var(--danger)'
  } ${percentage * 3.6}deg, var(--border) ${percentage * 3.6}deg)`;

  $('#result-score').textContent = score;
  $('#result-total').textContent = `/ ${total}`;

  // Message
  let msg = '';
  if (percentage >= 90) msg = 'Outstanding! 🌟';
  else if (percentage >= 70) msg = 'Great Job! 👏';
  else if (percentage >= 50) msg = 'Good Effort! 💪';
  else if (percentage >= 30) msg = 'Keep Trying! 📚';
  else msg = 'Need More Practice 📖';
  $('#result-message').textContent = msg;

  $('#result-chapter-name').textContent = state.currentChapter.name;

  // Stats
  $('#stat-correct').textContent = score;
  $('#stat-wrong').textContent = total - score;
  $('#stat-percentage').textContent = `${percentage}%`;

  // Review
  const reviewContainer = $('#review-container');
  reviewContainer.innerHTML = '';
  const letters = ['A', 'B', 'C', 'D'];

  reviewData.forEach((r, i) => {
    const div = document.createElement('div');
    div.className = `review-item ${r.isCorrect ? 'correct' : 'wrong'}`;
    div.innerHTML = `
      <div class="review-question">${i + 1}. ${escapeHtml(r.question)}</div>
      <div class="review-answer">
        ${r.isCorrect
          ? `<span class="label-correct">✓ Correct: ${letters[r.correctAnswer]}. ${escapeHtml(r.options[r.correctAnswer])}</span>`
          : `<span class="label-wrong">✗ Your answer: ${letters[r.userAnswer]}. ${escapeHtml(r.options[r.userAnswer])}</span><br>
             <span class="label-correct">✓ Correct: ${letters[r.correctAnswer]}. ${escapeHtml(r.options[r.correctAnswer])}</span>`
        }
      </div>
    `;
    reviewContainer.appendChild(div);
  });

  // Back to home - ONLY through this button
  $('#btn-back-home').onclick = returnToHomeFromResult;
}

// ==================== QUIZ HISTORY ====================
async function loadHistory(options = {}) {
  showPage('history');
  setRoute('history', { skipHashUpdate: options.skipHashUpdate, replace: options.skipHashUpdate });

  const container = $('#history-container');
  const emptyState = $('#history-empty');
  container.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p>Loading history...</p></div>';
  emptyState.classList.add('hidden');

  // Back button
  $('#back-from-history').onclick = () => loadHome({ route: 'home' });

  try {
    const data = await api(`/api/quiz/history/${state.user.id}`);
    const history = data.history;

    if (!history || history.length === 0) {
      container.innerHTML = '';
      emptyState.classList.remove('hidden');
      $('#hist-total-quizzes').textContent = '0';
      $('#hist-total-chapters').textContent = '0';
      $('#hist-avg-score').textContent = '0%';
      return;
    }

    emptyState.classList.add('hidden');

    // Calculate stats
    const totalQuizzes = history.length;
    const uniqueChapters = new Set(history.map(h => h.chapter_name)).size;
    const avgScore = Math.round(history.reduce((sum, h) => sum + (h.score / h.total) * 100, 0) / totalQuizzes);

    $('#hist-total-quizzes').textContent = totalQuizzes;
    $('#hist-total-chapters').textContent = uniqueChapters;
    $('#hist-avg-score').textContent = `${avgScore}%`;

    // Render history cards
    container.innerHTML = '';
    history.forEach((h, i) => {
      const pct = Math.round((h.score / h.total) * 100);
      const badgeClass = pct >= 70 ? 'high' : pct >= 40 ? 'medium' : 'low';
      const date = new Date(h.created_at).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      });

      const card = document.createElement('div');
      card.className = 'history-card';
      card.style.animationDelay = `${i * 0.04}s`;
      card.innerHTML = `
        <div class="history-score-badge ${badgeClass}">${h.score}/${h.total}</div>
        <div class="history-info">
          <div class="history-chapter">${escapeHtml(h.chapter_name)}</div>
          <div class="history-details">
            <span><i class="fas fa-book-open"></i> ${h.syllabus === 'samacheer' ? 'Samacheer' : 'CBSE'}${h.term ? ` • ${h.term.replace('term', 'Term ')}` : ''}</span>
            <span><i class="fas fa-calendar"></i> ${date}</span>
          </div>
        </div>
      `;
      container.appendChild(card);
    });
  } catch (err) {
    container.innerHTML = '';
    showToast(err.message, 'error');
  }
}

// ==================== INIT ====================
document.addEventListener('click', (event) => {
  const target = event.target.closest('#btn-back-home');
  if (target) {
    event.preventDefault();
    returnToHomeFromResult();
  }
});

window.addEventListener('hashchange', () => {
  if (syncingRoute) return;
  const route = getRouteFromHash();
  if (!route) return;
  restoreByRoute(route);
});

document.addEventListener('DOMContentLoaded', initAuth);
