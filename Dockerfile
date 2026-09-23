# 🐳 [INVEST AI] Dockerfile de Producción para Google Cloud Run
FROM node:22-alpine

WORKDIR /app

# Copiar manifiestos e instalar dependencias de producción
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copiar código fuente de producción
COPY src/ ./src/
COPY package.json ./

# Asignar usuario no privilegiado para seguridad Zero-Trust
RUN chown -R node:node /app
USER node

# Configuración de puerto dinámico para Cloud Run
ENV PORT=8080
EXPOSE 8080

CMD ["node", "src/server.js"]
