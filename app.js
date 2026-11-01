/**
 * KuisPintar SD — Core Application Engine
 * Web Audio API, Web Speech API (TTS), jsPDF Integration,
 * Gamification, Leaderboard, History & Teacher Admin Mode.
 */

// ==========================================================================
// 1. STATE & STORAGE MANAGEMENT
// ==========================================================================
const APP_STORAGE_KEYS = {
  PROFILE: 'kuispintar_profile',
  RESULTS: 'kuispintar_results',
  SETTINGS: 'kuispintar_settings',
  CUSTOM_QUIZ: 'kuispintar_custom_quiz',
  LEADERBOARD: 'kuispintar_leaderboard',
  SEEN_QUESTIONS: 'kuispintar_seen_questions',
  THEME: 'kuispintar_theme',
  ROLE: 'kuispintar_active_role'
};

const state = {
  user: null,
  currentRole: 'student', // 'student' | 'teacher'
  previewQuizPackage: null,
  settings: {
    sound: true,
    tts: true,
    timerMode: 'santai', // 'santai', 'tantangan' (45s), 'cepat' (20s)
    theme: 'light'
  },
  activeFase: 'faseA',
  selectedKelas: 1,
  selectedMapelId: 'matematika',
  allQuizzes: [],
  currentQuizSession: null,
  resultsHistory: [],
  leaderboardData: [],
  currentReviewResult: null,
  extractedQuestions: [],
  excelExtractedSheets: [],
  activeExcelSheetIndex: 0
};

// Configure PDF.js Worker if available
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// ==========================================================================
// 2. AUDIO SYNTHESIZER (WEB AUDIO API)
// ==========================================================================
let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) {
      audioCtx = new AudioContext();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

function playTone(type) {
  if (!state.settings.sound) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === 'click') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, now);
      osc.frequency.exponentialRampToValueAtTime(800, now + 0.05);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
      osc.start(now);
      osc.stop(now + 0.05);
    } else if (type === 'correct') {
      // Cheerful major chord arpeggio: C5 -> E5 -> G5
      const notes = [523.25, 659.25, 783.99, 1046.50];
      notes.forEach((freq, idx) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'triangle';
        o.frequency.setValueAtTime(freq, now + idx * 0.08);
        g.gain.setValueAtTime(0.2, now + idx * 0.08);
        g.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.25);
        o.connect(g);
        g.connect(ctx.destination);
        o.start(now + idx * 0.08);
        o.stop(now + idx * 0.08 + 0.25);
      });
    } else if (type === 'wrong') {
      // Gentle, friendly low chord (non-punishing)
      osc.type = 'sine';
      osc.frequency.setValueAtTime(320, now);
      osc.frequency.exponentialRampToValueAtTime(260, now + 0.18);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
      osc.start(now);
      osc.stop(now + 0.25);
    } else if (type === 'fanfare') {
      // Celebratory melody
      const victoryNotes = [523.25, 659.25, 783.99, 1046.50, 1318.51];
      victoryNotes.forEach((freq, i) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'triangle';
        o.frequency.setValueAtTime(freq, now + i * 0.1);
        g.gain.setValueAtTime(0.25, now + i * 0.1);
        g.gain.exponentialRampToValueAtTime(0.01, now + i * 0.1 + 0.35);
        o.connect(g);
        g.connect(ctx.destination);
        o.start(now + i * 0.1);
        o.stop(now + i * 0.1 + 0.35);
      });
    }
  } catch (e) {
    console.warn('Audio synthesis note:', e);
  }
}

// ==========================================================================
// 3. TEXT-TO-SPEECH (WEB SPEECH API)
// ==========================================================================
function speakText(text) {
  if (!('speechSynthesis' in window)) {
    showToast('Browser Anda belum mendukung narasi suara.');
    return;
  }
  window.speechSynthesis.cancel(); // Stop prior narration

  const cleanText = text.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}]/gu, '');
  const utterance = new SpeechSynthesisUtterance(cleanText);
  utterance.lang = 'id-ID';
  utterance.rate = 0.95; // Friendly cadence for children
  utterance.pitch = 1.05;

  const btnSpeaker = document.getElementById('btn-tts');
  if (btnSpeaker) btnSpeaker.classList.add('speaking');

  utterance.onend = () => {
    if (btnSpeaker) btnSpeaker.classList.remove('speaking');
  };
  utterance.onerror = () => {
    if (btnSpeaker) btnSpeaker.classList.remove('speaking');
  };

  window.speechSynthesis.speak(utterance);
}

function stopSpeech() {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
  const btnSpeaker = document.getElementById('btn-tts');
  if (btnSpeaker) btnSpeaker.classList.remove('speaking');
}

// ==========================================================================
// 4. DATA PERSISTENCE & INITIALIZATION
// ==========================================================================
function initApp() {
  loadUserSettings();
  applyTheme(state.settings.theme || 'light', false);
  loadCustomQuizzes();
  loadUserData();
  updateUserStreakRealtime();
  loadResultsHistory();
  loadLeaderboard();

  // Setup DOM listeners
  setupNavigation();
  setupClassSelection();
  setupModals();
  setupSettingsToggles();
  setupTeacherMode();

  // Initial UI Render
  renderProfileHeader();
  renderFaseAndGradeCards();
  renderSubjectsGrid();
  renderBadgesShowcase();

  // Role Gating & Startup Check (Mode Siswa vs Mode Guru)
  loadUserRole();
  if (!state.currentRole) {
    openRoleSelectorModal(false);
  } else {
    finalizeRoleSwitch(state.currentRole, false);
  }

  // Dashboard is immediately accessible and interactive from first load
  updateDashboardStats();
}

function loadUserSettings() {
  try {
    const saved = localStorage.getItem(APP_STORAGE_KEYS.SETTINGS);
    if (saved) {
      state.settings = { ...state.settings, ...JSON.parse(saved) };
    }
    const savedTheme = localStorage.getItem(APP_STORAGE_KEYS.THEME);
    if (savedTheme) {
      state.settings.theme = savedTheme;
    }
  } catch (e) {
    console.error(e);
  }
}

function saveUserSettings() {
  localStorage.setItem(APP_STORAGE_KEYS.SETTINGS, JSON.stringify(state.settings));
}

function applyTheme(themeName, showNotification = true) {
  const finalTheme = themeName === 'dark' ? 'dark' : 'light';
  state.settings.theme = finalTheme;
  document.documentElement.setAttribute('data-theme', finalTheme);
  if (document.body) {
    document.body.setAttribute('data-theme', finalTheme);
  }

  try {
    localStorage.setItem(APP_STORAGE_KEYS.THEME, finalTheme);
  } catch (e) {}
  saveUserSettings();

  const btnToggleTheme = document.getElementById('btn-toggle-theme');
  if (btnToggleTheme) {
    if (finalTheme === 'dark') {
      btnToggleTheme.innerHTML = '☀️';
      btnToggleTheme.title = 'Ubah ke Mode Terang';
      btnToggleTheme.setAttribute('aria-label', 'Ubah ke Mode Terang');
    } else {
      btnToggleTheme.innerHTML = '🌙';
      btnToggleTheme.title = 'Ubah ke Mode Gelap';
      btnToggleTheme.setAttribute('aria-label', 'Ubah ke Mode Gelap');
    }
  }

  const selectTheme = document.getElementById('select-theme-mode');
  if (selectTheme) {
    selectTheme.value = finalTheme;
  }

  if (showNotification) {
    showToast(finalTheme === 'dark' ? 'Mode Gelap Aktif 🌙 (Teks Putih Bersih)' : 'Mode Terang Aktif ☀️');
    if (state.settings.sound) playTone('click');
  }
}

function toggleTheme() {
  const current = state.settings.theme === 'dark' ? 'dark' : 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next, true);
}

function getLocalDateString(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function updateUserStreakRealtime() {
  if (!state.user) return;

  const todayStr = getLocalDateString();
  const lastDateStr = state.user.lastActiveDate;

  // Initialize activeDates array for multi-day visit tracking
  if (!Array.isArray(state.user.activeDates)) {
    state.user.activeDates = lastDateStr ? [lastDateStr] : [todayStr];
  }

  if (!state.user.activeDates.includes(todayStr)) {
    state.user.activeDates.push(todayStr);
  }

  if (!lastDateStr) {
    state.user.lastActiveDate = todayStr;
    state.user.streak = state.user.streak || 1;
    saveUserData();
    return;
  }

  if (lastDateStr === todayStr) {
    // Already visited today. Ensure streak is at least 1 or matches recorded consecutive days
    if (!state.user.streak || state.user.streak < 1) {
      state.user.streak = 1;
    }
    return;
  }

  // Calculate day difference between calendar dates in user's local timezone
  const lastParts = lastDateStr.split('-').map(Number);
  const todayParts = todayStr.split('-').map(Number);
  const lastD = new Date(lastParts[0], lastParts[1] - 1, lastParts[2]);
  const currD = new Date(todayParts[0], todayParts[1] - 1, todayParts[2]);
  const diffDays = Math.round((currD.getTime() - lastD.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays >= 1) {
    // If user opened across days, advance streak!
    // If user opened across multiple days, reflect their multi-day engagement
    const addStreak = diffDays === 1 ? 1 : Math.min(diffDays, 3);
    state.user.streak = Math.max((state.user.streak || 1) + addStreak, diffDays + 1);
  }

  state.user.lastActiveDate = todayStr;

  // Award streak badges if milestone reached
  if (!state.user.badgesEarned) state.user.badgesEarned = [];
  if (state.user.streak >= 3 && !state.user.badgesEarned.includes('streak_3')) {
    state.user.badgesEarned.push('streak_3');
    showToast('🔥 Luar biasa! Kamu meraih Lencana: Api Belajar (3 Hari Berturut-turut)!');
  }
  if (state.user.streak >= 7 && !state.user.badgesEarned.includes('streak_7')) {
    state.user.badgesEarned.push('streak_7');
    showToast('⚡ Hebat! Kamu meraih Lencana: Semangat Juara (7 Hari Berturut-turut)!');
  }
  if (state.user.streak >= 14 && !state.user.badgesEarned.includes('streak_14')) {
    state.user.badgesEarned.push('streak_14');
    showToast('👑 Fantastis! Kamu meraih Lencana: Raja Disiplin (14 Hari Berturut-turut)!');
  }

  saveUserData();
  syncUserToLeaderboard();
}

function loadUserData() {
  try {
    const saved = localStorage.getItem(APP_STORAGE_KEYS.PROFILE);
    if (saved) {
      state.user = JSON.parse(saved);
      if (!state.user.nama || state.user.nama.trim() === '') {
        state.user.nama = 'Teman Belajar';
      }
      if (!state.user.sekolah || state.user.sekolah.trim() === '') {
        state.user.sekolah = 'SD Merdeka';
      }
      if (!state.user.avatar || !AVATAR_LIST.some(a => a.id === state.user.avatar)) {
        state.user.avatar = 'kucing';
      }
      if (typeof state.user.kelasLocked === 'undefined') {
        state.user.kelasLocked = true;
      }
      if (typeof state.user.quizStreakCount === 'undefined') {
        state.user.quizStreakCount = 0;
      }
      state.selectedKelas = state.user.kelas || 1;
      updateFaseByKelas(state.selectedKelas);
    } else {
      state.user = {
        id: 'USR-' + Date.now().toString(36),
        nama: 'Teman Belajar',
        sekolah: 'SD Merdeka',
        avatar: 'kucing',
        kelas: 1,
        kelasLocked: true,
        quizStreakCount: 0,
        totalPoin: 0,
        level: 1,
        streak: 1,
        lastActiveDate: getLocalDateString(),
        activeDates: [getLocalDateString()],
        badgesEarned: ['quiz_pertama'],
        isGuest: true
      };
    }
  } catch (e) {
    console.error(e);
  }
}

function saveUserData() {
  if (state.user) {
    if (typeof state.user.kelasLocked === 'undefined') {
      state.user.kelasLocked = true;
    }
    localStorage.setItem(APP_STORAGE_KEYS.PROFILE, JSON.stringify(state.user));
    renderProfileHeader();
    updateDashboardStats();
    renderFaseAndGradeCards();
  }
}

function loadCustomQuizzes() {
  try {
    state.allQuizzes = JSON.parse(JSON.stringify(DEFAULT_QUIZ_PACKAGES));
    const raw = localStorage.getItem(APP_STORAGE_KEYS.CUSTOM_QUIZ);
    if (!raw) return;

    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      parsed.forEach(item => {
        const exist = state.allQuizzes.find(p => p.id === item.id);
        if (!exist) {
          state.allQuizzes.push(item);
        }
      });
    } else if (parsed && typeof parsed === 'object') {
      if (Array.isArray(parsed.customPackages)) {
        parsed.customPackages.forEach(pkg => {
          const exist = state.allQuizzes.find(p => p.id === pkg.id);
          if (!exist) {
            state.allQuizzes.push(pkg);
          }
        });
      }
      if (Array.isArray(parsed.customAdditions)) {
        parsed.customAdditions.forEach(add => {
          const target = state.allQuizzes.find(p => p.id === add.targetPackageId);
          if (target && Array.isArray(add.soalList)) {
            add.soalList.forEach(q => {
              if (!target.soal.some(existingQ => existingQ.id === q.id)) {
                target.soal.push(q);
              }
            });
          }
        });
      }
    }
  } catch (e) {
    console.error('Gagal memuat kuis kustom:', e);
    state.allQuizzes = JSON.parse(JSON.stringify(DEFAULT_QUIZ_PACKAGES));
  }
}

function loadResultsHistory() {
  try {
    const saved = localStorage.getItem(APP_STORAGE_KEYS.RESULTS);
    state.resultsHistory = saved ? JSON.parse(saved) : [];
  } catch (e) {
    state.resultsHistory = [];
  }
}

function saveResultsHistory(result) {
  state.resultsHistory.unshift(result);
  localStorage.setItem(APP_STORAGE_KEYS.RESULTS, JSON.stringify(state.resultsHistory));
}

/**
 * Filter riwayat belajar khusus milik siswa yang sedang aktif
 * agar data nilai dan kuis tidak tercampur antar siswa
 */
function getUserResultsHistory() {
  if (!state.user) return [];
  const currentId = state.user.id;
  const currentName = (state.user.nama || '').toLowerCase().trim();

  return state.resultsHistory.filter(r => {
    if (r.userId && currentId && r.userId === currentId) return true;
    if (r.playerName && currentName && r.playerName.toLowerCase().trim() === currentName) return true;
    return false;
  });
}

function loadLeaderboard() {
  try {
    const saved = localStorage.getItem(APP_STORAGE_KEYS.LEADERBOARD);
    if (saved) {
      const parsed = JSON.parse(saved);
      // Validate if parsed has mapelId format (v1.5 format) and sekolah property (v1.6 format)
      if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].mapelId && parsed[0].sekolah) {
        state.leaderboardData = parsed;
      } else {
        state.leaderboardData = [...INITIAL_LEADERBOARD];
        localStorage.setItem(APP_STORAGE_KEYS.LEADERBOARD, JSON.stringify(state.leaderboardData));
      }
    } else {
      state.leaderboardData = [...INITIAL_LEADERBOARD];
    }
  } catch (e) {
    state.leaderboardData = [...INITIAL_LEADERBOARD];
  }
}

function syncUserToLeaderboard(mapelId = null, mapelNama = null, addedPoin = 0) {
  if (!state.user || !state.user.nama) return;

  if (mapelId) {
    const existingIdx = state.leaderboardData.findIndex(item => 
      item.nama.toLowerCase() === state.user.nama.toLowerCase() &&
      item.kelas === state.user.kelas &&
      item.mapelId === mapelId
    );

    if (existingIdx >= 0) {
      state.leaderboardData[existingIdx].totalPoin += (addedPoin || 0);
      state.leaderboardData[existingIdx].streak = state.user.streak || 1;
      state.leaderboardData[existingIdx].avatar = state.user.avatar;
      state.leaderboardData[existingIdx].sekolah = state.user.sekolah || 'SD Merdeka';
    } else {
      state.leaderboardData.push({
        id: 'lb-u-' + Date.now().toString(36),
        nama: state.user.nama,
        avatar: state.user.avatar,
        kelas: state.user.kelas,
        sekolah: state.user.sekolah || 'SD Merdeka',
        mapelId: mapelId,
        mapelNama: mapelNama || 'Mata Pelajaran',
        totalPoin: addedPoin || 10,
        streak: state.user.streak || 1
      });
    }
  } else {
    state.leaderboardData.forEach(item => {
      if (item.nama.toLowerCase() === state.user.nama.toLowerCase()) {
        item.avatar = state.user.avatar;
        item.kelas = state.user.kelas;
        item.streak = state.user.streak;
        item.sekolah = state.user.sekolah || 'SD Merdeka';
      }
    });
  }

  localStorage.setItem(APP_STORAGE_KEYS.LEADERBOARD, JSON.stringify(state.leaderboardData));
}

// ==========================================================================
// 4B. DUAL-ROLE GATING & ROLE ISOLATION (MODE SISWA VS MODE GURU)
// ==========================================================================
function loadUserRole() {
  try {
    const saved = localStorage.getItem(APP_STORAGE_KEYS.ROLE);
    if (saved === 'teacher' || saved === 'student') {
      state.currentRole = saved;
    } else {
      state.currentRole = null;
    }
  } catch (e) {
    state.currentRole = 'student';
  }
}

function openRoleSelectorModal(canClose = true) {
  playTone('click');
  const modal = document.getElementById('modal-role-selector');
  const closeBtn = document.getElementById('btn-close-role-selector');
  if (closeBtn) {
    closeBtn.style.display = canClose ? 'block' : 'none';
  }
  if (modal) modal.classList.add('show');
}

function closeRoleSelectorModal() {
  const modal = document.getElementById('modal-role-selector');
  if (modal) modal.classList.remove('show');
}

function applyUserRole(role) {
  playTone('click');
  if (role === 'teacher') {
    closeRoleSelectorModal();
    // Prompt PIN Gate before giving teacher access
    openTeacherGate();
  } else {
    finalizeRoleSwitch('student', true);
  }
}

function finalizeRoleSwitch(role, showToastMsg = true) {
  state.currentRole = role;
  try {
    localStorage.setItem(APP_STORAGE_KEYS.ROLE, role);
  } catch (e) {}

  closeRoleSelectorModal();

  const gateModal = document.getElementById('modal-teacher-gate');
  if (gateModal) gateModal.classList.remove('show');

  const badgeIcon = document.getElementById('role-badge-icon');
  const badgeText = document.getElementById('role-badge-text');
  const navTeacherBtn = document.getElementById('nav-teacher-btn');
  const mobTeacherBtn = document.getElementById('mobile-nav-teacher-btn');
  const mobTeacherIcon = document.getElementById('mobile-nav-teacher-icon');
  const mobTeacherText = document.getElementById('mobile-nav-teacher-text');
  const teacherBanner = document.getElementById('teacher-mode-banner');
  const greetingEl = document.getElementById('hero-greeting-name');
  const goldBanner = document.getElementById('golden-challenge-banner');
  const promoBtn = document.getElementById('btn-hero-promotion');
  const settingsRoleLabel = document.getElementById('settings-current-role-label');

  if (role === 'teacher') {
    if (badgeIcon) badgeIcon.textContent = '👨‍🏫';
    if (badgeText) badgeText.textContent = 'Mode Guru';
    if (settingsRoleLabel) settingsRoleLabel.textContent = '👨‍🏫 Mode Guru (Pendidik)';
    if (navTeacherBtn) {
      navTeacherBtn.style.display = 'inline-flex';
      navTeacherBtn.textContent = '📚 Studio Guru';
      navTeacherBtn.title = 'Buka Studio Guru';
    }
    if (mobTeacherBtn) {
      mobTeacherBtn.style.display = 'flex';
    }
    if (mobTeacherIcon) mobTeacherIcon.textContent = '📚';
    if (mobTeacherText) mobTeacherText.textContent = 'Studio';
    if (teacherBanner) teacherBanner.style.display = 'flex';
    if (greetingEl) greetingEl.textContent = 'Halo, Bapak/Ibu Guru! 👨‍🏫';
    if (goldBanner) goldBanner.style.display = 'none';
    if (promoBtn) promoBtn.style.display = 'none';

    // If currently inside quiz arena, redirect to dashboard
    const quizArena = document.getElementById('view-quiz-arena');
    if (quizArena && quizArena.classList.contains('active')) {
      switchPage('view-dashboard');
    }

    if (showToastMsg) {
      showToast('👨‍🏫 Mode Guru Aktif. Arena bermain kuis dikunci untuk menjaga integritas data siswa.');
    }
  } else {
    if (badgeIcon) badgeIcon.textContent = '🎒';
    if (badgeText) badgeText.textContent = 'Mode Anak';
    if (settingsRoleLabel) settingsRoleLabel.textContent = '🎒 Mode Siswa (Anak)';

    // In Student Mode: Completely HIDE Teacher Mode from dashboard & navigation
    if (navTeacherBtn) {
      navTeacherBtn.style.display = 'none';
    }
    if (mobTeacherBtn) {
      mobTeacherBtn.style.display = 'none';
    }
    if (teacherBanner) teacherBanner.style.display = 'none';
    if (greetingEl) greetingEl.textContent = `Halo, ${state.user ? state.user.nama : 'Bintang Pelajar'}! 👋`;

    if (showToastMsg) {
      showToast('🎒 Mode Siswa Aktif. Selamat belajar dan bermain kuis!');
    }
  }

  // Refresh topic cards and grid so buttons reflect the mode (Play vs Preview)
  renderSubjectsGrid();
  updateDashboardStats();
}

function handleTeacherNavClick() {
  if (state.currentRole === 'teacher') {
    openTeacherModal();
  } else {
    openTeacherGate();
  }
}

function openTeacherModal() {
  playTone('click');
  renderTeacherCustomQuestionsList();
  const teacherModal = document.getElementById('modal-teacher');
  if (teacherModal) teacherModal.classList.add('show');
}

function openTeacherPreviewModal(quizId) {
  playTone('click');
  let quizPkg = state.allQuizzes.find(q => q.id === quizId);
  if (!quizPkg) {
    const curFaseObj = KURIKULUM_STRUCTURE[state.activeFase] || KURIKULUM_STRUCTURE.faseA;
    const mapel = curFaseObj.mapel.find(m => quizId && quizId.includes(m.id)) || curFaseObj.mapel[0];
    quizPkg = {
      id: quizId,
      kelas: state.selectedKelas,
      mapelNama: mapel.nama,
      judulMateri: `Materi Pokok ${mapel.nama} Kelas ${state.selectedKelas}`,
      soal: generateFallbackQuestions(mapel, state.selectedKelas)
    };
  }

  state.previewQuizPackage = quizPkg;

  const titleEl = document.getElementById('teacher-preview-title');
  const descEl = document.getElementById('teacher-preview-desc');
  const contentEl = document.getElementById('teacher-preview-content');
  const modal = document.getElementById('modal-teacher-preview');

  if (titleEl) {
    titleEl.textContent = `${quizPkg.mapelNama} — ${quizPkg.judulMateri} (Kelas ${quizPkg.kelas})`;
  }
  if (descEl) {
    descEl.textContent = `Total ${quizPkg.soal ? quizPkg.soal.length : 0} butir soal Kurikulum Merdeka. Kunci jawaban ditandai hijau dengan ikon centang ✓.`;
  }

  if (contentEl) {
    contentEl.innerHTML = '';
    const soalList = quizPkg.soal || [];
    if (soalList.length === 0) {
      contentEl.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 2rem;">Belum ada butir soal dalam paket ini.</p>';
    } else {
      soalList.forEach((q, idx) => {
        const card = document.createElement('div');
        card.className = 'teacher-preview-card';

        let optionsHtml = '';
        const choices = q.pilihan || [];
        const optLabels = ['A', 'B', 'C', 'D'];
        choices.forEach((optText, optIdx) => {
          const isCorrect = (optIdx === q.jawabanBenar);
          optionsHtml += `
            <div class="teacher-preview-option ${isCorrect ? 'correct' : ''}">
              <span><strong>${optLabels[optIdx]}.</strong> ${cleanChoiceText(optText)}</span>
              ${isCorrect ? '<span>✓ Kunci Jawaban</span>' : ''}
            </div>
          `;
        });

        card.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
            <span class="topic-badge-pill" style="background: var(--primary-light); color: var(--primary); font-size: 0.75rem; font-weight: 700;">Butir Soal #${idx + 1}</span>
            <span style="font-size: 0.78rem; color: var(--text-muted);">Tingkat: ${q.kesulitan || 'Standar'}</span>
          </div>
          <div style="font-size: 0.95rem; font-weight: 600; color: var(--text-main); margin-bottom: 0.75rem; line-height: 1.45;">
            ${q.pertanyaan}
          </div>
          <div style="margin-bottom: 0.5rem;">
            ${optionsHtml}
          </div>
          ${q.pembahasan ? `
            <div class="teacher-preview-explanation">
              <strong>💡 Pembahasan / Kunci Logika:</strong> ${q.pembahasan}
            </div>
          ` : ''}
        `;
        contentEl.appendChild(card);
      });
    }
  }

  if (modal) modal.classList.add('show');
}

function openTeacherEditForCurrentPackage() {
  const previewModal = document.getElementById('modal-teacher-preview');
  if (previewModal) previewModal.classList.remove('show');

  openTeacherModal();

  if (state.previewQuizPackage) {
    const pkg = state.previewQuizPackage;
    const mapelSelect = document.getElementById('teacher-mapel');
    const kelasSelect = document.getElementById('teacher-kelas');
    const materiInput = document.getElementById('teacher-materi');
    if (mapelSelect && pkg.mapelId) mapelSelect.value = pkg.mapelId;
    if (kelasSelect && pkg.kelas) kelasSelect.value = pkg.kelas;
    if (materiInput && pkg.judulMateri) materiInput.value = pkg.judulMateri;
  }
}

// ==========================================================================
// 5. NAVIGATION & VIEW SWITCHER
// ==========================================================================
function switchPage(pageId) {
  playTone('click');
  stopSpeech();

  // Guard: Teacher mode cannot enter quiz arena
  if (pageId === 'view-quiz-arena' && state.currentRole === 'teacher') {
    showToast('👨‍🏫 Mode Guru Aktif: Arena kuis dikunci untuk pendidik.');
    switchPage('view-dashboard');
    return;
  }

  // Hide all views
  document.querySelectorAll('.page-view').forEach(view => {
    view.classList.remove('active');
  });

  const targetView = document.getElementById(pageId);
  if (targetView) {
    targetView.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Update active states on nav items
  document.querySelectorAll('.nav-link, .mobile-nav-item').forEach(el => {
    if (el.dataset.page === pageId) {
      el.classList.add('active');
    } else {
      el.classList.remove('active');
    }
  });

  // Page specific hooks
  if (pageId === 'view-dashboard') {
    renderSubjectsGrid();
    updateDashboardStats();
  } else if (pageId === 'view-leaderboard') {
    updateLeaderboardMapelOptions();
    renderLeaderboardView();
  } else if (pageId === 'view-history') {
    renderHistoryView();
  } else if (pageId === 'view-stats') {
    renderAnalyticsView();
  }
}

function setupNavigation() {
  document.querySelectorAll('[data-page]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const pageId = el.dataset.page;
      switchPage(pageId);
    });
  });

  const brand = document.getElementById('btn-home-brand');
  if (brand) {
    brand.addEventListener('click', () => switchPage('view-dashboard'));
  }
}

// ==========================================================================
// 6. PROFILE & ONBOARDING
// ==========================================================================
function getAvatarObject(avatarId) {
  if (!avatarId) return AVATAR_LIST[0];
  const found = AVATAR_LIST.find(a => a.id === avatarId || a.emoji === avatarId);
  return found || AVATAR_LIST[0];
}

function renderProfileHeader() {
  if (!state.user) return;
  const av = getAvatarObject(state.user.avatar);
  const avatarMini = document.getElementById('user-avatar-mini');
  const nameMini = document.getElementById('user-name-mini');
  const xpMini = document.getElementById('user-xp-mini');
  const streakTag = document.getElementById('user-streak-tag');
  const schoolTag = document.getElementById('user-school-tag');

  if (avatarMini) avatarMini.textContent = av.emoji;
  if (nameMini) nameMini.textContent = state.user.nama || 'Pemain Baru';
  if (xpMini) xpMini.textContent = `⭐ ${state.user.totalPoin} Poin`;
  if (streakTag) streakTag.textContent = `🔥 ${state.user.streak} Hari`;
  if (schoolTag) schoolTag.textContent = `🏫 ${state.user.sekolah || 'SD Merdeka'}`;

  const heroGreeting = document.getElementById('hero-greeting-name');
  if (heroGreeting) {
    heroGreeting.textContent = state.user.nama ? `Halo, ${state.user.nama}! 👋` : 'Halo, Bintang Pelajar! 👋';
  }
}

// ==========================================================================
// 6. PROFILE, PROGRESS & LEVEL LADDER
// ==========================================================================
const LEVEL_TIERS = [
  { level: 1, title: 'Level 1: Pemula 🌱', minXp: 0, maxXp: 200, reward: 'Avatar Hewan Ceria' },
  { level: 2, title: 'Level 2: Penjelajah 🚀', minXp: 200, maxXp: 500, reward: 'Lencana Penjelajah Tangguh' },
  { level: 3, title: 'Level 3: Hebat Mantap 🌟', minXp: 500, maxXp: 1000, reward: 'Avatar Rubah Cerdas 🦊 & Burung Hantu 🦉' },
  { level: 4, title: 'Level 4: Juara Belajar 🏆', minXp: 1000, maxXp: 1500, reward: 'Lencana Bintang Juara Belajar' },
  { level: 5, title: 'Level 5: Satria Pelajar 🏅', minXp: 1500, maxXp: 2000, reward: 'Avatar Singa Emas 🦁, Elang Perkasa 🦅 & Tiket Ujian Kenaikan Kelas 🎓' },
  { level: 6, title: 'Level 6: Pakar Ilmu 💡', minXp: 2000, maxXp: 2500, reward: 'Gelar Cendekiawan Cilik' },
  { level: 7, title: 'Level 7: Master Cerdas 👑', minXp: 2500, maxXp: 3000, reward: 'Mahkota Kehormatan Master' },
  { level: 8, title: 'Level 8: Pujangga Unggul 💎', minXp: 3000, maxXp: 4000, reward: 'Avatar Harimau 🐯 & Lumba-Lumba 🐬' },
  { level: 9, title: 'Level 9: Bintang Prestasi 🪐', minXp: 4000, maxXp: 5000, reward: 'Bintang Galaksi Prestasi' },
  { level: 10, title: 'Level 10: Mahaguru Cilik 🥇', minXp: 5000, maxXp: 99999, reward: 'Avatar Legendaris Naga Mahaguru 🐉' }
];

function getLevelTier(pts) {
  for (let i = LEVEL_TIERS.length - 1; i >= 0; i--) {
    if (pts >= LEVEL_TIERS[i].minXp) {
      return LEVEL_TIERS[i];
    }
  }
  return LEVEL_TIERS[0];
}

function updateDashboardStats() {
  if (!state.user) return;
  const userResults = getUserResultsHistory();
  const countQuizzes = userResults.length;
  const totalScore = userResults.reduce((acc, r) => acc + (r.skor || 0), 0);
  const avgScore = countQuizzes > 0 ? Math.round(totalScore / countQuizzes) : 0;

  const statQuizEl = document.getElementById('stat-total-quiz');
  const statPoinEl = document.getElementById('stat-total-poin');
  const statAvgEl = document.getElementById('stat-avg-skor');
  const statBadgeEl = document.getElementById('stat-total-badge');

  if (statQuizEl) statQuizEl.textContent = countQuizzes;
  if (statPoinEl) statPoinEl.textContent = state.user.totalPoin || 0;
  if (statAvgEl) statAvgEl.textContent = countQuizzes > 0 ? `${avgScore}` : '-';
  if (statBadgeEl) statBadgeEl.textContent = `${state.user.badgesEarned ? state.user.badgesEarned.length : 1} Lencana`;

  // Calculate Level based on points (10 Progression Tiers)
  const pts = state.user.totalPoin || 0;
  const oldLevel = state.user.level || 1;
  const currentTier = getLevelTier(pts);
  const currentLevel = currentTier.level;
  const levelTitle = currentTier.title;

  state.user.level = currentLevel;
  const levelBadge = document.getElementById('user-level-badge');
  if (levelBadge) levelBadge.textContent = levelTitle;

  // Level XP Progress Bar Widget
  const nextTier = LEVEL_TIERS.find(t => t.level === currentLevel + 1);
  const xpCurrentTitle = document.getElementById('xp-current-level-title');
  const xpPointsRatio = document.getElementById('xp-points-ratio');
  const xpProgressFill = document.getElementById('xp-progress-bar-fill');
  const xpRemainingText = document.getElementById('xp-remaining-text');
  const xpNextTitle = document.getElementById('xp-next-level-title');

  if (xpCurrentTitle) xpCurrentTitle.textContent = currentTier.title;

  if (nextTier) {
    const range = nextTier.minXp - currentTier.minXp;
    const progressInTier = Math.max(0, pts - currentTier.minXp);
    const pct = Math.min(100, Math.round((progressInTier / range) * 100));
    const remaining = Math.max(0, nextTier.minXp - pts);

    if (xpPointsRatio) xpPointsRatio.textContent = `${pts} / ${nextTier.minXp} XP`;
    if (xpProgressFill) xpProgressFill.style.width = `${pct}%`;
    if (xpRemainingText) xpRemainingText.textContent = `Sisa ${remaining} XP lagi menuju Level ${nextTier.level}`;
    if (xpNextTitle) xpNextTitle.textContent = `Target: ${nextTier.title}`;
  } else {
    if (xpPointsRatio) xpPointsRatio.textContent = `${pts} XP (Maksimal)`;
    if (xpProgressFill) xpProgressFill.style.width = `100%`;
    if (xpRemainingText) xpRemainingText.textContent = `Tingkat Prestasi Tertinggi Mahaguru Cilik!`;
    if (xpNextTitle) xpNextTitle.textContent = `🏆 Legenda`;
  }

  // Award level and star collector badges if reached
  if (!state.user.badgesEarned) state.user.badgesEarned = [];
  if (currentLevel >= 5 && !state.user.badgesEarned.includes('level_5')) {
    state.user.badgesEarned.push('level_5');
    showToast('🏅 Keren! Kamu membuka Lencana: Satria Pelajar (Level 5)!');
  }
  if (currentLevel >= 10 && !state.user.badgesEarned.includes('level_10')) {
    state.user.badgesEarned.push('level_10');
    showToast('🥇 Spektakuler! Kamu membuka Lencana: Mahaguru Cilik (Level 10)!');
  }
  if (pts >= 2500 && !state.user.badgesEarned.includes('kolektor_bintang')) {
    state.user.badgesEarned.push('kolektor_bintang');
    showToast('🌟 Hebat! Kamu membuka Lencana: Kolektor Bintang (2.500 Poin)!');
  }

  // Enforce Role UI overrides on dashboard & navigation
  const teacherBanner = document.getElementById('teacher-mode-banner');
  const navTeacherBtn = document.getElementById('nav-teacher-btn');
  const mobTeacherBtn = document.getElementById('mobile-nav-teacher-btn');
  if (state.currentRole === 'teacher') {
    const greetingEl = document.getElementById('hero-greeting-name');
    if (greetingEl) greetingEl.textContent = 'Halo, Bapak/Ibu Guru! 👨‍🏫';
    const goldBanner = document.getElementById('golden-challenge-banner');
    if (goldBanner) goldBanner.style.display = 'none';
    const promoBtn = document.getElementById('btn-hero-promotion');
    if (promoBtn) promoBtn.style.display = 'none';
    if (teacherBanner) teacherBanner.style.display = 'flex';
    if (navTeacherBtn) navTeacherBtn.style.display = 'inline-flex';
    if (mobTeacherBtn) mobTeacherBtn.style.display = 'flex';
  } else {
    if (teacherBanner) teacherBanner.style.display = 'none';
    if (navTeacherBtn) navTeacherBtn.style.display = 'none';
    if (mobTeacherBtn) mobTeacherBtn.style.display = 'none';
  }

  // Check if leveled up from a previous level
  if (currentLevel > oldLevel) {
    triggerLevelUpCelebration(oldLevel, currentLevel);
  }
}

function triggerLevelUpCelebration(oldLevel, newLevel) {
  const tier = LEVEL_TIERS.find(t => t.level === newLevel) || LEVEL_TIERS[LEVEL_TIERS.length - 1];
  const modal = document.getElementById('modal-level-up');
  const title = document.getElementById('levelup-title');
  const desc = document.getElementById('levelup-desc');
  const rewardItems = document.getElementById('levelup-unlocked-items');

  if (title) title.textContent = `Selamat, Kamu Naik ke ${tier.title}! 🎉`;
  if (desc) desc.textContent = `Luar biasa! Akumulasi poinmu telah membawamu naik kelas prestasi dari Level ${oldLevel} ke Level ${newLevel}.`;
  if (rewardItems) rewardItems.textContent = `🎁 Hadiah: ${tier.reward}`;

  if (modal) modal.classList.add('show');
  playTone('fanfare');
  launchConfetti();
}

function openProfileModal(isForced = false) {
  const modal = document.getElementById('modal-profile');
  const inputNama = document.getElementById('input-player-name');
  const selectKelas = document.getElementById('select-player-grade');
  const avatarGrid = document.getElementById('avatar-grid');
  const btnClose = document.getElementById('btn-close-profile');
  const lockedNote = document.getElementById('profile-grade-locked-note');

  if (btnClose) {
    btnClose.style.display = 'flex';
  }

  const userLevel = (state.user && state.user.level) ? state.user.level : 1;

  // Populate avatars with level lock indicator
  avatarGrid.innerHTML = '';
  AVATAR_LIST.forEach(av => {
    const btn = document.createElement('button');
    btn.type = 'button';
    const req = av.reqLevel || 1;
    const isLocked = userLevel < req;

    btn.className = `avatar-opt-btn ${state.user && state.user.avatar === av.id ? 'selected' : ''} ${isLocked ? 'locked' : ''}`;
    if (isLocked) {
      btn.setAttribute('data-req-title', `Lvl ${req}`);
    }

    btn.innerHTML = `<span class="emoji">${av.emoji}</span><span class="name">${av.name}</span>`;
    btn.onclick = () => {
      if (isLocked) {
        showToast(`🔒 Avatar ${av.name} terbuka saat kamu mencapai Level ${req}!`);
        playTone('wrong');
        return;
      }
      document.querySelectorAll('.avatar-opt-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      if (state.user) state.user.avatar = av.id;
      playTone('click');
    };
    avatarGrid.appendChild(btn);
  });

  const inputSekolah = document.getElementById('input-player-school');
  if (inputNama) inputNama.value = state.user ? state.user.nama : 'Teman Belajar';
  if (inputSekolah) inputSekolah.value = (state.user && state.user.sekolah) ? state.user.sekolah : '';
  if (selectKelas) {
    selectKelas.value = state.user ? state.user.kelas : 1;
    if (state.user && state.user.kelasLocked) {
      selectKelas.disabled = true;
      selectKelas.title = 'Kelas terkunci. Naik kelas melalui Ujian Kenaikan Kelas atau Mode Orang Tua.';
      if (lockedNote) lockedNote.style.display = 'block';
    } else {
      selectKelas.disabled = false;
      if (lockedNote) lockedNote.style.display = 'none';
    }
  }

  validateProfileInput();
  modal.classList.add('show');
}

function validateProfileInput() {
  const inputNama = document.getElementById('input-player-name');
  const btnSave = document.getElementById('btn-save-profile');
  const warningMsg = document.getElementById('profile-name-warning');

  const val = inputNama ? inputNama.value.trim() : '';
  if (btnSave) btnSave.disabled = false;
  if (warningMsg) {
    if (val.length === 0) {
      warningMsg.style.display = 'none';
    } else if (val.length < 2) {
      warningMsg.style.display = 'block';
      warningMsg.textContent = 'Yuk isi namamu minimal 2 huruf, atau simpan sebagai Teman Belajar.';
    } else {
      warningMsg.style.display = 'none';
    }
  }
}

// ==========================================================================
// 7. CLASS & PHASE SELECTION (WITH CLASS LOCK & PROMOTION)
// ==========================================================================
function updateFaseByKelas(grade) {
  if (grade <= 2) {
    state.activeFase = 'faseA';
  } else if (grade <= 4) {
    state.activeFase = 'faseB';
  } else {
    state.activeFase = 'faseC';
  }
}

function setupClassSelection() {
  // Phase cards click
  document.querySelectorAll('.fase-card').forEach(card => {
    card.addEventListener('click', () => {
      const faseKey = card.dataset.fase;
      const userGrade = (state.user && state.user.kelas) ? state.user.kelas : state.selectedKelas;
      const userFase = userGrade <= 2 ? 'faseA' : (userGrade <= 4 ? 'faseB' : 'faseC');

      if (state.user && state.user.kelasLocked && faseKey !== userFase) {
        const targetSampleGrade = faseKey === 'faseA' ? 1 : (faseKey === 'faseB' ? 3 : 5);
        openLockedClassModal(targetSampleGrade);
        return;
      }

      state.activeFase = faseKey;
      state.selectedKelas = userGrade;

      renderFaseAndGradeCards();
      renderSubjectsGrid();
      playTone('click');
    });
  });

  // Grade chips click
  document.querySelectorAll('.class-chip-btn').forEach(chip => {
    chip.addEventListener('click', () => {
      const grade = parseInt(chip.dataset.grade, 10);
      const userGrade = (state.user && state.user.kelas) ? state.user.kelas : 1;

      if (state.user && state.user.kelasLocked && grade !== userGrade) {
        openLockedClassModal(grade);
        return;
      }

      state.selectedKelas = grade;
      updateFaseByKelas(grade);

      renderFaseAndGradeCards();
      renderSubjectsGrid();
      playTone('click');
    });
  });
}

function renderFaseAndGradeCards() {
  const userGrade = (state.user && state.user.kelas) ? state.user.kelas : state.selectedKelas;

  // Highlight active fase
  document.querySelectorAll('.fase-card').forEach(card => {
    if (card.dataset.fase === state.activeFase) {
      card.classList.add('selected');
    } else {
      card.classList.remove('selected');
    }
  });

  // Highlight active grade chip & lock chips for other grades
  document.querySelectorAll('.class-chip-btn').forEach(chip => {
    const grade = parseInt(chip.dataset.grade, 10);
    if (grade === state.selectedKelas) {
      chip.classList.add('active');
    } else {
      chip.classList.remove('active');
    }

    if (state.user && state.user.kelasLocked && grade !== userGrade) {
      chip.classList.add('locked');
      chip.title = `Kelas ${grade} Terkunci (Kamu terdaftar di Kelas ${userGrade})`;
    } else {
      chip.classList.remove('locked');
      chip.title = `Kelas ${grade}`;
    }
  });

  const gradeHeaderLabel = document.getElementById('active-grade-label');
  if (gradeHeaderLabel) {
    gradeHeaderLabel.textContent = `Mata Pelajaran Kelas ${state.selectedKelas} (${KURIKULUM_STRUCTURE[state.activeFase].nama})`;
  }

  // Update locked class tag on dashboard hero
  const lockedTag = document.getElementById('user-locked-class-tag');
  if (lockedTag) {
    lockedTag.textContent = `🔒 Kelas ${userGrade} (Terkunci)`;
  }

  // Promotion Exam button & banner visibility (Level >= 5 and grade < 6)
  const isEligiblePromotion = (state.user && (state.user.level || 1) >= 5 && userGrade < 6);
  const btnHeroPromotion = document.getElementById('btn-hero-promotion');
  const bannerPromotion = document.getElementById('promotion-exam-banner');
  const promoTitle = document.getElementById('promotion-banner-title');

  if (btnHeroPromotion) {
    btnHeroPromotion.style.display = isEligiblePromotion ? 'block' : 'none';
  }
  if (bannerPromotion) {
    bannerPromotion.style.display = isEligiblePromotion ? 'flex' : 'none';
    if (promoTitle) {
      promoTitle.textContent = `Siap Naik ke Kelas ${userGrade + 1}? 🎓`;
    }
  }

  // Golden Quiz Challenge banner visibility (quizStreakCount >= 3)
  const bannerGolden = document.getElementById('golden-challenge-banner');
  if (bannerGolden) {
    bannerGolden.style.display = (state.user && (state.user.quizStreakCount || 0) >= 3) ? 'flex' : 'none';
  }
}

// ==========================================================================
// 8. SUBJECTS & TOPICS CATALOG
// ==========================================================================
function renderSubjectsGrid() {
  const container = document.getElementById('subjects-container');
  if (!container) return;

  const currentFaseObj = KURIKULUM_STRUCTURE[state.activeFase];
  const mapelList = currentFaseObj.mapel;

  container.innerHTML = '';
  mapelList.forEach(mapel => {
    const card = document.createElement('div');
    card.className = 'subject-card';
    card.onclick = () => openTopicListModal(mapel);

    // Count available quizzes for this subject and grade
    const available = state.allQuizzes.filter(q => q.kelas === state.selectedKelas && q.mapelId === mapel.id).length;

    card.innerHTML = `
      <div class="subject-icon-box" style="background: ${mapel.warna}18; color: ${mapel.warna}">
        ${mapel.icon}
      </div>
      <div class="subject-name">${mapel.nama}</div>
      <div class="subject-count">${available > 0 ? `${available} Materi Siap` : 'Tersedia Latihan'}</div>
    `;
    container.appendChild(card);
  });
}

function startQuickQuiz() {
  if (state.currentRole === 'teacher') {
    showToast('Mode Guru Aktif: Kuis cepat khusus untuk akun siswa.');
    return;
  }
  playTone('click');
  const currentFaseObj = KURIKULUM_STRUCTURE[state.activeFase] || KURIKULUM_STRUCTURE.faseA;
  const targetMapel = currentFaseObj.mapel.find(m => m.id === 'matematika') || currentFaseObj.mapel[0];
  openTopicListModal(targetMapel);
}

function openTopicListModal(mapel) {
  playTone('click');
  const modal = document.getElementById('modal-topics');
  const title = document.getElementById('topics-modal-title');
  const listContainer = document.getElementById('topics-list-container');

  title.innerHTML = `${mapel.icon} ${mapel.nama} (Kelas ${state.selectedKelas})`;
  listContainer.innerHTML = '';

  // Filter quizzes matching current class and subject
  let matchedQuizzes = state.allQuizzes.filter(q => q.kelas === state.selectedKelas && q.mapelId === mapel.id);

  // If no specific quiz exists for this subject yet, offer default fallback or auto-generate
  if (matchedQuizzes.length === 0) {
    const autoPkg = {
      id: `auto-${mapel.id}-k${state.selectedKelas}`,
      kelas: state.selectedKelas,
      fase: state.activeFase,
      mapelId: mapel.id,
      mapelNama: mapel.nama,
      judulMateri: `Materi Pokok ${mapel.nama} Kelas ${state.selectedKelas}`,
      deskripsi: `Latihan pemahaman konsep capaian pembelajaran ${mapel.nama} Kurikulum Merdeka untuk Kelas ${state.selectedKelas} SD.`,
      soal: generateFallbackQuestions(mapel, state.selectedKelas)
    };
    state.allQuizzes.push(autoPkg);
    matchedQuizzes = [autoPkg];
  }

  matchedQuizzes.forEach(quizPkg => {
    const item = document.createElement('div');
    item.className = 'topic-card';

    // Find best past score for active user
    const pastResults = getUserResultsHistory().filter(r => r.materiJudul === quizPkg.judulMateri);
    const bestScore = pastResults.length > 0 ? Math.max(...pastResults.map(r => r.skor)) : null;

    item.innerHTML = `
      <div class="topic-info">
        <h4>${quizPkg.judulMateri}</h4>
        <p>${quizPkg.deskripsi}</p>
        <div class="topic-meta">
          <span class="topic-badge-pill" style="background: #E0E7FF; color: #4338CA;">Bank ${quizPkg.soal ? quizPkg.soal.length : 10} Soal (10 Soal Berurutan)</span>
          ${bestScore !== null ? `<span class="topic-badge-pill" style="background: #D1FAE5; color: #065F46;">Skor Terbaik: ${bestScore} ⭐</span>` : '<span class="topic-badge-pill" style="background: #FEF3C7; color: #92400E;">Belum Dikerjakan</span>'}
        </div>
      </div>
      ${state.currentRole === 'teacher'
        ? `<button class="btn-play-topic" style="background: var(--secondary); color: white;" onclick="openTeacherPreviewModal('${quizPkg.id}')">👁️ Pratinjau Soal & Kunci</button>`
        : `<button class="btn-play-topic" onclick="startQuizSession('${quizPkg.id}')">Main Kuis 🎮</button>`
      }
    `;
    listContainer.appendChild(item);
  });

  modal.classList.add('show');
}

// Generate sensible educational fallback pool of 20 questions for any subject lacking static bundle
function generateFallbackQuestions(mapel, grade) {
  const list = [];
  const concepts = [
    { p: `Pemahaman capaian pembelajaran mata pelajaran ${mapel.nama} untuk kelas ${grade} SD. Manakah sikap belajar yang paling tepat dan bijak?`, c: `Mempelajari materi ${mapel.nama} dengan tertib, antusias, dan sungguh-sungguh`, w: [`Mengabaikan tugas sekolah dan bermain tanpa istirahat`, `Mencontek jawaban teman saat ulangan`, `Menyerah ketika menemui soal yang agak menantang`], b: `Belajar dengan tekun dan disiplin adalah sikap terpuji yang diajarkan pada mata pelajaran ${mapel.nama}.` },
    { p: `Saat berdiskusi kelompok tentang materi ${mapel.nama}, hal baik yang harus dilakukan adalah...`, c: `Mendengarkan pendapat teman dan saling menghargai`, w: [`Memaksakan kehendak sendiri`, `Mengejek teman yang belum paham`, `Bermain sendiri dan tidak ikut berdiskusi`], b: `Kerja sama dan saling menghormati pendapat mencerminkan profil pelajar yang bijaksana.` },
    { p: `Manfaat utama kita mempelajari ${mapel.nama} dalam kehidupan sehari-hari adalah...`, c: `Menambah wawasan dan membentuk budi pekerti yang baik`, w: [`Agar bisa pamer kepada teman lain`, `Hanya untuk mendapatkan nilai ujian`, `Supaya bisa menghukum teman yang salah`], b: `Ilmu yang dipelajari bermanfaat untuk diterapkan dalam kebaikan hidup sehari-hari.` },
    { p: `Jika menemukan materi ${mapel.nama} yang belum dipahami di kelas, tindakan terbaik adalah...`, c: `Bertanya dengan sopan kepada guru atau orang tua`, w: [`Menangis dan tidak mau masuk sekolah lagi`, `Menyembunyikan buku pelajaran`, `Menyalahkan teman sebangku`], b: `Bertanya kepada guru saat belum paham adalah langkah cerdas untuk menguasai ilmu.` },
    { p: `Sebelum memulai kegiatan belajar ${mapel.nama}, kita sebaiknya membiasakan diri untuk...`, c: `Berdoa dengan khusyuk memohon kelancaran ilmu`, w: [`Mengobrol keras di dalam kelas`, `Makan makanan ringan di meja guru`, `Bermain kejar-kejaran di lorong`], b: `Berdoa sebelum belajar membuka hati dan pikiran agar ilmu mudah diserap.` },
    { p: `Ketika tugas latihan ${mapel.nama} selesai dikerjakan, sikap cermat yang perlu dilakukan adalah...`, c: `Memeriksa kembali jawaban dengan teliti sebelum dikumpulkan`, w: [`Langsung keluar kelas tanpa izin`, `Merobek halaman buku latihan`, `Membuang pensil ke tempat sampah`], b: `Memeriksa ulang jawaban melatih ketelitian dan tanggung jawab diri.` },
    { p: `Nilai luhur yang dapat kita teladani dari kegiatan belajar ${mapel.nama} adalah...`, c: `Kejujuran, kemandirian, dan semangat pantang menyerah`, w: [`Kecurangan dan kemalasan`, `Sikap sombong dan egois`, `Menggantungkan tugas pada orang lain`], b: `Kejujuran dan kemandirian adalah kunci keberhasilan setiap pelajar cerdas.` },
    { p: `Bagaimana cara merawat buku panduan ${mapel.nama} agar tetap bersih dan awet?`, c: `Menyampulnya dengan rapi dan menyimpannya di tas sekolah`, w: [`Mencoret-coret lembaran dengan spidol sembarangan`, `Melipat dan meremas halaman buku`, `Membiarkannya basah terkena air`], b: `Menjaga kebersihan buku pelajaran mencerminkan rasa syukur dan kerapian.` },
    { p: `Sikap yang tepat saat teman sedang mempresentasikan tugas ${mapel.nama} di depan kelas adalah...`, c: `Menyimak dengan tenang dan memberikan tepuk tangan apresiasi`, w: [`Mengejek suaranya yang pelan`, `Tidur di atas meja`, `Menggambar sendiri tanpa memperhatikan`], b: `Menghargai presentasi teman adalah etika berkelas dalam lingkungan belajar.` },
    { p: `Mengapa disiplin waktu dalam mengumpulkan tugas ${mapel.nama} itu penting?`, c: `Melatih kita menjadi pribadi yang bertanggung jawab dan tepat janji`, w: [`Agar tidak ketinggalan bermain game online`, `Hanya agar disukai satu orang`, `Supaya buku tidak menjadi berat`], b: `Disiplin waktu membangun kebiasaan sukses sejak usia dini di sekolah dasar.` },
    { p: `Penerapan nilai Pancasila yang selaras dengan pembelajaran ${mapel.nama} di kelas adalah...`, c: `Bergotong royong menjaga kebersihan dan ketertiban ruang kelas`, w: [`Memilih-milih teman hanya yang kaya`, `Menolak berbagi alat tulis saat darurat`, `Mengotori dinding sekolah`], b: `Gotong royong adalah pengamalan sila Pancasila yang mempererat persaudaraan.` },
    { p: `Saat menghadapi asesmen atau ulangan ${mapel.nama}, hal terpenting yang harus dijaga adalah...`, c: `Integritas dan kejujuran dalam menjawab seluruh pertanyaan`, w: [`Kecepatan melirik lembar jawaban teman`, `Membawa contekan ke ruang kelas`, `Menebak acak tanpa membaca soal`], b: `Kejujuran nilai lebih mulia daripada sekadar angka tinggi hasil curang.` },
    { p: `Jika mendapatkan nilai yang belum maksimal pada pelajaran ${mapel.nama}, kita harus...`, c: `Melakukan refleksi diri, belajar lebih giat, dan tidak putus asa`, w: [`Menyalahkan guru yang memberi soal`, `Merobek hasil ulangan`, `Berhenti bersekolah`], b: `Kegagalan adalah tangga menuju keberhasilan bila disikapi dengan tekad kuat.` },
    { p: `Apa yang harus kita lakukan jika ada teman yang kesulitan memahami konsep ${mapel.nama}?`, c: `Membantunya menjelaskan dengan ramah dan sabar`, w: [`Menertawakannya di depan teman lain`, `Menjauhinya karena merasa lebih pintar`, `Mengabaikannya`], b: `Membantu teman belajar memperdalam pemahaman kita sendiri dan menumbuhkan kasih sayang.` },
    { p: `Alat tulis yang tepat untuk membuat catatan materi ${mapel.nama} dengan rapi adalah...`, c: `Buku catatan bergaris dan pulpen atau pensil yang nyaman`, w: [`Batu tulis dan kapur jalanan`, `Punggung tangan teman`, `Meja belajar kelas`], b: `Menggunakan buku catatan menjaga kerapian materi belajar agar mudah dipelajari ulang.` },
    { p: `Manfaat membuat rangkuman ringkas setelah selesai sesi pelajaran ${mapel.nama} adalah...`, c: `Mempermudah mengingat kembali poin-poin penting materi`, w: [`Menghabiskan tinta pulpen dengan cepat`, `Membuat buku menjadi kotor`, `Supaya terlihat sangat sibuk`], b: `Rangkuman membantu otak mengorganisasi informasi penting dengan efektif.` },
    { p: `Rasa ingin tahu yang positif dalam mempelajari ${mapel.nama} ditunjukkan dengan...`, c: `Gemar membaca referensi tambahan dan aktif mengeksplorasi ilmu`, w: [`Mencari tahu gosip pribadi teman`, `Membongkar barang sekolah tanpa izin`, `Mempertanyakan aturan dengan membantah`], b: `Rasa ingin tahu akademis mendorong tumbuhnya kecerdasan dan kreativitas.` },
    { p: `Ketika guru memberikan umpan balik (feedback) pada tugas ${mapel.nama}, sikap kita adalah...`, c: `Menerima dengan lapang dada dan memperbaiki kekurangannya`, w: [`Merasa tersinggung dan marah`, `Mengabaikan catatan guru`, `Membuang tugas tersebut`], b: `Umpan balik dari guru adalah hadiah terbaik untuk meningkatkan mutu diri kita.` },
    { p: `Mengapa kita perlu istirahat yang cukup setelah giat belajar materi ${mapel.nama}?`, c: `Agar otak dan tubuh kembali segar serta siap beraktivitas esok hari`, w: [`Supaya bisa begadang semalaman menonton televisi`, `Agar bisa melupakan semua pelajaran`, `Supaya tidak perlu bangun pagi`], b: `Istirahat yang cukup membantu konsolidasi memori otak secara optimal.` },
    { p: `Cita-cita mulia yang dapat kita capai dengan tekun menguasai ilmu ${mapel.nama} adalah...`, c: `Menjadi generasi penerus bangsa yang bermanfaat bagi masyarakat`, w: [`Menjadi orang sombong yang berkuasa sewenang-wenang`, `Mengumpulkan harta tanpa peduli orang lain`, `Mencari popularitas semata`], b: `Ilmu yang barokah adalah ilmu yang memberi kemaslahatan bagi keluarga, bangsa, dan dunia.` }
  ];

  concepts.forEach((item, idx) => {
    const rawOptions = [item.c, ...item.w];
    const targetIdx = idx % 4;
    const shuffledOptions = [...rawOptions];
    if (targetIdx !== 0) {
      const temp = shuffledOptions[0];
      shuffledOptions[0] = shuffledOptions[targetIdx];
      shuffledOptions[targetIdx] = temp;
    }
    list.push({
      id: `fb-${mapel.id}-${grade}-${idx + 1}`,
      pertanyaan: `Soal ${idx + 1}: ${item.p}`,
      pilihan: shuffledOptions,
      jawabanBenar: targetIdx,
      pembahasan: item.b,
      kesulitan: idx < 7 ? 'mudah' : (idx < 14 ? 'sedang' : 'tantangan')
    });
  });

  return list;
}

// ==========================================================================
// 9. QUIZ ARENA ENGINE (SINGLE QUESTION PER SCREEN)
// ==========================================================================

function getSeenQuestionIds(quizId) {
  try {
    const raw = localStorage.getItem(APP_STORAGE_KEYS.SEEN_QUESTIONS);
    if (!raw) return [];
    const obj = JSON.parse(raw);
    return Array.isArray(obj[quizId]) ? obj[quizId] : [];
  } catch (e) {
    return [];
  }
}

function saveSeenQuestionIds(quizId, newSeenIds) {
  try {
    let obj = {};
    const raw = localStorage.getItem(APP_STORAGE_KEYS.SEEN_QUESTIONS);
    if (raw) {
      try { obj = JSON.parse(raw); } catch (e) { obj = {}; }
    }
    obj[quizId] = newSeenIds;
    localStorage.setItem(APP_STORAGE_KEYS.SEEN_QUESTIONS, JSON.stringify(obj));
  } catch (e) {
    console.error('Gagal menyimpan seen questions', e);
  }
}

function fisherYatesShuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function cleanChoiceText(text) {
  if (typeof text !== 'string') return text;
  // Hanya bersihkan petunjuk kunci jawaban yang tidak disengaja tanpa merusak pecahan atau kurung matematika
  return text.replace(/\s*\((?:kunci(?:\s*jawaban)?|benar|jawaban\s*benar)\)/gi, '').trim();
}

/**
 * Smart Option & Answer Key Shuffler (Fisher-Yates)
 * Mengacak urutan 4 opsi jawaban secara dinamis pada setiap sesi kuis
 * dan memperbarui indeks `jawabanBenar` agar anak tidak dapat menebak pola pilihan jawaban.
 */
function shuffleQuestionOptions(q, forceDifferentPosition = false) {
  if (!q || !Array.isArray(q.pilihan) || q.pilihan.length <= 1) {
    return { ...q };
  }
  const originalCorrectRaw = q.pilihan[q.jawabanBenar];
  const cleanedCorrect = cleanChoiceText(originalCorrectRaw);

  let opts = q.pilihan.map(opt => cleanChoiceText(opt));
  let newCorrectIndex = -1;
  let attempts = 0;

  do {
    opts = fisherYatesShuffle(opts);
    newCorrectIndex = opts.indexOf(cleanedCorrect);
    attempts++;
  } while (forceDifferentPosition && opts.length > 1 && newCorrectIndex === q.jawabanBenar && attempts < 15);

  return {
    ...q,
    pilihan: opts,
    jawabanBenar: newCorrectIndex >= 0 ? newCorrectIndex : 0
  };
}

/**
 * Sequential Question Sampler with Dynamic Option Shuffling
 * Menyajikan 10 butir soal secara runtut dan teratur (Nomor 1 s.d. 10) sesuai paket materi.
 * Pilihan jawaban (A, B, C, D) diacak dinamis secara merata pada setiap sesi kuis.
 */
function sampleQuizQuestions(quizPkg, targetCount = 10) {
  if (!quizPkg || !Array.isArray(quizPkg.soal) || quizPkg.soal.length === 0) {
    return [];
  }

  const allQuestions = [...quizPkg.soal];
  const count = Math.min(targetCount, allQuestions.length);

  // Jika jumlah soal dalam paket <= targetCount, sajikan berurutan dengan opsi teracak
  if (allQuestions.length <= count) {
    return allQuestions.slice(0, count).map(q => shuffleQuestionOptions(q));
  }

  const quizId = quizPkg.id;
  const seenIds = getSeenQuestionIds(quizId);

  // Pisahkan soal yang belum dikerjakan dan yang sudah dikerjakan (dalam urutan asli berurutan)
  const unseen = allQuestions.filter(q => !seenIds.includes(q.id));
  const seen = allQuestions.filter(q => seenIds.includes(q.id));

  let chosen = [];
  let nextSeenIds = [];

  if (unseen.length >= count) {
    // Ambil `count` soal berikutnya secara berurutan
    chosen = unseen.slice(0, count);
    nextSeenIds = [...seenIds, ...chosen.map(q => q.id)];
  } else {
    // Jika soal tersisa kurang dari count, ambil sisa unseen lalu sambung dari awal paket berurutan
    const needed = count - unseen.length;
    chosen = [...unseen, ...seen.slice(0, needed)];
    nextSeenIds = chosen.map(q => q.id);
  }

  // Update pelacakan soal
  saveSeenQuestionIds(quizId, nextSeenIds);

  // Return soal strictly berurutan nomornya (1 s.d. 10), tetapi opsi pilihan (A, B, C, D) diacak dinamis
  return chosen.map(q => shuffleQuestionOptions(q));
}

function shuffleQuizQuestions(questions) {
  if (!Array.isArray(questions) || questions.length === 0) return [];
  return [...questions];
}

function startQuizSession(quizId) {
  if (state.currentRole === 'teacher') {
    showToast('👨‍🏫 Mode Guru Aktif: Anda tidak dapat bermain kuis siswa. Menampilkan pratinjau soal...');
    openTeacherPreviewModal(quizId);
    return;
  }

  let quizPkg = state.allQuizzes.find(q => q.id === quizId);

  // If not found directly, check if quizId comes from review result
  if (!quizPkg && state.currentReviewResult) {
    if (state.currentReviewResult.quizPackageId) {
      quizPkg = state.allQuizzes.find(q => q.id === state.currentReviewResult.quizPackageId);
    }
    if (!quizPkg && state.currentReviewResult.soalData) {
      quizPkg = {
        id: state.currentReviewResult.quizPackageId || quizId,
        kelas: state.currentReviewResult.kelas,
        mapelId: state.currentReviewResult.mapelId,
        mapelNama: state.currentReviewResult.mapelNama,
        judulMateri: state.currentReviewResult.materiJudul,
        soal: state.currentReviewResult.soalData
      };
    }
  }

  if (!quizPkg) {
    // Dynamically resolve subject based on quizId or current active context
    let resolvedMapel = null;
    let resolvedGrade = state.selectedKelas || 1;
    for (const faseKey of ['faseA', 'faseB', 'faseC']) {
      if (KURIKULUM_STRUCTURE[faseKey] && KURIKULUM_STRUCTURE[faseKey].mapel) {
        const found = KURIKULUM_STRUCTURE[faseKey].mapel.find(m => quizId && quizId.includes(m.id));
        if (found) {
          resolvedMapel = found;
          break;
        }
      }
    }
    if (!resolvedMapel) {
      const curFaseObj = KURIKULUM_STRUCTURE[state.activeFase] || KURIKULUM_STRUCTURE.faseA;
      resolvedMapel = curFaseObj.mapel[0] || { id: 'matematika', nama: 'Matematika' };
    }
    quizPkg = {
      id: quizId,
      kelas: resolvedGrade,
      mapelId: resolvedMapel.id,
      mapelNama: resolvedMapel.nama,
      judulMateri: `Materi Pokok ${resolvedMapel.nama} Kelas ${resolvedGrade}`,
      deskripsi: `Latihan konsep capaian pembelajaran ${resolvedMapel.nama} Kurikulum Merdeka.`,
      soal: generateFallbackQuestions(resolvedMapel, resolvedGrade)
    };
    state.allQuizzes.push(quizPkg);
  }

  // Create session package with dynamically sampled & anti-duplicate shuffled questions
  const sessionPackage = {
    ...quizPkg,
    soal: sampleQuizQuestions(quizPkg, 10)
  };

  // Close topic modal if open
  const modalTopics = document.getElementById('modal-topics');
  if (modalTopics) modalTopics.classList.remove('show');

  state.currentQuizSession = {
    package: sessionPackage,
    currentIndex: 0,
    answers: [],
    startTime: Date.now(),
    score: 0,
    timerSeconds: state.settings.timerMode === 'cepat' ? 20 : (state.settings.timerMode === 'tantangan' ? 45 : 0),
    timerInterval: null,
    answeredCurrent: false
  };

  switchPage('view-quiz-arena');
  renderCurrentQuestion();
  startQuizTimer();
}

function startQuizTimer() {
  const timerPill = document.getElementById('quiz-timer-pill');
  if (!timerPill) return;

  const sess = state.currentQuizSession;
  if (!sess) return;

  if (sess.timerInterval) {
    clearInterval(sess.timerInterval);
  }

  // Cek apakah sesi ini adalah kuis tantangan khusus (Golden Challenge = 30s, Promotion Exam = 45s)
  const isSpecialCountdown = Boolean(sess.isGoldenChallenge || sess.isPromotionExam);

  if (!isSpecialCountdown && state.settings.timerMode === 'santai') {
    // Mode Santai reguler counts UP (Stopwatch)
    sess.timerSeconds = 0;
    timerPill.className = 'timer-pill';
    timerPill.innerHTML = `⏱️ <span id="timer-val">00:00</span>`;

    sess.timerInterval = setInterval(() => {
      sess.timerSeconds++;
      const mins = Math.floor(sess.timerSeconds / 60).toString().padStart(2, '0');
      const secs = (sess.timerSeconds % 60).toString().padStart(2, '0');
      const el = document.getElementById('timer-val');
      if (el) el.textContent = `${mins}:${secs}`;
    }, 1000);

  } else {
    // Hitung mundur waktu per soal
    let totalDuration = 45;
    if (sess.isGoldenChallenge) {
      totalDuration = 30; // Golden Challenge: 30 detik per butir soal
    } else if (sess.isPromotionExam) {
      totalDuration = 45; // Ujian Kenaikan Kelas: 45 detik per butir soal
    } else if (state.settings.timerMode === 'cepat') {
      totalDuration = 20; // Mode Cepat reguler: 20 detik
    } else {
      totalDuration = 45; // Mode Tantangan reguler: 45 detik
    }

    sess.timerSeconds = totalDuration;
    timerPill.className = 'timer-pill';
    timerPill.innerHTML = `⏳ <span id="timer-val">${totalDuration}s</span>`;

    sess.timerInterval = setInterval(() => {
      sess.timerSeconds--;
      const sec = sess.timerSeconds;
      timerPill.innerHTML = `⏳ <span id="timer-val">${sec}s</span>`;

      if (sec <= 5) {
        timerPill.className = 'timer-pill danger';
      } else if (sec <= 10) {
        timerPill.className = 'timer-pill warning';
      } else {
        timerPill.className = 'timer-pill';
      }

      if (sec <= 0) {
        clearInterval(sess.timerInterval);
        handleTimeUp();
      }
    }, 1000);
  }
}

function handleTimeUp() {
  if (state.currentQuizSession.answeredCurrent) return;
  state.currentQuizSession.answeredCurrent = true;
  playTone('wrong');

  const sess = state.currentQuizSession;
  const q = sess.package.soal[sess.currentIndex];

  sess.answers.push({
    soalId: q.id,
    dipilih: -1,
    status: 'waktu-habis',
    jawabanBenar: q.jawabanBenar
  });

  // Show timeout feedback
  const feedbackBox = document.getElementById('quiz-feedback-box');
  const fbTitle = document.getElementById('feedback-title');
  const fbText = document.getElementById('feedback-text');
  const fbIcon = document.getElementById('feedback-icon');

  fbIcon.textContent = '⏰';
  fbTitle.textContent = 'Waktu Habis!';
  fbTitle.style.color = '#BE123C';
  fbText.textContent = `Jawaban yang tepat adalah "${q.pilihan[q.jawabanBenar]}". ${q.pembahasan}`;
  feedbackBox.classList.add('show');

  // Smooth scroll agar tombol lanjut tampak jika waktu habis
  setTimeout(() => {
    feedbackBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, 100);

  // Disable all options
  document.querySelectorAll('.option-btn').forEach(b => b.disabled = true);
}

function renderCurrentQuestion() {
  const sess = state.currentQuizSession;
  if (!sess) return;

  sess.answeredCurrent = false;
  const q = sess.package.soal[sess.currentIndex];
  const total = sess.package.soal.length;
  const qNum = sess.currentIndex + 1;
  const progressPct = Math.round((qNum / total) * 100);

  // Update progress headers
  const numLabel = document.getElementById('quiz-question-number');
  const progPctLabel = document.getElementById('quiz-progress-pct');
  const progFill = document.getElementById('quiz-progress-fill');
  const qMetaBadge = document.getElementById('question-badge-info');

  if (numLabel) numLabel.textContent = `Soal ${qNum} dari ${total}`;
  if (progPctLabel) progPctLabel.textContent = `${progressPct}%`;
  if (progFill) progFill.style.width = `${progressPct}%`;
  if (qMetaBadge) qMetaBadge.textContent = `${sess.package.mapelNama} • Tingkat ${q.kesulitan.toUpperCase()}`;

  // Question statement
  const qTextEl = document.getElementById('quiz-question-text');
  if (qTextEl) qTextEl.textContent = q.pertanyaan;

  // Options cards
  const optionsGrid = document.getElementById('quiz-options-grid');
  optionsGrid.innerHTML = '';

  const letters = ['A', 'B', 'C', 'D'];
  q.pilihan.forEach((optText, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'option-btn';
    btn.innerHTML = `
      <div class="option-letter">${letters[idx]}</div>
      <div class="option-label">${optText}</div>
    `;
    btn.onclick = () => selectOptionAnswer(idx);
    optionsGrid.appendChild(btn);
  });

  // Reset feedback box
  const feedbackBox = document.getElementById('quiz-feedback-box');
  if (feedbackBox) feedbackBox.classList.remove('show');

  // Auto-read question if TTS enabled and student is in Fase A (Kelas 1 or 2)
  if (state.settings.tts && state.selectedKelas <= 2) {
    setTimeout(() => speakText(q.pertanyaan), 400);
  }
}

function selectOptionAnswer(choiceIndex) {
  if (state.currentRole === 'teacher') {
    showToast('Akses Dibatasi: Mode Guru tidak dapat memilih jawaban.');
    return;
  }

  const sess = state.currentQuizSession;
  if (!sess || sess.answeredCurrent) return;

  sess.answeredCurrent = true;
  stopSpeech();

  if (sess.timerInterval && (sess.isGoldenChallenge || sess.isPromotionExam || state.settings.timerMode !== 'santai')) {
    clearInterval(sess.timerInterval);
  }

  const q = sess.package.soal[sess.currentIndex];
  const isCorrect = choiceIndex === q.jawabanBenar;

  // Record answer
  sess.answers.push({
    soalId: q.id,
    dipilih: choiceIndex,
    status: isCorrect ? 'benar' : 'salah',
    jawabanBenar: q.jawabanBenar
  });

  if (isCorrect) {
    sess.score += 10;
    playTone('correct');
  } else {
    playTone('wrong');
  }

  // Highlight options
  const optionButtons = document.querySelectorAll('.option-btn');
  optionButtons.forEach((btn, idx) => {
    btn.disabled = true;
    if (idx === q.jawabanBenar) {
      btn.classList.add('correct');
    } else if (idx === choiceIndex && !isCorrect) {
      btn.classList.add('wrong');
    }
  });

  // Show inline feedback drawer
  const feedbackBox = document.getElementById('quiz-feedback-box');
  const fbIcon = document.getElementById('feedback-icon');
  const fbTitle = document.getElementById('feedback-title');
  const fbText = document.getElementById('feedback-text');
  const nextBtn = document.getElementById('btn-next-question');

  if (isCorrect) {
    fbIcon.textContent = '🎉';
    fbTitle.textContent = 'Jawabanmu Tepat Sekali! (+10 Poin)';
    fbTitle.style.color = '#059669';
  } else {
    fbIcon.textContent = '💡';
    fbTitle.textContent = 'Belum Tepat, Tidak Apa-Apa!';
    fbTitle.style.color = '#D97706';
  }

  fbText.textContent = q.pembahasan;
  feedbackBox.classList.add('show');

  const isLastQuestion = sess.currentIndex + 1 >= sess.package.soal.length;
  if (nextBtn) {
    nextBtn.innerHTML = isLastQuestion ? 'Lihat Hasil Akhir 🏆' : 'Lanjut ke Soal Berikutnya ➡️';
  }

  // Smooth scroll agar tombol 'Lanjut ke Soal Berikutnya' langsung tampak pas di viewport
  setTimeout(() => {
    feedbackBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, 100);
}

function nextQuestion() {
  playTone('click');
  const sess = state.currentQuizSession;
  if (!sess) return;

  if (sess.currentIndex + 1 < sess.package.soal.length) {
    sess.currentIndex++;
    renderCurrentQuestion();
    startQuizTimer();
    // Scroll lembut kembali ke atas untuk soal berikutnya
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else {
    finishQuizSession();
  }
}

function confirmExitQuiz() {
  if (confirm('Yakin ingin keluar dari kuis? Progres saat ini belum tersimpan.')) {
    stopSpeech();
    if (state.currentQuizSession && state.currentQuizSession.timerInterval) {
      clearInterval(state.currentQuizSession.timerInterval);
    }
    state.currentQuizSession = null;
    switchPage('view-dashboard');
  }
}

// ==========================================================================
// 10. RESULTS, CELEBRATION & BADGES
// ==========================================================================
function finishQuizSession() {
  const sess = state.currentQuizSession;
  if (!sess) return;

  if (sess.timerInterval) clearInterval(sess.timerInterval);
  stopSpeech();

  const totalQuestions = sess.package.soal.length;
  const correctCount = sess.answers.filter(a => a.status === 'benar').length;
  const wrongCount = totalQuestions - correctCount;
  const finalScore = Math.round((correctCount / totalQuestions) * 100);
  const durationSec = Math.round((Date.now() - sess.startTime) / 1000);

  // Golden Challenge & Promotion Exam handling:
  let awardedScore = finalScore;

  if (sess.isGoldenChallenge) {
    if (finalScore >= 80) {
      awardedScore = finalScore * 2; // Double XP bonus!
      showToast(`🔥 DOUBLE XP AKTIF! Kamu mendapatkan ${awardedScore} Poin XP! ⚡`);
      if (!state.user.badgesEarned) state.user.badgesEarned = [];
      if (!state.user.badgesEarned.includes('golden_challenge_win')) {
        state.user.badgesEarned.push('golden_challenge_win');
      }
    } else {
      showToast(`Tantangan selesai! Skor: ${finalScore}. Coba lagi nanti untuk meraih Double XP!`);
    }
    state.user.quizStreakCount = 0; // reset counter after challenge
  } else if (sess.isPromotionExam) {
    if (finalScore >= 90) {
      const oldGrade = state.user.kelas;
      const nextGrade = Math.min(6, oldGrade + 1);
      state.user.kelas = nextGrade;
      state.selectedKelas = nextGrade;
      updateFaseByKelas(nextGrade);
      if (!state.user.badgesEarned) state.user.badgesEarned = [];
      if (!state.user.badgesEarned.includes('naik_kelas_lulus')) {
        state.user.badgesEarned.push('naik_kelas_lulus');
      }
      showToast(`🎓 LUAR BIASA! Kamu LULUS Ujian dan Resmi Naik ke Kelas ${nextGrade}! 🎉`);
      playTone('fanfare');
      launchConfetti();
    } else {
      showToast(`Skor Ujian: ${finalScore}. Syarat lulus naik kelas adalah 90. Ayo belajar lagi dan coba lagi! 💪`);
    }
  } else {
    // Regular quiz increases the streak towards next Golden Challenge
    state.user.quizStreakCount = (state.user.quizStreakCount || 0) + 1;
    if (state.user.quizStreakCount >= 3) {
      showToast('🔥 Golden Quiz Challenge Terbuka di Beranda! Raih Double XP!');
    }
  }

  // Create result transaction object
  const resultRecord = {
    id: 'RES-' + Date.now().toString(36),
    quizPackageId: sess.package.id,
    userId: state.user ? state.user.id : 'GUEST',
    playerName: state.user ? state.user.nama : 'Pemain',
    avatar: state.user ? state.user.avatar : 'kucing',
    kelas: sess.package.kelas,
    mapelId: sess.package.mapelId,
    mapelNama: sess.package.mapelNama,
    materiJudul: sess.package.judulMateri,
    skor: finalScore,
    jumlahBenar: correctCount,
    jumlahSalah: wrongCount,
    durasiDetik: durationSec,
    modeTimer: state.settings.timerMode,
    tanggal: new Date().toISOString(),
    soalData: sess.package.soal,
    jawabanData: sess.answers
  };

  saveResultsHistory(resultRecord);
  state.currentReviewResult = resultRecord;

  // Award Points to User
  if (state.user) {
    state.user.totalPoin = (state.user.totalPoin || 0) + awardedScore;
    checkAndAwardBadges(finalScore, resultRecord);
    saveUserData();
    syncUserToLeaderboard(resultRecord.mapelId, resultRecord.mapelNama, awardedScore);
  }

  renderResultsView(resultRecord);
  switchPage('view-results');

  // Audio Fanfare & Confetti
  if (finalScore >= 70) {
    playTone('fanfare');
    launchConfetti();
  } else {
    playTone('correct');
  }
}

// ==========================================================================
// 10B. LOCKED CLASS & PROMOTION EXAM ENGINE
// ==========================================================================
function openLockedClassModal(targetGrade) {
  playTone('click');
  const userGrade = (state.user && state.user.kelas) ? state.user.kelas : 1;
  const modal = document.getElementById('modal-locked-class');
  const title = document.getElementById('locked-class-title');
  const desc = document.getElementById('locked-class-desc');
  const btnPromotion = document.getElementById('btn-goto-promotion-exam');

  if (title) title.innerHTML = `Kelas ${targetGrade} Masih Terkunci! 🔒`;
  if (desc) {
    desc.innerHTML = `Kamu saat ini terdaftar resmi di <strong>Kelas ${userGrade} SD</strong>. Agar perolehan poin dan kompetisi di papan peringkat tetap adil dan jujur, setiap siswa hanya dapat belajar dan berlomba di kelasnya.`;
  }

  if (btnPromotion) {
    if ((state.user && (state.user.level || 1) >= 5) && userGrade < 6) {
      btnPromotion.style.display = 'block';
      btnPromotion.textContent = `Ikuti Ujian Naik ke Kelas ${userGrade + 1} 🎓`;
    } else {
      btnPromotion.style.display = 'none';
    }
  }

  if (modal) modal.classList.add('show');
}

function openPromotionExamModal() {
  if (state.currentRole === 'teacher') {
    showToast('Mode Guru Aktif: Ujian Kenaikan Kelas khusus untuk akun siswa.');
    return;
  }
  playTone('click');
  const lockedModal = document.getElementById('modal-locked-class');
  if (lockedModal) lockedModal.classList.remove('show');

  const userGrade = (state.user && state.user.kelas) ? state.user.kelas : 1;
  if (userGrade >= 6) {
    showToast('Kamu sudah berada di Kelas 6 SD (Tingkat tertinggi)! 🎓');
    return;
  }

  const modal = document.getElementById('modal-promotion-exam');
  const title = document.getElementById('exam-modal-title');
  if (title) {
    title.textContent = `Ujian Kenaikan Kelas ${userGrade} ke Kelas ${userGrade + 1} 🎓`;
  }

  if (modal) modal.classList.add('show');
}

function startPromotionExamSession() {
  playTone('click');
  const modal = document.getElementById('modal-promotion-exam');
  if (modal) modal.classList.remove('show');

  const userGrade = (state.user && state.user.kelas) ? state.user.kelas : 1;

  // Gather questions across all subjects for this grade
  const matchingQuizzes = state.allQuizzes.filter(q => q.kelas === userGrade && Array.isArray(q.soal) && q.soal.length > 0);
  let pool = [];
  matchingQuizzes.forEach(q => {
    pool = pool.concat(q.soal);
  });

  if (pool.length === 0) {
    pool = generateFallbackQuestions({ nama: 'Ujian Kenaikan Kelas', id: 'ujian' }, userGrade);
  }

  const shuffledPool = fisherYatesShuffle(pool);
  const examQuestions = shuffledPool.slice(0, 10).map((q, idx) => {
    const shuffledQ = shuffleQuestionOptions(q, true);
    return {
      ...shuffledQ,
      pertanyaan: `Soal Ujian ${idx + 1}: ${shuffledQ.pertanyaan.replace(/^Soal\s*\d+\s*:\s*/i, '')}`
    };
  });

  const examPackage = {
    id: `exam-k${userGrade}-to-k${userGrade + 1}-${Date.now()}`,
    kelas: userGrade,
    fase: state.activeFase,
    mapelId: 'ujian_kenaikan',
    mapelNama: 'Ujian Kenaikan Kelas',
    judulMateri: `Asesmen Kenaikan Kelas ${userGrade} ke Kelas ${userGrade + 1}`,
    deskripsi: 'Ujian komprehensif penentuan kelulusan naik kelas.',
    soal: examQuestions
  };

  state.currentQuizSession = {
    package: examPackage,
    currentIndex: 0,
    score: 0,
    startTime: Date.now(),
    answers: [],
    timerInterval: null,
    answeredCurrent: false,
    isPromotionExam: true,
    isGoldenChallenge: false
  };

  switchPage('view-quiz-arena');
  renderCurrentQuestion();
  startQuizTimer();
  showToast(`Ujian Kenaikan Kelas dimulai! Syarat kelulusan: Skor minimal 90.`);
}

// ==========================================================================
// 10C. GOLDEN QUIZ CHALLENGE ENGINE (DOUBLE XP)
// ==========================================================================
function startGoldenChallenge() {
  if (state.currentRole === 'teacher') {
    showToast('Mode Guru Aktif: Tantangan Golden Challenge khusus untuk akun siswa.');
    return;
  }
  playTone('click');
  const modal = document.getElementById('modal-golden-challenge');
  if (modal) modal.classList.add('show');
}

function launchGoldenChallengeSession() {
  if (state.currentRole === 'teacher') {
    showToast('Mode Guru Aktif: Tantangan Golden Challenge khusus untuk akun siswa.');
    return;
  }
  playTone('click');
  const modal = document.getElementById('modal-golden-challenge');
  if (modal) modal.classList.remove('show');

  const userGrade = (state.user && state.user.kelas) ? state.user.kelas : 1;

  // Gather questions across all subjects for this grade
  const matchingQuizzes = state.allQuizzes.filter(q => q.kelas === userGrade && Array.isArray(q.soal) && q.soal.length > 0);
  let pool = [];
  matchingQuizzes.forEach(q => {
    pool = pool.concat(q.soal);
  });

  if (pool.length === 0) {
    pool = generateFallbackQuestions({ nama: 'Golden Challenge', id: 'challenge' }, userGrade);
  }

  const shuffledPool = fisherYatesShuffle(pool);
  const challengeQuestions = shuffledPool.slice(0, 10).map((q, idx) => {
    const shuffledQ = shuffleQuestionOptions(q, true);
    return {
      ...shuffledQ,
      pertanyaan: `[Tantangan ${idx + 1}] ${shuffledQ.pertanyaan.replace(/^Soal\s*\d+\s*:\s*/i, '')}`
    };
  });

  const challengePackage = {
    id: `golden-challenge-k${userGrade}-${Date.now()}`,
    kelas: userGrade,
    fase: state.activeFase,
    mapelId: 'golden_challenge',
    mapelNama: 'Golden Quiz Challenge',
    judulMateri: 'Tantangan Kilat Poin Ganda 🔥',
    deskripsi: 'Golden Challenge 10 soal dengan timer 30 detik berhadiah Double XP!',
    soal: challengeQuestions
  };

  state.currentQuizSession = {
    package: challengePackage,
    currentIndex: 0,
    score: 0,
    startTime: Date.now(),
    answers: [],
    timerInterval: null,
    answeredCurrent: false,
    isGoldenChallenge: true,
    isPromotionExam: false
  };

  switchPage('view-quiz-arena');
  renderCurrentQuestion();
  startQuizTimer();
  showToast('🔥 Golden Challenge dimulai! Raih skor minimal 80 untuk DOUBLE XP!');
}

// ==========================================================================
// 10D. PARENTAL MODE & PORTAL CONTROLLER
// ==========================================================================
let currentParentGateAnswer = 56;

function openParentalGate() {
  playTone('click');
  const a = Math.floor(Math.random() * 7) + 3;
  const b = Math.floor(Math.random() * 7) + 4;
  currentParentGateAnswer = a * b;

  const qEl = document.getElementById('parent-gate-question');
  const inputEl = document.getElementById('input-parent-gate-answer');
  const errEl = document.getElementById('parent-gate-error');

  if (qEl) qEl.textContent = `Berapa ${a} × ${b} ?`;
  if (inputEl) {
    inputEl.value = '';
    setTimeout(() => inputEl.focus(), 200);
  }
  if (errEl) errEl.style.display = 'none';

  const modal = document.getElementById('modal-parental-gate');
  if (modal) modal.classList.add('show');
}

function verifyParentalGate() {
  const inputEl = document.getElementById('input-parent-gate-answer');
  const errEl = document.getElementById('parent-gate-error');
  const val = inputEl ? parseInt(inputEl.value.trim(), 10) : null;

  if (val === currentParentGateAnswer) {
    const gateModal = document.getElementById('modal-parental-gate');
    if (gateModal) gateModal.classList.remove('show');

    // Open Parent Portal
    renderParentPortalData();
    const portalModal = document.getElementById('modal-parent-portal');
    if (portalModal) portalModal.classList.add('show');

    // Award parent badge if not yet
    if (!state.user.badgesEarned) state.user.badgesEarned = [];
    if (!state.user.badgesEarned.includes('mode_ortu_aktif')) {
      state.user.badgesEarned.push('mode_ortu_aktif');
      saveUserData();
    }
    playTone('correct');
    showToast('Akses Mode Orang Tua Diberikan ✓');
  } else {
    if (errEl) errEl.style.display = 'block';
    playTone('wrong');
  }
}

function renderParentPortalData() {
  if (!state.user) return;
  const user = state.user;
  const av = getAvatarObject(user.avatar);
  const userResults = getUserResultsHistory();
  const countQuizzes = userResults.length;
  const totalScore = userResults.reduce((acc, r) => acc + (r.skor || 0), 0);
  const avgScore = countQuizzes > 0 ? Math.round(totalScore / countQuizzes) : 0;

  // Total time spent
  const totalSeconds = userResults.reduce((acc, r) => acc + (r.durasiDetik || 0), 0);
  const totalQuestions = userResults.reduce((acc, r) => acc + (r.soalData ? r.soalData.length : 10), 0);
  const avgSecondsPerQ = totalQuestions > 0 ? Math.round(totalSeconds / totalQuestions) : 0;

  // Identity cards
  const avatarEl = document.getElementById('parent-child-avatar');
  const nameEl = document.getElementById('parent-child-name');
  const schoolEl = document.getElementById('parent-child-school');
  const gradeEl = document.getElementById('parent-child-grade');
  const levelEl = document.getElementById('parent-child-level');

  if (avatarEl) avatarEl.textContent = av.emoji;
  if (nameEl) nameEl.textContent = user.nama || 'Teman Belajar';
  if (schoolEl) schoolEl.textContent = `🏫 ${user.sekolah || 'SD Merdeka'}`;
  if (gradeEl) gradeEl.textContent = `Kelas ${user.kelas} SD (Terkunci 🔒)`;
  const tier = getLevelTier(user.totalPoin || 0);
  if (levelEl) levelEl.textContent = tier.title;

  // Stats
  const statQuiz = document.getElementById('parent-stat-quizzes');
  const statAvg = document.getElementById('parent-stat-avg');
  const statStreak = document.getElementById('parent-stat-streak');
  const statSpeed = document.getElementById('parent-stat-speed');

  if (statQuiz) statQuiz.textContent = countQuizzes;
  if (statAvg) statAvg.textContent = countQuizzes > 0 ? `${avgScore}` : '-';
  if (statStreak) statStreak.textContent = `${user.streak || 1} Hari`;
  if (statSpeed) statSpeed.textContent = totalQuestions > 0 ? `${avgSecondsPerQ} dtk/soal` : '-';

  // Subject Mastery Matrix for child's grade
  const masteryListEl = document.getElementById('parent-mastery-list');
  const recListEl = document.getElementById('parent-recommendations-list');
  if (!masteryListEl || !recListEl) return;

  masteryListEl.innerHTML = '';
  recListEl.innerHTML = '';

  const userFase = user.kelas <= 2 ? 'faseA' : (user.kelas <= 4 ? 'faseB' : 'faseC');
  const mapelList = (KURIKULUM_STRUCTURE[userFase] && KURIKULUM_STRUCTURE[userFase].mapel) ? KURIKULUM_STRUCTURE[userFase].mapel : [];

  const weakSubjects = [];
  const strongSubjects = [];

  mapelList.forEach(m => {
    const mapelResults = userResults.filter(r => r.mapelId === m.id || (r.mapelNama && r.mapelNama.toLowerCase().includes(m.nama.toLowerCase())));
    const takenCount = mapelResults.length;
    let avg = null;
    if (takenCount > 0) {
      avg = Math.round(mapelResults.reduce((acc, r) => acc + (r.skor || 0), 0) / takenCount);
    }

    let badgeClass = 'good';
    let badgeText = 'Belum Dikerjakan';
    let badgeIcon = '⚪';

    if (takenCount === 0) {
      badgeClass = '';
      badgeText = 'Belum Ada Latihan';
      badgeIcon = '⚪';
    } else if (avg >= 90) {
      badgeClass = 'excellent';
      badgeText = `Sangat Mahir (${avg} ⭐)`;
      badgeIcon = '🟢';
      strongSubjects.push({ mapel: m.nama, avg: avg });
    } else if (avg >= 70) {
      badgeClass = 'good';
      badgeText = `Berkembang Baik (${avg})`;
      badgeIcon = '🟡';
    } else {
      badgeClass = 'needs-practice';
      badgeText = `Perlu Pendampingan (${avg})`;
      badgeIcon = '🔴';
      weakSubjects.push({ mapel: m.nama, avg: avg });
    }

    const row = document.createElement('div');
    row.className = 'mastery-row';
    row.innerHTML = `
      <div style="display: flex; align-items: center; gap: 0.5rem;">
        <span style="font-size: 1.25rem;">${m.icon || '📚'}</span>
        <div>
          <strong style="color: var(--text-main); font-size: 0.92rem;">${m.nama}</strong>
          <div style="font-size: 0.74rem; color: #64748B;">${takenCount} kuis diselesaikan</div>
        </div>
      </div>
      <div>
        <span class="mastery-badge ${badgeClass}">${badgeIcon} ${badgeText}</span>
      </div>
    `;
    masteryListEl.appendChild(row);
  });

  // Generate Tailored Parental Recommendations
  if (countQuizzes === 0) {
    recListEl.innerHTML = `
      <div class="recommendation-item">
        <strong>👋 Mulai Latihan Pertama:</strong> Ananda belum memiliki riwayat kuis. Ayah/Bunda disarankan mendampingi Ananda mengerjakan kuis pertamanya pada mata pelajaran yang paling disukai.
      </div>
    `;
  } else {
    if (weakSubjects.length > 0) {
      weakSubjects.forEach(w => {
        recListEl.innerHTML += `
          <div class="recommendation-item" style="border-left-color: #EF4444;">
            <strong>🎯 Pendampingan Prioritas:</strong> Pada mata pelajaran <strong>${w.mapel}</strong> (Rata-rata: ${w.avg}), Ananda disarankan untuk membaca kembali rangkuman dan mengulang kuis santai tanpa batas waktu.
          </div>
        `;
      });
    }

    if (strongSubjects.length > 0) {
      const topStrong = strongSubjects[0];
      recListEl.innerHTML += `
        <div class="recommendation-item" style="border-left-color: #10B981;">
          <strong>🌟 Apresiasi Prestasi:</strong> Ananda sangat menonjol di <strong>${topStrong.mapel}</strong> dengan rata-rata <strong>${topStrong.avg}</strong>! Berikan pujian hangat untuk memotivasi semangat belajarnya.
        </div>
      `;
    }

    if (avgSecondsPerQ > 0 && avgSecondsPerQ < 6) {
      recListEl.innerHTML += `
        <div class="recommendation-item" style="border-left-color: #F59E0B;">
          <strong>⚡ Evaluasi Ketelitian:</strong> Ananda menjawab sangat cepat (rata-rata ${avgSecondsPerQ} detik/soal). Ajak Ananda membaca setiap pertanyaan dan opsi dengan lebih tenang agar tidak terkecoh.
        </div>
      `;
    } else if (avgSecondsPerQ >= 6) {
      recListEl.innerHTML += `
        <div class="recommendation-item" style="border-left-color: #3B82F6;">
          <strong>📖 Refleksi Cara Belajar:</strong> Ananda memiliki ketelitian yang baik dengan tempo rata-rata ${avgSecondsPerQ} detik per butir soal. Pertahankan kebiasaan membaca teliti ini.
        </div>
      `;
    }
  }
}

function promptParentChangeGrade() {
  playTone('click');
  const sel = document.getElementById('parent-select-new-grade');
  if (sel && state.user) {
    sel.value = state.user.kelas || 1;
  }
  const modal = document.getElementById('modal-parent-change-grade');
  if (modal) modal.classList.add('show');
}

function confirmParentChangeGrade() {
  playTone('click');
  const sel = document.getElementById('parent-select-new-grade');
  const newGrade = sel ? parseInt(sel.value, 10) : 1;
  if (isNaN(newGrade) || newGrade < 1 || newGrade > 6) return;

  state.user.kelas = newGrade;
  state.selectedKelas = newGrade;
  state.user.kelasLocked = true;
  updateFaseByKelas(newGrade);
  saveUserData();
  syncUserToLeaderboard();
  renderFaseAndGradeCards();
  renderSubjectsGrid();
  renderParentPortalData();
  const modal = document.getElementById('modal-parent-change-grade');
  if (modal) modal.classList.remove('show');
  showToast(`Kelas Ananda berhasil diselaraskan ke Kelas ${newGrade} SD.`);
}

function promptParentResetHistory() {
  playTone('click');
  const modal = document.getElementById('modal-parent-reset-confirm');
  const desc = document.getElementById('parent-reset-confirm-desc');
  if (desc && state.user) {
    desc.textContent = `Apakah Ayah/Bunda yakin ingin mereset seluruh riwayat kuis dan perolehan skor Ananda (${state.user.nama})? Tindakan ini akan mengosongkan statistik riwayat belajar dan menyelaraskan papan peringkat secara bersih.`;
  }
  if (modal) modal.classList.add('show');
}

function executeParentResetHistory() {
  playTone('click');
  const currentId = state.user ? state.user.id : null;
  const currentName = (state.user ? state.user.nama : '').toLowerCase().trim();

  state.resultsHistory = state.resultsHistory.filter(r => {
    if (r.userId && currentId && r.userId === currentId) return false;
    if (r.playerName && currentName && r.playerName.toLowerCase().trim() === currentName) return false;
    return true;
  });

  localStorage.setItem(APP_STORAGE_KEYS.RESULTS, JSON.stringify(state.resultsHistory));

  if (state.user) {
    state.user.totalPoin = 0;
    state.user.quizStreakCount = 0;
    saveUserData();
  }

  // Bersihkan data skor siswa di leaderboard
  if (currentName) {
    state.leaderboardData = state.leaderboardData.filter(item => 
      (item.nama || '').toLowerCase().trim() !== currentName
    );
    localStorage.setItem(APP_STORAGE_KEYS.LEADERBOARD, JSON.stringify(state.leaderboardData));
  }

  renderParentPortalData();
  updateDashboardStats();
  renderHistoryView();
  renderLeaderboardView();

  const modal = document.getElementById('modal-parent-reset-confirm');
  if (modal) modal.classList.remove('show');
  showToast('Riwayat kuis dan poin Ananda berhasil direset.');
}

// ==========================================================================
// 10E. JSPDF LEVEL ACHIEVEMENT CERTIFICATE GENERATOR
// ==========================================================================
function downloadLevelCertificatePDF() {
  playTone('click');
  if (!state.user) return;

  if (typeof window.jspdf === 'undefined' || !window.jspdf.jsPDF) {
    showToast('Modul PDF belum selesai dimuat. Pastikan perangkat terhubung ke internet.');
    return;
  }

  showToast('Menyiapkan Piagam Penghargaan PDF...');

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4'
  });

  const pageWidth = doc.internal.pageSize.getWidth(); // 297mm
  const pageHeight = doc.internal.pageSize.getHeight(); // 210mm
  const user = state.user;
  const tier = getLevelTier(user.totalPoin || 0);
  const studentName = user.nama || 'Siswa Berprestasi';
  const schoolName = user.sekolah || 'SD Merdeka';

  // Elegant Double Gold Border
  doc.setDrawColor(217, 119, 6); // Golden Amber
  doc.setLineWidth(3);
  doc.rect(10, 10, pageWidth - 20, pageHeight - 20);

  doc.setDrawColor(245, 158, 11);
  doc.setLineWidth(1);
  doc.rect(13, 13, pageWidth - 26, pageHeight - 26);

  // Background Header Glow
  doc.setFillColor(254, 243, 199); // Soft Gold
  doc.rect(14, 14, pageWidth - 28, 28, 'F');

  // Title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(146, 64, 14); // Deep Gold
  doc.text('PIAGAM PENGHARGAAN PRESTASI BELAJAR', pageWidth / 2, 28, { align: 'center' });

  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(180, 83, 9);
  doc.text('KuisPintar SD — Media Pembelajaran Interaktif Kurikulum Merdeka', pageWidth / 2, 36, { align: 'center' });

  // Body Text
  doc.setTextColor(30, 41, 59);
  doc.setFontSize(12);
  doc.text('Dengan bangga piagam penghargaan ini dianugerahkan kepada:', pageWidth / 2, 60, { align: 'center' });

  // Student Name
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(26);
  doc.setTextColor(79, 70, 229); // Primary Indigo
  doc.text(studentName.toUpperCase(), pageWidth / 2, 75, { align: 'center' });

  // School & Class
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(13);
  doc.setTextColor(71, 85, 105);
  doc.text(`Siswa Kelas ${user.kelas} SD • ${schoolName}`, pageWidth / 2, 85, { align: 'center' });

  // Achievement narrative
  doc.setFontSize(12);
  doc.setTextColor(30, 41, 59);
  doc.text('Atas ketekunan, dedikasi, kedisiplinan, dan keberhasilan gemilang menempuh tangga prestasi:', pageWidth / 2, 102, { align: 'center' });

  // Level Badge Box
  doc.setFillColor(238, 242, 255);
  doc.setDrawColor(199, 210, 254);
  doc.roundedRect(pageWidth / 2 - 70, 110, 140, 24, 4, 4, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(67, 56, 202);
  doc.text(tier.title.toUpperCase(), pageWidth / 2, 122, { align: 'center' });

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text(`Total Akumulasi Prestasi: ${user.totalPoin || 0} Poin Bintang XP`, pageWidth / 2, 129, { align: 'center' });

  // Motivational quote
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(11);
  doc.setTextColor(71, 85, 105);
  doc.text('"Teruslah belajar dengan gembira, berakhlak mulia, dan gapai cita-cita setinggi langit!"', pageWidth / 2, 146, { align: 'center' });

  // Signatures Row
  const dateStr = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(51, 65, 85);

  // Left Signature (Orang Tua / Wali)
  doc.text('Mengetahui & Mendukung,', 50, 165, { align: 'center' });
  doc.text('Orang Tua / Wali Siswa', 50, 170, { align: 'center' });
  doc.line(30, 192, 70, 192);
  doc.text('( .................................... )', 50, 197, { align: 'center' });

  // Center Seal Stamp
  doc.setDrawColor(217, 119, 6);
  doc.setLineWidth(1.5);
  doc.circle(pageWidth / 2, 178, 12, 'S');
  doc.setFontSize(8);
  doc.setTextColor(180, 83, 9);
  doc.setFont('helvetica', 'bold');
  doc.text('TERVERIFIKASI', pageWidth / 2, 176, { align: 'center' });
  doc.text('RESMI 2026', pageWidth / 2, 181, { align: 'center' });

  // Right Signature (Guru / Mentor Pembina)
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(51, 65, 85);
  doc.text(`Diterbitkan, ${dateStr}`, pageWidth - 50, 165, { align: 'center' });
  doc.text('Guru / Pembina Belajar', pageWidth - 50, 170, { align: 'center' });
  doc.line(pageWidth - 70, 192, pageWidth - 30, 192);
  doc.text('( Fairuz Maulana, S.Pd )', pageWidth - 50, 197, { align: 'center' });

  const cleanName = studentName.replace(/[^a-zA-Z0-9]/g, '_');
  doc.save(`Piagam_Prestasi_Level_${tier.level}_${cleanName}.pdf`);
  showToast('Piagam Penghargaan PDF berhasil diunduh! 📜');
}

function checkAndAwardBadges(score, result) {
  if (!state.user.badgesEarned) state.user.badgesEarned = [];
  const earned = state.user.badgesEarned;

  // 1. Quiz pertama
  if (!earned.includes('quiz_pertama')) {
    earned.push('quiz_pertama');
    showToast('🎯 Selamat! Kamu meraih lencana: Quiz Pertama!');
  }

  // 2. Nilai 100
  if (score === 100 && !earned.includes('nilai_100')) {
    earned.push('nilai_100');
    showToast('⭐ Sempurna! Kamu meraih lencana: Bintang Sempurna 100!');
  }

  const userResults = getUserResultsHistory();

  // 3, 4, 5. Streak badges
  if (state.user.streak >= 3 && !earned.includes('streak_3')) {
    earned.push('streak_3');
    showToast('🔥 Luar biasa! Lencana: Api Belajar (3 Hari) terbuka!');
  }
  if (state.user.streak >= 7 && !earned.includes('streak_7')) {
    earned.push('streak_7');
    showToast('⚡ Hebat! Lencana: Semangat Juara (7 Hari) terbuka!');
  }
  if (state.user.streak >= 14 && !earned.includes('streak_14')) {
    earned.push('streak_14');
    showToast('👑 Fantastis! Lencana: Raja Disiplin (14 Hari) terbuka!');
  }

  // 6. Rajin belajar (>=5 quizzes)
  if (userResults.length >= 5 && !earned.includes('rajin_belajar')) {
    earned.push('rajin_belajar');
    showToast('📚 Hebat! Kamu meraih lencana: Rajin Belajar (5 Kuis)!');
  }

  // 7. Juara 10 Quiz
  if (userResults.length >= 10 && !earned.includes('juara_10_quiz')) {
    earned.push('juara_10_quiz');
    showToast('🏆 Fantastis! Lencana: Penjelajah Tangguh (10 Kuis)!');
  }

  // 8. Juara 20 Quiz (Legenda Kuis)
  if (userResults.length >= 20 && !earned.includes('juara_20_quiz')) {
    earned.push('juara_20_quiz');
    showToast('🎖️ Spektakuler! Kamu adalah Legenda Kuis (20 Kuis Selesai)!');
  }

  // 9. Mode Tantangan Berhasil
  if ((result.modeTimer === 'tantangan' || result.modeTimer === 'cepat') && score >= 70 && !earned.includes('tantangan_berhasil')) {
    earned.push('tantangan_berhasil');
    showToast('🚀 Mantap! Lencana: Tantangan Kilat berhasil diraih!');
  }

  // 10. Presisi Kilat 100
  if ((result.modeTimer === 'tantangan' || result.modeTimer === 'cepat') && score === 100 && !earned.includes('kilat_sempurna')) {
    earned.push('kilat_sempurna');
    showToast('⚡ Luar biasa! Lencana: Presisi Kilat 100 diraih!');
  }

  // Subject Mastery Badges (Nilai >= 90)
  const mId = (result.mapelId || '').toLowerCase();
  const mNama = (result.mapelNama || '').toLowerCase();

  // 11. Master Matematika
  if ((mId.includes('matematika') || mNama.includes('matematika')) && score >= 90 && !earned.includes('master_matematika')) {
    earned.push('master_matematika');
    showToast('🔢 Keren! Lencana: Ahli Numerasi Matematika terbuka!');
  }

  // 12. Pujangga Cilik (Bahasa Indonesia)
  if ((mId.includes('bindonesia') || mNama.includes('indonesia')) && score >= 90 && !earned.includes('pakar_bahasa')) {
    earned.push('pakar_bahasa');
    showToast('📖 Hebat! Lencana: Pujangga Cilik Bahasa Indonesia terbuka!');
  }

  // 13. Garuda Cilik (Pancasila)
  if ((mId.includes('pancasila') || mNama.includes('pancasila')) && score >= 90 && !earned.includes('sahabat_pancasila')) {
    earned.push('sahabat_pancasila');
    showToast('🇮🇩 Bangga! Lencana: Garuda Cilik Pendidikan Pancasila terbuka!');
  }

  // 14. Peneliti IPAS
  if ((mId.includes('ipas') || mNama.includes('ipas') || mNama.includes('sains')) && score >= 90 && !earned.includes('ilmuwan_cilik')) {
    earned.push('ilmuwan_cilik');
    showToast('🔬 Cerdas! Lencana: Peneliti IPAS Sains & Sosial terbuka!');
  }

  // 15. English Explorer
  if ((mId.includes('binggris') || mNama.includes('inggris')) && score >= 90 && !earned.includes('ahli_inggris')) {
    earned.push('ahli_inggris');
    showToast('🗣️ Good job! Lencana: English Explorer terbuka!');
  }

  // 16. Budi Pekerti Luhur (PAI)
  if ((mId.includes('pai') || mNama.includes('agama')) && score >= 90 && !earned.includes('budi_pekerti')) {
    earned.push('budi_pekerti');
    showToast('🕌 Mulia! Lencana: Budi Pekerti Luhur terbuka!');
  }

  // 17. Bintang Kebugaran (PJOK)
  if ((mId.includes('pjok') || mNama.includes('pjok') || mNama.includes('jasmani')) && score >= 90 && !earned.includes('atlet_tangguh')) {
    earned.push('atlet_tangguh');
    showToast('⚽ Bugar! Lencana: Bintang Kebugaran PJOK terbuka!');
  }

  // 18. Jiwa Seni Kreatif (Seni dan Budaya)
  if ((mId.includes('senibudaya') || mNama.includes('seni')) && score >= 90 && !earned.includes('seniman_kreatif')) {
    earned.push('seniman_kreatif');
    showToast('🎨 Artistik! Lencana: Jiwa Seni Kreatif terbuka!');
  }

  // 19. Programmer Cilik (Koding & AI)
  if ((mId.includes('koding_ai') || mNama.includes('koding') || mNama.includes('ai')) && score >= 90 && !earned.includes('ahli_koding')) {
    earned.push('ahli_koding');
    showToast('🤖 Canggih! Lencana: Programmer Cilik Koding & AI terbuka!');
  }

  // 20. Pelestari Budaya & P5 (Mulok / P5 score >= 80)
  if ((mId.includes('mulok') || mId.includes('p5') || mNama.includes('lokal') || mNama.includes('p5')) && score >= 80 && !earned.includes('cinta_budaya')) {
    earned.push('cinta_budaya');
    showToast('🌾 Cinta Budaya! Lencana: Pelestari Budaya & P5 diraih!');
  }

  // 21. Pantang Menyerah (mengulang materi dan menaikkan skor sebelumnya)
  const previousSameMateri = userResults.filter(r => r.materiJudul === result.materiJudul && r.id !== result.id);
  if (previousSameMateri.length > 0) {
    const prevLowest = Math.min(...previousSameMateri.map(r => r.skor));
    if (score > prevLowest && !earned.includes('pantang_menyerah')) {
      earned.push('pantang_menyerah');
      showToast('🛡️ Luar biasa! Lencana: Pantang Menyerah diraih karena skor meningkat!');
    }
  }

  // 22. Kolektor Bintang (Total poin >= 2500)
  if ((state.user.totalPoin || 0) >= 2500 && !earned.includes('kolektor_bintang')) {
    earned.push('kolektor_bintang');
    showToast('🌟 Hebat! Lencana: Kolektor Bintang (2.500 Poin) terbuka!');
  }

  // 23 & 24. Level Progression Badges
  if ((state.user.level || 1) >= 5 && !earned.includes('level_5')) {
    earned.push('level_5');
    showToast('🏅 Keren! Lencana: Satria Pelajar (Level 5) diraih!');
  }
  if ((state.user.level || 1) >= 10 && !earned.includes('level_10')) {
    earned.push('level_10');
    showToast('🥇 Spektakuler! Lencana: Mahaguru Cilik (Level 10) diraih!');
  }
}

function renderResultsView(res) {
  const scoreNum = document.getElementById('res-score-number');
  const scoreCircle = document.getElementById('res-score-circle');
  const iconBadge = document.getElementById('res-badge-icon');
  const titleMsg = document.getElementById('res-message-title');
  const descMsg = document.getElementById('res-message-desc');
  const statCorrect = document.getElementById('res-stat-correct');
  const statWrong = document.getElementById('res-stat-wrong');
  const statDuration = document.getElementById('res-stat-duration');

  if (scoreNum) scoreNum.textContent = res.skor;
  if (scoreCircle) scoreCircle.style.setProperty('--score-pct', res.skor);

  // Motivational message
  if (res.skor >= 90) {
    if (iconBadge) iconBadge.textContent = '🌟';
    if (titleMsg) titleMsg.textContent = 'Hebat! Kamu luar biasa! 🎉';
    if (descMsg) descMsg.textContent = 'Pemahamanmu terhadap materi ini sangat memuaskan. Pertahankan prestasimu!';
  } else if (res.skor >= 70) {
    if (iconBadge) iconBadge.textContent = '👏';
    if (titleMsg) titleMsg.textContent = 'Bagus sekali! Terus berlatih ya! 🌟';
    if (descMsg) descMsg.textContent = 'Hasil yang sangat baik! Sedikit latihan lagi kamu pasti bisa meraih nilai 100!';
  } else if (res.skor >= 50) {
    if (iconBadge) iconBadge.textContent = '💪';
    if (titleMsg) titleMsg.textContent = 'Lumayan! Yuk coba lagi dan tingkatkan skormu! 💪';
    if (descMsg) descMsg.textContent = 'Jangan patah semangat. Simak pembahasannya agar semakin paham konsepnya.';
  } else {
    if (iconBadge) iconBadge.textContent = '🚀';
    if (titleMsg) titleMsg.textContent = 'Jangan menyerah! Ayo belajar dan coba lagi! 🚀';
    if (descMsg) descMsg.textContent = 'Belajar adalah proses! Baca penjelasan jawaban dan coba kuis ini sekali lagi.';
  }

  if (statCorrect) statCorrect.textContent = res.jumlahBenar;
  if (statWrong) statWrong.textContent = res.jumlahSalah;
  if (statDuration) {
    const m = Math.floor(res.durasiDetik / 60);
    const s = res.durasiDetik % 60;
    statDuration.textContent = m > 0 ? `${m}m ${s}s` : `${s}d`;
  }
}

// ==========================================================================
// 11. DISCUSSION & REVIEW SCREEN (PEMBAHASAN SOAL)
// ==========================================================================
function openReviewPage(resultObj = null) {
  playTone('click');
  const target = resultObj || state.currentReviewResult;
  if (!target) {
    showToast('Tidak ada data kuis untuk dibahas.');
    return;
  }

  state.currentReviewResult = target;
  const listContainer = document.getElementById('review-list-container');
  const titleHeader = document.getElementById('review-header-title');

  if (titleHeader) {
    titleHeader.textContent = `Pembahasan: ${target.materiJudul} (Nilai: ${target.skor})`;
  }
  listContainer.innerHTML = '';

  const letters = ['A', 'B', 'C', 'D'];
  target.soalData.forEach((soal, idx) => {
    const userAns = target.jawabanData.find(a => a.soalId === soal.id);
    const userChoice = userAns ? userAns.dipilih : -1;
    const isCorrect = userAns && userAns.status === 'benar';

    const card = document.createElement('div');
    card.className = 'review-item-card';

    const userAnsText = userChoice >= 0 ? `${letters[userChoice]}. ${soal.pilihan[userChoice]}` : 'Tidak dijawab (Waktu habis)';
    const correctAnsText = `${letters[soal.jawabanBenar]}. ${soal.pilihan[soal.jawabanBenar]}`;

    card.innerHTML = `
      <div class="review-item-header">
        <span class="question-badge">Soal ${idx + 1}</span>
        <span class="review-status-tag ${isCorrect ? 'correct' : 'wrong'}">
          ${isCorrect ? '✓ Benar' : '✗ Belum Tepat'}
        </span>
      </div>
      <div class="review-question-text">${soal.pertanyaan}</div>
      <div class="review-answers-box">
        <div class="review-ans-row">
          <strong>Jawaban Kamu:</strong>
          <span style="color: ${isCorrect ? '#059669' : '#BE123C'}; font-weight: 700;">${userAnsText}</span>
        </div>
        <div class="review-ans-row">
          <strong>Kunci Jawaban:</strong>
          <span style="color: #059669; font-weight: 700;">${correctAnsText}</span>
        </div>
      </div>
      <div class="review-explanation-box">
        💡 <strong>Pembahasan:</strong> ${soal.pembahasan}
      </div>
    `;
    listContainer.appendChild(card);
  });

  switchPage('view-review');
}

// ==========================================================================
// 12. DOWNLOAD PDF SHEET (A4 PRINT-READY)
// ==========================================================================
function downloadResultPDF() {
  playTone('click');
  const result = state.currentReviewResult;
  if (!result) {
    showToast('Pilih riwayat kuis terlebih dahulu.');
    return;
  }

  if (typeof window.jspdf === 'undefined' || !window.jspdf.jsPDF) {
    showToast('Modul PDF belum selesai dimuat. Pastikan perangkat terhubung ke internet.');
    return;
  }

  showToast('Menyiapkan lembar kerja PDF...');

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  const studentName = result.playerName || (state.user ? state.user.nama : 'Siswa');
  const cleanStudentName = studentName.replace(/[^a-zA-Z0-9]/g, '_');
  const cleanMapel = result.mapelNama.replace(/[^a-zA-Z0-9]/g, '_');
  const filename = `Quiz_${cleanMapel}_Kelas_${result.kelas}_${cleanStudentName}.pdf`;

  // PDF Layout Specs
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;
  let cursorY = margin;

  // Header Banner
  doc.setFillColor(79, 70, 229); // Primary Indigo
  doc.rect(margin, cursorY, pageWidth - (margin * 2), 24, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text('KUISPINTAR SD — LEMBAR HASIL BELAJAR', margin + 6, cursorY + 9);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text('Game Edukasi Interaktif Berbasis Kurikulum Merdeka', margin + 6, cursorY + 16);

  cursorY += 30;

  // Student & Quiz Metadata Box
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.rect(margin, cursorY, pageWidth - (margin * 2), 30, 'FD');

  doc.setTextColor(30, 41, 59);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(`Nama Siswa   : ${studentName}`, margin + 4, cursorY + 6);
  const schoolName = (state.user && state.user.sekolah) ? state.user.sekolah : 'SD Merdeka';
  doc.text(`Asal Sekolah : ${schoolName}`, margin + 4, cursorY + 12);
  doc.text(`Kelas / Fase : Kelas ${result.kelas} SD`, margin + 4, cursorY + 18);
  doc.text(`Mata Pelajaran: ${result.mapelNama}`, margin + 4, cursorY + 24);

  doc.text(`Materi     : ${result.materiJudul}`, margin + 95, cursorY + 6);
  doc.text(`Tanggal    : ${new Date(result.tanggal).toLocaleDateString('id-ID')}`, margin + 95, cursorY + 13);

  // Score Badge
  doc.setFillColor(16, 185, 129); // Green
  doc.rect(pageWidth - margin - 35, cursorY + 4, 30, 20, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(9);
  doc.text('NILAI AKHIR', pageWidth - margin - 31, cursorY + 10);
  doc.setFontSize(15);
  doc.setFont('helvetica', 'bold');
  doc.text(`${result.skor}`, pageWidth - margin - 26, cursorY + 19);

  cursorY += 34;

  doc.setFontSize(11);
  doc.setTextColor(79, 70, 229);
  doc.setFont('helvetica', 'bold');
  doc.text('RINCIAN 10 SOAL, KUNCI JAWABAN & PEMBAHASAN LENGKAP', margin, cursorY);
  cursorY += 6;

  // Iterate over 10 questions with dynamic auto-wrap height
  const letters = ['A', 'B', 'C', 'D'];
  result.soalData.forEach((soal, index) => {
    const userAns = result.jawabanData.find(a => a.soalId === soal.id);
    const userChoice = userAns ? userAns.dipilih : -1;
    const isCorrect = userAns && userAns.status === 'benar';

    const qTitle = `No. ${index + 1} (${soal.kesulitan.toUpperCase()}): ${soal.pertanyaan}`;
    const splitTitle = doc.splitTextToSize(qTitle, pageWidth - (margin * 2) - 8);
    const userLabel = userChoice >= 0 ? `${letters[userChoice]}` : 'Tidak dijawab';
    const keyLabel = `${letters[soal.jawabanBenar]}. ${soal.pilihan[soal.jawabanBenar]}`;
    const ansText = `Jawaban Kamu: ${userLabel} (${isCorrect ? 'BENAR' : 'SALAH'})  |  Kunci: ${keyLabel}`;
    const expl = `Pembahasan: ${soal.pembahasan}`;
    const splitExpl = doc.splitTextToSize(expl, pageWidth - (margin * 2) - 8);

    const titleH = splitTitle.length * 4.2;
    const explH = splitExpl.length * 3.8;
    const cardH = Math.max(24, 6 + titleH + 5 + 4 + explH + 4);

    // Check page break
    if (cursorY + cardH > pageHeight - 15) {
      doc.addPage();
      cursorY = margin;
    }

    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(226, 232, 240);
    doc.rect(margin, cursorY, pageWidth - (margin * 2), cardH, 'S');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(30, 41, 59);
    doc.text(splitTitle, margin + 4, cursorY + 5);

    let currentY = cursorY + 5 + titleH;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(ansText, margin + 4, currentY + 3);

    currentY += 7;

    doc.setTextColor(30, 64, 175);
    doc.text(splitExpl, margin + 4, currentY + 3);

    cursorY += cardH + 4;
  });

  // Footer page notes
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.text('Dokumen dicetak secara resmi melalui aplikasi KuisPintar SD — Siap Belajar Sepanjang Hayat.', margin, pageHeight - 6);

  // Save PDF
  doc.save(filename);
}

// ==========================================================================
// 13. LEARNING HISTORY (RIWAYAT BELAJAR)
// ==========================================================================
function renderHistoryView() {
  const container = document.getElementById('history-list-container');
  const gradeFilter = document.getElementById('filter-history-grade');
  const searchFilter = document.getElementById('filter-history-search');

  if (!container) return;

  const selectedGrade = gradeFilter ? gradeFilter.value : 'all';
  const searchTerm = searchFilter ? searchFilter.value.toLowerCase().trim() : '';

  let filtered = getUserResultsHistory();

  if (selectedGrade !== 'all') {
    filtered = filtered.filter(r => r.kelas === parseInt(selectedGrade, 10));
  }

  if (searchTerm) {
    filtered = filtered.filter(r =>
      r.mapelNama.toLowerCase().includes(searchTerm) ||
      r.materiJudul.toLowerCase().includes(searchTerm)
    );
  }

  container.innerHTML = '';
  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 3rem 1rem; color: #64748B;">
        <span style="font-size: 3rem; display: block; margin-bottom: 0.5rem;">📜</span>
        <h4 style="font-size: 1.15rem; font-weight: 700; color: #1E293B;">Belum Ada Riwayat Kuis</h4>
        <p style="font-size: 0.85rem;">Pilih mata pelajaran dan materi di beranda untuk mulai mengerjakan kuis!</p>
      </div>
    `;
    return;
  }

  filtered.forEach(item => {
    const card = document.createElement('div');
    card.className = 'topic-card';

    const formattedDate = new Date(item.tanggal).toLocaleDateString('id-ID', {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    card.innerHTML = `
      <div class="topic-info">
        <h4>${item.materiJudul}</h4>
        <p>Kelas ${item.kelas} SD • ${item.mapelNama} • ${formattedDate}</p>
        <div class="topic-meta">
          <span class="topic-badge-pill" style="background: ${item.skor >= 70 ? '#D1FAE5' : '#FEF3C7'}; color: ${item.skor >= 70 ? '#065F46' : '#92400E'};">
            Skor: ${item.skor} (${item.jumlahBenar} Benar / ${item.jumlahSalah} Salah)
          </span>
        </div>
      </div>
      <button class="btn-play-topic" style="background: #4F46E5;" onclick="openReviewPageById('${item.id}')">
        Pembahasan 💡
      </button>
    `;
    container.appendChild(card);
  });
}

function openReviewPageById(resultId) {
  const found = state.resultsHistory.find(r => r.id === resultId);
  if (found) {
    openReviewPage(found);
  }
}

// ==========================================================================
// 14. LEADERBOARD SCREEN
// ==========================================================================
function updateLeaderboardMapelOptions() {
  const gradeFilter = document.getElementById('filter-lb-grade');
  const mapelFilter = document.getElementById('filter-lb-mapel');
  if (!mapelFilter) return;

  const currentVal = mapelFilter.value;
  mapelFilter.innerHTML = '<option value="all">Semua Mata Pelajaran</option>';

  const gradeVal = gradeFilter ? gradeFilter.value : 'all';
  let availableMapels = [];

  if (gradeVal === 'all') {
    const seenIds = new Set();
    ['faseA', 'faseB', 'faseC'].forEach(f => {
      if (KURIKULUM_STRUCTURE[f] && Array.isArray(KURIKULUM_STRUCTURE[f].mapel)) {
        KURIKULUM_STRUCTURE[f].mapel.forEach(m => {
          if (!seenIds.has(m.id)) {
            seenIds.add(m.id);
            availableMapels.push(m);
          }
        });
      }
    });
  } else {
    const g = parseInt(gradeVal, 10);
    let faseKey = g <= 2 ? 'faseA' : (g <= 4 ? 'faseB' : 'faseC');
    if (KURIKULUM_STRUCTURE[faseKey]) {
      availableMapels = KURIKULUM_STRUCTURE[faseKey].mapel;
    }
  }

  availableMapels.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = `${m.icon || '📚'} ${m.nama}`;
    if (m.id === currentVal) opt.selected = true;
    mapelFilter.appendChild(opt);
  });
}

function handleLeaderboardFilterChange() {
  updateLeaderboardMapelOptions();
  renderLeaderboardView();
}

function renderLeaderboardView() {
  const podiumContainer = document.getElementById('lb-podium-container');
  const tableContainer = document.getElementById('lb-table-container');
  const gradeFilter = document.getElementById('filter-lb-grade');
  const mapelFilter = document.getElementById('filter-lb-mapel');
  const headerSubtitle = document.getElementById('lb-header-subtitle');

  if (!podiumContainer || !tableContainer) return;

  const targetGrade = gradeFilter ? gradeFilter.value : 'all';
  const targetMapel = mapelFilter ? mapelFilter.value : 'all';

  let list = [...state.leaderboardData];

  // 1. Filter by Tingkat Kelas
  if (targetGrade !== 'all') {
    const g = parseInt(targetGrade, 10);
    list = list.filter(item => item.kelas === g);
  }

  // 2. Filter by Mata Pelajaran
  if (targetMapel !== 'all') {
    list = list.filter(item => item.mapelId === targetMapel);
  } else {
    // If "Semua Mata Pelajaran", aggregate points per student so each student appears once with their total points
    const studentMap = {};
    list.forEach(item => {
      const key = `${item.nama.toLowerCase()}_k${item.kelas}`;
      if (!studentMap[key]) {
        studentMap[key] = {
          ...item,
          totalPoin: item.totalPoin,
          sekolah: item.sekolah || 'SD Merdeka',
          mapelNama: targetGrade === 'all' ? 'Semua Pelajaran' : 'Akumulasi Mapel'
        };
      } else {
        studentMap[key].totalPoin += item.totalPoin;
        studentMap[key].streak = Math.max(studentMap[key].streak || 1, item.streak || 1);
      }
    });
    list = Object.values(studentMap);
  }

  list.sort((a, b) => b.totalPoin - a.totalPoin);

  // Update dynamic subtitle
  if (headerSubtitle) {
    const gradeLabel = targetGrade === 'all' ? 'Seluruh Kelas (1–6 SD)' : `Kelas ${targetGrade} SD`;
    let mapelLabel = 'Semua Mata Pelajaran';
    if (targetMapel !== 'all' && mapelFilter && mapelFilter.selectedIndex >= 0) {
      mapelLabel = mapelFilter.options[mapelFilter.selectedIndex].text;
    }
    headerSubtitle.textContent = `Papan Peringkat Terverifikasi: ${gradeLabel} • ${mapelLabel}`;
  }

  // Render Podium (Top 3)
  podiumContainer.innerHTML = '';
  const top1 = list[0];
  const top2 = list[1];
  const top3 = list[2];

  if (top2) {
    const av2 = getAvatarObject(top2.avatar);
    podiumContainer.innerHTML += `
      <div class="podium-item podium-second">
        <div class="podium-avatar-wrap">
          <div class="podium-avatar">${av2.emoji}</div>
        </div>
        <div class="podium-name">${top2.nama}</div>
        <div class="podium-school">🏫 ${top2.sekolah || 'SD Merdeka'}</div>
        <div class="podium-points">${top2.totalPoin} Poin</div>
        <div class="podium-block">2</div>
      </div>
    `;
  }

  if (top1) {
    const av1 = getAvatarObject(top1.avatar);
    podiumContainer.innerHTML += `
      <div class="podium-item podium-first">
        <div class="podium-avatar-wrap">
          <div class="podium-crown">👑</div>
          <div class="podium-avatar">${av1.emoji}</div>
        </div>
        <div class="podium-name">${top1.nama}</div>
        <div class="podium-school">🏫 ${top1.sekolah || 'SD Merdeka'}</div>
        <div class="podium-points">${top1.totalPoin} Poin</div>
        <div class="podium-block">1</div>
      </div>
    `;
  }

  if (top3) {
    const av3 = getAvatarObject(top3.avatar);
    podiumContainer.innerHTML += `
      <div class="podium-item podium-third">
        <div class="podium-avatar-wrap">
          <div class="podium-avatar">${av3.emoji}</div>
        </div>
        <div class="podium-name">${top3.nama}</div>
        <div class="podium-school">🏫 ${top3.sekolah || 'SD Merdeka'}</div>
        <div class="podium-points">${top3.totalPoin} Poin</div>
        <div class="podium-block">3</div>
      </div>
    `;
  }

  // Render Table List
  tableContainer.innerHTML = '';
  if (list.length === 0) {
    tableContainer.innerHTML = `
      <div style="text-align: center; padding: 2.5rem 1rem; color: #64748B;">
        <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">🌟</div>
        <h4 style="font-size: 1.1rem; color: #1E293B; margin-bottom: 0.25rem;">Belum Ada Nilai di Peringkat Ini</h4>
        <p style="font-size: 0.88rem;">Jadilah siswa pertama yang menyelesaikan kuis pada kelas dan mata pelajaran ini!</p>
      </div>
    `;
    return;
  }

  list.forEach((item, index) => {
    const av = getAvatarObject(item.avatar);
    const row = document.createElement('div');
    row.className = 'lb-row';

    let rankClass = '';
    if (index === 0) rankClass = 'gold';
    else if (index === 1) rankClass = 'silver';
    else if (index === 2) rankClass = 'bronze';

    const mapelBadge = item.mapelNama ? `<span style="background: #EEF2FF; color: #4338CA; font-size: 0.72rem; padding: 2px 7px; border-radius: 9999px; font-weight: 700; margin-left: 4px;">${item.mapelNama}</span>` : '';

    row.innerHTML = `
      <div class="lb-rank ${rankClass}">${index + 1}</div>
      <div class="lb-user">
        <div class="lb-user-avatar">${av.emoji}</div>
        <div class="lb-user-info">
          <h5>${item.nama} ${mapelBadge}</h5>
          <span>Kelas ${item.kelas} SD • 🏫 ${item.sekolah || 'SD Merdeka'} • 🔥 ${item.streak || 1} Hari</span>
        </div>
      </div>
      <div class="lb-pts">⭐ ${item.totalPoin}</div>
    `;
    tableContainer.appendChild(row);
  });
}

// ==========================================================================
// 15. ANALYTICS & STATS SCREEN
// ==========================================================================
function renderAnalyticsView() {
  const userResults = getUserResultsHistory();
  const totalCompleted = userResults.length;
  const avgEl = document.getElementById('analytics-avg-score');
  const favMapelEl = document.getElementById('analytics-fav-mapel');
  const highMateriEl = document.getElementById('analytics-highest-materi');
  const practiceMateriEl = document.getElementById('analytics-practice-materi');

  if (totalCompleted === 0) {
    if (avgEl) avgEl.textContent = '-';
    if (favMapelEl) favMapelEl.textContent = 'Belum Ada Data';
    if (highMateriEl) highMateriEl.textContent = 'Belum Ada Data';
    if (practiceMateriEl) practiceMateriEl.textContent = 'Belum Ada Data';
    drawStatsChart();
    return;
  }

  const totalScores = userResults.reduce((a, b) => a + b.skor, 0);
  if (avgEl) avgEl.textContent = Math.round(totalScores / totalCompleted);

  // Subject frequency
  const mapelCount = {};
  userResults.forEach(r => {
    mapelCount[r.mapelNama] = (mapelCount[r.mapelNama] || 0) + 1;
  });
  const favMapel = Object.keys(mapelCount).reduce((a, b) => mapelCount[a] > mapelCount[b] ? a : b);
  if (favMapelEl) favMapelEl.textContent = favMapel;

  // Best score topic
  const sorted = [...userResults].sort((a, b) => b.skor - a.skor);
  if (highMateriEl) highMateriEl.textContent = `${sorted[0].materiJudul} (${sorted[0].skor})`;
  if (practiceMateriEl) practiceMateriEl.textContent = `${sorted[sorted.length - 1].materiJudul} (${sorted[sorted.length - 1].skor})`;

  drawStatsChart();
}

function drawStatsChart() {
  const canvas = document.getElementById('stats-chart-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  const isDark = state.settings.theme === 'dark' || document.documentElement.getAttribute('data-theme') === 'dark';
  const textColor = isDark ? '#F8FAFC' : '#1E293B';
  const mutedTextColor = isDark ? '#94A3B8' : '#64748B';

  const userResults = getUserResultsHistory();
  const data = userResults.slice(0, 8).reverse().map(r => r.skor);
  if (data.length === 0) {
    ctx.fillStyle = mutedTextColor;
    ctx.font = '14px Plus Jakarta Sans, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Belum ada riwayat kuis untuk siswa ini', w / 2, h / 2);
    return;
  }

  // Draw chart grid & bars
  const padLeft = 30;
  const padBottom = 25;
  const chartW = w - padLeft - 20;
  const chartH = h - padBottom - 20;
  const barWidth = Math.min(36, chartW / data.length - 12);

  data.forEach((score, i) => {
    const x = padLeft + (i * (chartW / data.length)) + 10;
    const barH = (score / 100) * chartH;
    const y = h - padBottom - barH;

    // Bar gradient
    const grad = ctx.createLinearGradient(0, y, 0, y + barH);
    grad.addColorStop(0, '#4F46E5');
    grad.addColorStop(1, '#06B6D4');
    ctx.fillStyle = grad;

    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(x, y, barWidth, barH, [6, 6, 0, 0]);
    } else {
      ctx.rect(x, y, barWidth, barH);
    }
    ctx.fill();

    // Value text
    ctx.fillStyle = textColor;
    ctx.font = 'bold 11px Fredoka, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${score}`, x + barWidth / 2, y - 5);

    // X Axis label
    ctx.fillStyle = mutedTextColor;
    ctx.font = '10px Plus Jakarta Sans, sans-serif';
    ctx.fillText(`K${i + 1}`, x + barWidth / 2, h - 8);
  });
}

// ==========================================================================
// 16. BADGES SHOWCASE
// ==========================================================================
function renderBadgesShowcase() {
  const grid = document.getElementById('badges-showcase-grid');
  if (!grid) return;

  const earnedIds = state.user && state.user.badgesEarned ? state.user.badgesEarned : ['quiz_pertama'];
  grid.innerHTML = '';

  BADGE_DEFINITIONS.forEach(b => {
    const isUnlocked = earnedIds.includes(b.id);
    const item = document.createElement('div');
    item.className = `badge-card-item ${isUnlocked ? '' : 'locked'}`;

    item.innerHTML = `
      <div class="badge-card-icon">${b.icon}</div>
      <div class="badge-card-title">${b.nama}</div>
      <div class="badge-card-desc">${b.deskripsi}</div>
    `;
    grid.appendChild(item);
  });
}

// ==========================================================================
// 17. TEACHER / ADMIN MODE (BANK SOAL MANAGER)
// ==========================================================================
function setupTeacherMode() {
  const form = document.getElementById('form-add-question');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      saveNewCustomQuestion();
    });
  }

  const btnExport = document.getElementById('btn-export-json');
  if (btnExport) {
    btnExport.addEventListener('click', exportQuestionsJSON);
  }

  const btnImport = document.getElementById('input-import-json');
  if (btnImport) {
    btnImport.addEventListener('change', importQuestionsJSON);
  }

  // Word (.docx) & PDF (.pdf) Document Upload Listeners
  const inputDoc = document.getElementById('input-doc-file');
  if (inputDoc) {
    inputDoc.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        handleDocumentFileUpload(e.target.files[0]);
        e.target.value = ''; // Reset input
      }
    });
  }

  const dropzone = document.getElementById('doc-upload-dropzone');
  if (dropzone) {
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('drag-over');
    });
    dropzone.addEventListener('dragleave', () => {
      dropzone.classList.remove('drag-over');
    });
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleDocumentFileUpload(e.dataTransfer.files[0]);
      }
    });
  }

  const btnShowTemplate = document.getElementById('btn-show-template-info');
  if (btnShowTemplate) {
    btnShowTemplate.addEventListener('click', () => {
      document.getElementById('modal-template-info').classList.add('show');
    });
  }

  const btnSaveImported = document.getElementById('btn-save-imported-questions');
  if (btnSaveImported) {
    btnSaveImported.addEventListener('click', saveExtractedDocumentQuestions);
  }

  const btnSaveAllExcel = document.getElementById('btn-save-all-excel-sheets');
  if (btnSaveAllExcel) {
    btnSaveAllExcel.addEventListener('click', saveAllExcelExtractedSheets);
  }
}

// ==========================================================================
// 17B. WORD (.DOCX), PDF (.PDF), & EXCEL (.XLSX) DOCUMENT TEXT EXTRACTION
// ==========================================================================
function handleDocumentFileUpload(file) {
  if (!file) return;
  const fileName = file.name;
  const ext = fileName.split('.').pop().toLowerCase();

  showToast(`Membaca berkas: ${fileName}...`);

  if (ext === 'xlsx' || ext === 'xls') {
    // Process Excel Multi-Sheet via SheetJS
    handleExcelMultiSheetUpload(file);
    return;

  } else if (ext === 'docx') {
    // Process Word document via Mammoth.js
    if (typeof mammoth === 'undefined') {
      alert('Library Mammoth.js belum siap. Pastikan koneksi internet aktif.');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const arrayBuffer = e.target.result;
      mammoth.extractRawText({ arrayBuffer: arrayBuffer })
        .then((result) => {
          const text = result.value;
          const parsed = parseTextToQuizQuestions(text);
          showDocumentPreviewModal(fileName, parsed);
        })
        .catch((err) => {
          alert('Gagal mengekstrak berkas Word: ' + err.message);
        });
    };
    reader.readAsArrayBuffer(file);

  } else if (ext === 'pdf') {
    // Process PDF document via Mozilla PDF.js
    if (typeof pdfjsLib === 'undefined') {
      alert('Library PDF.js belum siap. Pastikan koneksi internet aktif.');
      return;
    }
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const typedarray = new Uint8Array(e.target.result);
        const pdf = await pdfjsLib.getDocument({ data: typedarray }).promise;
        let fullText = '';

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          const page = await pdf.getPage(pageNum);
          const textContent = await page.getTextContent();
          const pageText = textContent.items.map(item => item.str).join(' ');
          fullText += pageText + '\n';
        }

        const parsed = parseTextToQuizQuestions(fullText);
        showDocumentPreviewModal(fileName, parsed);
      } catch (err) {
        alert('Gagal mengekstrak berkas PDF: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);

  } else if (ext === 'txt') {
    // Plain text document
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      const parsed = parseTextToQuizQuestions(text);
      showDocumentPreviewModal(fileName, parsed);
    };
    reader.readAsText(file);

  } else {
    alert('Format file tidak didukung. Harap gunakan berkas Excel (.xlsx), Word (.docx), PDF (.pdf), atau Notepad (.txt).');
  }
}

// ==========================================================================
// 17C. EXCEL MULTI-SHEET PARSER & TEMPLATE GENERATOR
// ==========================================================================
function handleExcelMultiSheetUpload(file) {
  if (typeof XLSX === 'undefined') {
    alert('Library SheetJS (XLSX) belum siap. Pastikan koneksi internet aktif.');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const extractedSheets = [];

      const mapelNameMapping = {
        matematika: { id: 'matematika', nama: 'Matematika' },
        indonesia: { id: 'bindonesia', nama: 'Bahasa Indonesia' },
        ipas: { id: 'ipas', nama: 'IPAS (Sains & Sosial)' },
        pancasila: { id: 'pancasila', nama: 'Pendidikan Pancasila' },
        agama: { id: 'pai', nama: 'Pendidikan Agama & Budi Pekerti' },
        koding: { id: 'koding_ai', nama: 'Koding & AI' },
        ai: { id: 'koding_ai', nama: 'Koding & AI' },
        inggris: { id: 'binggris', nama: 'Bahasa Inggris' },
        seni: { id: 'senibudaya', nama: 'Seni dan Budaya' },
        pjok: { id: 'pjok', nama: 'PJOK' }
      };

      workbook.SheetNames.forEach((sheetName) => {
        const worksheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

        if (!rows || rows.length === 0) return;

        // Auto-detect grade from sheet name (e.g., "Kelas 1", "Kelas 4", "K2", "Sheet1")
        let grade = 1;
        const numMatch = sheetName.match(/(\d+)/);
        if (numMatch) {
          grade = Math.min(6, Math.max(1, parseInt(numMatch[1], 10)));
        } else if (/fase\s*a/i.test(sheetName)) {
          grade = 1;
        } else if (/fase\s*b/i.test(sheetName)) {
          grade = 3;
        } else if (/fase\s*c/i.test(sheetName)) {
          grade = 5;
        }

        const questionsInSheet = [];
        let detectedMapel = 'Matematika';
        let detectedMapelId = 'matematika';
        let detectedTopic = `Materi Kuis ${sheetName}`;

        rows.forEach((row, rIdx) => {
          // Normalize column keys
          const keys = Object.keys(row);
          const findVal = (terms) => {
            for (const t of terms) {
              const matchedKey = keys.find(k => k.toLowerCase().replace(/[^a-z0-9]/g, '').includes(t.toLowerCase().replace(/[^a-z0-9]/g, '')));
              if (matchedKey && String(row[matchedKey]).trim() !== '') return String(row[matchedKey]).trim();
            }
            return '';
          };

          const qText = findVal(['pertanyaan', 'soal', 'teks', 'question']);
          const optA = findVal(['pilihana', 'opsia', 'jawaba', 'a']);
          const optB = findVal(['pilihanb', 'opsib', 'jawabb', 'b']);
          const optC = findVal(['pilihanc', 'opsic', 'jawabc', 'c']);
          const optD = findVal(['pilihand', 'opsid', 'jawabd', 'd']);
          const rawKey = findVal(['kuncijawaban', 'kunci', 'jawaban', 'key']);
          const expl = findVal(['pembahasan', 'penjelasan', 'alasan', 'explanation']) || 'Pembahasan pemahaman konsep soal ini.';
          const rowMapel = findVal(['matapelajaran', 'mapel', 'subject']);
          const rowTopic = findVal(['topikmateri', 'topik', 'materi', 'judul', 'topic']);

          if (rowMapel) {
            detectedMapel = rowMapel;
            const lowM = rowMapel.toLowerCase();
            for (const k in mapelNameMapping) {
              if (lowM.includes(k)) {
                detectedMapelId = mapelNameMapping[k].id;
                detectedMapel = mapelNameMapping[k].nama;
                break;
              }
            }
          }

          if (rowTopic) {
            detectedTopic = rowTopic;
          }

          if (qText && optA && optB) {
            // Convert answer key to 0-3 index
            let keyIndex = 0;
            const cleanKey = rawKey.toUpperCase();
            if (cleanKey.includes('B') || cleanKey === '2') keyIndex = 1;
            else if (cleanKey.includes('C') || cleanKey === '3') keyIndex = 2;
            else if (cleanKey.includes('D') || cleanKey === '4') keyIndex = 3;

            questionsInSheet.push({
              id: `excel-${Date.now().toString(36)}-${grade}-${rIdx + 1}`,
              pertanyaan: qText,
              pilihan: [optA, optB, optC || 'Pilihan C', optD || 'Pilihan D'],
              jawabanBenar: keyIndex,
              pembahasan: expl,
              kesulitan: 'sedang',
              keyDetected: rawKey !== ''
            });
          }
        });

        if (questionsInSheet.length > 0) {
          extractedSheets.push({
            sheetName: sheetName,
            grade: grade,
            fase: grade <= 2 ? 'A' : (grade <= 4 ? 'B' : 'C'),
            mapelId: detectedMapelId,
            mapelNama: detectedMapel,
            judulMateri: detectedTopic,
            deskripsi: `Materi hasil unggahan Excel Multi-Sheet (${sheetName}) untuk Kelas ${grade} SD.`,
            soal: questionsInSheet
          });
        }
      });

      if (extractedSheets.length === 0) {
        alert('Tidak ditemukan data butir soal yang valid pada file Excel ini.\n\nPastikan kolom Excel memiliki header: Pertanyaan, Pilihan A, Pilihan B, Pilihan C, Pilihan D, dan Kunci Jawaban.');
        return;
      }

      showExcelMultiSheetPreviewModal(file.name, extractedSheets);
    } catch (err) {
      alert('Gagal memproses file Excel: ' + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
}

function showExcelMultiSheetPreviewModal(fileName, sheets) {
  const modal = document.getElementById('modal-excel-preview');
  const fileInfo = document.getElementById('excel-preview-file-info');
  const summaryText = document.getElementById('excel-preview-summary-text');
  const tabsContainer = document.getElementById('excel-sheet-tabs-container');

  state.excelExtractedSheets = sheets;
  state.activeExcelSheetIndex = 0;

  const totalQuestions = sheets.reduce((acc, s) => acc + s.soal.length, 0);

  if (fileInfo) fileInfo.textContent = `File: ${fileName}`;
  if (summaryText) summaryText.textContent = `${sheets.length} Sheet Kelas Ditemukan (Total ${totalQuestions} Butir Soal)`;

  // Render Sheet Tabs Buttons
  tabsContainer.innerHTML = '';
  sheets.forEach((sheetItem, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `excel-sheet-tab-btn ${idx === 0 ? 'active' : ''}`;
    btn.innerHTML = `📄 ${sheetItem.sheetName} (${sheetItem.soal.length} Soal)`;
    btn.onclick = () => switchActiveExcelSheetTab(idx);
    tabsContainer.appendChild(btn);
  });

  renderActiveExcelSheetView();

  document.getElementById('modal-teacher').classList.remove('show');
  modal.classList.add('show');
}

function switchActiveExcelSheetTab(index) {
  state.activeExcelSheetIndex = index;
  document.querySelectorAll('.excel-sheet-tab-btn').forEach((btn, idx) => {
    btn.classList.toggle('active', idx === index);
  });
  renderActiveExcelSheetView();
  playTone('click');
}

function renderActiveExcelSheetView() {
  const sheet = state.excelExtractedSheets[state.activeExcelSheetIndex];
  if (!sheet) return;

  const titleEl = document.getElementById('excel-active-sheet-title');
  const countEl = document.getElementById('excel-active-sheet-count');
  const listEl = document.getElementById('excel-active-sheet-questions-list');

  if (titleEl) titleEl.textContent = `Lembar: "${sheet.sheetName}" • Kelas ${sheet.grade} SD (${sheet.mapelNama})`;
  if (countEl) countEl.textContent = `${sheet.soal.length} Soal Terdeteksi`;

  listEl.innerHTML = '';
  const letters = ['A', 'B', 'C', 'D'];

  sheet.soal.forEach((q, qIdx) => {
    const card = document.createElement('div');
    card.className = 'doc-preview-item';

    card.innerHTML = `
      <div class="doc-preview-header">
        <span class="doc-preview-num">No. ${qIdx + 1} (${q.kesulitan.toUpperCase()})</span>
        <span class="doc-preview-status ${q.keyDetected ? 'ok' : 'warn'}">
          ${q.keyDetected ? `✓ Kunci: ${letters[q.jawabanBenar]}` : '⚠️ Periksa Kunci'}
        </span>
      </div>
      <div class="doc-preview-qtext">${q.pertanyaan}</div>
      <div class="doc-preview-opts-grid">
        ${q.pilihan.map((opt, oIdx) => `
          <div class="doc-preview-opt-row ${oIdx === q.jawabanBenar ? 'is-key' : ''}">
            <strong>${letters[oIdx]}.</strong> <span>${opt}</span>
          </div>
        `).join('')}
      </div>
      <div class="doc-preview-expl">
        💡 <strong>Pembahasan:</strong> ${q.pembahasan}
      </div>
    `;
    listEl.appendChild(card);
  });
}

function saveAllExcelExtractedSheets() {
  if (!state.excelExtractedSheets || state.excelExtractedSheets.length === 0) {
    alert('Tidak ada data sheet Excel untuk disimpan.');
    return;
  }

  const sheets = state.excelExtractedSheets;
  let totalSaved = 0;

  sheets.forEach((sheetPkg, sIdx) => {
    const newPkg = {
      id: `excel-pkg-${Date.now().toString(36)}-${sIdx}`,
      kelas: sheetPkg.grade,
      fase: sheetPkg.fase,
      mapelId: sheetPkg.mapelId,
      mapelNama: sheetPkg.mapelNama,
      judulMateri: sheetPkg.judulMateri,
      deskripsi: sheetPkg.deskripsi,
      soal: sheetPkg.soal
    };
    state.allQuizzes.push(newPkg);
    totalSaved += sheetPkg.soal.length;
  });

  // Save to LocalStorage
  const customOnly = state.allQuizzes.filter(q => q.id.startsWith('pkg-') || q.id.startsWith('custom-') || q.id.startsWith('doc-pkg-') || q.id.startsWith('excel-pkg-'));
  localStorage.setItem(APP_STORAGE_KEYS.CUSTOM_QUIZ, JSON.stringify(customOnly));

  document.getElementById('modal-excel-preview').classList.remove('show');
  showToast(`Hebat! ${totalSaved} butir soal dari ${sheets.length} sheet kelas berhasil ditambahkan! 🚀`);
  playTone('fanfare');

  // Switch to the grade of the first sheet
  state.selectedKelas = sheets[0].grade;
  updateFaseByKelas(sheets[0].grade);
  renderFaseAndGradeCards();
  renderSubjectsGrid();
}

/**
 * Generator Otomatis Berkas Excel Multi-Sheet (.xlsx) dengan 6 Tab Sheet Kelas 1 s.d. 6
 */
function generateAndDownloadExcelTemplate() {
  if (typeof XLSX === 'undefined') {
    alert('Library SheetJS belum siap. Pastikan internet aktif.');
    return;
  }

  showToast('Membuat berkas template Excel Multi-Sheet...');

  const wb = XLSX.utils.book_new();

  const templateClasses = [
    {
      sheetName: 'Kelas 1',
      mapel: 'Matematika',
      topik: 'Penjumlahan Ceria 1-10',
      sampleQ: [
        ['1', 'Matematika', 'Penjumlahan Ceria 1-10', 'Ada 3 buah apel merah dan 2 buah apel hijau. Berapa jumlah apel semuanya?', '4 apel', '5 apel', '6 apel', '7 apel', 'B', '3 + 2 = 5 apel.', 'mudah'],
        ['2', 'Matematika', 'Penjumlahan Ceria 1-10', 'Berapakah hasil dari 4 + 4 ?', '6', '7', '8', '9', 'C', '4 + 4 = 8.', 'mudah']
      ]
    },
    {
      sheetName: 'Kelas 2',
      mapel: 'Matematika',
      topik: 'Perkalian Dasar',
      sampleQ: [
        ['1', 'Matematika', 'Perkalian Dasar', 'Bentuk penjumlahan berulang dari perkalian 3 x 4 adalah...', '3 + 3 + 3 + 3', '4 + 4 + 4', '3 + 4', '4 + 3 + 4', 'B', '3 x 4 artinya 3 kelompok berisi 4 (4+4+4).', 'mudah'],
        ['2', 'Matematika', 'Perkalian Dasar', 'Berapakah hasil dari 2 x 5 ?', '7', '8', '10', '12', 'C', '2 x 5 = 10.', 'mudah']
      ]
    },
    {
      sheetName: 'Kelas 3',
      mapel: 'IPAS',
      topik: 'Bagian Tubuh Tumbuhan',
      sampleQ: [
        ['1', 'IPAS', 'Bagian Tubuh Tumbuhan', 'Bagian tumbuhan yang bertugas menyerap air dan zat hara dari dalam tanah adalah...', 'Daun', 'Akar', 'Bunga', 'Buah', 'B', 'Akar menyerap air dan mineral dari tanah.', 'mudah'],
        ['2', 'IPAS', 'Bagian Tubuh Tumbuhan', 'Tempat terjadinya proses fotosintesis pada tumbuhan adalah...', 'Batang', 'Akar', 'Daun', 'Biji', 'C', 'Daun memiliki klorofil untuk fotosintesis.', 'mudah']
      ]
    },
    {
      sheetName: 'Kelas 4',
      mapel: 'Pendidikan Pancasila',
      topik: 'Makna Sila-Sila Pancasila',
      sampleQ: [
        ['1', 'Pendidikan Pancasila', 'Makna Sila Pancasila', 'Simbol Bintang pada Garuda Pancasila merupakan lambang sila ke...', '1', '2', '3', '4', 'A', 'Sila ke-1 Ketuhanan Yang Maha Esa dilambangkan dengan Bintang.', 'mudah'],
        ['2', 'Pendidikan Pancasila', 'Makna Sila Pancasila', 'Semboyan bangsa Indonesia yang berarti berbeda-beda tetapi tetap satu jua adalah...', 'Tut Wuri Handayani', 'Bhinneka Tunggal Ika', 'Mitreka Satata', 'Garuda Jaya', 'B', 'Bhinneka Tunggal Ika adalah semboyan pemersatu bangsa.', 'mudah']
      ]
    },
    {
      sheetName: 'Kelas 5',
      mapel: 'IPAS',
      topik: 'Sistem Organ Pencernaan',
      sampleQ: [
        ['1', 'IPAS', 'Sistem Organ Pencernaan', 'Organ pertama tempat terjadinya pencernaan mekanik dan kimiawi pada manusia adalah...', 'Lambung', 'Mulut', 'Kerongkongan', 'Usus Halus', 'B', 'Pencernaan mekanik (gigi) dan kimiawi (ptialin) terjadi di mulut.', 'mudah'],
        ['2', 'IPAS', 'Sistem Organ Pencernaan', 'Gerakan meremas makanan di kerongkongan menuju lambung disebut gerakan...', 'Refleks', 'Peristaltik', 'Otomatis', 'Kontraksi', 'B', 'Gerak peristaltik meremas dan mendorong makanan.', 'mudah']
      ]
    },
    {
      sheetName: 'Kelas 6',
      mapel: 'Koding & AI',
      topik: 'Berpikir Komputasional',
      sampleQ: [
        ['1', 'Koding & AI', 'Berpikir Komputasional', 'Urutan langkah-langkah logis dan sistematis untuk memecahkan masalah komputasi disebut...', 'Algoritma', 'Variabel', 'Database', 'Hardware', 'A', 'Algoritma adalah serangkaian instruksi terstruktur.', 'mudah'],
        ['2', 'Koding & AI', 'Berpikir Komputasional', 'Kesalahan penulisan kode atau instruksi yang membuat program komputer tidak berjalan semestinya disebut...', 'Bug', 'Byte', 'Bit', 'Chip', 'A', 'Bug adalah istilah populer untuk kesalahan kode.', 'mudah']
      ]
    }
  ];

  const headerRow = [
    'No',
    'Mata Pelajaran',
    'Topik Materi',
    'Pertanyaan',
    'Pilihan A',
    'Pilihan B',
    'Pilihan C',
    'Pilihan D',
    'Kunci Jawaban',
    'Pembahasan',
    'Tingkat Kesulitan'
  ];

  templateClasses.forEach((cls) => {
    const sheetData = [headerRow, ...cls.sampleQ];
    const ws = XLSX.utils.aoa_to_sheet(sheetData);

    // Set column widths for comfortable editing in Excel
    ws['!cols'] = [
      { wch: 5 },  // No
      { wch: 18 }, // Mapel
      { wch: 22 }, // Topik
      { wch: 45 }, // Pertanyaan
      { wch: 20 }, // Pilihan A
      { wch: 20 }, // Pilihan B
      { wch: 20 }, // Pilihan C
      { wch: 20 }, // Pilihan D
      { wch: 14 }, // Kunci
      { wch: 35 }, // Pembahasan
      { wch: 12 }  // Kesulitan
    ];

    XLSX.utils.book_append_sheet(wb, ws, cls.sheetName);
  });

  // Write and trigger download
  XLSX.writeFile(wb, 'Template_Bank_Soal_SD_MultiSheet.xlsx');
  showToast('Template Excel Multi-Sheet berhasil diunduh! 📊');
}

/**
 * Intelligent Smart Parser untuk mengenali butir soal, opsi A-D, kunci jawaban, dan pembahasan.
 */
function parseTextToQuizQuestions(rawText) {
  if (!rawText || rawText.trim() === '') return [];

  // Normalize line breaks
  const text = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Regex pattern to split by question blocks (e.g., "1.", "No. 1.", "Soal 1:")
  const questionBlockRegex = /(?:^|\n)\s*(?:soal\s*)?(?:no\.?\s*)?(\d+)[\.\)\:\-]\s*([\s\S]*?)(?=(?:\n\s*(?:soal\s*)?(?:no\.?\s*)?\d+[\.\)\:\-]|$))/gi;
  const questions = [];
  let match;

  while ((match = questionBlockRegex.exec(text)) !== null) {
    const qNum = match[1];
    const blockContent = match[2].trim();

    // Extract options A, B, C, D
    const optAReg = /(?:^|\n)\s*[A|a][\.\)\:\-]\s*([^\n]+)/;
    const optBReg = /(?:^|\n)\s*[B|b][\.\)\:\-]\s*([^\n]+)/;
    const optCReg = /(?:^|\n)\s*[C|c][\.\)\:\-]\s*([^\n]+)/;
    const optDReg = /(?:^|\n)\s*[D|d][\.\)\:\-]\s*([^\n]+)/;

    const optAMatch = blockContent.match(optAReg);
    const optBMatch = blockContent.match(optBReg);
    const optCMatch = blockContent.match(optCReg);
    const optDMatch = blockContent.match(optDReg);

    // Question statement is everything before option A
    let questionText = blockContent;
    if (optAMatch && optAMatch.index !== undefined) {
      questionText = blockContent.substring(0, optAMatch.index).trim();
    }

    // Extract Answer Key (e.g., "Kunci: B" or "Jawaban: C")
    const keyReg = /(?:kunci(?:\s*jawaban)?|jawaban)\s*[:\-\=]\s*([A-Da-d])/i;
    const keyMatch = blockContent.match(keyReg);
    let correctIndex = 0; // Default to A
    let keyDetected = false;

    if (keyMatch) {
      keyDetected = true;
      const letter = keyMatch[1].toUpperCase();
      if (letter === 'A') correctIndex = 0;
      else if (letter === 'B') correctIndex = 1;
      else if (letter === 'C') correctIndex = 2;
      else if (letter === 'D') correctIndex = 3;
    }

    // Extract Explanation
    const explReg = /(?:pembahasan|penjelasan|alasan)\s*[:\-\=]\s*([^\n]+(?:\n[^\n]+)*)/i;
    const explMatch = blockContent.match(explReg);
    let explanationText = explMatch ? explMatch[1].trim() : 'Pembahasan untuk pemahaman konsep soal ini.';

    // Prepare choices array
    const choices = [
      optAMatch ? optAMatch[1].trim() : 'Pilihan A',
      optBMatch ? optBMatch[1].trim() : 'Pilihan B',
      optCMatch ? optCMatch[1].trim() : 'Pilihan C',
      optDMatch ? optDMatch[1].trim() : 'Pilihan D'
    ];

    // Clean question text from any trailing artifacts
    questionText = questionText.replace(/\n+/g, ' ').trim();

    if (questionText.length > 5) {
      questions.push({
        id: `extracted-${Date.now().toString(36)}-${qNum}`,
        pertanyaan: questionText,
        pilihan: choices,
        jawabanBenar: correctIndex,
        pembahasan: explanationText,
        kesulitan: 'sedang',
        keyDetected: keyDetected
      });
    }
  }

  return questions;
}

function showDocumentPreviewModal(fileName, parsedQuestions) {
  const modal = document.getElementById('modal-doc-preview');
  const filenameLabel = document.getElementById('doc-preview-filename');
  const countBadge = document.getElementById('doc-preview-count-badge');
  const listContainer = document.getElementById('doc-preview-items-list');
  const topicInput = document.getElementById('preview-target-topic');

  if (!parsedQuestions || parsedQuestions.length === 0) {
    alert('Sistem tidak menemukan format butir soal yang sesuai pada dokumen ini.\n\nPastikan format soal diawali nomor (1., 2.), pilihan (A., B., C., D.), dan baris Kunci: X.');
    return;
  }

  // Pre-fill clean topic title from file name
  const cleanName = fileName.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
  if (topicInput) topicInput.value = cleanName;

  if (filenameLabel) filenameLabel.textContent = `File: ${fileName}`;
  if (countBadge) countBadge.textContent = `${parsedQuestions.length} Butir Soal Terdeteksi`;

  state.extractedQuestions = parsedQuestions;
  listContainer.innerHTML = '';

  const letters = ['A', 'B', 'C', 'D'];
  parsedQuestions.forEach((q, idx) => {
    const card = document.createElement('div');
    card.className = 'doc-preview-item';

    card.innerHTML = `
      <div class="doc-preview-header">
        <span class="doc-preview-num">Soal No. ${idx + 1}</span>
        <span class="doc-preview-status ${q.keyDetected ? 'ok' : 'warn'}">
          ${q.keyDetected ? '✓ Kunci Terdeteksi' : '⚠️ Periksa Kunci'}
        </span>
      </div>
      <div class="doc-preview-qtext">${q.pertanyaan}</div>
      <div class="doc-preview-opts-grid">
        ${q.pilihan.map((opt, oIdx) => `
          <div class="doc-preview-opt-row ${oIdx === q.jawabanBenar ? 'is-key' : ''}">
            <strong>${letters[oIdx]}.</strong> <span>${opt}</span>
          </div>
        `).join('')}
      </div>
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.35rem;">
        <div style="display: flex; align-items: center; gap: 0.4rem; font-size: 0.85rem;">
          <label style="font-weight: 700; color: #1E293B;">Kunci Jawaban Benar:</label>
          <select class="doc-preview-key-select" onchange="updateExtractedKey(${idx}, this.value)">
            <option value="0" ${q.jawabanBenar === 0 ? 'selected' : ''}>Pilihan A</option>
            <option value="1" ${q.jawabanBenar === 1 ? 'selected' : ''}>Pilihan B</option>
            <option value="2" ${q.jawabanBenar === 2 ? 'selected' : ''}>Pilihan C</option>
            <option value="3" ${q.jawabanBenar === 3 ? 'selected' : ''}>Pilihan D</option>
          </select>
        </div>
      </div>
      <div class="doc-preview-expl">
        💡 <strong>Pembahasan:</strong> ${q.pembahasan}
      </div>
    `;
    listContainer.appendChild(card);
  });

  // Close teacher form modal & open preview modal
  document.getElementById('modal-teacher').classList.remove('show');
  modal.classList.add('show');
}

function updateExtractedKey(questionIndex, newKeyVal) {
  if (state.extractedQuestions && state.extractedQuestions[questionIndex]) {
    state.extractedQuestions[questionIndex].jawabanBenar = parseInt(newKeyVal, 10);
    state.extractedQuestions[questionIndex].keyDetected = true;
  }
}

function saveExtractedDocumentQuestions() {
  const grade = parseInt(document.getElementById('preview-target-grade').value, 10);
  const mapelId = document.getElementById('preview-target-mapel').value;
  const topicName = document.getElementById('preview-target-topic').value.trim();

  if (!topicName) {
    alert('Harap isi Nama Materi / Topik terlebih dahulu!');
    return;
  }

  if (!state.extractedQuestions || state.extractedQuestions.length === 0) {
    alert('Tidak ada butir soal untuk disimpan.');
    return;
  }

  const mapelNames = {
    matematika: 'Matematika',
    bindonesia: 'Bahasa Indonesia',
    ipas: 'IPAS (Sains & Sosial)',
    pancasila: 'Pendidikan Pancasila',
    koding_ai: 'Koding & AI',
    binggris: 'Bahasa Inggris',
    senibudaya: 'Seni Budaya',
    pjok: 'PJOK',
    mulok: 'Muatan Lokal',
    p5: 'Kokurikuler / P5'
  };

  const newPackage = {
    id: 'doc-pkg-' + Date.now().toString(36),
    kelas: grade,
    fase: grade <= 2 ? 'A' : (grade <= 4 ? 'B' : 'C'),
    mapelId: mapelId,
    mapelNama: mapelNames[mapelId] || 'Mata Pelajaran',
    judulMateri: topicName,
    deskripsi: `Materi hasil unggahan dokumen guru untuk Kelas ${grade} SD (${state.extractedQuestions.length} Soal).`,
    soal: state.extractedQuestions
  };

  state.allQuizzes.push(newPackage);
  saveCustomQuizzesToStorage();

  document.getElementById('modal-doc-preview').classList.remove('show');
  showToast(`Berhasil menyimpan ${state.extractedQuestions.length} butir soal ke Bank Data! 🎉`);
  playTone('fanfare');

  state.selectedKelas = grade;
  updateFaseByKelas(grade);
  renderFaseAndGradeCards();
  renderSubjectsGrid();
}

function downloadSampleWordTemplate() {
  const sampleContent = `KUISPINTAR SD - CONTOH FORMAT BANK SOAL RESMI
Format Standar Ekstraksi Word (.docx), PDF (.pdf), dan Teks (.txt)

1. Ada 3 buah apel merah dan 2 apel hijau di atas meja. Berapa jumlah semua apel?
A. 4 buah apel
B. 5 buah apel
C. 6 buah apel
D. 7 buah apel
Kunci: B
Pembahasan: 3 apel + 2 apel = 5 buah apel.

2. Lawan kata (antonim) dari kata BESAR adalah...
A. Tinggi
B. Kecil
C. Panjang
D. Lebar
Kunci: B
Pembahasan: Lawan kata dari besar adalah kecil.

3. Bagian tumbuhan yang bertugas menyerap air dari dalam tanah adalah...
A. Daun
B. Akar
C. Batang
D. Biji
Kunci: B
Pembahasan: Akar menancap di tanah dan menyerap air serta unsur hara.

4. Simbol sila pertama Pancasila "Ketuhanan Yang Maha Esa" adalah...
A. Bintang
B. Rantai
C. Pohon Beringin
D. Kepala Banteng
Kunci: A
Pembahasan: Sila ke-1 dilambangkan dengan Bintang emas bersudut lima.

5. Urutan langkah-langkah logis untuk menyelesaikan suatu masalah komputasi disebut...
A. Algoritma
B. Variabel
C. Monitor
D. Kabel
Kunci: A
Pembahasan: Algoritma adalah urutan instruksi sistematis untuk memecahkan masalah.
`;

  const blob = new Blob([sampleContent], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'Contoh_Format_Soal_KuisPintar_SD.txt';
  a.click();
  URL.revokeObjectURL(url);
  showToast('Contoh format soal berhasil diunduh!');
}

// ==========================================================================
// 17. TEACHER MODE SECURITY & QUESTION MANAGEMENT (CRUD)
// ==========================================================================
function openTeacherGate() {
  playTone('click');
  const pinInput = document.getElementById('input-teacher-pin');
  const errEl = document.getElementById('teacher-gate-error');
  if (pinInput) pinInput.value = '';
  if (errEl) errEl.style.display = 'none';

  const modal = document.getElementById('modal-teacher-gate');
  if (modal) modal.classList.add('show');
}

function verifyTeacherGate() {
  const pinInput = document.getElementById('input-teacher-pin');
  const errEl = document.getElementById('teacher-gate-error');
  const pin = pinInput ? pinInput.value.trim() : '';

  if (pin === '1234' || pin === '0000') {
    playTone('correct');
    const gateModal = document.getElementById('modal-teacher-gate');
    if (gateModal) gateModal.classList.remove('show');

    // Switch active role to teacher
    finalizeRoleSwitch('teacher', false);

    renderTeacherCustomQuestionsList();
    const teacherModal = document.getElementById('modal-teacher');
    if (teacherModal) teacherModal.classList.add('show');
    showToast('Akses Pendidik Terverifikasi ✓ Selamat datang di Mode Guru.');
  } else {
    playTone('wrong');
    if (errEl) errEl.style.display = 'block';
  }
}

function switchTeacherTab(tabName) {
  playTone('click');
  const tabAddBtn = document.getElementById('tab-btn-add-q');
  const tabListBtn = document.getElementById('tab-btn-list-q');
  const tabAddContent = document.getElementById('teacher-tab-add');
  const tabListContent = document.getElementById('teacher-tab-list');

  if (tabName === 'add') {
    if (tabAddBtn) tabAddBtn.classList.add('active');
    if (tabListBtn) tabListBtn.classList.remove('active');
    if (tabAddContent) tabAddContent.style.display = 'block';
    if (tabListContent) tabListContent.style.display = 'none';
  } else {
    if (tabAddBtn) tabAddBtn.classList.remove('active');
    if (tabListBtn) tabListBtn.classList.add('active');
    if (tabAddContent) tabAddContent.style.display = 'none';
    if (tabListContent) tabListContent.style.display = 'block';
    renderTeacherCustomQuestionsList();
  }
}

function getAllCustomQuestions() {
  const list = [];
  state.allQuizzes.forEach(pkg => {
    if (Array.isArray(pkg.soal)) {
      pkg.soal.forEach(q => {
        if (q.id && (q.id.startsWith('custom-') || q.id.startsWith('extracted-') || pkg.isCustom || pkg.id.startsWith('pkg-') || pkg.id.startsWith('doc-pkg-'))) {
          list.push({
            packageId: pkg.id,
            grade: pkg.kelas,
            mapelId: pkg.mapelId,
            mapelNama: pkg.mapelNama,
            materiJudul: pkg.judulMateri,
            question: q
          });
        }
      });
    }
  });
  return list;
}

function renderTeacherCustomQuestionsList() {
  const container = document.getElementById('teacher-custom-questions-table');
  const countBadge = document.getElementById('teacher-custom-count');
  if (!container) return;

  const customItems = getAllCustomQuestions();
  if (countBadge) countBadge.textContent = customItems.length;

  if (customItems.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 2rem 1rem; color: #94A3B8; background: var(--bg-card); border-radius: 12px; border: 1.5px dashed var(--border-light);">
        <span style="font-size: 2rem; display: block; margin-bottom: 0.5rem;">📝</span>
        <strong style="color: var(--text-main);">Belum Ada Butir Soal Kustom</strong>
        <p style="font-size: 0.82rem; margin: 0.25rem 0 0 0;">Soal yang Bapak/Ibu input secara manual atau melalui upload berkas akan muncul di sini dan dapat diedit atau dihapus.</p>
      </div>
    `;
    return;
  }

  const letters = ['A', 'B', 'C', 'D'];
  container.innerHTML = '';

  customItems.forEach(item => {
    const q = item.question;
    const card = document.createElement('div');
    card.className = 'teacher-q-item-card';
    card.style = 'background: var(--bg-card); border: 1.5px solid var(--border-light); border-radius: 12px; padding: 0.85rem; display: flex; flex-direction: column; gap: 0.5rem;';
    
    card.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.4rem;">
        <div style="display: flex; gap: 0.35rem; align-items: center; flex-wrap: wrap;">
          <span class="topic-badge-pill" style="background: #E0E7FF; color: #4338CA; font-size: 0.75rem;">Kelas ${item.grade}</span>
          <span class="topic-badge-pill" style="background: #FEF3C7; color: #92400E; font-size: 0.75rem;">${item.mapelNama}</span>
          <span style="font-size: 0.78rem; font-weight: 700; color: var(--text-main);">${item.materiJudul}</span>
        </div>
        <div style="display: flex; gap: 0.35rem;">
          <button type="button" class="btn-secondary-action" onclick="editCustomQuestion('${q.id}')" style="padding: 0.25rem 0.65rem; font-size: 0.78rem; border-radius: 8px;">
            ✏️ Edit
          </button>
          <button type="button" class="btn-secondary-action" onclick="deleteCustomQuestion('${q.id}')" style="padding: 0.25rem 0.65rem; font-size: 0.78rem; border-radius: 8px; color: #EF4444;">
            🗑️ Hapus
          </button>
        </div>
      </div>
      <div style="font-size: 0.88rem; font-weight: 600; color: var(--text-main); line-height: 1.4;">
        ${q.pertanyaan}
      </div>
      <div style="font-size: 0.8rem; color: #64748B; display: grid; grid-template-columns: 1fr 1fr; gap: 0.25rem;">
        ${q.pilihan.map((opt, optIdx) => `
          <div style="${optIdx === q.jawabanBenar ? 'font-weight: 700; color: #10B981;' : ''}">
            ${letters[optIdx]}. ${opt} ${optIdx === q.jawabanBenar ? '✓' : ''}
          </div>
        `).join('')}
      </div>
    `;
    container.appendChild(card);
  });
}

function editCustomQuestion(qId) {
  playTone('click');
  const customItems = getAllCustomQuestions();
  const found = customItems.find(item => item.question.id === qId);
  if (!found) return;

  const q = found.question;
  const editIdInput = document.getElementById('teacher-editing-id');
  if (editIdInput) editIdInput.value = q.id;

  const gradeSelect = document.getElementById('teacher-grade');
  if (gradeSelect) gradeSelect.value = found.grade;

  const mapelSelect = document.getElementById('teacher-mapel');
  if (mapelSelect) mapelSelect.value = found.mapelId;

  const materiInput = document.getElementById('teacher-materi');
  if (materiInput) materiInput.value = found.materiJudul;

  const qTextInput = document.getElementById('teacher-qtext');
  if (qTextInput) qTextInput.value = q.pertanyaan;

  const optA = document.getElementById('teacher-opt-a');
  if (optA) optA.value = q.pilihan[0] || '';
  const optB = document.getElementById('teacher-opt-b');
  if (optB) optB.value = q.pilihan[1] || '';
  const optC = document.getElementById('teacher-opt-c');
  if (optC) optC.value = q.pilihan[2] || '';
  const optD = document.getElementById('teacher-opt-d');
  if (optD) optD.value = q.pilihan[3] || '';

  const correctSelect = document.getElementById('teacher-correct');
  if (correctSelect) correctSelect.value = q.jawabanBenar;

  const explInput = document.getElementById('teacher-expl');
  if (explInput) explInput.value = q.pembahasan || '';

  const titleEl = document.getElementById('teacher-form-title');
  if (titleEl) titleEl.textContent = '✏️ Edit Butir Soal Kustom';

  const btnSubmit = document.getElementById('btn-submit-teacher-q');
  if (btnSubmit) btnSubmit.textContent = 'Perbarui Soal 💾';

  const btnCancel = document.getElementById('btn-cancel-teacher-edit');
  if (btnCancel) btnCancel.style.display = 'block';

  switchTeacherTab('add');
}

function cancelTeacherEdit() {
  playTone('click');
  const editIdInput = document.getElementById('teacher-editing-id');
  if (editIdInput) editIdInput.value = '';

  const form = document.getElementById('form-add-question');
  if (form) form.reset();

  const titleEl = document.getElementById('teacher-form-title');
  if (titleEl) titleEl.textContent = 'Tambah Butir Soal Baru';

  const btnSubmit = document.getElementById('btn-submit-teacher-q');
  if (btnSubmit) btnSubmit.textContent = 'Simpan Soal ke Bank Data 💾';

  const btnCancel = document.getElementById('btn-cancel-teacher-edit');
  if (btnCancel) btnCancel.style.display = 'none';
}

function deleteCustomQuestion(qId) {
  playTone('click');
  if (!confirm('Yakin ingin menghapus butir soal ini dari bank data?')) return;

  state.allQuizzes.forEach(pkg => {
    if (Array.isArray(pkg.soal)) {
      pkg.soal = pkg.soal.filter(q => q.id !== qId);
    }
  });

  saveCustomQuizzesToStorage();
  renderTeacherCustomQuestionsList();
  renderSubjectsGrid();
  showToast('Butir soal berhasil dihapus dari bank soal.');
}

function saveCustomQuizzesToStorage() {
  const customQuizzes = state.allQuizzes.filter(q => q.isCustom || q.id.startsWith('pkg-') || q.id.startsWith('doc-pkg-'));
  
  const customQuestionsInDefaults = [];
  state.allQuizzes.forEach(pkg => {
    if (!pkg.isCustom && !pkg.id.startsWith('pkg-') && !pkg.id.startsWith('doc-pkg-')) {
      const customs = (pkg.soal || []).filter(q => q.id && (q.id.startsWith('custom-') || q.id.startsWith('extracted-')));
      if (customs.length > 0) {
        customQuestionsInDefaults.push({
          targetPackageId: pkg.id,
          soalList: customs
        });
      }
    }
  });

  const storageData = {
    customPackages: customQuizzes,
    customAdditions: customQuestionsInDefaults
  };

  localStorage.setItem(APP_STORAGE_KEYS.CUSTOM_QUIZ, JSON.stringify(storageData));
}

function saveNewCustomQuestion() {
  const editingId = document.getElementById('teacher-editing-id') ? document.getElementById('teacher-editing-id').value.trim() : '';
  const grade = parseInt(document.getElementById('teacher-grade').value, 10);
  const mapelId = document.getElementById('teacher-mapel').value;
  const materi = document.getElementById('teacher-materi').value.trim();
  const qText = document.getElementById('teacher-qtext').value.trim();
  const optA = document.getElementById('teacher-opt-a').value.trim();
  const optB = document.getElementById('teacher-opt-b').value.trim();
  const optC = document.getElementById('teacher-opt-c').value.trim();
  const optD = document.getElementById('teacher-opt-d').value.trim();
  const correctKey = parseInt(document.getElementById('teacher-correct').value, 10);
  const expl = document.getElementById('teacher-expl').value.trim();

  if (!materi || !qText || !optA || !optB || !optC || !optD || !expl) {
    showToast('Harap lengkapi semua kolom butir soal!');
    return;
  }

  const mapelNames = {
    matematika: 'Matematika',
    bindonesia: 'Bahasa Indonesia',
    ipas: 'IPAS (Sains & Sosial)',
    pancasila: 'Pendidikan Pancasila',
    koding_ai: 'Koding & AI',
    binggris: 'Bahasa Inggris',
    senibudaya: 'Seni dan Budaya',
    pjok: 'PJOK'
  };

  if (editingId) {
    // Mode Perbarui / Edit Soal
    let found = false;
    state.allQuizzes.forEach(pkg => {
      if (Array.isArray(pkg.soal)) {
        const qIdx = pkg.soal.findIndex(q => q.id === editingId);
        if (qIdx !== -1) {
          pkg.soal[qIdx] = {
            id: editingId,
            pertanyaan: qText,
            pilihan: [optA, optB, optC, optD],
            jawabanBenar: correctKey,
            pembahasan: expl,
            kesulitan: 'sedang'
          };
          found = true;
        }
      }
    });

    cancelTeacherEdit();
    saveCustomQuizzesToStorage();
    renderTeacherCustomQuestionsList();
    renderSubjectsGrid();
    showToast('Butir soal berhasil diperbarui! 💾');
    return;
  }

  // Tambah Soal Baru
  const newQuestion = {
    id: 'custom-' + Date.now().toString(36),
    pertanyaan: qText,
    pilihan: [optA, optB, optC, optD],
    jawabanBenar: correctKey,
    pembahasan: expl,
    kesulitan: 'sedang'
  };

  let pkg = state.allQuizzes.find(q => q.kelas === grade && q.mapelId === mapelId && q.judulMateri.toLowerCase() === materi.toLowerCase());
  if (!pkg) {
    pkg = {
      id: 'pkg-' + Date.now().toString(36),
      kelas: grade,
      fase: grade <= 2 ? 'A' : (grade <= 4 ? 'B' : 'C'),
      mapelId: mapelId,
      mapelNama: mapelNames[mapelId] || 'Mata Pelajaran',
      judulMateri: materi,
      deskripsi: `Materi kustom guru untuk kelas ${grade} SD.`,
      isCustom: true,
      soal: [newQuestion]
    };
    state.allQuizzes.push(pkg);
  } else {
    pkg.soal.push(newQuestion);
  }

  saveCustomQuizzesToStorage();
  document.getElementById('form-add-question').reset();
  renderTeacherCustomQuestionsList();
  renderSubjectsGrid();
  showToast('Soal baru berhasil disimpan ke Bank Soal! 🎉');
}

function exportQuestionsJSON() {
  const jsonStr = JSON.stringify(state.allQuizzes, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Bank_Soal_KuisPintar_SD_${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Bank soal berhasil diekspor ke file JSON!');
}

function importQuestionsJSON(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (Array.isArray(data)) {
        // Safe Merge: tidak menimpa atau menduplikasi default packages
        data.forEach(importedPkg => {
          const existing = state.allQuizzes.find(p => p.id === importedPkg.id);
          if (existing) {
            if (Array.isArray(importedPkg.soal)) {
              importedPkg.soal.forEach(q => {
                if (!existing.soal.some(exQ => exQ.id === q.id || exQ.pertanyaan === q.pertanyaan)) {
                  existing.soal.push(q);
                }
              });
            }
          } else {
            importedPkg.isCustom = true;
            state.allQuizzes.push(importedPkg);
          }
        });

        saveCustomQuizzesToStorage();
        showToast('Bank soal berhasil diimpor & disinkronkan secara aman! 🎉');
        renderTeacherCustomQuestionsList();
        renderSubjectsGrid();
      } else {
        alert('Format file JSON tidak sesuai.');
      }
    } catch (err) {
      alert('Gagal membaca file JSON: ' + err.message);
    }
  };
  reader.readAsText(file);
}

// ==========================================================================
// 18. MODALS & TOGGLES CONTROLLER
// ==========================================================================
function setupModals() {
  // Profile Modal
  const inputNama = document.getElementById('input-player-name');
  if (inputNama) {
    inputNama.addEventListener('input', validateProfileInput);
  }

  const btnSaveProfile = document.getElementById('btn-save-profile');
  if (btnSaveProfile) {
    btnSaveProfile.addEventListener('click', () => {
      const nameVal = (inputNama && inputNama.value.trim()) ? inputNama.value.trim() : 'Teman Belajar';
      const inputSchoolEl = document.getElementById('input-player-school');
      const schoolVal = (inputSchoolEl && inputSchoolEl.value.trim()) ? inputSchoolEl.value.trim() : ((state.user && state.user.sekolah) ? state.user.sekolah : 'SD Merdeka');
      const selectGradeEl = document.getElementById('select-player-grade');
      const gradeVal = selectGradeEl ? parseInt(selectGradeEl.value, 10) : 1;

      if (!state.user) {
        state.user = { id: 'USR-' + Date.now().toString(36), avatar: 'kucing', totalPoin: 0, level: 1, streak: 1, badgesEarned: ['quiz_pertama'], kelasLocked: true, quizStreakCount: 0 };
      }

      state.user.nama = nameVal;
      state.user.sekolah = schoolVal;

      // Only allow setting grade if not yet locked
      if (!state.user.kelasLocked) {
        state.user.kelas = gradeVal;
        state.user.kelasLocked = true;
        state.selectedKelas = gradeVal;
        updateFaseByKelas(gradeVal);
      } else {
        // Keep locked grade
        state.selectedKelas = state.user.kelas;
        updateFaseByKelas(state.user.kelas);
      }

      saveUserData();
      syncUserToLeaderboard();
      renderFaseAndGradeCards();
      renderSubjectsGrid();
      updateDashboardStats();
      renderHistoryView();
      renderAnalyticsView();

      document.getElementById('modal-profile').classList.remove('show');
      showToast(`Profil ${nameVal} (${schoolVal}) berhasil disimpan!`);
      playTone('correct');
    });
  }

  const btnGuest = document.getElementById('btn-guest-profile');
  if (btnGuest) {
    btnGuest.addEventListener('click', () => {
      if (!state.user) {
        state.user = { id: 'USR-' + Date.now().toString(36), nama: 'Teman Belajar', sekolah: 'SD Merdeka', avatar: 'kucing', kelas: 1, kelasLocked: true, quizStreakCount: 0, totalPoin: 0, level: 1, streak: 1, badgesEarned: ['quiz_pertama'] };
      }
      state.user.nama = state.user.nama || 'Teman Belajar';
      state.user.sekolah = state.user.sekolah || 'SD Merdeka';
      state.user.kelas = state.user.kelas || 1;
      state.user.kelasLocked = true;
      saveUserData();
      updateDashboardStats();
      renderSubjectsGrid();
      renderHistoryView();
      renderAnalyticsView();
      document.getElementById('modal-profile').classList.remove('show');
      showToast('Selamat bermain sebagai Teman Belajar! 🚀');
      playTone('click');
    });
  }

  // Close modals on overlay backdrop
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        if (overlay.id === 'modal-role-selector' && !state.currentRole) {
          // Mandatory role selection on initial startup
          return;
        }
        overlay.classList.remove('show');
      }
    });
  });

  // Modal Close Buttons
  document.querySelectorAll('.modal-close-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const modal = btn.closest('.modal-overlay');
      if (modal) modal.classList.remove('show');
    });
  });

  // Open Google Auth Simulation Modal
  const btnGoogle = document.getElementById('btn-google-login');
  if (btnGoogle) {
    btnGoogle.addEventListener('click', () => {
      const gNameInput = document.getElementById('google-auth-name');
      const gSchoolInput = document.getElementById('google-auth-school');
      const gEmailInput = document.getElementById('google-auth-email');
      if (gNameInput && state.user && state.user.nama && state.user.nama !== 'Teman Belajar') {
        gNameInput.value = state.user.nama;
      }
      if (gSchoolInput && state.user && state.user.sekolah) {
        gSchoolInput.value = state.user.sekolah;
      }
      if (gEmailInput && state.user && state.user.email) {
        gEmailInput.value = state.user.email;
      }
      document.getElementById('modal-google-auth').classList.add('show');
    });
  }

  const btnConfirmGoogle = document.getElementById('btn-confirm-google-auth');
  if (btnConfirmGoogle) {
    btnConfirmGoogle.addEventListener('click', () => {
      const gEmail = document.getElementById('google-auth-email').value.trim();
      const gName = document.getElementById('google-auth-name').value.trim();
      const gSchool = document.getElementById('google-auth-school') ? document.getElementById('google-auth-school').value.trim() : '';

      if (!gName) {
        alert('Harap masukkan nama Anda');
        return;
      }

      state.user.nama = gName;
      state.user.sekolah = gSchool || 'SD Merdeka';
      state.user.email = gEmail || `${gName.toLowerCase().replace(/\s+/g, '')}@gmail.com`;
      state.user.isGuest = false;

      saveUserData();
      syncUserToLeaderboard();
      updateDashboardStats();
      renderSubjectsGrid();
      renderHistoryView();
      renderAnalyticsView();
      document.getElementById('modal-google-auth').classList.remove('show');
      showToast(`Berhasil masuk sebagai ${gName}! Asal sekolah: ${state.user.sekolah}`);
      playTone('correct');
    });
  }
}

function setupSettingsToggles() {
  const toggleSound = document.getElementById('btn-toggle-sound');
  const toggleTts = document.getElementById('btn-toggle-tts');
  const timerModeSelect = document.getElementById('select-timer-mode');

  if (toggleSound) {
    toggleSound.addEventListener('click', () => {
      state.settings.sound = !state.settings.sound;
      saveUserSettings();
      toggleSound.classList.toggle('muted', !state.settings.sound);
      toggleSound.innerHTML = state.settings.sound ? '🔊' : '🔇';
      showToast(state.settings.sound ? 'Efek Suara Aktif' : 'Efek Suara Dimatikan');
      if (state.settings.sound) playTone('click');
    });
  }

  if (toggleTts) {
    toggleTts.addEventListener('click', () => {
      state.settings.tts = !state.settings.tts;
      saveUserSettings();
      toggleTts.classList.toggle('muted', !state.settings.tts);
      showToast(state.settings.tts ? 'Narator Suara Soal Aktif' : 'Narator Suara Dimatikan');
      if (state.settings.tts) speakText('Narator suara aktif');
    });
  }

  if (timerModeSelect) {
    timerModeSelect.value = state.settings.timerMode;
    timerModeSelect.addEventListener('change', () => {
      state.settings.timerMode = timerModeSelect.value;
      saveUserSettings();
      showToast(`Mode Timer diubah ke: ${timerModeSelect.options[timerModeSelect.selectedIndex].text}`);
    });
  }

  // Theme Toggle Button in Header
  const toggleThemeBtn = document.getElementById('btn-toggle-theme');
  if (toggleThemeBtn) {
    toggleThemeBtn.addEventListener('click', () => {
      toggleTheme();
    });
  }

  // Theme Select in Settings Modal
  const selectThemeMode = document.getElementById('select-theme-mode');
  if (selectThemeMode) {
    selectThemeMode.value = state.settings.theme || 'light';
    selectThemeMode.addEventListener('change', () => {
      applyTheme(selectThemeMode.value, true);
    });
  }

  const settingsRoleLabel = document.getElementById('settings-current-role-label');
  if (settingsRoleLabel) {
    settingsRoleLabel.textContent = (state.currentRole === 'teacher') ? '👨‍🏫 Mode Guru (Pendidik)' : '🎒 Mode Siswa (Anak)';
  }

  // TTS Speaker Button inside Quiz Arena
  const btnTtsSpeaker = document.getElementById('btn-tts');
  if (btnTtsSpeaker) {
    btnTtsSpeaker.addEventListener('click', () => {
      const qText = document.getElementById('quiz-question-text');
      if (qText) speakText(qText.textContent);
    });
  }
}

// ==========================================================================
// 19. TOAST NOTIFICATIONS & CONFETTI CELEBRATION
// ==========================================================================
function showToast(msg) {
  let toast = document.getElementById('app-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'app-toast';
    toast.style.cssText = `
      position: fixed;
      bottom: 80px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(15, 23, 42, 0.9);
      color: #FFFFFF;
      padding: 0.65rem 1.25rem;
      border-radius: 9999px;
      font-size: 0.9rem;
      font-weight: 600;
      z-index: 300;
      box-shadow: 0 10px 25px rgba(0,0,0,0.2);
      pointer-events: none;
      transition: opacity 0.3s ease;
      white-space: nowrap;
    `;
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = '1';
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => {
    toast.style.opacity = '0';
  }, 2400);
}

function launchConfetti() {
  const canvas = document.getElementById('confetti-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const confettiPieces = [];
  const colors = ['#4F46E5', '#06B6D4', '#F59E0B', '#10B981', '#EC4899', '#8B5CF6'];

  for (let i = 0; i < 90; i++) {
    confettiPieces.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height - canvas.height,
      size: Math.random() * 8 + 4,
      color: colors[Math.floor(Math.random() * colors.length)],
      speedY: Math.random() * 4 + 2,
      speedX: Math.random() * 2 - 1,
      rotation: Math.random() * 360,
      rotSpeed: Math.random() * 10 - 5
    });
  }

  let animationFrame;
  let duration = 0;

  function renderFrame() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    confettiPieces.forEach(p => {
      p.y += p.speedY;
      p.x += p.speedX;
      p.rotation += p.rotSpeed;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rotation * Math.PI) / 180);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      ctx.restore();
    });

    duration++;
    if (duration < 140) {
      animationFrame = requestAnimationFrame(renderFrame);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      cancelAnimationFrame(animationFrame);
    }
  }
  renderFrame();
}

// Global bootstrap
window.addEventListener('DOMContentLoaded', initApp);
