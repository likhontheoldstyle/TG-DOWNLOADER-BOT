module.exports = {
    id: "youtube",
    tag: "📺 YouTube",
    match: (url) => /youtube\.com|youtu\.be/i.test(url),
    extractorArgs: [],
};
