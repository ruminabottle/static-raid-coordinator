const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder } = require('discord.js');
const db = require('../db/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Initialize the bot: creates roles and sets reminder channel')
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('Channel for raid reminders and announcements')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    await interaction.deferReply();

    const guild = interaction.guild;
    const channel = interaction.options.getChannel('channel');

    // Create Raid Lead role if it doesn't exist
    let raidLeadRole = guild.roles.cache.find(r => r.name === 'Raid Lead');
    if (!raidLeadRole) {
      raidLeadRole = await guild.roles.create({
        name: 'Raid Lead',
        color: 0xE74C3C,
        reason: 'Static Raid Coordinator setup',
      });
    }

    // Create Static Member role if it doesn't exist
    let staticMemberRole = guild.roles.cache.find(r => r.name === 'Static Member');
    if (!staticMemberRole) {
      staticMemberRole = await guild.roles.create({
        name: 'Static Member',
        color: 0x3498DB,
        reason: 'Static Raid Coordinator setup',
      });
    }

    // Save config
    db.prepare(`
      INSERT INTO guild_config (guild_id, raid_lead_role_id, static_member_role_id, reminder_channel_id)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET
        raid_lead_role_id = excluded.raid_lead_role_id,
        static_member_role_id = excluded.static_member_role_id,
        reminder_channel_id = excluded.reminder_channel_id
    `).run(guild.id, raidLeadRole.id, staticMemberRole.id, channel.id);

    // Give the person running setup both roles
    await interaction.member.roles.add(raidLeadRole);
    await interaction.member.roles.add(staticMemberRole);

    const embed = new EmbedBuilder()
      .setColor(0x2ECC71)
      .setTitle('Setup Complete!')
      .setDescription(
        `- **Raid Lead** role created and assigned to you\n` +
        `- **Static Member** role created and assigned to you\n` +
        `- Reminders will post in ${channel}\n\n` +
        `**Next steps:**\n` +
        `1. Assign the **Static Member** role to your 7 other raiders\n` +
        `2. Run \`/schedule set\` to configure raid days`
      );
    await interaction.editReply({ embeds: [embed] });
  },
};
