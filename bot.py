import logging
import os
import json
from dotenv import load_dotenv
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, BotCommand, WebAppInfo
from telegram.ext import Application, CommandHandler, CallbackQueryHandler, ContextTypes
from telegram.constants import ParseMode

# Charger les variables d'environnement
load_dotenv()

# Configuration du logging
logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)
logger = logging.getLogger(__name__)

# Token du bot
BOT_TOKEN = os.getenv("BOT_TOKEN")

# ID de l'admin
ADMIN_ID = int(os.getenv("ADMIN_ID", 0))

# Chemins des liens
MINI_APP_URL = os.getenv("MINI_APP_URL")
INSTAGRAM_URL = os.getenv("INSTAGRAM_URL")
CANAL_SECOURS_URL = os.getenv("CANAL_SECOURS_URL")
ZANGI_URL = os.getenv("ZANGI_URL")

# Chemin de l'image (à ajouter dans le dossier)
IMAGE_PATH = os.getenv("IMAGE_PATH", "pharmhashi_logo.png")

# Fichier pour stocker les utilisateurs
USERS_FILE = os.getenv("USERS_FILE", "users.json")

# Vérifier que les variables essentielles sont définies
if not BOT_TOKEN:
    raise ValueError("BOT_TOKEN n'est pas défini dans le fichier .env")
if not ADMIN_ID:
    raise ValueError("ADMIN_ID n'est pas défini dans le fichier .env")


def load_users():
    """Charge la liste des utilisateurs depuis le fichier"""
    if os.path.exists(USERS_FILE):
        try:
            with open(USERS_FILE, 'r', encoding='utf-8') as f:
                return set(json.load(f))
        except:
            return set()
    return set()


def save_user(user_id):
    """Sauvegarde un utilisateur dans le fichier"""
    users = load_users()
    users.add(user_id)
    with open(USERS_FILE, 'w', encoding='utf-8') as f:
        json.dump(list(users), f)


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Gère la commande /start"""
    user = update.effective_user
    
    # Sauvegarder l'utilisateur
    save_user(user.id)
    
    # Création du clavier avec les boutons
    keyboard = [
        [InlineKeyboardButton("🛒 Mini App", web_app=WebAppInfo(url=MINI_APP_URL))],
        [InlineKeyboardButton("📷 Contact Instagram", url=INSTAGRAM_URL)],
        [InlineKeyboardButton("🆘 Canal Secours", url=CANAL_SECOURS_URL)],
        [InlineKeyboardButton("💬 Contact Zangi", url=ZANGI_URL)]
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    
    # Message de bienvenue
    welcome_message = """**BIENVENUE CHEZ PHARMH**HI**

Salut ! 👋

Bienvenue sur notre bot officiel. Ici tu trouveras toutes les informations nécessaires pour passer commande et découvrir nos produits.

**Comment utiliser le bot :**
• Utilise /start pour actualiser le menu
• Navigue avec les boutons interactifs ci-dessous
• Active tes notifications pour ne rien manquer

**Contacts importants :**
📞 **Pour les commandes :** @LAPHARMHASHI2
🆘 **Support de secours :** @SAV2LUXE

Choisis une option dans le menu ci-dessous :"""
    
    # Envoi de l'image si elle existe, sinon juste le message
    try:
        if os.path.exists(IMAGE_PATH):
            with open(IMAGE_PATH, 'rb') as photo:
                await update.message.reply_photo(
                    photo=photo,
                    caption=welcome_message,
                    reply_markup=reply_markup,
                    parse_mode=ParseMode.MARKDOWN
                )
        else:
            await update.message.reply_text(
                welcome_message,
                reply_markup=reply_markup,
                parse_mode=ParseMode.MARKDOWN
            )
    except Exception as e:
        logger.error(f"Erreur lors de l'envoi de l'image: {e}")
        await update.message.reply_text(
            welcome_message,
            reply_markup=reply_markup,
            parse_mode=ParseMode.MARKDOWN
        )


async def broadcast(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Gère la commande /broadcast pour les admins"""
    user = update.effective_user
    
    # Vérifier si l'utilisateur est admin
    if user.id != ADMIN_ID:
        await update.message.reply_text("❌ Vous n'avez pas la permission d'utiliser cette commande.")
        return
    
    # Vérifier si un message a été fourni
    if not context.args:
        await update.message.reply_text(
            "📢 **Utilisation de /broadcast:**\n\n"
            "Envoyez votre message après la commande:\n"
            "`/broadcast Votre message ici`",
            parse_mode=ParseMode.MARKDOWN
        )
        return
    
    # Récupérer le message à diffuser
    message_text = " ".join(context.args)
    
    # Charger tous les utilisateurs
    users = load_users()
    
    if not users:
        await update.message.reply_text(
            "⚠️ Aucun utilisateur trouvé dans la base de données.",
            parse_mode=ParseMode.MARKDOWN
        )
        return
    
    # Envoyer le message de confirmation
    await update.message.reply_text(
        f"📢 **Diffusion en cours...**\n\n"
        f"Message: {message_text}\n"
        f"Destinataires: {len(users)} utilisateur(s)",
        parse_mode=ParseMode.MARKDOWN
    )
    
    # Diffuser le message à tous les utilisateurs
    success_count = 0
    fail_count = 0
    
    for user_id in users:
        try:
            await context.bot.send_message(
                chat_id=user_id,
                text=message_text,
                parse_mode=ParseMode.MARKDOWN
            )
            success_count += 1
        except Exception as e:
            logger.error(f"Erreur lors de l'envoi à {user_id}: {e}")
            fail_count += 1
    
    # Envoyer le rapport final
    await update.message.reply_text(
        f"✅ **Diffusion terminée!**\n\n"
        f"✅ Envoyé avec succès: {success_count}\n"
        f"❌ Échecs: {fail_count}\n"
        f"📊 Total: {len(users)}",
        parse_mode=ParseMode.MARKDOWN
    )
    
    logger.info(f"Admin {user.id} a diffusé un message à {success_count} utilisateurs")


async def button_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Gère les clics sur les boutons inline"""
    query = update.callback_query
    await query.answer()


def main() -> None:
    """Fonction principale pour démarrer le bot"""
    # Créer l'application
    application = Application.builder().token(BOT_TOKEN).build()
    
    # Ajouter les handlers
    application.add_handler(CommandHandler("start", start))
    application.add_handler(CommandHandler("broadcast", broadcast))
    application.add_handler(CallbackQueryHandler(button_callback))
    
    # Définir les commandes du bot
    commands = [
        BotCommand("start", "Démarrer le bot et voir le menu"),
        BotCommand("broadcast", "Diffuser un message (Admin uniquement)")
    ]
    
    async def post_init(application: Application) -> None:
        await application.bot.set_my_commands(commands)
    
    application.post_init = post_init
    
    # Démarrer le bot
    logger.info("Bot démarré...")
    application.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == '__main__':
    main()

