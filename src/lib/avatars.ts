export const AVATARS = [
  "🦁", "🐯", "🦊", "🐼", "🐨", "🐻", "🐺", "🦄",
  "🐸", "🐵", "🦉", "🦅", "🐬", "🐙", "🦈", "🐢",
  "🐪", "🐎", "🦒", "🐘", "🐧", "🦋", "🐝", "🐲",
  "😎", "🤓", "🥷", "🧙", "🤖", "👽", "👑", "🚀",
];

export const randomAvatar = () => AVATARS[Math.floor(Math.random() * AVATARS.length)];
