# Usa Node 18 (compatível com sua config)
FROM node:18

# Diretório da aplicação
WORKDIR /app

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
