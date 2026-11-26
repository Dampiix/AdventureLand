// Defaults of cave/ (stage 7b): config.js fills these in where it has no value of its own (ours always win).
module.exports = {
    cave: {
        noArea: true, // manual mode: no area skills (Agitate, Cleave, Stomp, ...)
        // Recorder (storage "bot_cave_rec:<name>"), up to recordMaxChars per state.
        record: true, recordMaxChars: 12000, recordCapLeader: 400, recordCapMember: 150, entsEveryMs: 10000,
        recordStatesMember: false, // v1.238.6: members record entities, requests and rewards, not the (shared) states
    },
};
