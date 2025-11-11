# Guide de déploiement

## 🚀 Déploiement sur Cloudflare Workers avec D1

### 1. Prérequis
- Compte Cloudflare actif
- Wrangler CLI installé : `npm install -g wrangler`
- Bot Telegram créé via @BotFather

### 2. Configuration Cloudflare

#### Connexion à Cloudflare
```bash
wrangler login
```

#### Créer la base de données D1
```bash
# Créer la base de données
wrangler d1 create telegram-bot-db

# Noter l'ID de la base de données retourné
```

#### Mettre à jour wrangler.toml
Remplacez `YOUR_DATABASE_ID` par l'ID obtenu :
```toml
[[d1_databases]]
binding = "DB"
database_name = "telegram-bot-db"
database_id = "votre-id-ici"
```

#### Exécuter les migrations
```bash
wrangler d1 execute telegram-bot-db --file=./schema.sql
```

### 3. Configuration des secrets

```bash
# Token du bot Telegram
wrangler secret put BOT_TOKEN
# Entrez votre token quand demandé

# ID admin
wrangler secret put ADMIN_ID
# Entrez votre ID Telegram
```

### 4. Déploiement

```bash
# Déployer sur Cloudflare Workers
wrangler publish

# Ou avec le nouveau CLI
wrangler deploy
```

### 5. Configuration du webhook Telegram

Après le déploiement, visitez :
```
https://votre-worker.votre-compte.workers.dev/setWebhook
```

## 🖥️ Déploiement sur VPS (Alternative)

### 1. Prérequis
- VPS avec Node.js 18+
- PM2 installé globalement
- MongoDB ou adapter pour SQLite

### 2. Installation

```bash
# Cloner le repository
git clone https://github.com/juniorrrrr345/botOPP.git
cd botOPP

# Installer les dépendances
npm install

# Configurer l'environnement
cp .env.example .env
nano .env  # Éditer avec vos valeurs
```

### 3. Adapter pour VPS

Pour utiliser sur VPS sans Cloudflare :
1. Utiliser SQLite au lieu de D1
2. Installer `better-sqlite3` : `npm install better-sqlite3`
3. Adapter `db.js` pour utiliser SQLite
4. Utiliser le mode polling au lieu des webhooks

### 4. Lancement avec PM2

```bash
# Démarrer le bot
pm2 start bot.js --name "telegram-bot"

# Sauvegarder la configuration PM2
pm2 save

# Configurer le démarrage automatique
pm2 startup
```

### 5. Mise à jour

```bash
# Arrêter le bot
pm2 stop telegram-bot

# Mettre à jour le code
git pull

# Installer les nouvelles dépendances
npm install

# Redémarrer
pm2 restart telegram-bot
```

## 🔧 Maintenance

### Logs
```bash
# Cloudflare Workers
wrangler tail

# VPS avec PM2
pm2 logs telegram-bot
```

### Base de données
```bash
# Cloudflare D1 - Exécuter des requêtes
wrangler d1 execute telegram-bot-db --command "SELECT * FROM users"

# Backup D1
wrangler d1 backup telegram-bot-db
```

### Monitoring
- Cloudflare : Dashboard Workers Analytics
- VPS : `pm2 monit`

## 🐛 Dépannage

### Le bot ne répond pas
1. Vérifier les logs
2. Vérifier le token et l'ID admin
3. Vérifier le webhook (Cloudflare) ou polling (VPS)
4. Vérifier les permissions de la base de données

### Erreurs de base de données
1. Vérifier que les migrations ont été exécutées
2. Vérifier la connexion à D1 ou MongoDB
3. Réinitialiser avec le schema.sql si nécessaire

### Performance
- Cloudflare Workers : Limité à 50ms CPU
- Optimiser les requêtes DB
- Utiliser le cache si possible

## 📝 Notes importantes

1. **Sécurité** : Ne jamais exposer les tokens dans le code
2. **Limites** : Cloudflare Workers a des limites (CPU, requêtes/jour)
3. **Coûts** : D1 est gratuit jusqu'à certaines limites
4. **Backup** : Faire des sauvegardes régulières de D1