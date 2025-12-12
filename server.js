// server.js (Orion Creator API 2.8.x - DEBUG MODE)
// VERSÃO COM AJUSTES DE POSIÇÃO AGRESSIVOS + LOGS PARA DIAGNÓSTICO

import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import multer from "multer";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import cloudinary from "./api/cloudinary.js";
import sharp from "sharp";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { promises as fsPromises } from "fs";
import ffmpeg from "fluent-ffmpeg";
import { Readable } from "stream";
import { spawn } from "child_process";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import validator from "validator";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";

import {
  buscarTMDB,
  getLancamentos,
  getFilmesPopulares,
  getSeriesPopulares,
  getTendencias
} from "./api/tmdb.js";

import FanartService from "./api/fanart-service.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const requiredEnvVars = [
  "TMDB_KEY",
  "PORT",
  "FIREBASE_PROJECT_ID",
  "FIREBASE_PRIVATE_KEY",
  "FIREBASE_CLIENT_EMAIL",
  "FANART_API_KEY"
];

for (const varName of requiredEnvVars) {
  if (!process.env[varName]) {
    console.error(`❌ ERRO: Variável ${varName} não definida no .env`);
    process.exit(1);
  }
}

const firebasePrivateKey = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");

if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        project_id: process.env.FIREBASE_PROJECT_ID,
        private_key: firebasePrivateKey,
        client_email: process.env.FIREBASE_CLIENT_EMAIL
      })
    });
    console.log("✅ Firebase inicializado");
  } catch (err) {
    console.error("❌ Erro ao inicializar Firebase:", err.message);
    process.exit(1);
  }
}
const db = getFirestore();

const app = express();
const PORT = process.env.PORT || 3000;

const fanartService = new FanartService(process.env.FANART_API_KEY);
console.log("✅ Fanart.tv Service inicializado");

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Desabilitar cache para arquivos estáticos (FORCE NO-CACHE)
app.use(express.static(path.join(__dirname, "public"), {
  etag: false,
  lastModified: false,
  setHeaders: (res, path) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
  }
}));

const tmdbLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: { error: "Muitas requisições. Tente novamente em alguns minutos." }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: "Muitas requisições. Tente novamente em 15 minutos." }
});

const bannerLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 20,
  message: { error: "Limite de geração de banners atingido. Aguarde alguns minutos." }
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: { error: "Limite de uploads atingido. Tente novamente depois." }
});

const verificarAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || "";
    if (!authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Token de autenticação não fornecido" });
    }
    const token = authHeader.slice(7);
    const decoded = await admin.auth().verifyIdToken(token);
    req.uid = decoded.uid;
    req.user = decoded;
    next();
  } catch (err) {
    console.error("❌ Erro na autenticação:", err.message);
    res.status(401).json({ error: "Token inválido ou expirado" });
  }
};

class SimpleCache {
  constructor(ttlMs = 60 * 60 * 1000, maxItems = 500) {
    this.ttl = ttlMs;
    this.maxItems = maxItems;
    this.map = new Map();
    this.timer = setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }
  get(key) {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > this.ttl) {
      this.map.delete(key);
      return null;
    }
    return entry.data;
  }
  set(key, data) {
    if (this.map.size >= this.maxItems) {
      this.cleanup();
      if (this.map.size >= this.maxItems) {
        const oldestKey = this.map.keys().next().value;
        this.map.delete(oldestKey);
      }
    }
    this.map.set(key, { data, ts: Date.now() });
  }
  cleanup() {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this.map.entries()) {
      if (now - entry.ts > this.ttl) {
        this.map.delete(key);
        removed++;
      }
    }
    if (removed) console.log(`🧹 Cache: ${removed} itens expirados removidos`);
  }
  clear() { this.map.clear(); }
  destroy() { clearInterval(this.timer); this.clear(); }
  get size() { return this.map.size; }
}
const imageCache = new SimpleCache(60 * 60 * 1000, 200);
const tmdbCache = new SimpleCache(30 * 60 * 1000, 500);

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "orioncreator",
    allowed_formats: ["jpg", "png", "jpeg", "webp"],
    transformation: [{ width: 2000, height: 3000, crop: "limit" }]
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Formato não suportado. Use JPG, PNG ou WEBP."));
  }
});

// Multer para processar FormData sem arquivos
const formDataParser = multer();

const COLORS = {
  PRETO: { hex: "#000000", gradient: ["#1a1a1a", "#000000"] },
  ROXO: { hex: "#8A2BE2", gradient: ["#4B0082", "#000000"] },
  AZUL: { hex: "#007bff", gradient: ["#001f3f", "#000000"] },
  VERDE: { hex: "#28a745", gradient: ["#0f3e18", "#000000"] },
  VERMELHO: { hex: "#dc3545", gradient: ["#4a0808", "#000000"] },
  LARANJA: { hex: "#fd7e14", gradient: ["#692800", "#000000"] },
  AMARELO: { hex: "#ffc107", gradient: ["#856404", "#000000"] },
  DOURADO: { hex: "#cc9b07ff", gradient: ["#856404", "#000000"] },
  ROSA: { hex: "#ff00ddff", gradient: ["#750065ff", "#000000"] },
  PRATA: { hex: "#C0C0C0", gradient: ["#383838", "#000000"] }
};

const PREMIUM_OVERLAYS = {
  ROXO: "https://res.cloudinary.com/dxbu3zk6i/image/upload/v1763988195/vertical_roxo_vdnbwk.png",
  AZUL: "https://res.cloudinary.com/dxbu3zk6i/image/upload/v1763988195/vertical_azul_h83cpu.png",
  VERMELHO: "https://res.cloudinary.com/dxbu3zk6i/image/upload/v1763988197/vertical_vermelho_bjb2u1.png",
  VERDE: "https://res.cloudinary.com/dxbu3zk6i/image/upload/v1763988197/vertical_verde_i2nekv.png",
  PRATA: "https://res.cloudinary.com/dxbu3zk6i/image/upload/v1763988194/vertical_prata_xuvzoi.png",
  AMARELO: "https://res.cloudinary.com/dxbu3zk6i/image/upload/v1763988195/vertical_amarelo_urqjlu.png",
  DOURADO: "https://res.cloudinary.com/dxbu3zk6i/image/upload/v1763988194/vertical_dourado_asthju.png",
  LARANJA: "https://res.cloudinary.com/dxbu3zk6i/image/upload/v1763988195/vertical_lajanja_qtyj6n.png"
};

const ORION_X_OVERLAYS = {
  PRETO: "preto.png",
  ROXO: "roxo.png",
  AZUL: "azul.png",
  VERMELHO: "vermelho.png",
  VERDE: "verde.png",
  AMARELO: "amarelo.png",
  LARANJA: "laranja.png",
  ROSA: "rosa.png"
};

const PREMIUM_LOCAL_DIR = "public/images/vods";

const ALLOWED_IMAGE_DOMAINS = [
  "res.cloudinary.com",
  "image.tmdb.org",
  "themoviedb.org",
  "assets.fanart.tv"
];

const TIPOS_BANNER_VALIDOS = ["horizontal", "vertical"];

async function fileExists(p) {
  try { await fsPromises.access(p); return true; } catch { return false; }
}

function validarURL(url) {
  if (!url || typeof url !== "string") return false;
  if (url.startsWith("file://")) return false;
  if (!validator.isURL(url, { protocols: ["http", "https"], require_protocol: true })) return false;
  try {
    const u = new URL(url);
    return ALLOWED_IMAGE_DOMAINS.some(domain => u.hostname === domain || u.hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

function buildTMDBUrl(endpoint, params = {}) {
  const base = "https://api.themoviedb.org/3";
  const url = new URL(base + endpoint);
  url.searchParams.set("api_key", process.env.TMDB_KEY);
  if (!("language" in params)) {
    url.searchParams.set("language", "pt-BR");
  }
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  });
  return url.toString();
}

async function fetchWithTimeout(url, options = {}, timeout = 10000) {
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), timeout);
  try {
    const resp = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(to);
    return resp;
  } catch (err) {
    clearTimeout(to);
    if (err.name === "AbortError") throw new Error("Timeout ao acessar recurso externo");
    throw err;
  }
}

async function fetchBuffer(url, useCache = true) {
  if (!url) throw new Error("URL de imagem ausente");
  if (!validarURL(url)) throw new Error(`URL não permitida: ${url}`);

  if (useCache) {
    const cached = imageCache.get(url);
    if (cached) return cached;
  }

  const resp = await fetchWithTimeout(url, { headers: { "User-Agent": "OrionCreator/1.0" } }, 15000);
  if (!resp.ok) throw new Error(`Falha HTTP ${resp.status}`);

  const arrayBuf = await resp.arrayBuffer();
  const buffer = Buffer.from(arrayBuf);
  const meta = await sharp(buffer).metadata();
  if (!meta.format) throw new Error("Conteúdo não é imagem válida");
  const pngBuf = await sharp(buffer).png().toBuffer();

  if (useCache) imageCache.set(url, pngBuf);
  return pngBuf;
}

function wrapText(text, maxChars) {
  if (!text) return [];
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const w of words) {
    if ((current + " " + w).trim().length <= maxChars) {
      current = current ? current + " " + w : w;
    } else {
      if (current) lines.push(current);
      current = w;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 8);
}

function formatTime(minutes) {
  const m = parseInt(minutes, 10);
  if (isNaN(m) || m <= 0) return "";
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return h ? `${h}h ${mm}m` : `${mm}m`;
}

function safeXml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

app.get("/", async (req, res) => {
  const index = path.join(__dirname, "public", "index.html");
  if (await fileExists(index)) return res.sendFile(index);
  res.send(`
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<title>Orion Creator API</title>
<style>
body{font-family:Arial,sans-serif;background:#121212;color:#eee;margin:40px auto;max-width:760px;line-height:1.5}
h1{color:#8A2BE2}
code{background:#000;padding:2px 5px;border-radius:4px;color:#8A2BE2}
.endpoint{padding:10px;border-left:4px solid #8A2BE2;background:#1e1e1e;margin:8px 0;border-radius:6px}
.method{display:inline-block;font-size:11px;font-weight:bold;padding:2px 6px;border-radius:4px;background:#333;color:#fff;margin-right:8px}
.get{background:#2d7a2d}
.post{background:#0d5ca8}
</style>
</head>
<body>
<h1>🎬 Orion Creator API</h1>
<p>API para geração de banners de filmes e séries (TMDB + Fanart.tv)</p>
<div class="endpoint"><span class="method get">GET</span><code>/api/health</code> - Status</div>
<div class="endpoint"><span class="method get">GET</span><code>/api/cores</code> - Paleta de cores</div>
<div class="endpoint"><span class="method get">GET</span><code>/api/tmdb</code> - Home TMDB agregada</div>
<div class="endpoint"><span class="method get">GET</span><code>/api/tmdb/detalhes/:tipo/:id</code> - Detalhes (movie|tv)</div>
<div class="endpoint"><span class="method get">GET</span><code>/api/tmdb/detalhes/tv/:id/season/:num</code> - Temporada</div>
<div class="endpoint"><span class="method post">POST</span><code>/api/gerar-banner</code> - Gerar banner (auth)</div>
<div class="endpoint"><span class="method post">POST</span><code>/api/upload</code> - Upload (auth)</div>
<p>Versão: 2.8.0 (Premium + Exclusive Ajustado)</p>
</body>
</html>
  `);
});

app.get("/api/tmdb", tmdbLimiter, async (req, res) => {
  try {
    const { query, tipo } = req.query;
    if (query) {
      const cacheKey = `search_${tipo || "movie"}_${query}`;
      const cached = tmdbCache.get(cacheKey);
      if (cached) return res.json(cached);
      const results = await buscarTMDB(query, tipo || "movie");
      tmdbCache.set(cacheKey, results);
      return res.json(results);
    }

    const homeKey = "tmdb_home_v2";
    const cachedHome = tmdbCache.get(homeKey);
    if (cachedHome) return res.json(cachedHome);

    const [l, fp, sp, t] = await Promise.allSettled([
      getLancamentos(),
      getFilmesPopulares(),
      getSeriesPopulares(),
      getTendencias()
    ]);

    const payload = {
      filmesLancamentos: l.status === "fulfilled" ? l.value?.filmes || [] : [],
      seriesLancamentos: l.status === "fulfilled" ? l.value?.series || [] : [],
      filmesPopulares: fp.status === "fulfilled" ? fp.value || [] : [],
      seriesPopulares: sp.status === "fulfilled" ? sp.value || [] : [],
      tendencias: t.status === "fulfilled" ? t.value || [] : []
    };
    tmdbCache.set(homeKey, payload);
    res.json(payload);
  } catch (err) {
    console.error("❌ /api/tmdb erro:", err.message);
    res.status(500).json({ error: "Erro ao buscar dados da TMDB" });
  }
});

app.get("/api/tmdb/detalhes/:tipo/:id", tmdbLimiter, async (req, res) => {
  const { tipo, id } = req.params;
  if (!["movie", "tv"].includes(tipo) || isNaN(id)) {
    return res.status(400).json({ error: "Parâmetros inválidos" });
  }
  try {
    const key = `det_${tipo}_${id}`;
    const cached = tmdbCache.get(key);
    if (cached) return res.json(cached);
    const url = buildTMDBUrl(`/${tipo}/${id}`, {
      append_to_response: "images,credits,release_dates"
    });
    const r = await fetchWithTimeout(url);
    if (!r.ok) {
      console.error("TMDB detalhes status:", r.status, url);
      return res.status(r.status).json({ error: "Item não encontrado" });
    }
    const json = await r.json();
    tmdbCache.set(key, json);
    res.json(json);
  } catch (err) {
    console.error("❌ Detalhes TMDB erro:", err.message);
    res.status(500).json({ error: "Erro ao buscar detalhes" });
  }
});

app.get("/api/tmdb/detalhes/tv/:id/season/:seasonNumber", tmdbLimiter, async (req, res) => {
  const { id, seasonNumber } = req.params;
  if (isNaN(id) || isNaN(seasonNumber)) {
    return res.status(400).json({ error: "Parâmetros inválidos" });
  }
  try {
    const key = `tv_season_${id}_${seasonNumber}`;
    const cached = tmdbCache.get(key);
    if (cached) return res.json(cached);
    const url = buildTMDBUrl(`/tv/${id}/season/${seasonNumber}`);
    const r = await fetchWithTimeout(url);
    if (!r.ok) {
      return res.status(r.status).json({ error: "Temporada não encontrada" });
    }
    const json = await r.json();
    tmdbCache.set(key, json);
    res.json(json);
  } catch (err) {
    console.error("❌ Temporada erro:", err.message);
    res.status(500).json({ error: "Erro ao buscar temporada" });
  }
});

app.get("/api/search", tmdbLimiter, async (req, res) => {
  const { q } = req.query;
  if (!q || q.trim().length < 2) {
    return res.status(400).json({ error: "Query muito curta (>=2)" });
  }
  try {
    const key = `multi_${q}`;
    const cached = tmdbCache.get(key);
    if (cached) return res.json(cached);
    const url = buildTMDBUrl("/search/multi", { query: q });
    const r = await fetchWithTimeout(url);
    const json = await r.json();
    tmdbCache.set(key, json);
    res.json(json);
  } catch (err) {
    console.error("❌ /api/search erro:", err.message);
    res.status(500).json({ error: "Erro na busca" });
  }
});

app.get("/api/vods", tmdbLimiter, async (req, res) => {
  try {
    const { q } = req.query;
    if (q) {
      const url = buildTMDBUrl("/search/multi", { query: q });
      const r = await fetchWithTimeout(url);
      const json = await r.json();
      return res.json(json);
    }
    const lanc = await getLancamentos();
    const arr = [];
    if (lanc?.filmes) arr.push(...lanc.filmes);
    if (lanc?.series) arr.push(...lanc.series);
    res.json({ results: arr.slice(0, 20) });
  } catch (err) {
    console.error("❌ /api/vods erro:", err.message);
    res.status(500).json({ error: "Erro ao buscar VODs" });
  }
});

app.post("/api/upload", verificarAuth, uploadLimiter, upload.single("file"), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Nenhum arquivo enviado" });
    res.json({
      url: req.file.path || req.file.url,
      filename: req.file.filename,
      size: req.file.size
    });
  } catch (err) {
    console.error("❌ Upload erro:", err.message);
    res.status(500).json({ error: "Erro no upload" });
  }
});

// =====================================================================
// /api/gerar-banner
// =====================================================================
app.post("/api/gerar-banner", verificarAuth, bannerLimiter, async (req, res) => {
  try {
    const {
      tipo,
      modeloCor,
      posterUrl,
      titulo,
      sinopse,
      genero,
      ano,
      duracao,
      nota,
      tmdbId,
      tmdbTipo,
      modeloTipo,
      backdropUrl,
      temporada
    } = req.body || {};

    // LOG COMPLETO PARA DIAGNÓSTICO
    console.log('📥 req.body recebido:', JSON.stringify(req.body, null, 2));
    console.log(`➡️ posterUrl="${posterUrl}", modeloTipo="${modeloTipo}", tipo="${tipo}"`);

    if (!posterUrl) {
      console.error('❌ posterUrl está vazio ou undefined!');
      return res.status(400).json({ error: "posterUrl obrigatório" });
    }
    if (!validarURL(posterUrl)) return res.status(400).json({ error: "posterUrl inválida" });
    if (!titulo || !titulo.trim()) return res.status(400).json({ error: "Título obrigatório" });
    if (titulo.length > 100) return res.status(400).json({ error: "Título excede 100 caracteres" });
    if (backdropUrl && !validarURL(backdropUrl)) return res.status(400).json({ error: "backdropUrl inválida" });

    const tipoNorm = (tipo || "vertical").toLowerCase();
    if (!TIPOS_BANNER_VALIDOS.includes(tipoNorm)) {
      return res.status(400).json({ error: "Tipo deve ser horizontal ou vertical" });
    }

    const corKey = (modeloCor || "ROXO").toUpperCase();
    if (!COLORS[corKey]) {
      return res.status(400).json({ error: `Cor inválida. Opções: ${Object.keys(COLORS).join(", ")}` });
    }
    const corConfig = COLORS[corKey];

    const isPremium = modeloTipo === "ORION_PREMIUM" || modeloTipo === "PADRAO";
    const isExclusive = modeloTipo === "ORION_EXCLUSIVO";
    const isOrionX = modeloTipo === "ORION_X";
    
    // Dimensões específicas por modelo
    let width, height;
    if (isOrionX) {
      width = 1080;
      height = 1540;
    } else {
      width = tipoNorm === "horizontal" ? 1920 : 1080;
      height = tipoNorm === "horizontal" ? 1080 : 1920;
    }
    const isOrionExclusivoVertical = isExclusive && tipoNorm === "vertical";

    console.log(`📊 Gerando banner: tipo=${tipoNorm}, modelo=${modeloTipo}, cor=${corKey}, ExclusivoVertical=${isOrionExclusivoVertical}, OrionX=${isOrionX}`);

    // --- Ajuste ano/nota para temporada ---
    let anoFinal = ano;
    let notaFinal = nota;
    if (tmdbTipo === "tv" && tmdbId && temporada) {
      try {
        const seasonUrl = buildTMDBUrl(`/tv/${tmdbId}/season/${temporada}`);
        const rs = await fetchWithTimeout(seasonUrl);
        if (rs.ok) {
          const seasonData = await rs.json();
          if (seasonData.air_date) anoFinal = seasonData.air_date.slice(0, 4);
          if (seasonData.vote_average && seasonData.vote_average > 0) {
            notaFinal = seasonData.vote_average;
          } else if (seasonData.episodes?.length) {
            const avg = seasonData.episodes.reduce((acc, ep) => acc + (ep.vote_average || 0), 0) / seasonData.episodes.length;
            if (avg > 0) notaFinal = avg;
          }
        }
      } catch (err) {
        console.warn("⚠️ Falha ao buscar dados da temporada:", err.message);
      }
    }

    // --- Logo / título limpo ---
    let logoFanartBuffer = null;
    let fanartTitle = null;
    
    // ==================== ORION X: LOGO TMDB ====================
    if (tmdbId && isOrionX) {
      console.log("🔥 Orion X: Buscando logo TMDB...");
      try {
        const imgsUrl = buildTMDBUrl(`/${tmdbTipo || "movie"}/${tmdbId}/images`, {
          include_image_language: "pt-BR,pt-br,pt,en,null"
        });
        const imgsResp = await fetchWithTimeout(imgsUrl);
        if (imgsResp.ok) {
          const imgsData = await imgsResp.json();
          const logos = imgsData.logos || [];
          const pickByLang = (langs) =>
            logos.find(l => langs.includes(l.iso_639_1 || "null"));
          const chosenLogo =
            pickByLang(["pt-BR", "pt-br"]) ||
            pickByLang(["pt"]) ||
            pickByLang(["en"]) ||
            logos[0];
          if (chosenLogo && chosenLogo.file_path) {
            const logoUrl = `https://image.tmdb.org/t/p/original${chosenLogo.file_path}`;
            if (validarURL(logoUrl)) {
              logoFanartBuffer = await fetchBuffer(logoUrl, true);
              console.log("✅ Orion X: Logo TMDB carregada!");
            }
          }
        }
      } catch (err) {
        console.warn("⚠️ Orion X: Logo TMDB não obtida:", err.message);
      }

      // Fallback para Fanart se não achou no TMDB
      if (!logoFanartBuffer) {
        try {
          let logoUrl = null;
          if (tmdbTipo === "movie") {
            logoUrl = await fanartService.getMovieLogo(tmdbId, "pt-BR");
            if (!logoUrl) logoUrl = await fanartService.getMovieLogo(tmdbId, "en");
          } else if (tmdbTipo === "tv") {
            const tvdbId = await fanartService.getTVDBIdFromTMDB(tmdbId, process.env.TMDB_KEY);
            if (tvdbId) {
              logoUrl = await fanartService.getTVLogo(tvdbId, "pt-BR");
              if (!logoUrl) logoUrl = await fanartService.getTVLogo(tvdbId, "en");
            }
          }
          if (logoUrl && validarURL(logoUrl)) {
            logoFanartBuffer = await fetchBuffer(logoUrl, true);
            console.log("✅ Orion X: Logo Fanart carregada!");
          }
        } catch (err) {
          console.warn("⚠️ Orion X: Logo Fanart não obtida:", err.message);
        }
      }
    }

    // ==================== EXCLUSIVE: LOGO TMDB/FANART ====================
    if (tmdbId && isExclusive) {
      // 1) Tentar logo do TMDB (priorizando PT-BR)
      try {
        const imgsUrl = buildTMDBUrl(`/${tmdbTipo || "movie"}/${tmdbId}/images`, {
          include_image_language: "pt-BR,pt-br,pt,en,null"
        });
        const imgsResp = await fetchWithTimeout(imgsUrl);
        if (imgsResp.ok) {
          const imgsData = await imgsResp.json();
          const logos = imgsData.logos || [];
          const pickByLang = (langs) =>
            logos.find(l => langs.includes(l.iso_639_1 || "null"));
          const chosenLogo =
            pickByLang(["pt-BR", "pt-br"]) ||
            pickByLang(["pt"]) ||
            pickByLang(["en"]) ||
            logos[0];
          if (chosenLogo && chosenLogo.file_path) {
            const logoUrl = `https://image.tmdb.org/t/p/original${chosenLogo.file_path}`;
            if (validarURL(logoUrl)) {
              logoFanartBuffer = await fetchBuffer(logoUrl, true);
            }
          }
        }
      } catch (err) {
        console.warn("⚠️ Logo TMDB não obtida para Exclusive:", err.message);
      }

      // 2) Se não achou logo válida no TMDB, tentar Fanart (também priorizando PT-BR)
      if (!logoFanartBuffer) {
        try {
          let logoUrl = null;
          if (tmdbTipo === "movie") {
            logoUrl = await fanartService.getMovieLogo(tmdbId, "pt-BR");
            if (!logoUrl) logoUrl = await fanartService.getMovieLogo(tmdbId, "pt-br");
            if (!logoUrl) logoUrl = await fanartService.getMovieLogo(tmdbId, "pt");
            if (!logoUrl) logoUrl = await fanartService.getMovieLogo(tmdbId, "en");
          } else if (tmdbTipo === "tv") {
            const tvdbId = await fanartService.getTVDBIdFromTMDB(tmdbId, process.env.TMDB_KEY);
            if (tvdbId) {
              logoUrl = await fanartService.getTVLogo(tvdbId, "pt-BR");
              if (!logoUrl) logoUrl = await fanartService.getTVLogo(tvdbId, "pt-br");
              if (!logoUrl) logoUrl = await fanartService.getTVLogo(tvdbId, "pt");
              if (!logoUrl) logoUrl = await fanartService.getTVLogo(tvdbId, "en");
            }
          }
          if (logoUrl && validarURL(logoUrl)) {
            logoFanartBuffer = await fetchBuffer(logoUrl, true);
            try {
              fanartTitle = await fanartService.getCleanTitle(tmdbId, tmdbTipo);
            } catch {}
          }
        } catch (err) {
          console.warn("⚠️ Logo Fanart não obtida:", err.message);
        }
      }
    }

    // --- Backdrop ---
    async function obterBackdrop() {
      if (backdropUrl && validarURL(backdropUrl)) return backdropUrl;
      if (!tmdbId) return null;
      try {
        const imgUrl = buildTMDBUrl(`/${tmdbTipo || "movie"}/${tmdbId}/images`, { include_image_language: "null" });
        const r = await fetchWithTimeout(imgUrl);
        if (r.ok) {
          const json = await r.json();
          const first = json.backdrops?.[0]?.file_path;
          if (first) return `https://image.tmdb.org/t/p/original${first}`;
        }
      } catch {
        return null;
      }
      return null;
    }

    const backdropFinalUrl = await obterBackdrop();

    let backgroundBuffer;
    if (backdropFinalUrl) {
      try {
        const raw = await fetchBuffer(backdropFinalUrl);
        backgroundBuffer = await sharp(raw).resize(width, height, { fit: "cover" }).toBuffer();
      } catch {
        backgroundBuffer = await sharp({
          create: { width, height, channels: 4, background: { r: 15, g: 15, b: 25, alpha: 1 } }
        }).png().toBuffer();
      }
    } else {
      backgroundBuffer = await sharp({
        create: { width, height, channels: 4, background: { r: 18, g: 18, b: 28, alpha: 1 } }
      }).png().toBuffer();
    }

    // Premium: aplica blur/sombra no backdrop
    if (isPremium) {
      backgroundBuffer = await sharp(backgroundBuffer)
        .blur(5)
        .modulate({ brightness: 0.75 })
        .toBuffer();
    }

    // Orion X (Bellatrix): aplica blur leve e escurecimento no background
    if (isOrionX) {
      backgroundBuffer = await sharp(backgroundBuffer)
        .blur(6)
        .modulate({ brightness: 0.65 })
        .toBuffer();
    }

    // --- Overlay de cor ---
    let overlayColorBuffer = null;

    if (isPremium) {
      let overlayOk = false;
      const premiumUrl = PREMIUM_OVERLAYS[corKey];
      if (premiumUrl && validarURL(premiumUrl)) {
        try {
          console.log(`🎨 Overlay Premium Cloudinary (${corKey})...`);
        const premiumBuffer = await fetchBuffer(premiumUrl, true);
          overlayColorBuffer = await sharp(premiumBuffer)
            .resize(width, height, { fit: "cover" })
            .png()
            .toBuffer();
          overlayOk = true;
        } catch (err) {
          console.warn(`⚠️ Falha overlay Premium Cloudinary ${corKey}:`, err.message);
        }
      }
      if (!overlayOk) {
        const localDir = path.join(__dirname, PREMIUM_LOCAL_DIR);
        const corLower = corKey.toLowerCase();
        const localCandidates = [
          path.join(localDir, `premium_${corLower}.png`),
          path.join(localDir, `premium-${corLower}.png`),
          path.join(localDir, `${corLower}.png`)
        ];
        for (const p of localCandidates) {
          if (await fileExists(p)) {
            try {
              console.log(`🎨 Overlay Premium local (${p})...`);
              const localBuf = await fsPromises.readFile(p);
              overlayColorBuffer = await sharp(localBuf)
                .resize(width, height, { fit: "cover" })
                .png()
                .toBuffer();
              overlayOk = true;
              break;
            } catch (err) {
              console.warn("⚠️ Erro overlay Premium local:", err.message);
            }
          }
        }
      }
    }

    // Orion X: overlay da pasta modelo3 (VERIFICAR PRIMEIRO)
    if (isOrionX && !overlayColorBuffer) {
      const overlayFilename = ORION_X_OVERLAYS[corKey] || ORION_X_OVERLAYS.PRETO;
      const modelo3Dir = path.join(__dirname, "public", "images", "modelo3");
      const overlayPath = path.join(modelo3Dir, overlayFilename);
      
      console.log(`🔍 Orion X: Tentando carregar overlay - Cor: ${corKey}, Arquivo: ${overlayFilename}, Path: ${overlayPath}`);
      
      if (await fileExists(overlayPath)) {
        try {
          console.log(`🎨 Overlay Orion X local (${corKey} - ${overlayFilename})...`);
          const localBuf = await fsPromises.readFile(overlayPath);
          overlayColorBuffer = await sharp(localBuf)
            .resize(width, height)
            .png()
            .toBuffer();
          console.log(`✅ Overlay Orion X carregado com sucesso!`);
        } catch (err) {
          console.warn("⚠️ Erro overlay Orion X local:", err.message);
        }
      } else {
        console.warn(`❌ Arquivo overlay Orion X não encontrado: ${overlayPath}`);
      }
    }

    if (isExclusive && !overlayColorBuffer) {
      const corLower = corKey.toLowerCase();
      const modelo2Dir = path.join(__dirname, "public", "images", "modelo2");
      const tryLocalPaths = [
        path.join(modelo2Dir, `vertical_${corLower}.png`),
        path.join(modelo2Dir, `vertical-${corLower}.png`)
      ];
      for (const p of tryLocalPaths) {
        if (await fileExists(p)) {
          try {
            console.log(`🎨 Overlay Exclusive local (${corKey})...`);
            const localBuf = await fsPromises.readFile(p);
            overlayColorBuffer = await sharp(localBuf)
              .resize(width, height)
              .png()
              .toBuffer();
            break;
          } catch (err) {
            console.warn("⚠️ Erro overlay Exclusive local:", err.message);
          }
        }
      }
    }

    // --- Poster (Exclusive tenta poster FANART limpo, depois TMDB limpo;
    //             Premium usa sempre TMDB, preferindo poster limpo/sem título em PT) ---
    let effectivePosterUrl = posterUrl;
    if (tmdbId) {
      const endpointBase = tmdbTipo === "tv" ? `/tv/${tmdbId}/images` : `/movie/${tmdbId}/images`;
      const urlImgs = buildTMDBUrl(endpointBase, { include_image_language: "pt-BR,pt-br,pt,en,null" });

      // Função auxiliar para escolher poster limpo/sem título, priorizando sempre PT-BR primeiro.
      const escolherPosterTMDB = async () => {
        const r = await fetchWithTimeout(urlImgs);
        if (!r.ok) return null;
        const imgs = await r.json();
        const posters = imgs.posters || [];
        if (!posters.length) return null;

        const byLang = (langs) =>
          posters.filter(p => langs.includes(p.iso_639_1 || "null"));
        // Priorizar idiomas PT-BR > PT > EN > qualquer.
        let candidatos = byLang(["pt-BR", "pt-br"]);
        if (!candidatos.length) candidatos = byLang(["pt"]);
        if (!candidatos.length) candidatos = byLang(["en"]);
        if (!candidatos.length) candidatos = posters;

        const preferClean =
          candidatos.find(p => /clean|no[-_ ]?text/i.test(p.file_path || "")) ||
          candidatos.find(p => /keyart|artwork/i.test(p.file_path || "")) ||
          candidatos[0];

        return preferClean && preferClean.file_path
          ? `https://image.tmdb.org/t/p/original${preferClean.file_path}`
          : null;
      };

      if (isExclusive) {
        try {
          // 1) Primeiro tenta poster do TMDB em PT-BR/PT
          const tmdbPoster = await escolherPosterTMDB();
          if (tmdbPoster && validarURL(tmdbPoster)) {
            effectivePosterUrl = tmdbPoster;
          } else {
            // 2) Se não houver poster adequado no TMDB, tenta Fanart (priorizando PT-BR)
            let fanartPosterUrl = null;
            if (tmdbTipo === "movie") {
              fanartPosterUrl = await fanartService.getMoviePoster(tmdbId, "pt-BR");
              if (!fanartPosterUrl) fanartPosterUrl = await fanartService.getMoviePoster(tmdbId, "pt-br");
              if (!fanartPosterUrl) fanartPosterUrl = await fanartService.getMoviePoster(tmdbId, "pt");
              if (!fanartPosterUrl) fanartPosterUrl = await fanartService.getMoviePoster(tmdbId, "en");
            } else if (tmdbTipo === "tv") {
              const tvdbId = await fanartService.getTVDBIdFromTMDB(tmdbId, process.env.TMDB_KEY);
              if (tvdbId) {
                fanartPosterUrl = await fanartService.getTVPoster(tvdbId, "pt-BR");
                if (!fanartPosterUrl) fanartPosterUrl = await fanartService.getTVPoster(tvdbId, "pt-br");
                if (!fanartPosterUrl) fanartPosterUrl = await fanartService.getTVPoster(tvdbId, "pt");
                if (!fanartPosterUrl) fanartPosterUrl = await fanartService.getTVPoster(tvdbId, "en");
              }
            }
            if (fanartPosterUrl && validarURL(fanartPosterUrl)) {
              effectivePosterUrl = fanartPosterUrl;
            }
          }
        } catch (err) {
          console.warn("⚠️ Falha ao buscar poster limpo para Exclusive:", err.message);
        }
      } else if (isPremium) {
        try {
          const tmdbPoster = await escolherPosterTMDB();
          if (tmdbPoster && validarURL(tmdbPoster)) {
            effectivePosterUrl = tmdbPoster;
          }
        } catch (err) {
          console.warn("⚠️ Falha ao buscar poster limpo para Premium:", err.message);
        }
      }
    }

    const posterOriginal = await fetchBuffer(effectivePosterUrl);
    let pW, pH, pLeft, pTop, posterResized;

// ========= AJUSTE EXCLUSIVO VERTICAL (CORRIGIDO + deslocamentos) =========
let titleY, synopseStartY, metaY;  // Definir variáveis no início

// Definir linhas ANTES de usar
let wrapLimit, maxLines;
if (isOrionX) {
  wrapLimit = 32;  // Limite maior para sinopse mais longa
  maxLines = 12;     // Máximo 12 linhas - tem espaço para mais conteúdo
} else if (isOrionExclusivoVertical) {
  wrapLimit = 55;
  maxLines = 7;
} else {
  wrapLimit = tipoNorm === "horizontal" ? 45 : 55;
  maxLines = 6;
}
const linhas = wrapText(sinopse || "", wrapLimit).slice(0, maxLines);

// Fontes sinopse: negrito com leve sombra
let synopFontSize, lineHeight;
if (isOrionX) {
  // ORION X (1080x1540): sinopses pequenas ficam maiores, grandes se ajustam
  if (linhas.length <= 2) { synopFontSize = 38; lineHeight = 48; }  // Bem maior para sinopses curtas
  else if (linhas.length <= 3) { synopFontSize = 34; lineHeight = 44; }
  else if (linhas.length <= 5) { synopFontSize = 30; lineHeight = 40; }
  else if (linhas.length <= 7) { synopFontSize = 28; lineHeight = 38; }
  else if (linhas.length <= 9) { synopFontSize = 26; lineHeight = 36; }
  else { synopFontSize = 24; lineHeight = 34; }  // Menor para sinopses muito longas
} else if (tipoNorm === "horizontal") {
  if (linhas.length <= 2) { synopFontSize = 46; lineHeight = 62; }
  else if (linhas.length <= 3) { synopFontSize = 44; lineHeight = 58; }
  else if (linhas.length <= 4) { synopFontSize = 40; lineHeight = 54; }
  else { synopFontSize = 36; lineHeight = 48; }
} else {
  // ORION_EXCLUSIVO vertical (Betelgeuse): sinopses pequenas maiores, grandes se ajustam
  if (isOrionExclusivoVertical) {
    if (linhas.length <= 2) { synopFontSize = 46; lineHeight = 60; }  // Bem maior para sinopses curtas
    else if (linhas.length <= 3) { synopFontSize = 42; lineHeight = 56; }
    else if (linhas.length <= 4) { synopFontSize = 38; lineHeight = 52; }
    else if (linhas.length <= 5) { synopFontSize = 36; lineHeight = 50; }
    // 6–7 linhas: fonte menor para não quebrar o layout
    else { synopFontSize = 34; lineHeight = 48; }
  } else {
    if (linhas.length <= 2) { synopFontSize = 42; lineHeight = 58; }
    else if (linhas.length <= 3) { synopFontSize = 40; lineHeight = 56; }
    else if (linhas.length <= 4) { synopFontSize = 38; lineHeight = 52; }
    else if (linhas.length <= 5) { synopFontSize = 34; lineHeight = 48; }
    else { synopFontSize = 30; lineHeight = 44; }
  }
}

let titleFontSize;
if (isOrionX) {
  // Título para ORION_X (formato 1080x1540)
  titleFontSize =
    titulo.length <= 22 ? 90 :
    titulo.length <= 36 ? 75 :
    65;
} else if (isOrionExclusivoVertical) {
  // Título maior para ORION_EXCLUSIVO
  titleFontSize =
    titulo.length <= 22 ? 125 :
    titulo.length <= 36 ? 105 :
    88;
} else {
  titleFontSize =
    titulo.length <= 22 ? (tipoNorm === "horizontal" ? 55 : 50) :
    titulo.length <= 36 ? (tipoNorm === "horizontal" ? 48 : 40) :
    (tipoNorm === "horizontal" ? 40 : 34);
}

const notaFmt = notaFinal ? parseFloat(notaFinal).toFixed(1) : "N/A";
const durFmt = formatTime(duracao) || duracao || "";

// Meta sem o ícone de estrela (a estrela dourada é desenhada via SVG)
let metaString = `${notaFmt} | ${anoFinal || ""} | ${genero || ""} | ${durFmt}`;
let metaStringLine2 = "";

// Quebrar linha apenas se o texto for muito longo (mais de 35 caracteres) ou for série
if (metaString.length > 35 || (tmdbTipo === "tv" && temporada)) {
  if (tmdbTipo === "tv" && temporada) {
    metaString = `Temporada ${temporada} - ${notaFmt}`;
    metaStringLine2 = `${anoFinal || ""} | ${genero || ""}`;
  } else {
    metaString = `${notaFmt} | ${anoFinal || ""} | ${genero || ""}`;
    metaStringLine2 = durFmt || "";
  }
}

// Cor dos metadados: branco para Exclusive e Orion X
const metaColor = (isExclusive || isOrionX) ? "#ffffff" : corConfig.hex;
// Metadados ajustados por modelo
const metaFontSize = isOrionX ? 24 : (isOrionExclusivoVertical ? 34 : (tipoNorm === "horizontal" ? 26 : 29));

if (isOrionX) {
  // ========= LAYOUT ORION X (1080x1540) =========
  // Logo centralizada no topo, poster menor à esquerda, texto à direita
  
  // Poster maior à esquerda (42% da largura)
  pW = Math.round(width * 0.42);
  pH = Math.round(pW * 1.5);
  pLeft = 83;  // Ajustado para direita
  pTop = 420;   // Mais descido ainda para encaixar na moldura

  // Criar poster com bordas arredondadas
  const posterBase = await sharp(posterOriginal)
    .resize(pW, pH, { fit: "cover", position: "center" })
    .png()
    .toBuffer();

  const radius = 25;  // Raio das bordas arredondadas
  
  // Criar máscara com bordas arredondadas
  const roundedCorner = Buffer.from(`
    <svg width="${pW}" height="${pH}">
      <rect x="0" y="0" width="${pW}" height="${pH}" rx="${radius}" ry="${radius}" fill="white"/>
    </svg>
  `);

  // Aplicar bordas arredondadas
  const posterRounded = await sharp(posterBase)
    .composite([{ input: roundedCorner, blend: "dest-in" }])
    .png()
    .toBuffer();
  
  // Criar sombra SVG como overlay separado (mesmo tamanho do poster)
  const shadowOverlay = Buffer.from(`
    <svg width="${pW}" height="${pH}">
      <defs>
        <filter id="dropshadow" height="130%">
          <feGaussianBlur in="SourceAlpha" stdDeviation="6"/>
          <feOffset dx="3" dy="5" result="offsetblur"/>
          <feComponentTransfer>
            <feFuncA type="linear" slope="0.5"/>
          </feComponentTransfer>
          <feMerge>
            <feMergeNode/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      </defs>
      <rect x="0" y="0" width="${pW}" height="${pH}" rx="${radius}" ry="${radius}" fill="rgba(0,0,0,0)" filter="url(#dropshadow)"/>
    </svg>
  `);
  
  // Adicionar efeito de sombra ao poster arredondado
  posterResized = await sharp(posterRounded)
    .composite([{ input: shadowOverlay, blend: "over" }])
    .png()
    .toBuffer();

  // Logo/título no topo centralizado (será posicionado depois)
  titleY = 80;  // Logo no topo
  
  // Sinopse à direita do poster (começa na mesma altura do poster, mais descida)
  synopseStartY = pTop + 60;
  
  // Metadados abaixo da sinopse (mas ainda acima do final do poster)
  metaY = synopseStartY + (linhas.length * lineHeight) + 40;

} else if (isOrionExclusivoVertical) {
  // Layout do ORION_EXCLUSIVO vertical sem frame de celular (celular já embutido no overlay)
  // Poster centralizado, com cantos arredondados
  // Leve redução na largura para "encolher" um pouco o lado direito
  pW = Math.round(width * 0.58);
  pH = Math.round(pW * 1.7);
  pLeft = Math.round((width - pW) / 2) - 4;
  pTop = 220;

  const posterBase = await sharp(posterOriginal)
    .resize(pW, pH, { fit: "cover", position: "center" })
    .png()
    .toBuffer();

  const radius = 70;
  const roundedCorner = Buffer.from(`
    <svg width="${pW}" height="${pH}">
      <rect x="0" y="0" width="${pW}" height="${pH}" rx="${radius}" ry="${radius}"/>
    </svg>
  `);

  posterResized = await sharp(posterBase)
    .composite([{ input: roundedCorner, blend: "dest-in" }])
    .png()
    .toBuffer();

  // Ajustes de texto para Orion Exclusivo Vertical - alinhado ao poster
  // Calcula baseado na parte inferior do poster
  const posterBottom = pTop + pH;
  // Título/logotipo um pouco abaixo do poster
  titleY = posterBottom + 90;

  // Posição base da sinopse/metadados
  let baseSynopseY = titleY + 55;
  let baseMetaY = baseSynopseY + (linhas.length * lineHeight);

  // Se a sinopse for curta, desce um pouco o conjunto sinopse+meta para não ficar colado no título.
  if (linhas.length <= 3) {
    const extra = 40;
    baseSynopseY += extra;
    baseMetaY += extra;
  } else if (linhas.length <= 5) {
    const extra = 20;
    baseSynopseY += extra;
    baseMetaY += extra;
  }

  synopseStartY = baseSynopseY;
  metaY = baseMetaY;

} else {
  console.log("DEBUG: CAIU NO BLOCO ELSE (MODO PADRÃO/PREMIUM OU HORIZONTAL)");
  // Lógica padrão
  if (tipoNorm === "horizontal") {
    pW = isPremium || isExclusive ? 560 : Math.round(width * 0.32);
    pH = Math.round(pW * 1.58);
    pLeft = isPremium || isExclusive ? 160 : Math.round((width - pW) / 2);
    pTop = Math.round((height - pH) / 2) - 153;
  } else {
    pW = Math.round(width * 0.5);
    pH = Math.round(pW * 1.58);
    pLeft = Math.round((width - pW) / 2);
    pTop = 193;
  }

  posterResized = await sharp(posterOriginal)
    .resize(pW, pH, { fit: "cover" })
    .png()
    .toBuffer();

  // Bloco else para texto padrão
  const spaceAfterPoster = tipoNorm === "horizontal" ? 190 : 230;
  const titleMargin = tipoNorm === "horizontal" ? 50 : 65;
  const spaceAfterTitle = tipoNorm === "horizontal" ? 45 : 55;

  const startY = pTop + pH + spaceAfterPoster;

  titleY = startY + titleMargin;
  synopseStartY = titleY + spaceAfterTitle;
  metaY = synopseStartY + (linhas.length * lineHeight) + 20;
}

// Definir textX e textAnchor DEPOIS dos blocos de layout (quando pW e pLeft já estão definidos)
const textX = isOrionX ? (pLeft + pW + 70) : (tipoNorm === "horizontal" ? pLeft + pW + 40 : Math.round(width / 2));
const textAnchor = isOrionX ? "start" : (tipoNorm === "horizontal" ? "start" : "middle");

    // Logo acima
    let logoFanartLayer = null;
    if (logoFanartBuffer) {
      try {
        // Logo Fanart: garantir que nunca ultrapasse o tamanho do banner
        const maxLogoWVertical = Math.round(width * 0.9);  // no máximo 90% da largura do banner
        const maxLogoHVertical = 420;

        const logoMaxW =
          isOrionX
            ? Math.round(width * 0.85)
            : (tipoNorm === "horizontal"
              ? 1000
              : Math.min(isOrionExclusivoVertical ? maxLogoWVertical : 1200, maxLogoWVertical));

        const logoMaxH =
          isOrionX
            ? 280
            : (tipoNorm === "horizontal"
              ? 300
              : (isOrionExclusivoVertical ? maxLogoHVertical : 360));

        const logoProcessed = await sharp(logoFanartBuffer)
          .resize(logoMaxW, logoMaxH, { fit: "inside" })
          .png()
          .toBuffer();

        const { width: lw, height: lh } = await sharp(logoProcessed).metadata();
        // Logo centralizada para Orion X
        const logoX = isOrionX ? Math.round((width - lw) / 2) : (tipoNorm === "horizontal" ? textX : Math.round((width - lw) / 2));

        let logoY;
        if (isOrionX) {
          // Logo TMDB centralizada no topo (formato 1080x1540)
          logoY = 60;
        } else if (isOrionExclusivoVertical) {
          // Logo levemente mais próxima do título, mas um pouco mais alta no layout
          logoY = titleY - lh - 20;
        } else {
          logoY = synopseStartY - lh - 270;
        }

        logoFanartLayer = { input: logoProcessed, top: Math.round(logoY), left: logoX };

      } catch (err) {
        console.warn("Logo Fanart layer erro:", err.message);
      }
    }

    const exclusiveTitleValue = fanartTitle || titulo;
    const titleTextValue = isExclusive ? exclusiveTitleValue : titulo;
    const shouldDrawTitleText = isPremium || !logoFanartLayer;
    
    // Quando não há logo oficial nos modelos exclusivos, centralizar título onde seria a logo
    let finalTitleTextY = titleY;
    let finalTitleTextX = textX;
    let finalTitleAnchor = textAnchor;
    let adjustedTitleFontSize = titleFontSize;
    
    if ((isOrionX || isOrionExclusivoVertical) && !logoFanartLayer) {
      // Centralizar título horizontalmente
      finalTitleTextX = Math.round(width / 2);
      finalTitleAnchor = "middle";
      
      // Posicionar na região da logo
      if (isOrionX) {
        finalTitleTextY = 280; // Centralizado verticalmente na região superior
      } else {
        // ORION_EXCLUSIVO: logo acima da sinopse (mesmo lugar que ficaria a logo oficial)
        finalTitleTextY = synopseStartY - 180;
      }
      
      // Tamanho dinâmico baseado no comprimento do título para não quebrar layout
      if (isOrionX) {
        adjustedTitleFontSize = 
          titulo.length <= 12 ? 75 :
          titulo.length <= 18 ? 62 :
          titulo.length <= 25 ? 52 :
          titulo.length <= 35 ? 44 :
          titulo.length <= 45 ? 38 :
          32;
      } else {
        adjustedTitleFontSize = 
          titulo.length <= 12 ? 95 :
          titulo.length <= 18 ? 82 :
          titulo.length <= 25 ? 68 :
          titulo.length <= 35 ? 56 :
          titulo.length <= 45 ? 48 :
          40;
      }
    }

    // Sombra leve e sinopse/meta em negrito
    const svgContent = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <filter id="dropShadow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="3"/>
            <feOffset dx="2" dy="2" result="offsetblur"/>
            <feFlood flood-color="#000000" flood-opacity="0.9"/>
            <feComposite in2="offsetblur" operator="in"/>
            <feMerge>
              <feMergeNode/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>
        <style>
          .title {
            fill: #ffffff;
            font-family: Arial, sans-serif;
            font-weight: 900;
            font-size: ${adjustedTitleFontSize}px;
            letter-spacing: -1px;
            filter: url(#dropShadow);
          }
          .synop {
            fill: #ffffff;
            font-family: "Segoe UI", Arial, sans-serif;
            font-weight: ${isOrionX ? '800' : '600'}; /* negrito forte para Orion X */
            font-size: ${synopFontSize}px;
            letter-spacing: 0.3px;
            filter: url(#dropShadow); /* leve sombra */
          }
          .meta {
            font-family: "Segoe UI", Arial, sans-serif;
            font-weight: 700;
            font-size: ${metaFontSize}px;
            letter-spacing: 1px;
            text-transform: uppercase;
            filter: url(#dropShadow);
          }
          .meta-star {
            fill: #ffc107; /* amarelo IMDB */
          }
          .meta-text {
            fill: ${metaColor};
          }
        </style>

        ${shouldDrawTitleText ? `
        <text x="${finalTitleTextX}" y="${finalTitleTextY}" text-anchor="${finalTitleAnchor}" class="title">
          ${safeXml(titleTextValue.toUpperCase())}
        </text>` : ""}

        ${linhas.map((line, i) => `
          <text x="${textX}" y="${synopseStartY + i * lineHeight}" text-anchor="${textAnchor}" class="synop">
            ${safeXml(line)}
          </text>
        `).join("")}

        <text x="${textX}" y="${metaY}" text-anchor="${textAnchor}" class="meta">
          ${(tmdbTipo === "tv" && temporada && metaStringLine2) ? `
            <tspan class="meta-text">${safeXml(metaString.split(' - ')[0])} - </tspan>
            <tspan class="meta-star">★ </tspan>
            <tspan class="meta-text">${safeXml(metaString.split(' - ')[1] || '')}</tspan>
          ` : `
            <tspan class="meta-star">★ </tspan>
            <tspan class="meta-text">${safeXml(metaString)}</tspan>
          `}
        </text>
        ${metaStringLine2 ? `
        <text x="${textX}" y="${metaY + metaFontSize + 8}" text-anchor="${textAnchor}" class="meta">
          <tspan class="meta-text">${safeXml(metaStringLine2)}</tspan>
        </text>
        ` : ''}

      </svg>
    `;
    const svgBuffer = Buffer.from(svgContent);

    // Logo do usuário
    let userLogoLayer = null;
    let userLogoFooterLayer = null;
    try {
      const userDoc = await db.collection("usuarios").doc(req.uid).get();
      const userLogo = userDoc.exists ? userDoc.data().logo : null;
      if (userLogo && validarURL(userLogo)) {
        let lb = await fetchBuffer(userLogo, false);
        
        if (isOrionX) {
          // Orion X: logo no canto inferior esquerdo com efeito de sombra
          const logoSize = 200; // Levemente menor
          lb = await sharp(lb)
            .resize(logoSize, logoSize, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .ensureAlpha()
            .png()
            .toBuffer();
          
          // Aplicar 95% de opacidade (5% de transparência) com efeito de sombra
          const logoWithEffect = Buffer.from(`
            <svg width="${logoSize}" height="${logoSize}">
              <defs>
                <filter id="logoShadow">
                  <feGaussianBlur in="SourceAlpha" stdDeviation="4"/>
                  <feOffset dx="2" dy="3" result="offsetblur"/>
                  <feComponentTransfer>
                    <feFuncA type="linear" slope="0.6"/>
                  </feComponentTransfer>
                  <feMerge>
                    <feMergeNode/>
                    <feMergeNode in="SourceGraphic"/>
                  </feMerge>
                </filter>
              </defs>
            </svg>
          `);
          
          lb = await sharp(lb)
            .composite([{
              input: Buffer.from(`
                <svg width="${logoSize}" height="${logoSize}">
                  <rect x="0" y="0" width="${logoSize}" height="${logoSize}" fill="white" opacity="0.95"/>
                </svg>
              `),
              blend: 'dest-in'
            }])
            .toBuffer();
          
          // Posicionar bem no canto inferior esquerdo
          const userLogoTop = height - logoSize - 30;
          const userLogoLeft = 30;
          userLogoLayer = { input: lb, top: userLogoTop, left: userLogoLeft };
        } else {
          // Outros modelos: posição padrão no canto superior direito
          lb = await sharp(lb).resize(180, 180, { fit: "contain" }).png().toBuffer();
          userLogoLayer = { input: lb, top: 40, left: width - 220 };
        }
        
        // Logo adicional para Orion X (Bellatrix): grande no rodapé com transparência (sem rotação)
        if (isOrionX) {
          const logoFooterSize = Math.round(width * 0.36); // 36% da largura (ainda maior)
          let lbFooter = await fetchBuffer(userLogo, false);
          lbFooter = await sharp(lbFooter)
            .resize(logoFooterSize, logoFooterSize, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .ensureAlpha()
            .toBuffer();
          
          // Aplicar 20% de opacidade (80% de transparência)
          lbFooter = await sharp(lbFooter)
            .composite([{
              input: Buffer.from([
                `<svg width="${logoFooterSize}" height="${logoFooterSize}">`,
                `<rect x="0" y="0" width="${logoFooterSize}" height="${logoFooterSize}" fill="white" opacity="0.2"/>`,
                `</svg>`
              ].join('')),
              blend: 'dest-in'
            }])
            .toBuffer();
          
          // Posicionar mais para baixo e mais à esquerda
          const footerTop = height - logoFooterSize - 150;  // Mais abaixo (200 → 150)
          const footerLeft = width - logoFooterSize - 160;  // Mais à esquerda (120 → 160)
          userLogoFooterLayer = { input: lbFooter, top: footerTop, left: footerLeft };
        }
      }
    } catch {}

    const layers = [];

    // Ordem das camadas:
    if (isOrionX && overlayColorBuffer) {
      // Orion X: logo translúcida primeiro (atrás de tudo), depois overlay, poster e logo principal POR CIMA
      if (userLogoFooterLayer) {
        layers.push(userLogoFooterLayer);
      }
      layers.push({ input: overlayColorBuffer, top: 0, left: 0 });
      layers.push({ input: posterResized, top: pTop, left: pLeft });
    } else if (isOrionExclusivoVertical && overlayColorBuffer) {
      // Exclusive: poster POR TRÁS do overlay (usa modelo2)
      layers.push({ input: posterResized, top: pTop, left: pLeft });
      layers.push({ input: overlayColorBuffer, top: 0, left: 0 });
    } else {
      // Premium / outros: overlay cobre backdrop e poster por cima
      if (overlayColorBuffer) {
        layers.push({ input: overlayColorBuffer, top: 0, left: 0 });
      }
      layers.push({ input: posterResized, top: pTop, left: pLeft });
    }

    if (logoFanartLayer) layers.push(logoFanartLayer);

    layers.push({ input: svgBuffer, top: 0, left: 0 });

    if (userLogoLayer) {
      // Logo principal (opaca) no canto superior direito
      layers.push(userLogoLayer);

      // Removidas as marcas d'água extras para deixar o layout mais limpo no modelo exclusivo
    }
    
    // Logo adicional translúcida já foi adicionada antes do overlay para Orion X

    const final = await sharp(backgroundBuffer)
      .composite(layers)
      .png({ quality: 95 })
      .toBuffer();

    const safeTitle = titulo.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 50);
    res.setHeader("Content-Disposition", `attachment; filename=banner_${safeTitle}.png`);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(final);

    console.log(`✅ Banner gerado: usuario=${req.uid} modelo=${modeloTipo || "PADRAO"} cor=${corKey} overlay=${!!overlayColorBuffer}`);
    
    // Salvar banner no Cloudinary e registro no Firestore (async, não bloqueia resposta)
    (async () => {
      try {
        console.log(`📤 Iniciando upload do banner para Cloudinary...`);
        
        // Upload do banner para o Cloudinary
        const uploadResult = await new Promise((resolve, reject) => {
          const uploadStream = cloudinary.uploader.upload_stream(
            {
              folder: 'banners_gerados',
              public_id: `banner_${req.uid}_${Date.now()}`,
              resource_type: 'image',
              format: 'png'
            },
            (error, result) => {
              if (error) reject(error);
              else resolve(result);
            }
          );
          uploadStream.end(final);
        });
        
        console.log(`☁️ Upload Cloudinary concluído: ${uploadResult.secure_url}`);
        
        // Calcular data de expiração (7 dias)
        const dataExpiracao = new Date();
        dataExpiracao.setDate(dataExpiracao.getDate() + 7);
        
        // Salvar registro no Firestore
        const docRef = await db.collection('banners').add({
          userId: req.uid,
          titulo: titulo,
          modeloCor: corKey,
          modeloTipo: modeloTipo || 'PADRAO',
          tipo: tipoNorm,
          tmdbId: tmdbId,
          tmdbTipo: tmdbTipo,
          temporada: temporada || null,
          posterUrl: posterUrl,
          bannerUrl: uploadResult.secure_url,
          cloudinaryPublicId: uploadResult.public_id,
          criadoEm: admin.firestore.FieldValue.serverTimestamp(),
          expiraEm: admin.firestore.Timestamp.fromDate(dataExpiracao)
        });
        
        console.log(`💾 Banner salvo no Firestore (ID: ${docRef.id})`);
        console.log(`✅ URL do banner: ${uploadResult.secure_url}`);
        console.log(`⏰ Expira em: ${dataExpiracao.toLocaleDateString('pt-BR')}`);
      } catch (saveErr) {
        console.error('❌ Erro ao salvar banner:', saveErr.message);
        console.error(saveErr.stack);
      }
    })();
  } catch (err) {
    console.error("❌ Erro gerar banner:", err.message);
    res.status(500).json({ error: "Falha ao gerar o banner", details: err.message });
  }
});

// =====================================================================
// ROTA: Buscar últimas criações do usuário
// =====================================================================

app.get("/api/ultimas-criacoes", verificarAuth, async (req, res) => {
  try {
    const agora = admin.firestore.Timestamp.now();
    
    // Buscar todos os banners do usuário SEM ordenação (evita necessidade de índice)
    const snapshot = await db.collection('banners')
      .where('userId', '==', req.uid)
      .get();
    
    const banners = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      // Filtrar apenas banners não expirados
      if (data.bannerUrl && data.expiraEm && data.expiraEm > agora) {
        banners.push({
          id: doc.id,
          titulo: data.titulo,
          modeloCor: data.modeloCor,
          modeloTipo: data.modeloTipo,
          tipo: data.tipo,
          tmdbId: data.tmdbId,
          tmdbTipo: data.tmdbTipo,
          temporada: data.temporada,
          posterUrl: data.posterUrl,
          thumbnailUrl: data.bannerUrl,
          bannerUrl: data.bannerUrl,
          criadoEm: data.criadoEm?.toDate().toISOString(),
          expiraEm: data.expiraEm?.toDate().toISOString(),
          criadoEmTimestamp: data.criadoEm?.toMillis() || 0
        });
      }
    });
    
    // Ordenar por data de criação no JavaScript (mais recentes primeiro)
    banners.sort((a, b) => b.criadoEmTimestamp - a.criadoEmTimestamp);
    
    // Limitar a 20 resultados
    res.json(banners.slice(0, 20));
  } catch (err) {
    console.error('❌ Erro ao buscar últimas criações:', err.message);
    res.status(500).json({ error: 'Erro ao buscar últimas criações' });
  }
});

// =====================================================================
// JOB: Limpeza automática de banners expirados
// =====================================================================

// Job de limpeza - executa a cada 1 hora
const cleanupJob = setInterval(async () => {
  try {
    const agora = admin.firestore.Timestamp.now();
    const snapshot = await db.collection('banners')
      .where('expiraEm', '<=', agora)
      .limit(100)
      .get();
    
    if (snapshot.empty) {
      console.log('🧹 Limpeza automática: Nenhum banner expirado');
      return;
    }
    
    console.log(`🧹 Limpando ${snapshot.size} banners expirados...`);
    
    const batch = db.batch();
    const deletePromises = [];
    
    snapshot.forEach(doc => {
      const data = doc.data();
      // Deletar do Cloudinary
      if (data.cloudinaryPublicId) {
        deletePromises.push(
          cloudinary.uploader.destroy(data.cloudinaryPublicId)
            .then(() => console.log(`☁️ Cloudinary: ${data.cloudinaryPublicId} deletado`))
            .catch(err => console.warn(`⚠️ Erro ao deletar do Cloudinary: ${err.message}`))
        );
      }
      // Deletar do Firestore
      batch.delete(doc.ref);
    });
    
    await Promise.all(deletePromises);
    await batch.commit();
    
    console.log(`✅ ${snapshot.size} banners expirados removidos (Cloudinary + Firestore)`);
  } catch (err) {
    console.error('❌ Erro na limpeza de banners:', err.message);
  }
}, 60 * 60 * 1000); // Executar a cada 1 hora

console.log('🤖 Job de limpeza automática iniciado (roda a cada 1 hora)');

// =====================================================================

app.get("/api/health", async (req, res) => {
  const result = {
    server: true,
    firebase: false,
    tmdb: false,
    fanart: false,
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  };
  try {
    await db.collection("usuarios").limit(1).get();
    result.firebase = true;
  } catch {}

  try {
    const r = await fetchWithTimeout(buildTMDBUrl("/movie/popular", { page: 1 }), {}, 6000);
    result.tmdb = r.ok;
  } catch {}

  try {
    const r = await fetchWithTimeout(`https://webservice.fanart.tv/v3/movies/550?api_key=${process.env.FANART_API_KEY}`, {}, 6000);
    result.fanart = r.ok || r.status === 404;
  } catch {}

  res.status(result.firebase && result.tmdb && result.fanart ? 200 : 503).json(result);
});

app.post("/api/cache/clear", verificarAuth, authLimiter, async (req, res) => {
  try {
    const doc = await db.collection("usuarios").doc(req.uid).get();
    const isAdmin = doc.exists && doc.data().isAdmin;
    if (!isAdmin) return res.status(403).json({ error: "Apenas administradores" });
    imageCache.clear();
    tmdbCache.clear();
    res.json({ cleared: true, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error("❌ Limpar cache erro:", err.message);
    res.status(500).json({ error: "Erro ao limpar cache" });
  }
});

app.get("/api/stats", verificarAuth, authLimiter, async (req, res) => {
  try {
    const doc = await db.collection("usuarios").doc(req.uid).get();
    const isAdmin = doc.exists && doc.data().isAdmin;
    if (!isAdmin) return res.status(403).json({ error: "Acesso negado" });
    res.json({
      cache: { imagens: imageCache.size, tmdb: tmdbCache.size },
      process: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        node: process.version,
        platform: process.platform
      },
      colors: Object.keys(COLORS),
      premiumOverlays: Object.keys(PREMIUM_OVERLAYS),
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error("❌ Stats erro:", err.message);
    res.status(500).json({ error: "Erro ao obter estatísticas" });
  }
});

app.get("/api/cores", (req, res) => {
  res.json({
    cores: Object.entries(COLORS).map(([k, v]) => ({
      nome: k,
      hex: v.hex,
      gradient: v.gradient,
      premiumOverlay: !!PREMIUM_OVERLAYS[k]
    }))
  });
});

app.use((err, req, res, next) => {
  console.error("❌ Erro não tratado:", err);
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: `Upload: ${err.message}` });
  }
  res.status(500).json({ error: err.message || "Erro interno" });
});

// ============================================
// 🎬 FUNÇÕES AUXILIARES PARA GERAÇÃO DE VÍDEO
// ============================================

// Função para baixar trailer do YouTube
async function downloadTrailer(trailerKey, outputPath) {
  return new Promise((resolve, reject) => {
    // Detectar yt-dlp baseado no sistema operacional
    const ytdlpPath = process.platform === 'win32'
      ? 'C:\\Users\\charl\\AppData\\Roaming\\Python\\Python314\\Scripts\\yt-dlp.exe'
      : 'yt-dlp'; // Usar PATH do sistema no Linux
    
    console.log(`📹 Baixando trailer com yt-dlp (${process.platform}): ${ytdlpPath}`);
    
    const ytdlp = spawn(ytdlpPath, [
      '-f', 'best[height<=480]', // Baixar 480p para geração mais rápida
      '--no-playlist',
      '--no-warnings',
      '--socket-timeout', '30',
      '--retries', '3',
      '-o', outputPath,
      `https://youtube.com/watch?v=${trailerKey}`
    ]);

    // Timeout de 60 segundos para download
    const timeout = setTimeout(() => {
      ytdlp.kill();
      reject(new Error('Timeout ao baixar trailer'));
    }, 60000);

    ytdlp.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        console.log(`✅ Trailer baixado: ${outputPath}`);
        resolve();
      } else {
        reject(new Error(`yt-dlp falhou com código ${code}`));
      }
    });

    ytdlp.on('error', (err) => {
      clearTimeout(timeout);
      console.error(`❌ Erro yt-dlp: ${err.message}`);
      reject(new Error(`Erro ao executar yt-dlp: ${err.message}`));
    });
  });
}

// Função para gerar vídeo vertical com FFmpeg
async function generateVideoFFmpeg(options) {
  return new Promise((resolve, reject) => {
    const {
      trailerPath,      // Caminho do trailer baixado
      backdropPath,     // Backdrop processado
      framePath,        // Frame com overlay+poster+textos
      outputPath,       // Caminho de saída
      duracao,          // Duração em segundos
      width = 640,      // Largura (padrão 480p)
      height = 1200     // Altura (padrão 480p)
    } = options;
    
    // Sempre processa em 1080x1920, depois escala para qualidade desejada
    const trailerHeight = 576;  // 30% de 1920
    const backdropHeight = 1344; // 70% de 1920
    
    // FPS baseado na qualidade FINAL
    const fps = width >= 1080 ? 30 : width >= 720 ? 24 : 24;

    ffmpeg()
      // ENTRADA 1: Backdrop (loop)
      .input(backdropPath)
      .inputOptions(['-loop 1', '-framerate 30'])
      .duration(duracao)

      // ENTRADA 2: Trailer
      .input(trailerPath)
      .inputOptions(['-t', duracao])

      // ENTRADA 3: Frame overlay (loop)
      .input(framePath)
      .inputOptions(['-loop 1', '-framerate 30'])
      .duration(duracao)

      // FILTROS COMPLEXOS (processa em 1080x1920, escala na saída)
      .complexFilter([
        // 1. Processar trailer: escalar e cortar para 1080x576 (topo)
        `[1:v]scale=1080:576:force_original_aspect_ratio=increase,crop=1080:576,setsar=1,fps=30[trailer]`,
        
        // 2. Processar backdrop: já está em 1080x1920, cortar para 1080x1344 (parte inferior)
        `[0:v]scale=1080:1344:force_original_aspect_ratio=increase,crop=1080:1344,setsar=1,fps=30[backdrop]`,
        
        // 3. Empilhar trailer (topo) + backdrop (embaixo) = 1080x1920
        `[trailer][backdrop]vstack=inputs=2[bg]`,
        
        // 4. Sobrepor frame e escalar para qualidade desejada
        `[bg][2:v]overlay=0:0:shortest=1,scale=${width}:${height},fps=${fps}[final]`
      ])

      // MAPEAMENTO E CODECS (OTIMIZAÇÃO POR QUALIDADE)
      .outputOptions([
        '-map', '[final]',
        '-map', '1:a?',
        '-c:v', 'libx264',
        '-preset', width >= 1080 ? 'medium' : width >= 720 ? 'fast' : 'ultrafast',
        '-crf', width >= 1080 ? '20' : width >= 720 ? '23' : '26',
        '-g', fps * 2,
        '-bf', width >= 1080 ? '3' : '2',
        '-refs', width >= 1080 ? '4' : '2',
        '-c:a', 'aac',
        '-b:a', width >= 1080 ? '160k' : '128k',
        '-ar', '48000',
        '-t', duracao.toString(),
        '-pix_fmt', 'yuv420p',
        '-threads', '0',
        '-movflags', '+faststart'
      ])

      // SAÍDA
      .output(outputPath)

      // EVENTOS
      .on('start', (cmd) => {
        console.log(`🎬 FFmpeg iniciado (${width}x${height} @ ${fps}fps): ${cmd}`);
      })
      .on('progress', (progress) => {
        if (progress.percent) {
          console.log(`⏳ Progresso: ${progress.percent.toFixed(1)}%`);
        }
      })
      .on('end', () => {
        console.log(`✅ Vídeo gerado: ${outputPath}`);
        resolve();
      })
      .on('error', (err) => {
        console.error(`❌ Erro FFmpeg: ${err.message}`);
        reject(err);
      })
      .run();
  });
}

// ============================================
// 🎬 ROTA DE TESTE (SEM MIDDLEWARE)
// ============================================
console.log('🧪 Registrando rota de teste POST /api/test-video');
app.post("/api/test-video", async (req, res) => {
  console.log('✅ Rota de teste funcionou!');
  res.json({ success: true, message: 'Rota de teste OK!' });
});

// ============================================
// 🎬 ENDPOINT: GERAR VÍDEO COM TRAILER (VERTICAL 1080x1920)
// Layout: Trailer horizontal no topo (atrás do overlay) + Overlay com poster, título, metadados e sinopse
// Não salva no Cloudinary/Firestore - apenas gera e retorna para download
// ============================================
console.log('🎬 Registrando rota POST /api/gerar-video');
app.post("/api/gerar-video", verificarAuth, authLimiter, async (req, res) => {
  console.log('🚀 Requisição recebida em /api/gerar-video');
  const startTime = Date.now();
  let tempFiles = [];

  try {
    // Verificar se FFmpeg e yt-dlp estão disponíveis
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execPromise = promisify(exec);
    
    try {
      const ytdlpPath = process.platform === 'win32' 
        ? 'C:\\Users\\charl\\AppData\\Roaming\\Python\\Python314\\Scripts\\yt-dlp.exe'
        : 'yt-dlp';
      
      await execPromise(`${ytdlpPath} --version`);
      console.log('✅ yt-dlp disponível');
    } catch (err) {
      console.error('❌ yt-dlp não encontrado:', err.message);
      // Tentar usar apenas 'yt-dlp' sem caminho completo
      try {
        await execPromise('yt-dlp --version');
        console.log('✅ yt-dlp disponível (via PATH)');
      } catch (err2) {
        console.error('❌ yt-dlp não instalado');
        return res.status(500).json({ 
          error: 'yt-dlp não instalado no servidor. Reinstale as dependências.' 
        });
      }
    }
    
    try {
      await execPromise('ffmpeg -version');
      console.log('✅ FFmpeg disponível');
    } catch (err) {
      console.error('❌ FFmpeg não encontrado:', err.message);
      return res.status(500).json({ 
        error: 'FFmpeg não instalado no servidor. Reinstale as dependências.' 
      });
    }

    const {
      tmdbId,
      tmdbTipo,
      duracao = 30, // Duração em segundos (15, 30, 60, 90)
      qualidade = 480, // Qualidade em pixels (480, 720, 1080)
      temporada
    } = req.body;

    // Definir dimensões baseado na qualidade
    let width, height;
    switch (parseInt(qualidade)) {
      case 1080:
        width = 1080;
        height = 1920;
        break;
      case 720:
        width = 720;
        height = 1280;
        break;
      case 480:
      default:
        width = 640;
        height = 1200;
        break;
    }

    console.log(`\n🎬 === INICIANDO GERAÇÃO DE VÍDEO VERTICAL (${width}x${height}) ===`);
    console.log(`📋 TMDB ID: ${tmdbId} | Tipo: ${tmdbTipo} | Duração: ${duracao}s | Qualidade: ${qualidade}p`);

    // Validações
    if (!tmdbId || !tmdbTipo) {
      return res.status(400).json({ error: "tmdbId e tmdbTipo são obrigatórios" });
    }

    if (![15, 30, 60, 90].includes(parseInt(duracao))) {
      return res.status(400).json({ error: "Duração inválida. Use: 15, 30, 60 ou 90" });
    }
    
    if (![480, 720, 1080].includes(parseInt(qualidade))) {
      return res.status(400).json({ error: "Qualidade inválida. Use: 480, 720 ou 1080" });
    }

    // 1. Buscar dados do TMDB
    const tmdbUrl = `https://api.themoviedb.org/3/${tmdbTipo}/${tmdbId}?api_key=${process.env.TMDB_KEY}&language=pt-BR&append_to_response=videos`;
    const tmdbRes = await fetch(tmdbUrl);
    if (!tmdbRes.ok) throw new Error("Erro ao buscar dados do TMDB");
    const tmdbData = await tmdbRes.json();

    console.log(`✅ Dados carregados: ${tmdbData.title || tmdbData.name}`);

    // 2. Buscar trailer em múltiplas fontes
    let trailerKey = null;
    let useBackdropAsFallback = false;

    // 2.1. Para séries, tentar buscar trailer da temporada específica
    if (tmdbTipo === 'tv' && temporada) {
      try {
        const seasonUrl = `https://api.themoviedb.org/3/tv/${tmdbId}/season/${temporada}/videos?api_key=${process.env.TMDB_KEY}`;
        const seasonRes = await fetch(seasonUrl);
        if (seasonRes.ok) {
          const seasonData = await seasonRes.json();
          const trailerPT = seasonData.results?.find(v => v.type === 'Trailer' && v.site === 'YouTube' && v.iso_639_1 === 'pt');
          const trailerEN = seasonData.results?.find(v => v.type === 'Trailer' && v.site === 'YouTube' && v.iso_639_1 === 'en');
          const anyTrailer = seasonData.results?.find(v => v.type === 'Trailer' && v.site === 'YouTube');
          trailerKey = trailerPT?.key || trailerEN?.key || anyTrailer?.key;
          if (trailerKey) {
            console.log(`✅ Trailer da temporada ${temporada} encontrado: ${trailerKey}`);
          }
        }
      } catch (err) {
        console.warn(`⚠️ Erro ao buscar trailer da temporada: ${err.message}`);
      }
    }

    // 2.2. Se não encontrou trailer da temporada, tentar buscar trailer geral
    if (!trailerKey && tmdbData.videos?.results && tmdbData.videos.results.length > 0) {
      const trailerPT = tmdbData.videos.results.find(v => 
        v.type === "Trailer" && v.site === "YouTube" && v.iso_639_1 === "pt"
      );
      const trailerEN = tmdbData.videos.results.find(v => 
        v.type === "Trailer" && v.site === "YouTube" && v.iso_639_1 === "en"
      );
      const anyTrailer = tmdbData.videos.results.find(v => 
        v.type === "Trailer" && v.site === "YouTube"
      );
      const anyVideo = tmdbData.videos.results.find(v => v.site === "YouTube");
      
      trailerKey = trailerPT?.key || trailerEN?.key || anyTrailer?.key || anyVideo?.key;
    }

    // 2.2. Se não encontrar no TMDB, tentar buscar no YouTube via API
    if (!trailerKey) {
      console.log(`⚠️ Trailer não encontrado no TMDB, buscando no YouTube...`);
      try {
        const searchQuery = encodeURIComponent(`${tmdbData.title || tmdbData.name} official trailer ${ano}`);
        const youtubeSearchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${searchQuery}&type=video&maxResults=1&key=${process.env.YOUTUBE_API_KEY || process.env.TMDB_KEY}`;
        const ytRes = await fetch(youtubeSearchUrl);
        if (ytRes.ok) {
          const ytData = await ytRes.json();
          if (ytData.items && ytData.items.length > 0) {
            trailerKey = ytData.items[0].id.videoId;
            console.log(`✅ Trailer encontrado no YouTube: ${trailerKey}`);
          }
        }
      } catch (err) {
        console.log(`⚠️ Erro ao buscar no YouTube: ${err.message}`);
      }
    }

    // 2.3. Se ainda não encontrar, usar backdrop como fallback (sem download de trailer)
    if (!trailerKey) {
      console.log(`⚠️ Nenhum trailer encontrado, usando backdrop estático como fallback`);
      useBackdropAsFallback = true;
    } else {
      console.log(`🎥 Trailer: https://youtube.com/watch?v=${trailerKey}`);
    }

    // 3. Preparar dados
    let titulo = (tmdbData.title || tmdbData.name || "Sem título").substring(0, 50);
    
    // Buscar logo oficial do TMDB
    let logoOficialUrl = null;
    try {
      const imagesUrl = `https://api.themoviedb.org/3/${tmdbTipo}/${tmdbId}/images?api_key=${process.env.TMDB_KEY}`;
      const imagesRes = await fetch(imagesUrl);
      if (imagesRes.ok) {
        const imagesData = await imagesRes.json();
        const logoPT = imagesData.logos?.find(l => l.iso_639_1 === 'pt');
        const logoEN = imagesData.logos?.find(l => l.iso_639_1 === 'en');
        const anyLogo = imagesData.logos?.[0];
        const logoPath = logoPT?.file_path || logoEN?.file_path || anyLogo?.file_path;
        if (logoPath) {
          logoOficialUrl = `https://image.tmdb.org/t/p/w500${logoPath}`;
          console.log(`✅ Logo oficial encontrado`);
        }
      }
    } catch (err) {
      console.warn(`⚠️ Erro ao buscar logo oficial: ${err.message}`);
    }
    
    const sinopse = (tmdbData.overview || "Sem sinopse disponível").substring(0, 200);
    const genero = tmdbData.genres?.[0]?.name || "Geral";
    const ano = (tmdbData.release_date || tmdbData.first_air_date || "").substring(0, 4);
    const nota = tmdbData.vote_average?.toFixed(1) || "0.0";
    const posterUrl = tmdbData.poster_path ? `https://image.tmdb.org/t/p/w500${tmdbData.poster_path}` : null;
    const backdropUrl = tmdbData.backdrop_path ? `https://image.tmdb.org/t/p/original${tmdbData.backdrop_path}` : null;
    
    // Se for série e tiver temporada, adicionar info
    const infoTemporada = (tmdbTipo === 'tv' && temporada) ? `Temporada ${temporada}` : null;

    console.log(`📝 ${titulo} | ⭐ ${nota} | 📅 ${ano} | 🎭 ${genero}`);

    // 4. Buscar logo do usuário do Firestore
    let userLogoUrl = null;
    try {
      const userDoc = await db.collection('usuarios').doc(req.uid).get();
      if (userDoc.exists) {
        const userData = userDoc.data();
        userLogoUrl = userData.logoUrl || userData.logo || null;
        console.log(`📸 Logo do usuário: ${userLogoUrl ? 'Encontrado' : 'Não encontrado'}`);
      }
    } catch (err) {
      console.warn(`⚠️ Erro ao buscar logo do usuário: ${err.message}`);
    }

    // 5. Baixar overlay base
    const overlayPath = path.join(__dirname, "public", "images", "videos", "videos.png");
    if (!await fsPromises.access(overlayPath).then(() => true).catch(() => false)) {
      throw new Error("Overlay não encontrado: public/images/videos/videos.png");
    }

    // 5. Baixar poster
    let posterBuffer = null;
    if (posterUrl) {
      try {
        const posterRes = await fetch(posterUrl);
        posterBuffer = await posterRes.arrayBuffer();
        console.log(`✅ Poster baixado: ${(posterBuffer.byteLength / 1024).toFixed(2)} KB`);
      } catch (err) {
        console.warn(`⚠️ Erro ao baixar poster: ${err.message}`);
      }
    }

    // 6. Baixar backdrop
    let backdropBuffer = null;
    if (backdropUrl) {
      try {
        const backdropRes = await fetch(backdropUrl);
        backdropBuffer = await backdropRes.arrayBuffer();
        console.log(`✅ Backdrop baixado: ${(backdropBuffer.byteLength / 1024).toFixed(2)} KB`);
      } catch (err) {
        console.warn(`⚠️ Erro ao baixar backdrop: ${err.message}`);
      }
    }

    // 7. Processar backdrop para formato vertical 1080x1920 - 12% transparente
    const backdropProcessedPath = path.join(__dirname, `temp_backdrop_${Date.now()}.png`);
    if (backdropBuffer) {
      await sharp(Buffer.from(backdropBuffer))
        .resize(1080, 1920, { fit: "cover", position: "center" })
        .ensureAlpha()
        .composite([{
          input: Buffer.from(
            `<svg width="1080" height="1920"><rect width="1080" height="1920" fill="rgba(0,0,0,0.88)"/></svg>`
          ),
          blend: 'over'
        }])
        .png()
        .toFile(backdropProcessedPath);
      tempFiles.push(backdropProcessedPath);
      console.log(`✅ Backdrop processado: 640x1200`);
    }

    // 8. Criar frame com overlay + poster + textos (640x1200)
    const framePath = path.join(__dirname, `temp_frame_${Date.now()}.png`);
    
    // Quebrar sinopse em linhas (máx 35 chars por linha, 5 linhas)
    const breakText = (text, maxChars, maxLines) => {
      const words = text.split(' ');
      const lines = [];
      let currentLine = '';
      
      for (const word of words) {
        if ((currentLine + word).length <= maxChars) {
          currentLine += (currentLine ? ' ' : '') + word;
        } else {
          if (lines.length < maxLines) {
            lines.push(currentLine);
            currentLine = word;
          } else {
            break;
          }
        }
      }
      if (currentLine && lines.length < maxLines) lines.push(currentLine);
      return lines;
    };

    // Função para escapar caracteres XML/SVG
    const escapeXml = (text) => {
      return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
    };

    const sinopseLines = breakText(sinopse, 50, 3);
    const sinopseSVG = sinopseLines.map((line, idx) => 
      `<text x="40" y="${1620 + (idx * 28)}" class="sinopse" text-anchor="start">${escapeXml(line)}</text>`
    ).join('\n');

    const tituloEscapado = escapeXml(titulo);
    const generoEscapado = escapeXml(genero);

    const svgOverlay = `
      <svg width="1080" height="1920" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&amp;family=Inter:wght@400;600;800&amp;display=swap');
            .titulo { font-family: 'Bebas Neue', sans-serif; font-weight: 400; font-size: 68px; fill: white; text-shadow: 0 4px 20px rgba(0,0,0,0.9); }
            .meta { font-family: 'Inter', sans-serif; font-weight: 600; font-size: 22px; fill: white; text-shadow: 0 2px 10px rgba(0,0,0,0.9); }
            .sinopse { font-family: 'Inter', sans-serif; font-weight: 700; font-size: 22px; fill: #ffffff; text-shadow: 0 2px 8px rgba(0,0,0,0.9); letter-spacing: 0.3px; }
          </style>
        </defs>
        
        <!-- Título ou Logo Oficial -->
        ${logoOficialUrl ? '' : `<text x="80" y="775" class="titulo" text-anchor="start">${escapeXml(tituloEscapado.substring(0, Math.ceil(tituloEscapado.length / 2)))}</text>
        <text x="80" y="850" class="titulo" text-anchor="start">${escapeXml(tituloEscapado.substring(Math.ceil(tituloEscapado.length / 2)))}</text>`}
        
        <!-- Sinopse (mais larga e nítida, acima dos metadados) -->
        ${sinopseSVG}
        
        <!-- Metadados bem brancos com caixas arredondadas sem fundo (mais à esquerda: 40px) -->
        <g transform="translate(40, 1728)">
          <rect x="0" y="0" width="${(nota.toString().length + 3) * 15}" height="38" rx="10" ry="10" fill="none" stroke="#FFFFFF" stroke-width="3"/>
          <text x="${((nota.toString().length + 3) * 15) / 2}" y="26" class="meta" text-anchor="middle" style="fill: #FFFFFF; font-weight: 700;">⭐ ${nota}</text>
        </g>
        <g transform="translate(${40 + (nota.toString().length + 3) * 15 + 20}, 1728)">
          <rect x="0" y="0" width="${(ano.toString().length + 2) * 16}" height="38" rx="10" ry="10" fill="none" stroke="#FFFFFF" stroke-width="3"/>
          <text x="${((ano.toString().length + 2) * 16) / 2}" y="26" class="meta" text-anchor="middle" style="fill: #FFFFFF; font-weight: 700;">${ano}</text>
        </g>
        <g transform="translate(${40 + (nota.toString().length + 3) * 15 + 20 + (ano.toString().length + 2) * 16 + 20}, 1728)">
          <rect x="0" y="0" width="${(generoEscapado.length + 2) * 12}" height="38" rx="10" ry="10" fill="none" stroke="#FFFFFF" stroke-width="3"/>
          <text x="${((generoEscapado.length + 2) * 12) / 2}" y="26" class="meta" text-anchor="middle" style="fill: #FFFFFF; font-weight: 700;">${generoEscapado}</text>
        </g>
        ${infoTemporada ? `<g transform="translate(${40 + (nota.toString().length + 3) * 15 + 20 + (ano.toString().length + 2) * 16 + 20 + (generoEscapado.length + 2) * 12 + 20}, 1728)">
          <rect x="0" y="0" width="${(infoTemporada.length + 2) * 13}" height="38" rx="10" ry="10" fill="none" stroke="#FFFFFF" stroke-width="3"/>
          <text x="${((infoTemporada.length + 2) * 13) / 2}" y="26" class="meta" text-anchor="middle" style="fill: #FFFFFF; font-weight: 700;">${escapeXml(infoTemporada)}</text>
        </g>` : ''}
      </svg>
    `;

    // Tamanhos fixos para 1080x1920
    const posterWidth = 380;  // Reduzido de 390 para 380
    const posterHeight = 550; // Reduzido de 555 para 550
    const logoFilmWidth = 480;  // Reduzido de 500 para 480
    const logoFilmHeight = 175; // Reduzido de 185 para 175
    const logoClientSize = 340; // Aumentado de 305 para 340
    
    // Compor frame: overlay base + poster + textos (SEMPRE 1080x1920)
    const overlayBuffer = await fsPromises.readFile(overlayPath);
    const compositeInputs = [];

    // Adicionar logo oficial do TMDB
    if (logoOficialUrl) {
      try {
        const logoRes = await fetch(logoOficialUrl);
        const logoBuffer = await logoRes.arrayBuffer();
        const logoResized = await sharp(Buffer.from(logoBuffer))
          .resize(logoFilmWidth, logoFilmHeight, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
          .png()
          .toBuffer();
        compositeInputs.push({ input: logoResized, left: 35, top: 790 });
        console.log(`✅ Logo oficial do TMDB adicionado`);
      } catch (err) {
        console.warn(`⚠️ Erro ao adicionar logo oficial: ${err.message}`);
      }
    }
    
    // SEMPRE adicionar logo do cliente
    if (userLogoUrl) {
      try {
        const logoRes = await fetch(userLogoUrl);
        const logoBuffer = await logoRes.arrayBuffer();
        const logoResized = await sharp(Buffer.from(logoBuffer))
          .resize(logoClientSize, logoClientSize, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
          .png()
          .toBuffer();
        compositeInputs.push({ input: logoResized, left: 100, top: 1235 });
        console.log(`✅ Logo do cliente adicionado acima da sinopse`);
      } catch (err) {
        console.warn(`⚠️ Erro ao adicionar logo do cliente: ${err.message}`);
      }
    }

    // Adicionar poster (milimetricamente mais alto e mais à direita: 573 top, 585 left)
    if (posterBuffer) {
      const posterResized = await sharp(Buffer.from(posterBuffer))
        .resize(posterWidth, posterHeight, { fit: "cover" })
        .composite([{
          input: Buffer.from(
            `<svg><rect x="0" y="0" width="${posterWidth}" height="${posterHeight}" rx="12" ry="12" fill="white"/></svg>`
          ),
          blend: 'dest-in'
        }])
        .png()
        .toBuffer();
      compositeInputs.push({ input: posterResized, left: 570, top: 870 });
    }

    // Adicionar textos SVG
    compositeInputs.push({ input: Buffer.from(svgOverlay), top: 0, left: 0 });

    await sharp(overlayBuffer)
      .resize(1080, 1920, { fit: "cover" })
      .composite(compositeInputs)
      .png()
      .toFile(framePath);
    
    tempFiles.push(framePath);
    console.log(`✅ Frame criado: 1080x1920 (modelo fixo)`);

    // 9. Baixar trailer do YouTube (ou usar backdrop como fallback)
    let trailerTempPath = null;
    
    if (!useBackdropAsFallback) {
      trailerTempPath = path.join(__dirname, `temp_trailer_${Date.now()}.mp4`);
      tempFiles.push(trailerTempPath);

      try {
        console.log(`📥 Baixando trailer: ${trailerKey}`);
        await downloadTrailer(trailerKey, trailerTempPath);
      } catch (error) {
        console.error(`⚠️ Erro ao baixar trailer:`, error.message);
        console.log(`🔄 Usando backdrop estático como fallback...`);
        useBackdropAsFallback = true;
        trailerTempPath = null;
      }
    }

    // Se não houver trailer, usar backdrop processado como "trailer" estático
    if (useBackdropAsFallback) {
      trailerTempPath = backdropProcessedPath; // Usar o mesmo backdrop
      console.log(`📸 Modo estático: usando backdrop como vídeo base`);
    }

    // 10. Gerar vídeo com FFmpeg
    const videoOutputPath = path.join(__dirname, `video_${Date.now()}.mp4`);
    tempFiles.push(videoOutputPath);

    try {
      console.log(`🎬 Iniciando geração de vídeo ${width}x${height}...`);
      await generateVideoFFmpeg({
        trailerPath: trailerTempPath,
        backdropPath: backdropProcessedPath,
        framePath: framePath,
        outputPath: videoOutputPath,
        duracao: duracao,
        width: width,
        height: height
      });
    } catch (error) {
      console.error(`❌ Erro ao gerar vídeo:`, error);
      return res.status(500).json({ 
        error: "Erro ao processar vídeo",
        details: error.message 
      });
    }

    // 11. Retornar vídeo
    const videoBuffer = await fsPromises.readFile(videoOutputPath);
    const safeTitle = titulo.replace(/[^a-zA-Z0-9]/g, '_');
    
    res.set("Content-Type", "video/mp4");
    res.set("Content-Disposition", `attachment; filename="Video_${safeTitle}_${duracao}s.mp4"`);
    res.send(videoBuffer);

    // Limpar arquivos temporários IMEDIATAMENTE após envio
    setTimeout(async () => {
      for (const file of tempFiles) {
        try {
          await fsPromises.unlink(file);
          console.log(`🗑️ Arquivo temporário removido: ${path.basename(file)}`);
        } catch (err) {
          console.error(`⚠️ Erro ao deletar ${path.basename(file)}:`, err.message);
        }
      }
      console.log(`✅ Limpeza concluída: ${tempFiles.length} arquivos removidos`);
    }, 2000);

  } catch (error) {
    console.error("❌ Erro ao gerar vídeo:", error);
    
    // Limpar arquivos temporários em caso de erro
    for (const file of tempFiles) {
      try {
        await fsPromises.unlink(file);
        console.log(`🗑️ Limpeza de erro: ${path.basename(file)} removido`);
      } catch (err) {
        // Ignorar erros de limpeza
      }
    }

    res.status(500).json({
      error: "Erro ao gerar vídeo",
      message: error.message
    });
  }
});

async function gracefulShutdown(signal) {
  console.log(`\n📴 Recebido ${signal}. Encerrando...`);
  imageCache.destroy();
  tmdbCache.destroy();
  try {
    await admin.app().delete();
    console.log("✅ Firebase encerrado");
  } catch (err) {
    console.error("Erro ao encerrar Firebase:", err.message);
  }
  process.exit(0);
}

// ============================================
// 🚫 HANDLER 404 (DEVE VIR DEPOIS DE TODAS AS ROTAS)
// ============================================
app.use((req, res) => {
  res.status(404).json({
    error: "Rota não encontrada",
    path: req.path,
    method: req.method
  });
});

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("unhandledRejection", (reason) => console.error("Unhandled Rejection:", reason));
process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
  process.exit(1);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`
╔═══════════════════════════════════════╗
║   🚀 ORION CREATOR SERVER 2.8.0      ║
║   TMDB + Fanart + Firebase           ║
║   Premium: Blur + Overlay            ║
║   Exclusive: Poster limpo + Modelo2  ║
╚═══════════════════════════════════════╝
Porta: ${PORT}
Node: ${process.version}
Env: ${process.env.NODE_ENV || "development"}
TMDB Key: ${process.env.TMDB_KEY ? "✔" : "✘"}
Fanart Key: ${process.env.FANART_API_KEY ? "✔" : "✘"}
Cores: ${Object.keys(COLORS).join(", ")}
Premium Overlays: ${Object.keys(PREMIUM_OVERLAYS).filter(k => PREMIUM_OVERLAYS[k]).length}/8
📦 Banners salvos automaticamente (expiram em 7 dias)
`);
});