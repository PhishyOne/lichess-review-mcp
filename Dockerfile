FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY src ./src
COPY scripts ./scripts
RUN npm run build
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080
USER node
CMD ["node", "dist/index.js"]
