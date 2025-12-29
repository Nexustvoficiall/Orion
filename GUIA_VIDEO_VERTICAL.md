# 🎬 Guia Rápido - Geração de Vídeo Vertical

## ✅ Pré-requisitos

Antes de usar a funcionalidade de geração de vídeo, certifique-se de que as seguintes ferramentas estão instaladas:

### Windows
```powershell
# 1. Instalar FFmpeg
# Baixar de: https://ffmpeg.org/download.html
# Adicionar ao PATH do sistema

# 2. Instalar yt-dlp
# Baixar de: https://github.com/yt-dlp/yt-dlp/releases
# Colocar yt-dlp.exe no PATH ou na pasta do projeto
```

### Linux/Ubuntu
```bash
sudo apt update
sudo apt install ffmpeg yt-dlp
```

### macOS
```bash
brew install ffmpeg yt-dlp
```

---

## 🚀 Como Usar

### 1. Via Interface Web (videos.html)

1. Acesse `http://localhost:3000/videos.html`
2. Faça login com sua conta Firebase
3. Busque um filme ou série
4. Clique no card para abrir o modal
5. Configure:
   - **Duração**: 30s, 60s ou 90s
   - **Qualidade**: 480p, 720p ou 1080p
   - **Temporada** (se for série)
6. Clique em **"✨ Gerar Vídeo"**
7. Aguarde o processamento (pode levar 30s a 2min)
8. Baixe o vídeo gerado

### 2. Via API (Programaticamente)

```javascript
// Exemplo com fetch
const token = await firebase.auth().currentUser.getIdToken();

const response = await fetch('http://localhost:3000/api/gerar-video', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({
    tmdbId: 872585,        // ID do filme/série no TMDB
    tmdbTipo: 'movie',     // 'movie' ou 'tv'
    duracao: 30,           // 30, 60 ou 90
    qualidade: 480,        // Opcional
    temporada: 1           // Apenas para séries
  })
});

const blob = await response.blob();
const url = URL.createObjectURL(blob);

// Baixar
const a = document.createElement('a');
a.href = url;
a.download = 'video.mp4';
a.click();
```

---

## 🧪 Testar Instalação

### Verificar Dependências
```bash
# Testar FFmpeg
ffmpeg -version

# Testar yt-dlp
yt-dlp --version
```

### Verificar via API
```bash
# Health check
curl http://localhost:3000/api/health

# Diagnóstico de vídeo (requer autenticação)
curl -H "Authorization: Bearer SEU_TOKEN" \
     http://localhost:3000/api/test-video
```

### Script de Teste Automatizado
```bash
# 1. Configurar token de teste no .env
FIREBASE_TEST_TOKEN=seu_token_aqui

# 2. Executar testes
node test-video-generation.js
```

---

## 📊 Especificações Técnicas

| Propriedade | Valor |
|------------|-------|
| **Resolução** | 1080x1920 (vertical) |
| **Formato** | MP4 (H.264 + AAC) |
| **FPS** | 30 |
| **Qualidade** | Alta (CRF 18) |
| **Áudio** | 192 kbps, 48 kHz |
| **Duração** | 30s, 60s ou 90s |

---

## 📂 Estrutura de Arquivos

```
orionlab/
├── server.js                          # Endpoint /api/gerar-video (linha 1375)
├── public/
│   ├── videos.html                    # Interface de geração
│   ├── images/
│   │   └── videos/
│   │       └── overlay.png            # ⚠️ OBRIGATÓRIO (1080x1920)
│   └── videos/                        # Saída dos vídeos gerados
├── temp/                              # Arquivos temporários (auto-criado)
├── VIDEO_VERTICAL_SPEC.md             # Documentação técnica completa
└── test-video-generation.js           # Script de teste
```

---

## ❓ Problemas Comuns

### 1. "FFmpeg não encontrado"
```bash
# Linux
sudo apt install ffmpeg

# Windows: Adicionar ao PATH
# macOS
brew install ffmpeg
```

### 2. "yt-dlp não encontrado"
```bash
# Linux
sudo apt install yt-dlp

# Windows: Baixar executável
# https://github.com/yt-dlp/yt-dlp/releases

# macOS
brew install yt-dlp
```

### 3. "Overlay não encontrado"
Certifique-se de que o arquivo existe:
```
public/images/videos/overlay.png
```
Dimensões: **1080x1920** (vertical)

### 4. "Trailer não disponível"
Alguns filmes/séries não têm trailers no TMDB. Escolha outro título.

### 5. "Erro ao compor vídeo"
Verifique os logs do servidor para detalhes. Possíveis causas:
- FFmpeg desatualizado (mínimo v4.x)
- Memória insuficiente
- Permissões de escrita

---

## 🎨 Personalizar Overlay

Para personalizar o overlay visual:

1. Edite: `public/images/videos/overlay.png`
2. Dimensões: **1080x1920** (vertical)
3. Use transparência (canal alpha) para áreas que devem mostrar o conteúdo abaixo
4. Mantenha áreas importantes (textos, poster) visíveis

### Ferramentas Recomendadas
- Photoshop
- GIMP (gratuito)
- Figma

---

## 📈 Limites e Rate Limiting

| Operação | Limite |
|----------|--------|
| Geração de vídeo | 3 vídeos / 5 minutos / usuário |
| API TMDB | 500 requisições / 15 minutos |
| Duração máxima | 90 segundos |
| Tamanho típico | 5-15 MB por vídeo |

---

## 🔧 Variáveis de Ambiente

Necessárias no `.env`:

```env
TMDB_KEY=sua_chave_tmdb
FANART_API_KEY=sua_chave_fanart
FIREBASE_PROJECT_ID=seu_projeto
FIREBASE_PRIVATE_KEY=sua_chave_privada
FIREBASE_CLIENT_EMAIL=seu_email
PORT=3000
```

---

## 📞 Suporte

Em caso de problemas:

1. Verifique os logs do servidor
2. Execute: `node test-video-generation.js`
3. Consulte: `VIDEO_VERTICAL_SPEC.md`
4. Verifique: `/api/test-video` (diagnóstico)

---

## 🎯 Exemplo Completo

```javascript
// Frontend (videos.html já implementado)
async function gerarVideoExemplo() {
  const token = await firebase.auth().currentUser.getIdToken();
  
  const response = await fetch('/api/gerar-video', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      tmdbId: 19995,      // Avatar
      tmdbTipo: 'movie',
      duracao: 30
    })
  });
  
  if (!response.ok) {
    const error = await response.json();
    console.error('Erro:', error);
    return;
  }
  
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  
  // Criar link de download
  const a = document.createElement('a');
  a.href = url;
  a.download = 'avatar_video.mp4';
  a.click();
  
  // Limpar
  URL.revokeObjectURL(url);
}
```

---

**Versão**: 2.8.21  
**Última atualização**: 28/12/2025
