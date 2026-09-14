FROM node:22-alpine
WORKDIR /app
COPY server.mjs data.json ./
ENV NODE_ENV=production
EXPOSE 8090
CMD ["node", "server.mjs"]
