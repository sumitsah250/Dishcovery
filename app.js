/* ============================================================
   DISHCOVERY AI — app.js (Premium Redesign)
   Photo upload · Text input · Voice input
   Connects to FastAPI /predict + /recipes
   ============================================================ */
'use strict';

// ── Config ────────────────────────────────────────────────────
const DEFAULT_API = 'http://127.0.0.1:8000';
let API_BASE      = localStorage.getItem('dishcovery_api') || DEFAULT_API;

// ── State ─────────────────────────────────────────────────────
let savedRecipes      = JSON.parse(localStorage.getItem('dishcovery_saved')    || '[]');
let recentDiscoveries = JSON.parse(localStorage.getItem('dishcovery_recent')   || '[]');
let imagesAnalyzed    = parseInt(localStorage.getItem('dishcovery_analyzed')   || '0');
let _currentRecipe    = null;
let isDark            = localStorage.getItem('dishcovery_dark') !== 'false'; // default dark
let _voiceParsed      = [];
let _recognition      = null;
let _isListening      = false;
let _activeTab        = 'photo';

// Apply theme immediately
document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');

// ── Cursor glow ───────────────────────────────────────────────
document.addEventListener('mousemove', e => {
  const g = document.getElementById('cursor-glow');
  if (g) { g.style.left = e.clientX + 'px'; g.style.top = e.clientY + 'px'; }
});

// ── Persist ───────────────────────────────────────────────────
function persist() {
  localStorage.setItem('dishcovery_saved',    JSON.stringify(savedRecipes));
  localStorage.setItem('dishcovery_recent',   JSON.stringify(recentDiscoveries));
  localStorage.setItem('dishcovery_analyzed', imagesAnalyzed);
  updateStats();
}

// ── Theme ─────────────────────────────────────────────────────
function toggleTheme() {
  isDark = !isDark;
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  localStorage.setItem('dishcovery_dark', isDark);
  const moon = document.querySelector('.icon-moon');
  const sun  = document.querySelector('.icon-sun');
  if (moon) moon.style.display = isDark ? 'block' : 'none';
  if (sun)  sun.style.display  = isDark ? 'none'  : 'block';
}

// ── Navigation ────────────────────────────────────────────────
function showPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  document.getElementById('page-' + page)?.classList.add('active');
  document.getElementById('nav-'  + page)?.classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (page === 'myrecipes') renderSavedRecipes();
}

// ── Mobile menu ───────────────────────────────────────────────
function toggleMobileMenu() {
  document.getElementById('mobile-menu').classList.toggle('open');
  document.getElementById('hamburger').classList.toggle('open');
}
function closeMobileMenu() {
  document.getElementById('mobile-menu').classList.remove('open');
  document.getElementById('hamburger').classList.remove('open');
}
document.addEventListener('click', e => {
  const menu   = document.getElementById('mobile-menu');
  const burger = document.getElementById('hamburger');
  if (menu && burger && !menu.contains(e.target) && !burger.contains(e.target)) {
    menu.classList.remove('open');
    burger.classList.remove('open');
  }
});

// ── API helpers ───────────────────────────────────────────────
function getApiBase() {
  const inp = document.getElementById('api-url-input');
  if (inp) {
    API_BASE = inp.value.trim().replace(/\/$/, '') || DEFAULT_API;
    localStorage.setItem('dishcovery_api', API_BASE);
  }
  return API_BASE;
}
async function apiPost(path, body) {
  const res = await fetch(getApiBase() + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.detail || `HTTP ${res.status}`); }
  return res.json();
}
async function apiPostForm(path, formData) {
  const res = await fetch(getApiBase() + path, { method: 'POST', body: formData });
  if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.detail || `HTTP ${res.status}`); }
  return res.json();
}
async function apiGet(path) {
  const res = await fetch(getApiBase() + path);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── API health ────────────────────────────────────────────────
async function checkApiHealth() {
  const dot = document.getElementById('api-status-dot');
  if (!dot) return;
  dot.className = 'dot dot-grey';
  try {
    const data = await apiGet('/health');
    dot.className = 'dot dot-green';
    showBanner(`✅ API connected — ${data.dataset_rows} recipes · ${data.classes?.length || 0} YOLO classes`, 'success');
    const cnt = data.dataset_rows?.toLocaleString() || '—';
    setEl('stat-dataset', cnt);
    setEl('cta-recipe-count', `🍽 ${cnt} recipes`);
    setEl('footer-recipe-count', `${cnt} recipes`);
  } catch {
    dot.className = 'dot dot-red';
    showBanner(`❌ Cannot reach API at ${getApiBase()} — is the server running? (uvicorn main:app --reload)`, 'error');
  }
}
function showBanner(text, type = 'info') {
  const b = document.getElementById('api-banner');
  const t = document.getElementById('api-banner-text');
  if (!b || !t) return;
  t.textContent = text;
  b.className = `api-banner api-banner-${type}`;
}
function setEl(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// ── Stats ─────────────────────────────────────────────────────
function updateStats() {
  setEl('stat-saved',      savedRecipes.length);
  setEl('stat-analyzed',   imagesAnalyzed);
  setEl('stat-discovered', recentDiscoveries.length + 24);
  renderRecentList();
}

// ── Recent list ───────────────────────────────────────────────
function renderRecentList() {
  const el = document.getElementById('recent-list');
  if (!el) return;
  if (recentDiscoveries.length === 0) {
    el.innerHTML = '<div class="empty-hint">No discoveries yet — head to Discovery to get started.</div>';
    return;
  }
  el.innerHTML = recentDiscoveries.slice(0, 5).map(r => `
    <div class="recent-item" onclick='openModal(${JSON.stringify(r)})'>
      <div class="ri-thumb">${r.emoji || '🍽'}</div>
      <div style="flex:1;min-width:0">
        <div class="ri-name">${r.recipe_name}</div>
        <div class="ri-meta">
          <span class="ri-pill">${r.prep_time || '—'}</span>
          <span class="ri-pill">${r.matched_count} matched</span>
          <span class="ri-pill">${r.match_percent}%</span>
        </div>
      </div>
    </div>`).join('');
}

// ═══════════════════════════════════════════════════════════════
//  DISCOVERY TABS
// ═══════════════════════════════════════════════════════════════
function switchTab(name) {
  _activeTab = name;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.getElementById('tab-' + name)?.classList.add('active');
  document.getElementById('panel-' + name)?.classList.add('active');
  // Clear results when switching tabs
  document.getElementById('results-section').innerHTML = '';
}

// ═══════════════════════════════════════════════════════════════
//  PHOTO UPLOAD
// ═══════════════════════════════════════════════════════════════
function handleDragOver(e)  { e.preventDefault(); document.getElementById('upload-zone').classList.add('drag-over'); }
function handleDragLeave()  { document.getElementById('upload-zone').classList.remove('drag-over'); }
function handleDrop(e) {
  e.preventDefault();
  document.getElementById('upload-zone').classList.remove('drag-over');
  const f = e.dataTransfer.files[0];
  if (f && f.type.startsWith('image/')) processImage(f);
}
function handleFile(e) {
  const f = e.target.files[0];
  if (f) processImage(f);
  e.target.value = '';
}

async function processImage(file) {
  const section = document.getElementById('results-section');
  const preview = URL.createObjectURL(file);
  section.innerHTML = `
    <img src="${preview}" class="preview-img" alt="Uploaded food image">
    <div class="loading-state">
      <div class="spinner"></div>
      <p>Step 1 of 2 — Running YOLO detection…</p>
    </div>`;
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });

  try {
    const formData = new FormData();
    formData.append('file', file, file.name);
    const detection = await apiPostForm('/predict', formData);
    imagesAnalyzed++;
    persist();

    const ingredients = detection.ingredients || [];
    const detections  = detection.detections  || [];

    if (ingredients.length === 0) {
      section.innerHTML = `
        <img src="${preview}" class="preview-img" alt="Uploaded food image">
        <div class="no-results-state">
          <div style="font-size:40px;margin-bottom:14px">🤔</div>
          <div class="no-results-title">No ingredients detected</div>
          <p class="no-results-sub">YOLO didn't detect known food items. Try a clearer image or check the model's class list.</p>
          <button class="btn-primary" style="margin-top:18px" onclick="document.getElementById('file-input').click()">Try Another Image</button>
        </div>`;
      return;
    }

    const pEl = section.querySelector('.loading-state p');
    if (pEl) pEl.textContent = `Step 2 of 2 — Matching ${ingredients.length} ingredient${ingredients.length > 1 ? 's' : ''} to recipes…`;

    const recipeData = await apiPost('/recipes', { ingredients, top_n: 5 });
    showDiscoveryResults(preview, ingredients, detections, recipeData.recipes || [], file.name);
  } catch (err) {
    section.innerHTML = `
      <img src="${preview}" class="preview-img" alt="Uploaded image">
      <div class="error-state">
        <div style="font-size:36px;margin-bottom:12px">⚠️</div>
        <div class="error-title">API Error</div>
        <p class="error-sub">${err.message}</p>
        <p class="error-hint">Make sure the FastAPI server is running:<br>
          <code>python -m uvicorn main:app --reload</code></p>
        <button class="btn-primary" style="margin-top:18px" onclick="checkApiHealth()">Test Connection</button>
      </div>`;
    showBanner(`❌ ${err.message}`, 'error');
  }
}

// ═══════════════════════════════════════════════════════════════
//  TEXT INPUT
// ═══════════════════════════════════════════════════════════════
function updateTextChips() {
  const raw   = document.getElementById('ingredient-textarea')?.value || '';
  const chips = document.getElementById('chip-preview');
  if (!chips) return;
  const items = raw.split(',').map(s => s.trim()).filter(Boolean);
  chips.innerHTML = items.map(i => `<span class="c-chip">🥘 ${i}</span>`).join('');
  const btn = document.getElementById('text-submit-btn');
  if (btn) btn.disabled = items.length === 0;
}

function addQuickIngredient(ing) {
  const ta = document.getElementById('ingredient-textarea');
  if (!ta) return;
  const cur = ta.value.trim();
  if (cur === '') {
    ta.value = ing;
  } else {
    const parts = cur.split(',').map(s => s.trim()).filter(Boolean);
    if (!parts.map(p => p.toLowerCase()).includes(ing.toLowerCase())) {
      ta.value = [...parts, ing].join(', ');
    }
  }
  updateTextChips();
  ta.focus();
}

function clearTextInput() {
  const ta = document.getElementById('ingredient-textarea');
  if (ta) { ta.value = ''; ta.focus(); }
  const chips = document.getElementById('chip-preview');
  if (chips) chips.innerHTML = '';
  document.getElementById('results-section').innerHTML = '';
}

async function processTextIngredients() {
  const ta   = document.getElementById('ingredient-textarea');
  const raw  = ta?.value || '';
  const ings = raw.split(',').map(s => s.trim()).filter(Boolean);
  if (ings.length === 0) { ta?.focus(); return; }
  await matchIngredients(ings, 'text');
}

// ═══════════════════════════════════════════════════════════════
//  VOICE INPUT
// ═══════════════════════════════════════════════════════════════
function initVoice() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    document.getElementById('voice-no-support').style.display = 'block';
    const orb = document.getElementById('voice-orb');
    if (orb) { orb.style.opacity = '0.4'; orb.style.pointerEvents = 'none'; }
    return;
  }
  _recognition = new SpeechRecognition();
  _recognition.lang = 'en-US';
  _recognition.interimResults = true;
  _recognition.maxAlternatives = 1;
  _recognition.continuous = false;

  _recognition.onstart = () => {
    _isListening = true;
    setVoiceUI('listening');
  };
  _recognition.onresult = e => {
    let final = '', interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) final += t; else interim += t;
    }
    const heard = (final || interim).trim();
    const box  = document.getElementById('transcript-box');
    const text = document.getElementById('transcript-text');
    if (heard && box && text) { box.style.display = 'block'; text.textContent = `"${heard}"`; }
    if (final) {
      _voiceParsed = parseVoiceTranscript(final);
      renderVoiceChips(_voiceParsed);
    }
  };
  _recognition.onerror = e => {
    _isListening = false;
    setVoiceUI('error', e.error === 'no-speech' ? 'No speech detected. Try again.' : `Error: ${e.error}`);
  };
  _recognition.onend = () => {
    _isListening = false;
    if (_voiceParsed.length > 0) setVoiceUI('done');
    else setVoiceUI('idle');
  };
}

function parseVoiceTranscript(text) {
  // Strip filler phrases
  const cleaned = text
    .toLowerCase()
    .replace(/i (have|got|see|found)|there('s| is)|and also|also|please|can you|make me|what can i make with|i want to cook with/gi, '')
    .replace(/\band\b/gi, ',')
    .replace(/\s+/g, ' ').trim();

  return cleaned.split(/[,،]+/)
    .map(s => s.trim())
    .filter(s => s.length > 1 && s.length < 50);
}

function renderVoiceChips(items) {
  const el = document.getElementById('parsed-chips');
  if (!el) return;
  el.innerHTML = items.map(i => `<span class="p-chip">🥘 ${capitalize(i)}</span>`).join('');
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function toggleVoiceRecording() {
  if (!_recognition) { initVoice(); if (!_recognition) return; }
  if (_isListening) {
    _recognition.stop();
  } else {
    _voiceParsed = [];
    renderVoiceChips([]);
    const box = document.getElementById('transcript-box');
    if (box) box.style.display = 'none';
    document.getElementById('voice-actions').style.display = 'none';
    _recognition.start();
  }
}

function setVoiceUI(state, msg) {
  const orb     = document.getElementById('voice-orb');
  const orbWrap = document.getElementById('orb-wrap');
  const mic     = document.getElementById('orb-mic');
  const bars    = document.getElementById('orb-bars');
  const title   = document.getElementById('vs-title');
  const sub     = document.getElementById('vs-sub');
  const acts    = document.getElementById('voice-actions');

  if (!orb || !title) return;

  const states = {
    idle: {
      orbClass: '', wrapClass: '',
      showMic: true, showBars: false,
      title: 'Tap to start listening',
      sub: 'Say your ingredients naturally — "I have tomatoes, garlic, and chicken"',
      acts: false,
    },
    listening: {
      orbClass: 'listening', wrapClass: 'listening',
      showMic: false, showBars: true,
      title: 'Listening…',
      sub: 'Speak clearly — list your ingredients out loud',
      acts: false,
    },
    done: {
      orbClass: '', wrapClass: '',
      showMic: true, showBars: false,
      title: `Found ${_voiceParsed.length} ingredient${_voiceParsed.length !== 1 ? 's' : ''}`,
      sub: 'Review the ingredients above, then find recipes or try again.',
      acts: true,
    },
    error: {
      orbClass: '', wrapClass: '',
      showMic: true, showBars: false,
      title: msg || 'Something went wrong',
      sub: 'Tap the mic and try again.',
      acts: false,
    },
  };

  const s = states[state] || states.idle;
  orb.className = 'orb' + (s.orbClass ? ' ' + s.orbClass : '');
  orbWrap.className = 'orb-wrap' + (s.wrapClass ? ' ' + s.wrapClass : '');
  if (mic)  mic.style.display  = s.showMic  ? 'block' : 'none';
  if (bars) bars.style.display = s.showBars ? 'flex'  : 'none';
  title.textContent = s.title;
  if (sub) sub.textContent = s.sub;
  if (acts) acts.style.display = s.acts ? 'flex' : 'none';
}

function resetVoice() {
  _voiceParsed = [];
  renderVoiceChips([]);
  const box = document.getElementById('transcript-box');
  if (box) box.style.display = 'none';
  document.getElementById('voice-actions').style.display = 'none';
  document.getElementById('results-section').innerHTML = '';
  setVoiceUI('idle');
}

async function processVoiceIngredients() {
  if (_voiceParsed.length === 0) return;
  await matchIngredients(_voiceParsed, 'voice');
}

// ═══════════════════════════════════════════════════════════════
//  SHARED MATCH PIPELINE (text + voice → /recipes)
// ═══════════════════════════════════════════════════════════════
async function matchIngredients(ingredients, mode) {
  const section = document.getElementById('results-section');
  section.innerHTML = `
    <div class="loading-state">
      <div class="spinner"></div>
      <p>Matching ${ingredients.length} ingredient${ingredients.length !== 1 ? 's' : ''} to recipes…</p>
    </div>`;
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });

  try {
    const recipeData = await apiPost('/recipes', { ingredients, top_n: 5 });
    const recipes    = recipeData.recipes || [];
    showDiscoveryResults(null, ingredients, [], recipes, mode);
  } catch (err) {
    section.innerHTML = `
      <div class="error-state">
        <div style="font-size:36px;margin-bottom:12px">⚠️</div>
        <div class="error-title">API Error</div>
        <p class="error-sub">${err.message}</p>
        <p class="error-hint">Make sure FastAPI is running: <code>uvicorn main:app --reload</code></p>
        <button class="btn-primary" style="margin-top:16px" onclick="checkApiHealth()">Test Connection</button>
      </div>`;
    showBanner(`❌ ${err.message}`, 'error');
  }
}

// ═══════════════════════════════════════════════════════════════
//  RENDER RESULTS
// ═══════════════════════════════════════════════════════════════
function showDiscoveryResults(imgSrc, ingredients, detections, recipes, source) {
  const section    = document.getElementById('results-section');
  const savedNames = savedRecipes.map(r => r.recipe_name);

  if (recipes.length > 0) {
    const top = { ...recipes[0], emoji: recipeEmoji(recipes[0].cuisine), timestamp: Date.now() };
    recentDiscoveries.unshift(top);
    if (recentDiscoveries.length > 20) recentDiscoveries.pop();
    persist();
  }

  const imgHTML = imgSrc
    ? `<img src="${imgSrc}" class="preview-img" alt="Uploaded food image">`
    : '';

  const detHTML = `
    <div class="detected-box">
      <div class="det-title">
        ${source === 'text' ? '✏️ You entered' : source === 'voice' ? '🎙 You said' : `🤖 YOLO detected`}
        <strong>${ingredients.length}</strong> ingredient${ingredients.length !== 1 ? 's' : ''}
        ${source === 'photo' ? '<span class="det-conf-note">(conf ≥ 40%)</span>' : ''}
      </div>
      <div class="chip-wrap">
        ${ingredients.map(i => `<span class="d-chip">🥘 ${i}</span>`).join('')}
      </div>
      ${detections.length > 0 ? `
        <div class="det-pills">
          ${detections.map(d => `
            <span class="det-pill">
              ${d.label}
              <span class="det-pct">${Math.round(d.confidence * 100)}%</span>
            </span>`).join('')}
        </div>` : ''}
    </div>`;

  const recipesHTML = recipes.length === 0
    ? `<div class="no-results-state">
         <div style="font-size:36px;margin-bottom:12px">📭</div>
         <div class="no-results-title">No matching recipes found</div>
         <p class="no-results-sub">Detected: ${ingredients.join(', ')} — but no recipes matched in the dataset.</p>
       </div>`
    : `<div class="results-heading">🍽 Top ${recipes.length} Matching Recipes</div>
       <div class="recipe-results">
         ${recipes.map((r, i) => {
           const emoji = recipeEmoji(r.cuisine);
           const saved = savedNames.includes(r.recipe_name);
           return `
           <div class="rr-card" onclick='openModal(${JSON.stringify({...r, emoji})})'>
             <div class="rr-rank">#${i + 1}</div>
             <div class="rr-emoji">${emoji}</div>
             <div class="rr-info">
               <div class="rr-name">${r.recipe_name}</div>
               <div class="rr-meta">
                 <span>⏱ ${r.prep_time || '—'}</span>
                 <span>👤 ${r.serves || '—'}</span>
                 <span>🎯 ${r.match_percent}% match</span>
                 <span>✅ ${r.matched_count} ingredient${r.matched_count !== 1 ? 's' : ''}</span>
               </div>
               <div class="match-track">
                 <div class="match-fill" style="width:${Math.min(r.match_percent,100)}%"></div>
               </div>
             </div>
             <button class="btn-save-r${saved ? ' saved' : ''}"
               onclick="event.stopPropagation();quickSave(${JSON.stringify({...r,emoji})},this)">
               ${saved ? '✓' : '+ Save'}
             </button>
           </div>`;
         }).join('')}
       </div>`;

  section.innerHTML = imgHTML + detHTML + recipesHTML;
}

// ── Emoji helper ───────────────────────────────────────────────
function recipeEmoji(cuisine = '') {
  const c = cuisine.toLowerCase();
  if (c.includes('italian'))  return '🍝';
  if (c.includes('mexican'))  return '🌮';
  if (c.includes('chinese') || c.includes('japanese')) return '🍜';
  if (c.includes('indian'))   return '🍛';
  if (c.includes('american')) return '🍔';
  if (c.includes('french'))   return '🥐';
  if (c.includes('thai'))     return '🍲';
  if (c.includes('mediterranean')) return '🫒';
  return '🍽';
}

// ── Quick save ─────────────────────────────────────────────────
function quickSave(recipe, btn) {
  if (btn.classList.contains('saved')) return;
  savedRecipes.push(recipe);
  persist();
  btn.classList.add('saved');
  btn.textContent = '✓';
}

// ═══════════════════════════════════════════════════════════════
//  SAVED RECIPES PAGE
// ═══════════════════════════════════════════════════════════════
function renderSavedRecipes(filter = '') {
  const container = document.getElementById('recipes-container');
  if (!container) return;
  const q        = filter.toLowerCase();
  const filtered = savedRecipes.filter(r =>
    r.recipe_name?.toLowerCase().includes(q) ||
    r.cuisine?.toLowerCase().includes(q) ||
    r.tags?.toLowerCase().includes(q)
  );

  if (savedRecipes.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔖</div>
        <div class="empty-title">No saved recipes yet</div>
        <p class="empty-sub">Upload an image, type ingredients, or use voice on the Discovery page and save matches here.</p>
        <button class="btn-primary" onclick="showPage('discovery')">Start Discovering</button>
      </div>`;
    return;
  }
  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔍</div>
        <div class="empty-title">No results for "${filter}"</div>
        <p class="empty-sub">Try a different recipe name or cuisine.</p>
      </div>`;
    return;
  }
  container.innerHTML = `
    <div class="saved-grid">
      ${filtered.map(r => `
        <div class="sr-card" onclick='openModal(${JSON.stringify(r)})'>
          <div class="sr-thumb">${r.emoji || '🍽'}</div>
          <div class="sr-body">
            <div class="sr-name">${r.recipe_name}</div>
            <div class="sr-meta">
              <span>⏱ ${r.prep_time || '—'}</span>
              <span>👤 ${r.serves || '—'}</span>
              <span>🎯 ${r.match_percent || '?'}%</span>
            </div>
            <div class="sr-tags">
              ${(r.tags || '').split(',').slice(0,3).map(t => t.trim()).filter(Boolean).map(t => `<span class="sr-tag">${t}</span>`).join('')}
              ${r.cuisine ? `<span class="sr-tag">${r.cuisine}</span>` : ''}
            </div>
          </div>
        </div>`).join('')}
    </div>`;
}

function filterRecipes(val) { renderSavedRecipes(val); }

// ═══════════════════════════════════════════════════════════════
//  MODAL
// ═══════════════════════════════════════════════════════════════
function openModal(recipe) {
  _currentRecipe = recipe;
  const modal   = document.getElementById('recipe-modal');
  const content = document.getElementById('modal-content');
  const isSaved = savedRecipes.some(r => r.recipe_name === recipe.recipe_name);

  let steps = recipe.steps || [];
  if (typeof steps === 'string') { try { steps = JSON.parse(steps); } catch { steps = steps.split('. ').filter(Boolean); } }

  let ings = recipe.all_ingredients || recipe.ingredients || [];
  if (typeof ings === 'string') { try { ings = JSON.parse(ings); } catch { ings = [ings]; } }

  const matchedSet = new Set((recipe.matched_ingredients || []).map(m => m.toLowerCase()));

  content.innerHTML = `
    <div class="modal-handle"></div>
    <div class="m-emoji">${recipe.emoji || '🍽'}</div>
    <div class="m-title-bar">
      <span class="m-title">${recipe.recipe_name}</span>
      <button class="m-close" onclick="closeModal()">✕</button>
    </div>
    <div class="m-meta">
      <div class="m-meta-item">
        <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
        ${recipe.prep_time || 'N/A'}
      </div>
      <div class="m-meta-item">
        <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        ${recipe.serves || 'N/A'}
      </div>
      <div class="m-meta-item">
        <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
        ${recipe.match_percent != null ? recipe.match_percent + '% match' : recipe.cuisine || ''}
      </div>
      <div class="m-meta-item">
        <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>
        ${ings.length} ingredients
      </div>
    </div>
    <div class="m-body">
      ${recipe.matched_ingredients?.length ? `
        <div class="m-sec">✅ Matched Ingredients</div>
        <div class="m-ing-list">
          ${recipe.matched_ingredients.map(i => `
            <div class="m-ing matched"><div class="m-dot green"></div><span>${i}</span></div>`).join('')}
        </div>` : ''}
      <div class="m-sec">🛒 All Ingredients</div>
      <div class="m-ing-list">
        ${ings.map(i => {
          const isMatch = [...matchedSet].some(m => i.toLowerCase().includes(m));
          return `<div class="m-ing${isMatch ? ' matched' : ''}"><div class="m-dot${isMatch ? ' green' : ''}"></div><span>${i}</span></div>`;
        }).join('')}
      </div>
      <div class="m-sec">📋 Instructions</div>
      ${steps.length > 0
        ? `<div class="m-steps">
             ${steps.map((s,i) => `
               <div class="m-step">
                 <div class="m-step-n">${i+1}</div>
                 <div class="m-step-text">${s}</div>
               </div>`).join('')}
           </div>`
        : `<p style="color:rgba(242,237,232,.35);font-size:14px">No instructions available.</p>`}
    </div>
    <div class="m-save-bar">
      <button class="m-save-btn${isSaved ? ' saved' : ''}" id="modal-save-btn" onclick="toggleSave()">
        ${isSaved
          ? '✓ Saved to My Recipes'
          : '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg> Save Recipe'}
      </button>
    </div>`;

  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function toggleSave() {
  if (!_currentRecipe) return;
  const idx = savedRecipes.findIndex(r => r.recipe_name === _currentRecipe.recipe_name);
  const btn = document.getElementById('modal-save-btn');
  if (idx > -1) {
    savedRecipes.splice(idx, 1);
    btn.classList.remove('saved');
    btn.innerHTML = `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg> Save Recipe`;
  } else {
    savedRecipes.push({ ..._currentRecipe });
    btn.classList.add('saved');
    btn.textContent = '✓ Saved to My Recipes';
  }
  persist();
  renderSavedRecipes();
}

function closeModal(e) {
  if (e && e.target !== document.getElementById('recipe-modal')) return;
  document.getElementById('recipe-modal').classList.remove('open');
  document.body.style.overflow = '';
  _currentRecipe = null;
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.getElementById('recipe-modal')?.classList.remove('open');
    document.body.style.overflow = '';
    _currentRecipe = null;
  }
});

// ═══════════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  // Sync API URL
  const inp = document.getElementById('api-url-input');
  if (inp) inp.value = API_BASE;

  // Sync theme icons
  const moon = document.querySelector('.icon-moon');
  const sun  = document.querySelector('.icon-sun');
  if (moon) moon.style.display = isDark ? 'block' : 'none';
  if (sun)  sun.style.display  = isDark ? 'none'  : 'block';

  // Render saved + stats
  renderSavedRecipes();
  updateStats();

  // Init voice (check support silently)
  initVoice();

  // Auto-check API
  checkApiHealth();

  // Disable text submit initially
  const btn = document.getElementById('text-submit-btn');
  if (btn) btn.disabled = true;
});