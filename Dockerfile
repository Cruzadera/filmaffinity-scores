FROM node:20-slim

# Install dependencies required by Chromium / Puppeteer
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        fonts-liberation \
        libappindicator3-1 \
        libasound2 \
        libatk-bridge2.0-0 \
        libatk1.0-0 \
        libcups2 \
        libdbus-1-3 \
        libdrm2 \
        libgbm1 \
        libgdk-pixbuf2.0-0 \
        libgtk-3-0 \
        libnspr4 \
        libnss3 \
        libx11-xcb1 \
        libxcomposite1 \
        libxdamage1 \
        libxrandr2 \
        libxss1 \
        lsb-release \
        xdg-utils \
        wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files first for install caching
COPY package*.json ./

# Let Puppeteer download Chromium (bundled) and install only production deps
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=false
ENV NODE_ENV=production
RUN npm ci --only=production

# Copy source
COPY . .

EXPOSE 8085
CMD ["npm", "start"]
