# Usa Node 18 (compatível com sua config)
FROM node:18

# Diretório da aplicação
WORKDIR /app

# Instalar FFmpeg, yt-dlp e dependências (otimizado para Render)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    python3-pip \
    curl \
    wget \
    ca-certificates \
    git \
    && python3 -m pip install --no-cache-dir yt-dlp \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Verificar instalações
RUN echo "✅ FFmpeg:" && ffmpeg -version | head -1 && echo "✅ yt-dlp:" && yt-dlp --version && echo "✅ Python:" && python3 --version

# Copiar package.json
COPY package*.json ./

# Instalar dependências
RUN npm install

# Copiar todo o projeto
COPY . .

# Expor porta
EXPOSE 8080

# Iniciar
CMD ["npm", "start"]
