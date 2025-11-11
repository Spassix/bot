# 📋 Guide de Duplication du Bot Telegram

Ce guide vous explique comment dupliquer le bot pour créer plusieurs instances indépendantes sans mélanger les données.

## 🎯 Principe Important

Chaque bot doit avoir :
- ✅ Son propre token Telegram
- ✅ Sa propre base de données
- ✅ Son propre fichier .env
- ✅ Son propre processus PM2

## 📁 Structure Recommandée

```
/opt/
├── bot1/
│   ├── bot-complete.js
│   ├── .env
│   └── bot1.db
├── bot2/
│   ├── bot-complete.js
│   ├── .env
│   └── bot2.db
└── bot3/
    ├── bot-complete.js
    ├── .env
    └── bot3.db
```

## 🚀 Étapes de Duplication

### 1. Créer un nouveau bot sur Telegram

1. Ouvrez [@BotFather](https://t.me/botfather) sur Telegram
2. Envoyez `/newbot`
3. Choisissez un nom pour votre bot
4. Choisissez un username (doit finir par 'bot')
5. Copiez le **TOKEN** donné par BotFather

### 2. Créer le dossier pour le nouveau bot

```bash
# Créer le dossier
sudo mkdir -p /opt/nouveau-bot
cd /opt/nouveau-bot

# Cloner le repository
git clone https://github.com/juniorrrrr345/botOPP.git .

# Installer les dépendances
npm install
npm install sqlite3
```

### 3. Configurer le fichier .env

```bash
# Créer le fichier .env
nano .env
```

Contenu du fichier :
```env
# Token du NOUVEAU bot (pas le même que l'autre!)
BOT_TOKEN=VOTRE_NOUVEAU_TOKEN_ICI
ADMIN_ID=VOTRE_ID_TELEGRAM

# IMPORTANT: Utiliser SQLite avec un nom de base unique
DB_TYPE=sqlite
DB_NAME=nouveau-bot.db

# Si vous voulez utiliser Cloudflare D1 (optionnel)
# CLOUDFLARE_ACCOUNT_ID=xxx
# CLOUDFLARE_DATABASE_ID=xxx
# CLOUDFLARE_API_TOKEN=xxx
```

### 4. Modifier db-sqlite.js pour utiliser un nom de base unique

```bash
# Éditer le fichier
nano db-sqlite.js
```

Modifier la ligne 7 :
```javascript
// AVANT:
const dbPath = path.join(__dirname, 'bot.db');

// APRÈS:
const dbPath = path.join(__dirname, process.env.DB_NAME || 'bot.db');
```

### 5. Lancer le nouveau bot avec PM2

```bash
# Démarrer le bot avec un nom unique
pm2 start bot-complete.js --name "NOM-UNIQUE-DU-BOT"

# Exemples:
pm2 start bot-complete.js --name "SHOP-BOT"
pm2 start bot-complete.js --name "SUPPORT-BOT"
pm2 start bot-complete.js --name "MUSIC-BOT"

# Sauvegarder la configuration PM2
pm2 save
pm2 startup
```

### 6. Vérifier que tout fonctionne

```bash
# Voir les logs du nouveau bot
pm2 logs NOM-UNIQUE-DU-BOT

# Voir tous les bots qui tournent
pm2 list
```

## 🔧 Script de Duplication Automatique

Créez ce script `duplicate-bot.sh` :

```bash
#!/bin/bash

# Vérifier les arguments
if [ $# -ne 3 ]; then
    echo "Usage: ./duplicate-bot.sh NOM_DOSSIER NOM_PM2 BOT_TOKEN"
    echo "Exemple: ./duplicate-bot.sh shop-bot SHOP-BOT 123456:ABCdef..."
    exit 1
fi

FOLDER_NAME=$1
PM2_NAME=$2
BOT_TOKEN=$3

# Créer le dossier
mkdir -p /opt/$FOLDER_NAME
cd /opt/$FOLDER_NAME

# Cloner le repo
git clone https://github.com/juniorrrrr345/botOPP.git .

# Installer les dépendances
npm install
npm install sqlite3

# Créer le .env
cat > .env << EOF
BOT_TOKEN=$BOT_TOKEN
ADMIN_ID=8346344099
DB_TYPE=sqlite
DB_NAME=${FOLDER_NAME}.db
EOF

# Modifier db-sqlite.js pour utiliser DB_NAME
sed -i "s|path.join(__dirname, 'bot.db')|path.join(__dirname, process.env.DB_NAME \|\| 'bot.db')|g" db-sqlite.js

# Démarrer le bot
pm2 start bot-complete.js --name "$PM2_NAME"
pm2 save

echo "✅ Bot dupliqué avec succès!"
echo "📁 Dossier: /opt/$FOLDER_NAME"
echo "🤖 Nom PM2: $PM2_NAME"
echo "💾 Base de données: ${FOLDER_NAME}.db"
```

Rendre le script exécutable :
```bash
chmod +x duplicate-bot.sh
```

Utilisation :
```bash
./duplicate-bot.sh shop-bot SHOP-BOT 123456789:ABCdefGHIjklMNOpqrsTUVwxyz
```

## 📊 Gestion Multiple de Bots

### Voir tous les bots
```bash
pm2 list
```

### Redémarrer un bot spécifique
```bash
pm2 restart NOM-DU-BOT
```

### Voir les logs d'un bot
```bash
pm2 logs NOM-DU-BOT
```

### Arrêter un bot
```bash
pm2 stop NOM-DU-BOT
```

### Supprimer un bot de PM2
```bash
pm2 delete NOM-DU-BOT
```

## ⚠️ Points Importants

1. **JAMAIS** utiliser le même token pour 2 bots
2. **TOUJOURS** utiliser des noms de base de données différents
3. **TOUJOURS** utiliser des noms PM2 différents
4. Chaque bot aura ses propres :
   - Utilisateurs
   - Configuration
   - Réseaux sociaux
   - Administrateurs
   - Sous-menus

## 🔒 Isolation Complète

Avec cette méthode :
- ✅ Bot 1 ne voit pas les données de Bot 2
- ✅ Modifier Bot 1 n'affecte pas Bot 2
- ✅ Chaque bot a sa propre base SQLite
- ✅ Possibilité de sauvegarder/restaurer indépendamment

## 💡 Conseils

1. **Nommage cohérent** : Utilisez des noms clairs
   ```
   /opt/shop-bot/       → shop-bot.db    → PM2: SHOP-BOT
   /opt/support-bot/    → support-bot.db → PM2: SUPPORT-BOT
   /opt/music-bot/      → music-bot.db   → PM2: MUSIC-BOT
   ```

2. **Sauvegardes** : Sauvegardez régulièrement les fichiers .db
   ```bash
   # Sauvegarder toutes les bases
   tar -czf bots-backup-$(date +%Y%m%d).tar.gz /opt/*/**.db
   ```

3. **Monitoring** : Utilisez PM2 Web pour surveiller tous vos bots
   ```bash
   pm2 web
   ```

## 🆘 Dépannage

### Le bot ne démarre pas
- Vérifiez le token dans .env
- Vérifiez les logs : `pm2 logs NOM-BOT`

### Erreur "database is locked"
- Un seul processus doit accéder à chaque base SQLite
- Vérifiez qu'il n'y a pas 2 bots sur la même base

### Les données se mélangent
- Vérifiez que chaque bot a un DB_NAME différent dans .env
- Vérifiez que db-sqlite.js utilise bien process.env.DB_NAME