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
import serviceAccount from "./api/firebaseServiceAccount.js";

dotenv.config();

// -------------------------
// HEALTH CHECK ROBUSTO
// -------------------------
app.get("/api/health", async (req, res) => {
  const checks = {
    server: true,
    firebase: false,
    tmdb: false,
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  };

  // Verificar Firebase
  try {
    await db.collection("usuarios").limit(1).get();
    checks.firebase = true;
  } catch (error) {
    console.error("❌ Health check Firebase falhou:", error.message);
  }

  // Verificar TMDB
  try {
    const response = await fetch(
      `https://api.themoviedb.org/3/movie/popular?api_key=${process.env.TMDB_KEY}&page=1`,
      { timeout: 5000 }
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
// ROTA DE LIMPEZA DE CACHE (PROTEGIDA)
// -------------------------
app.post("/api/cache/clear", verificarAuth, async (req, res) => {
  try {
    // Verificar se usuário tem permissão (admin)
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
// ROTA DE ESTATÍSTICAS (PROTEGIDA)
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
// ROTA DE PREVIEW DE CORES
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
// TRATAMENTO DE ERROS GLOBAL
// -------------------------
app.use((err, req, res, next) => {
  console.error("❌ Erro não tratado:", err.stack);
  
  // Erro do Multer (upload)
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: "Arquivo muito grande (máximo 10MB)" });
    }
    return res.status(400).json({ error: `Erro no upload: ${err.message}` });
  }
  
  // Erro genérico
  res.status(err.status || 500).json({ 
    error: err.message || "Erro interno do servidor",
    details: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// 404 Handler
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
        <span class="method post">POST</span>
        <code>/api/gerar-banner</code> - Gerar banner (requer autenticação)
      </div>
      
      <div class="endpoint">
        <span class="method post">POST</span>
        <code>/api/upload</code> - Upload de imagem (requer autenticação)
      </div>
      
      <p><strong>Status:</strong> ✅ Online</p>
      <p><strong>Versão:</strong> 2.0.0</p>
    </body>
    </html>
  `);
});

// -------------------------
// GRACEFUL SHUTDOWN
// -------------------------
const gracefulShutdown = async (signal) => {
  console.log(`\n📴 Recebido ${signal}. Encerrando servidor...`);
  
  // Limpar caches
  imageCache.clear();
  tmdbCache.clear();
  
  // Fechar Firebase
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

// Tratamento de erros não capturados
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
║   🚀 ORION CREATOR SERVER 2.0        ║
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
// CONFIGURAÇÕES E VALIDAÇÃO
// -------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Validar variáveis de ambiente críticas
const requiredEnvVars = ['TMDB_KEY', 'PORT'];
requiredEnvVars.forEach(varName => {
  if (!process.env[varName]) {
    console.error(`❌ ERRO: Variável ${varName} não definida no .env`);
    process.exit(1);
  }
});

// Inicializar Firebase
if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
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
  contentSecurityPolicy: false, // Ajustar conforme necessário
  crossOriginEmbedderPolicy: false
}));

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

// Rate Limiters
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // 100 requisições por IP
  message: { error: "Muitas requisições. Tente novamente em 15 minutos." },
  standardHeaders: true,
  legacyHeaders: false,
});

const bannerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10, // 10 banners por 15 min
  message: { error: "Limite de geração de banners atingido. Aguarde 15 minutos." }
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 20,
  message: { error: "Limite de uploads atingido. Aguarde 1 hora." }
});

// Aplicar rate limit em todas as rotas /api
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
  constructor(ttl = 3600000) { // 1 hora padrão
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
    
    // Limpar cache antigo periodicamente
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

const imageCache = new SimpleCache(3600000); // Cache de imagens: 1 hora
const tmdbCache = new SimpleCache(1800000);  // Cache TMDB: 30 minutos

// -------------------------
// UPLOAD (MULTER + CLOUDINARY)
// -------------------------
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "orioncreator",
    allowed_formats: ["jpg", "png", "jpeg", "webp"],
    transformation: [{ width: 2000, height: 3000, crop: "limit" }] // Limitar tamanho
  },
});

const upload = multer({ 
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
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

// Domínios permitidos para imagens
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
  
  // Não permitir URLs locais
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
  
  // Validar URL
  if (!validarURL(url)) {
    throw new Error(`URL não permitida ou inválida: ${url}`);
  }

  // Verificar cache
  if (useCache) {
    const cached = imageCache.get(url);
    if (cached) return cached;
  }

  try {
    const res = await fetch(url, { 
      timeout: 10000,
      headers: { 'User-Agent': 'OrionCreator/1.0' }
    });
    
    if (!res.ok) {
      throw new Error(`Falha ao baixar imagem: status ${res.status}`);
    }
    
    const buffer = Buffer.from(await res.arrayBuffer());
    
    // Validar que é realmente uma imagem
    const metadata = await sharp(buffer).metadata();
    if (!metadata.format) {
      throw new Error("Arquivo não é uma imagem válida");
    }
    
    // Converter para PNG e armazenar no cache
    const pngBuffer = await sharp(buffer)
      .png()
      .toBuffer();
    
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
    const response = await fetch(url, { timeout: 5000 });
    
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
    const r = await fetch(url, { timeout: 5000 });
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
      const r = await fetch(url, { timeout: 5000 });
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
      backdropUrl
    } = req.body || {};

    // Validações de entrada
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

    // Validar backdropUrl se fornecida
    if (backdropUrl && !validarURL(backdropUrl)) {
      return res.status(400).json({ error: "URL do backdrop inválida." });
    }

    const corKey = (modeloCor || "ROXO").toUpperCase();
    if (!COLORS[corKey]) {
      return res.status(400).json({ error: `Cor '${corKey}' não existe. Cores disponíveis: ${Object.keys(COLORS).join(', ')}` });
    }
    const corConfig = COLORS[corKey];

    // Dimensões
    const width = tipo === "horizontal" ? 1920 : 1080;
    const height = tipo === "horizontal" ? 1080 : 1920;

    // ----------------------------------------
    // 1. PREPARAR BACKGROUND
    // ----------------------------------------
    let finalBackgroundBuffer;

    if (modeloTipo === "ORION_EXCLUSIVO") {
      let backUrlToUse = backdropUrl;

      if (!backUrlToUse && tmdbId) {
        const tTipo = tmdbTipo || "movie";
        const urlTMDB = `https://api.themoviedb.org/3/${tTipo}/${tmdbId}/images?api_key=${process.env.TMDB_KEY}`;
        
        try {
          const resTMDB = await fetch(urlTMDB, { timeout: 5000 });
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
      // Backgrounds verticais estáticos
      const verticalBanners = {
        ROXO: "https://res.cloudinary.com/dxbu3zk6i/image/upload/v1762868011/vertical_roxo_hmse9c.png",
        AZUL: "https://res.cloudinary.com/dxbu3zk6i/image/upload/v1762868011/vertical_azul_qdlxzx.png",
        VERMELHO: "https://res.cloudinary.com/dxbu3zk6i/image/upload/v1762868008/vertical_vermelho_r68hct.png",
        VERDE: "https://res.cloudinary.com/dxbu3zk6i/image/upload/v1762868010/vertical_verde_ylxm0x.png",
        PRATA: "https://res.cloudinary.com/dxbu3zk6i/image/upload/v1762868008/vertical_prata_fxp1xt.png",
        AMARELO: "https://res.cloudinary.com/dxbu3zk6i/image/upload/v1762866810/orioncreator/dsh5nkghf7eisqboa5pv.png",
        DOURADO: "https://res.cloudinary.com/dxbu3zk6i/image/upload/v1762868008/vertical_dourado_po9uqt.png",
        LARANJA: "https://res.cloudinary.com/dxbu3zk6i/image/upload/v1762868009/vertical_lajanja_pkwbvv.png"
      };
      
      const bgUrl = verticalBanners[corKey];
      if (!bgUrl) {
        return res.status(400).json({ error: "Background não encontrado para a cor selecionada." });
      }
      
      finalBackgroundBuffer = await fetchBuffer(bgUrl);
    }

    // ----------------------------------------
    // 2. GRADIENTE
    // ----------------------------------------
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
      gradientOverlay = Buffer.from(`<svg width="${width}" height="${height}"><rect width="100%" height="100%" fill="rgba(0,0,0,0.3)"/></svg>`);
    }

    // ----------------------------------------
    // 3. POSTER
    // ----------------------------------------
    const posterBufferOriginal = await fetchBuffer(posterUrl);
    
    let pW, pH, pLeft, pTop;
    if (modeloTipo === "ORION_EXCLUSIVO") {
      pW = tipo === "horizontal" ? 450 : 600;
      pH = Math.round(pW * 1.5);
      pLeft = tipo === "horizontal" ? 100 : Math.round((width - pW) / 2);
      pTop = tipo === "horizontal" ? Math.round((height - pH) / 2) : 150;
    } else {
      pW = tipo === "horizontal" ? Math.round(width * 0.32) : Math.round(width * 0.5);
      pH = Math.round(pW * 1.5);
      pLeft = Math.round((width - pW) / 2);
      pTop = Math.round(height * 0.08);
    }

    const posterResized = await sharp(posterBufferOriginal)
      .resize(pW, pH, { fit: 'cover', position: 'center' })
      .png()
      .toBuffer();

    // ----------------------------------------
    // 4. TEXTOS
    // ----------------------------------------
    const wrapLimit = tipo === "horizontal" ? 55 : 35;
    const linhasSinopse = wrapText(sinopse || "", wrapLimit);
    
    const textX = tipo === "horizontal" ? (pLeft + pW + 60) : Math.round(width / 2);
    const textAnchor = tipo === "horizontal" ? "start" : "middle";
    const textYStart = tipo === "horizontal" ? Math.round(height / 2) - 100 : (pTop + pH + 60);

    const notaF = nota ? parseFloat(nota).toFixed(1) : "N/A";
    const duracaoF = formatTime(duracao) || duracao || "";
    const metaString = `⭐ ${notaF}  |  ${ano || ''}  |  ${genero || ''}  |  ${duracaoF}`;

    const svgText = `
      <svg width="${width}" height="${height}">
        <style>
          .title { fill: white; font-family: Arial, sans-serif; font-weight: 900; font-size: ${tipo === "horizontal" ? "80px" : "60px"}; }
          .meta  { fill: ${corConfig.hex}; font-family: Arial, sans-serif; font-weight: bold; font-size: 30px; }
          .synop { fill: #dddddd; font-family: Arial, sans-serif; font-size: ${tipo === "horizontal" ? "32px" : "28px"}; }
        </style>
        <text x="${textX}" y="${textYStart}" text-anchor="${textAnchor}" class="title">
          ${safeXml(titulo).toUpperCase()}
        </text>
        <text x="${textX}" y="${textYStart + 60}" text-anchor="${textAnchor}" class="meta">
          ${safeXml(metaString)}
        </text>
        ${linhasSinopse.map((line, i) => `
          <text x="${textX}" y="${textYStart + 120 + (i * 40)}" text-anchor="${textAnchor}" class="synop">
            ${safeXml(line)}
          </text>
        `).join('')}
      </svg>
    `;

    // ----------------------------------------
    // 5. LOGO DO USUÁRIO
    // ----------------------------------------
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

    // Fallback para logo padrão
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

    // ----------------------------------------
    // 6. COMPOSIÇÃO FINAL
    // ----------------------------------------
    const layers = [
      { input: gradientOverlay, top: 0, left: 0 },
      { input: posterResized, top: pTop, left: pLeft },
      { input: Buffer.from(svgText), top: 0, left: 0 }
    ];
    
    if (logoLayer) layers.push(logoLayer);

    const finalImage = await sharp(finalBackgroundBuffer)
      .resize(width, height)
      .composite(layers)
      .png({ quality: 90, compressionLevel: 9 })
      .toBuffer();

    // Enviar resposta
    const sanitizedTitle = titulo.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);
    res.setHeader("Content-Disposition", `attachment; filename=banner_${sanitizedTitle}.png`);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(finalImage);

    console.log(`✅ Banner gerado com sucesso para usuário ${req.uid}`);

  } catch (error) {
    console.error("❌ Erro Crítico no Gerador:", error.message, error.stack);
    res.status(500).json({ 
      error: "Falha ao gerar o banner",
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// -------------------------