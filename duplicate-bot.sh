#!/bin/bash

# Script de duplication automatique de bot Telegram
# Usage: ./duplicate-bot.sh NOM_DOSSIER NOM_PM2 BOT_TOKEN

# Couleurs pour l'affichage
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Vérifier les arguments
if [ $# -ne 3 ]; then
    echo -e "${RED}❌ Erreur: Nombre d'arguments incorrect${NC}"
    echo "Usage: ./duplicate-bot.sh NOM_DOSSIER NOM_PM2 BOT_TOKEN"
    echo "Exemple: ./duplicate-bot.sh shop-bot SHOP-BOT 123456:ABCdef..."
    exit 1
fi

FOLDER_NAME=$1
PM2_NAME=$2
BOT_TOKEN=$3
ADMIN_ID=${4:-8346344099}  # ID admin par défaut

echo -e "${YELLOW}🚀 Début de la duplication du bot...${NC}"

# Vérifier si le dossier existe déjà
if [ -d "/opt/$FOLDER_NAME" ]; then
    echo -e "${RED}❌ Erreur: Le dossier /opt/$FOLDER_NAME existe déjà${NC}"
    exit 1
fi

# Créer le dossier
echo -e "${GREEN}📁 Création du dossier /opt/$FOLDER_NAME${NC}"
mkdir -p /opt/$FOLDER_NAME
cd /opt/$FOLDER_NAME

# Cloner le repository
echo -e "${GREEN}📥 Clonage du repository...${NC}"
git clone https://github.com/juniorrrrr345/botOPP.git . --quiet

# Installer les dépendances
echo -e "${GREEN}📦 Installation des dépendances...${NC}"
npm install --silent
npm install sqlite3 --silent

# Créer le fichier .env
echo -e "${GREEN}⚙️ Création du fichier .env...${NC}"
cat > .env << EOF
# Bot Telegram
BOT_TOKEN=$BOT_TOKEN
ADMIN_ID=$ADMIN_ID

# Base de données SQLite unique pour ce bot
DB_TYPE=sqlite
DB_NAME=${FOLDER_NAME}.db

# Cloudflare D1 (optionnel, décommentez si nécessaire)
# CLOUDFLARE_ACCOUNT_ID=
# CLOUDFLARE_DATABASE_ID=
# CLOUDFLARE_API_TOKEN=
EOF

# Modifier db-sqlite.js pour utiliser DB_NAME de l'environnement
echo -e "${GREEN}🔧 Configuration de la base de données...${NC}"
if [ -f "db-sqlite.js" ]; then
    sed -i "s|path.join(__dirname, 'bot.db')|path.join(__dirname, process.env.DB_NAME || 'bot.db')|g" db-sqlite.js
fi

# Démarrer le bot avec PM2
echo -e "${GREEN}🤖 Démarrage du bot avec PM2...${NC}"
pm2 start bot-complete.js --name "$PM2_NAME"
pm2 save --force

# Afficher le résumé
echo -e "${GREEN}✅ Bot dupliqué avec succès!${NC}"
echo -e "📁 Dossier: ${YELLOW}/opt/$FOLDER_NAME${NC}"
echo -e "🤖 Nom PM2: ${YELLOW}$PM2_NAME${NC}"
echo -e "💾 Base de données: ${YELLOW}${FOLDER_NAME}.db${NC}"
echo -e "📝 Logs: ${YELLOW}pm2 logs $PM2_NAME${NC}"
echo ""
echo -e "${YELLOW}👉 Pour configurer votre bot:${NC}"
echo -e "   1. Ouvrez Telegram et cherchez votre bot"
echo -e "   2. Tapez /start puis /admin"
echo -e "   3. Configurez les messages, services et réseaux sociaux"
echo ""
echo -e "${GREEN}🎉 Votre bot est maintenant opérationnel!${NC}"