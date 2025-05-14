const { Client, IntentsBitField } = require('discord.js');
require('dotenv').config();
const axios = require('axios');

const client = new Client({
    intents: [
        IntentsBitField.Flags.Guilds,
        IntentsBitField.Flags.GuildMembers,
        IntentsBitField.Flags.GuildMessages,
        IntentsBitField.Flags.MessageContent,
    ],
});

let coreToken;
let liveToken;
let OAuthAccessToken;
const clubId = 102401; // Id for "Beat me"

client.on('ready', async (e) => {
    console.log(`${e.user.tag} is online`)
    const { core, live } = await tokens();
    coreToken = core;
    liveToken = live;
    OAuthAccessToken = await OAuthToken();
    weeklyReset(e);
});

const tokens = async () => {
    try {
        const creds = process.env.CREDENTIALS;
        const base64EncodedCreds = Buffer.from(creds).toString('base64');

        const res = await axios.post('https://public-ubiservices.ubi.com/v3/profiles/sessions', {}, {
            headers: {
                'Content-Type': 'application/json',
                'Ubi-AppId': '86263886-327a-4328-ac69-527f0d20a237',
                'Authorization': `Basic ${base64EncodedCreds}`,
                'User-Agent': 'Discord bot for club leaderboards/manilgajjar@gmail.com/',
            }
        });

        const res2 = await axios.post('https://prod.trackmania.core.nadeo.online/v2/authentication/token/ubiservices', {
            'audience': 'NadeoServices', // Change if you want tokens for CoreApi or LiveApi,  NadeoServices | NadeoLiveServices
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `ubi_v1 t=${res.data.ticket}`,
                'User-Agent': 'Discord bot for club leaderboards/manilgajjar@gmail.com/',
            },
        });

        const res3 = await axios.post('https://prod.trackmania.core.nadeo.online/v2/authentication/token/ubiservices', {
            'audience': 'NadeoLiveServices', // Change if you want tokens for CoreApi or LiveApi,  NadeoServices | NadeoLiveServices
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `ubi_v1 t=${res.data.ticket}`,
                'User-Agent': 'Discord bot for club leaderboards/manilgajjar@gmail.com/',
            },
        });

        const coreAccessToken = res2.data.accessToken;
        const coreRefreshToken = res2.data.refreshToken;
        const liveAccessToken = res3.data.accessToken;
        const liveRefreshToken = res3.data.refreshToken;

        return {
            core: coreAccessToken,
            live: liveAccessToken,
        };

    } catch (error) {
        console.error('Error fetching tokens', error);
    }
};

const OAuthToken = async () => {

    const res = await axios.post('https://api.trackmania.com/api/access_token', {
        'grant_type': 'client_credentials',
        'client_id': process.env.CLIENT_ID,
        'client_secret': process.env.CLIENT_SECRET,
    }, {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        }
    });
    return res.data.access_token;
};

const fetchWeeklyShorts = async (liveToken) => {
    try {

        const res = await axios.get('https://live-services.trackmania.nadeo.live/api/campaign/weekly-shorts?length=1&offset=0', {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `nadeo_v1 t=${liveToken}`,
                'User-Agent': 'Discord bot for club leaderboards/manilgajjar@gmail.com/',
            },
        })
        
        return {
            weeklyShortsSeasonId: res.data.campaignList[0].seasonUid,
            weeklyShortsMaps: res.data.campaignList[0].playlist,
        };

    } catch (error) {
        console.error('Error fetching weekly shorts maps:', error);
    }
};

const fetchCampaignMaps = async (liveToken) => {
    try {
        const res = await axios.get('https://live-services.trackmania.nadeo.live/api/campaign/official?length=1&offset=0', {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `nadeo_v1 t=${liveToken}`,
                'User-Agent': 'Discord bot for club leaderboards/manilgajjar@gmail.com/',
            },
        });

        return {
            campaignSeasonId: res.data.campaignList[0].seasonUid,
            campaignMaps: res.data.campaignList[0].playlist,
        };
    } catch (error) {
        console.error('Error fetching campaign maps:', error);
    }
};

const fetchMapLeaderboardInfo = async (liveToken, seasonId, maps) => {
    
    try {

        const result = await Promise.all(
            maps.map(async (map) => {
                const res = await axios.get(`https://live-services.trackmania.nadeo.live/api/token/leaderboard/group/${seasonId}/map/${map.mapUid}/club/${clubId}/top?length=5&offset=0`, {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `nadeo_v1 t=${liveToken}`,
                        'User-Agent': 'Discord bot for club leaderboards/manilgajjar@gmail.com/',
                    },
                });
                const leaderboards = res.data.top.map(player => ({
                    accountId: player.accountId,
                    position: player.position,
                }));

                const response = {
                    id: map.mapUid,
                    position: map.position,
                    leaderboards,
                }
                return response;
            })
        );
        return result


    } catch (error) {
        console.error('Error fetching club information:', error);
    }
};

const intervalLeaderboardCheck = async (liveToken) => {
    const users = await displayNames();
    const { weeklyShortsSeasonId, weeklyShortsMaps } = await fetchWeeklyShorts(liveToken);
    // const { campaignSeasonId, campaignMaps } = await fetchCampaignMaps(liveToken);
    let weeklyData = await fetchMapLeaderboardInfo(liveToken, weeklyShortsSeasonId, weeklyShortsMaps);

    const checkLeaderboards = async () => {
        const newWeeklyData = await fetchMapLeaderboardInfo(liveToken, weeklyShortsSeasonId, weeklyShortsMaps);
        const message = [];

        weeklyData.forEach(oldMap => {
            let changeFlag = false
            const newMap = newWeeklyData.find(obj => obj.id === oldMap.id);
            if (newMap) {
                oldMap.leaderboards.forEach(oldLeaderboard => {
                    const newLeaderboard = newMap.leaderboards.find(item => item.accountId === oldLeaderboard.accountId);
                    if (newLeaderboard.position > oldLeaderboard.position) {
                        changeFlag = !changeFlag;
                        const overtaker = newMap.leaderboards.find(overtaker => overtaker.position === oldLeaderboard.position)
                        message.push({
                            victim: oldLeaderboard.accountId,
                            winner: overtaker.accountId,
                        });
                        oldLeaderboard.position = newLeaderboard.position
                    }
                })
            }
            console.log('mapbreak')
        })
        setTimeout(checkLeaderboards, 1000 * 60) // Every minute

        return message
    };
    const announcement = await checkLeaderboards();

    if (announcement) {
        const channel = client.channels.cache.get(process.env.MY_CHANNEL)
        announcement.forEach(item => {
            channel.send(`@${item.victim} you just got fucked in the ass by ${item.winner}`);
        })
    }

};

const formatData = (users, data) => {

    const discordMessages = data.map((map, index) => {
        const playerNames = map.leaderboards.map(player => users[player.accountId] || 'Unknown');
        const formattedPlayers = playerNames.map((name, i) => {
            name = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
            let medal;
            switch (i) {
                case 0: 
                    medal = '🥇';
                    break;
                case 1:
                    medal = '🥈';
                    break;
                case 2:
                    medal = '🥉';
                    break;
                default:
                    medal = '🧑‍🦽‍➡️'
            }
            return `${medal} ${name}`
        }).join(', ');
        return `**Map ${index + 1}:**\n${formattedPlayers}`;
    });
    const result = discordMessages.join('\n');
    return result;
    
};

const displayNames = async () => {

    // Get club members
    const ids = await axios.get(`https://live-services.trackmania.nadeo.live/api/token/club/${clubId}/member?length=10&offset=0`, {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `nadeo_v1 t=${liveToken}`,
            'User-Agent': 'Discord bot for club leaderboards/manilgajjar@gmail.com/',
        }
    });

    const idsList = ids.data.clubMemberList.map(member => {
        return member.accountId;
    });
    const idsArray = idsList.map(id => {
        return `accountId[]=${id}`
    }).join('&');

    // Get club member names
    const names = await axios.get(`https://api.trackmania.com/api/display-names?${idsArray}`, {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': ` Bearer ${OAuthAccessToken}`,
            'User-Agent': 'Discord bot for club leaderboards/manilgajjar@gmail.com/',
        }
    })

    return names.data; // ids to names object

};

const weeklyReset = () => {

    const checkReset = () => {
        const { timeDiff } = timeRemaning();
        if (timeDiff <= 0) {
            const channel = client.channels.cache.get(process.env.CHANNEL)
            channel.send('Weekly Shorts have been reset!');
        }
    };

    const interval = 1 * 1000 // Check every minute
    setInterval(checkReset, interval);
};

const timeRemaning = () => {
    const now = new Date();
    const nextSunday = new Date();

    const daysUntilSunday = (7 - now.getDay()) % 7;
    nextSunday.setDate(now.getDate() + daysUntilSunday);
    nextSunday.setHours(17, 0, 0, 0);

    let timeDiff = nextSunday.getTime() - now.getTime();
    if (timeDiff < 0) {
        nextSunday.setDate(nextSunday.getDate() + 7);
        timeDiff = nextSunday.getTime() - now.getTime();
    }
    const days = Math.floor(timeDiff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((timeDiff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((timeDiff % (1000 * 60)) / 1000);

    return { days, hours, minutes, seconds, timeDiff };

};

const userTimeRemaining = () => {
    const { days, hours, minutes, seconds } = timeRemaning();
    if (!days < 1) {
        return `Weekly Shorts reset in ${days} days, ${hours} hours, ${minutes} minutes, ${seconds} seconds!`;
    } else {
        return `Weekly Shorts reset in ${hours} hours, ${minutes} minutes, ${seconds} seconds!`;
    }
};

client.on('messageCreate', async (e) => {
    if (e.channel.id === process.env.CHANNEL && !e.author.bot) {
        if (e.content === '!track') {
            const { weeklyShortsSeasonId, weeklyShortsMaps } = await fetchWeeklyShorts(liveToken);
            const weeklyShortsLeaderBoardData = await fetchMapLeaderboardInfo(liveToken, weeklyShortsSeasonId, weeklyShortsMaps);
            const users = await displayNames();
            const message = formatData(users, weeklyShortsLeaderBoardData);
            e.channel.send(message);         
        }
        if (e.content === '!reset') {
            const message = userTimeRemaining();
            e.channel.send(message);         
        }
    }
    // Testing
    if (e.channel.id === process.env.MY_CHANNEL && !e.author.bot) {
        if (e.content === '!test') {            
            // const { campaignSeasonId, campaignMaps } = await fetchCampaignMaps(liveToken);
            // const campaignLeaderBoardData = await fetchMapLeaderboardInfo(liveToken, campaignSeasonId, campaignMaps);
            intervalLeaderboardCheck(liveToken); 
        }
    }
});


client.login(process.env.TOKEN);