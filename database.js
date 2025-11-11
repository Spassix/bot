// Configuration automatique de la base de données
const { SQLiteDatabase } = require('./db-sqlite');
const { CloudflareD1Database } = require('./db-cloudflare-d1');

// Déterminer quelle base de données utiliser
function getDatabase() {
    // Si on est sur Cloudflare Workers (production)
    if (typeof global !== 'undefined' && global.CloudflareD1Database) {
        return new CloudflareD1Database();
    }
    
    // Forcer SQLite pour le VPS (même si D1 est configuré)
    if (process.env.BOT_MODE === 'polling' || process.env.NODE_ENV !== 'production') {
        console.log('📊 Utilisation de SQLite pour la base de données');
        return new SQLiteDatabase();
    }
    
    // Si on a des variables Cloudflare D1 configurées ET on est en production
    if (process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_DATABASE_ID) {
        console.log('📊 Utilisation de Cloudflare D1 pour la base de données');
        return new CloudflareD1Database();
    }
    
    // Par défaut, utiliser SQLite (pour VPS et développement local)
    console.log('📊 Utilisation de SQLite pour la base de données');
    return new SQLiteDatabase();
}

module.exports = { getDatabase };