// Standard emojis for the emoji picker (reaction roles and polls), by category, each with words to search by.
// Server emojis are loaded from Discord separately; any other emoji can be pasted in the picker.

const STANDARD_EMOJIS = [
  ['Smileys', [
    ['😀', 'grinning smile happy'], ['😃', 'smiley happy'], ['😄', 'smile happy'], ['😁', 'grin'], ['😆', 'laughing'], ['😅', 'sweat smile'],
    ['🤣', 'rofl laughing'], ['😂', 'joy tears laughing'], ['🙂', 'slight smile'], ['😉', 'wink'], ['😊', 'blush'], ['😇', 'innocent angel halo'],
    ['🥰', 'love hearts'], ['😍', 'heart eyes love'], ['🤩', 'star struck'], ['😘', 'kiss'], ['😋', 'yum'], ['😛', 'tongue'],
    ['😜', 'wink tongue'], ['🤪', 'zany crazy'], ['🤗', 'hug'], ['🤔', 'thinking'], ['🤫', 'shush quiet'], ['🤐', 'zipper mouth'],
    ['😐', 'neutral'], ['😏', 'smirk'], ['😒', 'unamused'], ['🙄', 'eye roll'], ['😬', 'grimace'], ['😌', 'relieved'],
    ['😴', 'sleeping sleep'], ['🤤', 'drool'], ['😷', 'mask sick'], ['🤒', 'sick thermometer'], ['🥳', 'party partying'], ['😎', 'cool sunglasses'],
    ['🤓', 'nerd'], ['🧐', 'monocle'], ['😕', 'confused'], ['😟', 'worried'], ['😮', 'open mouth wow'], ['😲', 'astonished'],
    ['🥺', 'pleading'], ['😢', 'cry sad'], ['😭', 'sob crying'], ['😱', 'scream'], ['😡', 'angry mad'], ['🤬', 'cursing'],
    ['😈', 'devil'], ['💀', 'skull dead'], ['👻', 'ghost'], ['👽', 'alien'], ['🤖', 'robot bot'], ['💩', 'poop'], ['🤡', 'clown'],
  ]],
  ['Hands & people', [
    ['👋', 'wave hello'], ['👍', 'thumbs up yes'], ['👎', 'thumbs down no'], ['👏', 'clap'], ['🙌', 'raised hands'], ['🙏', 'pray please thanks'],
    ['🤝', 'handshake'], ['✌️', 'peace victory'], ['🤞', 'fingers crossed'], ['🤟', 'love you'], ['🤘', 'rock metal'], ['👌', 'ok'],
    ['✋', 'hand stop'], ['💪', 'muscle strong'], ['👀', 'eyes looking'], ['🧠', 'brain smart'], ['👑', 'crown king queen'], ['🧙', 'mage wizard'],
  ]],
  ['Hearts', [
    ['❤️', 'red heart love'], ['🧡', 'orange heart'], ['💛', 'yellow heart'], ['💚', 'green heart'], ['💙', 'blue heart'], ['💜', 'purple heart'],
    ['🖤', 'black heart'], ['🤍', 'white heart'], ['🤎', 'brown heart'], ['💖', 'sparkling heart'], ['💔', 'broken heart'],
  ]],
  ['Animals & nature', [
    ['🐶', 'dog'], ['🐱', 'cat'], ['🐭', 'mouse'], ['🐹', 'hamster'], ['🐰', 'rabbit bunny'], ['🦊', 'fox'],
    ['🐻', 'bear'], ['🐼', 'panda'], ['🐨', 'koala'], ['🐯', 'tiger'], ['🦁', 'lion'], ['🐮', 'cow'],
    ['🐷', 'pig'], ['🐸', 'frog'], ['🐵', 'monkey'], ['🐔', 'chicken'], ['🐧', 'penguin'], ['🐦', 'bird'],
    ['🦄', 'unicorn'], ['🐝', 'bee'], ['🦋', 'butterfly'], ['🐢', 'turtle'], ['🐍', 'snake'], ['🐙', 'octopus'],
    ['🐬', 'dolphin'], ['🦈', 'shark'], ['🐉', 'dragon'], ['🌸', 'cherry blossom flower'], ['🌹', 'rose flower'], ['🌻', 'sunflower'],
    ['🌲', 'tree'], ['🍀', 'clover luck'], ['🍁', 'maple leaf autumn'], ['🌙', 'moon night'], ['⭐', 'star'], ['🌟', 'glowing star'],
    ['☀️', 'sun'], ['🌈', 'rainbow'], ['⚡', 'lightning zap'], ['❄️', 'snowflake winter'], ['🔥', 'fire hot'], ['💧', 'droplet water'], ['🌊', 'wave ocean'],
  ]],
  ['Food & drink', [
    ['🍎', 'apple'], ['🍓', 'strawberry'], ['🍉', 'watermelon'], ['🍌', 'banana'], ['🍇', 'grapes'], ['🍕', 'pizza'],
    ['🍔', 'burger'], ['🍟', 'fries'], ['🌮', 'taco'], ['🍣', 'sushi'], ['🍜', 'ramen noodles'], ['🍩', 'donut'],
    ['🍪', 'cookie'], ['🎂', 'birthday cake'], ['🍰', 'cake'], ['🍫', 'chocolate'], ['🍿', 'popcorn'], ['☕', 'coffee'], ['🧋', 'boba tea'], ['🍵', 'tea'],
  ]],
  ['Games & hobbies', [
    ['🎮', 'video game controller gaming'], ['🕹️', 'joystick arcade'], ['🎲', 'dice game'], ['♟️', 'chess'], ['🎯', 'target'], ['🧩', 'puzzle'],
    ['🏆', 'trophy winner'], ['🥇', 'gold medal first'], ['⚽', 'soccer football'], ['🏀', 'basketball'], ['🏈', 'american football'], ['⚾', 'baseball'],
    ['🎾', 'tennis'], ['🏐', 'volleyball'], ['🎨', 'art paint artist'], ['🎭', 'theater drama'], ['🎤', 'microphone sing'], ['🎧', 'headphones music'],
    ['🎵', 'music note'], ['🎸', 'guitar'], ['🎹', 'piano keyboard'], ['📷', 'camera photo'], ['🎬', 'film movie'], ['📚', 'books study read'],
    ['✏️', 'pencil write'], ['💻', 'laptop code'], ['🖥️', 'desktop computer'], ['⌨️', 'keyboard'], ['📱', 'phone mobile'], ['📺', 'tv stream'],
  ]],
  ['Objects & travel', [
    ['🚀', 'rocket launch'], ['✈️', 'airplane travel'], ['🚗', 'car'], ['🏠', 'house home'], ['🏰', 'castle'], ['🌍', 'globe world earth'],
    ['💡', 'bulb idea'], ['🔔', 'bell notification ping'], ['📢', 'loudspeaker announcement'], ['📣', 'megaphone'], ['🔒', 'lock'], ['🔑', 'key'],
    ['🛡️', 'shield'], ['⚔️', 'swords'], ['💎', 'gem diamond'], ['💰', 'money bag'], ['🎁', 'gift present'], ['🎉', 'tada party'],
    ['🎊', 'confetti'], ['🎈', 'balloon'], ['📌', 'pin'], ['📝', 'memo note'], ['📅', 'calendar event'], ['⏰', 'alarm clock'],
  ]],
  ['Symbols', [
    ['✅', 'check yes done verify'], ['❌', 'cross no'], ['❓', 'question'], ['❗', 'exclamation'], ['⚠️', 'warning'], ['⛔', 'no entry'],
    ['🚫', 'prohibited'], ['♻️', 'recycle'], ['💯', 'hundred'], ['🆕', 'new'], ['🆗', 'ok'], ['🔞', 'eighteen nsfw adult'],
    ['🔴', 'red circle'], ['🟠', 'orange circle'], ['🟡', 'yellow circle'], ['🟢', 'green circle'], ['🔵', 'blue circle'], ['🟣', 'purple circle'],
    ['⚫', 'black circle'], ['⚪', 'white circle'], ['🟥', 'red square'], ['🟧', 'orange square'], ['🟨', 'yellow square'], ['🟩', 'green square'],
    ['🟦', 'blue square'], ['🟪', 'purple square'], ['1️⃣', 'one 1'], ['2️⃣', 'two 2'], ['3️⃣', 'three 3'], ['4️⃣', 'four 4'],
    ['5️⃣', 'five 5'], ['♂️', 'male he him'], ['♀️', 'female she her'], ['⚧️', 'transgender they them'],
  ]],
  ['Flags', [
    ['🏳️‍🌈', 'rainbow pride flag'], ['🇺🇸', 'united states usa america'], ['🇬🇧', 'united kingdom uk britain'], ['🇨🇦', 'canada'], ['🇩🇪', 'germany'], ['🇫🇷', 'france'],
    ['🇪🇸', 'spain'], ['🇮🇹', 'italy'], ['🇧🇷', 'brazil'], ['🇲🇽', 'mexico'], ['🇯🇵', 'japan'], ['🇰🇷', 'korea'],
    ['🇮🇳', 'india'], ['🇦🇺', 'australia'], ['🇳🇱', 'netherlands'], ['🇵🇱', 'poland'], ['🇸🇪', 'sweden'], ['🇵🇭', 'philippines'],
  ]],
];

// The mod portal and the main process use the same list (for /poll suggestions and bar colours).
if (typeof module === 'object') module.exports = { STANDARD_EMOJIS };
