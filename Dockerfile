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

# Wrapper : le SDK @anthropic-ai/claude-agent-sdk passe --no-interactive
# au binaire claude. Si la version installée ne le supporte pas → crash.
# Ce wrapper intercepte l'appel et filtre le flag problématique.
RUN CLAUDE_BIN=$(which claude) \
    && mv "$CLAUDE_BIN" "${CLAUDE_BIN}-real" \
    && { \
    echo '#!/bin/bash'; \
    echo '# Wrapper claude : supprime --no-interactive non supporté'; \
    echo 'args=()'; \
    echo 'for arg in "$@"; do'; \
    echo '  [ "$arg" != "--no-interactive" ] && args+=("$arg")'; \
    echo 'done'; \
    echo "exec \"${CLAUDE_BIN}-real\" \"\${args[@]}\""; \
    } > "$CLAUDE_BIN" \
    && chmod +x "$CLAUDE_BIN"

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

# Installer Chrome dans un dossier système (pas dans le HOME user)
# Ainsi le volume Docker ne l'écrase pas au runtime
ENV PUPPETEER_CACHE_DIR=/opt/puppeteer
RUN npx puppeteer browsers install chrome \
    && chmod -R 755 /opt/puppeteer

# Copier les autres fichiers
COPY scripts/ ./scripts/
COPY CLAUDE.md ./

# Créer les répertoires nécessaires et donner les droits à l'utilisateur claude
# chmod 777 sur /app/store : quand le bind-mount host est appliqué au runtime,
# il écrase les perms de l'image — 777 garantit l'accès en écriture dans tous les cas
RUN mkdir -p /app/store /workspace /home/claude/.claude/projects \
    && chown -R claude:claude /app /workspace /home/claude /opt/puppeteer \
    && chmod -R 777 /app/store

# Variables d'environnement par défaut
ENV NODE_ENV=production \
    LOG_LEVEL=info \
    HOME=/home/claude

# Basculer sur l'utilisateur non-root
USER claude

# Point d'entrée
CMD ["node", "dist/index.js"]
