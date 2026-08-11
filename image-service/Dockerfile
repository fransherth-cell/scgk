FROM node:22-alpine

WORKDIR /app
COPY image-service/package.json ./
COPY image-service/server.js ./
COPY image ./public

ENV NODE_ENV=production
EXPOSE 8790

CMD ["npm", "start"]
