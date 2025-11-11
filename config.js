// Configuration pour choisir le type de base de données

// Options disponibles:
// - 'memory' : Base de données en mémoire (par défaut, données perdues au redémarrage)
// - 'sqlite' : Base de données SQLite (persistance sur VPS)
// - 'd1' : Cloudflare D1 (pour déploiement sur Cloudflare Workers)

const DB_TYPE = process.env.DB_TYPE || 'sqlite';

// Configuration Cloudflare D1 (si utilisé)
const D1_CONFIG = {
    database_id: process.env.CLOUDFLARE_DATABASE_ID,
    account_id: process.env.CLOUDFLARE_ACCOUNT_ID,
    api_token: process.env.CLOUDFLARE_API_TOKEN
};

module.exports = {
    DB_TYPE,
    D1_CONFIG
};