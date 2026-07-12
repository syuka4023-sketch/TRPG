const DB_NAME = "trpg_manager_db";
const DB_VERSION = 1;
const STORE_NAME = "app_state";

const STORAGE_KEYS = {
  scenarios: "scenarios",
  characters: "characters",
  sessions: "sessions",
  backup: "backup"
};

let scenarios = [];
let characters = [];
let sessions = [];
let dataNeedsSave = false;

let dbPromise = null;

function uid() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return "id_" + Date.now() + "_" + Math.random().toString(36).slice(2, 10);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, s => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[s]));
}

function toId(value) {
  return String(value ?? "");
}

function normalizeBirthday(value) {
  const match = String(value || "").match(/(?:\d{4}-)?(\d{2})-(\d{2})$/);
  if (!match) return "";

  const month = Number(match[1]);
  const day = Number(match[2]);
  return month >= 1 && month <= 12 && day >= 1 && day <= 31 ? `${match[1]}-${match[2]}` : "";
}

const QUESTION_GROUPS = [
  {
    category: "自己",
    questions: [
      "他人に依存しない", "逆境に強い", "誠実に素直で正直", "可能性を信じて前進できる",
      "自分を誇張しすぎない", "常識にとらわれず信念に従う", "自分自身を受け入れる",
      "自分を律せる", "他者との違いを受け入れる", "過去未来ではなく今を見られる"
    ]
  },
  {
    category: "行動力",
    questions: [
      "考えを実践できる", "困難に立ち向かえる", "新しいことを学び経験できる", "徹底的に物事へ取り組める",
      "物事や人に深い関心が持てる", "リスクやチャンスに飛び込める", "倫理、根拠に基づいて行動する",
      "思考と行動の質を高められる", "困難があっても続けられる", "成長し続けられる"
    ]
  },
  {
    category: "経験",
    questions: [
      "新しい挑戦に挑める", "大衆に広く認められている", "心身ともに健康", "経済的に豊か",
      "安定した生活を維持できる", "制限に縛られず生きている", "自分の使命や義理を果たせる",
      "心身ともに満たされている", "夢や可能性を持っている", "人生の意味や方向性を持っている"
    ]
  },
  {
    category: "対人",
    questions: [
      "礼儀正しく接せる", "公平である", "他者を前向きに導ける", "他者に共感し行動できる",
      "他者の役に立とうとできる", "大切な人を守る意思がある", "支え合える友人がいる",
      "守るべき家族がいる", "愛すべき人がいる", "他者から愛されている"
    ]
  },
  {
    category: "社会性",
    questions: [
      "個より社会を重視している", "周りを見ている", "能力より平等を重視している", "成果より均衡を重視している",
      "神の意思に従う", "歴史や文化を大切にしている", "自国を愛し守れる", "世界平和を願っている",
      "社会に貢献している", "すべての人を同じ共同体として見ている"
    ]
  }
];

function defaultQuestions() {
  return QUESTION_GROUPS.flatMap(({ category, questions }) =>
    questions.map(q => ({
      id: uid(),
      category,
      q,
      type: "scale",
      value: 3
    }))
  );
}

function addMissingDefaultQuestions(questions) {
  let hasChanges = false;

  QUESTION_GROUPS.forEach(({ category, questions: defaultGroupQuestions }) => {
    defaultGroupQuestions.forEach(questionText => {
      const existingQuestion = questions.find(question => question.q === questionText);

      if (existingQuestion) {
        if (!existingQuestion.category) {
          existingQuestion.category = category;
          hasChanges = true;
        }
        return;
      }

      questions.push({
        id: uid(),
        category,
        q: questionText,
        type: "scale",
        value: 3
      });
      hasChanges = true;
    });
  });

  return hasChanges;
}

function normalizePlayer(player) {
  if (typeof player === "string") {
    return {
      id: uid(),
      name: player,
      url: ""
    };
  }

  return {
    id: toId(player?.id || uid()),
    name: player?.name || "",
    url: player?.url || ""
  };
}

function normalizeRelatedPC(row) {
  if (typeof row === "string") {
    return {
      id: uid(),
      player: row,
      pc: "",
      url: ""
    };
  }

  return {
    id: toId(row?.id || uid()),
    player: row?.player || "",
    pc: row?.pc || "",
    url: row?.url || ""
  };
}

function normalizeData() {
  dataNeedsSave = false;

  if (!Array.isArray(scenarios)) scenarios = [];
  if (!Array.isArray(characters)) characters = [];
  if (!Array.isArray(sessions)) sessions = [];

  scenarios = scenarios.map(s => ({
    id: toId(s.id || uid()),
    title: s.title || "無題シナリオ",
    system: s.system || "",
    status: s.status || "未通過",
    playerCount: s.playerCount || "",
    url: s.url || "",
    memo: s.memo || ""
  }));

  characters = characters.map(c => {
    const questions = Array.isArray(c.questions) && c.questions.length
      ? c.questions.map(q => ({
          id: toId(q.id || uid()),
          category: String(q.category || ""),
          q: q.q || "質問",
          type: q.type === "scale" ? "scale" : "text",
          value: q.type === "scale" ? Number(q.value || 3) : (q.value || "")
        }))
      : defaultQuestions();

    const questionnaireVersion = Number(c.questionnaireVersion || 0);
    if (questionnaireVersion < 2) {
      addMissingDefaultQuestions(questions);
      dataNeedsSave = true;
    }

    return {
      id: toId(c.id || uid()),
      name: c.name || "新規キャラクター",
      url: c.url || "",
      imageUrl: c.imageUrl || "",
      images: Array.isArray(c.images) ? c.images.filter(Boolean) : [],
      tags: Array.isArray(c.tags) ? c.tags.filter(Boolean) : [],
      memo: c.memo || "",
      gender: c.gender || "",
      age: c.age === undefined || c.age === null ? "" : String(c.age),
      birthday: normalizeBirthday(c.birthday),
      imageColor: /^#[0-9a-fA-F]{6}$/.test(c.imageColor || "") ? c.imageColor : "#5d86dc",
      questionnaireVersion: 2,
      questions
    };
  });

  sessions = sessions.map(s => {
    const players = Array.isArray(s.players)
      ? s.players.map(normalizePlayer)
      : String(s.players || "")
          .split(/[\n,]/)
          .map(v => v.trim())
          .filter(Boolean)
          .map(name => normalizePlayer(name));

    const charIds = Array.isArray(s.charIds)
      ? s.charIds.map(toId).filter(Boolean)
      : (Array.isArray(s.characters) ? s.characters.map(toId).filter(Boolean) : []);

    const logUrls = Array.isArray(s.logUrls)
      ? s.logUrls.map(v => String(v || "").trim()).filter(Boolean)
      : String(s.logUrls || "")
          .split("\n")
          .map(v => v.trim())
          .filter(Boolean);

    const relatedPCs = Array.isArray(s.relatedPCs)
      ? s.relatedPCs.map(normalizeRelatedPC)
      : [];

    return {
      id: toId(s.id || uid()),
      scenarioId: s.scenarioId ? toId(s.scenarioId) : "",
      title: s.title || "",
      kp: s.kp || "",
      players,
      charIds: [...new Set(charIds)],
      logUrls,
      relatedPCs,
      dates: Array.isArray(s.dates)
        ? s.dates.filter(Boolean)
        : String(s.dates || "").split("\n").map(v => v.trim()).filter(Boolean),
      status: s.status || "予定",
      memo: s.memo || ""
    };
  });
}

function getDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = event => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

async function idbGet(key) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(key);

    req.onsuccess = () => resolve(req.result ? req.result.value : null);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.put({ key, value });

    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function idbDelete(key) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.delete(key);

    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function readLegacyJSON(key, fallback = []) {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  } catch (e) {
    console.error(`${key} の旧localStorage読込に失敗`, e);
    return Array.isArray(fallback) ? [...fallback] : fallback;
  }
}

async function migrateFromLocalStorageIfNeeded() {
  const migrated = await idbGet("migrated_from_localstorage");
  if (migrated) return;

  const legacyScenarios = readLegacyJSON(STORAGE_KEYS.scenarios, []);
  const legacyCharacters = readLegacyJSON(STORAGE_KEYS.characters, []);
  const legacySessions = readLegacyJSON(STORAGE_KEYS.sessions, []);
  const legacyBackup = readLegacyJSON(STORAGE_KEYS.backup, []);

  const hasLegacyData =
    legacyScenarios.length || legacyCharacters.length || legacySessions.length || legacyBackup.length;

  if (hasLegacyData) {
    await idbSet(STORAGE_KEYS.scenarios, legacyScenarios);
    await idbSet(STORAGE_KEYS.characters, legacyCharacters);
    await idbSet(STORAGE_KEYS.sessions, legacySessions);
    await idbSet(STORAGE_KEYS.backup, legacyBackup);
  }

  await idbSet("migrated_from_localstorage", true);
}

async function loadAllData() {
  await migrateFromLocalStorageIfNeeded();

  scenarios = (await idbGet(STORAGE_KEYS.scenarios)) || [];
  characters = (await idbGet(STORAGE_KEYS.characters)) || [];
  sessions = (await idbGet(STORAGE_KEYS.sessions)) || [];

  normalizeData();
  if (dataNeedsSave) await saveAll(false);
}

function makeBackupSlim() {
  return {
    scenarios,
    sessions,
    characters: characters.map(c => ({
      ...c,
      images: []
    }))
  };
}

async function saveAll(withBackup = true) {
  try {
    if (withBackup) {
      let backups = (await idbGet(STORAGE_KEYS.backup)) || [];
      backups.unshift({
        date: new Date().toLocaleString("ja-JP"),
        data: makeBackupSlim()
      });
      backups = backups.slice(0, 5);
      await idbSet(STORAGE_KEYS.backup, backups);
    }

    await idbSet(STORAGE_KEYS.scenarios, scenarios);
    await idbSet(STORAGE_KEYS.characters, characters);
    await idbSet(STORAGE_KEYS.sessions, sessions);
    return true;
  } catch (e) {
    console.error("IndexedDB 保存に失敗しました", e);
    alert("保存に失敗しました。ブラウザのストレージ制限、または保存データが大きすぎる可能性があります。");
    return false;
  }
}

async function restoreBackup(index) {
  const backups = (await idbGet(STORAGE_KEYS.backup)) || [];
  if (!backups[index]) return false;
  if (!confirm("このバックアップを復元しますか？")) return false;

  scenarios = backups[index].data.scenarios || [];
  characters = backups[index].data.characters || [];
  sessions = backups[index].data.sessions || [];
  normalizeData();
  await saveAll(false);
  location.reload();
  return true;
}

async function exportAllData() {
  const data = {
    scenarios,
    characters,
    sessions,
    exportedAt: new Date().toISOString()
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `trpg_backup_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importAllDataFromFile(file, onDone) {
  const reader = new FileReader();

  reader.onload = async () => {
    try {
      const data = JSON.parse(reader.result);

      if (!data || typeof data !== "object") {
        throw new Error("JSON形式が不正です");
      }

      scenarios = Array.isArray(data.scenarios) ? data.scenarios : [];
      characters = Array.isArray(data.characters) ? data.characters : [];
      sessions = Array.isArray(data.sessions) ? data.sessions : [];

      normalizeData();
      await saveAll(false);

      if (typeof onDone === "function") onDone(true);
    } catch (e) {
      console.error(e);
      alert("バックアップの読み込みに失敗しました");
      if (typeof onDone === "function") onDone(false);
    }
  };

  reader.readAsText(file);
}

function getScenarioById(id) {
  return scenarios.find(s => toId(s.id) === toId(id));
}

function getCharacterById(id) {
  return characters.find(c => toId(c.id) === toId(id));
}

function getSessionById(id) {
  return sessions.find(s => toId(s.id) === toId(id));
}

function removeCharacterFromSessions(characterId) {
  sessions.forEach(s => {
    s.charIds = (s.charIds || []).filter(id => toId(id) !== toId(characterId));
  });
}

function removeScenarioFromSessions(scenarioId) {
  sessions.forEach(s => {
    if (toId(s.scenarioId) === toId(scenarioId)) {
      s.scenarioId = "";
    }
  });
}

function getSessionsByCharacterId(characterId) {
  return sessions.filter(s => (s.charIds || []).includes(toId(characterId)));
}

function getSessionsByScenarioId(scenarioId) {
  return sessions.filter(s => toId(s.scenarioId) === toId(scenarioId));
}

function getPlayerDisplayName(player) {
  return normalizePlayer(player).name || "無名PL";
}

function getRelatedCharacters(characterId) {
  const relatedMap = new Map();

  function pushSession(target, session) {
    const exists = target.sessions.some(s => toId(s.id) === toId(session.id));
    if (!exists) {
      target.sessions.push({
        id: session.id,
        title: session.title || "無題セッション"
      });
    }
  }

  getSessionsByCharacterId(characterId).forEach(session => {
    (session.charIds || []).forEach(cid => {
      if (toId(cid) === toId(characterId)) return;

      const c = getCharacterById(cid);
      if (!c) return;

      const displayName = String(c.name || "").trim();
      if (!displayName) return;

      const key = `character:${displayName}`;

      if (!relatedMap.has(key)) {
        relatedMap.set(key, {
          type: "character",
          displayName,
          character: c,
          sessions: []
        });
      }

      const item = relatedMap.get(key);

      if (!item.character?.url && c.url) item.character = c;
      if ((!item.character?.images || !item.character.images.length) && c.images?.length) {
        item.character = c;
      }

      pushSession(item, session);
    });

    (session.relatedPCs || []).forEach(row => {
      const normalized = normalizeRelatedPC(row);
      const pcName = String(normalized.pc || "").trim();
      if (!pcName) return;

      const key = `related_pc:${pcName}`;

      if (!relatedMap.has(key)) {
        relatedMap.set(key, {
          type: "related_pc",
          displayName: pcName,
          relatedPC: {
            player: normalized.player || "",
            pc: pcName,
            url: normalized.url || ""
          },
          sessions: []
        });
      }

      const item = relatedMap.get(key);

      if (!item.relatedPC.player && normalized.player) {
        item.relatedPC.player = normalized.player;
      }
      if (!item.relatedPC.url && normalized.url) {
        item.relatedPC.url = normalized.url;
      }

      pushSession(item, session);
    });
  });

  return [...relatedMap.values()].sort((a, b) =>
    String(a.displayName || "").localeCompare(String(b.displayName || ""), "ja")
  );
}

window.__dataReady = loadAllData();
