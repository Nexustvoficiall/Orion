// server.js (Orion Creator API 2.8.22 - VIDEO GENERATION WITH PROGRESS)
// VERSÃO: MELHORIAS RIGEL, BELTEGUESE, BELLATRIX + GERAÇÃO DE VÍDEOS + SOCKET.IO PROGRESS

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
import { spawn } from "child_process";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import validator from "validator";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import { getDatabase } from "firebase-admin/database";
import { createServer } from "http";
import { Server } from "socket.io";

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
  "FANART_API_KEY",
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET"
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
      }),
      databaseURL: "https://orion-lab-a9298-default-rtdb.firebaseio.com"
    });
    console.log("✅ Firebase inicializado");
  } catch (err) {
    console.error("❌ Erro ao inicializar Firebase:", err.message);
    process.exit(1);
  }
}
const db = getFirestore();
const rtdb = getDatabase();

const app = express();
const PORT = process.env.PORT || 8080; // Fly.io e outras plataformas usam portas variáveis

const fanartService = new FanartService(process.env.FANART_API_KEY);
console.log("✅ Fanart.tv Service inicializado");

// Map para gerenciar conexões SSE de progresso
const progressConnections = new Map();

// Cleanup de conexões SSE mortas (previne memory leak)
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [key, entry] of progressConnections.entries()) {
    // Remove conexões mais antigas que 10 minutos
    if (entry.createdAt && now - entry.createdAt > 10 * 60 * 1000) {
      try {
        if (entry.res && !entry.res.writableEnded) {
          entry.res.end();
        }
      } catch (e) { /* ignorar */ }
      progressConnections.delete(key);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    console.log(`🧹 Cleanup SSE: ${cleaned} conexões removidas`);
  }
}, 60 * 1000); // Verifica a cada 1 minuto

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

// ⚡ OTIMIZADO: Compressão para respostas 3x menores
import compression from 'compression';
app.use(compression({ level: 6 })); // Gzip/Brotli

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public"), {
  maxAge: '7d', // ⚡ Cache de arquivos estáticos por 7 dias
  etag: true
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
  windowMs: 15 * 60 * 1000,
  max: 999999,
  message: { error: "Limite de geração de banners atingido. Aguarde alguns minutos." }
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: { error: "Limite de uploads atingido. Tente novamente depois." }
});

const videoLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 999999,
  message: { error: "Limite de geração de vídeos atingido. Tente novamente em 1 hora." }
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
// ⚡ OTIMIZADO: Cache 3x maior e TTL aumentado
const imageCache = new SimpleCache(3 * 60 * 60 * 1000, 500); // 3h, 500 itens
const tmdbCache = new SimpleCache(2 * 60 * 60 * 1000, 1000); // 2h, 1000 itens

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

const COLORS = {
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
  let buffer = Buffer.from(arrayBuf);
  const meta = await sharp(buffer).metadata();
  if (!meta.format) throw new Error("Conteúdo não é imagem válida");
  
  // Só converter para PNG se não for PNG (otimização de performance)
  if (meta.format !== 'png') {
    buffer = await sharp(buffer).png().toBuffer();
  }

  if (useCache) imageCache.set(url, buffer);
  return buffer;
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
  return lines.slice(0, 10);
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

async function spawnProcess(command, args) {
  return new Promise((resolve, reject) => {
    const childProc = spawn(command, args);
    let stdout = '';
    let stderr = '';
    
    childProc.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    childProc.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    childProc.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const error = new Error(`${command} falhou (código ${code})`);
        error.stderr = stderr;
        error.stdout = stdout;
        reject(error);
      }
    });
    
    childProc.on('error', (err) => {
      const error = new Error(`Falha ao executar ${command}: ${err.message}`);
      error.originalError = err;
      reject(error);
    });
  });
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
<div class="endpoint"><span class="method post">POST</span><code>/api/gerar-video</code> - Gerar vídeo promocional (auth)</div>
<div class="endpoint"><span class="method post">POST</span><code>/api/upload</code> - Upload (auth)</div>
<p>Versão: 2.8.21 (Video Generation Feature)</p>
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

// ============================================================================
// 🎨 UPLOAD DE LOGO DO CLIENTE - CLOUDINARY + FIRESTORE
// ============================================================================
const logoStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "orion_creator/logos",
    allowed_formats: ["jpg", "png", "jpeg", "webp", "gif"],
    transformation: [
      { width: 500, height: 500, crop: "limit" },
      { quality: "auto:good" },
      { fetch_format: "auto" }
    ],
    public_id: (req, file) => `logo_${req.uid}_${Date.now()}`
  }
});

const logoUpload = multer({
  storage: logoStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = ["image/png", "image/jpeg", "image/webp", "image/gif"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Formato de imagem não permitido. Use: PNG, JPG, WebP ou GIF"));
    }
  }
});

/**
 * Endpoint para upload de logo do cliente
 * - Faz upload para Cloudinary (pasta: orion_creator/logos/{uid})
 * - Salva URL no Firestore vinculada ao UID
 * - Controla limite de uploads por mês
 * - Retorna URL segura para uso em banners/vídeos
 */
app.post("/api/upload-logo", verificarAuth, uploadLimiter, logoUpload.single("logo"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Nenhum arquivo enviado" });
    }

    const uid = req.uid;
    const userRef = db.collection("usuarios").doc(uid);
    const userDoc = await userRef.get();
    
    // Verificar limite de uploads
    let uploadsRestantes = 2;
    let dataReset = null;
    
    if (userDoc.exists) {
      const userData = userDoc.data();
      uploadsRestantes = userData.uploads_restantes ?? 2;
      dataReset = userData.data_reset_logo ? new Date(userData.data_reset_logo) : null;
      
      // Verificar se precisa resetar o contador (mensal)
      const agora = new Date();
      if (dataReset && agora >= dataReset) {
        // Reset mensal
        uploadsRestantes = 2;
        dataReset = new Date(agora.getTime() + 30 * 24 * 60 * 60 * 1000);
      }
      
      if (uploadsRestantes <= 0) {
        // Remover imagem do Cloudinary (já foi feito upload)
        if (req.file.filename) {
          try {
            await cloudinary.uploader.destroy(`orion_creator/logos/${req.file.filename}`);
          } catch (e) {
            console.warn("Falha ao remover logo do Cloudinary:", e.message);
          }
        }
        return res.status(429).json({ 
          error: "Limite de uploads atingido",
          dataReset: dataReset?.toISOString()
        });
      }
    }

    // URL segura do Cloudinary
    const logoUrl = req.file.path || req.file.secure_url || req.file.url;
    
    if (!logoUrl) {
      return res.status(500).json({ error: "Erro ao obter URL da imagem" });
    }

    // Calcular próximo reset se não existir
    if (!dataReset) {
      dataReset = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    }

    // Preparar dados - campo 'logo' como principal (link do Cloudinary)
    const userData = {
      logo: logoUrl, // Campo principal com URL do Cloudinary
      logo_url: logoUrl, // Mantido para compatibilidade retroativa
      uploads_restantes: uploadsRestantes - 1,
      data_reset_logo: dataReset.toISOString(),
      logo_updated_at: new Date().toISOString()
    };

    // Salvar em AMBOS: Firestore E Realtime Database
    console.log(`📝 Salvando logo para usuário: ${uid}`);
    console.log(`   URL Cloudinary: ${logoUrl}`);
    console.log(`   Formato: ${logoUrl.includes('cloudinary.com') ? '✅ Cloudinary válido' : '❌ URL inválida'}`);
    
    try {
      // Salvar no Firestore
      await userRef.set(userData, { merge: true });
      console.log(`   ✅ Firestore: campo 'logo' salvo com sucesso`);
    } catch (err) {
      console.error(`   ❌ Firestore: erro ao salvar:`, err.message);
      throw err;
    }

    try {
      // Salvar no Realtime Database também
      const rtdbUserRef = rtdb.ref(`usuarios/${uid}`);
      await rtdbUserRef.update(userData);
      console.log(`   ✅ Realtime Database: campo 'logo' salvo com sucesso`);
    } catch (err) {
      console.error(`   ⚠️ Realtime Database: erro ao salvar (não crítico):`, err.message);
      // Não lançar erro - Firestore é a fonte principal de verdade
    }

    console.log(`✅ Logo salva no Cloudinary e link salvo no campo 'logo' de ambos os bancos`);

    res.json({
      success: true,
      logoUrl: logoUrl,
      uploadsRestantes: uploadsRestantes - 1,
      dataReset: dataReset.toISOString()
    });

  } catch (err) {
    console.error("❌ Upload de logo erro:", err.message);
    res.status(500).json({ error: err.message || "Erro no upload da logo" });
  }
});

/**
 * Função utilitária para buscar logo do usuário com fallback
 * Tenta Firestore primeiro, depois Realtime Database
 * @param {string} uid - UID do usuário
 * @returns {Promise<string|null>} URL da logo ou null
 */
async function getUserLogoUrl(uid) {
  const DEFAULT_LOGO = "https://res.cloudinary.com/dxbu3zk6i/image/upload/v1/orion_creator/logo-default.png";
  
  if (!uid) return DEFAULT_LOGO;
  
  try {
    // Tentar Firestore primeiro
    const userDoc = await db.collection("usuarios").doc(uid).get();
    
    if (userDoc.exists) {
      const userData = userDoc.data();
      // Buscar campo 'logo' primeiro (principal), depois logo_url (legacy)
      const logoUrl = userData.logo || userData.logo_url;
      
      // Validar URL (não aceitar base64, deve ser URL do Cloudinary)
      if (logoUrl && typeof logoUrl === 'string' && !logoUrl.startsWith('data:')) {
        try {
          const url = new URL(logoUrl);
          if (['http:', 'https:'].includes(url.protocol) && logoUrl.includes('cloudinary.com')) {
            return logoUrl;
          }
        } catch {
          console.warn(`⚠️ Logo inválida no Firestore para uid=${uid}`);
        }
      }
    }
    
    // Fallback: tentar Realtime Database
    try {
      const rtdbSnapshot = await rtdb.ref(`usuarios/${uid}`).once('value');
      const rtdbData = rtdbSnapshot.val();
      
      if (rtdbData) {
        // Buscar campo 'logo' primeiro (principal), depois logo_url (legacy)
        const logoUrl = rtdbData.logo || rtdbData.logo_url;
        
        if (logoUrl && typeof logoUrl === 'string' && !logoUrl.startsWith('data:') && logoUrl.includes('cloudinary.com')) {
          try {
            const url = new URL(logoUrl);
            if (['http:', 'https:'].includes(url.protocol)) {
              console.log(`ℹ️ Logo encontrada no Realtime Database para uid=${uid}`);
              return logoUrl;
            }
          } catch {
            console.warn(`⚠️ Logo inválida no RTDB para uid=${uid}`);
          }
        }
      }
    } catch (rtdbErr) {
      console.warn(`⚠️ Erro ao buscar no Realtime Database:`, rtdbErr.message);
    }
    
    return DEFAULT_LOGO;
    
  } catch (error) {
    console.error(`❌ Erro ao buscar logo do usuário ${uid}:`, error.message);
    return DEFAULT_LOGO;
  }
}

app.get("/api/ultimas-criacoes", verificarAuth, async (req, res) => {
  try {
    console.log(`🔍 Buscando banners para UID: ${req.uid}`);
    
    // Padrão 1 dia (24 horas) - banners expiram automaticamente
    const dias = parseInt(req.query.dias, 10) || 1;
    const limiteMs = dias * 24 * 60 * 60 * 1000;
    const agora = Date.now();
    const bannersRef = db.collection("banners");
    // Remover orderBy para evitar necessidade de índice composto
    const query = bannersRef.where("uid", "==", req.uid);
    const snap = await query.get();
    
    console.log(`📦 Encontrados ${snap.size} documentos no Firestore`);
    
    const banners = [];
    snap.forEach(doc => {
      const data = doc.data();
      const criadoEmMs = data.criadoEm?.toMillis ? data.criadoEm.toMillis() : data.criadoEm;
      
      console.log(`  📄 Doc ID: ${doc.id}, Criado em: ${criadoEmMs}, Idade: ${agora - criadoEmMs}ms (limite: ${limiteMs}ms)`);
      
      if (criadoEmMs && (agora - criadoEmMs) <= limiteMs) {
        // Normalizar campos para compatibilidade com frontend
        banners.push({ 
          id: doc.id, 
          ...data,
          criadoEmMs, // Adicionar timestamp para ordenação
          bannerUrl: data.url || data.bannerUrl,
          thumbnailUrl: data.url || data.thumbnailUrl || data.bannerUrl,
          modeloCor: data.modelo && data.cor ? `${data.modelo} ${data.cor}` : (data.modeloCor || 'Banner')
        });
      }
    });
    // Ordenar no código (mais recente primeiro)
    banners.sort((a, b) => b.criadoEmMs - a.criadoEmMs);
    
    console.log(`✅ Retornando ${banners.length} banners válidos`);
    
    // Retornar array direto para compatibilidade com frontend
    res.json(banners);
  } catch (err) {
    console.error("❌ Erro ao buscar últimas criações:", err.message);
    res.status(500).json({ error: "Erro ao buscar últimas criações" });
  }
});

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

    console.log(`➡️ REQUISIÇÃO RECEBIDA: modeloTipo="${modeloTipo}", tipo="${tipo}"`);

    if (!posterUrl) return res.status(400).json({ error: "posterUrl obrigatório" });
    if (!validarURL(posterUrl)) return res.status(400).json({ error: "posterUrl inválida" });
    if (!titulo || !titulo.trim()) return res.status(400).json({ error: "Título obrigatório" });
    if (titulo.length > 100) return res.status(400).json({ error: "Título excede 100 caracteres" });
    if (backdropUrl && !validarURL(backdropUrl)) return res.status(400).json({ error: "backdropUrl inválida" });
    
    // Validações de segurança para parâmetros numéricos
    if (tmdbId && !/^\d+$/.test(String(tmdbId))) {
      return res.status(400).json({ error: "tmdbId deve ser numérico" });
    }
    if (temporada && (isNaN(parseInt(temporada, 10)) || parseInt(temporada, 10) < 0)) {
      return res.status(400).json({ error: "temporada deve ser um número válido" });
    }

    const tipoNorm = (tipo || "vertical").toLowerCase();
    if (!TIPOS_BANNER_VALIDOS.includes(tipoNorm)) {
      return res.status(400).json({ error: "Tipo deve ser horizontal ou vertical" });
    }

    const corKey = (modeloCor || "ROXO").toUpperCase();
    if (!COLORS[corKey]) {
      return res.status(400).json({ error: `Cor inválida. Opções: ${Object.keys(COLORS).join(", ")}` });
    }
    const corConfig = COLORS[corKey];

    const isOrionX = modeloTipo === "ORION_X";
    const width = isOrionX ? 1080 : (tipoNorm === "horizontal" ? 1920 : 1080);
    const height = isOrionX ? 1540 : (tipoNorm === "horizontal" ? 1080 : 1920);
    const isPremium = modeloTipo === "ORION_PREMIUM" || modeloTipo === "PADRAO";
    const isExclusive = modeloTipo === "ORION_EXCLUSIVO";
    const isOrionExclusivoVertical = isExclusive && tipoNorm === "vertical";
    
    const isRigel = modeloTipo === "PADRAO";
    const isBelteguese = modeloTipo === "ORION_EXCLUSIVO";
    const isBellatrix = modeloTipo === "ORION_X";

    console.log(`📊 Gerando banner: tipo=${tipoNorm}, modelo=${modeloTipo}, cor=${corKey}, isRigel=${isRigel}, isBelteguese=${isBelteguese}, isBellatrix=${isBellatrix}`);

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

    let logoFanartBuffer = null;
    let fanartTitle = null;
    if (tmdbId) {
      if (isOrionX || isExclusive) {
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
    }

    async function obterBackdrop() {
      if (!tmdbId) {
        if (backdropUrl && validarURL(backdropUrl)) return backdropUrl;
        return null;
      }

      try {
        const imgUrl = buildTMDBUrl(`/${tmdbTipo || "movie"}/${tmdbId}/images`, { include_image_language: "null" });
        const r = await fetchWithTimeout(imgUrl);
        if (r.ok) {
          const json = await r.json();
          const backdrops = json.backdrops || [];
          
          if (backdrops.length > 0) {
            const randomIndex = Math.floor(Math.random() * Math.min(backdrops.length, 10));
            const chosenBackdrop = backdrops[randomIndex];
            if (chosenBackdrop?.file_path) {
              return `https://image.tmdb.org/t/p/original${chosenBackdrop.file_path}`;
            }
          }
        }
      } catch (err) {
        console.warn("⚠️ Erro ao buscar backdrops:", err.message);
      }

      if (backdropUrl && validarURL(backdropUrl)) return backdropUrl;
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

    if (isPremium) {
      backgroundBuffer = await sharp(backgroundBuffer)
        .blur(5)
        .modulate({ brightness: 0.75 })
        .toBuffer();
    }

    if (isOrionX && backgroundBuffer) {
      try {
        const blurred = await sharp(backgroundBuffer).blur(4).toBuffer();
        const darkBase = await sharp({
          create: { width, height, channels: 4, background: { r: 2, g: 2, b: 5, alpha: 1 } }
        }).png().toBuffer();
        const backdropWithDark = await sharp(darkBase)
          .composite([{ input: blurred, blend: 'over', opacity: 0.35 }])
          .png()
          .toBuffer();
        
        const blackOverlay = await sharp({
          create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.4 } }
        }).png().toBuffer();
        
        backgroundBuffer = await sharp(backdropWithDark)
          .composite([{ input: blackOverlay, blend: 'over' }])
          .png()
          .toBuffer();
        
        console.log('🌑 BELLATRIX: Backdrop escurecido com overlay de sombra preta adicional');
      } catch (err) {
        console.warn('⚠️ Falha ao aplicar blur/transparência no backdrop ORION_X:', err.message);
      }
    }

    let overlayColorBuffer = null;

    if (modeloTipo === "ORION_X") {
      const corLower = corKey.toLowerCase();
      const modelo3Dir = path.join(__dirname, "public", "images", "modelo3");
      const localPath = path.join(modelo3Dir, `${corLower}.png`);
      if (await fileExists(localPath)) {
        try {
          console.log(`🎨 Overlay ORION_X local (${localPath})...`);
          const localBuf = await fsPromises.readFile(localPath);
          overlayColorBuffer = await sharp(localBuf)
            .resize(width, height, { fit: "cover" })
            .png()
            .toBuffer();
        } catch (err) {
          console.warn(`⚠️ Erro overlay ORION_X local:`, err.message);
        }
      } else {
        console.warn(`⚠️ Overlay ORION_X não encontrado: ${localPath}`);
      }
    } else if (isPremium) {
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

    let effectivePosterUrl = posterUrl;
    if (tmdbId) {
      const endpointBase = tmdbTipo === "tv" ? `/tv/${tmdbId}/images` : `/movie/${tmdbId}/images`;
      const urlImgs = buildTMDBUrl(endpointBase, { include_image_language: "pt-BR,pt-br,pt,en,null" });

      const escolherPosterTMDB = async () => {
        const r = await fetchWithTimeout(urlImgs);
        if (!r.ok) return null;
        const imgs = await r.json();
        const posters = imgs.posters || [];
        if (!posters.length) return null;

        const byLang = (langs) =>
          posters.filter(p => langs.includes(p.iso_639_1 || "null"));
        let candidatos = byLang(["pt-BR", "pt-br"]);
        if (!candidatos.length) candidatos = byLang(["pt"]);
        if (!candidatos.length) candidatos = byLang(["en"]);
        if (!candidatos.length) candidatos = posters;

        const randomIndex = Math.floor(Math.random() * Math.min(candidatos.length, 5));
        const preferClean = candidatos[randomIndex];

        return preferClean && preferClean.file_path
          ? `https://image.tmdb.org/t/p/original${preferClean.file_path}`
          : null;
      };

      if (isExclusive) {
        try {
          const tmdbPoster = await escolherPosterTMDB();
          if (tmdbPoster && validarURL(tmdbPoster)) {
            effectivePosterUrl = tmdbPoster;
          } else {
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
    let titleY, synopseStartY, metaY;

    const wrapLimit = tipoNorm === "horizontal" ? 45 : 55;
    const maxLines = isOrionExclusivoVertical ? 7 : 6;
    let linhas = wrapText(sinopse || "", wrapLimit).slice(0, maxLines);

    let synopFontSize, lineHeight;
    if (tipoNorm === "horizontal") {
      if (linhas.length <= 2) { synopFontSize = 46; lineHeight = 62; }
      else if (linhas.length <= 3) { synopFontSize = 44; lineHeight = 58; }
      else if (linhas.length <= 4) { synopFontSize = 40; lineHeight = 54; }
      else { synopFontSize = 36; lineHeight = 48; }
    } else {
      if (linhas.length <= 2) { synopFontSize = 38; lineHeight = 52; }
      else if (linhas.length <= 4) { synopFontSize = 36; lineHeight = 48; }
      else { synopFontSize = 34; lineHeight = 46; }
    }

    if (isOrionX) {
      pW = 460; 
      pH = 680;
      pLeft = 90; 
      pTop = Math.round((height - pH) / 2) - 5; 

      const posterBase = await sharp(posterOriginal)
        .resize(pW, pH, { fit: "cover", position: "center" })
        .png()
        .toBuffer();
      const radius = 50;
      const roundedCorner = Buffer.from(`
        <svg width="${pW}" height="${pH}">
          <rect x="0" y="0" width="${pW}" height="${pH}" rx="${radius}" ry="${radius}"/>
        </svg>
      `);
      posterResized = await sharp(posterBase)
        .composite([{ input: roundedCorner, blend: "dest-in" }])
        .png()
        .toBuffer();

      let logoFanartLayer = null;
      let renderFallbackTitle = false;
      let titleLinesX = [];

      if (logoFanartBuffer) {
        try {
          const logoProcessed = await sharp(logoFanartBuffer)
            .resize(900, 300, { fit: "inside" })
            .png()
            .toBuffer();
          const { width: lw, height: lh } = await sharp(logoProcessed).metadata();
          const logoX = Math.round((width - lw) / 2);
          const logoY = 80;
          logoFanartLayer = { input: logoProcessed, top: logoY, left: logoX };
        } catch (err) {
          console.warn("Logo Fanart layer erro:", err.message);
          renderFallbackTitle = true;
        }
      } else {
        renderFallbackTitle = true;
      }

      if (renderFallbackTitle) {
        const titleWrapLimit = 15;
        titleLinesX = wrapText(titulo || "TÍTULO", titleWrapLimit).slice(0, 3);
      }

      const sinopseAreaX = pLeft + pW + 60; 
      const wrapLimitX = 26; 
      const maxLinesX = 12;
      let linhasX = wrapText(sinopse || "", wrapLimitX).slice(0, maxLinesX);
      
      const synopFontSizeX = 32;
      const lineHeightX = 46;
      
      const sinopseTotalH = linhasX.length * lineHeightX;
      const sinopseStartYX = pTop + ((pH - sinopseTotalH) / 2) - 40;

      const svgContent = `
        <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur in="SourceAlpha" stdDeviation="4"/>
              <feOffset dx="2" dy="2" result="offsetblur"/>
              <feComponentTransfer>
                <feFuncA type="linear" slope="0.5"/>
              </feComponentTransfer>
              <feMerge> 
                <feMergeNode/>
                <feMergeNode in="SourceGraphic"/> 
              </feMerge>
            </filter>
          </defs>
          <style>
            .synop {
              fill: #fff;
              font-family: 'Segoe UI', Arial, sans-serif;
              font-weight: 700;
              font-size: ${synopFontSizeX}px;
              letter-spacing: 0.5px;
              filter: url(#softShadow);
            }
            .fallback-title {
              fill: #fff;
              font-family: 'Arial Black', Arial, sans-serif;
              font-weight: 900;
              font-size: 80px;
              text-anchor: middle;
              filter: drop-shadow(0px 0px 20px #000);
              text-transform: uppercase;
            }
          </style>
          
          ${renderFallbackTitle ? titleLinesX.map((line, i) => `
            <text x="${width / 2}" y="${150 + (i * 90)}" class="fallback-title">${safeXml(line)}</text>
          `).join("") : ""}

          ${linhasX.map((line, i) => `
            <text x="${sinopseAreaX}" y="${sinopseStartYX + i * lineHeightX}" text-anchor="start" class="synop">${safeXml(line)}</text>
          `).join("")}
        </svg>
      `;
      const svgBuffer = Buffer.from(svgContent);

      const layers = [];
      
      let userLogoLayer = null;
      let secondaryLogoLayer = null;
      
      try {
        // Usar função centralizada com fallback
        const userLogo = await getUserLogoUrl(req.uid);
        
        if (userLogo && validarURL(userLogo)) {
          let lb = await fetchBuffer(userLogo, false);

          let lbSmall = await sharp(lb).resize(200, 200, { fit: "contain" }).png().toBuffer();
          const logoTop = Math.round(height - 30 - 200);
          const logoLeft = 30;
          userLogoLayer = { input: lbSmall, top: logoTop, left: logoLeft };

          const logoSecW = 300;
          const lbBig = await sharp(lb).resize(logoSecW).png().toBuffer();
          
          const lbBigBase64 = lbBig.toString('base64');
          const { width: wBig, height: hBig } = await sharp(lbBig).metadata();
          
          const svgLogoSec = `
            <svg width="${wBig}" height="${hBig}">
              <image href="data:image/png;base64,${lbBigBase64}" width="${wBig}" height="${hBig}" opacity="0.15" />
            </svg>
          `;
          const logoSecBuffer = Buffer.from(svgLogoSec);

          const logoSecX = sinopseAreaX - 40; 
          const logoSecY = sinopseStartYX + sinopseTotalH + 150; 

          secondaryLogoLayer = { input: logoSecBuffer, top: Math.round(logoSecY), left: Math.round(logoSecX) };
        }
      } catch (err) {
        console.warn("Erro ao processar logos do usuário:", err.message);
      }

      if (secondaryLogoLayer) layers.push(secondaryLogoLayer);
      if (overlayColorBuffer) layers.push({ input: overlayColorBuffer, top: 0, left: 0 });
      layers.push({ input: posterResized, top: pTop, left: pLeft });
      if (logoFanartLayer) layers.push(logoFanartLayer);
      layers.push({ input: svgBuffer, top: 0, left: 0 });
      if (userLogoLayer) layers.push(userLogoLayer);

      const final = await sharp(backgroundBuffer)
        .composite(layers)
        .png({ quality: 95 })
        .toBuffer();

      const safeTitle = titulo.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 50);
      res.setHeader("Content-Disposition", `attachment; filename=banner_${safeTitle}.png`);
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.send(final);
      console.log(`✅ Banner Bellatrix (SHADOW & POLISH) gerado: usuario=${req.uid} modelo=ORION_X cor=${corKey}`);
      return;
    }

    if (isOrionExclusivoVertical) {
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

      const posterBottom = pTop + pH;
      titleY = posterBottom + 90;

      let baseSynopseY = titleY + 55;
      let baseMetaY = baseSynopseY + (linhas.length * lineHeight);

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

      const spaceAfterPoster = tipoNorm === "horizontal" ? 190 : 230;
      const titleMargin = tipoNorm === "horizontal" ? 50 : 65;
      const spaceAfterTitle = tipoNorm === "horizontal" ? 45 : 55;

      const startY = pTop + pH + spaceAfterPoster;

      titleY = startY + titleMargin;
      synopseStartY = titleY + spaceAfterTitle;
      metaY = synopseStartY + (linhas.length * lineHeight) + 20;
    }

    let logoFanartLayer = null;
    if (logoFanartBuffer) {
      try {
        const maxLogoWVertical = Math.round(width * 0.9);
        const maxLogoHVertical = 420;

        const logoMaxW = tipoNorm === "horizontal" ? 1000 : Math.min(isOrionExclusivoVertical ? maxLogoWVertical : 1200, maxLogoWVertical);
        const logoMaxH = tipoNorm === "horizontal" ? 300 : (isOrionExclusivoVertical ? maxLogoHVertical : 360);

        const logoProcessed = await sharp(logoFanartBuffer)
          .resize(logoMaxW, logoMaxH, { fit: "inside" })
          .png()
          .toBuffer();

        const { width: lw, height: lh } = await sharp(logoProcessed).metadata();
        const textX = tipoNorm === "horizontal" ? (isPremium || isExclusive ? pLeft + pW + 100 : width / 2) : width / 2;
        const logoX = tipoNorm === "horizontal" ? textX : Math.round((width - lw) / 2);

        let logoY;
        if (isOrionExclusivoVertical) {
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

    const textX = tipoNorm === "horizontal" ? (isPremium || isExclusive ? pLeft + pW + 100 : width / 2) : width / 2;
    const textAnchor = tipoNorm === "horizontal" ? "start" : "middle";

    let titleFontSize;
    if (isRigel) {
      const titleLen = titleTextValue.length;
      if (titleLen > 35) titleFontSize = 28;
      else if (titleLen > 30) titleFontSize = 32;
      else if (titleLen > 25) titleFontSize = 36;
      else if (titleLen > 20) titleFontSize = 42;
      else if (titleLen > 15) titleFontSize = 48;
      else titleFontSize = 54;
      console.log(`🎯 RIGEL (PADRAO): Título com ${titleLen} caracteres, fonte ajustada para ${titleFontSize}px`);
    } else if (isBelteguese && shouldDrawTitleText) {
      const titleLen = titleTextValue.length;
      if (titleLen > 35) titleFontSize = 32;
      else if (titleLen > 30) titleFontSize = 38;
      else if (titleLen > 25) titleFontSize = 44;
      else if (titleLen > 20) titleFontSize = 52;
      else if (titleLen > 15) titleFontSize = 60;
      else titleFontSize = 68;
      console.log(`🎯 BELTEGUESE (ORION_EXCLUSIVO): Título com ${titleLen} caracteres, fonte ajustada para ${titleFontSize}px`);
    } else {
      titleFontSize = tipoNorm === "horizontal" ? 85 : (isOrionExclusivoVertical ? 72 : 78);
    }

    const metaFontSize = tipoNorm === "horizontal" ? 34 : 32;
    
    const metaTextColor = isBelteguese ? "#ffffff" : corConfig.hex;
    const metaStarColor = "#ffc107";
    
    if (isBelteguese) {
      console.log(`⭐ BELTEGUESE: Metadados forçados para BRANCO (#ffffff) e estrela DOURADA (#ffc107)`);
    }

    const metaParts = [];
    if (notaFinal) metaParts.push(parseFloat(notaFinal).toFixed(1));
    if (genero) metaParts.push(genero);
    if (anoFinal) metaParts.push(anoFinal);
    if (duracao) metaParts.push(formatTime(duracao));
    const metaString = metaParts.join(" • ");

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
            font-size: ${titleFontSize}px;
            letter-spacing: -1px;
            filter: url(#dropShadow);
          }
          .synop {
            fill: #ffffff;
            font-family: "Segoe UI", Arial, sans-serif;
            font-weight: 600;
            font-size: ${synopFontSize}px;
            letter-spacing: 0.3px;
            filter: url(#dropShadow);
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
            fill: ${metaStarColor};
          }
          .meta-text {
            fill: ${metaTextColor};
          }
        </style>

        ${shouldDrawTitleText ? `
        <text x="${textX}" y="${titleY}" text-anchor="${textAnchor}" class="title">
          ${safeXml(titleTextValue.toUpperCase())}
        </text>` : ""}

        ${linhas.map((line, i) => `
          <text x="${textX}" y="${synopseStartY + i * lineHeight}" text-anchor="${textAnchor}" class="synop">
            ${safeXml(line)}
          </text>
        `).join("")}

        <text x="${textX}" y="${metaY}" text-anchor="${textAnchor}" class="meta">
          <tspan class="meta-star">★ </tspan>
          <tspan class="meta-text">${safeXml(metaString)}</tspan>
        </text>

      </svg>
    `;
    const svgBuffer = Buffer.from(svgContent);

    let userLogoLayer = null;
    try {
      // Usar função centralizada com fallback
      const userLogo = await getUserLogoUrl(req.uid);
      if (userLogo && validarURL(userLogo)) {
        let lb = await fetchBuffer(userLogo, false);
        lb = await sharp(lb).resize(180, 180, { fit: "contain" }).png().toBuffer();
        userLogoLayer = { input: lb, top: 40, left: width - 220 };
      }
    } catch {}

    const layers = [];

    if (isOrionExclusivoVertical && overlayColorBuffer) {
      layers.push({ input: posterResized, top: pTop, left: pLeft });
      layers.push({ input: overlayColorBuffer, top: 0, left: 0 });
    } else {
      if (overlayColorBuffer) {
        layers.push({ input: overlayColorBuffer, top: 0, left: 0 });
      }
      layers.push({ input: posterResized, top: pTop, left: pLeft });
    }

    if (logoFanartLayer) layers.push(logoFanartLayer);
    layers.push({ input: svgBuffer, top: 0, left: 0 });
    if (userLogoLayer) layers.push(userLogoLayer);

    const final = await sharp(backgroundBuffer)
      .composite(layers)
      .png({ quality: 95 })
      .toBuffer();

    const safeTitle = titulo.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 50);
    
    // Salvar no Cloudinary e registrar no Firestore para "Últimas Criações"
    console.log(`💾 Iniciando salvamento: UID=${req.uid}, Título=${titulo}`);
    
    try {
      const cloudinaryResult = await new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder: `orion/banners/${req.uid}`,
            public_id: `banner_${safeTitle}_${Date.now()}`,
            resource_type: 'image',
            format: 'png'
          },
          (error, result) => {
            if (error) {
              console.error(`❌ Cloudinary upload FALHOU:`, error);
              reject(error);
            } else {
              console.log(`✅ Cloudinary OK: ${result.public_id}`);
              resolve(result);
            }
          }
        );
        uploadStream.end(final);
      });
      
      // Salvar referência no Firestore
      const bannerDoc = await db.collection("banners").add({
        uid: req.uid,
        titulo: titulo,
        url: cloudinaryResult.secure_url,
        publicId: cloudinaryResult.public_id,
        modelo: modeloTipo || "PADRAO",
        cor: corKey,
        tipo: tipoNorm,
        tmdbId: tmdbId || null,
        tmdbTipo: tmdbTipo || null,
        criadoEm: admin.firestore.FieldValue.serverTimestamp()
      });
      
      console.log(`✅ Firestore OK: ID=${bannerDoc.id}`);
      console.log(`✅ URL: ${cloudinaryResult.secure_url}`);
    } catch (saveErr) {
      console.error("❌❌❌ ERRO AO SALVAR BANNER:", saveErr.message, saveErr);
      // NÃO silenciar - continuar mas logar fortemente
    }
    
    res.setHeader("Content-Disposition", `attachment; filename=banner_${safeTitle}.png`);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(final);

    console.log(`✅ Banner gerado: usuario=${req.uid} modelo=${modeloTipo || "PADRAO"} cor=${corKey} overlay=${!!overlayColorBuffer}`);

  } catch (err) {
    console.error("❌ Erro gerar banner:", err.message);
    res.status(500).json({ error: "Falha ao gerar o banner", details: err.message });
  }
});

// Função para processar FFmpeg com progresso
async function spawnProcessWithProgress(command, args, onProgress) {
  return new Promise((resolve, reject) => {
    const process = spawn(command, args);
    let stdout = '';
    let stderr = '';
    
    process.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    process.stderr.on('data', (data) => {
      const text = data.toString();
      stderr += text;
      
      // Extrair progresso do FFmpeg
      if (onProgress && text.includes('time=')) {
        const timeMatch = text.match(/time=(\d{2}):(\d{2}):(\d{2})/);
        if (timeMatch) {
          const hours = parseInt(timeMatch[1]);
          const minutes = parseInt(timeMatch[2]);
          const seconds = parseInt(timeMatch[3]);
          const currentTime = hours * 3600 + minutes * 60 + seconds;
          onProgress(currentTime);
        }
      }
    });
    
    process.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const error = new Error(`${command} falhou (código ${code})`);
        error.stderr = stderr;
        error.stdout = stdout;
        reject(error);
      }
    });
    
    process.on('error', (err) => {
      const error = new Error(`Falha ao executar ${command}: ${err.message}`);
      error.originalError = err;
      reject(error);
    });
  });
}

// Endpoint SSE para receber progresso em tempo real
app.get("/api/video-progress/:jobId", verificarAuth, (req, res) => {
  const { jobId } = req.params;
  const userId = req.uid;
  
  // Headers SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  
  // Salvar conexão
  const connectionKey = `${userId}:${jobId}`;
  progressConnections.set(connectionKey, res);
  
  // Enviar ping inicial
  res.write('data: {"status":"connected"}\n\n');
  
  // Cleanup ao desconectar
  req.on('close', () => {
    progressConnections.delete(connectionKey);
  });
});

// Função auxiliar para enviar progresso
function sendProgress(userId, jobId, data) {
  const connectionKey = `${userId}:${jobId}`;
  const connection = progressConnections.get(connectionKey);
  if (connection) {
    connection.write(`data: ${JSON.stringify(data)}\n\n`);
  }
}

app.post("/api/gerar-video", verificarAuth, videoLimiter, async (req, res) => {
  const tempFiles = [];
  const startTime = Date.now(); // Cronometrar tempo total
  let requestAborted = false;
  
  // Detectar se cliente abortou requisição
  req.on('close', () => {
    if (!res.headersSent) {
      requestAborted = true;
      console.log("⚠️ Requisição abortada pelo cliente");
    }
  });
  
  try {
    const { tmdbId, tmdbTipo, duracao, temporada, qualidade } = req.body || {};

    console.log(`\n🎬 ==========================================`);
    console.log(`   GERAÇÃO DE VÍDEO INICIADA`);
    console.log(`   TMDB ID: ${tmdbId} | Tipo: ${tmdbTipo}`);
    console.log(`   Duração: ${duracao}s | Qualidade: ${qualidade}p`);
    console.log(`   ⏱️ Início: ${new Date().toLocaleTimeString('pt-BR')}`);
    console.log(`==========================================\n`);

    if (!tmdbId) return res.status(400).json({ error: "tmdbId obrigatório" });
    
    // Validações de segurança para parâmetros numéricos
    if (!/^\d+$/.test(String(tmdbId))) {
      return res.status(400).json({ error: "tmdbId deve ser numérico" });
    }
    if (temporada && (isNaN(parseInt(temporada, 10)) || parseInt(temporada, 10) < 0)) {
      return res.status(400).json({ error: "temporada deve ser um número válido" });
    }
    
    if (!tmdbTipo || !["movie", "tv"].includes(tmdbTipo)) {
      return res.status(400).json({ error: "tmdbTipo deve ser 'movie' ou 'tv'" });
    }
    if (![30, 60, 90].includes(parseInt(duracao))) {
      return res.status(400).json({ error: "Duração deve ser 30, 60 ou 90 segundos" });
    }

    // Validar qualidade (480, 720, 1080)
    const qualidadeNum = parseInt(qualidade) || 720;
    if (![480, 720, 1080].includes(qualidadeNum)) {
      return res.status(400).json({ error: "Qualidade deve ser 480, 720 ou 1080" });
    }

    // ====== CONFIGURAÇÃO DE QUALIDADE (OTIMIZADA PARA PERFORMANCE) ======
    const QUALITY_PRESETS = {
      480: {
        name: 'SD',
        width: 854,
        height: 480,
        // Para formato vertical 9:16
        verticalWidth: 480,
        verticalHeight: 854,
        // FFmpeg settings
        crf: 28,
        preset: 'veryfast',
        tune: 'fastdecode',
        profile: 'baseline',
        level: '3.0',
        // Bitrates por duração
        bitrates: {
          30: { video: '1200k', audio: '64k', bufsize: '1500k' },
          60: { video: '900k', audio: '64k', bufsize: '1200k' },
          90: { video: '700k', audio: '64k', bufsize: '1000k' }
        },
        // Download quality
        ytdlpFormat: 'best[height<=480]',
        estimatedTime: '~30 segundos'
      },
      720: {
        name: 'HD',
        width: 1280,
        height: 720,
        verticalWidth: 720,
        verticalHeight: 1280,
        crf: 26,
        preset: 'fast',
        tune: 'film',
        profile: 'main',
        level: '3.1',
        bitrates: {
          30: { video: '2500k', audio: '96k', bufsize: '3000k' },
          60: { video: '1800k', audio: '96k', bufsize: '2500k' },
          90: { video: '1200k', audio: '96k', bufsize: '1800k' }
        },
        ytdlpFormat: 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best[height<=720]',
        estimatedTime: '~1 minuto'
      },
      1080: {
        name: 'Full HD',
        width: 1920,
        height: 1080,
        verticalWidth: 1080,
        verticalHeight: 1920,
        crf: 23,
        preset: 'medium',
        tune: 'film',
        profile: 'high',
        level: '4.1',
        bitrates: {
          30: { video: '6000k', audio: '128k', bufsize: '8000k' },
          60: { video: '4500k', audio: '128k', bufsize: '6000k' },
          90: { video: '3500k', audio: '128k', bufsize: '5000k' }
        },
        ytdlpFormat: 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best[height<=1080]',
        estimatedTime: '~2 minutos'
      }
    };

    const qualityConfig = QUALITY_PRESETS[qualidadeNum];
    const bitrateConfig = qualityConfig.bitrates[parseInt(duracao)];
    const quality = `${qualidadeNum}p`; // "480p", "720p", ou "1080p"

    console.log(`📊 Configuração de qualidade: ${qualidadeNum}p (${qualityConfig.name})`);
    console.log(`   Resolução final: ${qualityConfig.verticalWidth}x${qualityConfig.verticalHeight}`);
    console.log(`   Bitrate: ${bitrateConfig.video} | CRF: ${qualityConfig.crf} | Preset: ${qualityConfig.preset}`);

    const duracaoNum = parseInt(duracao);
    const tempDir = path.join(__dirname, "temp");
    const outputDir = path.join(__dirname, "public", "videos");
    
    await fsPromises.mkdir(tempDir, { recursive: true });
    await fsPromises.mkdir(outputDir, { recursive: true });

    console.log("📡 1/8 - Buscando dados no TMDB...");
    const detailsUrl = buildTMDBUrl(`/${tmdbTipo}/${tmdbId}`, {
      append_to_response: "videos,images,credits",
      include_image_language: "pt,en,null"
    });
    const detailsResp = await fetchWithTimeout(detailsUrl, {}, 15000);
    if (!detailsResp.ok) {
      return res.status(404).json({ error: "Filme/Série não encontrado no TMDB" });
    }
    const details = await detailsResp.json();

    const titulo = details.title || details.name || "Título Desconhecido";
    const sinopse = details.overview || "Sinopse não disponível.";
    let ano = (details.release_date || details.first_air_date || "").slice(0, 4);
    let nota = details.vote_average || 0;
    const generos = details.genres?.map(g => g.name).slice(0, 2).join(", ") || "";
    const runtime = details.runtime || (details.episode_run_time?.[0]) || 0;

    if (tmdbTipo === "tv" && temporada) {
      try {
        const seasonUrl = buildTMDBUrl(`/tv/${tmdbId}/season/${temporada}`);
        const seasonResp = await fetchWithTimeout(seasonUrl);
        if (seasonResp.ok) {
          const seasonData = await seasonResp.json();
          if (seasonData.air_date) ano = seasonData.air_date.slice(0, 4);
          if (seasonData.vote_average && seasonData.vote_average > 0) {
            nota = seasonData.vote_average;
          }
        }
      } catch (err) {
        console.warn("⚠️ Falha ao buscar dados da temporada:", err.message);
      }
    }

    console.log(`✅ Dados: "${titulo}" (${ano})`);

    console.log("🎥 2/8 - Buscando vídeo/trailer OFICIAL (apenas YouTube ou TMDB)...");
    let videos = details.videos?.results || [];
    
    // Para SÉRIES, buscar trailer específico da temporada
    if (tmdbTipo === "tv" && temporada) {
      try {
        console.log(`   Buscando trailer da temporada ${temporada}...`);
        const seasonUrl = buildTMDBUrl(`/tv/${tmdbId}/season/${temporada}`, { append_to_response: "videos" });
        const seasonResp = await fetchWithTimeout(seasonUrl);
        if (seasonResp.ok) {
          const seasonData = await seasonResp.json();
          if (seasonData.videos?.results && seasonData.videos.results.length > 0) {
            videos = seasonData.videos.results;
            console.log(`   ✅ Usando trailers da temporada ${temporada} (${videos.length} vídeos encontrados)`);
          } else {
            console.log(`   ⚠️ Nenhum trailer específico da temporada ${temporada}, usando trailers da série`);
          }
        }
      } catch (err) {
        console.warn(`   ⚠️ Falha ao buscar trailers da temporada: ${err.message}`);
      }
    }
    
    // Buscar TRAILERS OFICIAIS apenas (tipo Trailer ou Teaser)
    // Ordem de prioridade: Trailer oficial PT-BR > PT > EN > Teaser PT-BR > PT > EN
    const findOfficialTrailer = (lang, type) => videos.find(v => 
      v.site === "YouTube" && v.type === type && v.iso_639_1 === lang
    );
    const findAnyOfficialTrailer = (type) => videos.find(v => 
      v.site === "YouTube" && v.type === type
    );
    
    // Prioridade: Trailer oficial (PT-BR > PT > EN > qualquer) depois Teaser (PT-BR > PT > EN)
    let trailer = findOfficialTrailer("pt-BR", "Trailer") || 
                  findOfficialTrailer("pt", "Trailer") || 
                  findOfficialTrailer("en", "Trailer") || 
                  findAnyOfficialTrailer("Trailer") ||
                  findOfficialTrailer("pt-BR", "Teaser") || 
                  findOfficialTrailer("pt", "Teaser") || 
                  findOfficialTrailer("en", "Teaser") || 
                  findAnyOfficialTrailer("Teaser");
    
    let trailerKey = null;
    let useCreatedVideo = false;
    
    // Regex para validar ID do YouTube (11 caracteres alfanuméricos, hífens e underscores)
    const youtubeIdRegex = /^[a-zA-Z0-9_-]{11}$/;
    
    if (trailer && trailer.site === "YouTube" && youtubeIdRegex.test(trailer.key)) {
      trailerKey = trailer.key;
      console.log(`✅ Vídeo encontrado no YouTube: ${trailerKey} (${trailer.iso_639_1 || 'sem idioma'})`);
    } else {
      // Criar vídeo placeholder com backdrop animado
      if (trailer && trailer.site === "YouTube") {
        console.log(`⚠️ ID do YouTube inválido: ${trailer.key}`);
      }
      console.log("⚠️ Nenhum vídeo disponível - criando vídeo placeholder com backdrop animado");
      useCreatedVideo = true;
      trailerKey = `placeholder_${tmdbId}`;
    }

    console.log("⬇️ 3/8 - Obtendo/Criando vídeo...");
    const trailerPath = path.join(tempDir, `trailer_${trailerKey}.mp4`);
    tempFiles.push(trailerPath);

    let downloadSuccess = false;
    let lastError = null;

    if (useCreatedVideo) {
      // Criar vídeo placeholder com movimento
      console.log("   Criando vídeo placeholder com zoom suave...");
      try {
        await spawnProcess('ffmpeg', [
          '-f', 'lavfi',
          '-i', 'color=c=#0a0a15:s=1920x1080:d=30',
          '-f', 'lavfi',
          '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
          '-vf', 'zoompan=z=\'min(zoom+0.0015,1.5)\':d=1:s=1920x1080,fade=in:0:30',
          '-c:v', 'libx264',
          '-preset', 'ultrafast',
          '-t', '30',
          '-pix_fmt', 'yuv420p',
          '-c:a', 'aac',
          '-y', trailerPath
        ]);
        downloadSuccess = true;
        console.log(`   ✅ Vídeo placeholder criado`);
      } catch (err) {
        console.error(`   ❌ Falha ao criar placeholder: ${err.message}`);
      }
    } else {
      // Baixar do YouTube
      console.log(`   URL: https://www.youtube.com/watch?v=${trailerKey}`);
      console.log(`   Destino: ${trailerPath}`);

      // Usar qualidade configurada pelo usuário
      const formatString = qualityConfig.ytdlpFormat;

      // ESTRATÉGIA 1: yt-dlp com qualidade escolhida
      try {
        console.log(`   Tentativa 1: yt-dlp ${qualidadeNum}p ${qualityConfig.name}...`);
        
        await spawnProcess('yt-dlp', [
          '-f', formatString,
          '--no-playlist',
          '--no-warnings',
          '--socket-timeout', '15',
          '--retries', '2',
          '--no-check-certificates',
          '--merge-output-format', 'mp4',
        '-o', trailerPath,
        `https://www.youtube.com/watch?v=${trailerKey}`
      ]);
      
      const fileExists = await fsPromises.access(trailerPath).then(() => true).catch(() => false);
      if (fileExists) {
        downloadSuccess = true;
        console.log(`   ✅ Sucesso com yt-dlp (${qualidadeNum}p ${qualityConfig.name})`);
      }
    } catch (err) {
      lastError = err;
      console.log(`   ⚠️ Falhou com yt-dlp: ${err.message}`);
    }

    // ESTRATÉGIA 2: Fallback para qualidade menor se primeira falhou
    if (!downloadSuccess) {
      try {
        console.log("   Tentativa 2: yt-dlp qualidade 480p (fallback)...");
        await spawnProcess('yt-dlp', [
          '-f', 'best[height<=480]',
          '--no-playlist',
          '--socket-timeout', '10',
          '--retries', '1',
          '-o', trailerPath,
          `https://www.youtube.com/watch?v=${trailerKey}`
        ]);
        
        const fileExists = await fsPromises.access(trailerPath).then(() => true).catch(() => false);
        if (fileExists) {
          downloadSuccess = true;
          console.log(`   ✅ Sucesso com yt-dlp (480p fallback)`);
        }
      } catch (err) {
        lastError = err;
        console.log(`   ⚠️ Falhou com yt-dlp (fallback): ${err.message}`);
      }
    }

    // ESTRATÉGIA 3: Criar vídeo placeholder se tudo falhar
    if (!downloadSuccess) {
      console.log("   Tentativa 3: Criando vídeo placeholder...");
      try {
        await spawnProcess('ffmpeg', [
          '-f', 'lavfi',
          '-i', 'color=c=black:s=1920x1080:d=30',
          '-f', 'lavfi',
          '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
          '-c:v', 'libx264',
          '-preset', 'ultrafast',
          '-t', '30',
          '-pix_fmt', 'yuv420p',
          '-c:a', 'aac',
          '-y', trailerPath
        ]);
        
        const fileExists = await fsPromises.access(trailerPath).then(() => true).catch(() => false);
        if (fileExists) {
          downloadSuccess = true;
          console.log(`   ⚠️ Usando vídeo placeholder (trailer não disponível)`);
        }
      } catch (err) {
        console.log(`   ❌ Falhou ao criar placeholder: ${err.message}`);
      }
    }
  } // Fim do bloco else (download do YouTube)

    if (!downloadSuccess) {
      console.error("❌ Todas as estratégias falharam");
      console.error("   Último erro:", lastError?.message);
      if (lastError?.stderr) console.error("   stderr:", lastError.stderr);
      
      await Promise.all(tempFiles.map(f => fsPromises.unlink(f).catch(() => {})));
      
      return res.status(500).json({ 
        error: "Falha ao obter trailer", 
        details: "Verifique se yt-dlp está instalado corretamente",
        trailerKey: trailerKey
      });
    }

    console.log(`✅ Trailer obtido com sucesso`);


    console.log("🚀 4/8 - Buscando e processando imagens em paralelo (OTIMIZADO)...");
    
    // PARALELIZAÇÃO: Buscar URLs de logo, poster e backdrop simultaneamente
    const [logoUrl, posterUrl, backdropUrl] = await Promise.all([
      // Logo
      (async () => {
        const logos = details.images?.logos || [];
        const findLogo = (langs) => logos.find(l => langs.includes(l.iso_639_1 || "null"));
        const chosenLogo = findLogo(["pt", "pt-BR"]) || findLogo(["en", "null"]) || logos[0];
        if (chosenLogo?.file_path) {
          return `https://image.tmdb.org/t/p/original${chosenLogo.file_path}`;
        }
        // Fallback: Fanart API
        try {
          let fanartData = null;
          if (tmdbTipo === "movie") {
            fanartData = await fanartService.getMovieArt(tmdbId);
          } else if (tmdbTipo === "tv") {
            fanartData = await fanartService.getTVArt(tmdbId);
          }
          if (fanartData?.hdmovielogo?.[0]) return fanartData.hdmovielogo[0].url;
          if (fanartData?.movielogo?.[0]) return fanartData.movielogo[0].url;
          if (fanartData?.hdtvlogo?.[0]) return fanartData.hdtvlogo[0].url;
          if (fanartData?.clearlogo?.[0]) return fanartData.clearlogo[0].url;
        } catch (err) {
          console.warn(`⚠️ Fanart: ${err.message}`);
        }
        return null;
      })(),
      // Poster
      (async () => {
        const posters = details.images?.posters || [];
        if (tmdbTipo === "tv" && temporada) {
          try {
            const seasonUrl = buildTMDBUrl(`/tv/${tmdbId}/season/${temporada}`, { append_to_response: "images" });
            const seasonResp = await fetchWithTimeout(seasonUrl);
            if (seasonResp.ok) {
              const seasonData = await seasonResp.json();
              if (seasonData.poster_path) {
                return `https://image.tmdb.org/t/p/original${seasonData.poster_path}`;
              }
            }
          } catch (err) {
            console.warn(`⚠️ Poster temporada: ${err.message}`);
          }
        }
        const findPoster = (langs) => posters.find(p => langs.includes(p.iso_639_1 || "null"));
        const chosenPoster = findPoster(["pt", "pt-BR"]) || findPoster(["en", "null"]) || posters[0];
        if (chosenPoster?.file_path) {
          return `https://image.tmdb.org/t/p/original${chosenPoster.file_path}`;
        }
        if (details.poster_path) {
          return `https://image.tmdb.org/t/p/original${details.poster_path}`;
        }
        return null;
      })(),
      // Backdrop
      (async () => {
        const backdrops = details.images?.backdrops || [];
        if (backdrops.length > 0) {
          const randomIndex = Math.floor(Math.random() * Math.min(backdrops.length, 5));
          return `https://image.tmdb.org/t/p/original${backdrops[randomIndex].file_path}`;
        }
        if (details.backdrop_path) {
          return `https://image.tmdb.org/t/p/original${details.backdrop_path}`;
        }
        return null;
      })()
    ]);

    if (!posterUrl) {
      await Promise.all(tempFiles.map(f => fsPromises.unlink(f).catch(() => {})));
      return res.status(404).json({ error: "Poster não disponível para este título" });
    }

    console.log(`✅ URLs obtidas - Logo: ${!!logoUrl} | Poster: ✓ | Backdrop: ${!!backdropUrl}`);

    console.log("⚡ 5/8 - Baixando e processando imagens em paralelo...");
    
    // PARALELIZAÇÃO: Baixar e processar todas as imagens simultaneamente
    const [posterBuffer, logoBuffer, backdropBuffer] = await Promise.all([
      fetchBuffer(posterUrl),
      logoUrl ? fetchBuffer(logoUrl).catch(err => { console.warn(`⚠️ Logo fetch: ${err.message}`); return null; }) : null,
      backdropUrl ? fetchBuffer(backdropUrl).catch(err => { console.warn(`⚠️ Backdrop fetch: ${err.message}`); return null; }) : null
    ]);

    console.log("🎨 6/8 - Processando imagens com Sharp (ULTRA-RÁPIDO)...");
    
    // Processar backdrop com otimização máxima - usando resolução da qualidade escolhida
    let backdropPath = null;
    if (backdropBuffer) {
      backdropPath = path.join(tempDir, `backdrop_${tmdbId}.png`);
      await sharp(backdropBuffer)
        .resize(qualityConfig.verticalWidth, qualityConfig.verticalHeight, { fit: "cover", position: "center", kernel: 'nearest' })
        .blur(2) // Reduzido de 3 para 2
        .linear(0.7, 0) // Escurecer 30% (mais rápido que composite)
        .png({ compressionLevel: 1, effort: 1 }) // Compressão mínima
        .toFile(backdropPath);
      tempFiles.push(backdropPath);
    } else {
      backdropPath = path.join(tempDir, `backdrop_${tmdbId}.png`);
      await sharp({
        create: { width: qualityConfig.verticalWidth, height: qualityConfig.verticalHeight, channels: 4, background: { r: 5, g: 5, b: 10, alpha: 1 } }
      }).png({ compressionLevel: 1 }).toFile(backdropPath);
      tempFiles.push(backdropPath);
    }

    console.log("🖌️ 7/8 - Gerando composição visual OTIMIZADA...");
    
    // Buscar logo do usuário com fallback
    const userLogo = await getUserLogoUrl(req.uid);
    
    // Dimensões do vídeo final (vertical) - baseado na qualidade escolhida
    const videoWidth = qualityConfig.verticalWidth;
    const videoHeight = qualityConfig.verticalHeight;
    
    // Escalar elementos proporcionalmente à resolução
    const scaleFactor = videoWidth / 1080;
    const posterWidth = Math.round(382 * scaleFactor);
    const posterHeight = Math.round(548 * scaleFactor);
    const posterX = Math.round(570 * scaleFactor);
    const posterY = Math.round(880 * scaleFactor);
    
    // PARALELIZAÇÃO: Processar poster, logo oficial e logo do cliente simultaneamente
    const [posterResized, logoProcessed, userLogoResized] = await Promise.all([
      // Poster com bordas arredondadas (otimizado)
      sharp(posterBuffer)
        .resize(posterWidth, posterHeight, { fit: "cover", position: "center", kernel: 'cubic' })
        .composite([{
          input: Buffer.from(
            `<svg width="${posterWidth}" height="${posterHeight}">
              <rect x="0" y="0" width="${posterWidth}" height="${posterHeight}" rx="20" ry="20" fill="white"/>
            </svg>`
          ),
          blend: 'dest-in'
        }])
        .png({ compressionLevel: 1 })
        .toBuffer(),
      // Logo oficial - escalar proporcionalmente
      logoBuffer ? sharp(logoBuffer)
        .resize(Math.round(450 * scaleFactor), Math.round(120 * scaleFactor), { fit: "inside", withoutEnlargement: true, kernel: 'cubic' })
        .png({ compressionLevel: 1 })
        .toBuffer()
        .catch(err => { console.warn(`⚠️ Logo processo: ${err.message}`); return null; }) : null,
      // Logo do cliente - escalar proporcionalmente
      (userLogo && validarURL(userLogo)) ? fetchBuffer(userLogo, false)
        .then(buf => sharp(buf)
          .resize(Math.round(280 * scaleFactor), Math.round(280 * scaleFactor), { fit: "contain", withoutEnlargement: true, kernel: 'cubic' })
          .png({ compressionLevel: 1 })
          .toBuffer()
        )
        .catch(err => { console.warn(`⚠️ User logo: ${err.message}`); return null; }) : null
    ]);
    
    // Preparar composições
    const composites = [];
    
    // 1. Adicionar poster do filme
    composites.push({
      input: posterResized,
      top: posterY,
      left: posterX
    });
    
    // 2. Logo oficial - posição escalada
    if (logoProcessed) {
      composites.push({
        input: logoProcessed,
        top: Math.round(780 * scaleFactor),
        left: Math.round(60 * scaleFactor)
      });
    }
    
    // 3. Logo do cliente - posição escalada
    if (userLogoResized) {
      composites.push({
        input: userLogoResized,
        top: Math.round(1170 * scaleFactor),
        left: Math.round(120 * scaleFactor)
      });
    }
    
    // 4. Criar overlay com textos (título se não houver logo, sinopse, metadados)
    // Título abaixo do trailer/backdrop
    const wrapChars = Math.round(22 / scaleFactor); // Ajustar wrap para resolução
    const titleLines = logoUrl ? [] : wrapText(titulo.toUpperCase(), Math.max(15, wrapChars));
    const baseTitleFontSize = titulo.length > 30 ? 38 : titulo.length > 20 ? 44 : 50;
    const titleFontSize = Math.round(baseTitleFontSize * scaleFactor);
    
    // Sinopse MAIS COMPRIDA HORIZONTALMENTE, MENOS quebras
    const synopWrapChars = Math.round(50 / scaleFactor);
    const synopLines = wrapText(sinopse, Math.max(30, synopWrapChars)).slice(0, 4);
    const synopFontSize = Math.round(24 * scaleFactor);
    
    // Metadados em caixinhas
    const metaItems = [];
    metaItems.push(`★ ${nota.toFixed(1)}`);
    metaItems.push(ano);
    if (temporada) metaItems.push(`Temp. ${temporada}`);
    if (generos) {
      const generosSplit = generos.split(", ");
      metaItems.push(...generosSplit.slice(0, 2));
    }
    
    // Dimensões escaladas para SVG
    const svgPadding = Math.round(60 * scaleFactor);
    const titleY = Math.round(740 * scaleFactor);
    const synopLineHeight = Math.round(36 * scaleFactor);
    // Sinopse Y dinâmico - ajusta conforme o número de linhas
    const synopTotalHeight = synopLines.length * synopLineHeight;
    const synopBaseY = 1500; // Base para 4 linhas
    const synopY = Math.round((synopBaseY + (4 - synopLines.length) * 18) * scaleFactor);
    // Metadados Y dinâmico - sempre abaixo da sinopse
    const metaBoxY = synopY + synopTotalHeight + Math.round(30 * scaleFactor);
    const metaBoxWidth = Math.round(150 * scaleFactor);
    const metaBoxHeight = Math.round(45 * scaleFactor);
    const metaBoxGap = Math.round(160 * scaleFactor);
    const metaFontSize = Math.round(18 * scaleFactor);
    const strokeWidth = Math.max(1, Math.round(2 * scaleFactor));
    const borderRadius = Math.round(15 * scaleFactor);
    
    const svgOverlay = `
      <svg width="${videoWidth}" height="${videoHeight}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <filter id="textShadow">
            <feDropShadow dx="0" dy="${Math.round(2 * scaleFactor)}" stdDeviation="${Math.round(3 * scaleFactor)}" flood-opacity="0.8"/>
          </filter>
          <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" style="stop-color:#FFD700;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#FFA500;stop-opacity:1" />
          </linearGradient>
        </defs>
        
        <style>
          .title {
            fill: white;
            font-family: 'Arial Black', sans-serif;
            font-weight: 900;
            font-size: ${titleFontSize}px;
            text-anchor: start;
            filter: url(#textShadow);
            letter-spacing: ${Math.max(0.5, scaleFactor)}px;
          }
          .synop {
            fill: #ffffff;
            font-family: Arial, sans-serif;
            font-weight: 500;
            font-size: ${synopFontSize}px;
            text-anchor: start;
            filter: url(#textShadow);
          }
          .meta-box {
            fill: rgba(255, 255, 255, 0.1);
            stroke: #ffffff;
            stroke-width: ${strokeWidth};
            rx: ${borderRadius};
          }
          .meta-text {
            fill: #ffffff;
            font-family: Arial, sans-serif;
            font-weight: 700;
            font-size: ${metaFontSize}px;
            text-anchor: middle;
            filter: url(#textShadow);
          }
        </style>
        
        <!-- Título ABAIXO do trailer/backdrop (se não houver logo) -->
        ${!logoUrl && titleLines.length > 0 ? titleLines.map((line, i) => 
          `<text x="${svgPadding}" y="${titleY + i * (titleFontSize + Math.round(10 * scaleFactor))}" class="title" text-anchor="start">${safeXml(line)}</text>`
        ).join("") : ''}
        
        <!-- Sinopse PRIMEIRO (subiu) -->
        ${synopLines.map((line, i) => 
          `<text x="${svgPadding}" y="${synopY + i * synopLineHeight}" class="synop">${safeXml(line)}</text>`
        ).join("")}
        
        <!-- Metadados MAIS PERTO da sinopse, alinhados à esquerda -->
        ${metaItems.slice(0, 3).map((item, i) => {
          const boxX = svgPadding + (i * metaBoxGap);
          const boxY = metaBoxY;
          const boxWidth = metaBoxWidth;
          const boxHeight = metaBoxHeight;
          return `
            <rect class="meta-box" x="${boxX}" y="${boxY}" width="${boxWidth}" height="${boxHeight}"/>
            <text class="meta-text" x="${boxX + boxWidth/2}" y="${boxY + boxHeight/2 + 6}">${safeXml(item)}</text>
          `;
        }).join("")}
      </svg>
    `;
    
    const svgBuffer = Buffer.from(svgOverlay);
    composites.push({
      input: svgBuffer,
      top: 0,
      left: 0
    });
    
    // Criar frame TRANSPARENTE (otimizado)
    const framePath = path.join(tempDir, `frame_${tmdbId}.png`);
    await sharp({
      create: {
        width: videoWidth,
        height: videoHeight,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      }
    })
      .composite(composites)
      .png({ compressionLevel: 1, effort: 1 }) // Compressão mínima
      .toFile(framePath);
    
    tempFiles.push(framePath);
    console.log(`✅ Frame visual gerado (${videoWidth}x${videoHeight})`);


    console.log("✂️ 8/8 - Cortando trailer (ULTRA-RÁPIDO)...");
    
    if (requestAborted) {
      await Promise.all(tempFiles.map(f => fsPromises.unlink(f).catch(() => {})));
      return;
    }
    
    const trimmedPath = path.join(tempDir, `trailer_trimmed_${tmdbId}.mp4`);
    tempFiles.push(trimmedPath);

    try {
      const cutStart = Date.now();
      
      try {
        // Tentar corte com COPY (instantâneo)
        await spawnProcess('ffmpeg', [
          '-ss', '0',
          '-i', trailerPath,
          '-t', duracaoNum.toString(),
          '-c', 'copy',
          '-avoid_negative_ts', 'make_zero',
          '-y', trimmedPath
        ]);
        const cutTime = Math.floor((Date.now() - cutStart) / 1000);
        console.log(`✅ Corte instantâneo (${cutTime}s)`);
      } catch (copyErr) {
        // Fallback: preset baseado na qualidade
        await spawnProcess('ffmpeg', [
          '-i', trailerPath,
          '-t', duracaoNum.toString(),
          '-c:v', 'libx264',
          '-preset', qualityConfig.preset,
          '-crf', String(qualityConfig.crf + 2), // CRF um pouco maior no corte
          '-tune', 'fastdecode',
          '-c:a', 'aac',
          '-b:a', '80k',
          '-threads', '0',
          '-y', trimmedPath
        ]);
        const cutTime = Math.floor((Date.now() - cutStart) / 1000);
        console.log(`✅ Recodificado ${qualityConfig.preset} (${cutTime}s)`);
      }
    } catch (err) {
      console.error("❌ Erro ao cortar:", err.message);
      await Promise.all(tempFiles.map(f => fsPromises.unlink(f).catch(() => {})));
      return res.status(500).json({ error: "Falha ao processar trailer" });
    }

    console.log(`🎬 9/9 - Composição final (${quality})...`);
    
    if (requestAborted) {
      await Promise.all(tempFiles.map(f => fsPromises.unlink(f).catch(() => {})));
      return;
    }
    
    const overlayPath = path.join(__dirname, "public", "images", "videos", "overlay.png");
    
    if (!await fileExists(overlayPath)) {
      await Promise.all(tempFiles.map(f => fsPromises.unlink(f).catch(() => {})));
      return res.status(404).json({ error: "Overlay não encontrado" });
    }

    const outputFilename = `video_${tmdbId}_${quality}_${Date.now()}.mp4`;
    const outputPath = path.join(outputDir, outputFilename);

    try {
      const compStart = Date.now();
      
      // Bitrates otimizados por qualidade e duração (já calculado em bitrateConfig)
      const targetBitrateVideo = bitrateConfig.video;
      const targetBitrateAudio = bitrateConfig.audio;
      
      // Trailer height baseado na proporção (trailer ocupa ~32% do vídeo vertical)
      const trailerHeight = Math.round(videoHeight * 0.316); // ~607 para 1920
      
      console.log(`   ⚡ Composição ${quality} (${qualityConfig.preset}, ${targetBitrateVideo})`);
      
      // FFmpeg OTIMIZADO com parâmetros dinâmicos por qualidade
      // Trailer: escalar para cobrir a área mantendo proporção, depois cortar (crop)
      await spawnProcess('ffmpeg', [
        // Entradas
        '-loop', '1', '-framerate', '24', '-i', backdropPath,
        '-i', trimmedPath,
        '-loop', '1', '-framerate', '24', '-i', overlayPath,
        '-loop', '1', '-framerate', '24', '-i', framePath,
        // Filtros com dimensões dinâmicas
        // Trailer: scale para cobrir a área (force_original_aspect_ratio=increase) + crop central
        '-filter_complex',
        `[0:v]scale=${videoWidth}:${videoHeight}:flags=fast_bilinear[backdrop];` +
        `[1:v]scale=${videoWidth}:${trailerHeight}:force_original_aspect_ratio=increase,crop=${videoWidth}:${trailerHeight}[trailer];` +
        `[2:v]scale=${videoWidth}:${videoHeight}:flags=fast_bilinear[overlay_scaled];` +
        `[backdrop][trailer]overlay=0:0:shortest=1[t1];` +
        `[t1][overlay_scaled]overlay=0:0:shortest=1[t2];` +
        `[t2][3:v]overlay=0:0:shortest=1,format=yuv420p[out]`,
        '-map', '[out]',
        '-map', '1:a?',
        '-t', duracaoNum.toString(),
        // Codec com parâmetros de qualidade
        '-c:v', 'libx264',
        '-preset', qualityConfig.preset,
        '-crf', String(qualityConfig.crf),
        '-tune', 'zerolatency',
        '-maxrate', targetBitrateVideo,
        '-bufsize', bitrateConfig.bufsize,
        '-pix_fmt', 'yuv420p',
        '-r', '24',
        '-g', '96',
        '-profile:v', quality === '480p' ? 'baseline' : 'main',
        '-level', quality === '1080p' ? '4.0' : '3.1',
        // Áudio otimizado
        '-c:a', 'aac',
        '-b:a', targetBitrateAudio,
        '-ar', '44100',
        '-ac', '2',
        // Máxima velocidade
        '-threads', '0',
        '-movflags', '+faststart',
        '-y',
        outputPath
      ]);
      const compTime = Math.floor((Date.now() - compStart) / 1000);
      const totalTime = Math.floor((Date.now() - startTime) / 1000);
      console.log(`✅ Vídeo gerado! (comp: ${compTime}s | total: ${totalTime}s)`);
    } catch (err) {
      console.error("❌ Erro:", err.message);
      if (err.stderr) console.error("stderr:", err.stderr);
      await Promise.all(tempFiles.map(f => fsPromises.unlink(f).catch(() => {})));
      return res.status(500).json({ error: "Falha ao compor vídeo", details: err.message });
    }

    await Promise.all(tempFiles.map(f => fsPromises.unlink(f).catch(() => {})));

    // Obter tamanho do arquivo
    const fileStats = await fsPromises.stat(outputPath);
    const fileSizeMB = (fileStats.size / (1024 * 1024)).toFixed(2);
    
    const totalTime = Math.floor((Date.now() - startTime) / 1000);
    const minutes = Math.floor(totalTime / 60);
    const seconds = totalTime % 60;
    const timeStr = minutes > 0 ? `${minutes}min ${seconds}s` : `${seconds}s`;

    console.log("\n✅ ==========================================");
    console.log(`   VÍDEO GERADO COM SUCESSO!`);
    console.log(`   Arquivo: ${outputFilename}`);
    console.log(`   Qualidade: ${quality} (${videoWidth}x${videoHeight})`);
    console.log(`   Duração: ${duracaoNum}s`);
    console.log(`   📦 Tamanho: ${fileSizeMB}MB ${fileSizeMB <= 10 ? '✅ (WhatsApp OK)' : '⚠️ (>10MB)'}`);
    console.log(`   ⏱️ Tempo total de processamento: ${timeStr}`);
    console.log(`==========================================\n`);

    res.download(outputPath, outputFilename, (err) => {
      if (err && !res.headersSent) {
        console.error("❌ Erro ao enviar vídeo:", err.message);
        res.status(500).json({ error: "Erro ao enviar vídeo" });
      }
      
      // Limpar arquivo de saída após 5 minutos
      setTimeout(() => {
        fsPromises.unlink(outputPath).catch(() => {});
      }, 5 * 60 * 1000);
    });

  } catch (err) {
    console.error("\n❌ ERRO NA GERAÇÃO DO VÍDEO:", err.message);
    console.error(err.stack);
    
    await Promise.all(tempFiles.map(f => fsPromises.unlink(f).catch(() => {})));
    
    if (!res.headersSent) {
      res.status(500).json({
        error: "Falha ao gerar vídeo promocional",
        details: err.message
      });
    }
  }
});

app.get("/api/test-video", verificarAuth, async (req, res) => {
  const diagnostics = {
    timestamp: new Date().toISOString(),
    system: {
      node: process.version,
      platform: process.platform,
      arch: process.arch
    },
    tools: {},
    paths: {
      temp: path.join(__dirname, "temp"),
      output: path.join(__dirname, "public", "videos"),
      overlay: path.join(__dirname, "public", "images", "videos", "overlay.png")
    },
    checks: {}
  };

  // Teste FFmpeg
  try {
    const ffmpegResult = await spawnProcess('ffmpeg', ['-version']);
    diagnostics.tools.ffmpeg = {
      installed: true,
      version: ffmpegResult.stdout.split('\n')[0]
    };
  } catch (err) {
    diagnostics.tools.ffmpeg = {
      installed: false,
      error: err.message
    };
  }

  // Teste yt-dlp
  try {
    const ytdlpResult = await spawnProcess('yt-dlp', ['--version']);
    diagnostics.tools.ytdlp = {
      installed: true,
      version: ytdlpResult.stdout.trim()
    };
  } catch (err) {
    diagnostics.tools.ytdlp = {
      installed: false,
      error: err.message
    };
  }

  // Teste youtube-dl
  try {
    const youtubedlResult = await spawnProcess('youtube-dl', ['--version']);
    diagnostics.tools.youtubedl = {
      installed: true,
      version: youtubedlResult.stdout.trim()
    };
  } catch (err) {
    diagnostics.tools.youtubedl = {
      installed: false,
      error: err.message
    };
  }

  // Verifica overlay
  diagnostics.checks.overlay = await fileExists(diagnostics.paths.overlay);

  // Verifica diretórios
  try {
    await fsPromises.mkdir(diagnostics.paths.temp, { recursive: true });
    diagnostics.checks.tempDir = true;
  } catch {
    diagnostics.checks.tempDir = false;
  }

  try {
    await fsPromises.mkdir(diagnostics.paths.output, { recursive: true });
    diagnostics.checks.outputDir = true;
  } catch {
    diagnostics.checks.outputDir = false;
  }

  // Status geral
  const allToolsOk = diagnostics.tools.ffmpeg?.installed && 
                     (diagnostics.tools.ytdlp?.installed || diagnostics.tools.youtubedl?.installed);
  const allChecksOk = diagnostics.checks.overlay && 
                      diagnostics.checks.tempDir && 
                      diagnostics.checks.outputDir;

  diagnostics.status = allToolsOk && allChecksOk ? 'READY' : 'NOT_READY';
  diagnostics.ready = allToolsOk && allChecksOk;

  if (!diagnostics.ready) {
    diagnostics.issues = [];
    if (!diagnostics.tools.ffmpeg?.installed) {
      diagnostics.issues.push('FFmpeg não instalado. Execute: sudo apt install ffmpeg');
    }
    if (!diagnostics.tools.ytdlp?.installed && !diagnostics.tools.youtubedl?.installed) {
      diagnostics.issues.push('yt-dlp ou youtube-dl não instalado. Execute: sudo apt install yt-dlp');
    }
    if (!diagnostics.checks.overlay) {
      diagnostics.issues.push(`Overlay não encontrado em: ${diagnostics.paths.overlay}`);
    }
    if (!diagnostics.checks.tempDir || !diagnostics.checks.outputDir) {
      diagnostics.issues.push('Erro ao criar diretórios temporários');
    }
  }

  res.json(diagnostics);
});

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

app.use((req, res) => {
  res.status(404).json({
    error: "Rota não encontrada",
    path: req.path,
    method: req.method
  });
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

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("unhandledRejection", (reason) => console.error("Unhandled Rejection:", reason));
process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
  process.exit(1);
});

// Criar HTTP server e Socket.IO
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Namespace para progresso de vídeo
const videoProgress = io.of("/video-progress");

videoProgress.on("connection", (socket) => {
  console.log(`📡 Cliente Socket.IO conectado: ${socket.id}`);
  
  socket.on("disconnect", () => {
    console.log(`📡 Cliente Socket.IO desconectado: ${socket.id}`);
  });
  
  socket.on("subscribe", (jobId) => {
    console.log(`📡 Cliente inscrito no job: ${jobId}`);
    socket.join(jobId);
  });
});

// Função global para emitir progresso
global.emitVideoProgress = (jobId, data) => {
  videoProgress.to(jobId).emit("progress", data);
};

// 🧹 LIMPEZA AUTOMÁTICA DE BANNERS EXPIRADOS (24 horas)
async function limparBannersExpirados() {
  try {
    const agora = Date.now();
    const limiteMs = 24 * 60 * 60 * 1000; // 24 horas
    const bannersRef = db.collection("banners");
    const snap = await bannersRef.get();
    
    let removidos = 0;
    for (const doc of snap.docs) {
      const data = doc.data();
      const criadoEmMs = data.criadoEm?.toMillis ? data.criadoEm.toMillis() : data.criadoEm;
      
      if (criadoEmMs && (agora - criadoEmMs) > limiteMs) {
        // Remover do Cloudinary se tiver publicId
        if (data.publicId) {
          try {
            await cloudinary.uploader.destroy(data.publicId);
          } catch (cloudErr) {
            console.warn(`⚠️ Erro ao remover do Cloudinary: ${data.publicId}`, cloudErr.message);
          }
        }
        
        // Remover do Firestore
        await doc.ref.delete();
        removidos++;
      }
    }
    
    if (removidos > 0) {
      console.log(`🧹 Limpeza: ${removidos} banners expirados removidos`);
    }
  } catch (err) {
    console.error("❌ Erro na limpeza de banners:", err.message);
  }
}

// Executar limpeza a cada hora
setInterval(limparBannersExpirados, 60 * 60 * 1000);
// Executar limpeza inicial após 30 segundos
setTimeout(limparBannersExpirados, 30000);

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`
╔═══════════════════════════════════════╗
║   🚀 ORION CREATOR SERVER 2.8.22     ║
║   TMDB + Fanart + Firebase           ║
║   Video Generation + Socket.IO       ║
╚═══════════════════════════════════════╝
Porta: ${PORT}
Node: ${process.version}
Env: ${process.env.NODE_ENV || "development"}
TMDB Key: ${process.env.TMDB_KEY ? "✔" : "✘"}
Fanart Key: ${process.env.FANART_API_KEY ? "✔" : "✘"}
Socket.IO: ✔ Ativo

✨ VERSÃO 2.8.22:
   • NOVO: Progresso em tempo real via Socket.IO
   • NOVO: Otimizações de velocidade (preset, CRF, threads)
   • NOVO: Geração completa de vídeos com FFmpeg + Sharp
   • RIGEL (PADRAO): Título ajustado dinamicamente (28-54px)
   • BELTEGUESE (ORION_EXCLUSIVO): Metadados brancos + estrela dourada
   • BELLATRIX (ORION_X): Backdrop muito escuro com overlay
   • TODOS: Alternância de backdrop e poster
   • ⚡ OTIMIZADO: Cache 3x maior, compressão gzip, FFmpeg ultrafast
   
⚙️ DEPENDÊNCIAS NECESSÁRIAS:
   • FFmpeg instalado no sistema
   • yt-dlp instalado no sistema
   • Overlay em: public/images/videos/overlay.png
`);

  // ⚡ HEALTH CHECK: Previne cold start do Render
  // Faz ping a si mesmo a cada 10 minutos
  if (process.env.RENDER_EXTERNAL_URL) {
    setInterval(async () => {
      try {
        await fetch(`${process.env.RENDER_EXTERNAL_URL}/api/health`);
        console.log("💓 Health check OK");
      } catch (err) {
        console.log("⚠️ Health check falhou");
      }
    }, 10 * 60 * 1000);
    console.log("✅ Health check ativo (previne cold start)");
  }
});