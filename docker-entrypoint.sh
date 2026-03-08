#!/bin/bash
set -e

# Ce script s'exécute au démarrage du container en tant que root.
echo "[entrypoint] Checking and fixing permissions..."

# Fixer les permissions de manière récursive, -h pour ne pas suivre les liens symboliques
chown -R -h claude:claude /home/claude /app /workspace /opt/puppeteer || true

# Créer le lien symbolique pour la session Claude si le dossier de volume existe
if [ -d "/home/claude/.claude_session" ]; then
    echo "[entrypoint] Setting up Claude session symlink..."
    # Supprimer un éventuel fichier/dossier existant pour éviter les conflits
    rm -rf /home/claude/.claude.json
    # Créer le lien vers le fichier qui sera créé plus tard par 'claude login'
    ln -sf /home/claude/.claude_session/.claude.json /home/claude/.claude.json
    chown -h claude:claude /home/claude/.claude.json
fi

echo "[entrypoint] Starting ClaudeClaw..."

# Exécuter la commande passée au container en tant qu'utilisateur 'claude'
# On utilise 'su' pour changer d'utilisateur tout en restant dans le processus principal
exec su claude -c "node dist/index.js"
