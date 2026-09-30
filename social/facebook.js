module.exports = {
    id: "facebook",
    tag: "📘 Facebook",
    match: (url) => /facebook\.com|fb\.watch|fb\.com/i.test(url),
    extractorArgs: [],
};
