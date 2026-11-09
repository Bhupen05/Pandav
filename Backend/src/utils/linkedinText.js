// What a Social Hub post says on LinkedIn. The app has a copy of
// linkedInText() and hashtagOf() (Frontend/src/components/social/linkedin.ts)
// for its preview and character count: keep the two the same.

// The most a LinkedIn post's text may hold, as people read it
export const LINKEDIN_TEXT_MAX = 3000;

// A tag as a LinkedIn hashtag: letters, digits and underscores only
export const hashtagOf = (tag) =>
  String(tag ?? '').normalize('NFKC').replace(/[^\p{L}\p{N}_]/gu, '');

// #word in the post's own text
const HASHTAG = /(^|[^\p{L}\p{N}_])#([\p{L}\p{N}_]+)/gu;

// The post's text on LinkedIn: the title on its own line, the post, and
// then the tags as hashtags, leaving out tags the post already uses as
// hashtags
export const linkedInText = ({ title, content, tags } = {}) => {
  const body = String(content ?? '').trim();
  const used = new Set([...body.matchAll(HASHTAG)].map((match) => match[2].toLowerCase()));
  const hashtags = [];
  for (const tag of tags ?? []) {
    const hashtag = hashtagOf(tag);
    if (!hashtag || used.has(hashtag.toLowerCase())) continue;
    used.add(hashtag.toLowerCase());
    hashtags.push(`#${hashtag}`);
  }
  return [String(title ?? '').trim(), body, hashtags.join(' ')].filter(Boolean).join('\n\n');
};

// LinkedIn's Posts API reads a post's text in its "little" format, where
// these characters have meanings (mentions, hashtags, templates) and are
// left out or cut the text short unless escaped
const RESERVED = /[\\|{}@[\]()<>#*_~]/g;
const escapeLittle = (text) => text.replace(RESERVED, '\\$&');

// Text for LinkedIn's `commentary`: everything escaped, except #word
// hashtags, which become hashtag templates so they still link
export const toLittleText = (text) => {
  let out = '';
  let last = 0;
  for (const match of text.matchAll(HASHTAG)) {
    const at = match.index + match[1].length;
    out += `${escapeLittle(text.slice(last, at))}{hashtag|\\#|${escapeLittle(match[2])}}`;
    last = at + 1 + match[2].length;
  }
  return out + escapeLittle(text.slice(last));
};
