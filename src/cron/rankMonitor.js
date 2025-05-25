module.exports = {
	expression: '*/1 * * * *', //every minute
	async execute(client) {
		return await updateMessage(client);
	},
};

const { ActionRowBuilder, ButtonBuilder } = require('discord.js');
const { wom, getWOMMembers } = require('../WiseOldMan');
const { ChannelType, ButtonStyle } = require('discord-api-types/v10');
const { findOrCreateMessage } = require('../utils');
const { WOM_GROUP_NUMBER } = require('../config');
const { Metric } = require('@wise-old-man/utils');
const CHANNEL_NAME = 'pending-rank-ups';
const excludedRsns = [''];
let activeCollector = null;

const rankThresholds = [
	{ rank: 'maxed', threshold: 2277 },
	{ rank: 'tzkal', threshold: 2200 },
	{
		rank: 'tztok',
		threshold: 2000,
	},
	{ rank: 'myth', threshold: 1750 },
	{ rank: 'sage', threshold: 1500 },
	{ rank: 'unholy', threshold: 0 },
];

async function updateMessage(bot) {
	const guilds = bot.guilds.cache.values();
	for (const guild of guilds) {
		let channel = guild.channels.cache.find(
			ch => ch.name.endsWith(CHANNEL_NAME) && ch.type === ChannelType.GuildText,
		);
		if (!channel) {
			console.log(
				`Channel "${CHANNEL_NAME}" not found in guild ${guild.name}, skipping update.`,
			);
			continue;
		}
		const emojis = guild.emojis.cache;
		const outdatedRanks = await checkTotalLevelRanks(WOM_GROUP_NUMBER);
		const title = '## 📊 Rank Status\n';
		const footer = getFooterNote();
		const pages = preparePages(outdatedRanks, emojis, 2000 - footer.length - title.length);
		let message = await findOrCreateMessage(bot, channel);
		let components = prepareComponents(pages.length > 1, 0, pages.length);
		let content = pages.length > 0 ? pages[0] : '\n**✅ All ranks are up to date.**';
		content = title + content + footer;
		await message.edit({
			content,
			components,
		});
		await message.suppressEmbeds(true);
		let currentPage = 0;
		if (activeCollector) {
			activeCollector.stop();
			activeCollector = null;
		}
		activeCollector = message.createMessageComponentCollector({ idle: 60000 });
		activeCollector.on('collect', async interaction => {
			if (!interaction.isButton()) return;
			try {
				if (interaction.customId === 'rankrole-previous') {
					currentPage = Math.max(currentPage - 1, 0);
				} else if (interaction.customId === 'rankrole-next') {
					currentPage = Math.min(currentPage + 1, pages.length - 1);
				}
				await interaction.update({
					content: title + pages[currentPage] + footer,
					components: prepareComponents(pages.length > 1, currentPage, pages.length),
				});
			} catch (error) {
				console.error('Error handling interaction:', error);
			}
		});
	}
}

function preparePages(outdatedMembers, emojis, maxCharsPerPage) {
	// Sort the members by highest to lowest total level
	outdatedMembers.sort((a, b) => b.totalLevel - a.totalLevel);
	const pages = [];
	let currentPageContent = '';
	let memberCount = 0;
	outdatedMembers.forEach(member => {
		if (excludedRsns.includes(member.displayName)) {
			return;
		}
		memberCount++;
		const currentRankEmoji = getRankEmoji(emojis, member.currentRole);
		const requiredRankEmoji = getRankEmoji(emojis, member.requiredRole);
		const line =
			`**${memberCount}.** [**${member.displayName}**](https://wiseoldman.net/players/${encodeURIComponent(member.displayName)}) ` +
			`${currentRankEmoji} ➜ ${requiredRankEmoji} *(Lvl: ${member.totalLevel.toLocaleString()})*\n`;
		if (currentPageContent.length + line.length > maxCharsPerPage) {
			pages.push(currentPageContent.trim());
			currentPageContent = line;
		} else {
			currentPageContent += line;
		}
	});
	if (currentPageContent.length > 0) {
		pages.push(currentPageContent.trim());
	}
	return pages;
}

function getFooterNote() {
	const now = Math.floor(Date.now() / 1000);
	return (
		`\n` +
		`───────────────────────────────────\n` +
		`**📋 Important Information:**\n` +
		`• This relies on the [WOM Group](https://wiseoldman.net/groups/${WOM_GROUP_NUMBER}) being synced\n` +
		`• Use the [WOM Plugin](https://runelite.net/plugin-hub/show/wom-utils) to sync after rank changes\n` +
		`• Last Updated: <t:${now}:R>\n` +
		`───────────────────────────────────`
	);
}

function getRankEmoji(emojis, rankName) {
	const emoji = emojis.find(e => e.name.toLowerCase() === rankName.toLowerCase());
	return emoji ? `<:${emoji.name}:${emoji.id}>` : `**${rankName}**`;
}

function prepareComponents(hasMultiplePages, currentPage = 0, totalPages = 1) {
	const components = [];
	if (hasMultiplePages) {
		const buttons = [];
		// Previous button
		if (currentPage !== 0) {
			buttons.push(
				new ButtonBuilder()
					.setCustomId('rankrole-previous')
					.setLabel('◀ Previous')
					.setStyle(ButtonStyle.Secondary)
					.setDisabled(currentPage === 0),
			);
		}
		// Page indicator button (disabled, shows current page)
		buttons.push(
			new ButtonBuilder()
				.setCustomId('rankrole-page-info')
				.setLabel(`${currentPage + 1} / ${totalPages}`)
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(true),
		);
		// Next button
		if (currentPage !== totalPages - 1) {
			buttons.push(
				new ButtonBuilder()
					.setCustomId('rankrole-next')
					.setLabel('Next ▶')
					.setStyle(ButtonStyle.Secondary)
					.setDisabled(currentPage >= totalPages - 1),
			);
		}
		components.push(new ActionRowBuilder().addComponents(buttons));
	}
	return components;
}

async function checkTotalLevelRanks(groupId) {
	let outdatedRanks = [];
	try {
		const group = await wom.groups.getGroupHiscores(groupId, Metric.OVERALL, {
			limit: 500,
			offset: 0,
		});
		const ranks = await getWOMMembers();
		if (!group || !ranks || group.length === 0 || ranks.length === 0) {
			console.error('Invalid rank/group data:', group);
			return;
		}
		for (const entry of group) {
			if (!entry) continue;
			const displayName = entry.player.displayName;
			const totalLevel = entry.data.level;
			const memberRank = ranks.find(member => member.rsn === entry.player.username);
			const currentRole = memberRank ? memberRank.rank : null;
			if (!displayName || totalLevel === undefined || !currentRole) {
				console.error('Missing data for member: ' + displayName);
				continue;
			}
			//only rank people who have a rank threshold rank already (ignoring other ranks)
			if (rankThresholds.find(r => r.rank === currentRole)) {
				const requiredRole = getRankByTotalLevel(totalLevel);
				if (requiredRole && currentRole !== requiredRole) {
					outdatedRanks.push({
						displayName,
						totalLevel,
						currentRole,
						requiredRole,
					});
				}
			}
		}
	} catch (error) {
		console.error('Failed to checkTotalLevelRanks:', error);
	}
	return outdatedRanks;
}

function getRankByTotalLevel(totalLevel) {
	for (let i = 0; i < rankThresholds.length; i++) {
		if (totalLevel >= rankThresholds[i].threshold) {
			return rankThresholds[i].rank;
		}
	}
	return null;
}
