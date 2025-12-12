# Usa Node 18 (compatível com sua config)
FROM node:18

# Diretório da aplicação
WORKDIR /app

# Instalar FFmpeg, yt-dlp e dependências necessárias
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    curl \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Verificar instalações
RUN ffmpeg -version && yt-dlp --version

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
