# 🦀 ClaudeClaw

ClaudeClaw est un agent IA autonome basé sur **Claude Code** (Anthropic) et connecté à **Telegram** (avec support WhatsApp). Il agit comme un assistant de développement complet, capable d'exécuter des commandes, lire et éditer des fichiers dans son espace de travail, et réaliser des tâches asynchrones complexes.

## ✨ Fonctionnalités

- 🤖 **Agent Autonome** : Intègre le puissant `@anthropic-ai/claude-agent-sdk` pour raisonner, coder et exécuter des tâches.
- 💬 **Interface Telegram** : Contrôlez votre agent de n'importe où via Telegram.
- 📱 **Bridge WhatsApp** : (Optionnel) Recevez vos messages WhatsApp directement via l'agent.
- 🐳 **Exécution Sécurisée** : Tourne dans un conteneur Docker isolé avec son propre espace de travail (`/workspace`).
- 🎙️ **Support Audio/Vidéo** : Transcription vocale (Groq/Whisper), synthèse vocale (ElevenLabs) et compréhension vidéo (Google Gemini).
- 🕒 **Tâches Planifiées** : Demandez à ClaudeClaw d'exécuter des actions à intervalles réguliers (`/schedule`).
- 🧠 **Mémoire Persistante** : Conserve l'historique de contexte via une base SQLite (`/store`).

---

## 🚀 Installation & Déploiement

### Prérequis

1. Obtenez un Token Telegram via [@BotFather](https://t.me/botfather).
2. Optionnel : Obtenez vos clés API pour les services additionnels (Groq, ElevenLabs, Gemini).
3. **Important** : Si vous utilisez l'API Anthropic officielle, vous aurez besoin de `ANTHROPIC_API_KEY`. Cependant, par défaut, le projet est configuré pour lancer Claude via Ollama (modèle local) !

### Configuration

Renommez le fichier `/.env.example` en `/.env` et remplissez vos informations :

```bash
cp .env.example .env
# Éditez le fichier .env (n'ajoutez JAMAIS ce fichier sur Git !)
```

> **Note** : Pour obtenir votre `ALLOWED_CHAT_ID`, lancez simplement le bot et envoyez-lui la commande `/chatid` sur Telegram.

---

### Option 1 : Déploiement Production (Recommandé - via Coolify)

Ce projet est optimisé pour un déploiement "1-click" sur [Coolify](https://coolify.io/) !

1. Poussez ce dépôt sur votre compte GitHub.
2. Dans Coolify, créez une nouvelle ressource "Project" et connectez votre dépôt GitHub.
3. Choisissez l'option de déploiement via **Docker Compose**.
4. Dans l'onglet **Environment Variables**, collez le contenu de votre fichier `.env`.
5. Lancez le déploiement !

Coolify utilisera le fichier `docker-compose.yml` par défaut. Il créera automatiquement des volumes virtuels sécurisés pour la persistance des données.

*💡 Astuce : Si WhatsApp est activé, consultez les logs de déploiement de l'application sur Coolify pour scanner le QR Code lors du premier démarrage.*

---

### Option 2 : Exécution Locale Docker (Développement)

Pour tester l'application en local tout en gardant accès aux répertoires de données depuis votre machine :

```bash
# Lancer le conteneur en arrière-plan
docker compose -f docker-compose-local.yml up --build -d

# Voir les logs en temps réel
docker compose -f docker-compose-local.yml logs -f

# Arrêter l'agent
docker compose -f docker-compose-local.yml down
```

Vos données locales (`./store` et `./workspace`) seront montées directement dans le conteneur.

---

### Option 3 : Mode Développement local pur (sans Docker)

Si vous voulez modifier le code source TypeScript de l'agent :

```bash
# Installer les dépendances
npm install

# Lancer en mode developpement (recharge auto)
npm run dev

# Compiler le projet
npm run build
```

---

## 📁 Architecture du projet

- `src/` : Code source de l'agent (TypeScript).
- `store/` : (Généré) Base de données SQLite (`claudeclaw.db`) pour la mémoire et les sessions.
- `workspace/` : (Généré) Le bac à sable de Claude Code. C'est ici que l'agent peut lire, écrire et exécuter des fichiers.
- `Dockerfile` : Recette de conteneurisation optimisée pour Node et Claude CLI.
- `docker-compose.yml` : Configuration de production (pour Coolify ou serveurs standards).
- `docker-compose-local.yml` : Configuration spéciale de développement.

## 🤝 Contribution

Les "Pull Requests" sont les bienvenues ! Pensez à formatter votre code et à définir/respecter les règles Lint avant de soumettre.

## 📝 Licence

Distribué sous la licence MIT. Voir `LICENSE` pour plus d'informations.
