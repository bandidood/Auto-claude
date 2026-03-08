#!/bin/bash
set -e

# Ce script s'exécute au démarrage du container.

echo "[entrypoint] Checking permissions for /home/claude..."

# S'assurer que les volumes montés appartiennent bien à l'utilisateur 'claude'
chown -R claude:claude /home/claude /app /workspace /opt/puppeteer

# Créer le lien symbolique pour la session Claude si le dossier de volume existe
if [ -d "/home/claude/.claude_session" ]; then
    echo "[entrypoint] Setting up Claude session symlink..."
    # Supprimer un éventuel fichier/dossier existant pour éviter les conflits
    rm -rf /home/claude/.claude.json
    ln -s /home/claude/.claude_session/.claude.json /home/claude/.claude.json
    chown claude:claude /home/claude/.claude.json
fi

echo "[entrypoint] Starting ClaudeClaw as user 'claude'..."

# Exécuter la commande passée au container en tant qu'utilisateur 'claude'
exec su claude -c "node dist/index.js"
