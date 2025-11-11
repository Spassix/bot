# Guide de Configuration de la Base de Données

Ce bot peut utiliser différents types de bases de données selon vos besoins.

## Options Disponibles

### 1. Base de données en mémoire (par défaut)
- **Fichier**: `db.js`
- **Avantages**: Simple, rapide, pas de configuration
- **Inconvénients**: Les données sont perdues au redémarrage
- **Usage**: Tests et développement

### 2. SQLite (Recommandé pour VPS)
- **Fichier**: `db-sqlite.js`
- **Avantages**: Persistance des données, pas de serveur externe
- **Inconvénients**: Limité à un seul serveur
- **Usage**: Production sur VPS

### 3. Cloudflare D1 (Pour Cloudflare Workers)
- **Fichier**: À venir quand vous fournirez les détails D1
- **Avantages**: Scalable, géré par Cloudflare
- **Inconvénients**: Nécessite Cloudflare Workers
- **Usage**: Production sur Cloudflare

## Configuration

### Pour utiliser SQLite sur votre VPS:

1. Installez les dépendances:
```bash
npm install sqlite3
```

2. Créez un fichier `.env` avec:
```env
BOT_TOKEN=votre_token_bot
ADMIN_ID=votre_id_telegram
DB_TYPE=sqlite
```

3. Utilisez `bot-flexible.js` au lieu de `bot.js`:
```bash
node bot-flexible.js
```

### Pour utiliser la base en mémoire:

1. Créez un fichier `.env` avec:
```env
BOT_TOKEN=votre_token_bot
ADMIN_ID=votre_id_telegram
DB_TYPE=memory
```

2. Lancez le bot:
```bash
node bot-flexible.js
```

### Pour utiliser Cloudflare D1:

Attendez que je crée le fichier approprié une fois que vous m'aurez fourni les détails de votre D1.

## Structure des Données

Les données sont organisées dans les tables suivantes:

- **config**: Configuration du bot
- **users**: Utilisateurs enregistrés
- **social_networks**: Réseaux sociaux
- **service_submenus**: Sous-menus des services
- **stats**: Statistiques d'utilisation
- **user_states**: États des conversations

## Migration des Données

Si vous passez d'un type de base à un autre, vous devrez migrer vos données manuellement ou utiliser un script de migration.

## Sauvegarde

Pour SQLite, sauvegardez simplement le fichier `bot.db` régulièrement.