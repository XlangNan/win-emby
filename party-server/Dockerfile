# 织影「一起看」中转服务（零依赖，不需要 npm install）
# 基础镜像走国内镜像站；如果这个站失效，把 BASE 换成 docker.1ms.run/library/node:20-alpine 之类的即可
ARG BASE=docker.m.daocloud.io/library/node:20-alpine
FROM ${BASE}
WORKDIR /app
COPY package.json server.js admin.html ./
ENV PORT=8787
EXPOSE 8787
CMD ["node", "server.js"]
