FROM node:20

# Outils système nécessaires à Claude Code pour exécuter des commandes
RUN apt-get update && apt-get install -y \
    git \
    curl \
    bash \
    python3 \
    make \
    g++ \
    ripgrep \
    zstd \
    # Dépendances système pour Chrome/Puppeteer (whatsapp-web.js)
    ca-certificates \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    lsb-release \
    wget \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# Installer Ollama (utilisé pour lancer les modèles locaux)
RUN curl -fsSL https://ollama.com/install.sh | sh

# Installer Claude CLI globalement (requis par @anthropic-ai/claude-agent-sdk)
RUN npm install -g @anthropic-ai/claude-code

# Créer un utilisateur non-root (Claude Code refuse de tourner en root)
RUN useradd -m -u 1001 -s /bin/bash claude

# Répertoire de travail du projet
WORKDIR /app

# Copier les fichiers de configuration et les sources
COPY package*.json ./
COPY .npmrc* ./
COPY tsconfig*.json ./
COPY src/ ./src/

# Installer les dépendances et builder
RUN npm install
RUN npm run build

# Installer Chrome pour Puppeteer/whatsapp-web.js
ENV PUPPETEER_CACHE_DIR=/home/claude/.cache/puppeteer
RUN npx puppeteer browsers install chrome

# Copier les autres fichiers
COPY scripts/ ./scripts/
COPY CLAUDE.md ./

# Créer les répertoires nécessaires et donner les droits à l'utilisateur claude
RUN mkdir -p /app/store /workspace /home/claude/.claude/projects \
    && chown -R claude:claude /app /workspace /home/claude

# Variables d'environnement par défaut
ENV NODE_ENV=production \
    LOG_LEVEL=info \
    HOME=/home/claude

# Basculer sur l'utilisateur non-root
USER claude

# Point d'entrée
CMD ["node", "dist/index.js"]
