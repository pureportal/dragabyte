FROM node:24-alpine AS build

WORKDIR /workspace

COPY package.json package-lock.json ./
COPY apps/client/package.json apps/client/package.json
COPY apps/landing/package.json apps/landing/package.json

RUN npm ci --workspace @dragabyte/landing --include-workspace-root=false --no-audit --no-fund

COPY apps/landing apps/landing
COPY assets assets

RUN npm run build:landing

FROM nginx:1.29-alpine

COPY --from=build /workspace/apps/landing/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD ["wget", "--quiet", "--output-document=/dev/null", "http://127.0.0.1/"]
