# Production image for Cloud Run (or any Docker host)
FROM node:22-slim
WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .
RUN npm run build

ENV NODE_ENV=production
# Cloud Run sets PORT automatically; the server reads it.
EXPOSE 8080
CMD ["npm", "start"]
