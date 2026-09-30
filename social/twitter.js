module.exports = {
    id: "twitter",
    tag: "🐦 X (Twitter)",
    match: (url) => /twitter\.com|x\.com/i.test(url),
    extractorArgs: [],
};
