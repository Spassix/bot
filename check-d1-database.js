require('dotenv').config();
const fetch = require('node-fetch');

async function checkD1Database() {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const databaseId = process.env.CLOUDFLARE_DATABASE_ID;
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;
    
    if (!accountId || !databaseId || !apiToken) {
        console.error('❌ Variables Cloudflare D1 manquantes dans .env');
        return;
    }
    
    const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}`;
    const headers = {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json'
    };
    
    console.log('🔍 Vérification de la base de données Cloudflare D1...\n');
    
    try {
        // Récupérer toutes les tables
        const response = await fetch(`${baseUrl}/query`, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                sql: "SELECT name, type FROM sqlite_master WHERE type='table' ORDER BY name"
            })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            console.error('❌ Erreur:', data.errors?.[0]?.message || 'Erreur inconnue');
            return;
        }
        
        const tables = data.result[0].results;
        
        if (tables.length === 0) {
            console.log('✅ Base de données vide - Prête pour le bot Telegram!');
            return;
        }
        
        console.log(`📊 Tables trouvées: ${tables.length}\n`);
        
        // Classifier les tables
        const botTables = tables.filter(t => t.name.startsWith('bot_'));
        const shopTables = tables.filter(t => 
            ['products', 'orders', 'customers', 'cart', 'categories', 'payments'].some(shop => 
                t.name.includes(shop)
            )
        );
        const otherTables = tables.filter(t => 
            !t.name.startsWith('bot_') && 
            !shopTables.some(st => st.name === t.name)
        );
        
        // Afficher les résultats
        if (shopTables.length > 0) {
            console.log('🛍️  Tables de boutique détectées:');
            shopTables.forEach(t => console.log(`   - ${t.name}`));
            console.log('\n⚠️  ATTENTION: Cette base de données contient déjà une boutique!');
            console.log('   Les tables du bot seront préfixées avec "bot_" pour éviter les conflits.\n');
        }
        
        if (botTables.length > 0) {
            console.log('🤖 Tables du bot Telegram existantes:');
            botTables.forEach(t => console.log(`   - ${t.name}`));
            console.log('\n✅ Le bot utilisera ces tables existantes.\n');
        }
        
        if (otherTables.length > 0) {
            console.log('📋 Autres tables:');
            otherTables.forEach(t => console.log(`   - ${t.name}`));
            console.log('');
        }
        
        // Recommandations
        console.log('💡 Recommandations:');
        if (shopTables.length > 0) {
            console.log('   1. Les tables du bot sont préfixées avec "bot_" pour éviter les conflits');
            console.log('   2. Votre boutique et le bot peuvent coexister dans la même base');
            console.log('   3. Assurez-vous d\'avoir suffisamment d\'espace (limite gratuite: 5GB)');
        } else if (botTables.length > 0) {
            console.log('   1. Le bot utilisera les tables existantes');
            console.log('   2. Les données précédentes seront conservées');
        } else {
            console.log('   1. La base est prête pour initialiser le bot');
            console.log('   2. Les tables seront créées automatiquement au démarrage');
        }
        
    } catch (error) {
        console.error('❌ Erreur lors de la vérification:', error.message);
    }
}

// Exécuter la vérification
checkD1Database();