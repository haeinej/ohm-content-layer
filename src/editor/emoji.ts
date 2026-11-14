// A small emoji set for page icons, grouped, with words to search by.
export type EmojiGroup = { id: string; label: string; emoji: [string, string][] }

export const EMOJI: EmojiGroup[] = [
  {
    id: "people", label: "Smileys & people", emoji: [
      ["😀", "grin smile happy"], ["😃", "smile happy"], ["😄", "smile laugh"], ["😁", "grin"], ["😆", "laugh squint"], ["🤣", "rofl laugh"],
      ["😂", "tears joy laugh"], ["🙂", "slight smile"], ["😉", "wink"], ["😊", "blush"], ["😇", "angel halo"], ["🥰", "love hearts"],
      ["😍", "heart eyes love"], ["🤩", "star struck"], ["😘", "kiss"], ["😋", "yum"], ["😛", "tongue"], ["🤪", "zany crazy"],
      ["🤗", "hug"], ["🤔", "think"], ["🤫", "shush quiet"], ["😐", "neutral"], ["😴", "sleep"], ["😎", "cool sunglasses"],
      ["🤓", "nerd"], ["🥳", "party celebrate"], ["😮", "wow surprise"], ["😢", "cry sad"], ["😤", "huff"], ["🙌", "hands raise"],
      ["👏", "clap"], ["👍", "thumbs up yes"], ["✌️", "peace"], ["🙏", "thanks pray"], ["💪", "strong"], ["👀", "eyes look"],
    ],
  },
  {
    id: "nature", label: "Animals & nature", emoji: [
      ["🐶", "dog"], ["🐱", "cat"], ["🦊", "fox"], ["🐻", "bear"], ["🐼", "panda"], ["🐨", "koala"], ["🦁", "lion"], ["🐸", "frog"],
      ["🐙", "octopus"], ["🦋", "butterfly"], ["🐝", "bee"], ["🌱", "sprout plant grow"], ["🌿", "herb leaf"], ["🍀", "clover luck"],
      ["🌸", "blossom flower"], ["🌻", "sunflower"], ["🌳", "tree"], ["🌙", "moon night"], ["⭐", "star"], ["🌈", "rainbow"],
      ["☀️", "sun"], ["🌧️", "rain"], ["❄️", "snow"], ["🔥", "fire"], ["🌊", "wave sea"],
    ],
  },
  {
    id: "food", label: "Food & drink", emoji: [
      ["🍎", "apple"], ["🍋", "lemon"], ["🍓", "strawberry"], ["🥑", "avocado"], ["🍞", "bread"], ["🧀", "cheese"], ["🍕", "pizza"],
      ["🍜", "noodles ramen"], ["🍣", "sushi"], ["🍰", "cake"], ["🍪", "cookie"], ["☕", "coffee"], ["🍵", "tea"], ["🍷", "wine"],
    ],
  },
  {
    id: "travel", label: "Travel & places", emoji: [
      ["🚗", "car drive"], ["🚲", "bike"], ["✈️", "plane travel flight"], ["🚀", "rocket launch"], ["🏠", "home house"], ["🏙️", "city"],
      ["🗻", "mountain fuji"], ["🏝️", "island beach"], ["🗺️", "map"], ["🧭", "compass"], ["⛺", "camp tent"], ["🚉", "station train"],
    ],
  },
  {
    id: "objects", label: "Objects", emoji: [
      ["📝", "memo note write"], ["📓", "notebook"], ["📚", "books library read"], ["📌", "pin"], ["📎", "clip"], ["✏️", "pencil"],
      ["🖋️", "pen"], ["📷", "camera photo"], ["🎧", "headphones music"], ["💡", "idea bulb"], ["🔑", "key"], ["🧰", "toolbox"],
      ["⏰", "alarm clock"], ["📅", "calendar date"], ["📊", "chart"], ["💵", "money dollar"], ["🎁", "gift"], ["💻", "laptop computer"],
    ],
  },
  {
    id: "symbols", label: "Symbols", emoji: [
      ["❤️", "heart love"], ["💚", "green heart"], ["✅", "check done"], ["❌", "cross no"], ["⚠️", "warning"], ["❓", "question"],
      ["💬", "speech chat"], ["🔒", "lock private"], ["🌐", "globe public"], ["♻️", "recycle"], ["✨", "sparkles"], ["🔴", "red circle"],
      ["🟢", "green circle"], ["🔵", "blue circle"], ["⚫", "black circle"],
    ],
  },
]
