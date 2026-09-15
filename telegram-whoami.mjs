#!/usr/bin/env node
/**
 * Помощник за свързване на бота. Пусни го веднъж, за да видиш chat id-тата.
 *
 *   TELEGRAM_TOKEN=123:ABC node scripts/telegram-whoami.mjs
 *
 * Преди това всеки автор трябва да е писал ПОНЕ ЕДНО съобщение на бота
 * (например /start). Telegram не позволява на ботове да пишат първи.
 */
const TOKEN = process.env.TELEGRAM_TOKEN;
if (!TOKEN) {
  console.error("Липсва TELEGRAM_TOKEN.\n");
  console.error("Вземи го от @BotFather → /mybots → твоят бот → API Token.");
  console.error("После: TELEGRAM_TOKEN=токенът node scripts/telegram-whoami.mjs");
  process.exit(1);
}

const r = await fetch(`https://api.telegram.org/bot${TOKEN}/getUpdates`);
const j = await r.json();

if (!j.ok) {
  console.error("Telegram отказа:", j.description);
  if (String(j.description).includes("Unauthorized"))
    console.error("→ Токенът е грешен. Провери го в @BotFather.");
  process.exit(1);
}

const seen = new Map();
for (const u of j.result || []) {
  const c = u.message?.chat || u.channel_post?.chat || u.my_chat_member?.chat;
  if (!c) continue;
  const name = [c.first_name, c.last_name].filter(Boolean).join(" ") ||
               c.title || c.username || "(без име)";
  seen.set(c.id, { name, username: c.username ? "@" + c.username : "", type: c.type });
}

if (!seen.size) {
  console.log("Няма съобщения до бота.\n");
  console.log("Всеки автор да отвори бота в Telegram и да натисне Start");
  console.log("(или просто да му напише „здрасти“), после пусни скрипта пак.");
  console.log("\nБележка: Telegram пази съобщенията само ~24 часа.");
  process.exit(0);
}

console.log("Ето кой е писал на бота:\n");
for (const [id, v] of seen)
  console.log(`  ${String(id).padEnd(14)} ${v.name} ${v.username} [${v.type}]`);

console.log("\nСложи тези id-та в config/people.json — името трябва да съвпада");
console.log("с името на автора в дъската:\n");
console.log(JSON.stringify(
  { people: [...seen].map(([id, v]) => ({ name: v.name, chatId: id, enabled: true })) },
  null, 1));
