// ... (top-level imports and constants)
require('dotenv').config();
const {
  Client, GatewayIntentBits, Partials,
  ActionRowBuilder, StringSelectMenuBuilder,
  SlashCommandBuilder, Collection, Events
} = require('discord.js');

const EPHEMERAL = 1 << 6;
const ALL_MAPS = ['Ascent', 'Icebox', 'Sunset', 'Haven', 'Lotus', 'Pearl', 'Split'];

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  partials: [Partials.Channel],
});

const ChannelSessionManager = {
  sessions: new Map(),
  
  createSession(channelId, sessionData) {
    this.sessions.set(channelId, {
      ...sessionData,
      createdAt: Date.now(),
      lastActivity: Date.now()
    });
    return this.sessions.get(channelId);
  },
  
  getSession(channelId) {
    return this.sessions.get(channelId);
  },
  
  updateActivity(channelId) {
    const session = this.sessions.get(channelId);
    if (session) {
      session.lastActivity = Date.now();
    }
  },
  
  hasActiveSession(channelId) {
    return this.sessions.has(channelId);
  },
  
  removeSession(channelId) {
    return this.sessions.delete(channelId);
  },
  
  cleanupOldSessions(maxAgeMs = 3600000) {
    const now = Date.now();
    let count = 0;
    for (const [channelId, session] of this.sessions.entries()) {
      if (now - session.lastActivity > maxAgeMs) {
        this.sessions.delete(channelId);
        count++;
      }
    }
    return count;
  }
};

client.commands = new Collection();
client.commands.set('coinflip', {
  data: new SlashCommandBuilder()
    .setName('coinflip')
    .setDescription('Flip a coin to decide who picks the match format')
    .addUserOption(option =>
      option.setName('opponent')
        .setDescription('The opposing team captain')
        .setRequired(true)
    ),
  async execute(interaction) {
    const channelId = interaction.channelId;
    
    // Check if a session already exists in this channel
    if (ChannelSessionManager.hasActiveSession(channelId)) {
      return interaction.reply({ 
        content: "❌ A veto session is already in progress in this channel. Please finish it or use `/endveto` to cancel it.", 
        flags: EPHEMERAL 
      });
    }
    
    const teamA = interaction.user;
    const teamB = interaction.options.getUser('opponent');

    if (!teamB || teamA.id === teamB.id) {
      return interaction.reply({ content: "❌ Invalid opponent.", flags: EPHEMERAL });
    }

    const select = new StringSelectMenuBuilder()
      .setCustomId(`coinflip_side_${teamA.id}_${teamB.id}`)
      .setPlaceholder('Pick Heads or Tails')
      .addOptions([
        { label: 'Heads', value: 'Heads' },
        { label: 'Tails', value: 'Tails' }
      ]);

    const row = new ActionRowBuilder().addComponents(select);

    await interaction.reply({
      content: `<@${teamA.id}>, choose **Heads** or **Tails**. <@${teamB.id}> will get the other.`,
      components: [row]
    });
  }
});

client.commands.set('endveto', {
  data: new SlashCommandBuilder()
    .setName('endveto')
    .setDescription('Force end an active veto session in the current channel'),
  async execute(interaction) {
    const channelId = interaction.channelId;
    
    if (!ChannelSessionManager.hasActiveSession(channelId)) {
      return interaction.reply({ 
        content: "❌ There is no active veto session in this channel.", 
        flags: EPHEMERAL 
      });
    }
    
    ChannelSessionManager.removeSession(channelId);
    return interaction.reply({ content: "✅ The veto session has been ended." });
  }
});

client.once(Events.ClientReady, () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on(Events.InteractionCreate, async interaction => {
  const channelId = interaction.channelId;

  if (interaction.isChatInputCommand()) {
    const command = client.commands.get(interaction.commandName);
    if (command) await command.execute(interaction);
  }

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('coinflip_side_')) {
    const [_, __, teamAIdRaw, teamBIdRaw] = interaction.customId.split('_');

    if (interaction.user.id !== teamAIdRaw) {
      return interaction.reply({ content: "❌ Only the person who initiated the coinflip can choose Heads or Tails.", flags: EPHEMERAL });
    }

    const teamASide = interaction.values[0];
    const teamBSide = teamASide === 'Heads' ? 'Tails' : 'Heads';
    const coinResult = Math.random() < 0.5 ? 'Heads' : 'Tails';
    const winner = coinResult === teamASide ? teamAIdRaw : teamBIdRaw;

    const teamAMember = await interaction.guild.members.fetch(teamAIdRaw);
    const teamBMember = await interaction.guild.members.fetch(teamBIdRaw);
    const teamARoleName = teamAMember.roles.cache.find(r => r.name !== '@everyone')?.name || 'Team A';
    const teamBRoleName = teamBMember.roles.cache.find(r => r.name !== '@everyone')?.name || 'Team B';

    // Create a new session using the manager instead of directly setting in the map
    const session = ChannelSessionManager.createSession(channelId, {
      teamAId: winner === teamAIdRaw ? teamAIdRaw : teamBIdRaw,
      teamBId: winner === teamAIdRaw ? teamBIdRaw : teamAIdRaw,
      teamARoleName: winner === teamAIdRaw ? teamARoleName : teamBRoleName,
      teamBRoleName: winner === teamAIdRaw ? teamBRoleName : teamARoleName,
      matchType: '',
      mapPool: [...ALL_MAPS],
      vetoStep: 0,
      vetoSequence: [],
      picks: []
    });

    await interaction.update({
      content: `🪙 <@${teamAIdRaw}> chose **${teamASide}**\n<@${teamBIdRaw}> gets **${teamBSide}**\n**Coin landed on ${coinResult}!** 🎉\n➡️ <@${winner}>, please select a match format.`,
      components: []
    });

    const formatSelect = new StringSelectMenuBuilder()
      .setCustomId('select_match_format')
      .setPlaceholder('Choose match format')
      .addOptions([
        { label: 'Best of 1', value: 'BO1' },
        { label: 'Best of 3', value: 'BO3' },
        { label: 'Best of 5', value: 'BO5' }
      ]);

    const row = new ActionRowBuilder().addComponents(formatSelect);
    interaction.channel.send({ content: `<@${winner}>, choose the match format for the veto:`, components: [row] });
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'select_match_format') {
    const session = ChannelSessionManager.getSession(channelId);
    if (!session || interaction.user.id !== session.teamAId) {
      return interaction.reply({ content: '❌ Only the coinflip winner can pick the match format.', flags: EPHEMERAL });
    }

    session.matchType = interaction.values[0];
    session.mapPool = [...ALL_MAPS];
    session.vetoStep = 0;
    session.picks = [];
    setVetoSequence(session);

    await interaction.update({ content: `✅ Match format selected: **${session.matchType}**`, components: [] });
    interaction.channel.send(`🗺️ Veto **${session.matchType}** started between **${session.teamARoleName}** and **${session.teamBRoleName}**!`);
    handleNextStep(interaction.channel, session);
  }

  if (interaction.isStringSelectMenu() && ['ban_map', 'pick_map', 'pick_side'].includes(interaction.customId)) {
    const session = ChannelSessionManager.getSession(channelId);
    if (!session) return;
    
    ChannelSessionManager.updateActivity(channelId);
    
    const step = session.vetoSequence[session.vetoStep];
    const userId = interaction.user.id;
    const value = interaction.values[0];

    if (userId !== step.by) {
      return interaction.reply({ content: "❌ It's not your turn!", flags: EPHEMERAL });
    }

    if (step.type === 'ban') {
      session.mapPool = session.mapPool.filter(m => m !== value);
      await interaction.update({ content: `🚫 <@${userId}> banned **${value}**`, components: [] });
    } else if (step.type === 'pick_map') {
      session.mapPool = session.mapPool.filter(m => m !== value);
      session.picks.push({ map: value });
      await interaction.update({ content: `✅ <@${userId}> picked **${value}** as Map ${session.picks.length}`, components: [] });
    } else if (step.type === 'pick_side') {
      const currentMap = session.picks[step.mapIndex];
      const side = value;
      const oppositeSide = side === 'Defender' ? 'Attacker' : 'Defender';

      if (userId === session.teamAId) {
        currentMap[session.teamAId] = side;
        currentMap[session.teamBId] = oppositeSide;
      } else {
        currentMap[session.teamBId] = side;
        currentMap[session.teamAId] = oppositeSide;
      }

      await interaction.update({ content: `🧭 <@${userId}> picked **${side}** side for **${currentMap.map}**.`, components: [] });
    }

    session.vetoStep++;
    if (session.vetoStep < session.vetoSequence.length) {
      handleNextStep(interaction.channel, session);
    } else {
      showVetoSummary(interaction.channel, session);
      ChannelSessionManager.removeSession(channelId);
    }
  }
});

function setVetoSequence(session) {
  const A = session.teamAId;
  const B = session.teamBId;

  if (session.matchType === 'BO1') {
    session.vetoSequence = [
      { type: 'ban', by: A }, { type: 'ban', by: B },
      { type: 'ban', by: A }, { type: 'ban', by: B },
      { type: 'ban', by: A }, { type: 'ban', by: B },
      { type: 'pick_side', by: A, mapIndex: 0 }
    ];
  } else if (session.matchType === 'BO3') {
    session.vetoSequence = [
      { type: 'ban', by: A }, { type: 'ban', by: B },
      { type: 'pick_map', by: A }, { type: 'pick_side', by: B, mapIndex: 0 },
      { type: 'pick_map', by: B }, { type: 'pick_side', by: A, mapIndex: 1 },
      { type: 'ban', by: A }, { type: 'ban', by: B },
      { type: 'pick_side', by: A, mapIndex: 2 }
    ];
  } else if (session.matchType === 'BO5') {
    session.vetoSequence = [
      { type: 'ban', by: A }, { type: 'ban', by: B },
      { type: 'pick_map', by: A }, { type: 'pick_side', by: B, mapIndex: 0 },
      { type: 'pick_map', by: B }, { type: 'pick_side', by: A, mapIndex: 1 },
      { type: 'pick_map', by: A }, { type: 'pick_side', by: B, mapIndex: 2 },
      { type: 'pick_map', by: B }, { type: 'pick_side', by: A, mapIndex: 3 },
      { type: 'pick_side', by: A, mapIndex: 4 }
    ];
  }
}

function handleNextStep(channel, session) {
  const step = session.vetoSequence[session.vetoStep];
  if (!step) return;

  if (step.type === 'ban' || step.type === 'pick_map') {
    const select = new StringSelectMenuBuilder()
      .setCustomId(step.type === 'ban' ? 'ban_map' : 'pick_map')
      .setPlaceholder(step.type === 'ban' ? 'Select a map to ban' : 'Select a map to pick')
      .addOptions(session.mapPool.map(m => ({ label: m, value: m })));
    channel.send({ content: `<@${step.by}>, ${step.type === 'ban' ? 'ban a map' : 'pick a map'}.`, components: [new ActionRowBuilder().addComponents(select)] });
  } else if (step.type === 'pick_side') {
    if (!session.picks[step.mapIndex] && session.mapPool.length === 1) {
      session.picks.push({ map: session.mapPool[0] });
    }

    const select = new StringSelectMenuBuilder()
      .setCustomId('pick_side')
      .setPlaceholder('Pick a side')
      .addOptions([
        { label: 'Defender', value: 'Defender' },
        { label: 'Attacker', value: 'Attacker' }
      ]);
    channel.send({
      content: `<@${step.by}>, pick a side for **${session.picks[step.mapIndex].map}**.`,
      components: [new ActionRowBuilder().addComponents(select)]
    });
  }
}

function showVetoSummary(channel, session) {
  let summary = `📋 Veto complete for **${session.matchType}**\n\n`;
  session.picks.forEach((p, i) => {
    const teamASide = p[session.teamAId] || 'Unpicked';
    const teamBSide = p[session.teamBId] || 'Unpicked';
    summary += `**Map ${i + 1}: ${p.map}** — **${session.teamARoleName}** (${teamASide}), **${session.teamBRoleName}** (${teamBSide})\n`;
  });
  channel.send(summary);
}

// Clean up old sessions every 30 minutes
setInterval(() => {
  const cleanedCount = ChannelSessionManager.cleanupOldSessions(1800000); // 30 minutes
  if (cleanedCount > 0) {
    console.log(`Cleaned up ${cleanedCount} abandoned veto sessions`);
  }
}, 1800000); // Run every 30 minutes

client.login(process.env.DISCORD_TOKEN);
