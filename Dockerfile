FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY bot.js ./
ENV DATA_FILE=/data/data.json
CMD ["node", "bot.js"]
