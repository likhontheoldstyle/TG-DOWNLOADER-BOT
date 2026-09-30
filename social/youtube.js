module.exports = {
    id: "youtube",
    tag: "📺 YouTube",
    match: (url) => /youtube\.com|youtu\.be/i.test(url),
    extractorArgs: ["--extractor-args", "youtube:player_client=android,mediaconnect,web;player_skip=webpage"],
};
