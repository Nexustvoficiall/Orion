# Orion Creator - Instruções para Agentes de IA

## Visão Geral da Arquitetura

Este é um **gerador de banners e vídeos promocionais** para filmes e séries, consumindo dados do TMDB e Fanart.tv.

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND (public/)                        │
│  vods.html → UI principal de criação de banners/vídeos          │
│  Firebase Auth (SDK web) → autenticação client-side             │
└───────────────────────────┬─────────────────────────────────────┘
                            │ Bearer Token (Firebase ID Token)
┌───────────────────────────▼─────────────────────────────────────┐
│                    BACKEND (server.js)                           │
│  Express 5 + Firebase Admin SDK                                  │
│  ├─ /api/tmdb/* → Proxy para TMDB (com cache)                   │
│  ├─ /api/gerar-banner → Gera banners PNG (Sharp)                │
│  ├─ /api/gerar-video → Gera vídeos MP4 (FFmpeg + yt-dlp)        │
│  └─ /api/upload → Upload para Cloudinary                        │
└─────────────────────────────────────────────────────────────────┘
```

## Stack Tecnológico

- **Runtime**: Node.js 18 (ES Modules - `"type": "module"`)
- **Framework**: Express 5
- **Auth**: Firebase Authentication + Firebase Admin SDK
- **Database**: Firestore (usuários, banners salvos)
- **Processamento de imagem**: Sharp
- **Processamento de vídeo**: FFmpeg + yt-dlp
- **CDN**: Cloudinary (armazenamento de imagens)
- **APIs externas**: TMDB (metadados), Fanart.tv (logos)

## Comandos Essenciais

```bash
npm start              # Inicia o servidor (porta definida em .env ou 3000)
docker build -t orion  # Build com FFmpeg + yt-dlp inclusos
```

## Variáveis de Ambiente Obrigatórias

O servidor falha na inicialização sem estas variáveis (ver validação em `server.js` linhas 40-48):
- `TMDB_KEY`, `FANART_API_KEY` - APIs de metadados
- `FIREBASE_PROJECT_ID`, `FIREBASE_PRIVATE_KEY`, `FIREBASE_CLIENT_EMAIL` - Admin SDK
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` - Storage

## Padrões e Convenções

### Autenticação de Rotas
Rotas protegidas usam middleware `verificarAuth` que extrai o UID do token Firebase:
```javascript
app.post("/api/gerar-banner", verificarAuth, bannerLimiter, async (req, res) => {
  const userId = req.uid; // UID do Firebase
  // ...
});
```

### Rate Limiting
Cada tipo de endpoint tem limiter específico:
- `tmdbLimiter` - 500 req/15min (proxy TMDB)
- `authLimiter` - 100 req/15min (endpoints autenticados)
- `bannerLimiter` - 20 req/5min (geração de banners)
- `uploadLimiter` - 20 req/hora (uploads)

### Sistema de Cache
Duas instâncias de `SimpleCache` (classe custom em server.js):
- `imageCache` - Buffers de imagens (TTL: 1h, max: 200)
- `tmdbCache` - Respostas TMDB (TTL: 30min, max: 500)

### Modelos de Banner
Três modelos visuais com overlays específicos (ver constantes `PREMIUM_OVERLAYS`, `ORION_X_OVERLAYS`):
- **ORION_PREMIUM** / **PADRAO**: Usa overlays remotos do Cloudinary
- **ORION_EXCLUSIVO**: Combina logo TMDB/Fanart + textos SVG
- **ORION_X**: Formato 1080x1540, logo TMDB prioritário

### Cores Disponíveis
Definidas na constante `COLORS`: PRETO, ROXO, AZUL, VERDE, VERMELHO, LARANJA, AMARELO, DOURADO, ROSA, PRATA

## Arquivos-Chave

| Arquivo | Responsabilidade |
|---------|-----------------|
| `server.js` | API principal (~2500 linhas), todas as rotas |
| `api/tmdb.js` | Funções de busca TMDB |
| `api/fanart-service.js` | Serviço Fanart.tv (logos HD) |
| `api/cloudinary.js` | Configuração Cloudinary |
| `public/js/auth.js` | Autenticação client-side (Firebase Web SDK) |
| `public/vods.html` | UI principal de criação (~3200 linhas inline) |

## Atenção ao Modificar

1. **URLs permitidas**: A função `validarURL()` restringe domínios de imagem (`ALLOWED_IMAGE_DOMAINS`)
2. **Dimensões de banner**: Cada modelo tem dimensões específicas (ex: Orion X = 1080x1540)
3. **Job de limpeza**: Há um `setInterval` que limpa banners expirados do Cloudinary/Firestore a cada 1h
4. **Temporadas de séries**: Ao gerar banner de série com temporada, os metadados (ano/nota) são buscados da temporada específica

## Documentação Adicional

- `API_VIDEO_DOCS.md` - Especificação do endpoint `/api/gerar-video`
- `IMPLEMENTACAO_FFMPEG.md` - Guia técnico do pipeline FFmpeg
