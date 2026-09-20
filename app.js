const { createApp, ref, computed, onMounted, onUnmounted, watch } = Vue;

const DB_NAME = 'ArchConstructionCBT_DB_v2';
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
    const isAutoPlay = ref(false); // 車両通勤・自動連続耳学モード
    const isReviewAutoPlay = ref(false); // 振り返り耳学モード
    const currentReviewSpeechIndex = ref(0);
    const speechRate = ref(1.0); // 0.85, 1.0, 1.2, 1.4
    let currentUtterance = null;
    let autoPlayTimer = null;
    let reviewAutoTimer = null;

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

    // モバイル用音声アンロック（iOS / Android の自動再生制限解除）
    let isAudioUnlocked = false;
    const unlockAudioSpeech = () => {
      if (isAudioUnlocked || !window.speechSynthesis) return;
      try {
        const u = new SpeechSynthesisUtterance('');
        u.volume = 0;
        window.speechSynthesis.speak(u);
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
      // Google 日本語, Kyoko, Otoya, または ja-JP
      return list.find(v => v.lang === 'ja-JP' || v.lang === 'ja_JP' || v.lang.startsWith('ja')) || null;
    };

    // ==========================================
    // 🔆 画面スリープ防止（Wake Lock API - 音声と競合しない標準方式）
    // ==========================================
    const isWakeLockSupported = ref(typeof navigator !== 'undefined' && 'wakeLock' in navigator);
    const isWakeLockActive = ref(false);
    const wakeLockManualOverride = ref(false);
    let wakeLockSentinel = null;

    const acquireWakeLock = async () => {
      if (typeof navigator !== 'undefined' && 'wakeLock' in navigator) {
        try {
          if (!wakeLockSentinel) {
            wakeLockSentinel = await navigator.wakeLock.request('screen');
            isWakeLockActive.value = true;
            wakeLockSentinel.addEventListener('release', () => {
              wakeLockSentinel = null;
              if (!wakeLockManualOverride.value && !isAutoPlay.value && !isReviewAutoPlay.value) {
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
        if (!isAutoPlay.value && !isReviewAutoPlay.value) {
          await releaseWakeLock();
        }
      }
    };

    // 画面復帰時の自動再取得
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState === 'visible') {
          if (wakeLockManualOverride.value || isAutoPlay.value || isReviewAutoPlay.value) {
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
      isSpeaking.value = false;
      isAutoPlay.value = false;
      isReviewAutoPlay.value = false;
      releaseWakeLock();
    };

    // 音声テスト＆強制アンロック関数
    const testSpeech = () => {
      stopSpeech();
      speakText('音声テストです。正常に読み上げが行われています。マナーモードがオフになっていることをご確認ください。');
    };

    const speakText = (text, onEndCallback = null) => {
      if (!isSpeechSupported.value || !window.speechSynthesis) {
        if (onEndCallback) onEndCallback();
        return;
      }

      // iOS Safari のバグ回避: すでに発話中の場合のみ cancel
      if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
        window.speechSynthesis.cancel();
      }

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

      // iOS Safari WebKit バグ（cancel直後のspeakが無視される問題）を防ぐため50ms待機
      setTimeout(() => {
        try {
          window.speechSynthesis.resume(); // 一時停止状態の解除
          window.speechSynthesis.speak(utterance);
        } catch (e) {
          console.error('[Speech] speak error:', e);
          isSpeaking.value = false;
          if (onEndCallback) onEndCallback();
        }
      }, 50);
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
    const toggleAutoPlay = async () => {
      if (isAutoPlay.value) {
        stopSpeech();
      } else {
        stopSpeech();
        isAutoPlay.value = true;
        await acquireWakeLock();
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
    const toggleReviewAutoPlay = async () => {
      if (isReviewAutoPlay.value) {
        stopSpeech();
      } else {
        stopSpeech();
        isReviewAutoPlay.value = true;
        await acquireWakeLock();
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

      // ランダム抽出
      const shuffled = [...allQuestions.value].sort(() => 0.5 - Math.random());
      examQuestions.value = shuffled.slice(0, Math.min(targetCount, shuffled.length));

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
      isExamFinished.value = true;
      isExamStarted.value = false;
    };

    const resetExamState = () => {
      clearInterval(examTimerInterval);
      isExamStarted.value = false;
      isExamFinished.value = false;
      examQuestions.value = [];
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

    const examWrongQuestions = computed(() => {
      const list = [];
      examQuestions.value.forEach((q, idx) => {
        if (examUserAnswers.value[idx] !== q.correctIndex) {
          list.push({
            q,
            userAnswer: examUserAnswers.value[idx]
          });
        }
      });
      return list;
    });

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
      if (quizRandomOrder.value) {
        list = [...list].sort(() => 0.5 - Math.random());
      }
      return list;
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
    });

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
      try {
        const cached = await getAllFromDB();
        if (cached && cached.length > 0) {
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

      // Audio & Speech (TTS / 耳学通勤モード & 振り返り耳学)
      isSpeechSupported,
      isSpeaking,
      isAutoPlay,
      isReviewAutoPlay,
      currentReviewSpeechIndex,
      speechRate,
      speakCurrentWord,
      speakItem,
      toggleAutoPlay,
      toggleReviewAutoPlay,
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
      testSpeech
    };
  }
}).mount('#app');
