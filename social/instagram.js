module.exports = {
    id: "instagram",
    tag: "📸 Instagram",
    match: (url) => /instagram\.com/i.test(url),
    extractorArgs: [],
};
