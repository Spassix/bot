const fetch = require('node-fetch');

// Classe pour gérer la base de données Cloudflare D1
class CloudflareD1Database {
    constructor(accountId, databaseId, apiToken) {
        this.accountId = accountId;
        this.databaseId = databaseId;
        this.apiToken = apiToken;
        this.baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}`;
        
        console.log('🌐 Connexion à Cloudflare D1...');
        this.initDatabase();
    }

    // Headers pour l'API Cloudflare
    get headers() {
        return {
            'Authorization': `Bearer ${this.apiToken}`,
            'Content-Type': 'application/json'
        };
    }

    // Exécuter une requête SQL via l'API REST
    async query(sql, params = []) {
        try {
            const response = await fetch(`${this.baseUrl}/query`, {
                method: 'POST',
                headers: this.headers,
                body: JSON.stringify({
                    sql: sql,
                    params: params
                })
            });

            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(`Erreur D1: ${data.errors?.[0]?.message || 'Erreur inconnue'}`);
            }

            return data.result[0];
        } catch (error) {
            console.error('Erreur requête D1:', error);
            throw error;
        }
    }

    // Initialiser les tables du bot (préfixées avec bot_)
    async initDatabase() {
        console.log('📊 Vérification et création des tables du bot...');
        
        // D'abord, vérifions s'il y a des tables existantes
        try {
            const existingTables = await this.query(`
                SELECT name FROM sqlite_master 
                WHERE type='table' AND name NOT LIKE 'bot_%'
            `);
            
            if (existingTables.results && existingTables.results.length > 0) {
                console.log('⚠️  Tables non-bot détectées:', existingTables.results.map(t => t.name));
                console.log('✅ Les tables du bot seront préfixées avec "bot_" pour éviter les conflits');
            }
        } catch (error) {
            console.log('📋 Première utilisation de la base de données');
        }

        const tables = [
            // Table de configuration du bot
            `CREATE TABLE IF NOT EXISTS bot_config (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                welcome_message TEXT DEFAULT '🤖 Bienvenue {firstname} sur notre bot!',
                welcome_image TEXT,
                info_text TEXT DEFAULT 'ℹ️ Informations sur notre service',
                mini_app_url TEXT,
                mini_app_text TEXT DEFAULT '🎮 Ouvrir l''application',
                livraison_text TEXT DEFAULT '🚚 SERVICE LIVRAISON\n\nContactez-nous pour vos livraisons',
                livraison_image TEXT,
                postal_text TEXT DEFAULT '📮 SERVICE POSTAL\n\nEnvoi de colis et courriers',
                postal_image TEXT,
                meetup_text TEXT DEFAULT '📍 SERVICE MEET UP\n\nOrganisation de rencontres',
                meetup_image TEXT,
                catalogue_url TEXT,
                social_buttons_per_row INTEGER DEFAULT 2,
                buttons_per_row INTEGER DEFAULT 2,
                enabled_services TEXT DEFAULT '[]',
                custom_buttons_json TEXT DEFAULT '[]',
                buttons_layout TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,

            // Table des utilisateurs du bot
            `CREATE TABLE IF NOT EXISTS bot_users (
                user_id INTEGER PRIMARY KEY,
                username TEXT,
                first_name TEXT,
                last_name TEXT,
                is_admin INTEGER DEFAULT 0,
                is_blocked INTEGER DEFAULT 0,
                language_code TEXT DEFAULT 'fr',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,

            // Table des réseaux sociaux
            `CREATE TABLE IF NOT EXISTS bot_social_networks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                emoji TEXT NOT NULL,
                url TEXT NOT NULL,
                position INTEGER DEFAULT 0,
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,

            // Table des sous-menus des services
            `CREATE TABLE IF NOT EXISTS bot_service_submenus (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                service_type TEXT NOT NULL,
                name TEXT NOT NULL,
                text TEXT,
                image TEXT,
                position INTEGER DEFAULT 0,
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,

            // Table des statistiques
            `CREATE TABLE IF NOT EXISTS bot_stats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_type TEXT NOT NULL,
                user_id INTEGER,
                data TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,

            // Table des états utilisateur (conversations)
            `CREATE TABLE IF NOT EXISTS bot_user_states (
                user_id INTEGER PRIMARY KEY,
                state TEXT,
                data TEXT,
                message_id INTEGER,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,

            // Index pour améliorer les performances
            `CREATE INDEX IF NOT EXISTS idx_bot_users_username ON bot_users(username)`,
            `CREATE INDEX IF NOT EXISTS idx_bot_stats_event ON bot_stats(event_type, created_at)`,
            `CREATE INDEX IF NOT EXISTS idx_bot_stats_user ON bot_stats(user_id)`
        ];

        // Créer toutes les tables
        for (const query of tables) {
            try {
                await this.query(query);
            } catch (error) {
                console.error('Erreur création table:', error);
            }
        }

        // Insérer la configuration par défaut si elle n'existe pas
        try {
            await this.query('INSERT OR IGNORE INTO bot_config (id) VALUES (1)');
        } catch (error) {
            // Ignorer si existe déjà
        }

        // Migration: ajouter colonnes manquantes si nécessaire
        try {
            const pragma = await this.query('PRAGMA table_info(bot_config)');
            const colNames = (pragma.results || []).map(c => c.name);
            const addIfMissing = async (name, type, defaultExpr = null) => {
                if (!colNames.includes(name)) {
                    await this.query(`ALTER TABLE bot_config ADD COLUMN ${name} ${type}${defaultExpr ? ' DEFAULT ' + defaultExpr : ''}`);
                }
            };
            await addIfMissing('enabled_services', 'TEXT', `'[]'`);
            await addIfMissing('custom_buttons_json', 'TEXT', `'[]'`);
            await addIfMissing('buttons_layout', 'TEXT');
        } catch (error) {
            console.warn('⚠️ Migration des colonnes bot_config ignorée:', error?.message || error);
        }

        // Vérifier si les réseaux sociaux par défaut existent
        const socialCount = await this.query('SELECT COUNT(*) as count FROM bot_social_networks');
        if (!socialCount.results[0]?.count || socialCount.results[0].count === 0) {
            const defaultSocials = [
                ['Instagram', '📷', 'https://instagram.com', 1],
                ['Telegram', '📢', 'https://t.me/channel', 2],
                ['WhatsApp', '💬', 'https://wa.me/1234567890', 3]
            ];

            for (const social of defaultSocials) {
                await this.query(
                    'INSERT INTO bot_social_networks (name, emoji, url, position) VALUES (?, ?, ?, ?)',
                    social
                );
            }
        }

        console.log('✅ Base de données Cloudflare D1 initialisée avec succès!');
    }

    // Configuration
    async getConfig() {
        const result = await this.query('SELECT * FROM bot_config WHERE id = 1');
        return result.results[0];
    }

    async updateConfig(updates) {
        const fields = Object.keys(updates);
        const values = Object.values(updates);
        const setClause = fields.map(f => `${f} = ?`).join(', ');
        
        await this.query(
            `UPDATE bot_config SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = 1`,
            values
        );
        return true;
    }

    // Utilisateurs
    async getUser(userId) {
        const result = await this.query('SELECT * FROM bot_users WHERE user_id = ?', [userId]);
        return result.results[0];
    }

    async upsertUser(userId, username, firstName, lastName) {
        const isAdmin = userId.toString() === process.env.ADMIN_ID ? 1 : 0;
        
        await this.query(`
            INSERT INTO bot_users (user_id, username, first_name, last_name, is_admin, last_seen) 
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP) 
            ON CONFLICT(user_id) DO UPDATE SET 
            username = excluded.username,
            first_name = excluded.first_name,
            last_name = excluded.last_name,
            last_seen = CURRENT_TIMESTAMP
        `, [userId, username, firstName, lastName, isAdmin]);
        
        return await this.getUser(userId);
    }

    async getAllUsers() {
        const result = await this.query('SELECT * FROM bot_users ORDER BY created_at DESC');
        return result.results;
    }

    async getAdmins() {
        const result = await this.query('SELECT * FROM bot_users WHERE is_admin = 1');
        return result.results;
    }

    async setAdmin(userId, isAdmin) {
        await this.query(
            'UPDATE bot_users SET is_admin = ? WHERE user_id = ?',
            [isAdmin ? 1 : 0, userId]
        );
        return true;
    }

    // Réseaux sociaux
    async getSocialNetworks() {
        const result = await this.query(
            'SELECT * FROM bot_social_networks WHERE is_active = 1 ORDER BY position'
        );
        return result.results;
    }

    async getSocialNetwork(id) {
        const result = await this.query('SELECT * FROM bot_social_networks WHERE id = ?', [id]);
        return result.results[0];
    }

    async addSocialNetwork(name, emoji, url) {
        const maxPos = await this.query(
            'SELECT MAX(position) as max_pos FROM bot_social_networks'
        );
        const position = (maxPos.results[0]?.max_pos || 0) + 1;
        
        await this.query(
            'INSERT INTO bot_social_networks (name, emoji, url, position) VALUES (?, ?, ?, ?)',
            [name, emoji, url, position]
        );
        
        const lastId = await this.query('SELECT last_insert_rowid() as id');
        return await this.getSocialNetwork(lastId.results[0].id);
    }

    async updateSocialNetwork(id, updates) {
        const fields = Object.keys(updates);
        const values = [...Object.values(updates), id];
        const setClause = fields.map(f => `${f} = ?`).join(', ');
        
        await this.query(
            `UPDATE bot_social_networks SET ${setClause} WHERE id = ?`,
            values
        );
        return true;
    }

    async deleteSocialNetwork(id) {
        await this.query('DELETE FROM bot_social_networks WHERE id = ?', [id]);
        return true;
    }

    // Sous-menus des services
    async getServiceSubmenus(serviceType) {
        const result = await this.query(
            'SELECT * FROM bot_service_submenus WHERE service_type = ? AND is_active = 1 ORDER BY position',
            [serviceType]
        );
        return result.results;
    }

    async getSubmenu(id) {
        const result = await this.query('SELECT * FROM bot_service_submenus WHERE id = ?', [id]);
        return result.results[0];
    }

    async addSubmenu(serviceType, name, text, image) {
        const maxPos = await this.query(
            'SELECT MAX(position) as max_pos FROM bot_service_submenus WHERE service_type = ?',
            [serviceType]
        );
        const position = (maxPos.results[0]?.max_pos || 0) + 1;
        
        await this.query(
            'INSERT INTO bot_service_submenus (service_type, name, text, image, position) VALUES (?, ?, ?, ?, ?)',
            [serviceType, name, text, image, position]
        );
        
        const lastId = await this.query('SELECT last_insert_rowid() as id');
        return await this.getSubmenu(lastId.results[0].id);
    }

    async updateSubmenu(id, updates) {
        const fields = Object.keys(updates);
        const values = [...Object.values(updates), id];
        const setClause = fields.map(f => `${f} = ?`).join(', ');
        
        await this.query(
            `UPDATE bot_service_submenus SET ${setClause} WHERE id = ?`,
            values
        );
        return true;
    }

    async deleteSubmenu(id) {
        await this.query('DELETE FROM bot_service_submenus WHERE id = ?', [id]);
        return true;
    }

    // Statistiques
    async logEvent(eventType, userId, data = null) {
        await this.query(
            'INSERT INTO bot_stats (event_type, user_id, data) VALUES (?, ?, ?)',
            [eventType, userId, data ? JSON.stringify(data) : null]
        );
    }

    async getStats() {
        const queries = [
            this.query('SELECT COUNT(*) as count FROM bot_users'),
            this.query('SELECT COUNT(*) as count FROM bot_stats WHERE event_type = ?', ['start']),
            this.query('SELECT COUNT(*) as count FROM bot_users WHERE is_admin = 1')
        ];
        
        const [users, starts, admins] = await Promise.all(queries);
        
        return {
            totalUsers: users.results[0].count,
            totalStarts: starts.results[0].count,
            totalAdmins: admins.results[0].count
        };
    }

    async getDetailedStats() {
        const basic = await this.getStats();
        
        const queries = [
            this.query(
                "SELECT COUNT(*) as count FROM bot_stats WHERE event_type = 'start' AND date(created_at) = date('now')"
            ),
            this.query(
                "SELECT COUNT(*) as count FROM bot_stats WHERE event_type = 'start' AND date(created_at) >= date('now', '-7 days')"
            )
        ];
        
        const [today, week] = await Promise.all(queries);
        
        return {
            ...basic,
            todayUsers: today.results[0].count,
            weekUsers: week.results[0].count
        };
    }

    // États utilisateur
    async getUserState(userId) {
        const result = await this.query('SELECT * FROM bot_user_states WHERE user_id = ?', [userId]);
        return result.results[0];
    }

    async setUserState(userId, state, data = null, messageId = null) {
        await this.query(`
            INSERT INTO bot_user_states (user_id, state, data, message_id, updated_at) 
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP) 
            ON CONFLICT(user_id) DO UPDATE SET 
            state = excluded.state,
            data = excluded.data,
            message_id = excluded.message_id,
            updated_at = CURRENT_TIMESTAMP
        `, [userId, state, data ? JSON.stringify(data) : null, messageId]);
    }

    async deleteUserState(userId) {
        await this.query('DELETE FROM bot_user_states WHERE user_id = ?', [userId]);
        return true;
    }
}

module.exports = { CloudflareD1Database };