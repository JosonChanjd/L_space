# 通用 Dockerfile（Railway / Fly.io / 自建服务器均可使用）
FROM node:20-alpine

WORKDIR /app
COPY . .

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
