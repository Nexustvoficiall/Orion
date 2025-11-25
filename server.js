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
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import validator from "validator";

// Imports da API TMDB
import {
  buscarTMDB,
  getLancamentos,
  getFilmesPopulares,
  getSeriesPopulares,
  getTendencias
} from "./api/tmdb.js";

import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";

dotenv.config();

// -------------------------
// CONFIGURAÇÕES E VALIDAÇÃO
// -------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Validar variáveis de ambiente críticas
const requiredEnvVars = ['TMDB_KEY', 'PORT', 'FIREBASE_PROJECT_ID', 'FIREBASE_PRIVATE_KEY', 'FIREBASE_CLIENT_EMAIL'];
requiredEnvVars.forEach(varName => {
  if (!process.env[varName]) {
    console.error(`❌ ERRO: Variável ${varName} não definida no .env`);
    process.exit(1);
  }
});

// Inicializar Firebase com variáveis do .env
if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        type: "service_account",
        project_id: process.env.FIREBASE_PROJECT_ID,
        private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
        private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
        client_id: process.env.FIREBASE_CLIENT_ID,
        auth_uri: "https://accounts.google.com/o/oauth2/auth",
        token_uri: "https://oauth2.googleapis.com/token",
        auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
        client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL,
        universe_domain: "googleapis.com"
      }),
    });
    console.log("✅ Firebase inicializado com sucesso");
  } catch (error) {
    console.error("❌ Erro ao inicializar Firebase:", error.message);
    process.exit(1);
  }
}
const db = getFirestore();

// Inicializar Express
const app = express();
const PORT = process.env.PORT || 3000;

// -------------------------
// MIDDLEWARES DE SEGURANÇA
// -------------------------
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

// Rate Limiters
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: "Muitas requisições. Tente novamente em 15 minutos." },
  standardHeaders: true,
  legacyHeaders: false,
});

const bannerLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 20,
  message: { error: "Limite de geração de banners atingido. Aguarde 15 minutos." }
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: { error: "Limite de uploads atingido. Aguarde 1 hora." }
});

app.use("/api", apiLimiter);

// -------------------------
// MIDDLEWARE DE AUTENTICAÇÃO
// -------------------------
const verificarAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: "Token de autenticação não fornecido" });
    }

    const token = authHeader.split('Bearer ')[1];
    const decodedToken = await admin.auth().verifyIdToken(token);
    
    req.uid = decodedToken.uid;
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error("❌ Erro na autenticação:", error.message);
    res.status(401).json({ error: "Token inválido ou expirado" });
  }
};

// -------------------------
// CACHE EM MEMÓRIA
// -------------------------
class SimpleCache {
  constructor(ttl = 3600000) {
    this.cache = new Map();
    this.ttl = ttl;
  }

  get(key) {
    const item = this.cache.get(key);
    if (!item) return null;
    
    if (Date.now() - item.timestamp > this.ttl) {
      this.cache.delete(key);
      return null;
    }
    
    return item.data;
  }

  set(key, data) {
    this.cache.set(key, { data, timestamp: Date.now() });
    
    if (this.cache.size > 1000) {
      const now = Date.now();
      for (const [k, v] of this.cache.entries()) {
        if (now - v.timestamp > this.ttl) {
          this.cache.delete(k);
        }
      }
    }
  }

  clear() {
    this.cache.clear();
  }
}

const imageCache = new SimpleCache(3600000);
const tmdbCache = new SimpleCache(1800000);

// -------------------------
// UPLOAD (MULTER + CLOUDINARY)
// -------------------------
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "orioncreator",
    allowed_formats: ["jpg", "png", "jpeg", "webp"],
    transformation: [{ width: 2000, height: 3000, crop: "limit" }]
  },
});

const upload = multer({ 
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 1
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Formato de arquivo não suportado. Use JPG, PNG ou WEBP.'));
    }
  }
});

// -------------------------
// PALETA DE CORES
// -------------------------
const COLORS = {
  ROXO:      { hex: "#8A2BE2", gradient: ["#4B0082", "#000000"] },
  AZUL:      { hex: "#007bff", gradient: ["#001f3f", "#000000"] },
  VERDE:     { hex: "#28a745", gradient: ["#0f3e18", "#000000"] },
  VERMELHO:  { hex: "#dc3545", gradient: ["#4a0808", "#000000"] },
  LARANJA:   { hex: "#fd7e14", gradient: ["#692800", "#000000"] },
  AMARELO:   { hex: "#ffc107", gradient: ["#856404", "#000000"] },
  DOURADO:   { hex: "#FFD700", gradient: ["#755c00", "#000000"] },
  PRATA:     { hex: "#C0C0C0", gradient: ["#383838", "#000000"] }
};

const ALLOWED_IMAGE_DOMAINS = [
  'res.cloudinary.com',
  'image.tmdb.org',
  'themoviedb.org'
];

// -------------------------
// FUNÇÕES AUXILIARES
// -------------------------
async function fileExists(p) {
  try {
    await fsPromises.access(p);
    return true;
  } catch (e) {
    return false;
  }
}

function validarURL(url) {
  if (!url || typeof url !== 'string') return false;
  
  if (url.startsWith('file://') || url.startsWith('/')) {
    return false;
  }
  
  if (!validator.isURL(url, { protocols: ['http', 'https'], require_protocol: true })) {
    return false;
  }
  
  try {
    const urlObj = new URL(url);
    return ALLOWED_IMAGE_DOMAINS.some(domain => 
      urlObj.hostname === domain || urlObj.hostname.endsWith(`.${domain}`)
    );
  } catch (e) {
    return false;
  }
}

async function fetchBuffer(url, useCache = true) {
  if (!url) throw new Error("URL inválida para imagem.");
  
  if (!validarURL(url)) {
    throw new Error(`URL não permitida ou inválida: ${url}`);
  }

  if (useCache) {
    const cached = imageCache.get(url);
    if (cached) return cached;
  }

  try {
    const res = await fetch(url, { 
      headers: { 'User-Agent': 'OrionCreator/1.0' }
    });
    
    if (!res.ok) {
      throw new Error(`Falha ao baixar imagem: status ${res.status}`);
    }
    
    const buffer = Buffer.from(await res.arrayBuffer());
    
    const metadata = await sharp(buffer).metadata();
    if (!metadata.format) {
      throw new Error("Arquivo não é uma imagem válida");
    }
    
    const pngBuffer = await sharp(buffer).png().toBuffer();
    
    if (useCache) {
      imageCache.set(url, pngBuffer);
    }
    
    return pngBuffer;
  } catch (error) {
    console.error(`❌ Erro ao buscar imagem ${url}:`, error.message);
    throw new Error(`Falha ao baixar imagem: ${error.message}`);
  }
}

function wrapText(text, maxChars) {
  if (!text) return [];
  const words = text.split(' ');
  let lines = [];
  let currentLine = words[0] || '';

  for (let i = 1; i < words.length; i++) {
    if ((words[i].length + currentLine.length + 1) <= maxChars) {
      currentLine += " " + words[i];
    } else {
      lines.push(currentLine);
      currentLine = words[i];
    }
  }
  
  if (currentLine) lines.push(currentLine);
  return lines.slice(0, 8);
}

function formatTime(minutes) {
  if (!minutes || isNaN(minutes)) return "";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const safeXml = (s) => String(s || "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&apos;");

// -------------------------
// ROTAS DA API TMDB
// -------------------------
app.get("/api/tmdb", async (req, res) => {
  try {
    const { query, tipo } = req.query;
    
    if (query) {
      const cacheKey = `search_${tipo}_${query}`;
      const cached = tmdbCache.get(cacheKey);
      if (cached) return res.json(cached);
      
      const resultados = await buscarTMDB(query, tipo || "movie");
      tmdbCache.set(cacheKey, resultados);
      return res.json(resultados);
    }

    const cacheKey = "tmdb_home";
    const cached = tmdbCache.get(cacheKey);
    if (cached) return res.json(cached);

    const [lancamentos, filmesPop, seriesPop, tendencias] = await Promise.all([
      getLancamentos().catch(() => ({ filmes: [], series: [] })),
      getFilmesPopulares().catch(() => []),
      getSeriesPopulares().catch(() => []),
      getTendencias().catch(() => []),
    ]);

    const response = {
      filmesLancamentos: lancamentos?.filmes || [],
      seriesLancamentos: lancamentos?.series || [],
      filmesPopulares: filmesPop || [],
      seriesPopulares: seriesPop || [],
      tendencias: tendencias || [],
    };

    tmdbCache.set(cacheKey, response);
    return res.json(response);
  } catch (err) {
    console.error("❌ Erro TMDB:", err.message);
    res.status(500).json({ error: "Erro ao buscar dados da TMDB" });
  }
});

app.get("/api/tmdb/detalhes/:tipo/:id", async (req, res) => {
  const { tipo, id } = req.params;
  
  if (!['movie', 'tv'].includes(tipo) || !id || isNaN(id)) {
    return res.status(400).json({ error: "Parâmetros inválidos" });
  }
  
  try {
    const cacheKey = `details_${tipo}_${id}`;
    const cached = tmdbCache.get(cacheKey);
    if (cached) return res.json(cached);

    const url = `https://api.themoviedb.org/3/${tipo}/${id}?api_key=${process.env.TMDB_KEY}&language=pt-BR&append_to_response=images,credits,release_dates`;
    const response = await fetch(url);
    
    if (!response.ok) {
      return res.status(response.status).json({ error: "Item não encontrado" });
    }
    
    const item = await response.json();
    tmdbCache.set(cacheKey, item);
    res.json(item);
  } catch (err) {
    console.error("❌ Erro Detalhes:", err.message);
    res.status(500).json({ error: "Erro ao buscar detalhes" });
  }
});

// 🔧 NOVO: Endpoint para dados da temporada
app.get("/api/tmdb/detalhes/tv/:id/season/:seasonNumber", async (req, res) => {
  const { id, seasonNumber } = req.params;
  
  if (!id || isNaN(id) || !seasonNumber || isNaN(seasonNumber)) {
    return res.status(400).json({ error: "Parâmetros inválidos" });
  }
  
  try {
    const cacheKey = `season_${id}_${seasonNumber}`;
    const cached = tmdbCache.get(cacheKey);
    if (cached) return res.json(cached);

    const url = `https://api.themoviedb.org/3/tv/${id}/season/${seasonNumber}?api_key=${process.env.TMDB_KEY}&language=pt-BR`;
    const response = await fetch(url);
    
    if (!response.ok) {
      return res.status(response.status).json({ error: "Temporada não encontrada" });
    }
    
    const seasonData = await response.json();
    tmdbCache.set(cacheKey, seasonData);
    res.json(seasonData);
  } catch (err) {
    console.error("❌ Erro ao buscar temporada:", err.message);
    res.status(500).json({ error: "Erro ao buscar dados da temporada" });
  }
});

app.get("/api/search", async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length < 2) {
      return res.status(400).json({ error: "Query muito curta (mínimo 2 caracteres)" });
    }

    const cacheKey = `search_multi_${q}`;
    const cached = tmdbCache.get(cacheKey);
    if (cached) return res.json(cached);

    const url = `https://api.themoviedb.org/3/search/multi?api_key=${process.env.TMDB_KEY}&language=pt-BR&query=${encodeURIComponent(q)}`;
    const r = await fetch(url);
    const json = await r.json();
    
    tmdbCache.set(cacheKey, json);
    res.json(json);
  } catch (err) {
    console.error("❌ Erro search:", err.message);
    res.status(500).json({ error: "Erro na busca" });
  }
});

app.get("/api/vods", async (req, res) => {
  try {
    const { q } = req.query;
    
    if (q) {
      const url = `https://api.themoviedb.org/3/search/multi?api_key=${process.env.TMDB_KEY}&language=pt-BR&query=${encodeURIComponent(q)}`;
      const r = await fetch(url);
      const json = await r.json();
      return res.json(json);
    }
    
    const lanc = await getLancamentos();
    const combined = [...(lanc?.filmes || []), ...(lanc?.series || [])].slice(0, 20);
    return res.json({ results: combined });
  } catch (e) {
    console.error("❌ Erro VODs:", e.message);
    res.status(500).json({ error: "Erro ao buscar VODs" });
  }
});

app.post("/api/upload", verificarAuth, uploadLimiter, upload.single("file"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Nenhum arquivo enviado" });
    }
    
    res.json({ 
      url: req.file.path || req.file.url,
      filename: req.file.filename,
      size: req.file.size
    });
  } catch (error) {
    console.error("❌ Erro no upload:", error.message);
    res.status(500).json({ error: "Erro ao fazer upload do arquivo" });
  }
});

// -------------------------
// GERADOR DE BANNER (PROTEGIDO)
// -------------------------
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

    // Validações
    if (!posterUrl) {
      return res.status(400).json({ error: "URL do Poster é obrigatória." });
    }

    if (!validarURL(posterUrl)) {
      return res.status(400).json({ error: "URL do poster inválida ou não permitida." });
    }

    if (!titulo || titulo.trim().length === 0) {
      return res.status(400).json({ error: "Título é obrigatório." });
    }

    if (titulo.length > 100) {
      return res.status(400).json({ error: "Título muito longo (máximo 100 caracteres)." });
    }

    if (backdropUrl && !validarURL(backdropUrl)) {
      return res.status(400).json({ error: "URL do backdrop inválida." });
    }

    const corKey = (modeloCor || "ROXO").toUpperCase();
    if (!COLORS[corKey]) {
      return res.status(400).json({ error: `Cor '${corKey}' não existe. Cores disponíveis: ${Object.keys(COLORS).join(', ')}` });
    }
    const corConfig = COLORS[corKey];

    const width = tipo === "horizontal" ? 1920 : 1080;
    const height = tipo === "horizontal" ? 1080 : 1920;

    // 🔧 NOVO: Buscar dados da temporada se for série
    let anoTemporada = ano;
    let notaTemporada = nota;

    if (tmdbTipo === 'tv' && temporada) {
      try {
        const urlTemporada = `https://api.themoviedb.org/3/tv/${tmdbId}/season/${temporada}?api_key=${process.env.TMDB_KEY}&language=pt-BR`;
        const resTemporada = await fetch(urlTemporada);
        
        if (resTemporada.ok) {
          const temporadaDados = await resTemporada.json();
          console.log(`📺 Dados da temporada ${temporada} carregados`);
          
          // 🔧 NOVO: Extrair ano da temporada
          if (temporadaDados.air_date) {
            anoTemporada = temporadaDados.air_date.substring(0, 4);
            console.log(`📅 Ano da temporada ${temporada}: ${anoTemporada}`);
          }
          
          // 🔧 NOVO: Extrair nota/rating da temporada
          if (temporadaDados.vote_average && temporadaDados.vote_average > 0) {
            notaTemporada = temporadaDados.vote_average;
            console.log(`⭐ Nota da temporada ${temporada}: ${notaTemporada}`);
          } else if (temporadaDados.episodes && temporadaDados.episodes.length > 0) {
            const mediaEpisodios = temporadaDados.episodes.reduce((acc, ep) => acc + (ep.vote_average || 0), 0) / temporadaDados.episodes.length;
            if (mediaEpisodios > 0) {
              notaTemporada = mediaEpisodios;
              console.log(`⭐ Nota média dos episódios: ${notaTemporada.toFixed(1)}`);
            }
          }
        }
      } catch (error) {
        console.warn("⚠️ Falha ao buscar dados da temporada:", error.message);
      }
    }

    // -------------------------
    // BACKGROUND - LÓGICA ATUALIZADA
    // -------------------------
    let finalBackgroundBuffer;
    let overlayColorBuffer;

    if (modeloTipo === "ORION_EXCLUSIVO") {
      let backUrlToUse = backdropUrl;

      if (!backUrlToUse && tmdbId) {
        const tTipo = tmdbTipo || "movie";
        const urlTMDB = `https://api.themoviedb.org/3/${tTipo}/${tmdbId}/images?api_key=${process.env.TMDB_KEY}`;
        
        try {
          const resTMDB = await fetch(urlTMDB);
          if (resTMDB.ok) {
            const data = await resTMDB.json();
            if (data.backdrops && data.backdrops.length > 0) {
              backUrlToUse = `https://image.tmdb.org/t/p/original${data.backdrops[0].file_path}`;
            }
          }
        } catch (error) {
          console.warn("⚠️ Falha ao buscar backdrop do TMDB:", error.message);
        }
      }

      if (backUrlToUse) {
        try {
          const backBuf = await fetchBuffer(backUrlToUse);
          finalBackgroundBuffer = await sharp(backBuf)
            .resize(width, height, { fit: 'cover', position: 'center' })
            .toBuffer();
        } catch (error) {
          console.warn("⚠️ Falha ao processar backdrop, usando cor sólida:", error.message);
          finalBackgroundBuffer = await sharp({
            create: { width, height, channels: 4, background: { r: 10, g: 10, b: 10, alpha: 1 } }
          }).png().toBuffer();
        }
      } else {
        finalBackgroundBuffer = await sharp({
          create: { width, height, channels: 4, background: { r: 10, g: 10, b: 10, alpha: 1 } }
        }).png().toBuffer();
      }

    } else {
      let backUrlToUse = backdropUrl;

      if (!backUrlToUse && tmdbId) {
        const tTipo = tmdbTipo || "movie";
        const urlTMDB = `https://api.themoviedb.org/3/${tTipo}/${tmdbId}/images?api_key=${process.env.TMDB_KEY}`;
        
        try {
          const resTMDB = await fetch(urlTMDB);
          if (resTMDB.ok) {
            const data = await resTMDB.json();
            if (data.backdrops && data.backdrops.length > 0) {
              backUrlToUse = `https://image.tmdb.org/t/p/original${data.backdrops[0].file_path}`;
            }
          }
        } catch (error) {
          console.warn("⚠️ Falha ao buscar backdrop do TMDB:", error.message);
        }
      }

      if (backUrlToUse) {
        try {
          const backBuf = await fetchBuffer(backUrlToUse);
          finalBackgroundBuffer = await sharp(backBuf)
            .resize(width, height, { fit: 'cover', position: 'center' })
            .blur(3)
            .toBuffer();
        } catch (error) {
          console.warn("⚠️ Falha ao processar backdrop, usando cor sólida:", error.message);
          finalBackgroundBuffer = await sharp({
            create: { width, height, channels: 4, background: { r: 20, g: 20, b: 30, alpha: 1 } }
          }).png().toBuffer();
        }
      } else {
        finalBackgroundBuffer = await sharp({
          create: { width, height, channels: 4, background: { r: 20, g: 20, b: 30, alpha: 1 } }
        }).png().toBuffer();
      }

      const verticalBanners = {
        ROXO: "https://res.cloudinary.com/dxbu3zk6i/image/upload/v1763988195/vertical_roxo_vdnbwk.png",
        AZUL: "https://res.cloudinary.com/dxbu3zk6i/image/upload/v1763988195/vertical_azul_h83cpu.png",
        VERMELHO: "https://res.cloudinary.com/dxbu3zk6i/image/upload/v1763988197/vertical_vermelho_bjb2u1.png",
        VERDE: "https://res.cloudinary.com/dxbu3zk6i/image/upload/v1763988197/vertical_verde_i2nekv.png",
        PRATA: "https://res.cloudinary.com/dxbu3zk6i/image/upload/v1763988194/vertical_prata_xuvzoi.png",
        AMARELO: "https://res.cloudinary.com/dxbu3zk6i/image/upload/v1763988195/vertical_amarelo_urqjlu.png",
        DOURADO: "https://res.cloudinary.com/dxbu3zk6i/image/upload/v1763988194/vertical_dourado_asthju.png",
        LARANJA: "https://res.cloudinary.com/dxbu3zk6i/image/upload/v1763988195/vertical_lajanja_qtyj6n.png"
      };
      
      const colorOverlayUrl = verticalBanners[corKey];
      if (!colorOverlayUrl) {
        return res.status(400).json({ error: "Overlay colorido não encontrado para a cor selecionada." });
      }
      
      try {
        const overlayBuf = await fetchBuffer(colorOverlayUrl);
        overlayColorBuffer = await sharp(overlayBuf)
          .resize(width, height, { fit: 'cover' })
          .toBuffer();
      } catch (error) {
        console.error("❌ Erro ao processar overlay colorido:", error.message);
        return res.status(500).json({ error: "Falha ao processar overlay de cor" });
      }
    }

    // -------------------------
    // GRADIENTE
    // -------------------------
    let gradientOverlay;
    if (modeloTipo === "ORION_EXCLUSIVO") {
      const svgGrad = `
        <svg width="${width}" height="${height}">
          <defs>
            <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stop-color="${corConfig.gradient[0]}" stop-opacity="0.95" />
              <stop offset="45%" stop-color="${corConfig.gradient[0]}" stop-opacity="0.85" />
              <stop offset="100%" stop-color="#000000" stop-opacity="0.1" />
            </linearGradient>
          </defs>
          <rect x="0" y="0" width="${width}" height="${height}" fill="url(#grad)" />
        </svg>
      `;
      gradientOverlay = Buffer.from(svgGrad);
    } else {
      gradientOverlay = Buffer.from(`
        <svg width="${width}" height="${height}">
          <rect width="100%" height="100%" fill="rgba(0,0,0,0.4)"/>
        </svg>
      `);
    }

    // ===========================================================
    // POSTER
    // ===========================================================
    const posterBufferOriginal = await fetchBuffer(posterUrl);

    let pW, pH, pLeft, pTop;

    if (tipo === "horizontal") {
      pW = modeloTipo === "ORION_EXCLUSIVO" ? 560 : Math.round(width * 0.32);
      pLeft = modeloTipo === "ORION_EXCLUSIVO" ? 160 : Math.round((width - pW) / 2);
      pH = Math.round(pW * 1.58);
      pTop = Math.round((height - pH) / 2) - 153;
    } else {
      pW = modeloTipo === "ORION_EXCLUSIVO" ? 720 : Math.round(width * 0.5);
      pLeft = Math.round((width - pW) / 2);
      pH = Math.round(pW * 1.58);
      pTop = 193;
    }

    const posterResized = await sharp(posterBufferOriginal)
      .resize(pW, pH, { fit: "cover", position: "center" })
      .png()
      .toBuffer();

    // ===========================================================
    // SINOPSE
    // ===========================================================
    const wrapLimit = tipo === "horizontal" ? 45 : 55;
    let linhasSinopse = wrapText(sinopse || "", wrapLimit).slice(0, 6);

    let synopFontSize, lineHeight;

    if (tipo === "horizontal") {
      if (linhasSinopse.length <= 2) {
        synopFontSize = 46;
        lineHeight = 62;
      } else if (linhasSinopse.length <= 3) {
        synopFontSize = 44;
        lineHeight = 58;
      } else if (linhasSinopse.length <= 4) {
        synopFontSize = 40;
        lineHeight = 54;
      } else {
        synopFontSize = 36;
        lineHeight = 48;
      }
    } else {
      if (linhasSinopse.length <= 2) {
        synopFontSize = 42;
        lineHeight = 58;
      } else if (linhasSinopse.length <= 3) {
        synopFontSize = 40;
        lineHeight = 56;
      } else if (linhasSinopse.length <= 4) {
        synopFontSize = 38;
        lineHeight = 52;
      } else if (linhasSinopse.length <= 5) {
        synopFontSize = 34;
        lineHeight = 48;
      } else {
        synopFontSize = 30;
        lineHeight = 44;
      }
    }

    // ===========================================================
    // POSIÇÕES
    // ===========================================================
    const textX = tipo === "horizontal" 
      ? (pLeft + pW + 40)
      : Math.round(width / 2);
      
    const textAnchor = tipo === "horizontal" ? "start" : "middle";

    const titleFontSize =
      titulo.length <= 22 ? (tipo === "horizontal" ? 55 : 50) :
      titulo.length <= 36 ? (tipo === "horizontal" ? 48 : 40) :
      (tipo === "horizontal" ? 40 : 34);

    const spaceAfterPoster = tipo === "horizontal" ? 190 : 230;
    const titleMargin = tipo === "horizontal" ? 50 : 65;
    const spaceAfterTitle = tipo === "horizontal" ? 45 : 55;
    const metaFontSize = tipo === "horizontal" ? 26 : 29;

    let textYStart = pTop + pH + spaceAfterPoster;

    const titleY = textYStart + titleMargin;
    const synopseStartY = titleY + spaceAfterTitle;
    const metaY = synopseStartY + (linhasSinopse.length * lineHeight) + 20;

    // ===========================================================
    // METADADOS - COM ANO E NOTA DA TEMPORADA
    // ===========================================================
    const notaF = notaTemporada ? parseFloat(notaTemporada).toFixed(1) : "N/A";
    const duracaoF = formatTime(duracao) || duracao || "";
    
    let metaString = `⭐ ${notaF} | ${anoTemporada || ''} | ${genero || ''} | ${duracaoF}`;
    if (tmdbTipo === 'tv' && temporada) {
      metaString = `Temporada ${temporada} | ⭐ ${notaF} | ${anoTemporada || ''} | ${genero || ''}`;
    }

    // ===========================================================
    // SVG FINAL
    // ===========================================================
    const svgText = `
      <svg width="${width}" height="${height}">
        <style>
          .title { 
            fill: white;
            font-family: Arial, sans-serif;
            font-weight: 900;
            font-size: ${titleFontSize}px;
            letter-spacing: -1px;
          }
          .meta {
            fill: ${corConfig.hex};
            font-family: Arial, sans-serif;
            font-weight: bold;
            font-size: ${metaFontSize}px;
          }
          .synop {
            fill: #ffffff;
            font-family: Arial, sans-serif;
            font-size: ${synopFontSize}px;
            line-height: ${lineHeight}px;
          }
        </style>

        <text x="${textX}" y="${titleY}" text-anchor="${textAnchor}" class="title">
          ${safeXml(titulo).toUpperCase()}
        </text>

        ${linhasSinopse.map((line, i) => `
          <text x="${textX}" 
                y="${synopseStartY + (i * lineHeight)}"
                text-anchor="${textAnchor}" class="synop">
            ${safeXml(line)}
          </text>
        `).join("")}

        <text x="${textX}" y="${metaY}" text-anchor="${textAnchor}" class="meta">
          ${safeXml(metaString)}
        </text>
      </svg>
    `;

    // -------------------------
    // LOGO
    // -------------------------
    let logoBuffer = null;
    
    try {
      const userSnap = await db.collection("usuarios").doc(req.uid).get();
      if (userSnap.exists && userSnap.data().logo) {
        const logoUrl = userSnap.data().logo;
        if (validarURL(logoUrl)) {
          logoBuffer = await fetchBuffer(logoUrl, false).catch(() => null);
        }
      }
    } catch (error) {
      console.warn("⚠️ Erro ao buscar logo do usuário:", error.message);
    }

    if (!logoBuffer) {
      const pathLogoPadrao = path.join(__dirname, "public", "images", "default_logo.png");
      if (await fileExists(pathLogoPadrao)) {
        try {
          logoBuffer = await sharp(pathLogoPadrao).toBuffer();
        } catch (error) {
          console.warn("⚠️ Erro ao carregar logo padrão:", error.message);
        }
      }
    }

    let logoLayer = null;
    if (logoBuffer) {
      try {
        const logoRes = await sharp(logoBuffer)
          .resize(180, 180, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
          .png()
          .toBuffer();
        logoLayer = { input: logoRes, top: 40, left: width - 220 };
      } catch (error) {
        console.warn("⚠️ Erro ao processar logo:", error.message);
      }
    }

    // -------------------------
    // COMPOSIÇÃO FINAL
    // -------------------------
    const layers = [];
    
    if (modeloTipo !== "ORION_EXCLUSIVO" && overlayColorBuffer) {
      layers.push({ input: overlayColorBuffer, top: 0, left: 0 });
    }
    
    layers.push({ input: gradientOverlay, top: 0, left: 0 });
    layers.push({ input: posterResized, top: pTop, left: pLeft });
    layers.push({ input: Buffer.from(svgText), top: 0, left: 0 });
    
    if (logoLayer) layers.push(logoLayer);

    const finalImage = await sharp(finalBackgroundBuffer)
      .resize(width, height)
      .composite(layers)
      .png({ quality: 90, compressionLevel: 9 })
      .toBuffer();

    const sanitizedTitle = titulo.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);
    res.setHeader("Content-Disposition", `attachment; filename=banner_${sanitizedTitle}.png`);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(finalImage);

    console.log(`✅ Banner gerado com sucesso para usuário ${req.uid} - Modelo: ${modeloTipo || 'PREMIUM'}${temporada ? ` - Temporada: ${temporada} (${anoTemporada})` : ''}`);

  } catch (error) {
    console.error("❌ Erro Crítico no Gerador:", error.message, error.stack);
    res.status(500).json({ 
      error: "Falha ao gerar o banner",
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// -------------------------
// HEALTH CHECK
// -------------------------
app.get("/api/health", async (req, res) => {
  const checks = {
    server: true,
    firebase: false,
    tmdb: false,
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  };

  try {
    await db.collection("usuarios").limit(1).get();
    checks.firebase = true;
  } catch (error) {
    console.error("❌ Health check Firebase falhou:", error.message);
  }

  try {
    const response = await fetch(
      `https://api.themoviedb.org/3/movie/popular?api_key=${process.env.TMDB_KEY}&page=1`
    );
    checks.tmdb = response.ok;
  } catch (error) {
    console.error("❌ Health check TMDB falhou:", error.message);
  }

  const allHealthy = checks.firebase && checks.tmdb;
  const statusCode = allHealthy ? 200 : 503;

  res.status(statusCode).json(checks);
});

// -------------------------
// CACHE CLEAR
// -------------------------
app.post("/api/cache/clear", verificarAuth, async (req, res) => {
  try {
    const userDoc = await db.collection("usuarios").doc(req.uid).get();
    const userData = userDoc.data();
    
    if (!userData?.isAdmin) {
      return res.status(403).json({ error: "Acesso negado. Apenas administradores." });
    }

    imageCache.clear();
    tmdbCache.clear();
    
    res.json({ 
      success: true, 
      message: "Cache limpo com sucesso",
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("❌ Erro ao limpar cache:", error.message);
    res.status(500).json({ error: "Erro ao limpar cache" });
  }
});

// -------------------------
// STATS
// -------------------------
app.get("/api/stats", verificarAuth, async (req, res) => {
  try {
    const userDoc = await db.collection("usuarios").doc(req.uid).get();
    const userData = userDoc.data();
    
    if (!userData?.isAdmin) {
      return res.status(403).json({ error: "Acesso negado" });
    }

    res.json({
      cache: {
        images: imageCache.cache.size,
        tmdb: tmdbCache.cache.size
      },
      server: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        nodeVersion: process.version,
        platform: process.platform
      },
      colors: Object.keys(COLORS),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("❌ Erro ao buscar stats:", error.message);
    res.status(500).json({ error: "Erro ao buscar estatísticas" });
  }
});

// -------------------------
// CORES
// -------------------------
app.get("/api/cores", (req, res) => {
  const coresDisponiveis = Object.entries(COLORS).map(([nome, config]) => ({
    nome,
    hex: config.hex,
    gradient: config.gradient
  }));
  
  res.json({ cores: coresDisponiveis });
});

// -------------------------
// TRATAMENTO DE ERROS
// -------------------------
app.use((err, req, res, next) => {
  console.error("❌ Erro não tratado:", err.stack);
  
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: "Arquivo muito grande (máximo 10MB)" });
    }
    return res.status(400).json({ error: `Erro no upload: ${err.message}` });
  }
  
  res.status(err.status || 500).json({ 
    error: err.message || "Erro interno do servidor",
    details: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// 404
app.use((req, res) => {
  res.status(404).json({ 
    error: "Rota não encontrada",
    path: req.path,
    method: req.method
  });
});

// -------------------------
// PÁGINA PRINCIPAL
// -------------------------
app.get("/", async (req, res) => {
  const indexPath = path.join(__dirname, "public", "index.html");
  
  if (await fileExists(indexPath)) {
    return res.sendFile(indexPath);
  }
  
  res.send(`
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Orion Creator API</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          max-width: 800px;
          margin: 50px auto;
          padding: 20px;
          background: #1a1a1a;
          color: #fff;
        }
        h1 { color: #8A2BE2; }
        .endpoint {
          background: #2a2a2a;
          padding: 15px;
          margin: 10px 0;
          border-radius: 5px;
          border-left: 4px solid #8A2BE2;
        }
        .method {
          display: inline-block;
          padding: 3px 8px;
          border-radius: 3px;
          font-weight: bold;
          font-size: 12px;
          margin-right: 10px;
        }
        .get { background: #28a745; }
        .post { background: #007bff; }
        code {
          background: #000;
          padding: 2px 6px;
          border-radius: 3px;
          color: #8A2BE2;
        }
      </style>
    </head>
    <body>
      <h1>🎬 Orion Creator API</h1>
      <p>API para geração de banners de filmes e séries com integração TMDB.</p>
      
      <h2>📡 Endpoints Disponíveis:</h2>
      
      <div class="endpoint">
        <span class="method get">GET</span>
        <code>/api/health</code> - Status do servidor
      </div>
      
      <div class="endpoint">
        <span class="method get">GET</span>
        <code>/api/cores</code> - Cores disponíveis
      </div>
      
      <div class="endpoint">
        <span class="method get">GET</span>
        <code>/api/tmdb</code> - Dados do TMDB
      </div>
      
      <div class="endpoint">
        <span class="method get">GET</span>
        <code>/api/tmdb/detalhes/:tipo/:id</code> - Detalhes de filme/série
      </div>

      <div class="endpoint">
        <span class="method get">GET</span>
        <code>/api/tmdb/detalhes/tv/:id/season/:seasonNumber</code> - Dados da temporada
      </div>
      
      <div class="endpoint">
        <span class="method post">POST</span>
        <code>/api/gerar-banner</code> - Gerar banner (requer autenticação)
      </div>
      
      <div class="endpoint">
        <span class="method post">POST</span>
        <code>/api/upload</code> - Upload de imagem (requer autenticação)
      </div>
      
      <p><strong>Status:</strong> ✅ Online</p>
      <p><strong>Versão:</strong> 2.2.0</p>
    </body>
    </html>
  `);
});

// -------------------------
// GRACEFUL SHUTDOWN
// -------------------------
const gracefulShutdown = async (signal) => {
  console.log(`\n📴 Recebido ${signal}. Encerrando servidor...`);
  
  imageCache.clear();
  tmdbCache.clear();
  
  try {
    await admin.app().delete();
    console.log("✅ Firebase encerrado com sucesso");
  } catch (error) {
    console.error("❌ Erro ao encerrar Firebase:", error.message);
  }
  
  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

// -------------------------
// INICIAR SERVIDOR
// -------------------------
app.listen(PORT, "0.0.0.0", () => {
  console.log(`
╔═══════════════════════════════════════╗
║   🚀 ORION CREATOR SERVER 2.2        ║
╚═══════════════════════════════════════╝

✅ Servidor rodando em: http://0.0.0.0:${PORT}
✅ Ambiente: ${process.env.NODE_ENV || 'development'}
✅ Firebase: Conectado
✅ TMDB API: Ativa
✅ Cache: Habilitado
✅ Rate Limiting: Ativo
✅ Segurança: Helmet + Auth

📚 Documentação: http://localhost:${PORT}/
🏥 Health Check: http://localhost:${PORT}/api/health
🎨 Cores: http://localhost:${PORT}/api/cores

Pressione Ctrl+C para encerrar
  `);
});