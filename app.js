const { createApp, ref, computed, onMounted, onUnmounted, watch, nextTick } = Vue;

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

    const appVersion = ref('Ver.3.2.5');

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

    // 📲 スマホ読み込み用QRコードモーダル (リアルタイムVer.3.2.2配信 & Wi-Fi & GitHub Pages対応)
    const showQrModal = ref(false);
    const qrMode = ref('tunnel'); // 'tunnel' | 'wifi' | 'github'
    const liveTunnelUrl = 'https://fool-tracks-attitudes-herbs.trycloudflare.com/?v=3.2.2';
    const localWifiUrl = 'http://192.168.0.8:8090/?v=3.2.2';
    const githubPagesUrl = 'https://genn0710-max.github.io/1kyu-cbt/';

    const currentQrUrl = computed(() => {
      if (qrMode.value === 'wifi') return localWifiUrl;
      if (qrMode.value === 'github') return githubPagesUrl;
      return liveTunnelUrl;
    });

    const qrCodeImageUrl = computed(() => {
      return `https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=10&data=${encodeURIComponent(currentQrUrl.value)}`;
    });

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

    // 建築施工管理技士補 国家試験専用：超高精度・発音正規化エンジン
    // 機械音声の誤読・不自然なイントネーション・数値単位の潰れを完全に排除
    const normalizeSpeechText = (text) => {
      if (!text) return "";
      let s = String(text);

      // 1. 絵文字・視覚用装飾記号の自然化（機械音声の「けいほうとう」等の誤読を完全防止）
      s = s.replace(/【🚨\s*ここが引っ掛け罠！?】/g, "、ここが引っ掛け罠、");
      s = s.replace(/【正解の基準[:：]?\s*/g, "、正解の基準、");
      s = s.replace(/■\s*用語の役割[:：]?/g, "、用語の役割、");
      s = s.replace(/■\s*試験対策の急所[:：]?/g, "、試験対策の急所、");
      s = s.replace(/■\s*実務・法令の背景[:：]?/g, "、実務と法令の背景、");
      s = s.replace(/【正解】/g, "、正解、");
      s = s.replace(/【解説】/g, "、解説、");
      s = s.replace(/【実務直結】/g, "、実務直結のポイント、");
      s = s.replace(/【暗記即解】/g, "、暗記即解の要点、");
      s = s.replace(/【正誤のポイント】/g, "、正誤のポイント、");
      s = s.replace(/[🚨⚠️💡🔑🔒🔓✅❌📲🔊✈️⭐■・▶▼◆※●〇○]/g, " ");

      // 2. 設問番号・選択肢番号・記号の自然な読み上げ化
      s = s.replace(/〔No\.\s*(\d+)〕/gi, "第$1問、");
      s = s.replace(/No\.\s*(\d+)/gi, "第$1問、");
      s = s.replace(/(^|[\n\r])\s*([1-4])\.\s*/g, "$1選択肢$2、");
      s = s.replace(/(^|[\n\r])\s*\(([1-4])\)\s*/g, "$1選択肢$2、");
      s = s.replace(/(^|[\n\r])\s*①\s*/g, "$1選択肢1、");
      s = s.replace(/(^|[\n\r])\s*②\s*/g, "$1選択肢2、");
      s = s.replace(/(^|[\n\r])\s*③\s*/g, "$1選択肢3、");
      s = s.replace(/(^|[\n\r])\s*④\s*/g, "$1選択肢4、");

      // 3. 条文・法令記号の正確な読み下し
      s = s.replace(/第(\d+)条の(\d+)の(\d+)/g, "だい$1じょうの $2の $3、");
      s = s.replace(/第(\d+)条の(\d+)/g, "だい$1じょうの $2、");
      s = s.replace(/第(\d+)条/g, "だい$1じょう、");
      s = s.replace(/第(\d+)項/g, "だい$1こう、");
      s = s.replace(/第(\d+)号/g, "だい$1ごう、");
      s = s.replace(/令第/g, "れい だい");

      // 4. カンマ付き数値・分数・範囲（〜）・比率の正規化
      s = s.replace(/(\d+),(\d{3})/g, "$1$2");
      s = s.replace(/(\d+)\s*[\/／]\s*(\d+)/g, "$2分の$1");
      s = s.replace(/(\d+)\s*[〜～]\s*(\d+)/g, "$1から$2");
      s = s.replace(/(\d+)\s*[:：]\s*(\d+)/g, "$1対$2");
      s = s.replace(/≧/g, "以上");
      s = s.replace(/≦/g, "以下");
      s = s.replace(/±/g, "プラスマイナス ");

      // 5. 建築単位記号の正確な読み上げ
      s = s.replace(/N\s*[\/／]\s*mm[²2]|N／mm[²2]/g, "ニュートン毎平方ミリ");
      s = s.replace(/kN\s*[\/／]\s*m[²2]|kN／m[²2]/g, "キロニュートン毎平方メートル");
      s = s.replace(/kg\s*[\/／]\s*m[³3]|kg／m[³3]/g, "キログラム毎立方メートル");
      s = s.replace(/g\s*[\/／]\s*cm[³3]/g, "グラム毎立方センチ");
      s = s.replace(/kN・m|kN･m/g, "キロニュートンメートル");
      s = s.replace(/N・m|N･m/g, "ニュートンメートル");
      s = s.replace(/N・mm|N･mm/g, "ニュートンミリ");
      s = s.replace(/m[³3]|m3/g, "立方メートル");
      s = s.replace(/m[²2]|m2/g, "平方メートル");
      s = s.replace(/cm[²2]|cm2/g, "平方センチ");
      s = s.replace(/cm[³3]|cm3/g, "立方センチ");
      s = s.replace(/MPa/g, "メガパスカル");
      s = s.replace(/kPa/g, "キロパスカル");
      s = s.replace(/(\d+)\s*Pa(?![a-zA-Z])/g, "$1パスカル");
      s = s.replace(/kN/g, "キロニュートン");
      s = s.replace(/(\d+)\s*kW(?![a-zA-Z])/g, "$1キロワット");
      s = s.replace(/lux|lx/g, "ルクス");
      s = s.replace(/dB\(A\)/g, "デシベルエー");
      s = s.replace(/dB/g, "デシベル");
      s = s.replace(/ppm/g, "ピーピーエム");
      s = s.replace(/pH/g, "ピーエイチ");
      s = s.replace(/℃/g, "度");
      s = s.replace(/％|%/g, "パーセント");
      s = s.replace(/(\d+)\s*mm(?![a-zA-Z])/g, "$1ミリ");
      s = s.replace(/(\d+)\s*cm(?![a-zA-Z])/g, "$1センチ");
      s = s.replace(/(\d+(\.\d+)?)\s*m(?![a-zA-Z²³23])/g, "$1メートル");
      s = s.replace(/(\d+)\s*kg(?![a-zA-Z])/g, "$1キログラム");
      s = s.replace(/(\d+)\s*t(?![a-zA-Z])/g, "$1トン");
      s = s.replace(/(\d+)\s*ℓ|(\d+)\s*L(?![a-zA-Z])/g, "$1リットル");
      s = s.replace(/(\d+)\s*mL|(\d+)\s*ml/g, "$1ミリリットル");

      // 6. カレンダー日付及び日数・回数・年数・人数の正しい日本語音変化（誤読防止）
      s = s.replace(/(\d+)月1日/g, "$1がつ ついたち");
      s = s.replace(/(\d+)月2日/g, "$1がつ ふつか");
      s = s.replace(/(\d+)月3日/g, "$1がつ みっか");
      s = s.replace(/(\d+)月4日/g, "$1がつ よっか");
      s = s.replace(/(\d+)月5日/g, "$1がつ いつか");
      s = s.replace(/(\d+)月6日/g, "$1がつ むいか");
      s = s.replace(/(\d+)月7日/g, "$1がつ なのか");
      s = s.replace(/(\d+)月8日/g, "$1がつ ようか");
      s = s.replace(/(\d+)月9日/g, "$1がつ ここのか");
      s = s.replace(/(\d+)月10日/g, "$1がつ とおか");
      s = s.replace(/(\d+)月14日/g, "$1がつ じゅうよっか");
      s = s.replace(/(\d+)月20日/g, "$1がつ はつか");
      s = s.replace(/(\d+)月24日/g, "$1がつ にじゅうよっか");
      s = s.replace(/1日あたり/g, "いちにちあたり");
      s = s.replace(/1日の/g, "いちにちの");
      s = s.replace(/1日間/g, "いちにちかん");
      s = s.replace(/1日以内/g, "いちにち以内");
      s = s.replace(/1日以上/g, "いちにち以上");
      s = s.replace(/1日前に/g, "いちにちまえに");
      s = s.replace(/1日前/g, "いちにちまえ");
      s = s.replace(/1日(?![月0-9])/g, "いちにち");
      s = s.replace(/2日/g, "ふつか");
      s = s.replace(/3日/g, "みっか");
      s = s.replace(/4日/g, "よっか");
      s = s.replace(/5日/g, "いつか");
      s = s.replace(/6日/g, "むいか");
      s = s.replace(/7日/g, "なのか");
      s = s.replace(/8日/g, "ようか");
      s = s.replace(/9日/g, "ここのか");
      s = s.replace(/10日/g, "とおか");
      s = s.replace(/14日/g, "じゅうよっか");
      s = s.replace(/20日/g, "はつか");
      s = s.replace(/24日/g, "にじゅうよっか");
      s = s.replace(/28日/g, "にじゅうはちにち");
      s = s.replace(/91日/g, "きゅうじゅういちにち");

      s = s.replace(/1回/g, "いっかい");
      s = s.replace(/6回/g, "ろっかい");
      s = s.replace(/8回/g, "はっかい");
      s = s.replace(/10回/g, "じゅっかい");

      s = s.replace(/1人/g, "ひとり");
      s = s.replace(/2人/g, "ふたり");
      s = s.replace(/4人/g, "よにん");

      s = s.replace(/1本/g, "いっぽん");
      s = s.replace(/3本/g, "さんぼん");
      s = s.replace(/6本/g, "ろっぽん");

      s = s.replace(/1階/g, "いっかい");
      s = s.replace(/3階/g, "さんがい");
      s = s.replace(/6階/g, "ろっかい");
      s = s.replace(/8階/g, "はっかい");
      s = s.replace(/10階/g, "じゅっかい");

      s = s.replace(/1ヶ月|1か月|1カ月|1箇月/g, "いっかげつ");
      s = s.replace(/6ヶ月|6か月|6カ月|6箇月/g, "ろっかげつ");
      s = s.replace(/1箇所|1ヵ所|1カ所/g, "いっかしょ");
      s = s.replace(/2現場/g, "にげんば");

      // 7. 鉄筋・鋼材・材料規格・英字略語の完全展開
      s = s.replace(/\bD10\b/g, "ディーじゅう");
      s = s.replace(/\bD13\b/g, "ディーじゅうさん");
      s = s.replace(/\bD16\b/g, "ディーじゅうろく");
      s = s.replace(/\bD19\b/g, "ディーじゅうきゅう");
      s = s.replace(/\bD22\b/g, "ディーにじゅうに");
      s = s.replace(/\bD25\b/g, "ディーにじゅうご");
      s = s.replace(/\bD29\b/g, "ディーにじゅうきゅう");
      s = s.replace(/\bD32\b/g, "ディーさんじゅうに");
      s = s.replace(/\bφ(\d+)|Φ(\d+)/g, "ファイ$1");

      s = s.replace(/SD295A/g, "エスディー にひゃくきゅうじゅうご エー");
      s = s.replace(/SD345/g, "エスディー さんびゃくよんじゅうご");
      s = s.replace(/SD390/g, "エスディー さんびゃくきゅうじゅう");
      s = s.replace(/SS400/g, "エスエス よんひゃく");
      s = s.replace(/SM490/g, "エスエム よんひゃくきゅうじゅう");
      s = s.replace(/SN400B/g, "エスエヌ よんひゃく ビー");
      s = s.replace(/SN490B/g, "エスエヌ よんひゃくきゅうじゅう ビー");
      s = s.replace(/SN490C/g, "エスエヌ よんひゃくきゅうじゅう シー");
      s = s.replace(/SN材/g, "エスエヌざい");
      s = s.replace(/F10T/g, "エフテンティー");
      s = s.replace(/S10T/g, "エステンティー");

      s = s.replace(/ALCパネル/g, "エーエルシーパネル");
      s = s.replace(/ALC/g, "エーエルシー");
      s = s.replace(/LGS/g, "エルジーエス");
      s = s.replace(/SRC造/g, "エスアールシーぞう");
      s = s.replace(/SRC/g, "エスアールシー");
      s = s.replace(/RC造/g, "アールシーぞう");
      s = s.replace(/RC/g, "アールシー");
      s = s.replace(/S造/g, "エスぞう");
      s = s.replace(/PCa/g, "プレキャスト");
      s = s.replace(/PC鋼線/g, "ピーシーこうせん");
      s = s.replace(/PC鋼棒/g, "ピーシーこうぼう");
      s = s.replace(/PC鋼材/g, "ピーシーこうざい");
      s = s.replace(/PC/g, "ピーシー");
      s = s.replace(/Fc/g, "エフシー");
      s = s.replace(/JASS/g, "ジャス");
      s = s.replace(/JIS/g, "ジス");
      s = s.replace(/QC7つ道具/g, "キューシー ななつどうぐ");
      s = s.replace(/新QC7つ道具/g, "しんキューシー ななつどうぐ");
      s = s.replace(/QC/g, "キューシー");
      s = s.replace(/ISO9001/g, "アイエスオー きゅうせんいち");
      s = s.replace(/ISO14001/g, "アイエスオー いちまんよんせんいち");
      s = s.replace(/ISO45001/g, "アイエスオー よんまんごせんいち");
      s = s.replace(/ISO/g, "アイエスオー");
      s = s.replace(/Low-Eガラス/g, "ローイーガラス");
      s = s.replace(/Low-E/g, "ローイー");
      s = s.replace(/TBM/g, "ティービーエム");
      s = s.replace(/KYK/g, "ケーワイケイ");
      s = s.replace(/KY活動/g, "ケーワイかつどう");
      s = s.replace(/WBGT/g, "暑さ指数（ダブリュービージーティー）");
      s = s.replace(/VOC/g, "ブイオーシー");
      s = s.replace(/PDCA/g, "ピーディーシーエー");
      s = s.replace(/PERT/g, "パート");
      s = s.replace(/CPM/g, "シーピーエム");
      s = s.replace(/UCL/g, "ユーシーエル");
      s = s.replace(/LCL/g, "エルシーエル");

      // 8. 建築施工管理・構造・材料・法規 難読専門用語辞書
      // 【地盤・基礎・土工事】
      s = s.replace(/躯体/g, "くたい");
      s = s.replace(/仕上/g, "しあげ");
      s = s.replace(/地業/g, "じぎょう");
      s = s.replace(/根切り|根切/g, "ねぎり");
      s = s.replace(/床付け面|床付面/g, "とこづけめん");
      s = s.replace(/床付け|床付/g, "とこづけ");
      s = s.replace(/埋戻し|埋戻/g, "うめもどし");
      s = s.replace(/山留め壁|山留壁/g, "やまどめへき");
      s = s.replace(/山留め|山留/g, "やまどめ");
      s = s.replace(/切梁/g, "きりばり");
      s = s.replace(/腹起し|腹起/g, "はらおこし");
      s = s.replace(/火打ち梁|火打梁/g, "ひうちばり");
      s = s.replace(/火打ち|火打/g, "ひうち");
      s = s.replace(/親杭/g, "おやぐい");
      s = s.replace(/鋼矢板/g, "こうやいた");
      s = s.replace(/矢板/g, "やいた");
      s = s.replace(/トレミー管|トレミー菅/g, "トレミーかん");
      s = s.replace(/トレミー抜け/g, "トレミーぬけ");
      s = s.replace(/場所打ちコンクリート杭/g, "ばしょうちコンクリートぐい");
      s = s.replace(/場所打ち杭/g, "ばしょうちぐい");
      s = s.replace(/場所打ち/g, "ばしょうち");
      s = s.replace(/既製杭/g, "きせいくい");
      s = s.replace(/節杭/g, "ふしぐい");
      s = s.replace(/先端羽根付き鋼管杭/g, "せんたんはねつきこうかんぐい");
      s = s.replace(/鋼管杭/g, "こうかんぐい");
      s = s.replace(/杭頭/g, "くいとう");
      s = s.replace(/杭胴体/g, "くいどうたい");
      s = s.replace(/鉄筋かご|鉄筋籠/g, "てっきんかご");
      s = s.replace(/孔壁/g, "こうへき");
      s = s.replace(/孔底/g, "こうてい");
      s = s.replace(/孔口/g, "こうこう");
      s = s.replace(/泥水/g, "でいすい");
      s = s.replace(/底ざらい/g, "そこざらい");
      s = s.replace(/検尺テープ|検尺/g, "けんじゃく");
      s = s.replace(/スライム処理/g, "スライムしょり");
      s = s.replace(/安定液/g, "あんていえき");
      s = s.replace(/ベントナイト/g, "ベントナイト");
      s = s.replace(/割栗石/g, "わりぐりいし");
      s = s.replace(/目荒らし|目荒し/g, "めあらし");
      s = s.replace(/捨てコンクリート|捨コン/g, "すてコンクリート");
      s = s.replace(/布基礎/g, "ぬのきそ");
      s = s.replace(/べた基礎|ベタ基礎/g, "べたきそ");
      s = s.replace(/独立基礎/g, "どくりつきそ");
      s = s.replace(/地耐力/g, "ちたいりょく");
      s = s.replace(/盤ぶくれ/g, "ばんぶくれ");

      // 【配管・管工種（「くだ」誤読防止）】
      s = s.replace(/鋼管/g, "こうかん");
      s = s.replace(/配管/g, "はいかん");
      s = s.replace(/塩ビ管/g, "エンビかん");
      s = s.replace(/さや管|サヤ管/g, "サヤかん");
      s = s.replace(/ヒューム管/g, "ヒュームかん");
      s = s.replace(/ボイド管/g, "ボイドかん");
      s = s.replace(/スリーブ管/g, "スリーブかん");
      s = s.replace(/直管/g, "ちょっかん");
      s = s.replace(/本管/g, "ほんかん");
      s = s.replace(/枝管/g, "えだかん");
      s = s.replace(/排水管/g, "はいすいかん");
      s = s.replace(/給水管/g, "きゅうすいかん");
      s = s.replace(/通気管/g, "つうきかん");
      s = s.replace(/冷媒管/g, "れいばいかん");
      s = s.replace(/導管/g, "どうかん");

      // 【コンクリート工事】
      s = s.replace(/せき板|堰板/g, "せきいた");
      s = s.replace(/型枠支保工/g, "かたわくしほこう");
      s = s.replace(/支保工/g, "しほこう");
      s = s.replace(/脱型/g, "だっけい");
      s = s.replace(/存置期間/g, "ぞんちきかん");
      s = s.replace(/存置/g, "ぞんち");
      s = s.replace(/盛替え/g, "もりかえ");
      s = s.replace(/打継ぎ面|打継面/g, "うちつぎめん");
      s = s.replace(/打継ぎ|打継/g, "うちつぎ");
      s = s.replace(/打込み|打込/g, "うちこみ");
      s = s.replace(/打重ね時間/g, "うちがさねじかん");
      s = s.replace(/打重ね/g, "うちがさね");
      s = s.replace(/荷卸し|荷卸/g, "におろし");
      s = s.replace(/練混ぜ時間/g, "ねりまぜじかん");
      s = s.replace(/練混ぜ/g, "ねりまぜ");
      s = s.replace(/粗骨材/g, "そこつざい");
      s = s.replace(/細骨材/g, "さいこつざい");
      s = s.replace(/骨材/g, "こつざい");
      s = s.replace(/単位水量/g, "たんいすいりょう");
      s = s.replace(/水セメント比/g, "すいセメントひ");
      s = s.replace(/空気量/g, "くうきりょう");
      s = s.replace(/スランプフロー/g, "スランプフロー");
      s = s.replace(/呼び強度/g, "よびきょうど");
      s = s.replace(/設計基準強度/g, "せっけいきじゅんきょうど");
      s = s.replace(/調合管理強度/g, "ちょうごうかんりきょうど");
      s = s.replace(/品質基準強度/g, "ひんしつきじゅんきょうど");
      s = s.replace(/水和熱/g, "すいわねつ");
      s = s.replace(/水和反応/g, "すいわはんのう");
      s = s.replace(/暑中コンクリート/g, "しょちゅうコンクリート");
      s = s.replace(/寒中コンクリート/g, "かんちゅうコンクリート");
      s = s.replace(/マスコンクリート/g, "マスコンクリート");
      s = s.replace(/豆板/g, "まめいた");
      s = s.replace(/ジャンカ/g, "ジャンカ");
      s = s.replace(/かぶり厚さ|かぶり厚/g, "かぶりあつさ");
      s = s.replace(/棒状振動機/g, "ぼうじょうしんどうき");
      s = s.replace(/締固め|締め固め/g, "しめかため");

      // 【鉄筋・鉄骨・溶接工事】
      s = s.replace(/異形鉄筋/g, "いけいてっきん");
      s = s.replace(/主筋/g, "しゅきん");
      s = s.replace(/帯筋|帯鉄筋/g, "おびきん");
      s = s.replace(/肋筋|あばら筋/g, "ろっきん");
      s = s.replace(/配力筋/g, "はいりょくきん");
      s = s.replace(/定着長さ/g, "ていちゃくながさ");
      s = s.replace(/重ね継手/g, "かさねつぎて");
      s = s.replace(/ガス圧接/g, "ガスあっせつ");
      s = s.replace(/超音波探傷試験/g, "ちょうおんぱたんしょうしけん");
      s = s.replace(/隅肉溶接|隅肉/g, "すみにく溶接");
      s = s.replace(/開先角度/g, "かいさきかくど");
      s = s.replace(/開先/g, "かいさき");
      s = s.replace(/余盛り|余盛/g, "よもり");
      s = s.replace(/のど厚/g, "のどあつ");
      s = s.replace(/脚長/g, "きゃくちょう");
      s = s.replace(/裏当て金/g, "うらあてがね");
      s = s.replace(/高力ボルト/g, "こうりきボルト");
      s = s.replace(/トルシア形/g, "トルシアがた");
      s = s.replace(/すべり係数/g, "すべりけいすう");
      s = s.replace(/締付け|締付/g, "しめつけ");
      s = s.replace(/共回り/g, "ともまわり");
      s = s.replace(/建方|建て方/g, "たてかた");
      s = s.replace(/本締め/g, "ほんじめ");
      s = s.replace(/建入れ直し/g, "たていれなおし");
      s = s.replace(/玉掛け/g, "たまかけ");
      s = s.replace(/地切り/g, "じぎり");
      s = s.replace(/合番/g, "あいばん");
      s = s.replace(/通しダイアフラム/g, "とおしダイアフラム");
      s = s.replace(/内ダイアフラム/g, "うちダイアフラム");

      // 【木造・仕上・屋根・建具工事】
      s = s.replace(/母屋/g, "もや");
      s = s.replace(/棟木/g, "むなぎ");
      s = s.replace(/垂木/g, "たるき");
      s = s.replace(/野地板/g, "のじいた");
      s = s.replace(/胴縁/g, "どうぶち");
      s = s.replace(/帯金物/g, "おびかなもの");
      s = s.replace(/羽子板ボルト/g, "はごいたボルト");
      s = s.replace(/短冊金物/g, "たんざくかなもの");
      s = s.replace(/筋かい|筋交い|筋交/g, "すじかい");
      s = s.replace(/間柱/g, "まばしら");
      s = s.replace(/管柱/g, "くだばしら");
      s = s.replace(/通し柱/g, "とおしばしら");
      s = s.replace(/土台/g, "どだい");
      s = s.replace(/梁底/g, "はりぞこ");
      s = s.replace(/梁側/g, "はりがわ");
      s = s.replace(/梁下/g, "はりした");
      s = s.replace(/大梁/g, "おおばり");
      s = s.replace(/小梁/g, "こばり");
      s = s.replace(/梁/g, "はり");
      s = s.replace(/柱/g, "はしら");
      s = s.replace(/桁/g, "けた");
      s = s.replace(/胴差/g, "どうざし");
      s = s.replace(/根太/g, "ねだ");
      s = s.replace(/大引き/g, "おおびき");
      s = s.replace(/床束/g, "ゆかづか");
      s = s.replace(/長押/g, "なげし");
      s = s.replace(/鴨居/g, "かもい");
      s = s.replace(/敷居/g, "しきい");
      s = s.replace(/笠木/g, "かさぎ");
      s = s.replace(/沓摺り|沓摺/g, "くつずり");
      s = s.replace(/上がり框|框/g, "あがりかまち");
      s = s.replace(/幅木|巾木/g, "はばき");
      s = s.replace(/巾/g, "はば");
      s = s.replace(/段葺き/g, "だんぶき");
      s = s.replace(/瓦葺き/g, "かわらぶき");
      s = s.replace(/葺き/g, "ふき");
      s = s.replace(/葺く/g, "ふく");
      s = s.replace(/瓦棒/g, "かわらぼう");
      s = s.replace(/折板屋根|折板/g, "せっぱん");
      s = s.replace(/立上り|立ち上がり/g, "たちあがり");
      s = s.replace(/入隅/g, "いりずみ");
      s = s.replace(/出隅/g, "でずみ");
      s = s.replace(/面木/g, "めんき");
      s = s.replace(/脱気筒/g, "だっきとう");
      s = s.replace(/目地/g, "めじ");
      s = s.replace(/深目地/g, "ふかめじ");
      s = s.replace(/眠り目地/g, "ねむりめじ");
      s = s.replace(/裏足/g, "うらあし");
      s = s.replace(/白華/g, "はっか");
      s = s.replace(/木鏝/g, "きごて");
      s = s.replace(/金鏝押え|金鏝/g, "かなごて");
      s = s.replace(/刷毛引き/g, "はけびき");
      s = s.replace(/塗厚/g, "ぬりあつ");
      s = s.replace(/下塗り/g, "したぬり");
      s = s.replace(/中塗り/g, "なかぬり");
      s = s.replace(/上塗り/g, "うわぬり");
      s = s.replace(/構造用合板/g, "こうぞうようごうはん");
      s = s.replace(/合板/g, "ごうはん");
      s = s.replace(/野縁受け/g, "のぶちうけ");
      s = s.replace(/野縁/g, "のぶち");
      s = s.replace(/建具/g, "たてぐ");
      s = s.replace(/丁番|蝶番/g, "ちょうばん");
      s = s.replace(/グレモン錠/g, "グレモンじょう");
      s = s.replace(/素地ごしらえ/g, "きじごしらえ");
      s = s.replace(/吹付け|吹き付け/g, "ふきつけ");
      s = s.replace(/踏み面|踏面/g, "ふみづら");
      s = s.replace(/蹴上げ|蹴上/g, "けあげ");
      s = s.replace(/踊り場|踊場/g, "おどりば");
      s = s.replace(/手すり|手摺/g, "てすり");
      s = s.replace(/勾配/g, "こうばい");
      s = s.replace(/撓み|たわみ/g, "たわみ");
      s = s.replace(/撓り/g, "しなり");
      s = s.replace(/反り/g, "そり");

      // 【安全・仮設・足場・施工管理法】
      s = s.replace(/朝顔/g, "あさがお");
      s = s.replace(/手すり先行足場/g, "てすりせんこうあしば");
      s = s.replace(/わく組足場|枠組足場/g, "わくぐみあしば");
      s = s.replace(/単管足場/g, "たんかんあしば");
      s = s.replace(/くさび緊結式足場/g, "くさびきんけつしきあしば");
      s = s.replace(/吊り足場/g, "つりあしば");
      s = s.replace(/移動式足場/g, "いどうしきあしば");
      s = s.replace(/建地/g, "たてじ");
      s = s.replace(/腕木/g, "うでき");
      s = s.replace(/壁つなぎ/g, "かべつなぎ");
      s = s.replace(/中さん/g, "なかさん");
      s = s.replace(/親綱/g, "おやづな");
      s = s.replace(/フルハーネス型/g, "フルハーネスがた");
      s = s.replace(/最早開始時刻/g, "さいそうかいしじこく");
      s = s.replace(/最遅開始時刻/g, "さいちかいしじこく");
      s = s.replace(/最早終了時刻/g, "さいそうしゅうりょうじこく");
      s = s.replace(/最遅終了時刻/g, "さいちしゅうりょうじこく");
      s = s.replace(/全フロート/g, "ぜんフロート");
      s = s.replace(/自由フロート/g, "じゆうフロート");
      s = s.replace(/山積み/g, "やまづみ");
      s = s.replace(/山崩し/g, "やまくずし");
      s = s.replace(/特性要因図/g, "とくせいよういんず");
      s = s.replace(/親和図法/g, "しんわずほう");
      s = s.replace(/連関図法/g, "れんかんずほう");
      s = s.replace(/系統図法/g, "けいとうずほう");

      // 【法規・資格・組織体制】
      s = s.replace(/特定元方事業者/g, "特定もとかた事業者");
      s = s.replace(/元方安全衛生管理者/g, "もとかた安全衛生管理者");
      s = s.replace(/店社安全衛生管理者/g, "てんしゃ安全衛生管理者");
      s = s.replace(/関係請負人/g, "かんけいうけおいにん");
      s = s.replace(/一括下請負/g, "いっかつしたうけおい");
      s = s.replace(/元請負人/g, "もとうけおいにん");
      s = s.replace(/下請負人/g, "したうけおいにん");
      s = s.replace(/特例監理技術者/g, "とくれい かんりぎじゅつしゃ");
      s = s.replace(/監理技術者補佐/g, "かんりぎじゅつしゃ ほさ");
      s = s.replace(/監理技術者/g, "かんりぎじゅつしゃ");
      s = s.replace(/主任技術者/g, "しゅにんぎじゅつしゃ");
      s = s.replace(/統括安全衛生責任者/g, "とうかつ あんぜんえいせい せきにんしゃ");
      s = s.replace(/適判/g, "てきはん");
      s = s.replace(/特定行政庁/g, "とくていぎょうせいちょう");
      s = s.replace(/建築主事/g, "けんちくしゅじ");
      s = s.replace(/検査済証/g, "けんさずみしょう");
      s = s.replace(/確認済証/g, "かくにんずみしょう");
      s = s.replace(/竪穴区画/g, "たてあなくかく");
      s = s.replace(/直通階段/g, "ちょくつうかいだん");
      s = s.replace(/特別避難階段/g, "とくべつひなんかいだん");
      s = s.replace(/建ぺい率|建蔽率/g, "けんぺいりつ");
      s = s.replace(/容積率/g, "ようせきりつ");
      s = s.replace(/日影規制/g, "ひかげきせい");
      s = s.replace(/36協定/g, "サブロク協定");
      s = s.replace(/安衛法/g, "あんえいほう");
      s = s.replace(/安衛則/g, "あんえいそく");
      s = s.replace(/労基法/g, "ろうきほう");
      s = s.replace(/建基法/g, "けんきほう");
      s = s.replace(/1級/g, "いっきゅう");
      s = s.replace(/2級/g, "にきゅう");
      s = s.replace(/技士補/g, "ぎしほ");

      // 【設問特有・正誤判定キーワード】
      s = s.replace(/最も不適当なもの/g, "もっとも ふてきとうなもの");
      s = s.replace(/最も適当なもの/g, "もっとも てきとうなもの");
      s = s.replace(/適当でないもの/g, "てきとうでないもの");
      s = s.replace(/不適当である理由/g, "ふてきとうである りゆう");
      s = s.replace(/該当しないもの/g, "がいとうしないもの");
      s = s.replace(/該当するもの/g, "がいとうするもの");
      s = s.replace(/不適当/g, "ふてきとう");
      s = s.replace(/該当しない/g, "がいとうしない");
      s = s.replace(/該当する/g, "がいとうする");
      s = s.replace(/誤っている/g, "あやまっている");
      s = s.replace(/誤り/g, "あやまり");
      s = s.replace(/正答/g, "せいとう");
      s = s.replace(/誤答/g, "ごとう");
      s = s.replace(/正解/g, "せいかい");
      s = s.replace(/不正解/g, "ふせいかい");
      s = s.replace(/適当/g, "てきとう");
      s = s.replace(/正誤/g, "せいご");
      s = s.replace(/肢([1-4])/g, "選択肢$1、");
      s = s.replace(/選択肢([1-4])/g, "せんたくし $1、");

      // 9. 自然な息継ぎ・ポーズの最適化
      s = s.replace(/[ \t]+/g, " ");
      s = s.replace(/、+/g, "、");
      s = s.replace(/。+/g, "。");
      s = s.replace(/、。/g, "。");

      return s.trim();
    };

    // 設問タイプ判定ヘルパー: 'futekitou'（最も不適当） | 'hanyou_nai'（該当しない） | 'tekitou'（最も適当）
    const getQuestionType = (q) => {
      if (!q) return 'futekitou';
      if (q.questionType) return q.questionType;
      const text = q.question || '';
      if (text.includes('適当でない') || text.includes('不適当')) return 'futekitou';
      if (text.includes('該当しない') || text.includes('属さない')) return 'hanyou_nai';
      if (text.includes('適当なもの') || text.includes('正しいもの') || text.includes('該当するもの')) return 'tekitou';
      return 'futekitou';
    };

    // 正解・解説・フィードバック音声テキスト生成
    // userSelectedIdx が指定された場合、ユーザーの合否を反映し、誤答を絶対に「正解」と呼ばない
    const getAnswerSpeechText = (q, userSelectedIdx = null) => {
      if (!q) return '';
      const qType = getQuestionType(q);
      const num = (q.correctIndex !== undefined ? q.correctIndex + 1 : 1);
      const chosenOpt = (q.options && q.options[q.correctIndex]) ? q.options[q.correctIndex] : '';

      let prefix = '';
      if (userSelectedIdx !== null && userSelectedIdx !== undefined) {
        if (userSelectedIdx === q.correctIndex) {
          prefix = 'お見事、正解です！';
        } else {
          const userNum = userSelectedIdx + 1;
          prefix = `残念、不正解です。あなたが選んだ選択肢${userNum}番は誤答です。`;
        }
      }

      let mainStatement = '';
      if (qType === 'futekitou') {
        mainStatement = `${prefix}設問の正答は、選択肢${num}番です。「${chosenOpt}」という記述が【不適当】です。なぜ不適当なのか、その理由を解説します。`;
      } else if (qType === 'hanyou_nai') {
        mainStatement = `${prefix}設問の正答は、選択肢${num}番です。「${chosenOpt}」という項目が【該当しません】。なぜ該当しないのか、その理由を解説します。`;
      } else {
        mainStatement = `${prefix}設問の正答は、選択肢${num}番です。「${chosenOpt}」という記述が【適当】です。`;
      }

      const expText = q.explanation ? `${q.explanation}。` : '';
      const trapText = q.trapNote ? `出題者の引っ掛け罠。${q.trapNote}。` : '';
      const fieldText = q.fieldReality ? `現場工事長の知見。${q.fieldReality}。` : '';

      return `${mainStatement}${expText}${trapText}${fieldText}`;
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

    // モバイル用音声＆Web Audio API アンロック
    let sharedAudioCtx = null;
    let isAudioUnlocked = false;

    // 音声ステータス・トースト通知（ユーザーが音が出ない原因を一目で把握可能に）
    const speechToastMessage = ref('');
    const speechToastType = ref('info'); // 'info' | 'success' | 'warn' | 'error'
    let speechToastTimer = null;
    const showSpeechToast = (msg, type = 'info', duration = 4000) => {
      speechToastMessage.value = msg;
      speechToastType.value = type;
      if (speechToastTimer) clearTimeout(speechToastTimer);
      speechToastTimer = setTimeout(() => {
        speechToastMessage.value = '';
      }, duration);
    };

    // ユーザー操作時に即時Web Audio APIで確認音を鳴らし、iOS/Android/Chromeの全オーディオ制限を解放
    const playChimeAndUnlock = () => {
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
            sharedAudioCtx = new AudioCtx();
          }
          if (sharedAudioCtx.state === 'suspended') {
            sharedAudioCtx.resume();
          }
          // 上品な「ポーン♪」という確認チャイム音（587Hz -> 880Hz）
          const osc = sharedAudioCtx.createOscillator();
          const gain = sharedAudioCtx.createGain();
          osc.type = 'sine';
          const now = sharedAudioCtx.currentTime;
          osc.frequency.setValueAtTime(587.33, now); // D5
          osc.frequency.exponentialRampToValueAtTime(880.0, now + 0.12); // A5
          gain.gain.setValueAtTime(0.12, now);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
          osc.connect(gain);
          gain.connect(sharedAudioCtx.destination);
          osc.start(now);
          osc.stop(now + 0.35);
        }
      } catch (e) {
        console.warn('[AudioContext] playChime notice:', e);
      }

      if (window.speechSynthesis) {
        try {
          if (window.speechSynthesis.paused) {
            window.speechSynthesis.resume();
          }
        } catch (e) {}
      }
      isAudioUnlocked = true;
    };

    // 画面タップ時にアンロックを仕込む
    if (typeof window !== 'undefined') {
      window.addEventListener('touchstart', playChimeAndUnlock, { once: true, passive: true });
      window.addEventListener('click', playChimeAndUnlock, { once: true, passive: true });
    }

    const getJapaneseVoice = () => {
      if (!window.speechSynthesis) return null;
      const list = availableVoices.value.length > 0 ? availableVoices.value : window.speechSynthesis.getVoices();
      if (!list || list.length === 0) return null;
      const jaVoices = list.filter(v => v.lang === 'ja-JP' || v.lang === 'ja_JP' || v.lang.startsWith('ja'));
      if (jaVoices.length === 0) return null;

      // プレミアム自然音声優先（Google 日本語、Otoya、Kyoko、Siri、Nanami、Ayumi、Haruka、Natural等）
      const premiumVoice = jaVoices.find(v => 
        /Google.*(日本語|ja)|Otoya|Kyoko|Siri|Nanami|Ayumi|Haruka|Natural/i.test(v.name)
      );
      if (premiumVoice) return premiumVoice;

      // ローカル音声優先
      const localJa = jaVoices.find(v => v.localService);
      if (localJa) return localJa;

      return jaVoices[0];
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

    // 読み上げ中のカードIDと現在フェーズ・選択肢インデックス（画面のリアルタイム可視化＆自動スクロール追従連動）
    const activeSpeechCardId = ref(null);
    const activeSpeechPhase = ref(''); // 'question' | 'option' | 'thinking' | 'answer' | 'explanation' | 'trap' | 'field' | 'glossary'
    const activeSpeechOptionIndex = ref(null); // 0 | 1 | 2 | 3

    // 読み上げ位置へのスムーズ自動スクロール追従関数
    const scrollToSpeechTarget = (targetId, block = 'nearest') => {
      nextTick(() => {
        try {
          const el = typeof targetId === 'string' ? document.getElementById(targetId) : targetId;
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: block, inline: 'nearest' });
          }
        } catch (e) {
          console.warn('[Speech Scroll] error:', e);
        }
      });
    };

    let currentSpeechSessionId = 0;
    let activeUtterance = null;

    const stopSpeech = () => {
      currentSpeechSessionId++; // 実行中のチャンク再生キューを即座に破棄
      if (window.speechSynthesis) {
        try {
          window.speechSynthesis.cancel();
        } catch (e) {}
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
      activeUtterance = null;
      window.__cbtUtterance = null;
      activeSpeechCardId.value = null;
      activeSpeechPhase.value = '';
      activeSpeechOptionIndex.value = null;
      releaseWakeLock();
    };

    // 音声テスト＆強制アンロック関数
    const testSpeech = () => {
      playChimeAndUnlock();
      showSpeechToast('🔊 音声テスト開始：チャイム音（ポーン♪）に続いて読み上げが始まります。※無音の場合はマナーモードや端末音量をご確認ください', 'info', 5000);
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

    // PC Chrome / Edge / Safari / iOS / Android 全環境対応：センテンス・チャンキング発話エンジン
    // Android Chromeの15〜20秒音声タイムアウト（フェードアウト・サイレント切断バグ）を完全に防止
    // 日本語テキストを自然な文節・句読点（40〜50文字以内）で安全なチャンクに分割
    function splitTextIntoSpeechChunks(text) {
      if (!text) return [];
      // 1. 改行、句点、疑問符、感嘆符で分割
      const rawSegments = text.split(/([\n\r]+|[。！？\?!]+)/);
      const tempChunks = [];
      let current = '';

      for (let i = 0; i < rawSegments.length; i++) {
        const seg = rawSegments[i];
        if (!seg) continue;
        if (/^[\n\r。！？\?!]+$/.test(seg)) {
          current += seg;
          if (current.trim()) {
            tempChunks.push(current.trim());
          }
          current = '';
        } else {
          current += seg;
          if (current.length >= 50) {
            tempChunks.push(current.trim());
            current = '';
          }
        }
      }
      if (current.trim()) {
        tempChunks.push(current.trim());
      }

      // 2. 50文字を超える長文は、読点（、）等でさらに小分けに細分化
      const finalChunks = [];
      for (const chunk of tempChunks) {
        if (chunk.length <= 50) {
          finalChunks.push(chunk);
        } else {
          const subParts = chunk.split(/(、|,\s*)/);
          let subCurrent = '';
          for (const part of subParts) {
            if (part === '、' || /^,\s*$/.test(part)) {
              subCurrent += part;
              if (subCurrent.length >= 25) {
                finalChunks.push(subCurrent.trim());
                subCurrent = '';
              }
            } else {
              if (subCurrent.length + part.length > 50 && subCurrent.length > 0) {
                finalChunks.push(subCurrent.trim());
                subCurrent = part;
              } else {
                subCurrent += part;
              }
            }
          }
          if (subCurrent.trim()) {
            if (subCurrent.length > 50) {
              for (let i = 0; i < subCurrent.length; i += 45) {
                finalChunks.push(subCurrent.slice(i, i + 45));
              }
            } else {
              finalChunks.push(subCurrent.trim());
            }
          }
        }
      }
      return finalChunks.filter(c => c && c.trim().length > 0);
    }

    const speakText = (text, onEndCallback = null) => {
      if (!isSpeechSupported.value || !window.speechSynthesis) {
        showSpeechToast('⚠️ お使いのブラウザは音声合成に対応していません', 'warn');
        if (onEndCallback) onEndCallback();
        return;
      }

      // 新規セッションIDを発行（直前の未完了キューを即座に破棄・無効化）
      const sessionId = ++currentSpeechSessionId;

      // Chromeのpauseフリーズ解除 & 以前の発話をスタッククリア
      try {
        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        }
        if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
          window.speechSynthesis.cancel();
        }
      } catch (e) {}

      // 正しい日本語発音テキストに正規化変換
      const spokenText = normalizeSpeechText(text);
      if (!spokenText.trim()) {
        if (onEndCallback) onEndCallback();
        return;
      }

      // Android 15〜20秒ウォッチドッグ制限回避：小チャンク（2〜5秒）に分割して連鎖再生
      const chunks = splitTextIntoSpeechChunks(spokenText);
      if (chunks.length === 0) {
        if (onEndCallback) onEndCallback();
        return;
      }

      let chunkIndex = 0;
      let hasEnded = false;

      const finishExecution = () => {
        if (hasEnded) return;
        hasEnded = true;
        if (sessionId !== currentSpeechSessionId) return;
        isSpeaking.value = false;
        activeUtterance = null;
        window.__cbtUtterance = null;
        if (onEndCallback) onEndCallback();
      };

      const playNextChunk = () => {
        // 別発話やstopSpeechによりセッションが無効化されている場合は中断
        if (sessionId !== currentSpeechSessionId) return;

        if (chunkIndex >= chunks.length) {
          finishExecution();
          return;
        }

        const chunkText = chunks[chunkIndex];
        chunkIndex++;

        const utterance = new SpeechSynthesisUtterance(chunkText);
        utterance.lang = 'ja-JP';
        utterance.rate = Number(speechRate.value) || 1.0;
        utterance.pitch = 1.0;

        const jVoice = getJapaneseVoice();
        if (jVoice) {
          try {
            utterance.voice = jVoice;
          } catch (e) {}
        }

        utterance.onstart = () => {
          if (sessionId === currentSpeechSessionId) {
            isSpeaking.value = true;
          }
        };

        utterance.onend = () => {
          if (sessionId === currentSpeechSessionId) {
            playNextChunk();
          }
        };

        utterance.onerror = (e) => {
          console.warn('[Speech] Utterance event:', e ? e.error : 'unknown');
          if (sessionId !== currentSpeechSessionId) return;
          if (e && (e.error === 'canceled' || e.error === 'interrupted')) {
            finishExecution();
            return;
          }
          if (e && e.error && e.error === 'not-allowed') {
            showSpeechToast('⚠️ ブラウザの自動再生制限：画面をタップして音声を許可してください', 'warn');
            finishExecution();
            return;
          }
          // その他の軽微なエラーは次チャンクへ継続
          playNextChunk();
        };

        // ガベージコレクション（GC）による発話中断バグ防止
        activeUtterance = utterance;
        window.__cbtUtterance = utterance;

        try {
          window.speechSynthesis.speak(utterance);
        } catch (e) {
          console.error('[Speech] speak error:', e);
          playNextChunk();
        }
      };

      // 最初のチャンクを再生開始
      playNextChunk();
    };

    // 現在の単語を読み上げる（手動ボタン：ハイライト追従連動）
    const speakCurrentWord = () => {
      if (isSpeaking.value && !isAutoPlay.value) {
        stopSpeech();
        return;
      }
      const w = currentWord.value;
      if (!w || !w.question) return;

      activeSpeechCardId.value = w.id;
      if (!hasAnsweredWord.value) {
        // 問題文読み上げ & ハイライト追従
        activeSpeechPhase.value = 'question';
        activeSpeechOptionIndex.value = null;
        scrollToSpeechTarget('word-card', 'center');
        scrollToSpeechTarget('word-q-box', 'nearest');

        const choices = currentWordChoices.value;
        const qText = `問題。${w.category}、${w.topic}。${w.question}。`;
        speakText(qText, () => {
          if (activeSpeechCardId.value !== w.id) return;
          const narrateOpts = (idx) => {
            if (activeSpeechCardId.value !== w.id) return;
            if (idx >= choices.length) {
              activeSpeechPhase.value = '';
              activeSpeechOptionIndex.value = null;
              activeSpeechCardId.value = null;
              return;
            }
            activeSpeechPhase.value = 'option';
            activeSpeechOptionIndex.value = idx;
            scrollToSpeechTarget(`word-opt-${idx}`, 'nearest');
            speakText(`選択肢${idx + 1}、${choices[idx]}。`, () => {
              narrateOpts(idx + 1);
            });
          };
          narrateOpts(0);
        });
      } else {
        const isCorrect = selectedWordChoice.value === w.answer;
        const resultPrefix = isCorrect 
          ? 'お見事、正解です！' 
          : `残念、不正解です。あなたの回答「${selectedWordChoice.value || '未選択'}」は誤りです。`;
        const cIdx = currentWordChoices.value.indexOf(w.answer);
        activeSpeechPhase.value = 'answer';
        activeSpeechOptionIndex.value = cIdx >= 0 ? cIdx : null;
        if (cIdx >= 0) scrollToSpeechTarget(`word-opt-${cIdx}`, 'nearest');

        const ansText = `${resultPrefix}正解の基準値は、${w.answer}です。`;
        speakText(ansText, () => {
          if (activeSpeechCardId.value !== w.id) return;
          activeSpeechOptionIndex.value = null;
          if (w.termGlossary || w.hint) {
            showWordGlossary.value = true;
            activeSpeechPhase.value = 'explanation';
            scrollToSpeechTarget('word-glossary-box', 'nearest');
            const glossaryText = w.termGlossary ? `現場用語解説。${w.term || w.topic}。${w.termGlossary}。` : '';
            const hintText = w.hint ? `ポイント。${w.hint}。` : '';
            speakText(`${glossaryText}${hintText}`, () => {
              activeSpeechCardId.value = null;
              activeSpeechPhase.value = '';
            });
          } else {
            activeSpeechCardId.value = null;
            activeSpeechPhase.value = '';
          }
        });
      }
    };

    // 項目を指定して読み上げる（振り返り一覧用：ハイライト追従連動）
    const speakItem = (w) => {
      if (isSpeaking.value && !isReviewAutoPlay.value) {
        stopSpeech();
        return;
      }
      activeSpeechCardId.value = w.id;
      scrollToSpeechTarget(`word-review-item-${w.id}`, 'center');
      const glossaryText = w.termGlossary ? `現場用語解説。${w.term || w.topic}。${w.termGlossary}。` : '';
      const hintText = w.hint ? `ポイント。${w.hint}。` : '';
      const speechContent = `${w.category}。${w.term || w.topic}。問題。${w.question}。正解は、${w.answer}です。${glossaryText}${hintText}`;
      speakText(speechContent, () => {
        if (activeSpeechCardId.value === w.id) {
          activeSpeechCardId.value = null;
        }
      });
    };

    // 🚗 車両通勤・ハンズフリー自動連続耳学モード（ハイライト追従連動）
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
        activeSpeechCardId.value = null;
        activeSpeechPhase.value = '';
        activeSpeechOptionIndex.value = null;
        return;
      }

      const w = currentWord.value;
      if (!w || !w.question) return;

      activeSpeechCardId.value = w.id;
      activeSpeechOptionIndex.value = null;
      scrollToSpeechTarget('word-card', 'center');

      // 1. 問題を読み上げる & ハイライト追従
      activeSpeechPhase.value = 'question';
      scrollToSpeechTarget('word-q-box', 'nearest');
      const qText = `第${currentWordIndex.value + 1}問。${w.category}。${w.topic}。問題。${w.question}。`;
      speakText(qText, () => {
        if (!isAutoPlay.value) return;

        // 2. シンキングタイム（2.2秒の間）
        activeSpeechPhase.value = 'thinking';
        autoPlayTimer = setTimeout(() => {
          if (!isAutoPlay.value) return;

          // 画面上も回答状態にして正解を表示
          hasAnsweredWord.value = true;
          selectedWordChoice.value = w.answer;

          const cIdx = currentWordChoices.value.indexOf(w.answer);
          activeSpeechPhase.value = 'answer';
          activeSpeechOptionIndex.value = cIdx >= 0 ? cIdx : null;
          if (cIdx >= 0) {
            scrollToSpeechTarget(`word-opt-${cIdx}`, 'nearest');
          }

          // 3. 正解と用語解説・急所を読み上げる
          const aText = `正解は、${w.answer}です。`;
          speakText(aText, () => {
            if (!isAutoPlay.value) return;
            activeSpeechOptionIndex.value = null;

            if (w.termGlossary || w.hint) {
              showWordGlossary.value = true;
              activeSpeechPhase.value = 'explanation';
              scrollToSpeechTarget('word-glossary-box', 'nearest');
              const glossaryText = w.termGlossary ? `現場用語解説。${w.term || w.topic}。${w.termGlossary}。` : '';
              const hintText = w.hint ? `ポイント。${w.hint}。` : '';

              speakText(`${glossaryText}${hintText}`, () => {
                if (!isAutoPlay.value) return;
                finishWordStep();
              });
            } else {
              finishWordStep();
            }
          });
        }, 2200);
      });
    };

    const finishWordStep = () => {
      activeSpeechPhase.value = '';
      activeSpeechOptionIndex.value = null;
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
          activeSpeechCardId.value = null;
          const sectorLabel = wordFilterCategory.value === 'すべて' ? '全工種' : wordFilterCategory.value;
          const finishMsg = `${sectorLabel}セクタの暗記演習が完了しました。続けて、セクタの振り返り耳学解説を開始します。`;
          
          speakText(finishMsg, () => {
            setTimeout(() => {
              toggleReviewAutoPlay();
            }, 1200);
          });
        }
      }, 1800);
    };

    // 🚗 振り返り画面での「連続耳学モード（音声解説リスニング & ハイライト追従）」
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
        activeSpeechCardId.value = null;
        speakText('セクタの振り返り耳学がすべて完了しました。大変お疲れ様でした。');
        return;
      }

      const item = list[currentReviewSpeechIndex.value];
      const w = item.word;
      activeSpeechCardId.value = w.id;
      scrollToSpeechTarget(`word-review-item-${w.id}`, 'center');

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
            activeSpeechCardId.value = null;
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

    // 🎙️ 実戦テスト問題の同期ステップ読み上げ（問題 → 各肢 → シンキング → 正解 → 解説 → 罠 → 現場知見）
    const narrateExamQuestion = (q, onEnd) => {
      if (!q || !q.question) {
        if (onEnd) onEnd();
        return;
      }
      activeSpeechCardId.value = q.id;
      activeSpeechOptionIndex.value = null;
      scrollToSpeechTarget('exam-card', 'center');

      const qNum = currentExamIndex.value + 1;
      const cat = q.chapterName || q.category || '';
      const opts = q.options || [];

      // Step 1: 問題文の読み上げ & ハイライト追従
      activeSpeechPhase.value = 'question';
      scrollToSpeechTarget('exam-q-box', 'nearest');
      const qSpeech = `第${qNum}問。${cat}。問題。${q.question}。`;

      speakText(qSpeech, () => {
        if (activeSpeechCardId.value !== q.id) return;

        // Step 2: 選択肢を1肢ずつ順番に読み上げ ＆ 各肢をハイライト追従
        const narrateOpts = (idx) => {
          if (activeSpeechCardId.value !== q.id) return;
          if (idx >= opts.length) {
            activeSpeechOptionIndex.value = null;
            proceedToAnswer();
            return;
          }
          activeSpeechPhase.value = 'option';
          activeSpeechOptionIndex.value = idx;
          scrollToSpeechTarget(`exam-opt-${idx}`, 'nearest');
          const optSpeech = `選択肢${idx + 1}番、${opts[idx]}。`;
          speakText(optSpeech, () => {
            narrateOpts(idx + 1);
          });
        };

        const proceedToAnswer = () => {
          if (activeSpeechCardId.value !== q.id) return;
          // Step 3: シンキングタイム (2.2秒)
          activeSpeechPhase.value = 'thinking';
          examAutoTimer = setTimeout(() => {
            if (activeSpeechCardId.value !== q.id) return;

            // 画面上の回答を正解選択肢にセットして視覚的に反映
            examUserAnswers.value[currentExamIndex.value] = q.correctIndex;

            // Step 4: 正解発表 & 正解肢ハイライト追従
            activeSpeechPhase.value = 'answer';
            activeSpeechOptionIndex.value = q.correctIndex;
            scrollToSpeechTarget(`exam-opt-${q.correctIndex}`, 'nearest');

            const answerSpeech = getAnswerSpeechText(q);

            speakText(answerSpeech, () => {
              if (activeSpeechCardId.value !== q.id) return;
              activeSpeechOptionIndex.value = null;

              // 濃縮20分版の場合は解説・罠・現場知見もハイライト追従して順次読み上げ
              if (selectedExamMode.value === 'intensive20') {
                activeSpeechPhase.value = 'explanation';
                scrollToSpeechTarget('exam-exp-card', 'nearest');
                const expSpeech = q.explanation ? `解説。${q.explanation}。` : '';

                speakText(expSpeech, () => {
                  if (activeSpeechCardId.value !== q.id) return;

                  activeSpeechPhase.value = 'trap';
                  scrollToSpeechTarget('exam-trap-card', 'nearest');
                  const trapSpeech = q.trapNote ? `引っ掛け罠。${q.trapNote}。` : '';

                  speakText(trapSpeech, () => {
                    if (activeSpeechCardId.value !== q.id) return;

                    activeSpeechPhase.value = 'field';
                    scrollToSpeechTarget('exam-field-card', 'nearest');
                    const fieldSpeech = q.fieldReality ? `現場知見。${q.fieldReality}。` : '';

                    speakText(fieldSpeech, () => {
                      if (activeSpeechCardId.value === q.id) {
                        activeSpeechPhase.value = '';
                        activeSpeechOptionIndex.value = null;
                      }
                      if (onEnd) onEnd();
                    });
                  });
                });
              } else {
                activeSpeechPhase.value = '';
                activeSpeechOptionIndex.value = null;
                if (onEnd) onEnd();
              }
            });
          }, 2200);
        };

        narrateOpts(0);
      });
    };

    const playExamAutoCycle = () => {
      if (!isExamAutoPlay.value || !isExamStarted.value || isExamFinished.value) {
        isExamAutoPlay.value = false;
        activeSpeechCardId.value = null;
        activeSpeechPhase.value = '';
        activeSpeechOptionIndex.value = null;
        return;
      }

      const q = currentExamQuestion.value;
      if (!q || !q.question) return;

      narrateExamQuestion(q, () => {
        if (!isExamAutoPlay.value) return;

        // 次の問題へ遷移
        examAutoTimer = setTimeout(() => {
          if (!isExamAutoPlay.value) return;

          if (currentExamIndex.value < examQuestions.value.length - 1) {
            nextExamQuestion();
            playExamAutoCycle();
          } else {
            // テスト全問終了
            isExamAutoPlay.value = false;
            activeSpeechCardId.value = null;
            activeSpeechPhase.value = '';
            activeSpeechOptionIndex.value = null;
            speakText('実戦テストの全問聞き流しが完了しました。採点結果画面へ移行します。', () => {
              finishExam();
            });
          }
        }, 1800);
      });
    };

    // 🔊 現在の実戦テスト問題を単体で読み上げる（ハイライト追従連動）
    const speakCurrentExamQuestion = () => {
      const q = currentExamQuestion.value;
      if (!q || !q.question) return;
      if (isSpeaking.value && activeSpeechCardId.value === q.id && !isExamAutoPlay.value) {
        stopSpeech();
        return;
      }
      stopSpeech();
      playChimeAndUnlock();
      narrateExamQuestion(q, () => {
        activeSpeechCardId.value = null;
        activeSpeechPhase.value = '';
        activeSpeechOptionIndex.value = null;
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
        activeSpeechCardId.value = null;
        speakText('復習対象の問題の聞き流しがすべて完了しました。大変お疲れ様でした。');
        return;
      }

      const item = list[currentExamReviewSpeechIndex.value];
      const q = item.q;
      activeSpeechCardId.value = q.id;
      scrollToSpeechTarget(`exam-review-item-${q.id}`, 'center');

      const num = currentExamReviewSpeechIndex.value + 1;
      const cat = q.chapterName || q.category || '施工';
      const statusText = item.isCorrect ? '正解した問題です。' : '見直しが必要な問題です。あなたの回答は誤りでした。';
      const ansDetail = getAnswerSpeechText(q, item.userAnswer);
      const reviewSpeech = `復習第${num}問。${cat}。${statusText}問題。${q.question}。${ansDetail}`;

      speakText(reviewSpeech, () => {
        if (!isExamReviewAutoPlay.value) return;

        examReviewAutoTimer = setTimeout(() => {
          if (!isExamReviewAutoPlay.value) return;
          currentExamReviewSpeechIndex.value++;
          if (currentExamReviewSpeechIndex.value < list.length) {
            playExamReviewAutoCycle();
          } else {
            isExamReviewAutoPlay.value = false;
            activeSpeechCardId.value = null;
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

    // 🎙️ 工種別ドリル1問の同期ステップ読み上げ（問題 → 各肢 → シンキング → 正解 → 解説 → 罠 → 現場知見）
    const narrateQuizQuestion = (q, onEnd) => {
      if (!q || !q.question) {
        if (onEnd) onEnd();
        return;
      }
      activeSpeechCardId.value = q.id;
      activeSpeechOptionIndex.value = null;
      scrollToSpeechTarget('quiz-card', 'center');

      const qNum = currentQuizIndex.value + 1;
      const cat = q.chapterName || q.category || '';
      const opts = q.options || [];

      // タイマーを一旦停止
      clearInterval(quizTimerInterval);
      isTimerRunning.value = false;

      // Step 1: 問題文の読み上げ & ハイライト追従
      activeSpeechPhase.value = 'question';
      scrollToSpeechTarget('quiz-q-box', 'nearest');
      const qSpeech = `ドリル第${qNum}問。${cat}。問題。${q.question}。`;

      speakText(qSpeech, () => {
        if (activeSpeechCardId.value !== q.id) return;

        // Step 2: 選択肢を1肢ずつ順番に読み上げ ＆ 各肢をハイライト追従
        const narrateOpts = (idx) => {
          if (activeSpeechCardId.value !== q.id) return;
          if (idx >= opts.length) {
            activeSpeechOptionIndex.value = null;
            proceedToAnswer();
            return;
          }
          activeSpeechPhase.value = 'option';
          activeSpeechOptionIndex.value = idx;
          scrollToSpeechTarget(`quiz-opt-${idx}`, 'nearest');
          const optSpeech = `選択肢${idx + 1}番、${opts[idx]}。`;
          speakText(optSpeech, () => {
            narrateOpts(idx + 1);
          });
        };

        const proceedToAnswer = () => {
          if (activeSpeechCardId.value !== q.id) return;
          // Step 3: シンキングタイム (2.0秒)
          activeSpeechPhase.value = 'thinking';
          quizAutoTimer = setTimeout(() => {
            if (activeSpeechCardId.value !== q.id) return;

            // 画面上も回答状態にして正解を表示
            handleSelectOption(q.correctIndex);

            // Step 4: 正解発表 & 正解肢ハイライト追従
            activeSpeechPhase.value = 'answer';
            activeSpeechOptionIndex.value = q.correctIndex;
            scrollToSpeechTarget(`quiz-opt-${q.correctIndex}`, 'nearest');

            const answerSpeech = getAnswerSpeechText(q);

            speakText(answerSpeech, () => {
              if (activeSpeechCardId.value !== q.id) return;
              activeSpeechOptionIndex.value = null;

              // Step 5: 解説の読み上げ & ハイライト追従
              activeSpeechPhase.value = 'explanation';
              scrollToSpeechTarget('quiz-exp-card', 'nearest');
              const expSpeech = q.explanation ? `解説。${q.explanation}。` : '';

              speakText(expSpeech, () => {
                if (activeSpeechCardId.value !== q.id) return;

                // Step 6: 引っ掛け罠
                activeSpeechPhase.value = 'trap';
                scrollToSpeechTarget('quiz-trap-card', 'nearest');
                const trapSpeech = q.trapNote ? `引っ掛け罠。${q.trapNote}。` : '';

                speakText(trapSpeech, () => {
                  if (activeSpeechCardId.value !== q.id) return;

                  // Step 7: 現場知見
                  activeSpeechPhase.value = 'field';
                  scrollToSpeechTarget('quiz-field-card', 'nearest');
                  const fieldSpeech = q.fieldReality ? `現場知見。${q.fieldReality}。` : '';

                  speakText(fieldSpeech, () => {
                    if (activeSpeechCardId.value === q.id) {
                      activeSpeechPhase.value = '';
                      activeSpeechOptionIndex.value = null;
                    }
                    if (onEnd) onEnd();
                  });
                });
              });
            });
          }, 2000);
        };

        narrateOpts(0);
      });
    };

    const playQuizAutoCycle = () => {
      if (!isQuizAutoPlay.value || activeQuizQuestions.value.length === 0) {
        isQuizAutoPlay.value = false;
        activeSpeechCardId.value = null;
        activeSpeechPhase.value = '';
        activeSpeechOptionIndex.value = null;
        return;
      }

      const q = currentQuestion.value;
      if (!q || !q.question) return;

      narrateQuizQuestion(q, () => {
        if (!isQuizAutoPlay.value) return;

        quizAutoTimer = setTimeout(() => {
          if (!isQuizAutoPlay.value) return;

          if (currentQuizIndex.value < activeQuizQuestions.value.length - 1) {
            nextQuestion();
            playQuizAutoCycle();
          } else {
            isQuizAutoPlay.value = false;
            activeSpeechCardId.value = null;
            activeSpeechPhase.value = '';
            activeSpeechOptionIndex.value = null;
            speakText('選択した工種ドリルの聞き流しがすべて終了しました。大変お疲れ様でした。');
          }
        }, 1800);
      });
    };

    // 🔊 現在のドリル問題を単体で読み上げる（ハイライト追従連動）
    const speakCurrentQuizQuestion = () => {
      const q = currentQuestion.value;
      if (!q || !q.question) return;
      if (isSpeaking.value && activeSpeechCardId.value === q.id && !isQuizAutoPlay.value) {
        stopSpeech();
        return;
      }
      stopSpeech();
      playChimeAndUnlock();
      narrateQuizQuestion(q, () => {
        activeSpeechCardId.value = null;
        activeSpeechPhase.value = '';
        activeSpeechOptionIndex.value = null;
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
          showSpeechToast('⚠️ 対象のチートシート項目がありません', 'warn');
          speakText('対象のチートシート項目がありません。');
          return;
        }
        playChimeAndUnlock();
        showSpeechToast(`🚨 チートシート連続聞き流し開始（全${list.length}項目）`, 'info', 4000);
        isCheatAutoPlay.value = true;
        currentCheatSpeechIndex.value = 0;
        acquireWakeLock().catch(() => {});
        playCheatAutoCycle();
      }
    };

    // 🎙️ チートシート1問の同期ステップ読み上げ（問題 → 各肢 → 正解肢 → 解説 → 罠 → 現場知見 & ハイライト追従）
    const narrateCheatQuestion = (q, onEnd) => {
      if (!q) {
        if (onEnd) onEnd();
        return;
      }
      activeSpeechCardId.value = q.id;
      activeSpeechOptionIndex.value = null;
      scrollToSpeechTarget(`cheat-card-${q.id}`, 'center');

      const num = (filteredCheatSheetQuestions.value.findIndex(item => item.id === q.id) + 1) || (currentCheatSpeechIndex.value + 1) || 1;
      const cat = q.chapterName || q.category || '施工';
      const opts = q.options || [];
      const correctOptText = (opts && opts[q.correctIndex]) ? opts[q.correctIndex] : '';

      // Step 1: 問題文の読み上げ & ハイライト追従
      activeSpeechPhase.value = 'question';
      scrollToSpeechTarget(`cheat-q-${q.id}`, 'nearest');
      const qSpeech = `第${num}問。${cat}。問題。${q.question}。`;

      speakText(qSpeech, () => {
        if (activeSpeechCardId.value !== q.id) return;

        // Step 2: 選択肢を1肢ずつ順番に読み上げ ＆ 各肢をハイライト追従
        const narrateOpts = (idx) => {
          if (activeSpeechCardId.value !== q.id) return;
          if (idx >= opts.length) {
            activeSpeechOptionIndex.value = null;
            proceedToAnswer();
            return;
          }
          activeSpeechPhase.value = 'option';
          activeSpeechOptionIndex.value = idx;
          scrollToSpeechTarget(`cheat-opt-${q.id}-${idx}`, 'nearest');
          const prefix = idx === 0 ? '選択肢です。' : '';
          const optSpeech = `${prefix}肢${idx + 1}番、${opts[idx]}。`;
          speakText(optSpeech, () => {
            narrateOpts(idx + 1);
          });
        };

        const proceedToAnswer = () => {
          if (activeSpeechCardId.value !== q.id) return;
          // Step 3: 設問タイプに応じた正解肢の指摘 & 正解肢ハイライト追従
          activeSpeechPhase.value = 'answer';
          activeSpeechOptionIndex.value = q.correctIndex;
          scrollToSpeechTarget(`cheat-opt-${q.id}-${q.correctIndex}`, 'nearest');

          const qType = getQuestionType(q);
          let ansSpeech = '';
          if (qType === 'futekitou') {
            ansSpeech = `最も不適当な正解肢は、${q.correctIndex + 1}番です。「${correctOptText}」という記述が不適当です。`;
          } else if (qType === 'hanyou_nai') {
            ansSpeech = `該当しない正解肢は、${q.correctIndex + 1}番です。「${correctOptText}」という項目が該当しません。`;
          } else {
            ansSpeech = `最も適当な正解肢は、${q.correctIndex + 1}番です。「${correctOptText}」という記述が適当です。`;
          }

          speakText(ansSpeech, () => {
            if (activeSpeechCardId.value !== q.id) return;
            activeSpeechOptionIndex.value = null;

            // Step 4: 理由と根拠の解説 & ハイライト追従
            activeSpeechPhase.value = 'explanation';
            scrollToSpeechTarget(`cheat-exp-${q.id}`, 'nearest');
            const expLabel = qType === 'futekitou' 
              ? '不適当である理由の解説。' 
              : qType === 'hanyou_nai' 
                ? '該当しない理由の解説。' 
                : '適当である理由と他肢の不適当理由。';
            const expSpeech = q.explanation ? `${expLabel}${q.explanation}。` : '';

            speakText(expSpeech, () => {
              if (activeSpeechCardId.value !== q.id) return;

              // Step 5: 出題者の引っ掛け罠 & ハイライト追従
              activeSpeechPhase.value = 'trap';
              scrollToSpeechTarget(`cheat-trap-${q.id}`, 'nearest');
              const trapSpeech = q.trapNote ? `出題者の引っ掛け罠。${q.trapNote}。` : '';

              speakText(trapSpeech, () => {
                if (activeSpeechCardId.value !== q.id) return;

                // Step 6: 現場工事長の知見 & ハイライト追従
                activeSpeechPhase.value = 'field';
                scrollToSpeechTarget(`cheat-field-${q.id}`, 'nearest');
                const fieldSpeech = q.fieldReality ? `現場工事長の知見。${q.fieldReality}。` : '';

                speakText(fieldSpeech, () => {
                  if (activeSpeechCardId.value === q.id) {
                    activeSpeechPhase.value = '';
                    activeSpeechOptionIndex.value = null;
                  }
                  if (onEnd) onEnd();
                });
              });
            });
          });
        };

        narrateOpts(0);
      });
    };

    // 🔊 チートシート個別項目の音声解説読み上げ（ハイライト追従連動）
    const speakCheatItem = (q) => {
      if (!q) return;
      if (isSpeaking.value && activeSpeechCardId.value === q.id) {
        stopSpeech();
        return;
      }
      stopSpeech();
      playChimeAndUnlock();
      showSpeechToast('🔊 問題・選択肢・罠知見をハイライト追従で読み上げ中...', 'info', 3000);
      narrateCheatQuestion(q, () => {
        activeSpeechCardId.value = null;
        activeSpeechPhase.value = '';
        activeSpeechOptionIndex.value = null;
      });
    };

    const playCheatAutoCycle = () => {
      const list = filteredCheatSheetQuestions.value;
      if (!isCheatAutoPlay.value || list.length === 0 || currentCheatSpeechIndex.value >= list.length) {
        isCheatAutoPlay.value = false;
        activeSpeechCardId.value = null;
        activeSpeechPhase.value = '';
        activeSpeechOptionIndex.value = null;
        speakText('チートシートの全項目聞き流しが完了しました。大変お疲れ様でした。');
        return;
      }

      // 該当アイテムがあるページに自動めくり
      const targetPage = Math.floor(currentCheatSpeechIndex.value / itemsPerPage) + 1;
      if (cheatPage.value !== targetPage) {
        cheatPage.value = targetPage;
      }

      const q = list[currentCheatSpeechIndex.value];
      narrateCheatQuestion(q, () => {
        if (!isCheatAutoPlay.value) return;

        cheatAutoTimer = setTimeout(() => {
          if (!isCheatAutoPlay.value) return;
          currentCheatSpeechIndex.value++;
          if (currentCheatSpeechIndex.value < list.length) {
            playCheatAutoCycle();
          } else {
            isCheatAutoPlay.value = false;
            activeSpeechCardId.value = null;
            activeSpeechPhase.value = '';
            activeSpeechOptionIndex.value = null;
            speakText('チートシートの全項目聞き流しが完了しました。');
          }
        }, 1500);
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
      speechToastMessage,
      speechToastType,
      activeSpeechCardId,
      activeSpeechPhase,
      activeSpeechOptionIndex,
      playChimeAndUnlock,
      speakCurrentWord,
      speakItem,
      speakCheatItem,
      speakCurrentExamQuestion,
      speakCurrentQuizQuestion,
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
      // Logic Helpers
      getQuestionType,
      getAnswerSpeechText,

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
      appVersion,
      reloadApp,

      // Security & Authorization & QR Modal
      isAuthorized,
      authPasscode,
      authError,
      authSuccessMsg,
      verifyAuth,
      lockApp,
      showQrModal,
      qrMode,
      liveTunnelUrl,
      localWifiUrl,
      githubPagesUrl,
      currentQrUrl,
      qrCodeImageUrl
    };
  }
}).mount('#app');
