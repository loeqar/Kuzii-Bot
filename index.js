const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');
require('dotenv').config();

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildModeration]
});

const SETTINGS_FILE = './guild_settings.json';
let guildSettings = {};

if (fs.existsSync(SETTINGS_FILE)) {
    try {
        guildSettings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    } catch (e) {
        guildSettings = {};
    }
}

function saveSettings() {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(guildSettings, null, 4));
}

const warningsDB = new Map();
const MAX_WARNINGS = 10; 

function convertMs(duration) {
    if (!duration) return null;
    duration = duration.toLowerCase();
    if (duration.endsWith('sn')) return parseInt(duration) * 1000;
    if (duration.endsWith('dk')) return parseInt(duration) * 60 * 1000;
    if (duration.endsWith('s')) return parseInt(duration) * 60 * 60 * 1000;
    if (duration.endsWith('g')) return parseInt(duration) * 24 * 60 * 60 * 1000;
    return null;
}

client.once('ready', async () => {
    console.log(`Bot Aktif: ${client.user.tag}`);

    const commands = [
        new SlashCommandBuilder()
            .setName('kanal-ayarla')
            .setDescription('Sunucu için moderasyon log kanallarını belirler.')
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
            .addStringOption(option =>
                option.setName('tur').setDescription('Ayarlanacak kanal türü').setRequired(true)
                    .addChoices(
                        { name: 'Genel Yönetim Log (Ban/Kick)', value: 'LOG_CHANNEL_ID' },
                        { name: 'Ban Affı Duyuru Kanalı', value: 'BAN_AFFI_CHANNEL_ID' },
                        { name: 'Timeout Log Kanalı', value: 'TIMEOUT_LOG_CHANNEL_ID' },
                        { name: 'Uyarı (Warn) Log Kanalı', value: 'WARN_LOG_CHANNEL_ID' }
                    ))
            .addChannelOption(option =>
                option.setName('kanal').setDescription('Seçilecek log kanalı').setRequired(true)),

        new SlashCommandBuilder()
            .setName('ceza-ver')
            .setDescription('Sunucu üyelerine profesyonel ceza uygular.')
            .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
            .addUserOption(option => 
                option.setName('kullanici').setDescription('Ceza verilecek kullanıcı').setRequired(true))
            .addStringOption(option => 
                option.setName('tur').setDescription('Ceza türünü seçin').setRequired(true)
                    .addChoices(
                        { name: 'Ban (Kalıcı Yasaklama)', value: 'BAN' },
                        { name: 'Timeout (Susturma/Zaman Aşımı)', value: 'TIMEOUT' },
                        { name: 'Kick (Sunucudan Atma)', value: 'KICK' }
                    ))
            .addStringOption(option => 
                option.setName('sebep').setDescription('Ceza sebebi').setRequired(true))
            .addStringOption(option => 
                option.setName('sure').setDescription('Süre (Örn: 1sa, 30dk, 1g) (Timeout için zorunlu)').setRequired(false)),

        new SlashCommandBuilder()
            .setName('uyar')
            .setDescription('Sunucu üyesine resmi uyarı verir.')
            .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
            .addUserOption(option => 
                option.setName('kullanici').setDescription('Uyarılacak kullanıcı').setRequired(true))
            .addStringOption(option => 
                option.setName('sebep').setDescription('Uyarı sebebi').setRequired(true)),

        new SlashCommandBuilder()
            .setName('uyarilari-goster')
            .setDescription('Bir kullanıcının aktif uyarılarını ve sayısını gösterir.')
            .addUserOption(option => 
                option.setName('kullanici').setDescription('Uyarılarına bakılacak kullanıcı').setRequired(true)),

        new SlashCommandBuilder()
            .setName('unban')
            .setDescription('Sunucudaki bir kullanıcının banını kaldırır ve uyarılarını sıfırlar.')
            .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
            .addStringOption(option => 
                option.setName('kullanici_id').setDescription('Banı kaldırılacak kullanıcının IDsi').setRequired(true))
            .addStringOption(option => 
                option.setName('sebep').setDescription('Banın kaldırılma sebebi').setRequired(true))
    ].map(command => command.toJSON());

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

    try {
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands },
        );
        console.log('Slash komutları başarıyla güncellendi!');
    } catch (error) {
        console.error(error);
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const guildId = interaction.guild.id;
    const guildName = interaction.guild.name;

    if (!guildSettings[guildId]) {
        guildSettings[guildId] = {};
    }

    if (interaction.commandName === 'kanal-ayarla') {
        const type = interaction.options.getString('tur');
        const channel = interaction.options.getChannel('kanal');

        guildSettings[guildId][type] = channel.id;
        saveSettings();

        return interaction.reply({ content: `✅ Başarılı! Seçilen kanal başarıyla ayarlandı: ${channel}`, ephemeral: true });
    }

    if (interaction.commandName === 'ceza-ver') {
        const target = interaction.options.getUser('kullanici');
        const type = interaction.options.getString('tur');
        const reason = interaction.options.getString('sebep');
        const timeStr = interaction.options.getString('sure');
        
        let durationText = 'Belirtilmedi';
        let timeoutMs = 0;
        if (timeStr) {
            durationText = timeStr;
            timeoutMs = convertMs(timeStr);
        }

        const cezaId = Math.floor(100 + Math.random() * 900);
        const settings = guildSettings[guildId] || {};

        let dmTitle = `⚠️ **${guildName}** Sunucusunda İşlem Yapıldı`;
        let dmDescription = `**${target}**, sunucumuzda hakkınızda bir moderasyon işlemi gerçekleştirilmiştir. Detaylar aşağıdadır:`;
        let color = 0xFF0000;

        if (type === 'BAN') {
            dmTitle = `🚨 **${guildName}** Sunucusundan Kalıcı Olarak Yasaklandınız`;
            dmDescription = `**${target}**, kurallara aykırı davranışlarınız nedeniyle **${guildName}** sunucusundan kalıcı olarak uzaklaştırıldınız.`;
        } else if (type === 'KICK') {
            dmTitle = `⚡ **${guildName}** Sunucusundan Uzaklaştırıldınız`;
            dmDescription = `**${target}**, **${guildName}** sunucusundan geçici olarak ilişiğiniz kesilmiştir.`;
        }

        const dmFields = [
            { name: '🛡️ İşlem Türü', value: `\`${type}\``, inline: true },
            { name: '🆔 İşlem ID', value: `\`#${cezaId}\``, inline: true },
            { name: '⏳ Süre', value: durationText, inline: true },
            { name: '⚠️ Sebep', value: reason, inline: false }
        ];

        const dmEmbed = new EmbedBuilder()
            .setColor(color)
            .setTitle(dmTitle)
            .setDescription(dmDescription)
            .addFields(dmFields)
            .setFooter({ text: `${guildName} | Güvenlik ve Moderasyon Departmanı` })
            .setTimestamp();

        const logFields = [
            { name: '🛡️ İşlem Türü', value: `\`${type}\``, inline: true },
            { name: '🆔 Ceza ID', value: `\`#${cezaId}\``, inline: true },
            { name: '👤 İşlem Alan', value: `${target} (${target.id})`, inline: false },
            { name: '👮 Yetkili', value: `${interaction.user}`, inline: true },
            { name: '⏳ Süre', value: durationText, inline: true },
            { name: '⚠️ Sebep', value: reason, inline: false }
        ];

        const logEmbed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle(`🚨 ${guildName} | Ceza Sistemi`)
            .setDescription(`🛑 **${target}** adlı kullanıcıya yeni bir yaptırım uygulandı.`)
            .addFields(logFields)
            .setFooter({ text: `${guildName} | Güvenlik ve Moderasyon Departmanı` })
            .setTimestamp();

        const timeoutFields = [
            { name: '🛡️ İşlem Türü', value: '`TIMEOUT (SUSTURMA)`', inline: true },
            { name: '🆔 Ceza ID', value: `\`#${cezaId}\``, inline: true },
            { name: '👤 Susturulan Üye', value: `${target} (${target.id})`, inline: false },
            { name: '👮 Yetkili', value: `${interaction.user}`, inline: true },
            { name: '⏳ Süre', value: durationText, inline: true },
            { name: '⚠️ Sebep', value: reason, inline: false }
        ];

        const timeoutLogEmbed = new EmbedBuilder()
            .setColor(0xFFA500)
            .setTitle(`🔇 ${guildName} | Susturma (Timeout) Bildirimi`)
            .setDescription(`👤 **${target}** adlı kullanıcı sunucumuzda susturulmuştur.`)
            .addFields(timeoutFields)
            .setFooter({ text: `${guildName} | Güvenlik ve Moderasyon Departmanı` })
            .setTimestamp();

        try {
            const member = await interaction.guild.members.fetch(target.id).catch(() => null);
            if (member) {
                const fullReason = `${interaction.user.tag}:${reason}`;
                if (type === 'BAN') {
                    try { await target.send({ embeds: [dmEmbed] }); } catch (err) {}
                    await member.ban({ reason: fullReason });
                    if (settings.LOG_CHANNEL_ID) {
                        const logChannel = interaction.guild.channels.cache.get(settings.LOG_CHANNEL_ID);
                        if (logChannel) { await logChannel.send({ embeds: [logEmbed] }); }
                    }
                }
                else if (type === 'KICK') {
                    try { await target.send({ embeds: [dmEmbed] }); } catch (err) {}
                    await member.kick(fullReason);
                    if (settings.LOG_CHANNEL_ID) {
                        const logChannel = interaction.guild.channels.cache.get(settings.LOG_CHANNEL_ID);
                        if (logChannel) { await logChannel.send({ embeds: [logEmbed] }); }
                    }
                }
                else if (type === 'TIMEOUT') {
                    if (timeoutMs && timeoutMs > 0) {
                        await member.timeout(timeoutMs, fullReason);
                        
                        if (settings.TIMEOUT_LOG_CHANNEL_ID) {
                            const timeoutLogChannel = interaction.guild.channels.cache.get(settings.TIMEOUT_LOG_CHANNEL_ID);
                            if (timeoutLogChannel) {
                                await timeoutLogChannel.send({ 
                                    embeds: [timeoutLogEmbed],
                                    flags: [4] 
                                });
                            }
                        }
                    } else {
                        return interaction.reply({ content: '⚠️ Timeout için geçerli bir süre girmelisiniz!', ephemeral: true });
                    }
                }
            } else {
                return interaction.reply({ content: '⚠️ İşlem başarısız! Kullanıcı sunucuda bulunmuyor.', ephemeral: true });
            }
        } catch (e) {
            console.error(e);
            return interaction.reply({ content: '⚠️ İşlem başarısız! Yetkim yetersiz.', ephemeral: true });
        }

        await interaction.reply({ content: `✅ İşlem başarılı! Ceza ID: #${cezaId}`, ephemeral: true });

    } else if (interaction.commandName === 'uyar') {
        const target = interaction.options.getUser('kullanici');
        const reason = interaction.options.getString('sebep');
        const uyariId = Math.floor(100 + Math.random() * 900);
        const settings = guildSettings[guildId] || {};

        if (!warningsDB.has(target.id)) { warningsDB.set(target.id, []); }
        const userWarnings = warningsDB.get(target.id);
        userWarnings.push({ id: uyariId, reason: reason, moderator: interaction.user.tag, date: new Date().toLocaleDateString('tr-TR') });

        const totalWarnings = userWarnings.length;
        let isAutoBanned = false;

        const warnFields = [
            { name: '🛡️ İşlem Türü', value: '`UYARI (WARN)`', inline: true },
            { name: '🆔 Uyarı ID', value: `\`#${uyariId}\``, inline: true },
            { name: '📊 Toplam Uyarı', value: `\`${totalWarnings} / ${MAX_WARNINGS}\``, inline: true },
            { name: '👤 Uyarı Alan', value: `${target} (${target.id})`, inline: false },
            { name: '👮 Yetkili', value: `${interaction.user}`, inline: true },
            { name: '⚠️ Sebep', value: reason, inline: false }
        ];

        if (totalWarnings >= MAX_WARNINGS) {
            isAutoBanned = true;
            warnFields.push({ name: '🚨 Otomatik İşlem', value: `Kullanıcı ${MAX_WARNINGS} uyarı sınırına ulaştığı için **kalıcı olarak yasaklandı!**`, inline: false });
        }

        const warnLogEmbed = new EmbedBuilder()
            .setColor(totalWarnings >= MAX_WARNINGS ? 0xFF0000 : 0xFFA500)
            .setTitle(`⚠️ ${guildName} | Uyarı Sistemi`)
            .setDescription(`⚠️ **${target}** adlı kullanıcı resmi olarak uyarılmıştır.`)
            .addFields(warnFields)
            .setFooter({ text: `${guildName} | Güvenlik ve Moderasyon Departmanı` })
            .setTimestamp();

        if (isAutoBanned) {
            try {
                const member = await interaction.guild.members.fetch(target.id).catch(() => null);
                if (member) { await member.ban({ reason: `Otomatik Ban: 10 Uyarı Sınırı` }); }
            } catch (e) {}
        }

        if (settings.WARN_LOG_CHANNEL_ID) {
            const warnLogChannel = interaction.guild.channels.cache.get(settings.WARN_LOG_CHANNEL_ID);
            if (warnLogChannel) { 
                await warnLogChannel.send({ 
                    embeds: [warnLogEmbed],
                    flags: [4] 
                }); 
            }
        }

        await interaction.reply({ content: `Uyarı başarıyla verildi! Toplam Uyarı: ${totalWarnings}/${MAX_WARNINGS}`, ephemeral: true });

    } else if (interaction.commandName === 'uyarilari-goster') {
        const target = interaction.options.getUser('kullanici');
        const userWarnings = warningsDB.get(target.id) || [];
        const totalWarnings = userWarnings.length;

        const embed = new EmbedBuilder()
            .setColor(0x0099FF)
            .setTitle(`📋 ${guildName} | Uyarı Geçmişi`)
            .setDescription(`👤 **${target}** adlı kullanıcının toplam uyarı dökümü aşağıdadır.`)
            .addFields({ name: '📊 Toplam Uyarı Sayısı', value: `\`${totalWarnings} / ${MAX_WARNINGS}\``, inline: false })
            .setFooter({ text: `${guildName} | Güvenlik ve Moderasyon Departmanı` })
            .setTimestamp();

        if (totalWarnings === 0) { embed.addFields({ name: '✨ Durum', value: 'Bu kullanıcının hiç uyarı kaydı bulunmuyor.', inline: false }); }
        else { const listText = userWarnings.slice(-5).map(w => `• **ID:** \`#${w.id}\` | **Tarih:** ${w.date}\n  **Sebep:** ${w.reason} *(Yetkili:${w.moderator})*`).join('\n\n'); embed.addFields({ name: '⚠️ Son Uyarılar', value: listText, inline: false }); }
        await interaction.reply({ embeds: [embed], ephemeral: true });

    } else if (interaction.commandName === 'unban') {
        const userId = interaction.options.getString('kullanici_id');
        const reason = interaction.options.getString('sebep');
        const unbanId = Math.floor(100 + Math.random() * 900);
        const settings = guildSettings[guildId] || {};

        let targetUser; try { targetUser = await client.users.fetch(userId); } catch (e) { return interaction.reply({ content: 'Geçersiz kullanıcı ID\'si!', ephemeral: true }); }
        try { await interaction.guild.members.unban(userId, reason); } catch (e) { return interaction.reply({ content: 'Bu kullanıcı zaten banlı değil veya yetkim yok!', ephemeral: true }); }
        warningsDB.delete(userId);

        const unbanFields = [
            { name: '🛡️ İşlem Türü', value: '`BAN AFFI`', inline: true },
            { name: '🆔 İşlem ID', value: `\`#${unbanId}\``, inline: true },
            { name: '👤 Affedilen Üye', value: `<@${userId}> (${userId})`, inline: false },
            { name: '👮 Yetkili', value: `${interaction.user}`, inline: true },
            { name: '⚠️ Af Sebebi', value: reason, inline: false }
        ];

        const embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle(`🔓 ${guildName} | Ban Affı Duyurusu`)
            .setDescription(`✅ **<@${userId}>** adlı kullanıcının sunucumuzdaki yasaklaması kaldırılmıştır.\n\n🔗 **Af Detayları:**`)
            .addFields(unbanFields)
            .setFooter({ text: `${guildName} | Güvenlik ve Moderasyon Departmanı` })
            .setTimestamp();

        if (settings.BAN_AFFI_CHANNEL_ID) {
            const banAffiChannel = interaction.guild.channels.cache.get(settings.BAN_AFFI_CHANNEL_ID);
            if (banAffiChannel) { await banAffiChannel.send({ embeds: [embed] }); }
        }
        if (targetUser) { try { await targetUser.send({ content: `🎉 **Tebrikler!** **${guildName}** sunucusundaki yasaklamanız kaldırıldı.`, embeds: [embed] }); } catch (err) {} }
        await interaction.reply({ content: `İşlem başarılı! Ban kaldırıldı ve duyuruldu.`, ephemeral: true });
    }
});

client.login(process.env.DISCORD_TOKEN);