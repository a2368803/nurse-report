require("dotenv").config();
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const Groq = require("groq-sdk");
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
} = require("docx");

const app = express();
const PORT = process.env.PORT || 5000;
const ENV_PATH = path.join(__dirname, ".env");

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json({ limit: "50mb" }));

const UPLOAD_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => cb(null, `${Date.now()}_${file.originalname}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, /\.(jpg|jpeg|png|gif|webp|txt)$/i.test(file.originalname));
  },
});

function getApiKey() {
  // Cloud env var takes priority (Render, Railway, etc.)
  const envKey = process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY || "";
  if (envKey && !envKey.startsWith("your_")) return envKey;
  // Fallback: read local .env file (for local development)
  try {
    const raw = fs.readFileSync(ENV_PATH, "utf-8");
    const match = raw.match(/(?:GROQ_API_KEY|GEMINI_API_KEY)\s*=\s*(.+)/);
    const key = match ? match[1].trim() : "";
    return key && !key.startsWith("your_") ? key : "";
  } catch { return ""; }
}

// ===== Prompts =====

const PROMPT_TRANSLATE_CHUNK = `你是台灣頂尖護理學術期刊的資深中文編輯，同時精通英中醫學翻譯。請將以下英文段落翻譯成高品質繁體中文，讓台灣護理師讀起來流暢自然，如同以中文原創撰寫。

【台灣護理用語規範 — 必須遵守，這是最常見的翻譯錯誤來源】
intervention   → 介入（絕對不用「干預」）
patient        → 病人 或 個案（不用「患者」）
nurse          → 護理師（不用「護士」）
evidence-based → 實證（不用「循證」）
outcome        → 成效 或 結果（不用「結局」）
manage/management（症狀/疾病）→ 處置、處理（不用「管理」）
caregiver      → 照護者（不用「護理人員」當 caregiver 譯）
significant    → 顯著（不用「顯著性」）
implement      → 執行、落實

【翻譯標準】
① 主動語態優先，適當拆分英文長句為兩句中文短句
② 連接詞符合台灣書面習慣：因此、然而、此外、值得注意的是、由此可知
③ 專業術語首次出現加注英文，例如：心搏過速（tachycardia）
④ 完整保留原文每一句資訊，不省略、不增添
⑤ 保留原文段落分隔

【禁止出現的翻譯腔】
✗ 「患者」→「病人」或「個案」
✗ 「干預」→「介入」
✗ 「護士」→「護理師」
✗ 「循證」→「實證」
✗ 「係」（文言）→「是」或「為」
✗ 「旨在」→「目的為」或「以…為目標」
✗ 過度使用「的」字（連續兩個「的」要重組句子）
✗ 被動語態堆疊（「被發現」→「發現」、「被認為」→「認為」）
✗ 「這個研究」→「本研究」

【同義詞精確度 — 非常重要】
英文近義詞在學術文章中代表不同語意，必須用不同中文詞精確對應，不可合併成同一個詞：
· study / research / trial / investigation → 研究 / 研究 / 試驗 / 調查（依原文選用）
· assess / evaluate / measure / examine → 評估 / 評量 / 測量 / 檢查
· significant / notable / substantial / considerable → 顯著 / 值得注意 / 相當大 / 相當
· decrease / reduce / alleviate / minimize → 下降 / 減少 / 緩解 / 降至最低
· improve / enhance / promote / increase → 改善 / 增強 / 促進 / 增加
· show / indicate / suggest / demonstrate → 顯示 / 指出 / 顯示 / 證明
保留作者刻意選用特定詞彙的語意微差，不可因為「意思差不多」就用同一個中文詞帶過。

只輸出翻譯結果純文字，不加任何說明或標題。

原文：
`;

const PROMPT_POLISH_CHUNK = `你是台灣護理學術期刊資深編輯。以下是一段中文翻譯初稿，請進行最後潤稿，使其達到期刊發表水準。

【潤稿重點】
① 消除所有剩餘翻譯腔，使讀來如中文原創
② 句子冗長者適當拆分，句意重複者合併精簡
③ 連接詞與語氣詞自然流暢（然而、此外、因此、值得注意的是）
④ 絕對不改變任何資訊內容，只改善表達方式
⑤ 保留所有括號內的英文術語注釋
⑥ 保留原有段落分隔

只輸出潤稿後的純文字，不加任何說明或標題。

初稿：
`;

const PROMPT_TITLE = `根據以下護理文章的中文翻譯，回傳純 JSON（不加 markdown）：
{"title":"英文標題","title_zh":"中文標題","source_summary":"原文主旨摘要（繁體中文2-3句）"}
文章翻譯：
`;

const PROMPT_REFLECTION = `你是資深護理學術寫作專家。請根據下方文章內容，撰寫讀書報告並以 JSON 格式回傳。

【JSON 欄位說明 — 每個欄位必須填入真實生成的內容，不可照抄這些說明文字】

part2_reflection：用英文撰寫至少600字的讀書心得，結構如下：
  (a) 個人學習感想與知識收穫
  (b) 2至3個臨床護理情境的具體連結與應用
  (c) 至少3點可立即執行的護理建議
  (d) 對病人照護品質的具體影響

part2_zh：將上方英文心得完整翻譯為繁體中文，段落對應，不省略任何內容

part3_references：陣列，每個元素為一個完整的 APA 第7版參考資料「純文字字串」（不可使用物件）
  範例格式："Smith, J. A., & Lee, B. (2021). Title of the article. Journal Name, 12(3), 45–67. https://doi.org/10.xxxx"

refs_are_real：布林值 true 或 false

【Part 3 規則】
步驟1：搜尋文章中是否有「References」、「Bibliography」或「參考文獻」段落。
步驟2a：有 → 每筆格式化為 APA 第7版純文字字串，refs_are_real 設 true。
步驟2b：無 → 生成合理參考資料字串（每筆末尾加「※需核實」），refs_are_real 設 false。

文章內容：
`;

// ===== Helpers =====
function safeParseJSON(raw) {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("AI 回應中找不到 JSON");
  let str = match[0];
  let result = "", inString = false, escape = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (escape) { result += ch; escape = false; continue; }
    if (ch === "\\") { escape = true; result += ch; continue; }
    if (ch === '"') { inString = !inString; result += ch; continue; }
    if (inString) {
      if (ch === "\n") { result += "\\n"; continue; }
      if (ch === "\r") { result += "\\r"; continue; }
      if (ch === "\t") { result += "\\t"; continue; }
      if (ch.charCodeAt(0) < 32) continue;
    }
    result += ch;
  }
  return JSON.parse(result);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function isTPDError(err) {
  const msg = (err?.message || "").toLowerCase();
  return (err?.status === 429 || err?.statusCode === 429) &&
    (msg.includes("per day") || msg.includes(" tpd") || msg.includes("daily"));
}

// Parse "Please try again in 30m42s" → milliseconds
function parseRetryAfter(msg) {
  const mMatch = (msg || "").match(/(\d+)m\s*(\d+)s/);
  if (mMatch) return (parseInt(mMatch[1]) * 60 + parseInt(mMatch[2])) * 1000;
  const mOnly = (msg || "").match(/(\d+)\s*m(?:in)?/i);
  if (mOnly) return parseInt(mOnly[1]) * 60 * 1000;
  const sOnly = (msg || "").match(/in\s*(\d+)s/i);
  if (sOnly) return parseInt(sOnly[1]) * 1000;
  return 0;
}

// Split text into chunks by paragraph, each chunk ≤ maxChars
function splitChunks(text, maxChars = 900) {
  const paras = text.split(/\n+/).filter(p => p.trim());
  const chunks = [];
  let current = "";
  for (const p of paras) {
    if (current.length + p.length > maxChars && current.length > 0) {
      chunks.push(current.trim());
      current = p;
    } else {
      current += (current ? "\n" : "") + p;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

async function groqRetry(fn, emit, label, maxRetries = 10) {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      const status = err?.status ?? err?.statusCode ?? 0;
      const msg = (err?.message || "").toLowerCase();
      const isRateLimit = status === 429 || msg.includes("rate") || msg.includes("limit") || msg.includes("quota");
      const isOverload  = status === 503 || status === 500 || msg.includes("overload") || msg.includes("unavailable");

      if (isTPDError(err)) {
        // Daily quota — wait for Groq's specified reset time, no attempt limit
        const waitMs = parseRetryAfter(err.message || "") || 35 * 60 * 1000;
        const waitMin = Math.ceil(waitMs / 60000);
        if (emit) emit(`⏳ ${label} 每日用量已達上限，等待 ${waitMin} 分鐘後自動繼續，請勿關閉頁面...`);
        await sleep(waitMs + 8000);
        attempt = 0; // reset attempt counter after TPD wait so TPM retries start fresh
        continue;
      }

      if (isRateLimit && attempt < maxRetries) {
        // TPM or other per-minute limits — parse Groq's retry-after, fallback 60s
        const waitMs = parseRetryAfter(err.message || "") || 60000;
        if (emit) emit(`⏳ ${label} 遇到限流，等待 ${Math.ceil(waitMs/1000)}s 後重試（第 ${attempt+1}/${maxRetries} 次）...`);
        await sleep(waitMs);
        attempt++;
      } else if (isOverload && attempt < maxRetries) {
        if (emit) emit(`⏳ ${label} 伺服器繁忙，等待 15s 後重試（第 ${attempt+1}/${maxRetries} 次）...`);
        await sleep(15000);
        attempt++;
      } else {
        throw err;
      }
    }
  }
}

async function callGroqText(groq, model, prompt, maxTokens, emit, label) {
  return groqRetry(async () => {
    const completion = await groq.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens,
      temperature: 0.7,
    });
    return completion.choices[0].message.content.trim();
  }, emit, label || "文字模型");
}

async function callGroqJSON(groq, model, prompt, maxTokens, emit, label) {
  return groqRetry(async () => {
    const completion = await groq.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens,
      temperature: 0.7,
      response_format: { type: "json_object" },
    });
    return safeParseJSON(completion.choices[0].message.content.trim());
  }, emit, label || "JSON模型");
}

// generateReport accepts an optional SSE writer for real-time progress
async function generateReport(textContent, imagePaths, sendProgress) {
  const emit = (msg) => { console.log(msg); if (sendProgress) sendProgress(msg); };

  const key = getApiKey();
  if (!key) throw new Error("尚未設定 API Key，請至設定頁面輸入");

  const groq = new Groq({ apiKey: key });
  const visionModel = "meta-llama/llama-4-scout-17b-16e-instruct";
  const textModel   = "llama-3.3-70b-versatile";  // 100K TPD — used for all steps
  const fastModel   = "llama-3.1-8b-instant";     // 500K TPD — title/summary only
  emit("✨ 高品質模式（70b 全程）");
  const extractPrompt = "請完整、逐字識別圖片中的所有文字內容，保留原始段落結構與標點，只輸出純文字，不要任何說明或評論。";

  // ── Step 1: Extract text from each image SEPARATELY ──
  let rawContent = textContent || "";

  if (imagePaths.length > 0) {
    emit(`📷 識別圖片文字中（共 ${imagePaths.length} 張）...`);
    for (let i = 0; i < imagePaths.length; i++) {
      emit(`  → 第 ${i + 1}/${imagePaths.length} 張圖片`);
      const imgPath = imagePaths[i];
      const ext = path.extname(imgPath).toLowerCase().slice(1);
      const mimeMap = { jpg:"image/jpeg", jpeg:"image/jpeg", png:"image/png", gif:"image/gif", webp:"image/webp" };
      const b64 = fs.readFileSync(imgPath).toString("base64");

      const extracted = await groqRetry(async () => {
        const completion = await groq.chat.completions.create({
          model: visionModel,
          messages: [{
            role: "user",
            content: [
              { type: "image_url", image_url: { url: `data:${mimeMap[ext]||"image/jpeg"};base64,${b64}` } },
              { type: "text", text: extractPrompt },
            ],
          }],
          max_tokens: 2000,
          temperature: 0.1,
        });
        return completion.choices[0].message.content.trim();
      }, emit, `第 ${i+1} 張圖片識別`);

      emit(`  ✓ 第 ${i + 1} 張識別完成（${extracted.length} 字）`);
      rawContent += (rawContent ? "\n\n" : "") + extracted;

      if (i < imagePaths.length - 1) await sleep(10000); // 圖片間加長間隔，避免視覺模型 TPM 超限
    }
    emit(`✅ 圖片文字識別完成（總計 ${rawContent.length} 字）`);
  }

  // ── Step 2: Chunk & translate ──
  const chunks = splitChunks(rawContent, 800);
  emit(`🌐 開始翻譯（共 ${chunks.length} 段）...`);
  const translatedParts = [];
  let prevTranslated = "";
  for (let i = 0; i < chunks.length; i++) {
    emit(`  → 翻譯第 ${i + 1}/${chunks.length} 段`);
    const ctxNote = prevTranslated
      ? `【前段翻譯結尾（術語一致性參考，請勿重複輸出此段）】\n${prevTranslated.slice(-200)}\n\n`
      : "";
    const prompt = PROMPT_TRANSLATE_CHUNK.replace("原文：\n", ctxNote + "原文：\n") + chunks[i];
    const translated = await callGroqText(groq, textModel, prompt, 2000, emit, `翻譯第 ${i+1} 段`);
    prevTranslated = translated;
    translatedParts.push(translated);
    if (i < chunks.length - 1) await sleep(3000);
  }
  emit(`✅ 翻譯完成（共 ${translatedParts.join("\n\n").length} 字）`);

  // ── Step 3: Polish translation (70b — best quality) ──
  await sleep(3000);
  const polishChunks = splitChunks(translatedParts.join("\n\n"), 1000);
  emit(`✍️ 潤稿中（共 ${polishChunks.length} 段）...`);
  const polishedParts = [];
  let prevPolished = "";
  for (let i = 0; i < polishChunks.length; i++) {
    emit(`  → 潤稿第 ${i + 1}/${polishChunks.length} 段`);
    const ctxNote = prevPolished
      ? `【前段潤稿結尾（語氣銜接參考，請勿重複輸出此段）】\n${prevPolished.slice(-200)}\n\n`
      : "";
    const prompt = PROMPT_POLISH_CHUNK.replace("初稿：\n", ctxNote + "初稿：\n") + polishChunks[i];
    const polished = await callGroqText(groq, textModel, prompt, 2000, emit, `潤稿第 ${i+1} 段`);
    prevPolished = polished;
    polishedParts.push(polished);
    if (i < polishChunks.length - 1) await sleep(3000);
  }

  const fullTranslation = polishedParts.join("\n\n");
  emit(`✅ 潤稿完成（共 ${fullTranslation.length} 字）`);

  // ── Step 4: Title + summary ──
  await sleep(3000);
  emit("📝 生成標題與摘要...");
  const titleData = await callGroqJSON(groq, fastModel, PROMPT_TITLE + fullTranslation.slice(0, 1500), 500, emit, "標題生成");

  // ── Step 4: Reflection + References ──
  await sleep(3000);
  emit("💡 撰寫心得與 APA 參考資料...");
  const part2 = await callGroqJSON(groq, textModel, PROMPT_REFLECTION + rawContent.slice(0, 2500), 4000, emit, "心得生成");

  emit("✅ 報告生成完成！");

  // Normalize references: model sometimes returns objects instead of strings
  const rawRefs = part2.part3_references || [];
  const normalizedRefs = rawRefs.map(ref => {
    if (typeof ref === "string") return ref;
    if (typeof ref === "object" && ref !== null) {
      // Try to reconstruct APA string from common object keys
      const { authors, author, year, title, journal, volume, issue, pages, doi, url } = ref;
      const a = authors || author || "";
      const y = year ? `(${year}).` : "";
      const t = title ? `${title}.` : "";
      const j = journal || "";
      const v = volume ? `, ${volume}` : "";
      const n = issue ? `(${issue})` : "";
      const p = pages ? `, ${pages}.` : ".";
      const d = doi ? ` https://doi.org/${doi}` : (url ? ` ${url}` : "");
      const built = [a, y, t, j + v + n + p + d].filter(Boolean).join(" ");
      return built || JSON.stringify(ref);
    }
    return String(ref);
  });

  const now = new Date();
  return {
    title:             titleData.title            || "Nursing Reading Report",
    title_zh:          titleData.title_zh         || "",
    source_summary:    titleData.source_summary   || "",
    part1_translation: fullTranslation,
    part2_reflection:  part2.part2_reflection     || "",
    part2_zh:          part2.part2_zh             || "",
    part3_references:  normalizedRefs,
    refs_are_real:     part2.refs_are_real !== false,
    generated_at: `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")} ${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`,
  };
}

// ===== Word Doc =====
function makeHeading(text, color) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 300, after: 120 },
    children: [new TextRun({ text, bold: true, color: color || "1A569E", size: 26 })],
  });
}
function makeBody(text) {
  return (text || "").split("\n").filter(l => l.trim()).map(line =>
    new Paragraph({
      indent: { firstLine: 440 },
      spacing: { after: 120, line: 360 },
      children: [new TextRun({ text: line.trim(), size: 24 })],
    })
  );
}
async function buildWordDoc(report) {
  const doc = new Document({
    sections: [{
      properties: { page: { margin: { top: 1440, bottom: 1440, left: 1800, right: 1440 } } },
      children: [
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: [new TextRun({ text: report.title || "Nursing Reading Report", bold: true, size: 36, color: "1A569E" })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 }, children: [new TextRun({ text: report.title_zh || "", bold: true, size: 28 })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 400 }, children: [new TextRun({ text: `Generated: ${report.generated_at || ""}`, italics: true, size: 20, color: "888888" })] }),
        makeHeading("原文摘要 Source Summary", "0F766E"), ...makeBody(report.source_summary),
        makeHeading("Part 1：全文翻譯 Full Translation", "1A569E"), ...makeBody(report.part1_translation),
        makeHeading("Part 2：Reflection & Clinical Application", "6D28D9"), ...makeBody(report.part2_reflection),
        makeHeading("Part 2（中文）：心得與臨床應用", "0369A1"), ...makeBody(report.part2_zh),
        makeHeading("Part 3：References (APA 7th Edition)", "B45309"),
        new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: report.refs_are_real ? "✅ 以下參考資料取自原文真實引用，已格式化為 APA 第7版。" : "⚠️ 原文未含參考文獻清單，以下為 AI 依主題生成之建議引用，請逐筆核實 DOI 後再使用。", italics: true, size: 18, color: report.refs_are_real ? "166534" : "92400E" })] }),
        ...(report.part3_references || []).map((ref, i) =>
          new Paragraph({ indent: { left: 720, hanging: 720 }, spacing: { after: 120, line: 360 }, children: [new TextRun({ text: `${i+1}.  ${ref}`, size: 22 })] })
        ),
        new Paragraph({ spacing: { before: 480 }, children: [new TextRun({ text: "* This report was generated with AI assistance for nursing education purposes.", italics: true, size: 18, color: "888888" })] }),
      ],
    }],
  });
  return await Packer.toBuffer(doc);
}

// ===== Routes =====
app.get("/api/status", (req, res) => {
  res.json({ configured: !!getApiKey() });
});

app.get("/api/test-groq", async (req, res) => {
  const key = getApiKey();
  if (!key) return res.json({ ok: false, error: "No API key found" });
  try {
    const groq = new Groq({ apiKey: key });
    const r = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: "Reply with the word OK only." }],
      max_tokens: 10,
    });
    res.json({ ok: true, reply: r.choices[0].message.content.trim(), model: "llama-3.3-70b-versatile" });
  } catch (err) {
    res.json({ ok: false, error: err.message, status: err.status });
  }
});

app.post("/api/savekey", (req, res) => {
  const { key } = req.body;
  if (!key || key.length < 10) return res.status(400).json({ error: "金鑰無效，請確認完整複製" });
  try {
    fs.writeFileSync(ENV_PATH, `GROQ_API_KEY=${key.trim()}\n`, "utf-8");
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: "儲存失敗：" + e.message });
  }
});

// SSE progress endpoint
app.get("/progress/:id", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  progressClients.set(req.params.id, res);
  req.on("close", () => progressClients.delete(req.params.id));
});

const progressClients = new Map();

app.post("/generate", upload.array("files", 10), async (req, res) => {
  const textContent = (req.body.text_content || "").trim();
  const progressId  = req.body.progress_id || "";
  const files = req.files || [];
  if (!textContent && !files.length) return res.status(400).json({ error: "請上傳圖檔或輸入文字內容" });

  const imagePaths = [];
  let extraText = textContent;
  for (const file of files) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === ".txt") extraText += "\n" + fs.readFileSync(file.path, "utf-8");
    else imagePaths.push(file.path);
  }

  const sendProgress = (msg) => {
    const client = progressClients.get(progressId);
    if (client) client.write(`data: ${JSON.stringify({ msg })}\n\n`);
  };

  try {
    const report = await generateReport(extraText || null, imagePaths, sendProgress);
    res.json({ success: true, report });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: `生成失敗：${err.message}` });
  } finally {
    for (const f of files) { try { fs.unlinkSync(f.path); } catch (_) {} }
    const client = progressClients.get(progressId);
    if (client) { client.write("data: {\"done\":true}\n\n"); client.end(); progressClients.delete(progressId); }
  }
});

app.post("/download", async (req, res) => {
  const report = req.body;
  if (!report?.title) return res.status(400).json({ error: "找不到報告資料" });
  try {
    const buf = await buildWordDoc(report);
    const safeName = (report.title || "nursing_report").replace(/[^\w\s-]/g,"").trim().replace(/\s+/g,"_").slice(0,50);
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,"0")}${String(now.getDate()).padStart(2,"0")}`;
    res.setHeader("Content-Type","application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition",`attachment; filename="${encodeURIComponent(safeName)}_${stamp}.docx"`);
    res.send(buf);
  } catch (err) {
    res.status(500).json({ error: `匯出失敗：${err.message}` });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n✅ 護理讀書報告生成器已啟動`);
  console.log(`   網址：http://localhost:${PORT}`);
  console.log(`   按 Ctrl+C 停止\n`);
  // Auto-open browser only on local Windows
  if (process.platform === "win32" && !process.env.RENDER) {
    const { exec } = require("child_process");
    exec(`cmd /c start "" "http://localhost:${PORT}"`);
  }
});
