import Color from "color";
import * as Discord from "discord.js";
export default {
  owner: {
    userid: "738032578820309072",
    username: "rajaneeshr",
  },
  bot: {
    supportServerInvite: "https://discord.gg/invite/",
    commands: { prefix: "a!" },
    homeguild: {
      guildid: "1012873353494790174",
      logchannelid: "1165308874870505482",
    },
  },
  colours: {
    aqua: Color("#1abc9c").rgbNumber(),
    background: Color("#36393F").rgbNumber(),
    black: Color("#000000").rgbNumber(),
    blue: Color("#3498db").rgbNumber(),
    blurple: Color("#5865f2").rgbNumber(),
    darkAqua: Color("#11806a").rgbNumber(),
    darkBlue: Color("#206694").rgbNumber(),
    darkButNotBlack: Color("#2c2f33").rgbNumber(),
    darkerGrey: Color("#7f8c8d").rgbNumber(),
    darkGold: Color("#c27c0e").rgbNumber(),
    darkGreen: Color("#1f8b4c").rgbNumber(),
    darkGrey: Color("#979c9f").rgbNumber(),
    darkNavy: Color("#2c3e50").rgbNumber(),
    darkOrange: Color("#a84300").rgbNumber(),
    darkPurple: Color("#71368a").rgbNumber(),
    darkRed: Color("#992d22").rgbNumber(),
    darkVividPink: Color("#ad1457").rgbNumber(),
    defaut: Color("#000000").rgbNumber(),
    embed: Color("#2f3136").rgbNumber(),
    fuchsia: Color("#eb459e").rgbNumber(),
    gold: Color("#f1c40f").rgbNumber(),
    green: Color("#57F287").rgbNumber(),
    grey: Color("#95a5a6").rgbNumber(),
    greyple: Color("#99aab5").rgbNumber(),
    lightBlurple: Color("#7289da").rgbNumber(),
    lightGrey: Color("#bcc0c0").rgbNumber(),
    lightRed: Color("#ff8c8e").rgbNumber(),
    lightYellow: Color("#ffee8b").rgbNumber(),
    luminousVividPink: Color("#e91e63").rgbNumber(),
    navy: Color("#34495e").rgbNumber(),
    notQuiteBlack: Color("#23272a").rgbNumber(),
    orange: Color("#e67e22").rgbNumber(),
    purple: Color("#9b59b6").rgbNumber(),
    random: "RANDOM",
    red: Color("#ed4245").rgbNumber(),
    white: Color("#ffffff").rgbNumber(),
    yellow: Color("#fee75c").rgbNumber(),
  },
  inversePermissions: {
    "1": "CreateInstantInvite",
    "2": "KickMembers",
    "4": "BanMembers",
    "8": "Administrator",
    "16": "ManageChannels",
    "32": "ManageGuild",
    "64": "AddReactions",
    "128": "ViewAuditLog",
    "256": "PrioritySpeaker",
    "512": "Stream",
    "1024": "ViewChannel",
    "2048": "SendMessages",
    "4096": "SendTTSMessages",
    "8192": "ManageMessages",
    "16384": "EmbedLinks",
    "32768": "AttachFiles",
    "65536": "ReadMessageHistory",
    "131072": "MentionEveryone",
    "262144": "UseExternalEmojis",
    "524288": "ViewGuildInsights",
    "1048576": "Connect",
    "2097152": "Speak",
    "4194304": "MuteMembers",
    "8388608": "DeafenMembers",
    "16777216": "MoveMembers",
    "33554432": "UseVAD",
    "67108864": "ChangeNickname",
    "134217728": "ManageNicknames",
    "268435456": "ManageRoles",
    "536870912": "ManageWebhooks",
    "1073741824": "ManageEmojisAndStickers",
    "2147483648": "UseApplicationCommands",
    "4294967296": "RequestToSpeak",
    "8589934592": "ManageEvents",
    "17179869184": "ManageThreads",
    "34359738368": "CreatePublicThreads",
    "68719476736": "CreatePrivateThreads",
    "137438953472": "UseExternalStickers",
    "274877906944": "SendMessagesInThreads",
    "549755813888": "UseEmbeddedActivities",
    "1099511627776": "ModerateMembers",
  },
  buttonStyle: Discord.ButtonStyle,
  activityType: {
    /**
     * Playing {game}
     */
    Playing: 0,
    /**
     * Streaming {details}
     */
    Streaming: 1,
    /**
     * Listening to {name}
     */
    Listening: 2,
    /**
     * Watching {details}
     */
    Watching: 3,
    /**
     * {emoji} {details}
     */
    Custom: 4,
    /**
     * Competing in {name}
     */
    Competing: 5,
  },
  activityflags: Discord.ActivityFlags,
  applicationCommandtype: Discord.ApplicationCommandType,
  applicationCommandOptionType: Discord.ApplicationCommandOptionType,
  applicationCommandPermissionsType: Discord.ApplicationCommandPermissionType,
  auditLogEvent: Discord.AuditLogEvent,
  channelFlags: Discord.ChannelFlags,
  channelType: Discord.ChannelType,
  events: Discord.Events,
  guildSystemChannelFlags: Discord.GuildSystemChannelFlags,
  guildScheduledEventStatus: Discord.GuildScheduledEventStatus,
  guildFeature: Discord.GuildFeature,
  guildMFALevel: Discord.GuildMFALevel,
  guildPremiumTier: Discord.GuildPremiumTier,
  permissions: Discord.PermissionFlagsBits,
};
