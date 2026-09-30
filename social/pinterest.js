module.exports = {
    id: "pinterest",
    tag: "📌 Pinterest",
    match: (url) => /pinterest\.com|pin\.it/i.test(url),
    extractorArgs: [],
};
