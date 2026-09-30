module.exports = {
    id: "linkedin",
    tag: "💼 LinkedIn",
    match: (url) => /linkedin\.com|lnkd\.in/i.test(url),
    extractorArgs: [],
};
