FROM node:20-slim

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
    # Pour better-sqlite3 (compilation native)
    && rm -rf /var/lib/apt/lists/*

# Installer Ollama (utilisé pour lancer les modèles locaux)
RUN curl -fsSL https://ollama.com/install.sh | sh

# Installer Claude CLI globalement (requis par @anthropic-ai/claude-agent-sdk)
RUN npm install -g @anthropic-ai/claude-code

# Créer un utilisateur non-root (Claude Code refuse de tourner en root)
RUN useradd -m -u 1001 -s /bin/bash claude

# Répertoire de travail du projet
WORKDIR /app

# Copier les fichiers de dépendances
COPY package*.json ./
COPY .npmrc* ./
COPY tsconfig.json ./

# Installer les dépendances Node
RUN npm ci --omit=dev
RUN npm run build

# Copier le code source compilé
COPY dist/ ./dist/
COPY src/ ./src/
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
