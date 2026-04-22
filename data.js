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

function defaultQuestions() {
  return [
    { id: uid(), q: "名前とその由来は？", type: "text", value: "" },
    { id: uid(), q: "好奇心", type: "scale", value: 3 },
    { id: uid(), q: "世話焼き", type: "scale", value: 3 },
    { id: uid(), q: "野蛮度", type: "scale", value: 3 },
    { id: uid(), q: "協調性", type: "scale", value: 3 },
    { id: uid(), q: "素直さ", type: "scale", value: 3 }
  ];
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

  characters = characters.map(c => ({
    id: toId(c.id || uid()),
    name: c.name || "新規キャラクター",
    url: c.url || "",
    imageUrl: c.imageUrl || "",
    images: Array.isArray(c.images) ? c.images.filter(Boolean) : [],
    tags: Array.isArray(c.tags) ? c.tags.filter(Boolean) : [],
    memo: c.memo || "",
    questions: Array.isArray(c.questions) && c.questions.length
      ? c.questions.map(q => ({
          id: toId(q.id || uid()),
          q: q.q || "質問",
          type: q.type === "scale" ? "scale" : "text",
          value: q.type === "scale" ? Number(q.value || 3) : (q.value || "")
        }))
      : defaultQuestions()
  }));

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