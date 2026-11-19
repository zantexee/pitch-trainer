// Plain-language notes for each interval: what it feels like and a well-known
// tune that starts with it (going up and going down). English is the source;
// Romanian lives in src/i18n/ro.ts. Song titles are never translated.

export interface IntervalInfo {
  semis: number;
  full: string;
  feel: string;
  up: string;
  down: string;
}

export const INTERVAL_INFO: Record<number, IntervalInfo> = {
  1: { semis: 1, full: 'Minor 2nd', feel: 'Tense and crunchy, the smallest step. Think of a shark closing in.', up: 'Jaws', down: 'Für Elise' },
  2: { semis: 2, full: 'Major 2nd', feel: 'One whole step, like walking up a scale. Open and neutral.', up: 'Happy Birthday', down: 'Yesterday (The Beatles)' },
  3: { semis: 3, full: 'Minor 3rd', feel: 'Sad and soft. The sound of a minor chord.', up: 'Greensleeves', down: 'Hey Jude' },
  4: { semis: 4, full: 'Major 3rd', feel: 'Bright and happy. The sound of a major chord.', up: 'When the Saints Go Marching In', down: 'Swing Low, Sweet Chariot' },
  5: { semis: 5, full: 'Perfect 4th', feel: 'Open and solid, like a call to begin. It wants to settle.', up: 'Here Comes the Bride', down: 'Eine kleine Nachtmusik' },
  6: { semis: 6, full: 'Tritone', feel: 'Unstable and eerie, it wants to move on. Exactly half an octave.', up: 'The Simpsons', down: 'Black Sabbath' },
  7: { semis: 7, full: 'Perfect 5th', feel: 'Strong, hollow and heroic. Very stable.', up: 'Star Wars', down: 'The Flintstones' },
  8: { semis: 8, full: 'Minor 6th', feel: 'Wide and bittersweet, a little longing.', up: 'The Entertainer', down: 'Love Story' },
  9: { semis: 9, full: 'Major 6th', feel: 'Wide and warm, sweet and singing.', up: 'My Bonnie Lies over the Ocean', down: "Nobody Knows the Trouble I've Seen" },
  10: { semis: 10, full: 'Minor 7th', feel: 'Wide with a pull, bluesy. Not quite home.', up: 'Star Trek', down: 'An American in Paris' },
  11: { semis: 11, full: 'Major 7th', feel: 'Very tense, one step short of the octave.', up: 'Take On Me', down: 'I Love You (Cole Porter)' },
  12: { semis: 12, full: 'Octave', feel: 'The same note, higher or lower. Sounds almost like one note.', up: 'Somewhere over the Rainbow', down: 'Willow Weep for Me' },
};
