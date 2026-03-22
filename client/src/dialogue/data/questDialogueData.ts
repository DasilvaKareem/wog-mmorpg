export const SCOUT_KAELA_BRIEFED_FLAG = "tutorial:scout_kaela_briefed";

export const NPC_GREETINGS = [
  "Ah, a brave soul approaches. I have need of your strength.",
  "Well met, champion. I've been waiting for someone capable.",
  "You look like you can handle yourself. Listen closely.",
  "The winds whisper of your deeds. Perhaps you can help me.",
  "Finally, someone who doesn't run at the first sign of danger.",
];

export const FALLBACK_GREETINGS = [
  "I'm listening. What do you need?",
  "You have my attention. Tell me what's going on.",
  "My blade is ready. Speak your mind.",
  "Sounds serious. Go on, I'm here to help.",
];

export const GREETING_REPLIES: Record<string, string[]> = {
  sunforged: [
    "By the light of Aurandel, I stand ready. What threatens this land?",
    "I swore an oath to defend the weak. Tell me what must be done.",
    "The righteous do not hesitate. Speak, and I shall act.",
    "My shield arm is steady. What evil needs purging?",
  ],
  veilborn: [
    "...I'm listening. But know that my help comes at a price.",
    "Interesting. And what's in it for me, exactly?",
    "I've heard whispers about trouble here. Let's see if they're true.",
    "Trust is earned, not given. But you have my attention.",
  ],
  dawnkeeper: [
    "I sense pain in your words. Let me help carry this burden.",
    "Every soul deserves aid. Tell me how I can bring light here.",
    "The Ember Communes taught me that all suffering can be healed. What do you need?",
    "Peace comes through action. I'm here to help, friend.",
  ],
  ironvow: [
    "Skip the pleasantries. What needs killing?",
    "I didn't crawl out of the pits for small talk. Get to the point.",
    "You want something done right? You came to the right person.",
    "Words are cheap. Point me at the problem.",
  ],
};

export const QUEST_REPLIES_KILL: Record<string, string[]> = {
  sunforged: [
    "These creatures threaten the innocent. By my oath, they will fall.",
    "Justice demands their end. I'll strike them down with honor.",
    "No beast shall prey upon the defenseless while I draw breath.",
  ],
  veilborn: [
    "I know their patterns. They won't see me coming.",
    "Efficient. Clean. No witnesses. Consider it handled.",
    "I'll study their weaknesses first. Then... silence.",
  ],
  dawnkeeper: [
    "I take no joy in this, but the balance must be restored.",
    "May their spirits find peace in the next life. It must be done.",
    "I'll end their suffering swiftly. Every life has meaning.",
  ],
  ironvow: [
    "Finally, some real work. They're already dead, they just don't know it.",
    "Only ${count}? I was hoping for a challenge.",
    "Blood and steel. The only language worth speaking.",
  ],
};

export const QUEST_REPLIES_GATHER: Record<string, string[]> = {
  sunforged: [
    "A noble task. I'll search every corner of this land for what you need.",
    "Resources to aid the cause? I'll gather them with purpose.",
  ],
  veilborn: [
    "I know places others don't. I'll have them before dawn.",
    "Procurement is one of my... specialties. Leave it to me.",
  ],
  dawnkeeper: [
    "The land provides for those who ask gently. I'll find them.",
    "Nature's gifts are meant to be shared. I'm on it.",
  ],
  ironvow: [
    "Errands. Fine. But you owe me one.",
    "Not exactly glory work, but a job's a job. I'll get it done.",
  ],
};

export const QUEST_REPLIES_CRAFT: Record<string, string[]> = {
  sunforged: [
    "My hands serve creation as well as destruction. I'll forge what you need.",
    "Aurandel's smiths taught me well. I'll craft them with care.",
  ],
  veilborn: [
    "Precision work? Finally, something that requires finesse.",
    "I've crafted tools in the shadow markets. This should be trivial.",
  ],
  dawnkeeper: [
    "To create is to heal the world. I'll put my heart into it.",
    "The Ember Communes value craftsmanship above all. Watch me work.",
  ],
  ironvow: [
    "Forge work. Good. There's honesty in shaping metal with your hands.",
    "I learned to make weapons before I learned to read. Easy.",
  ],
};

export const QUEST_REPLIES_TALK: Record<string, string[]> = {
  sunforged: [
    "I'll seek them out. Knowledge strengthens the righteous.",
    "Words can be as powerful as swords. I'll hear what they say.",
  ],
  veilborn: [
    "Information is currency. I'll extract what we need.",
    "I'll listen... and read between the lines.",
  ],
  dawnkeeper: [
    "Every voice deserves to be heard. I'll find them and listen.",
    "Connection and understanding. That's what I do best.",
  ],
  ironvow: [
    "Talking. Not my strength, but I'll manage.",
    "Fine. But if they waste my time, we're done.",
  ],
};

export const NPC_FOLLOWUP_LINES = [
  "You're back. Your champion is already working on the tasks I gave. Keep at it.",
  "I see you've returned. Your agent is making progress. Review the state of the work.",
  "Patience, friend. Your champion hasn't finished yet. These things take time.",
  "Still here? Your agent is in the field. Come back when the job is done.",
];

export const SCOUT_KAELA_INTRO_LINES = [
  "I am Scout Kaela. I brief every new arrival on the systems that matter in Geneva. Listen closely.",
  "Your champion fights on your behalf - an AI agent that quests, gathers, fights, and trades. You observe and direct from here.",
  "Press Q to open your quest log. Talk to Guard Captain Marcus to start the village quest chain. Your agent will handle the rest.",
  "Press C for your character console. That's where you manage your roster and redeploy a different champion.",
  "The chat panel is your command bridge. Deploy your agent, give it directives - quest, gather, fight, travel, shop - and watch its activity log.",
  "Press R to check rankings and the live lobby. Press W for your wallet and inventory. Press M for the world map.",
  "Now step into the world. Speak with Guard Captain Marcus, start the village quest chain, and build your legend across Geneva. Good luck, champion.",
];

export const SCOUT_KAELA_FOLLOWUP_LINES = [
  "You've already had the briefing. Guard Captain Marcus is still your first stop.",
  "Use Q to track quests, C to manage your roster, and the chat panel to direct your champion.",
  "Geneva remembers your choices. Keep moving.",
];
