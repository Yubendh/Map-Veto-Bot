const { SlashCommandBuilder } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');
require('dotenv').config();

// Create an instance of the REST client and set the bot token
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

// Define your slash commands
const commands = [
  new SlashCommandBuilder()
    .setName('coinflip')
    .setDescription('Flip a coin to decide who picks the match format')
    .addUserOption(option =>
      option.setName('opponent')
        .setDescription('The opposing team captain')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('endveto')
    .setDescription('Force end an active veto session in the current channel'),
  // Add more commands if needed
];

(async () => {
  try {
    console.log('Started refreshing application (/) commands.');

    // Ensure the CLIENT_ID and DISCORD_TOKEN are set in the .env file
    if (!process.env.CLIENT_ID || !process.env.DISCORD_TOKEN) {
      console.error("Missing CLIENT_ID or DISCORD_TOKEN in .env file.");
      return;
    }

    console.log('Client ID:', process.env.CLIENT_ID);

    // Register the slash commands with Discord
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),  // Use Routes correctly
      { body: commands.map(command => command.toJSON()) },
    );

    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error('Error refreshing application commands:', error);
  }
})();
