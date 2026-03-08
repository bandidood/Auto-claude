#!/bin/bash
set -e

# Ce script s'exécute au démarrage du container.

echo "[entrypoint] Checking permissions for /home/claude..."

# S'assurer que les volumes montés appartiennent bien à l'utilisateur 'claude'
# On utilise sudo si nécessaire, ou on s'attend à ce que le script puisse le faire
# Note: Dans notre Dockerfile, on va passer root -> script -> claude
chown -R claude:claude /home/claude /app /workspace /opt/puppeteer

echo "[entrypoint] Starting ClaudeClaw as user 'claude'..."

# Exécuter la commande passée au container en tant qu'utilisateur 'claude'
exec su claude -c "node dist/index.js"
