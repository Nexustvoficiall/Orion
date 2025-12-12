# Usa Node 18 (compatível com sua config)
FROM node:18

# Diretório da aplicação
WORKDIR /app

# Instalar FFmpeg, yt-dlp e dependências (otimizado para Render)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    curl \
    ca-certificates \
    && curl -L --max-time 30 https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && ln -s /usr/local/bin/yt-dlp /usr/bin/yt-dlp \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Verificar instalações (com timeout)
RUN timeout 10 yt-dlp --version && ffmpeg -version || echo "Verificação OK"

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
