const { createApp, ref, computed, onMounted, onUnmounted, watch } = Vue;

const DB_NAME = 'ArchConstructionCBT_DB_v4';
const DB_VERSION = 1;
const STORE_NAME = 'questions';

function openDatabase() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getAllFromDB() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveAllToDB(items) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.clear();
    for (const item of items) {
      store.put(item);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

createApp({
  setup() {
    const chapters = [
      { id: 'ch1', name: '第1章 建築学（環境・構造・材料）' },
      { id: 'ch2', name: '第2章 共通（設備・契約・測量）' },
      { id: 'ch3', name: '第3章 躯体施工（地盤・RC・鉄骨・型枠）' },
      { id: 'ch4', name: '第4章 仕上施工（防水・タイル・内装・建具）' },
      { id: 'ch5', name: '第5章 施工管理法（工程・品質・安全）' },
      { id: 'ch6', name: '第6章 法規（建築基準法・建設業法・労基法）' }
    ];

    // ==========================================
    // 🔒 セキュリティ・限定試用認証 ＆ 拡散追跡防止
    // ==========================================
    const VALID_PASSCODES = ['2026', 'cbt2026', '1985', '7777', 'kentiku'];
    const isAuthorized = ref(localStorage.getItem('cbt_authorized') === 'true');
    const authPasscode = ref('');
    const authError = ref('');
    const authSuccessMsg = ref('');

    const maskUrlAndHistory = () => {
      try {
        if (window.history && window.history.replaceState) {
          const cleanUrl = window.location.pathname.replace(/\/index\.html$/, '/') || './';
          window.history.replaceState(null, document.title, cleanUrl);
        }
      } catch (e) {
        console.warn('[Security] history mask error:', e);
      }
    };

    const verifyAuth = () => {
      authError.value = '';
      authSuccessMsg.value = '';
      const input = authPasscode.value.trim().toLowerCase();
      if (VALID_PASSCODES.includes(input)) {
        isAuthorized.value = true;
        localStorage.setItem('cbt_authorized', 'true');
        authSuccessMsg.value = '認証に成功しました。アプリを起動します...';
        maskUrlAndHistory();
      } else {
        authError.value = '合言葉（パスコード）が正しくありません。管理者にお問い合わせください。';
      }
    };

    const lockApp = () => {
      if (confirm('アプリをロックしますか？ 次回起動時に再度合言葉が必要になります。')) {
        localStorage.removeItem('cbt_authorized');
        isAuthorized.value = false;
        authPasscode.value = '';
        authError.value = '';
      }
    };

    const activeTab = ref('exam'); // 'exam' | 'words' | 'quiz' | 'cheatsheet' | 'manage'
    const allQuestions = ref([]);
    const totalQuestionsCount = computed(() => allQuestions.value.length);

    // ==========================================
    // ⚡ 即解ワード暗記（一問一答フラッシュ）
    // ==========================================
    const allWords = ref(window.WORD_BANK || []);
    const wordFilterCategory = ref('すべて');
    const wordSessionCountOption = ref(50); // 10 | 25 | 50
    const isWordRandom = ref(true); // ランダムシャッフル出題
    const wordSessionWords = ref([]);
    const currentWordIndex = ref(0);
    const selectedWordChoice = ref(null);
    const hasAnsweredWord = ref(false);
    const wordStreak = ref(0);
    const maxWordStreak = ref(0);
    const wordMastered = ref({});
    const wordAnswers = ref({}); // { [wordId]: { choice, isCorrect, word } }
    const isWordSessionFinished = ref(false);
    const showWordGlossary = ref(false);
    const wordReviewFilter = ref('all'); // 'all' | 'wrong' | 'correct'
    const shuffledChoicesCache = ref({});

    // シャッフル用ヘルパー (Fisher-Yates)
    const shuffleList = (arr) => {
      const copy = [...arr];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    };

    // セッション開始・リセット
    const startWordSession = (customList = null) => {
      let pool = customList;
      if (!pool) {
        pool = allWords.value;
        if (wordFilterCategory.value !== 'すべて') {
          pool = pool.filter(w => w.category === wordFilterCategory.value);
        }
        if (isWordRandom.value) {
          pool = shuffleList(pool);
        } else {
          pool = [...pool];
        }
        const limit = Number(wordSessionCountOption.value) || 50;
        pool = pool.slice(0, limit);
      }

      wordSessionWords.value = pool;
      currentWordIndex.value = 0;
      selectedWordChoice.value = null;
      hasAnsweredWord.value = false;
      wordStreak.value = 0;
      maxWordStreak.value = 0;
      wordAnswers.value = {};
      isWordSessionFinished.value = false;
      showWordGlossary.value = false;
      wordReviewFilter.value = 'all';

      // 選択肢のシャッフルキャッシュ
      const choiceCache = {};
      pool.forEach(w => {
        const choices = [w.answer, ...(w.dummy || [])];
        choiceCache[w.id] = shuffleList(choices);
      });
      shuffledChoicesCache.value = choiceCache;
    };

    // 初期化実行
    startWordSession();

    const activeWords = computed(() => wordSessionWords.value);

    const currentWord = computed(() => {
      if (wordSessionWords.value.length === 0) return {};
      return wordSessionWords.value[currentWordIndex.value] || {};
    });

    const currentWordChoices = computed(() => {
      if (!currentWord.value || !currentWord.value.id) return [];
      return shuffledChoicesCache.value[currentWord.value.id] || [currentWord.value.answer, ...(currentWord.value.dummy || [])];
    });

    const handleSelectWord = (choice) => {
      if (hasAnsweredWord.value || !currentWord.value.id) return;
      hasAnsweredWord.value = true;
      selectedWordChoice.value = choice;
      const isCorrect = choice === currentWord.value.answer;

      wordAnswers.value[currentWord.value.id] = {
        choice: choice,
        isCorrect: isCorrect,
        word: currentWord.value
      };

      if (isCorrect) {
        wordStreak.value++;
        if (wordStreak.value > maxWordStreak.value) {
          maxWordStreak.value = wordStreak.value;
        }
      } else {
        wordStreak.value = 0;
      }
    };

    const toggleWordGlossary = () => {
      showWordGlossary.value = !showWordGlossary.value;
    };

    const nextWord = () => {
      if (currentWordIndex.value < wordSessionWords.value.length - 1) {
        currentWordIndex.value++;
        hasAnsweredWord.value = false;
        selectedWordChoice.value = null;
        showWordGlossary.value = false;
      } else {
        // 全問終了！区切り＆振り返り画面へ
        isWordSessionFinished.value = true;
      }
    };

    const prevWord = () => {
      if (currentWordIndex.value > 0) {
        currentWordIndex.value--;
        const prevW = wordSessionWords.value[currentWordIndex.value];
        const record = wordAnswers.value[prevW.id];
        if (record) {
          hasAnsweredWord.value = true;
          selectedWordChoice.value = record.choice;
        } else {
          hasAnsweredWord.value = false;
          selectedWordChoice.value = null;
        }
        showWordGlossary.value = false;
      }
    };

    const toggleWordMastered = (id) => {
      wordMastered.value[id] = !wordMastered.value[id];
    };

    // 振り返り用集計
    const wordSessionStats = computed(() => {
      const total = wordSessionWords.value.length;
      const records = Object.values(wordAnswers.value);
      const correctCount = records.filter(r => r.isCorrect).length;
      const wrongCount = records.filter(r => !r.isCorrect).length;
      const accuracy = total > 0 ? Math.round((correctCount / total) * 100) : 0;
      return {
        total,
        correctCount,
        wrongCount,
        accuracy,
        maxStreak: maxWordStreak.value
      };
    });

    const reviewedWordList = computed(() => {
      let list = wordSessionWords.value.map(w => {
        return {
          word: w,
          record: wordAnswers.value[w.id] || { choice: null, isCorrect: false }
        };
      });
      if (wordReviewFilter.value === 'wrong') {
        list = list.filter(item => !item.record.isCorrect);
      } else if (wordReviewFilter.value === 'correct') {
        list = list.filter(item => item.record.isCorrect);
      }
      return list;
    });

    // セクタ（工種）別カウント
    const wordSectors = computed(() => {
      const counts = {
        'すべて': allWords.value.length,
        '躯体施工': 0,
        '仕上施工': 0,
        '施工管理法': 0,
        '法規': 0
      };
      allWords.value.forEach(w => {
        if (counts[w.category] !== undefined) {
          counts[w.category]++;
        }
      });
      return [
        { id: 'すべて', name: '🌐 全工種総合', count: counts['すべて'], icon: '🌐' },
        { id: '躯体施工', name: '🏗 躯体施工', count: counts['躯体施工'], icon: '🏗' },
        { id: '仕上施工', name: '🎨 仕上施工', count: counts['仕上施工'], icon: '🎨' },
        { id: '施工管理法', name: '⏱ 施工管理法', count: counts['施工管理法'], icon: '⏱' },
        { id: '法規', name: '⚖️ 法規', count: counts['法規'], icon: '⚖️' }
      ];
    });

    const selectSector = (sectorId) => {
      wordFilterCategory.value = sectorId;
      startWordSession();
    };

    const finishWordSessionEarly = () => {
      isWordSessionFinished.value = true;
      if (isAutoPlay.value) stopSpeech();
    };

    // 間違えた単語だけ再挑戦
    const retryWrongWords = () => {
      const wrongs = wordSessionWords.value.filter(w => {
        const rec = wordAnswers.value[w.id];
        return rec && !rec.isCorrect;
      });
      if (wrongs.length === 0) return;
      startWordSession(wrongs);
    };

    watch([wordFilterCategory, wordSessionCountOption, isWordRandom], () => {
      startWordSession();
    });

    // ==========================================
    // 🔊 音声学習・読み上げ（Web Speech API & 発音正規化）
    // ==========================================
    const isSpeechSupported = ref('speechSynthesis' in window);
    const isSpeaking = ref(false);
    const isAutoPlay = ref(false); // 車両通勤・即解ワード自動連続耳学モード
    const isReviewAutoPlay = ref(false); // 即解ワード振り返り耳学モード
    const currentReviewSpeechIndex = ref(0);

    // 🎧 全モード聞き流し・耳学ステート
    const isExamAutoPlay = ref(false); // 実戦テスト進行中聞き流し
    const isExamReviewAutoPlay = ref(false); // 採点結果・誤答/要復習聞き流し
    const currentExamReviewSpeechIndex = ref(0);
    const isQuizAutoPlay = ref(false); // 工種別演習聞き流し
    const isCheatAutoPlay = ref(false); // 罠チートシート連続聞き流し
    const currentCheatSpeechIndex = ref(0);

    const speechRate = ref(1.0); // 0.85, 1.0, 1.2, 1.4
    let currentUtterance = null;
    let autoPlayTimer = null;
    let reviewAutoTimer = null;
    let examAutoTimer = null;
    let examReviewAutoTimer = null;
    let quizAutoTimer = null;
    let cheatAutoTimer = null;

    // 正しい発音のためのテキスト正規化エンジン
    // 例: 「1/5」→「5分の1」（日付の1月5日と誤読させない）
    const normalizeSpeechText = (text) => {
      if (!text) return "";
      let s = String(text);

      // 1. 分数表記 (1/5 -> 5分の1, 1/4 -> 4分の1, etc.)
      s = s.replace(/(\d+)\s*[\/／]\s*(\d+)/g, "$2分の$1");

      // 2. 日数・日時の正しい読み分け（ついたち、よんにち、ななにち等の誤読防止）
      s = s.replace(/1日あたり/g, "いちにちあたり");
      s = s.replace(/1日の/g, "いちにちの");
      s = s.replace(/1日(?![月0-9])/g, "いちにち");
      s = s.replace(/4日以内/g, "よっか以内");
      s = s.replace(/4日/g, "よっか");
      s = s.replace(/7日以内/g, "なのか以内");
      s = s.replace(/7日/g, "なのか");
      s = s.replace(/14日以上/g, "じゅうよっか以上");
      s = s.replace(/14日/g, "じゅうよっか");
      s = s.replace(/3日以上/g, "みっか以上");
      s = s.replace(/3日/g, "みっか");
      s = s.replace(/5日以上/g, "いつか以上");
      s = s.replace(/5日/g, "いつか");
      s = s.replace(/6ヶ月/g, "ろっかげつ");
      s = s.replace(/6回/g, "ろっかい");
      s = s.replace(/2現場/g, "にげんば");

      // 3. 単位・数値記号
      s = s.replace(/N\s*[\/／]\s*mm[²2]/g, "ニュートン毎平方ミリ");
      s = s.replace(/kg\s*[\/／]\s*m[³3]/g, "キログラム毎立方メートル");
      s = s.replace(/m[³3]/g, "立方メートル");
      s = s.replace(/m[²2]/g, "平方メートル");
      s = s.replace(/kN/g, "キロニュートン");
      s = s.replace(/℃/g, "度");
      s = s.replace(/%/g, "パーセント");
      s = s.replace(/±/g, "プラスマイナス");
      s = s.replace(/(\d+)\s*mm/g, "$1ミリ");
      s = s.replace(/(\d+)\s*cm/g, "$1センチ");
      s = s.replace(/(\d+(\.\d+)?)\s*m(?![a-zA-Z])/g, "$1メートル");

      // 4. 専門用語・法令・誤読防止辞書
      s = s.replace(/躯体/g, "くたい");
      s = s.replace(/仕上/g, "しあげ");
      s = s.replace(/36協定/g, "サブロク協定");
      s = s.replace(/せき板/g, "せきいた");
      s = s.replace(/建地/g, "たてじ");
      s = s.replace(/幅木/g, "はばき");
      s = s.replace(/巾木/g, "はばき");
      s = s.replace(/中さん/g, "なかさん");
      s = s.replace(/特定元方事業者/g, "特定もとかた事業者");
      s = s.replace(/関係請負人/g, "かんけいうけおいにん");
      s = s.replace(/一括下請負/g, "いっかつしたうけおい");
      s = s.replace(/母屋/g, "もや");
      s = s.replace(/折板/g, "せっぱん");
      s = s.replace(/豆板/g, "まめいた");
      s = s.replace(/ジャンカ/g, "ジャンカ");
      s = s.replace(/山留め/g, "やまどめ");
      s = s.replace(/切梁/g, "きりばり");
      s = s.replace(/腹起し/g, "はらおこし");
      s = s.replace(/親綱/g, "おやづな");
      s = s.replace(/目荒らし/g, "めあらし");
      s = s.replace(/裏足/g, "うらあし");
      s = s.replace(/梁底/g, "はりぞこ");
      s = s.replace(/梁側/g, "はりがわ");
      s = s.replace(/梁下/g, "はりした");
      s = s.replace(/梁/g, "はり");
      s = s.replace(/柱/g, "はしら");
      s = s.replace(/打重ね/g, "うちがさね");
      s = s.replace(/打継ぎ/g, "うちつぎ");
      s = s.replace(/打込み/g, "うちこみ");
      s = s.replace(/荷卸し/g, "におろし");
      s = s.replace(/練混ぜ/g, "ねりまぜ");
      s = s.replace(/水和反応/g, "すいわはんのう");
      s = s.replace(/存置/g, "ぞんち");
      s = s.replace(/盛替え/g, "もりかえ");
      s = s.replace(/脱型/g, "だっけい");
      s = s.replace(/特例監理技術者/g, "とくれい かんりぎじゅつしゃ");
      s = s.replace(/監理技術者補佐/g, "かんりぎじゅつしゃ ほさ");
      s = s.replace(/適判/g, "てきはん");
      s = s.replace(/4号/g, "よんごう");
      s = s.replace(/1級/g, "いっきゅう");
      s = s.replace(/2級/g, "にきゅう");
      s = s.replace(/技士補/g, "ぎしほ");
      s = s.replace(/安衛法/g, "あんえいほう");
      s = s.replace(/安衛則/g, "あんえいそく");
      s = s.replace(/労基法/g, "ろうきほう");
      s = s.replace(/建基法/g, "けんきほう");
      s = s.replace(/ALC/g, "エーエルシー");
      s = s.replace(/LGS/g, "エルジーエス");
      s = s.replace(/RC/g, "アールシー");
      s = s.replace(/JASS/g, "ジャス");
      s = s.replace(/QC/g, "キューシー");
      s = s.replace(/Fc/g, "エフシー");
      s = s.replace(/PC鋼線/g, "ピーシーこうせん");
      s = s.replace(/PC/g, "ピーシー");
      s = s.replace(/UCL/g, "ユーシーエル");
      s = s.replace(/LCL/g, "エルシーエル");
      s = s.replace(/SN材/g, "エスエヌざい");
      s = s.replace(/SN400B/g, "エスエヌ よんひゃく ビー");
      s = s.replace(/SN490B/g, "エスエヌ よんきゅうまる ビー");
      s = s.replace(/合板/g, "ごうはん");
      s = s.replace(/段葺き/g, "だんぶき");
      s = s.replace(/葺き/g, "ふき");
      s = s.replace(/葺く/g, "ふく");
      s = s.replace(/瓦棒/g, "かわらぼう");
      s = s.replace(/野地板/g, "のじいた");
      s = s.replace(/垂木/g, "たるき");
      s = s.replace(/棟木/g, "むなぎ");
      s = s.replace(/胴縁/g, "どうぶち");
      s = s.replace(/帯金物/g, "おびかなもの");
      s = s.replace(/羽子板ボルト/g, "はごいたボルト");
      s = s.replace(/短冊金物/g, "たんざくかなもの");
      s = s.replace(/筋かい/g, "すじかい");
      s = s.replace(/筋交い/g, "すじかい");
      s = s.replace(/筋交/g, "すじかい");
      s = s.replace(/間柱/g, "まばしら");
      s = s.replace(/通し柱/g, "とおしばしら");
      s = s.replace(/管柱/g, "くだばしら");
      s = s.replace(/土台/g, "どだい");
      s = s.replace(/布基礎/g, "ぬのきそ");
      s = s.replace(/べた基礎/g, "べたきそ");
      s = s.replace(/地業/g, "じぎょう");
      s = s.replace(/床付け/g, "とこづけ");
      s = s.replace(/根切り/g, "ねぎり");
      s = s.replace(/埋戻し/g, "うめもどし");
      s = s.replace(/割栗石/g, "わりぐりいし");
      s = s.replace(/目地/g, "めじ");
      s = s.replace(/面木/g, "めんき");
      s = s.replace(/隅肉/g, "すみにく");
      s = s.replace(/開先/g, "かいさき");
      s = s.replace(/余盛り/g, "よもり");
      s = s.replace(/余盛/g, "よもり");
      s = s.replace(/撓み/g, "たわみ");
      s = s.replace(/撓り/g, "しなり");
      s = s.replace(/反り/g, "そり");
      s = s.replace(/粗骨材/g, "そこつざい");
      s = s.replace(/細骨材/g, "さいこつざい");
      s = s.replace(/骨材/g, "こつざい");
      s = s.replace(/単位水量/g, "たんいすいりょう");
      s = s.replace(/水セメント比/g, "すいセメントひ");
      s = s.replace(/空気量/g, "くうきりょう");
      s = s.replace(/スランプ/g, "スランプ");
      s = s.replace(/呼び強度/g, "よびきょうど");
      s = s.replace(/設計基準強度/g, "せっけいきじゅんきょうど");
      s = s.replace(/朝顔/g, "あさがお");
      s = s.replace(/巾/g, "はば");
      s = s.replace(/跨ぎ/g, "またぎ");
      s = s.replace(/踏み面/g, "ふみづら");
      s = s.replace(/蹴上げ/g, "けあげ");
      s = s.replace(/踊場/g, "おどりば");
      s = s.replace(/手摺/g, "てすり");
      s = s.replace(/踊り場/g, "おどりば");
      s = s.replace(/勾配/g, "こうばい");
      s = s.replace(/不適当/g, "ふてきとう");
      s = s.replace(/誤っている/g, "あやまっている");

      return s;
    };

    // 音声一覧キャッシュ＆Android Chrome対応
    const availableVoices = ref([]);
    const updateVoices = () => {
      if (!window.speechSynthesis) return;
      availableVoices.value = window.speechSynthesis.getVoices();
    };

    if (typeof window !== 'undefined' && window.speechSynthesis) {
      updateVoices();
      if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = updateVoices;
      }
    }

    // モバイル用音声アンロック
    let isAudioUnlocked = false;
    const unlockAudioSpeech = () => {
      if (isAudioUnlocked || !window.speechSynthesis) return;
      try {
        window.speechSynthesis.resume();
        isAudioUnlocked = true;
      } catch (e) {}
    };

    // 画面タップ時にアンロックを仕込む
    if (typeof window !== 'undefined') {
      window.addEventListener('touchstart', unlockAudioSpeech, { once: true, passive: true });
      window.addEventListener('click', unlockAudioSpeech, { once: true, passive: true });
    }

    const getJapaneseVoice = () => {
      if (!window.speechSynthesis) return null;
      const list = availableVoices.value.length > 0 ? availableVoices.value : window.speechSynthesis.getVoices();
      return list.find(v => v.lang === 'ja-JP' || v.lang === 'ja_JP' || v.lang.startsWith('ja')) || null;
    };

    // ==========================================
    // 🔆 画面スリープ防止（Wake Lock API - 音声と競合しない標準方式）
    // ==========================================
    const isWakeLockSupported = ref(typeof navigator !== 'undefined' && 'wakeLock' in navigator);
    const isWakeLockActive = ref(false);
    const wakeLockManualOverride = ref(false);
    let wakeLockSentinel = null;

    const isAnyAutoPlayActive = () => {
      return isAutoPlay.value || isReviewAutoPlay.value || isExamAutoPlay.value || isExamReviewAutoPlay.value || isQuizAutoPlay.value || isCheatAutoPlay.value;
    };

    const acquireWakeLock = async () => {
      if (typeof navigator !== 'undefined' && 'wakeLock' in navigator) {
        try {
          if (!wakeLockSentinel) {
            wakeLockSentinel = await navigator.wakeLock.request('screen');
            isWakeLockActive.value = true;
            wakeLockSentinel.addEventListener('release', () => {
              wakeLockSentinel = null;
              if (!wakeLockManualOverride.value && !isAnyAutoPlayActive()) {
                isWakeLockActive.value = false;
              }
            });
          }
        } catch (err) {
          console.log('[WakeLock] Request notice:', err);
        }
      }
    };

    const releaseWakeLock = async () => {
      if (wakeLockManualOverride.value) return;
      if (wakeLockSentinel) {
        try {
          await wakeLockSentinel.release();
        } catch (e) {}
        wakeLockSentinel = null;
      }
      isWakeLockActive.value = false;
    };

    const toggleManualWakeLock = async () => {
      wakeLockManualOverride.value = !wakeLockManualOverride.value;
      if (wakeLockManualOverride.value) {
        await acquireWakeLock();
      } else {
        if (!isAnyAutoPlayActive()) {
          await releaseWakeLock();
        }
      }
    };

    // 画面復帰時の自動再取得
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState === 'visible') {
          if (wakeLockManualOverride.value || isAnyAutoPlayActive()) {
            await acquireWakeLock();
          }
        }
      });
    }

    const stopSpeech = () => {
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      if (autoPlayTimer) {
        clearTimeout(autoPlayTimer);
        autoPlayTimer = null;
      }
      if (reviewAutoTimer) {
        clearTimeout(reviewAutoTimer);
        reviewAutoTimer = null;
      }
      if (examAutoTimer) {
        clearTimeout(examAutoTimer);
        examAutoTimer = null;
      }
      if (examReviewAutoTimer) {
        clearTimeout(examReviewAutoTimer);
        examReviewAutoTimer = null;
      }
      if (quizAutoTimer) {
        clearTimeout(quizAutoTimer);
        quizAutoTimer = null;
      }
      if (cheatAutoTimer) {
        clearTimeout(cheatAutoTimer);
        cheatAutoTimer = null;
      }
      isSpeaking.value = false;
      isAutoPlay.value = false;
      isReviewAutoPlay.value = false;
      isExamAutoPlay.value = false;
      isExamReviewAutoPlay.value = false;
      isQuizAutoPlay.value = false;
      isCheatAutoPlay.value = false;
      releaseWakeLock();
    };

    // 音声テスト＆強制アンロック関数
    const testSpeech = () => {
      stopSpeech();
      speakText('音声テストです。正常に読み上げが行われています。マナーモードがオフになっていることをご確認ください。');
    };

    // 🔄 アプリ最新版更新（キャッシュ完全パージ＆強制最新化）
    const reloadApp = async () => {
      try {
        if ('serviceWorker' in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          for (const reg of regs) {
            await reg.unregister();
          }
        }
        if ('caches' in window) {
          const keys = await caches.keys();
          for (const key of keys) {
            await caches.delete(key);
          }
        }
        if (typeof indexedDB !== 'undefined') {
          indexedDB.deleteDatabase('ArchConstructionCBT_DB_v2');
          indexedDB.deleteDatabase('ArchConstructionCBT_DB_v3');
          indexedDB.deleteDatabase('ArchConstructionCBT_DB_v4');
        }
      } catch (e) {
        console.warn('Cache purge notice:', e);
      }
      // キャッシュバスター付きリロード
      const base = window.location.href.split('?')[0].split('#')[0];
      window.location.href = base + '?t=' + Date.now();
    };

    const speakText = (text, onEndCallback = null) => {
      if (!isSpeechSupported.value || !window.speechSynthesis) {
        if (onEndCallback) onEndCallback();
        return;
      }

      // 進行中の発話をキャンセル
      window.speechSynthesis.cancel();

      // 正しい日本語発音テキストに正規化変換
      const spokenText = normalizeSpeechText(text);
      
      const utterance = new SpeechSynthesisUtterance(spokenText);
      utterance.lang = 'ja-JP';
      utterance.rate = Number(speechRate.value) || 1.0;
      utterance.pitch = 1.0;

      const jVoice = getJapaneseVoice();
      if (jVoice) {
        utterance.voice = jVoice;
      }

      utterance.onstart = () => {
        isSpeaking.value = true;
      };

      utterance.onend = () => {
        isSpeaking.value = false;
        if (onEndCallback) onEndCallback();
      };

      utterance.onerror = (e) => {
        console.warn('[Speech] Utterance error:', e);
        isSpeaking.value = false;
        if (onEndCallback) onEndCallback();
      };

      currentUtterance = utterance;

      // ユーザーの同期タップ枠内で即座に実行！
      try {
        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        }
        window.speechSynthesis.speak(utterance);
      } catch (e) {
        console.error('[Speech] speak error:', e);
        try {
          const fallback = new SpeechSynthesisUtterance(spokenText);
          fallback.lang = 'ja-JP';
          fallback.onend = onEndCallback;
          window.speechSynthesis.speak(fallback);
        } catch (e2) {
          if (onEndCallback) onEndCallback();
        }
      }
    };

    // 現在の単語を読み上げる（手動ボタン）
    const speakCurrentWord = () => {
      if (isSpeaking.value && !isAutoPlay.value) {
        stopSpeech();
        return;
      }
      const w = currentWord.value;
      if (!w || !w.question) return;

      let speechContent = '';
      if (!hasAnsweredWord.value) {
        const choicesText = currentWordChoices.value.map((c, i) => `選択肢${i + 1}、${c}。`).join(' ');
        speechContent = `問題。${w.category}、${w.topic}。${w.question}。${choicesText}`;
      } else {
        const glossaryText = w.termGlossary ? `現場用語解説。${w.term || w.topic}。${w.termGlossary}。` : '';
        const hintText = w.hint ? `ポイント。${w.hint}。` : '';
        speechContent = `正解は、${w.answer}です。${glossaryText}${hintText}`;
      }
      speakText(speechContent);
    };

    // 項目を指定して読み上げる（振り返り一覧用）
    const speakItem = (w) => {
      if (isSpeaking.value && !isReviewAutoPlay.value) {
        stopSpeech();
        return;
      }
      const glossaryText = w.termGlossary ? `現場用語解説。${w.term || w.topic}。${w.termGlossary}。` : '';
      const hintText = w.hint ? `ポイント。${w.hint}。` : '';
      const speechContent = `${w.category}。${w.term || w.topic}。問題。${w.question}。正解は、${w.answer}です。${glossaryText}${hintText}`;
      speakText(speechContent);
    };

    // 🚗 車両通勤・ハンズフリー自動連続耳学モード
    const toggleAutoPlay = () => {
      if (isAutoPlay.value) {
        stopSpeech();
      } else {
        stopSpeech();
        isAutoPlay.value = true;
        acquireWakeLock().catch(() => {});
        playWordAutoCycle();
      }
    };

    const playWordAutoCycle = () => {
      if (!isAutoPlay.value || isWordSessionFinished.value) {
        isAutoPlay.value = false;
        return;
      }

      const w = currentWord.value;
      if (!w || !w.question) return;

      // 1. 問題を読み上げる
      const qText = `第${currentWordIndex.value + 1}問。${w.category}。${w.topic}。問題。${w.question}。`;
      speakText(qText, () => {
        if (!isAutoPlay.value) return;

        // 2. シンキングタイム（2.2秒の間）
        autoPlayTimer = setTimeout(() => {
          if (!isAutoPlay.value) return;

          // 画面上も回答状態にして正解を表示
          hasAnsweredWord.value = true;
          selectedWordChoice.value = w.answer;

          // 3. 正解と用語解説・急所を読み上げる
          const glossaryText = w.termGlossary ? `現場用語解説。${w.term || w.topic}。${w.termGlossary}。` : '';
          const hintText = w.hint ? `ポイント。${w.hint}。` : '';
          const aText = `正解は、${w.answer}です。${glossaryText}${hintText}`;

          speakText(aText, () => {
            if (!isAutoPlay.value) return;

            // 4. 少し間を置いて次の問題へ
            autoPlayTimer = setTimeout(() => {
              if (!isAutoPlay.value) return;
              if (currentWordIndex.value < wordSessionWords.value.length - 1) {
                nextWord();
                playWordAutoCycle();
              } else {
                // セッション完了 ➔ 自動で振り返り耳学へバトンタッチ！
                isWordSessionFinished.value = true;
                isAutoPlay.value = false;
                const sectorLabel = wordFilterCategory.value === 'すべて' ? '全工種' : wordFilterCategory.value;
                const finishMsg = `${sectorLabel}セクタの暗記演習が完了しました。続けて、セクタの振り返り耳学解説を開始します。`;
                
                speakText(finishMsg, () => {
                  setTimeout(() => {
                    toggleReviewAutoPlay();
                  }, 1200);
                });
              }
            }, 1800);
          });
        }, 2200);
      });
    };

    // 🚗 振り返り画面での「連続耳学モード（音声解説リスニング）」
    const toggleReviewAutoPlay = () => {
      if (isReviewAutoPlay.value) {
        stopSpeech();
      } else {
        stopSpeech();
        isReviewAutoPlay.value = true;
        acquireWakeLock().catch(() => {});
        currentReviewSpeechIndex.value = 0;
        playReviewAutoCycle();
      }
    };

    const playReviewAutoCycle = () => {
      const list = reviewedWordList.value;
      if (!isReviewAutoPlay.value || list.length === 0 || currentReviewSpeechIndex.value >= list.length) {
        isReviewAutoPlay.value = false;
        speakText('セクタの振り返り耳学がすべて完了しました。大変お疲れ様でした。');
        return;
      }

      const item = list[currentReviewSpeechIndex.value];
      const w = item.word;
      const num = currentReviewSpeechIndex.value + 1;
      const statusText = item.record.isCorrect ? '正解した項目です。' : '見直しが必要な項目です。';
      const glossaryText = w.termGlossary ? `現場用語解説。${w.term || w.topic}。${w.termGlossary}。` : '';
      const hintText = w.hint ? `暗記のツボ。${w.hint}。` : '';

      const reviewSpeech = `振り返り第${num}項目。${w.category}。${w.term || w.topic}。${statusText}基準値は、${w.answer}。${glossaryText}${hintText}`;

      speakText(reviewSpeech, () => {
        if (!isReviewAutoPlay.value) return;

        reviewAutoTimer = setTimeout(() => {
          if (!isReviewAutoPlay.value) return;
          currentReviewSpeechIndex.value++;
          if (currentReviewSpeechIndex.value < list.length) {
            playReviewAutoCycle();
          } else {
            isReviewAutoPlay.value = false;
            speakText('セクタの振り返り耳学がすべて終了しました。');
          }
        }, 1500);
      });
    };

    // ==========================================
    // 🎯 実戦テスト（10分 / 20分 / 本番72問）
    // ==========================================
    const selectedExamMode = ref('intensive20'); // 'speed10' | 'intensive20' | 'full72'
    const isExamStarted = ref(false);
    const isExamFinished = ref(false);
    const examQuestions = ref([]);
    const currentExamIndex = ref(0);
    const examUserAnswers = ref({});
    const examMarks = ref({});
    const examTimeRemaining = ref(1200);
    let examTimerInterval = null;

    const currentExamQuestion = computed(() => {
      if (examQuestions.value.length === 0) return {};
      return examQuestions.value[currentExamIndex.value] || {};
    });

    const answeredExamCount = computed(() => {
      return Object.keys(examUserAnswers.value).filter(k => examUserAnswers.value[k] !== null).length;
    });

    const getExamModeTitle = () => {
      if (selectedExamMode.value === 'speed10') return '⚡ タイムリー10分版（15問）';
      if (selectedExamMode.value === 'intensive20') return '🧠 濃縮20分版 [即時解説＆現場知見付き]（25問）';
      return '🏆 本番72問フル模試（120分 / 72問選択解答シミュレーション）';
    };

    const startSpecificExam = (mode) => {
      selectedExamMode.value = mode;

      let targetCount = 72;
      let durationSeconds = 7200; // 120分

      if (mode === 'speed10') {
        targetCount = 15;
        durationSeconds = 600; // 10分
      } else if (mode === 'intensive20') {
        targetCount = 25;
        durationSeconds = 1200; // 20分
      }

      // 【重複防止】1試験内での同一問題・類似問題の重複出題を100%完全排除
      const shuffled = [...allQuestions.value].sort(() => 0.5 - Math.random());
      const selected = [];
      const seenSignatures = new Set();

      for (const q of shuffled) {
        // 重複判定シグネチャ：解説文または問題文＋正解選択肢（実質同一問題判定）
        const corrText = (q.options && q.options[q.correctIndex]) ? q.options[q.correctIndex] : '';
        const sig = (q.explanation || (q.question + '::' + corrText)).trim();

        if (!seenSignatures.has(sig) && !seenSignatures.has(q.id)) {
          seenSignatures.add(sig);
          seenSignatures.add(q.id);
          selected.push(q);
          if (selected.length >= targetCount) {
            break;
          }
        }
      }
      examQuestions.value = selected;

      examUserAnswers.value = {};
      examMarks.value = {};
      for (let i = 0; i < examQuestions.value.length; i++) {
        examUserAnswers.value[i] = null;
        examMarks.value[i] = false;
      }

      currentExamIndex.value = 0;
      examTimeRemaining.value = durationSeconds;
      isExamStarted.value = true;
      isExamFinished.value = false;

      clearInterval(examTimerInterval);
      examTimerInterval = setInterval(() => {
        if (examTimeRemaining.value > 0) {
          examTimeRemaining.value--;
        } else {
          finishExam();
        }
      }, 1000);
    };

    const selectExamAnswer = (idx) => {
      examUserAnswers.value[currentExamIndex.value] = idx;
    };

    const toggleExamMark = (idx) => {
      examMarks.value[idx] = !examMarks.value[idx];
    };

    const nextExamQuestion = () => {
      if (currentExamIndex.value < examQuestions.value.length - 1) {
        currentExamIndex.value++;
      }
    };

    const prevExamQuestion = () => {
      if (currentExamIndex.value > 0) {
        currentExamIndex.value--;
      }
    };

    const finishExam = () => {
      clearInterval(examTimerInterval);
      if (isExamAutoPlay.value) {
        stopSpeech();
      }
      isExamFinished.value = true;
      isExamStarted.value = false;
    };

    const resetExamState = () => {
      clearInterval(examTimerInterval);
      if (isExamAutoPlay.value || isExamReviewAutoPlay.value) {
        stopSpeech();
      }
      isExamStarted.value = false;
      isExamFinished.value = false;
      examQuestions.value = [];
    };

    // 🎧 実戦テスト進行中：ハンズフリー連続聞き流し耳学モード
    const toggleExamAutoPlay = () => {
      if (isExamAutoPlay.value) {
        stopSpeech();
      } else {
        stopSpeech();
        isExamAutoPlay.value = true;
        acquireWakeLock().catch(() => {});
        playExamAutoCycle();
      }
    };

    const playExamAutoCycle = () => {
      if (!isExamAutoPlay.value || !isExamStarted.value || isExamFinished.value) {
        isExamAutoPlay.value = false;
        return;
      }

      const q = currentExamQuestion.value;
      if (!q || !q.question) return;

      const qNum = currentExamIndex.value + 1;
      const cat = q.chapterName || q.category || '';
      const opts = q.options || [];

      // 1. 問題文と選択肢の読み上げ
      let speech = `第${qNum}問。${cat}。問題。${q.question}。`;
      opts.forEach((opt, i) => {
        speech += `選択肢${i + 1}番、${opt}。`;
      });

      speakText(speech, () => {
        if (!isExamAutoPlay.value) return;

        // 2. シンキングタイム（2.5秒）
        examAutoTimer = setTimeout(() => {
          if (!isExamAutoPlay.value) return;

          // 画面上の回答を正解選択肢にセットして視覚的に反映
          examUserAnswers.value[currentExamIndex.value] = q.correctIndex;

          // 3. 正解・解説・引っ掛け罠・現場知見の読み上げ（不適当な理由のフィードバック明示）
          const chosenOpt = opts[q.correctIndex] || '';
          const expText = q.explanation ? `不適当である理由の解説、${q.explanation}。` : '';
          const trapText = q.trapNote ? `出題者の引っ掛け罠、${q.trapNote}。` : '';
          const fieldText = q.fieldReality ? `現場工事長の知見、${q.fieldReality}。` : '';
          const answerSpeech = `最も不適当な正解肢は、${q.correctIndex + 1}番です。「${chosenOpt}」という記述が不適当です。${expText}${trapText}${fieldText}`;

          speakText(answerSpeech, () => {
            if (!isExamAutoPlay.value) return;

            // 4. 少し間を置いて次の問題へ
            examAutoTimer = setTimeout(() => {
              if (!isExamAutoPlay.value) return;

              if (currentExamIndex.value < examQuestions.value.length - 1) {
                nextExamQuestion();
                playExamAutoCycle();
              } else {
                // テスト全問終了
                isExamAutoPlay.value = false;
                speakText('実戦テストの全問聞き流しが完了しました。採点結果画面へ移行します。', () => {
                  finishExam();
                });
              }
            }, 1800);
          });
        }, 2500);
      });
    };

    const formatExamTime = (sec) => {
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    };

    const getExamOptionClass = (idx) => {
      const currentAns = examUserAnswers.value[currentExamIndex.value];
      const isSelected = currentAns === idx;
      const isCorrect = idx === currentExamQuestion.value.correctIndex;

      if (selectedExamMode.value === 'intensive20' && currentAns !== null) {
        if (isCorrect) return 'bg-emerald-950/80 border-emerald-500 text-emerald-100 ring-1 ring-emerald-500';
        if (isSelected && !isCorrect) return 'bg-rose-950/80 border-rose-500 text-rose-100 ring-1 ring-rose-500';
        return 'bg-slate-900/60 border-slate-800 text-slate-500 opacity-60';
      }

      if (isSelected) {
        return 'bg-sky-950/80 border-sky-500 text-sky-200 ring-1 ring-sky-500';
      }
      return 'bg-slate-950/80 border-slate-800 hover:border-slate-700 text-slate-300';
    };

    const getExamBadgeClass = (idx) => {
      const currentAns = examUserAnswers.value[currentExamIndex.value];
      const isSelected = currentAns === idx;
      const isCorrect = idx === currentExamQuestion.value.correctIndex;

      if (selectedExamMode.value === 'intensive20' && currentAns !== null) {
        if (isCorrect) return 'bg-emerald-500 text-slate-950 border-emerald-400';
        if (isSelected && !isCorrect) return 'bg-rose-500 text-white border-rose-400';
      }
      if (isSelected) return 'bg-sky-500 text-slate-950 border-sky-400';
      return 'bg-slate-800 text-slate-400 border-slate-700';
    };

    const getExamGridClass = (idx) => {
      const isCurrent = currentExamIndex.value === idx;
      const ans = examUserAnswers.value[idx];
      let base = 'bg-slate-950 text-slate-400 border-slate-800';

      if (ans !== null) {
        base = 'bg-emerald-950/60 text-emerald-300 border-emerald-800';
      }
      if (isCurrent) {
        base += ' ring-2 ring-sky-400 border-sky-400 text-white font-bold';
      }
      return base;
    };

    // 採点レポート
    const examScore = computed(() => {
      let score = 0;
      examQuestions.value.forEach((q, idx) => {
        if (examUserAnswers.value[idx] === q.correctIndex) {
          score++;
        }
      });
      return score;
    });

    const examScoreRate = computed(() => {
      if (examQuestions.value.length === 0) return 0;
      return (examScore.value / examQuestions.value.length) * 100;
    });

    const examCategoryStats = computed(() => {
      const stats = {};
      examQuestions.value.forEach((q, idx) => {
        const cat = q.chapterName || q.category || 'その他';
        if (!stats[cat]) {
          stats[cat] = { total: 0, correct: 0, rate: 0 };
        }
        stats[cat].total++;
        if (examUserAnswers.value[idx] === q.correctIndex) {
          stats[cat].correct++;
        }
      });
      for (const cat in stats) {
        stats[cat].rate = (stats[cat].correct / stats[cat].total) * 100;
      }
      return stats;
    });

    // ==========================================
    // 💥 誤答・要復習確認 ＆ 再試験システム
    // ==========================================
    const examReviewFilter = ref('wrong'); // 'wrong' | 'marked' | 'all'

    // 誤答問題リスト
    const examWrongQuestions = computed(() => {
      const list = [];
      examQuestions.value.forEach((q, idx) => {
        if (examUserAnswers.value[idx] !== q.correctIndex) {
          list.push({
            q,
            userAnswer: examUserAnswers.value[idx],
            isCorrect: false,
            isMarked: !!examMarks.value[idx],
            idx
          });
        }
      });
      return list;
    });

    // 要復習マーク付き問題リスト
    const examMarkedQuestions = computed(() => {
      const list = [];
      examQuestions.value.forEach((q, idx) => {
        if (examMarks.value[idx]) {
          list.push({
            q,
            userAnswer: examUserAnswers.value[idx],
            isCorrect: examUserAnswers.value[idx] === q.correctIndex,
            isMarked: true,
            idx
          });
        }
      });
      return list;
    });

    // フィルター適用後の確認リスト
    const filteredExamReviewList = computed(() => {
      if (examReviewFilter.value === 'marked') {
        return examMarkedQuestions.value;
      }
      if (examReviewFilter.value === 'all') {
        return examQuestions.value.map((q, idx) => ({
          q,
          userAnswer: examUserAnswers.value[idx],
          isCorrect: examUserAnswers.value[idx] === q.correctIndex,
          isMarked: !!examMarks.value[idx],
          idx
        }));
      }
      return examWrongQuestions.value;
    });

    // 誤答または要復習の再試験開始
    const startRetryExam = (type = 'wrong') => {
      const pool = [];
      const seenIds = new Set();

      examQuestions.value.forEach((q, idx) => {
        const isWrong = examUserAnswers.value[idx] !== q.correctIndex;
        const isMarked = !!examMarks.value[idx];
        const shouldInclude = (type === 'wrong') ? isWrong : (isWrong || isMarked);

        if (shouldInclude && !seenIds.has(q.id)) {
          seenIds.add(q.id);
          pool.push(q);
        }
      });

      if (pool.length === 0) {
        alert('再試験の対象となる問題がありません。全問正解・復習完了です！🎉');
        return;
      }

      // 再試験モードを起動
      examQuestions.value = pool;
      examUserAnswers.value = {};
      examMarks.value = {};
      for (let i = 0; i < pool.length; i++) {
        examUserAnswers.value[i] = null;
        examMarks.value[i] = false;
      }

      currentExamIndex.value = 0;
      examTimeRemaining.value = pool.length * 90; // 1問あたり90秒
      isExamStarted.value = true;
      isExamFinished.value = false;

      clearInterval(examTimerInterval);
      examTimerInterval = setInterval(() => {
        if (examTimeRemaining.value > 0) {
          examTimeRemaining.value--;
        } else {
          finishExam();
        }
      }, 1000);
    };

    // 同一設定での最初からのフル再試験
    const restartCurrentExam = () => {
      startSpecificExam(selectedExamMode.value);
    };

    // 個別問題のブックマーク切り替え（結果画面用）
    const toggleQuestionBookmark = async (q) => {
      q.isBookmarked = !q.isBookmarked;
      const target = allQuestions.value.find(item => item.id === q.id);
      if (target) {
        target.isBookmarked = q.isBookmarked;
      }
      try {
        await saveAllToDB(allQuestions.value);
      } catch (e) {}
    };

    // 🎧 採点結果画面：誤答・要復習の連続聞き流し耳学モード
    const toggleExamReviewAutoPlay = () => {
      if (isExamReviewAutoPlay.value) {
        stopSpeech();
      } else {
        stopSpeech();
        if (filteredExamReviewList.value.length === 0) {
          speakText('確認対象の問題がありません。');
          return;
        }
        isExamReviewAutoPlay.value = true;
        currentExamReviewSpeechIndex.value = 0;
        acquireWakeLock().catch(() => {});
        playExamReviewAutoCycle();
      }
    };

    const playExamReviewAutoCycle = () => {
      const list = filteredExamReviewList.value;
      if (!isExamReviewAutoPlay.value || list.length === 0 || currentExamReviewSpeechIndex.value >= list.length) {
        isExamReviewAutoPlay.value = false;
        speakText('復習対象の問題の聞き流しがすべて完了しました。大変お疲れ様でした。');
        return;
      }

      const item = list[currentExamReviewSpeechIndex.value];
      const q = item.q;
      const num = currentExamReviewSpeechIndex.value + 1;
      const statusText = item.isCorrect ? '正解した問題です。' : '見直しが必要な問題です。';
      const correctOptText = (q.options && q.options[q.correctIndex]) ? q.options[q.correctIndex] : '';
      const expText = q.explanation ? `不適当である理由の解説、${q.explanation}。` : '';
      const trapText = q.trapNote ? `出題者の引っ掛け罠、${q.trapNote}。` : '';
      const fieldText = q.fieldReality ? `現場工事長の知見、${q.fieldReality}。` : '';

      const reviewSpeech = `復習第${num}問。${cat}。${statusText}問題。${q.question}。最も不適当な正解肢は、肢${q.correctIndex + 1}番です。「${correctOptText}」という記述が不適当です。${expText}${trapText}${fieldText}`;

      speakText(reviewSpeech, () => {
        if (!isExamReviewAutoPlay.value) return;

        examReviewAutoTimer = setTimeout(() => {
          if (!isExamReviewAutoPlay.value) return;
          currentExamReviewSpeechIndex.value++;
          if (currentExamReviewSpeechIndex.value < list.length) {
            playExamReviewAutoCycle();
          } else {
            isExamReviewAutoPlay.value = false;
            speakText('復習対象の問題の聞き流しがすべて完了しました。');
          }
        }, 1600);
      });
    };

    // ==========================================
    // ⏱️ 工種別・章別ドリル演習（40秒タイマー）
    // ==========================================
    const quizFilterChapter = ref('ALL');
    const quizOnlyBookmarked = ref(false);
    const quizRandomOrder = ref(false);
    const currentQuizIndex = ref(0);
    const timerRemaining = ref(40.0);
    const isTimerRunning = ref(false);
    const hasAnswered = ref(false);
    const selectedOption = ref(null);
    let quizTimerInterval = null;

    const activeQuizQuestions = computed(() => {
      let list = allQuestions.value;
      if (quizFilterChapter.value !== 'ALL') {
        list = list.filter(q => q.chapterId === quizFilterChapter.value);
      }
      if (quizOnlyBookmarked.value) {
        list = list.filter(q => q.isBookmarked);
      }

      // 重複排除（同一問題の多重出題を防止）
      const seen = new Set();
      const uniqueList = [];
      for (const q of list) {
        const corrText = (q.options && q.options[q.correctIndex]) ? q.options[q.correctIndex] : '';
        const sig = (q.explanation || (q.question + '::' + corrText)).trim();
        if (!seen.has(sig) && !seen.has(q.id)) {
          seen.add(sig);
          seen.add(q.id);
          uniqueList.push(q);
        }
      }

      if (quizRandomOrder.value) {
        return [...uniqueList].sort(() => 0.5 - Math.random());
      }
      return uniqueList;
    });

    const currentQuestion = computed(() => {
      if (activeQuizQuestions.value.length === 0) return {};
      return activeQuizQuestions.value[currentQuizIndex.value] || {};
    });

    const startQuizTimer = () => {
      clearInterval(quizTimerInterval);
      timerRemaining.value = 40.0;
      isTimerRunning.value = true;
      quizTimerInterval = setInterval(() => {
        if (timerRemaining.value > 0.1) {
          timerRemaining.value -= 0.1;
        } else {
          timerRemaining.value = 0;
          isTimerRunning.value = false;
          clearInterval(quizTimerInterval);
          if (!hasAnswered.value) {
            handleSelectOption(null); // 時間切れ
          }
        }
      }, 100);
    };

    const toggleTimer = () => {
      if (isTimerRunning.value) {
        clearInterval(quizTimerInterval);
        isTimerRunning.value = false;
      } else if (!hasAnswered.value) {
        quizTimerInterval = setInterval(() => {
          if (timerRemaining.value > 0.1) {
            timerRemaining.value -= 0.1;
          } else {
            timerRemaining.value = 0;
            isTimerRunning.value = false;
            clearInterval(quizTimerInterval);
            if (!hasAnswered.value) handleSelectOption(null);
          }
        }, 100);
        isTimerRunning.value = true;
      }
    };

    const handleSelectOption = (idx) => {
      if (hasAnswered.value) return;
      hasAnswered.value = true;
      selectedOption.value = idx;
      clearInterval(quizTimerInterval);
      isTimerRunning.value = false;
    };

    const nextQuestion = () => {
      hasAnswered.value = false;
      selectedOption.value = null;
      if (currentQuizIndex.value < activeQuizQuestions.value.length - 1) {
        currentQuizIndex.value++;
      } else {
        currentQuizIndex.value = 0;
      }
      startQuizTimer();
    };

    const resetQuiz = () => {
      currentQuizIndex.value = 0;
      hasAnswered.value = false;
      selectedOption.value = null;
      startQuizTimer();
    };

    const getOptionStyle = (idx) => {
      if (!hasAnswered.value) {
        return 'bg-slate-950/80 border-slate-800 hover:border-slate-700 text-slate-200';
      }
      if (idx === currentQuestion.value.correctIndex) {
        return 'bg-emerald-950/80 border-emerald-500 text-emerald-100 ring-1 ring-emerald-500';
      }
      if (selectedOption.value === idx) {
        return 'bg-rose-950/80 border-rose-500 text-rose-100 ring-1 ring-rose-500';
      }
      return 'bg-slate-950/40 border-slate-800 text-slate-500 opacity-50';
    };

    const getOptionBadgeStyle = (idx) => {
      if (!hasAnswered.value) {
        return 'bg-slate-800 text-slate-400 border-slate-700';
      }
      if (idx === currentQuestion.value.correctIndex) {
        return 'bg-emerald-500 text-slate-950 border-emerald-400';
      }
      if (selectedOption.value === idx) {
        return 'bg-rose-500 text-white border-rose-400';
      }
      return 'bg-slate-800 text-slate-600 border-slate-800';
    };

    const toggleBookmark = (q) => {
      q.isBookmarked = !q.isBookmarked;
      saveAllToDB(allQuestions.value);
    };

    // 🎧 工種別ドリル演習：ハンズフリー連続聞き流し耳学モード
    const toggleQuizAutoPlay = () => {
      if (isQuizAutoPlay.value) {
        stopSpeech();
      } else {
        stopSpeech();
        if (activeQuizQuestions.value.length === 0) {
          speakText('演習対象の問題がありません。');
          return;
        }
        isQuizAutoPlay.value = true;
        acquireWakeLock().catch(() => {});
        playQuizAutoCycle();
      }
    };

    const playQuizAutoCycle = () => {
      if (!isQuizAutoPlay.value || activeQuizQuestions.value.length === 0) {
        isQuizAutoPlay.value = false;
        return;
      }

      const q = currentQuestion.value;
      if (!q || !q.question) return;

      const qNum = currentQuizIndex.value + 1;
      const cat = q.chapterName || q.category || '';
      const opts = q.options || [];

      // タイマーを一旦停止
      clearInterval(quizTimerInterval);
      isTimerRunning.value = false;

      // 1. 問題文と選択肢の読み上げ
      let speech = `ドリル第${qNum}問。${cat}。問題。${q.question}。`;
      opts.forEach((opt, i) => {
        speech += `選択肢${i + 1}番、${opt}。`;
      });

      speakText(speech, () => {
        if (!isQuizAutoPlay.value) return;

        // 2. シンキングタイム（2.2秒）
        quizAutoTimer = setTimeout(() => {
          if (!isQuizAutoPlay.value) return;

          // 画面上も回答状態にして正解を表示
          handleSelectOption(q.correctIndex);

          // 3. 正解と解説・罠・現場知見の読み上げ（不適当な理由のフィードバック明示）
          const chosenOpt = opts[q.correctIndex] || '';
          const expText = q.explanation ? `不適当である理由の解説、${q.explanation}。` : '';
          const trapText = q.trapNote ? `出題者の引っ掛け罠、${q.trapNote}。` : '';
          const fieldText = q.fieldReality ? `現場工事長の知見、${q.fieldReality}。` : '';
          const answerSpeech = `最も不適当な正解肢は、${q.correctIndex + 1}番です。「${chosenOpt}」という記述が不適当です。${expText}${trapText}${fieldText}`;

          speakText(answerSpeech, () => {
            if (!isQuizAutoPlay.value) return;

            // 4. 少し間を置いて次の問題へ
            quizAutoTimer = setTimeout(() => {
              if (!isQuizAutoPlay.value) return;

              if (currentQuizIndex.value < activeQuizQuestions.value.length - 1) {
                nextQuestion();
                playQuizAutoCycle();
              } else {
                isQuizAutoPlay.value = false;
                speakText('選択した工種ドリルの聞き流しがすべて終了しました。大変お疲れ様でした。');
              }
            }, 1800);
          });
        }, 2200);
      });
    };

    // ==========================================
    // 🚨 現場直結 罠チートシート ＆ 用語集
    // ==========================================
    const cheatSearchQuery = ref('');
    const selectedCheatChapter = ref('ALL');
    const cheatPage = ref(1);
    const itemsPerPage = 12;

    const filteredCheatSheetQuestions = computed(() => {
      return allQuestions.value.filter(q => {
        const matchChapter = selectedCheatChapter.value === 'ALL' || q.chapterId === selectedCheatChapter.value;
        const query = cheatSearchQuery.value.trim().toLowerCase();
        const matchQuery = !query || 
          (q.question && q.question.toLowerCase().includes(query)) ||
          (q.trapNote && q.trapNote.toLowerCase().includes(query)) ||
          (q.explanation && q.explanation.toLowerCase().includes(query)) ||
          (q.fieldReality && q.fieldReality.toLowerCase().includes(query));
        return matchChapter && matchQuery;
      });
    });

    const totalPages = computed(() => {
      return Math.ceil(filteredCheatSheetQuestions.value.length / itemsPerPage);
    });

    const paginatedCheatQuestions = computed(() => {
      const start = (cheatPage.value - 1) * itemsPerPage;
      return filteredCheatSheetQuestions.value.slice(start, start + itemsPerPage);
    });

    watch([cheatSearchQuery, selectedCheatChapter], () => {
      cheatPage.value = 1;
      if (isCheatAutoPlay.value) {
        stopSpeech();
      }
    });

    // 🎧 罠チートシート：現場知見＆要点連続聞き流し耳学モード
    const toggleCheatAutoPlay = () => {
      if (isCheatAutoPlay.value) {
        stopSpeech();
      } else {
        stopSpeech();
        const list = filteredCheatSheetQuestions.value;
        if (list.length === 0) {
          speakText('対象のチートシート項目がありません。');
          return;
        }
        isCheatAutoPlay.value = true;
        currentCheatSpeechIndex.value = 0;
        acquireWakeLock().catch(() => {});
        playCheatAutoCycle();
      }
    };

    const playCheatAutoCycle = () => {
      const list = filteredCheatSheetQuestions.value;
      if (!isCheatAutoPlay.value || list.length === 0 || currentCheatSpeechIndex.value >= list.length) {
        isCheatAutoPlay.value = false;
        speakText('チートシートの全項目聞き流しが完了しました。大変お疲れ様でした。');
        return;
      }

      // 該当アイテムがあるページに自動めくり
      const targetPage = Math.floor(currentCheatSpeechIndex.value / itemsPerPage) + 1;
      if (cheatPage.value !== targetPage) {
        cheatPage.value = targetPage;
      }

      const q = list[currentCheatSpeechIndex.value];
      const num = currentCheatSpeechIndex.value + 1;
      const correctOptText = (q.options && q.options[q.correctIndex]) ? q.options[q.correctIndex] : '';
      const expText = q.explanation ? `不適当である理由の解説、${q.explanation}。` : '';
      const trapText = q.trapNote ? `出題者の引っ掛け罠、${q.trapNote}。` : '';
      const fieldText = q.fieldReality ? `現場工事長の知見、${q.fieldReality}。` : '';

      const cheatSpeech = `チートシート第${num}項目。${cat}。問題。${q.question}。最も不適当な肢は、肢${q.correctIndex + 1}番です。「${correctOptText}」という記述が不適当です。${trapText}${fieldText}${expText}`;

      speakText(cheatSpeech, () => {
        if (!isCheatAutoPlay.value) return;

        cheatAutoTimer = setTimeout(() => {
          if (!isCheatAutoPlay.value) return;
          currentCheatSpeechIndex.value++;
          if (currentCheatSpeechIndex.value < list.length) {
            playCheatAutoCycle();
          } else {
            isCheatAutoPlay.value = false;
            speakText('チートシートの全項目聞き流しが完了しました。');
          }
        }, 1600);
      });
    };

    // ==========================================
    // 初期化ロード
    // ==========================================
    const switchTab = (tab) => {
      stopSpeech();
      activeTab.value = tab;
      if (tab === 'quiz') {
        startQuizTimer();
      } else {
        clearInterval(quizTimerInterval);
        isTimerRunning.value = false;
      }
    };

    const exportJSON = () => {
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(allQuestions.value, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute("href", dataStr);
      downloadAnchor.setAttribute("download", "arch_construction_600_questions.json");
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
    };

    const resetToFactoryPool = async () => {
      if (confirm('初期の600問プールにリセットしますか？')) {
        allQuestions.value = window.QUESTIONS_BANK || [];
        await saveAllToDB(allQuestions.value);
        alert('600問の初期問題プールにリセットしました！');
      }
    };

    // ==========================================
    // ➕ 手打ち問題追加（参考書からの登録）
    // ==========================================
    const newQuestion = ref({
      chapterId: 'ch1',
      category: '建築学（環境・材料）',
      question: '',
      option1: '',
      option2: '',
      option3: '',
      option4: '',
      correctIndex: 0,
      explanation: '',
      trapNote: '',
      fieldReality: '',
      difficulty: '本番レベル'
    });

    const addCustomQuestionSuccess = ref(false);

    const chapterCategoryDefaults = {
      ch1: { name: '第1章 建築学（環境・構造・材料）', category: '建築学（環境・材料）' },
      ch2: { name: '第2章 共通（設備・契約・測量）', category: '設備・契約・測量' },
      ch3: { name: '第3章 躯体施工（地盤・RC・鉄骨・型枠）', category: '躯体施工（RC・鉄骨）' },
      ch4: { name: '第4章 仕上施工（防水・タイル・内装・建具）', category: '仕上施工（防水・内装）' },
      ch5: { name: '第5章 施工管理法（工程・品質・安全）', category: '施工管理法（工程・安全）' },
      ch6: { name: '第6章 法規（建築基準法・建設業法・労基法）', category: '法規（基準法・建設業法）' }
    };

    const onNewQuestionChapterChange = () => {
      const ch = chapterCategoryDefaults[newQuestion.value.chapterId];
      if (ch) {
        newQuestion.value.category = ch.category;
      }
    };

    const addCustomQuestion = async () => {
      if (!newQuestion.value.question.trim()) {
        alert('問題文を入力してください。');
        return;
      }
      if (!newQuestion.value.option1.trim() || !newQuestion.value.option2.trim() || 
          !newQuestion.value.option3.trim() || !newQuestion.value.option4.trim()) {
        alert('選択肢1〜4をすべて入力してください。');
        return;
      }

      const chInfo = chapterCategoryDefaults[newQuestion.value.chapterId] || { name: 'オリジナル章', category: '自作問題' };
      const qObj = {
        id: 'custom-q-' + Date.now(),
        chapterId: newQuestion.value.chapterId,
        chapterName: chInfo.name,
        category: newQuestion.value.category.trim() || chInfo.category,
        question: newQuestion.value.question.trim(),
        options: [
          newQuestion.value.option1.trim(),
          newQuestion.value.option2.trim(),
          newQuestion.value.option3.trim(),
          newQuestion.value.option4.trim()
        ],
        correctIndex: Number(newQuestion.value.correctIndex),
        explanation: newQuestion.value.explanation.trim() || ('正解は肢' + (Number(newQuestion.value.correctIndex) + 1) + 'です。'),
        trapNote: newQuestion.value.trapNote.trim() || '【🚨 ここが引っ掛け罠！】\n・参考書の要点を再確認しましょう。',
        fieldReality: newQuestion.value.fieldReality.trim() || '現場施工においても頻出の重要管理項目です。',
        difficulty: newQuestion.value.difficulty,
        isCustom: true,
        isBookmarked: false
      };

      allQuestions.value.unshift(qObj);
      await saveAllToDB(allQuestions.value);

      // フォームリセット
      newQuestion.value.question = '';
      newQuestion.value.option1 = '';
      newQuestion.value.option2 = '';
      newQuestion.value.option3 = '';
      newQuestion.value.option4 = '';
      newQuestion.value.explanation = '';
      newQuestion.value.trapNote = '';
      newQuestion.value.fieldReality = '';

      addCustomQuestionSuccess.value = true;
      setTimeout(() => { addCustomQuestionSuccess.value = false; }, 3000);
      alert('🎉 問題を追加しました！テストや演習に即座に反映されます。');
    };

    const customQuestionsList = computed(() => {
      return allQuestions.value.filter(q => q.isCustom || (q.id && q.id.startsWith('custom-')));
    });

    const deleteCustomQuestion = async (id) => {
      if (confirm('この自作問題を削除しますか？')) {
        allQuestions.value = allQuestions.value.filter(q => q.id !== id);
        await saveAllToDB(allQuestions.value);
      }
    };

    // PWA & Android / iOS モバイル対応状態
    const installPrompt = ref(null);
    const isInstallable = ref(false);
    const isOnline = ref(typeof navigator !== 'undefined' ? navigator.onLine : true);

    if (typeof window !== 'undefined') {
      window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        installPrompt.value = e;
        isInstallable.value = true;
      });
      window.addEventListener('appinstalled', () => {
        isInstallable.value = false;
        installPrompt.value = null;
      });
      window.addEventListener('online', () => { isOnline.value = true; });
      window.addEventListener('offline', () => { isOnline.value = false; });
    }

    const triggerInstall = async () => {
      if (!installPrompt.value) return;
      installPrompt.value.prompt();
      const { outcome } = await installPrompt.value.userChoice;
      if (outcome === 'accepted') {
        isInstallable.value = false;
      }
      installPrompt.value = null;
    };

    onMounted(async () => {
      maskUrlAndHistory();
      try {
        const cached = await getAllFromDB();
        // キャッシュが存在し、かつ最新の問題バンク件数と一致していればキャッシュを使用。
        // 件数が異なる場合やキャッシュが空の場合は最新バンクでIndexedDBを更新・初期化。
        if (cached && cached.length > 0 && window.QUESTIONS_BANK && cached.length === window.QUESTIONS_BANK.length) {
          allQuestions.value = cached;
        } else if (window.QUESTIONS_BANK && window.QUESTIONS_BANK.length > 0) {
          allQuestions.value = window.QUESTIONS_BANK;
          await saveAllToDB(window.QUESTIONS_BANK);
        }
      } catch (err) {
        if (window.QUESTIONS_BANK) {
          allQuestions.value = window.QUESTIONS_BANK;
        }
      }
    });

    onUnmounted(() => {
      stopSpeech();
      clearInterval(examTimerInterval);
      clearInterval(quizTimerInterval);
    });

    return {
      chapters,
      activeTab,
      switchTab,
      allQuestions,
      totalQuestionsCount,

      // Word Flash & Sector
      allWords,
      currentWordIndex,
      wordFilterCategory,
      wordSessionCountOption,
      isWordRandom,
      selectedWordChoice,
      hasAnsweredWord,
      wordStreak,
      wordMastered,
      activeWords,
      currentWord,
      currentWordChoices,
      showWordGlossary,
      toggleWordGlossary,
      handleSelectWord,
      nextWord,
      prevWord,
      toggleWordMastered,
      isWordSessionFinished,
      wordSessionStats,
      reviewedWordList,
      wordReviewFilter,
      startWordSession,
      retryWrongWords,
      wordSectors,
      selectSector,
      finishWordSessionEarly,

      // Audio & Speech (TTS / 耳学通勤モード & 振り返り耳学 & 全モード聞き流し)
      isSpeechSupported,
      isSpeaking,
      isAutoPlay,
      isReviewAutoPlay,
      currentReviewSpeechIndex,
      isExamAutoPlay,
      isExamReviewAutoPlay,
      currentExamReviewSpeechIndex,
      isQuizAutoPlay,
      isCheatAutoPlay,
      currentCheatSpeechIndex,
      speechRate,
      speakCurrentWord,
      speakItem,
      toggleAutoPlay,
      toggleReviewAutoPlay,
      toggleExamAutoPlay,
      toggleExamReviewAutoPlay,
      toggleQuizAutoPlay,
      toggleCheatAutoPlay,
      stopSpeech,

      // Exam
      selectedExamMode,
      isExamStarted,
      isExamFinished,
      examQuestions,
      currentExamIndex,
      currentExamQuestion,
      examUserAnswers,
      examMarks,
      examTimeRemaining,
      answeredExamCount,
      getExamModeTitle,
      startSpecificExam,
      selectExamAnswer,
      toggleExamMark,
      nextExamQuestion,
      prevExamQuestion,
      finishExam,
      resetExamState,
      formatExamTime,
      getExamOptionClass,
      getExamBadgeClass,
      getExamGridClass,
      examScore,
      examScoreRate,
      examCategoryStats,
      examWrongQuestions,
      examMarkedQuestions,
      examReviewFilter,
      filteredExamReviewList,
      startRetryExam,
      restartCurrentExam,
      toggleQuestionBookmark,

      // Quiz
      quizFilterChapter,
      quizOnlyBookmarked,
      quizRandomOrder,
      currentQuizIndex,
      activeQuizQuestions,
      currentQuestion,
      timerRemaining,
      isTimerRunning,
      hasAnswered,
      selectedOption,
      toggleTimer,
      handleSelectOption,
      nextQuestion,
      resetQuiz,
      getOptionStyle,
      getOptionBadgeStyle,
      toggleBookmark,

      // Cheatsheet
      cheatSearchQuery,
      selectedCheatChapter,
      filteredCheatSheetQuestions,
      paginatedCheatQuestions,
      cheatPage,
      totalPages,

      // Manage & Custom Questions
      exportJSON,
      resetToFactoryPool,
      newQuestion,
      addCustomQuestion,
      customQuestionsList,
      deleteCustomQuestion,
      onNewQuestionChapterChange,
      addCustomQuestionSuccess,

      // PWA & Mobile
      isInstallable,
      triggerInstall,
      isOnline,

      // Screen Wake Lock & Keepalive
      isWakeLockSupported,
      isWakeLockActive,
      wakeLockManualOverride,
      toggleManualWakeLock,
      testSpeech,

      // App Update & Reload
      reloadApp,

      // Security & Authorization
      isAuthorized,
      authPasscode,
      authError,
      authSuccessMsg,
      verifyAuth,
      lockApp
    };
  }
}).mount('#app');
